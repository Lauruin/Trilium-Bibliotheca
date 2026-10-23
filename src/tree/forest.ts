/**
 * tree/forest.ts — the geometry of the FOREST layout (pure, no three.js / DOM): where the trees stand, and the ground roots
 * that join each trunk's foot to the central stump. layout.ts grows every tree around its own origin first, measures its
 * `crownOf`, lets `placeTrees` pick spread-out positions, moves it there and lays a `rootPath` to the stump.
 */

import { add, mul, norm, radiusAt, v3, type Branch, type V3 } from "./world3";

/** A circle on the ground plane (x, z). */
export interface Disc {
  x: number;
  z: number;
  r: number;
}

/** The footprint of one tree around its trunk's foot (0, 0): merged discs of every branch point (+ margin for leaves / foliage). */
export interface Crown {
  discs: Disc[];
  /** max over the discs of (distance from the foot + radius): outside this circle the tree is never. */
  bound: number;
}

/** Cell size of the footprint merge, px; a kept disc grows by half a cell so it still covers the points it absorbed. */
const CELL = 40;
/** How far past a branch the footprint reaches (leaves, foliage). */
export const CROWN_MARGIN = 50;

/** Footprint of the branches (already around the foot at the origin). Never empty for a non-empty input. */
export function crownOf(branches: readonly Branch[], margin = CROWN_MARGIN): Crown {
  const cells = new Map<string, Disc>();
  for (const b of branches) {
    for (let i = 0; i < b.pts.length; i++) {
      const p = b.pts[i];
      const r = radiusAt(b, b.cum[i]) + margin + CELL / 2;
      const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
      const hit = cells.get(key);
      if (!hit || hit.r < r) cells.set(key, { x: p.x, z: p.z, r });
    }
  }
  const discs = [...cells.values()];
  let bound = 0;
  for (const d of discs) bound = Math.max(bound, Math.hypot(d.x, d.z) + d.r);
  return { discs, bound };
}

/** One tree to place: a preferred azimuth (radians; 0 = +z, pi/2 = +x), its crown and its trunk's foot radius. */
export interface TreeSlot {
  az: number;
  crown: Crown;
  footR: number;
}

/** Two trees' footprints may overlap by this much (the margins already add ~100 px of clearance). */
const OVERLAP = 60;
/** Trunk feet at least this many (radius sums = diameters) apart, as in the hub layout. */
const FOOT_GAP = 3;
/** Free ground kept around the stump beyond its radius. */
const STUMP_CLEAR = 70;
/** Free ground kept beside a root. */
const ROOT_CLEAR = 40;

const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
};

/**
 * Positions (the trunk feet) for the trees, in order: tree i is pushed outwards along its azimuth from the stump until its
 * footprint clears the stump, every tree placed before it and every earlier root (and its own root clears their trunks).
 * Deterministic, O(n^2) with cheap bounding tests. Returns one position per slot.
 */
export function placeTrees(slots: readonly TreeSlot[], stumpR: number): Array<{ x: number; z: number }> {
  const dm0 = (x: number, z: number): number => Math.hypot(x, z);
  const out: Array<{ x: number; z: number; r: number }> = [];
  /** Azimuth offsets tried (radians) at every distance: the preferred one first, then alternately either side (a root line may block one). */
  const OFFSETS = [0, 0.1, -0.1, 0.2, -0.2, 0.35, -0.35, 0.5, -0.5];
  slots.forEach((s, i) => {
    const d0 = Math.max(250, stumpR + 2.2 * s.footR + 120);
    const fits = (x: number, z: number): boolean => {
      const dm = Math.hypot(x, z);
      for (const a of s.crown.discs) if (Math.hypot(x + a.x, z + a.z) < a.r + stumpR + STUMP_CLEAR) return false; // the stump
      for (let j = 0; j < i; j++) {
        const o = slots[j];
        // the two roots must not run through each other's trunk feet (cheap angular gate first: most pairs are far apart)
        const c1 = s.footR + o.footR * 0.6 + ROOT_CLEAR + 20;
        const c2 = o.footR + s.footR * 0.6 + ROOT_CLEAR + 20;
        const dj = out[j].r;
        const cos = (x * out[j].x + z * out[j].z) / (dm * dj || 1);
        if (cos <= 0 || Math.sqrt(Math.max(0, 1 - cos * cos)) * Math.max(dm, dj) > Math.max(c1, c2)) continue; // (> 90 degrees apart: the origin is the closest point, and d0 clears it)
        if (segDist(out[j].x, out[j].z, 0, 0, x, z) < c1) return false;
        if (segDist(x, z, 0, 0, out[j].x, out[j].z) < c2) return false;
      }
      for (let j = 0; j < i; j++) {
        const o = slots[j];
        const px = out[j].x;
        const pz = out[j].z;
        if (Math.hypot(x - px, z - pz) < FOOT_GAP * (s.footR + o.footR)) return false; // trunks >= 3 trunk diameters apart
        if (Math.hypot(x - px, z - pz) >= s.crown.bound + o.crown.bound) continue;
        for (const a of s.crown.discs) {
          if (Math.hypot(x + a.x - px, z + a.z - pz) >= a.r + o.crown.bound) continue; // this disc is clear of the whole other tree
          for (const b of o.crown.discs) if (Math.hypot(x + a.x - px - b.x, z + a.z - pz - b.z) < a.r + b.r - OVERLAP) return false;
        }
      }
      return true;
    };
    let d = d0;
    let spot: { x: number; z: number; r: number } | null = null;
    for (let iter = 0; iter < 3000 && !spot; iter++) {
      for (const off of OFFSETS) {
        const x = Math.sin(s.az + off) * d;
        const z = Math.cos(s.az + off) * d;
        if (fits(x, z)) {
          spot = { x, z, r: dm0(x, z) };
          break;
        }
      }
      d += Math.min(400, Math.max(20, d * 0.04));
    }
    out.push(spot ?? { x: Math.sin(s.az) * d, z: Math.cos(s.az) * d, r: d }); // (never in practice: 3000 steps reach far past any forest)
  });
  return out.map((p) => ({ x: p.x, z: p.z }));
}

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));

/** Ground-root parameters. */
const GROUND_K = 0.45; // centre height = this x the local radius (the root is part-sunk, you walk on its top)

/**
 * The centreline of the ground root of one tree: from the stump's axis (the SIDE branch's start, a little above the ground,
 * dipping onto it) along the ground to the tree's foot `F` (x, z), where it sweeps up and ends at `foot` (the trunk's start
 * point) with the trunk's own direction `d0`, so the trunk continues without a kink. `rEnd` = the trunk's start radius,
 * `rs0` = the root's radius at the stump. Slight deterministic undulation (`seed` in [0, 1)) and sideways wander.
 * `startR` > 0 trims the part inside a fat trunk (see below). Returns the points and `c0` = the height of the first point (the root's `attachS` on the stump).
 */
export function rootPath(F: { x: number; z: number }, foot: V3, d0: V3, rs0: number, rEnd: number, seed: number, startR = 0): { pts: V3[]; c0: number } {
  const L = Math.hypot(F.x, F.z) || 1;
  const h = v3(F.x / L, 0, F.z / L);
  const side = v3(-h.z, 0, h.x);
  const R = rEnd;
  const radAt = (u: number): number => rs0 + (R - rs0) * Math.min(1, u / L);
  const cg = (u: number): number => GROUND_K * radAt(u);
  // arc: sweeps from the ground (A0) up to the trunk's foot
  const cEnd = cg(L);
  const rhoV = Math.max(foot.y - cEnd, 2);
  const rhoH = 1.15 * rhoV;
  const U0 = Math.max(L - rhoH, 10);
  const D = Math.min(0.5 * U0, 3.5 * rs0 + 20); // the dip from the stump collar onto the ground
  const dip = 0.6 * rs0;
  const smooth = (x: number): number => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };
  const phi = seed * 6.2831853;
  const phi2 = ((seed * 7.77) % 1) * 6.2831853;
  const latA = Math.min(60, 0.045 * U0);
  const bumpWave = 260 + 90 * ((seed * 3.3) % 1);
  const y = (u: number): number => {
    const k = Math.max(0, 1 - u / D);
    const bump = 0.2 * radAt(u) * Math.sin((6.2831853 * u) / bumpWave + phi) * smooth(u / (1.5 * D)) * smooth((U0 - u) / (0.3 * U0));
    return cg(u) + dip * k * k + bump;
  };
  const lat = (u: number): number => latA * Math.sin((6.2831853 * u) / (U0 / 1.4) + phi2) * smooth(u / (0.3 * U0)) * smooth((U0 - u) / (0.3 * U0));
  const pts: V3[] = [];
  const n = clampInt(Math.ceil(U0 / 20), 2, 600);
  for (let i = 0; i < n; i++) {
    const u = (U0 * i) / n;
    pts.push(add(add(mul(h, u), mul(side, lat(u))), v3(0, y(u), 0)));
  }
  const A0 = add(mul(h, U0), v3(0, y(U0), 0));
  const kk = 0.6 * Math.max(rhoH, rhoV);
  const P1 = add(A0, mul(h, kk));
  const P2 = add(foot, mul(norm(d0), -kk));
  const m = 14;
  for (let i = 0; i <= m; i++) {
    const t = i / m;
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const e = t ** 3;
    pts.push(v3(a * A0.x + b * P1.x + c * P2.x + e * foot.x, a * A0.y + b * P1.y + c * P2.y + e * foot.y, a * A0.z + b * P1.z + c * P2.z + e * foot.z));
  }
  // a fat central trunk (the world tree): the root starts on ITS SURFACE (`startR` from the axis), not inside it, so an animal walking in along the
  // root steps onto the trunk instead of walking through its wood until the axis
  if (startR > 0) {
    const k0 = pts.findIndex((p) => Math.hypot(p.x, p.z) >= startR);
    if (k0 > 0 && pts.length - k0 >= 3) {
      const a = pts[k0 - 1], b = pts[k0];
      const da = Math.hypot(a.x, a.z), db = Math.hypot(b.x, b.z);
      const t = db > da ? (startR - da) / (db - da) : 1;
      pts.splice(0, k0, v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
    }
  }
  return { pts, c0: pts[0].y };
}
