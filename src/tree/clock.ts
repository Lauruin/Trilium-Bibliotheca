/**
 * tree/clock.ts — what time it is in the world (PURE, unit-tested): the player's choice at the shrine's altar.
 *
 *   real  - the browser's local time, now (the world follows the day outside),
 *   fixed - one hour of the day, whatever the real time (a slider),
 *   fast  - a full day in `fastMinutes` (24, 6 or 2) of real time, starting from the real time of day when it was chosen.
 *
 * The choice is remembered in localStorage (`biblio.v1.treeClock`) and is part of the save (lib/save.ts).
 */

export type ClockMode = "real" | "fixed" | "fast";
export const CLOCK_MODES: readonly ClockMode[] = ["real", "fixed", "fast"];
export const FAST_MINUTES: readonly number[] = [24, 6, 2];

export interface ClockState {
  mode: ClockMode;
  /** The hour for `fixed` (0..24). */
  hour: number;
  /** Minutes per day for `fast`. */
  fastMinutes: number;
  /** Night brightness 0..1 (daylight.ts `nightFloor`). */
  night: number;
}

export const CLOCK_KEY = "biblio.v1.treeClock";
export const DEFAULT_CLOCK: ClockState = { mode: "real", hour: 12, fastMinutes: 6, night: 0.5 };

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** Stored text -> a valid state (anything wrong falls back to the default for that field). Never throws. */
export function parseClock(text: string | null): ClockState {
  if (!text) return { ...DEFAULT_CLOCK };
  let v: Partial<ClockState> | null = null;
  try {
    v = JSON.parse(text) as Partial<ClockState>;
  } catch {
    return { ...DEFAULT_CLOCK };
  }
  if (!v || typeof v !== "object") return { ...DEFAULT_CLOCK };
  return {
    mode: (CLOCK_MODES as readonly unknown[]).includes(v.mode) ? (v.mode as ClockMode) : DEFAULT_CLOCK.mode,
    hour: typeof v.hour === "number" && Number.isFinite(v.hour) ? clamp(v.hour, 0, 24) : DEFAULT_CLOCK.hour,
    fastMinutes: typeof v.fastMinutes === "number" && FAST_MINUTES.includes(v.fastMinutes) ? v.fastMinutes : DEFAULT_CLOCK.fastMinutes,
    night: typeof v.night === "number" && Number.isFinite(v.night) ? clamp(v.night, 0, 1) : DEFAULT_CLOCK.night,
  };
}

export const serializeClock = (c: ClockState): string => JSON.stringify(parseClock(JSON.stringify(c)));

/** The hour of the day (0..24) of a real moment (local time). */
export function localHour(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3600000;
}

/** Day of the year (0 = 1 January) of a real date (local). */
export function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86400000);
}

/** "14:05" for an hour. */
export function hhmm(hours: number): string {
  const h = ((hours % 24) + 24) % 24;
  const m = Math.floor((h - Math.floor(h)) * 60 + 1e-9);
  return `${String(Math.floor(h)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Runs a ClockState against real time: `hours(now)` is the hour in the world. */
export class WorldClock {
  state: ClockState;
  /** The real moment and world hour the fast clock counts from. */
  private anchorMs = 0;
  private anchorHour = 12;

  constructor(state: ClockState = DEFAULT_CLOCK, now: Date = new Date()) {
    this.state = { ...state };
    this.restart(now);
  }

  /** Start counting `fast` from `now` (its real hour). */
  restart(now: Date): void {
    this.anchorMs = now.getTime();
    this.anchorHour = localHour(now);
  }

  set(state: ClockState, now: Date = new Date()): void {
    if (state.mode === "fast" && (this.state.mode !== "fast" || state.fastMinutes !== this.state.fastMinutes)) {
      // a new fast clock continues from the hour it is at now (no jump)
      const h = this.hours(now);
      this.anchorMs = now.getTime();
      this.anchorHour = h;
    }
    this.state = { ...state };
  }

  hours(now: Date = new Date()): number {
    switch (this.state.mode) {
      case "fixed":
        return this.state.hour;
      case "fast": {
        const day = this.state.fastMinutes * 60000;
        return (((this.anchorHour + ((now.getTime() - this.anchorMs) / day) * 24) % 24) + 24) % 24;
      }
      default:
        return localHour(now);
    }
  }

  doy(now: Date = new Date()): number {
    return dayOfYear(now);
  }
}
