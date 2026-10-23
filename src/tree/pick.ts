/**
 * tree/pick.ts — what is under the mouse pointer? A ray (camera origin + direction through the pixel) against the branch tubes and
 * the leaves of a world (PURE: no three.js, no DOM, unit-tested in tools/unit-pilot.mjs).
 *
 * Branches are polylines with a radius that tapers along them; the ray is tested against every segment as a capsule (closest approach
 * of two lines), with a tolerance that grows with distance so thin twigs far away can still be hit (about 6 px on screen). The hit is
 * returned as a SURFACE position (branch, s, th) so it can be walked to. Silk threads are not pickable. Leaves are hit when the ray
 * passes close to their position (a leaf sits just off the bark); a leaf wins over the branch it hangs on.
 */

import { dot, frameAt, radiusAt, sub, thetaOf, type V3, type World } from "./world3";
import type { Leaf } from "./layout";
import type { LeafIndex } from "./leafindex";

export interface BranchHit {
  kind: "branch";
  b: string;
  /** Arc length along the branch and angle around it of the spot hit (where the ray enters the tube). */
  s: number;
  th: number;
  /** Distance along the ray to the hit. */
  t: number;
  p: V3;
}

export interface LeafHit {
  kind: "leaf";
  leaf: Leaf;
  t: number;
  p: V3;
}

export type Pick = BranchHit | LeafHit;

/** Relative pick tolerance: extra radius of (distance x this), i.e. ~6 px on an 800 px high view with a 42 degree lens. */
export const PICK_SLOP = 0.006;

/**
 * Closest approach of the ray `o + t d` (t >= 0, `d` unit) to the segment a..b: parameters (t along the ray, u in 0..1 along the
 * segment) and their distance. Exported for the tests.
 */
export function rayToSegment(o: V3, d: V3, a: V3, b: V3): { t: number; u: number; dist: number } {
  const e = sub(b, a);
  const w0 = sub(o, a);
  const bb = dot(d, e);
  const cc = dot(e, e);
  const dd = dot(d, w0);
  const ee = dot(e, w0);
  const denom = cc - bb * bb; // a = d.d = 1
  let u: number;
  if (denom < 1e-9 * Math.max(1, cc)) u = 0; // parallel: any point of the segment is as close; take the start
  else u = (ee - bb * dd) / denom;
  u = Math.min(1, Math.max(0, u));
  const t = Math.max(0, u * bb - dd);
  const px = o.x + d.x * t - (a.x + e.x * u);
  const py = o.y + d.y * t - (a.y + e.y * u);
  const pz = o.z + d.z * t - (a.z + e.z * u);
  return { t, u, dist: Math.hypot(px, py, pz) };
}

/** The nearest branch surface under the ray, or null. `d` must be a unit vector. */
export function pickBranch(world: World, o: V3, d: V3, slop = PICK_SLOP): BranchHit | null {
  let best: BranchHit | null = null;
  for (const b of world.branches.values()) {
    if (b.silk) continue;
    const n = b.pts.length;
    for (let i = 1; i < n; i++) {
      const a = b.pts[i - 1];
      const c = b.pts[i];
      const seg = rayToSegment(o, d, a, c);
      const segLen = b.cum[i] - b.cum[i - 1];
      const s = b.cum[i - 1] + seg.u * segLen;
      const r = radiusAt(b, s);
      const pad = Math.max(2, seg.t * slop);
      if (seg.dist > r + pad) continue;
      // where the ray enters the tube (the closest approach itself when it only grazes the padding)
      const tHit = Math.max(0, seg.t - Math.sqrt(Math.max(0, r * r - seg.dist * seg.dist)));
      if (best && tHit >= best.t) continue;
      const p = { x: o.x + d.x * tHit, y: o.y + d.y * tHit, z: o.z + d.z * tHit };
      const f = frameAt(b, s);
      best = { kind: "branch", b: b.id, s, th: thetaOf(f, sub(p, f.p)), t: tHit, p };
    }
  }
  return best;
}

/** The nearest leaf the ray passes close to, or null. A leaf's pick radius grows with its size (the note's length). */
export function pickLeaf(idx: LeafIndex, o: V3, d: V3, slop = PICK_SLOP): LeafHit | null {
  let best: LeafHit | null = null;
  const n = idx.leaves.length;
  for (let i = 0; i < n; i++) {
    const vx = idx.x[i] - o.x;
    const vy = idx.y[i] - o.y;
    const vz = idx.z[i] - o.z;
    const along = vx * d.x + vy * d.y + vz * d.z;
    if (along <= 0) continue;
    const px = vx - d.x * along;
    const py = vy - d.y * along;
    const pz = vz - d.z * along;
    const perp = Math.hypot(px, py, pz);
    const reach = 12 * Math.max(0.55, idx.leaves[i].size) + 4 + along * slop;
    if (perp > reach) continue;
    if (best && along >= best.t) continue;
    best = { kind: "leaf", leaf: idx.leaves[i], t: along, p: { x: idx.x[i], y: idx.y[i], z: idx.z[i] } };
  }
  return best;
}

/** What is under the ray: a leaf (they hang just off the bark and win over the branch they are on, within 30 px of it) or a branch. */
export function pickAt(world: World, leaves: LeafIndex | null, o: V3, d: V3): Pick | null {
  const br = pickBranch(world, o, d);
  const lf = leaves ? pickLeaf(leaves, o, d) : null;
  if (lf && (!br || lf.t <= br.t + 30)) return lf;
  return br;
}
