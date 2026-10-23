/**
 * tree/perf.ts — frame statistics, performance profiles and the adaptive resolution controller (PURE: no three.js, no DOM,
 * unit-tested in tools/unit-perf.mjs).
 *
 * Why: the tree view is GPU-bound on laptops (fill rate / overdraw at high pixel ratios with MSAA, ~1M triangles in the
 * voxel look), not JS-bound. So the knobs are the pixel ratio, MSAA, the frame-rate cap and a "slow? render fewer pixels"
 * controller; the numbers that say which one matters come from the stats overlay (key I): the CPU time of a frame next to
 * its total time (low CPU ms but long frames = GPU-bound).
 */

// ------------------------------------------------------------------ profiles

export type PerfProfile = "quality" | "auto" | "fast";
export const PERF_PROFILES: readonly PerfProfile[] = ["quality", "auto", "fast"];
/** localStorage key of the remembered profile. */
export const PERF_KEY = "biblio.v1.treePerf";
export const DEFAULT_PERF_PROFILE: PerfProfile = "auto";

export interface ProfileSettings {
  /** Highest device pixel ratio rendered (the screen's own ratio is used below it). */
  dprCap: number;
  /** Frame-rate cap (0 = the display's refresh rate): a 120/144 Hz screen otherwise doubles the GPU work for no gain in a view like this. */
  maxFps: number;
  /** Lower the pixel ratio automatically while frames are slow. */
  adaptive: boolean;
  /** Lowest resolution scale the controller may use (1 = full). */
  minScale: number;
  /** MSAA is only requested when the effective device ratio is at most this (high-DPI screens need it far less). */
  msaaMaxDpr: number;
}

export const PROFILE: Record<PerfProfile, ProfileSettings> = {
  // the old behaviour: full device ratio up to 2, MSAA, no cap
  quality: { dprCap: 2, maxFps: 0, adaptive: false, minScale: 1, msaaMaxDpr: Infinity },
  // the default: ratio <= 1.5, 60 fps cap, MSAA only on ordinary-DPI screens, and the controller drops the resolution when slow
  auto: { dprCap: 1.5, maxFps: 60, adaptive: true, minScale: 0.6, msaaMaxDpr: 1.25 },
  // weak GPUs: ratio <= 1, no MSAA, the controller may go down to half resolution
  fast: { dprCap: 1, maxFps: 60, adaptive: true, minScale: 0.5, msaaMaxDpr: 0 },
};

export function parsePerfProfile(v: unknown): PerfProfile {
  return typeof v === "string" && (PERF_PROFILES as readonly string[]).includes(v) ? (v as PerfProfile) : DEFAULT_PERF_PROFILE;
}

export function nextPerfProfile(p: PerfProfile): PerfProfile {
  return PERF_PROFILES[(PERF_PROFILES.indexOf(p) + 1) % PERF_PROFILES.length];
}

/** Whether to ask for MSAA when the renderer is created (it cannot be switched on a live context). */
export function useMsaa(profile: PerfProfile, devicePixelRatio: number): boolean {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(PROFILE[profile].dprCap, dpr) <= PROFILE[profile].msaaMaxDpr;
}

/** The pixel ratio to render at: min(profile cap, the screen's ratio) x the controller's scale, never below 0.25. */
export function effectivePixelRatio(profile: PerfProfile, devicePixelRatio: number, scale: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const s = Number.isFinite(scale) ? Math.min(1, Math.max(0.1, scale)) : 1;
  return Math.max(0.25, Math.min(PROFILE[profile].dprCap, dpr) * s);
}

/**
 * Frame-rate cap by SCHEDULING: the next frame is due one interval after the previous DUE time (not after the previous
 * render), so the average rate equals the cap whatever the display's refresh rate (a "skip if too soon" rule would turn a
 * 144 Hz screen under a 60 fps cap into 48 fps: frames land every third tick). `maxFps` 0 = never skip.
 */
export class FrameLimiter {
  private due = -Infinity;
  constructor(private maxFps = 0) {}

  setMaxFps(maxFps: number): void {
    this.maxFps = maxFps;
    this.due = -Infinity;
  }

  /** Call once per animation frame with its timestamp (ms); true = render this one. */
  shouldRender(now: number): boolean {
    if (!(this.maxFps > 0) || !Number.isFinite(now)) return true;
    const interval = 1000 / this.maxFps;
    if (now < this.due - 1.5) return false; // a 1.5 ms tolerance: a 60 Hz screen under a 60 fps cap must not lose every other frame to jitter
    // after a stall (tab in the background) do not try to catch up: start the schedule again from now
    this.due = this.due === -Infinity || now - this.due > interval * 2 ? now + interval : this.due + interval;
    return true;
  }
}

// --------------------------------------------------------------------- stats

export interface FrameSummary {
  /** Frames per second over the window (from the average frame interval). */
  fps: number;
  /** Average / 95th percentile time between rendered frames, ms. */
  avgFrameMs: number;
  p95FrameMs: number;
  /** Average JS time of a frame (simulation, camera, foliage, shadows, render submit), ms. */
  avgCpuMs: number;
  /** Average time spent inside `renderer.render` (draw-call submit; the GPU work itself is asynchronous), ms. */
  avgRenderMs: number;
  samples: number;
}

/** Rolling window of per-frame timings. */
export class FrameClock {
  private frame: number[] = [];
  private cpu: number[] = [];
  private render: number[] = [];
  constructor(private readonly size = 90) {}

  push(frameMs: number, cpuMs: number, renderMs: number): void {
    if (!(frameMs > 0) || !Number.isFinite(frameMs)) return; // a first frame / a tab that was hidden gives garbage: ignore
    if (frameMs > 1000) return; // a long stall is not a frame time
    const put = (a: number[], v: number): void => {
      a.push(Number.isFinite(v) && v >= 0 ? v : 0);
      if (a.length > this.size) a.shift();
    };
    put(this.frame, frameMs);
    put(this.cpu, cpuMs);
    put(this.render, renderMs);
  }

  reset(): void {
    this.frame = [];
    this.cpu = [];
    this.render = [];
  }

  get avgFrameMs(): number {
    return mean(this.frame);
  }

  summary(): FrameSummary {
    const avg = mean(this.frame);
    const sorted = [...this.frame].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      avgFrameMs: avg,
      p95FrameMs: p95,
      avgCpuMs: mean(this.cpu),
      avgRenderMs: mean(this.render),
      samples: this.frame.length,
    };
  }
}

function mean(a: number[]): number {
  if (a.length === 0) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

/** What the overlay says about where the time goes (a hint, not a measurement of the GPU). */
export function diagnose(s: FrameSummary, maxFps: number): "no data" | "ok" | "gpu-bound" | "cpu-bound" {
  if (s.samples < 20) return "no data";
  const target = maxFps > 0 ? 1000 / maxFps : 1000 / 60;
  if (s.avgFrameMs <= target * 1.15) return "ok";
  // frames are long: if our own JS time explains most of it the CPU is the limit, otherwise we wait for the GPU
  return s.avgCpuMs >= s.avgFrameMs * 0.6 ? "cpu-bound" : "gpu-bound";
}

// ------------------------------------------------------------ adaptive scale

/** Resolution scales the controller steps through (relative to the profile's pixel ratio). */
export const SCALE_STEPS: readonly number[] = [1, 0.85, 0.72, 0.6, 0.5];

export interface AdaptiveOptions {
  /** Average frame time (ms) above which the picture is "slow" (default 21 ms = under ~48 fps). */
  slowMs: number;
  /** Average frame time (ms) at or below which there is room to go back up (default 17.6 ms = a clean 60 fps). */
  fastMs: number;
  /** How long it must stay slow before stepping down (ms). */
  downAfter: number;
  /** How long it must stay fast before stepping up (ms); doubles (up to `maxUpWait`) after every upward step that had to be undone soon. */
  upAfter: number;
  maxUpWait: number;
  /** Minimum time between two changes (ms): resizing the drawing buffer is not free. */
  cooldown: number;
  /** A downward step within this long (ms) of an upward one counts as "the upward step was a mistake". */
  regret: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveOptions = { slowMs: 21, fastMs: 17.6, downAfter: 700, upAfter: 5000, maxUpWait: 80000, cooldown: 1200, regret: 12000 };

/**
 * Picks a resolution scale from the recent average frame time. Hysteresis: steps down after 0.7 s of slow frames, steps up
 * only after 5 s of clean ones, and waits twice as long every time an upward step had to be taken back (so it settles
 * instead of oscillating). Pure: feed it `(avgFrameMs, now)` a few times a second.
 */
export class AdaptiveScale {
  private idx = 0;
  private slowSince: number | null = null;
  private fastSince: number | null = null;
  private lastChange = -Infinity;
  private lastUp = -Infinity;
  private upWait: number;

  constructor(
    private minScale = 0.5,
    private readonly opt: AdaptiveOptions = DEFAULT_ADAPTIVE,
  ) {
    this.upWait = opt.upAfter;
  }

  get scale(): number {
    return SCALE_STEPS[this.idx];
  }

  /** True when the lowest allowed resolution is reached (the overlay then suggests turning shadows / foliage off). */
  get atFloor(): boolean {
    return this.idx >= this.floorIndex();
  }

  setMinScale(min: number): void {
    this.minScale = min;
    this.idx = Math.min(this.idx, this.floorIndex());
  }

  reset(): void {
    this.idx = 0;
    this.slowSince = null;
    this.fastSince = null;
    this.lastChange = -Infinity;
    this.lastUp = -Infinity;
    this.upWait = this.opt.upAfter;
  }

  private floorIndex(): number {
    let i = 0;
    while (i + 1 < SCALE_STEPS.length && SCALE_STEPS[i + 1] >= this.minScale - 1e-9) i++;
    return i;
  }

  /** Returns the (possibly new) scale. Garbage input (NaN, <= 0) changes nothing. */
  update(avgFrameMs: number, now: number): number {
    if (!(avgFrameMs > 0) || !Number.isFinite(avgFrameMs) || !Number.isFinite(now)) return this.scale;
    const o = this.opt;
    const canChange = now - this.lastChange >= o.cooldown;
    if (avgFrameMs > o.slowMs) {
      this.fastSince = null;
      this.slowSince ??= now;
      if (canChange && now - this.slowSince >= o.downAfter && this.idx < this.floorIndex()) {
        this.idx++;
        if (now - this.lastUp < o.regret) this.upWait = Math.min(o.maxUpWait, this.upWait * 2); // that step up was a mistake: be more patient
        this.lastChange = now;
        this.slowSince = null;
      }
    } else if (avgFrameMs <= o.fastMs) {
      this.slowSince = null;
      this.fastSince ??= now;
      if (canChange && now - this.fastSince >= this.upWait && this.idx > 0) {
        this.idx--;
        this.lastChange = now;
        this.lastUp = now;
        this.fastSince = null;
      }
    } else {
      // in between: neither slow nor clearly fast: hold
      this.slowSince = null;
      this.fastSince = null;
    }
    return this.scale;
  }
}
