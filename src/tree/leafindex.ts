/**
 * tree/leafindex.ts — leaf positions computed ONCE per world, so "which leaf is next to the animal" is a flat loop over
 * numbers instead of `surfacePoint` (a frame lookup + allocations) for every leaf, every frame (PURE, unit-tested in
 * tools/unit-perf.mjs). Leaf positions do not depend on the leaf's size, so the index only needs a rebuild when the world
 * (or the leaf list) is replaced.
 */

import { surfacePoint, type World } from "./world3";
import type { Leaf } from "./layout";

export interface LeafIndex {
  /** Leaves with a branch that exists in the world, in the order given. */
  leaves: Leaf[];
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

/** `offset` is the extra distance off the bark the leaf hangs at (the scene passes `VOX * 3`). */
export function buildLeafIndex(world: World, leaves: readonly Leaf[], offset: number): LeafIndex {
  const kept: Leaf[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  for (const leaf of leaves) {
    const b = world.branches.get(leaf.branchId);
    if (!b) continue;
    const p = surfacePoint(b, leaf.s, leaf.th, offset).p;
    if (!Number.isFinite(p.x + p.y + p.z)) continue;
    kept.push(leaf);
    x.push(p.x);
    y.push(p.y);
    z.push(p.z);
  }
  return { leaves: kept, x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z) };
}

/** The leaf nearest to (px, py, pz) within `maxDist`, or null. Ties go to the earlier leaf. */
export function nearestLeafTo(idx: LeafIndex, px: number, py: number, pz: number, maxDist: number): Leaf | null {
  let best = -1;
  let bd = maxDist * maxDist;
  const n = idx.leaves.length;
  for (let i = 0; i < n; i++) {
    const dx = idx.x[i] - px;
    const dy = idx.y[i] - py;
    const dz = idx.z[i] - pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best >= 0 ? idx.leaves[best] : null;
}
