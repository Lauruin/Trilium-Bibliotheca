/**
 * tree/shrine.ts — the SHRINE at the heart of the forest (pure geometry + interaction pads; look in shrinemodel.ts).
 *
 * The root note's stump is the centrepiece. Around its base the layout places (all deterministic, all derived from the world):
 *   - a **door** set into the stump's foot, in the widest gap between ground roots (E there walks into the library),
 *   - the **altar** on the opposite side of the foot: E opens the shrine panel (save, clock, unlocks, tutorial ... as they arrive),
 *   - a **lantern post** in the next-widest gap carrying the search WISP (E near it, or a click on it, opens the search),
 *   - a ring of low standing stones in the remaining gaps.
 * A pad is just a point with a radius: you are "at" it when your head is within that distance, and the nearest pad (by fraction of
 * its radius) answers to E. The pads sit on the stump's surface, so an animal that walks down the stump to its foot (or comes up a
 * ground root onto it) is always in range of some pad, and the roots keep their star shape around it.
 * Hub mode (no ground roots) uses fixed azimuths. Nothing here touches the simulation.
 */

import { frameAt, radiusAt, surfacePoint, thetaOf, type V3, type World } from "./world3";

export type PadId = "door" | "altar" | "wisp";

export interface Pad {
  id: PadId;
  /** Shown in the HUD hint after "E". */
  label: string;
  pos: V3;
  /** Interaction distance, px. */
  radius: number;
}

export interface Stone {
  x: number;
  z: number;
  /** Half width / height, px. */
  w: number;
  h: number;
  rot: number;
}

export interface Shrine {
  /** The stump's branch id (the root note). */
  stump: string;
  /** The stump's axis on the ground. */
  centre: V3;
  groundY: number;
  stumpR: number;
  /** Azimuths (atan2(z, x)) of the door, the lantern post and the altar. */
  doorAz: number;
  wispAz: number;
  altarAz: number;
  /** Surface angle (`th` on the stump) and height (`s`) of the door and the altar: where a visitor stands. */
  doorTh: number;
  altarTh: number;
  footS: number;
  /** The lantern post: base on the ground, top, and where the wisp rests above it. */
  post: { base: V3; top: V3 };
  perch: V3;
  pads: Pad[];
  stones: Stone[];
}

const TAU = Math.PI * 2;
/** Height on the stump (arc length from its foot) where the door and the altar are. */
export const FOOT_S = 46;
/** Interaction radii. */
export const DOOR_RADIUS = 60;
export const ALTAR_RADIUS = 60;
export const WISP_RADIUS = 110;

const angDiff = (a: number, b: number): number => {
  const d = (((a - b) % TAU) + TAU + Math.PI) % TAU - Math.PI;
  return d;
};
const dir = (az: number): V3 => ({ x: Math.cos(az), y: 0, z: Math.sin(az) });
const dist3 = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The azimuths (around the stump) in which a ground root leaves it. */
export function rootAzimuths(world: World, stumpId: string): number[] {
  const stump = world.branches.get(stumpId);
  if (!stump) return [];
  const c = stump.pts[0];
  const R = stump.r;
  const out: number[] = [];
  for (const id of stump.side) {
    const b = world.branches.get(id);
    if (!b || !b.root) continue;
    // first point of the root that is clearly outside the stump
    const p = b.pts.find((q) => Math.hypot(q.x - c.x, q.z - c.z) > R + 25) ?? b.pts[b.pts.length - 1];
    if (Math.hypot(p.x - c.x, p.z - c.z) > 1e-6) out.push(Math.atan2(p.z - c.z, p.x - c.x));
  }
  return out;
}

/** The gaps between the sorted azimuths, widest first: `{mid, width}` (a single azimuth leaves one 2π gap). */
export function azimuthGaps(azs: readonly number[]): Array<{ mid: number; width: number }> {
  if (azs.length === 0) return [];
  const a = [...azs].map((x) => ((x % TAU) + TAU) % TAU).sort((p, q) => p - q);
  const gaps: Array<{ mid: number; width: number }> = [];
  for (let i = 0; i < a.length; i++) {
    const from = a[i];
    const to = i + 1 < a.length ? a[i + 1] : a[0] + TAU;
    gaps.push({ mid: from + (to - from) / 2, width: to - from });
  }
  return gaps.sort((p, q) => q.width - p.width || p.mid - q.mid);
}

/** Build the shrine of a world (null when the stump is missing). */
export function shrineOf(world: World, stumpId: string): Shrine | null {
  const stump = world.branches.get(stumpId);
  if (!stump || stump.pts.length < 2) return null;
  const groundY = world.groundY ?? stump.pts[0].y;
  const R = Math.max(stump.r, radiusAt(stump, 0));
  const centre: V3 = { x: stump.pts[0].x, y: groundY, z: stump.pts[0].z };
  const roots = rootAzimuths(world, stumpId);
  const gaps = azimuthGaps(roots);
  const doorAz = gaps.length > 0 ? gaps[0].mid : 0;
  const wispAz = gaps.length > 1 ? gaps[1].mid : doorAz + Math.PI * 0.62;
  const altarAz = gaps.length > 2 ? gaps[2].mid : doorAz + Math.PI;

  const footS = Math.min(FOOT_S, Math.max(8, stump.total * 0.3));
  const f = frameAt(stump, footS);
  const doorTh = thetaOf(f, dir(doorAz));
  const altarTh = thetaOf(f, dir(altarAz));
  const doorPos = surfacePoint(stump, footS, doorTh, 6).p;
  const altarPos = surfacePoint(stump, footS, altarTh, 6).p;

  const postR = R + 52;
  const wd = dir(wispAz);
  const base: V3 = { x: centre.x + wd.x * postR, y: groundY, z: centre.z + wd.z * postR };
  const top: V3 = { x: base.x, y: groundY + 92, z: base.z };
  const perch: V3 = { x: base.x, y: top.y + 26, z: base.z };

  const pads: Pad[] = [
    { id: "door", label: "walk through the door into the library", pos: doorPos, radius: DOOR_RADIUS },
    { id: "altar", label: "open the shrine", pos: altarPos, radius: ALTAR_RADIUS },
    { id: "wisp", label: "ask the wisp (search)", pos: perch, radius: WISP_RADIUS },
  ];

  // standing stones in the free stretches of a ring round the stump (deterministic: a fixed count, jittered by index)
  const ringR = R + 40;
  const blocked = [...roots, doorAz, wispAz, altarAz];
  const stones: Stone[] = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const az = (i / N) * TAU + 0.31;
    if (blocked.some((b) => Math.abs(angDiff(az, b)) < 0.26)) continue;
    const j = Math.sin(i * 12.9898 + 4.1) * 0.5 + 0.5;
    const rr = ringR + (j - 0.5) * 16;
    stones.push({ x: centre.x + Math.cos(az) * rr, z: centre.z + Math.sin(az) * rr, w: 9 + j * 8, h: 14 + (1 - j) * 18, rot: az + j });
  }

  return { stump: stumpId, centre, groundY, stumpR: R, doorAz, wispAz, altarAz, doorTh, altarTh, footS, post: { base, top }, perch, pads, stones };
}

/** The pad a visitor at `p` can use (nearest by fraction of its radius, within it), else null. */
export function padNear(shrine: Shrine | null, p: V3): Pad | null {
  if (!shrine) return null;
  let best: Pad | null = null;
  let bestK = 1;
  for (const pad of shrine.pads) {
    const k = dist3(p, pad.pos) / pad.radius;
    if (k <= bestK) {
      best = pad;
      bestK = k;
    }
  }
  return best;
}

/** Where to put the animal when it arrives at the shrine (a boot, or coming back out of the library): the stump's foot at the door. */
export function arrival(shrine: Shrine): { branch: string; s: number; th: number } {
  return { branch: shrine.stump, s: shrine.footS, th: shrine.doorTh };
}
