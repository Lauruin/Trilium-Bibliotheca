/**
 * tree/wave.ts — the "wave" of a branch: a smooth sideways displacement of its centreline (pure, no three.js / DOM).
 *
 * A branch has three wave properties (layout.ts: `wave` amplitude, `waveFreq`, `waveFn` shape). The unit displacement
 * `waveShape(fn, t, freq, seed)` -> `[a, b]` (|(a, b)| <= 1) at fraction `t` along the branch is scaled by the amplitude
 * (a fraction of the branch's length) and applied perpendicular to the branch's direction, in a rotation-minimising frame
 * (`applyWave`). Every shape is 0 at the base (t = 0) with a zero slope there, so joins to the parent stay continuous and
 * smooth, and is finite for any input. The branch's TIP is not faded: it ends wherever the wave puts it.
 * The branch editor draws its preview straight from `waveShape`.
 */

import { add, cross, dot, len, mul, norm, sub, v3, type V3 } from "./world3";

export type WaveFn = "none" | "sine" | "zigzag" | "sawtooth" | "helix" | "sbend" | "noise";

export const WAVE_FNS: readonly WaveFn[] = ["none", "sine", "zigzag", "sawtooth", "helix", "sbend", "noise"];

export const WAVE_LABELS: Record<WaveFn, string> = {
  none: "Straight (none)", sine: "Sine wave", zigzag: "Zigzag", sawtooth: "Sawtooth (slow rise, quick drop)",
  helix: "Corkscrew (helix)", sbend: "S-bend (one smooth jog)", noise: "Natural wobble (noise)",
};

/** A shape name from user text (case-insensitive, trimmed); anything else -> null. */
export function parseWaveFn(v: unknown): WaveFn | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase();
  return (WAVE_FNS as readonly string[]).includes(k) ? (k as WaveFn) : null;
}

const TAU = Math.PI * 2;
const frac = (x: number): number => x - Math.floor(x);
/** Base ramp: 0 with a zero slope at t = 0, full from t = 0.25 (smoothstep). */
const ramp = (t: number): number => {
  const u = Math.min(1, Math.max(0, t / 0.25));
  return u * u * (3 - 2 * u);
};

/** Triangle wave in [-1, 1], 0 at x = 0, period 1. */
const tri = (x: number): number => 1 - 4 * Math.abs(frac(x + 0.25) - 0.5);
/** Sawtooth in [-1, 1]: rises over 80 % of the period, drops over 20 %; 0 (rising) at x = 0, period 1. */
const SAW_FALL = 0.2;
const saw = (x: number): number => {
  const u = frac(x + 0.4);
  return u < 1 - SAW_FALL ? -1 + (2 * u) / (1 - SAW_FALL) : 1 - (2 * (u - (1 - SAW_FALL))) / SAW_FALL;
};
/** Rounds the corners of a piecewise-linear periodic wave (3-tap blur over +-0.04 of a period). */
const rounded = (f: (x: number) => number, x: number): number => 0.25 * f(x - 0.04) + 0.5 * f(x) + 0.25 * f(x + 0.04);

/** Phases of the noise shape: three sine components per axis, derived from the seed. */
const NOISE_C = [1, 1.9, 3.3];
const NOISE_A = [1, 0.5, 0.25];
const NOISE_SUM = NOISE_A.reduce((s, a) => s + a, 0);

/**
 * Unit displacement `[a, b]` (|(a, b)| <= 1) at fraction `t` of the branch for the shape `fn` with `freq` cycles along it;
 * `seed` in [0, 1) picks the noise phases. 0 at t = 0 for every shape (with a zero slope there); the S-bend ignores `freq`.
 * Never throws; non-finite input gives `[0, 0]`.
 */
export function waveShape(fn: WaveFn, t: number, freq: number, seed = 0): [number, number] {
  if (!Number.isFinite(t) || !Number.isFinite(freq) || !Number.isFinite(seed) || fn === "none") return [0, 0];
  const tt = Math.min(1, Math.max(0, t));
  const f = Math.min(64, Math.max(0, freq));
  const x = f * tt;
  const e = ramp(tt);
  switch (fn) {
    case "sine":
      return [e * Math.sin(TAU * x), 0];
    case "zigzag":
      return [e * rounded(tri, x), 0];
    case "sawtooth":
      return [e * rounded(saw, x), 0];
    case "helix": // a circle of radius 1/2 through the base point: a corkscrew about the line the branch would have run along
      return [e * 0.5 * Math.sin(TAU * x), e * 0.5 * (1 - Math.cos(TAU * x))];
    case "sbend": {
      const u = tt * tt * (3 - 2 * tt); // smoothstep: leaves the line, ends parallel to it, `1` to one side
      return [u, 0];
    }
    case "noise": {
      const s = frac(seed);
      let a = 0;
      let b = 0;
      for (let m = 0; m < 3; m++) {
        a += NOISE_A[m] * Math.sin(TAU * (NOISE_C[m] * x + frac(s * (3.17 + m * 1.93) + m * 0.37)));
        b += NOISE_A[m] * Math.sin(TAU * (NOISE_C[m] * x + frac(s * (5.71 + m * 2.29) + m * 0.61 + 0.5)));
      }
      // subtract the value at t = 0 so the base stays put, then scale into the unit disc
      let a0 = 0;
      let b0 = 0;
      for (let m = 0; m < 3; m++) {
        a0 += NOISE_A[m] * Math.sin(TAU * frac(s * (3.17 + m * 1.93) + m * 0.37));
        b0 += NOISE_A[m] * Math.sin(TAU * frac(s * (5.71 + m * 2.29) + m * 0.61 + 0.5));
      }
      const k = (1.2 * e) / NOISE_SUM;
      const va = (a - a0) * k;
      const vb = (b - b0) * k;
      const soft = 1 / Math.sqrt(1 + va * va + vb * vb); // keeps the magnitude below 1 without a corner
      return [va * soft, vb * soft];
    }
  }
}

/** Largest |d(displacement)/dt| of the shape per unit amplitude (an upper bound; used to keep a wavy branch from kinking). */
export function waveSlope(fn: WaveFn, freq: number): number {
  const f = Math.max(0, Number.isFinite(freq) ? freq : 0);
  const base = 6; // the base ramp
  switch (fn) {
    case "none": return 0;
    case "sine": return TAU * f + base;
    case "zigzag": return 4 * f + base;
    case "sawtooth": return (2 / SAW_FALL) * f + base;
    case "helix": return Math.PI * f + base;
    case "sbend": return 1.5;
    case "noise": return TAU * f * 2.7 + base;
  }
}

/** Steepest the displaced branch may run relative to its undisplaced line (tan of the angle): amplitude is reduced to keep it. */
export const WAVE_MAX_SLOPE = 0.7;
/** Shortest wavelength the geometry resolves, px (higher frequencies on a short branch are capped). */
export const WAVE_MIN_LENGTH = 50;

/** Cycles the geometry really uses on a branch of this length (the requested ones, capped so a wavelength is >= WAVE_MIN_LENGTH). */
export const effectiveFreq = (freq: number, length: number): number => Math.max(0.25, Math.min(freq, Math.max(0.25, length / WAVE_MIN_LENGTH)));

/** The amplitude (fraction of length) that is really applied: `amp`, reduced so the slope stays <= WAVE_MAX_SLOPE. */
export function effectiveAmp(fn: WaveFn, amp: number, freq: number): number {
  if (fn === "none" || !(amp > 0)) return 0;
  const slope = waveSlope(fn, freq);
  return Math.min(amp, WAVE_MAX_SLOPE / Math.max(slope, 1e-6));
}

/**
 * Displace a dense centreline (`pts`, at least ~`wavelength / 8` apart) by the wave: perpendicular to its direction, in a
 * rotation-minimising frame, planar shapes in the plane at angle `plane` (radians) around the direction. `amp` = fraction of
 * the polyline's length. The first point never moves. Returns new points; the input is untouched.
 */
export function applyWave(pts: readonly V3[], fn: WaveFn, amp: number, freq: number, seed: number, plane: number): V3[] {
  if (pts.length < 3 || fn === "none") return pts.map((p) => ({ ...p }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = cum[cum.length - 1];
  if (!(total > 1e-6)) return pts.map((p) => ({ ...p }));
  const f = effectiveFreq(freq, total);
  const a = effectiveAmp(fn, amp, f) * total;
  if (!(a > 1e-9)) return pts.map((p) => ({ ...p }));
  const up = v3(0, 1, 0);
  const proj = (u: V3, t: V3): V3 => sub(u, mul(t, dot(u, t)));
  const cp = Math.cos(plane);
  const sp = Math.sin(plane);
  let U: V3 | null = null;
  return pts.map((p, i) => {
    const T = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    if (!U) {
      const u0 = proj(up, T);
      U = norm(len(u0) < 0.25 ? proj(v3(0, 0, 1), T) : u0);
    } else {
      const q = proj(U, T);
      U = len(q) < 1e-6 ? U : norm(q);
    }
    const B = cross(T, U);
    const [w1, w2] = waveShape(fn, cum[i] / total, f, seed);
    if (w1 === 0 && w2 === 0) return { ...p };
    const e1 = add(mul(U, cp), mul(B, sp));
    const e2 = add(mul(U, -sp), mul(B, cp));
    return add(p, mul(add(mul(e1, w1), mul(e2, w2)), a));
  });
}
