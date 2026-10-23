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

/** The foot's pads (door, altar, wisp post) and one pad per crown limb of the world tree: `place:<id>`. */
/** The place ids of the two limbs that carry the altar (the porch) and the wisp's perch. */
export const PORCH = "porch";
export const WISP = "wisp";

export type PadId = "door" | "altar" | "wisp" | `place:${string}`;

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
  /** Scale of everything built at the foot, from the trunk's radius (the world tree is giant: 1 = the old 18 px stump). */
  k: number;
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
  /** The lantern post at the foot (only when the wisp has no branch of its own: hub mode, or a layout without places): base on the ground and top. */
  post: { base: V3; top: V3 } | null;
  /** Where the wisp rests: above the tip of its own branch (`place:wisp`) or above the post. */
  perch: V3;
  /** The porch (`place:porch`): the nest at its tip (where you spawn and the altar is), and the branches that carry the porch and the wisp's perch. */
  nest: V3 | null;
  porch: string | null;
  wispBranch: string | null;
  /** Where the animal starts / arrives (see `arrival`). */
  start: { branch: string; s: number; th: number };
  pads: Pad[];
  stones: Stone[];
}

const TAU = Math.PI * 2;
/** Height on the stump (arc length from its foot) where the door and the altar are, and the interaction radii (all x the foot scale `k`, see `footScale`). */
export const FOOT_S = 46;
export const DOOR_RADIUS = 60;
export const ALTAR_RADIUS = 60;
export const WISP_RADIUS = 110;
/** Interaction radius of a crown pad. */
export const PLACE_RADIUS = 110;

/** How much bigger than the old 18 px stump the foot of the trunk is: 1 .. 4.5. */
export const footScale = (R: number): number => Math.min(4.5, Math.max(1, R / 40));

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
export function shrineOf(world: World, stumpId: string, titles?: ReadonlyMap<string, string>): Shrine | null {
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

  const k = footScale(R);
  const footS = Math.min(FOOT_S * Math.sqrt(k), Math.max(8, stump.total * 0.3));
  const f = frameAt(stump, footS);
  const doorTh = thetaOf(f, dir(doorAz));
  const altarTh = thetaOf(f, dir(altarAz));
  const doorPos = surfacePoint(stump, footS, doorTh, 6).p;
  const altarPos = surfacePoint(stump, footS, altarTh, 6).p;

  const kp = Math.sqrt(k);
  const postR = R + 52 * kp;
  const wd = dir(wispAz);
  const base: V3 = { x: centre.x + wd.x * postR, y: groundY, z: centre.z + wd.z * postR };
  const top: V3 = { x: base.x, y: groundY + 92 * kp, z: base.z };
  const perch: V3 = { x: base.x, y: top.y + 26 * kp, z: base.z };

  // the porch (the nest where you start, with the altar) and the wisp's branch, when the layout has them; else the old foot versions
  const porchB = [...world.branches.values()].find((b) => b.place === PORCH && !b.silk) ?? null;
  const wispB = [...world.branches.values()].find((b) => b.place === WISP && !b.silk) ?? null;
  const tipOf = (b: { total: number } & Parameters<typeof frameAt>[0], at: number): { s: number; th: number; p: V3 } => {
    const s = b.total * at;
    const th = topTheta(b, s);
    return { s, th, p: surfacePoint(b as never, s, th, 0).p };
  };
  const porchTip = porchB ? tipOf(porchB, 0.84) : null;
  const wispTip = wispB ? tipOf(wispB, 0.95) : null;
  const nest: V3 | null = porchTip ? { x: porchTip.p.x, y: porchTip.p.y + 4, z: porchTip.p.z } : null;
  const perch2: V3 = wispTip ? { x: wispTip.p.x, y: wispTip.p.y + 50 * kp, z: wispTip.p.z } : perch;
  const start = porchB && porchTip ? { branch: porchB.id, s: porchTip.s, th: porchTip.th } : { branch: stumpId, s: footS, th: doorTh };

  const pads: Pad[] = [
    { id: "door", label: "walk through the door into the library", pos: doorPos, radius: DOOR_RADIUS * kp },
    { id: "altar", label: "open the shrine", pos: nest ?? altarPos, radius: nest ? ALTAR_RADIUS * 1.5 : ALTAR_RADIUS * kp },
    { id: "wisp", label: "ask the wisp (search)", pos: perch2, radius: wispTip ? WISP_RADIUS * 1.2 : WISP_RADIUS * kp },
  ];
  // every other place limb (a point of interest, a game mode, a tool) has a pad at its tip, reached by climbing the world tree
  for (const b of world.branches.values()) {
    if (!b.place || b.silk || b === porchB || b === wispB) continue;
    const th = topTheta(b, b.total * 0.9);
    pads.push({ id: `place:${b.place}`, label: titles?.get(b.id) ?? b.place, pos: surfacePoint(b, b.total * 0.9, th, 8).p, radius: PLACE_RADIUS });
  }

  // standing stones in the free stretches of a ring round the stump (deterministic: a fixed count, jittered by index)
  const ringR = R + 40 * kp;
  const blocked = [...roots, doorAz, wispAz, altarAz];
  const stones: Stone[] = [];
  const N = Math.min(24, Math.round(11 * Math.sqrt(k)));
  for (let i = 0; i < N; i++) {
    const az = (i / N) * TAU + 0.31;
    if (blocked.some((b) => Math.abs(angDiff(az, b)) < 0.26)) continue;
    const j = Math.sin(i * 12.9898 + 4.1) * 0.5 + 0.5;
    const rr = ringR + (j - 0.5) * 16 * kp;
    stones.push({ x: centre.x + Math.cos(az) * rr, z: centre.z + Math.sin(az) * rr, w: (9 + j * 8) * kp, h: (14 + (1 - j) * 18) * kp, rot: az + j });
  }

  return {
    k, stump: stumpId, centre, groundY, stumpR: R, doorAz, wispAz, altarAz, doorTh, altarTh, footS,
    post: wispB ? null : { base, top }, perch: perch2, nest, porch: porchB?.id ?? null, wispBranch: wispB?.id ?? null, start, pads, stones,
  };
}

/** The angle round a branch at arc length s where its surface faces most nearly up in the world. */
function topTheta(b: { total: number } & Parameters<typeof frameAt>[0], s: number): number {
  const f = frameAt(b, s);
  return Math.atan2(f.b.y, f.u.y);
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

/** Where to put the animal when it arrives (a boot, or coming back out of the library): on the porch's nest, else at the door at the trunk's foot. */
export function arrival(shrine: Shrine): { branch: string; s: number; th: number } {
  return { ...shrine.start };
}

/** Where an animal stands to use a pad (tests and tools): the door at the foot, the altar in the nest, the wisp at its branch's tip. */
export function padStand(world: World, shrine: Shrine, id: PadId): { branch: string; s: number; th: number } {
  if (id === "door") return { branch: shrine.stump, s: shrine.footS, th: shrine.doorTh };
  if (id === "altar") return shrine.porch ? { ...shrine.start } : { branch: shrine.stump, s: shrine.footS, th: shrine.altarTh };
  if (id === "wisp" && shrine.wispBranch) {
    const b = world.branches.get(shrine.wispBranch);
    if (b) return { branch: b.id, s: b.total * 0.95, th: topTheta(b, b.total * 0.95) };
  }
  if (id === "wisp") {
    const b = world.branches.get(shrine.stump)!;
    return { branch: shrine.stump, s: shrine.footS, th: thetaOf(frameAt(b, shrine.footS), dir(shrine.wispAz)) };
  }
  const place = id.slice(6);
  const b = [...world.branches.values()].find((x) => x.place === place);
  return b ? { branch: b.id, s: b.total * 0.9, th: topTheta(b, b.total * 0.9) } : { ...shrine.start };
}
