/**
 * tree/world3.ts — the Yggdrasil world: branches are 3D rails with a round
 * cross-section. PURE math (no three.js, no DOM), unit-tested.
 *
 * A surface point is (branch, s, th): `s` = arc length along the centreline,
 * `th` = angle around it with th=0 = "top" (the frame's U axis), ±π/2 = the
 * sides, ±π = underneath. Position = centre(s) + r·(U·cosθ + B·sinθ) where
 * (T, U, B) is a rotation-minimising frame along the branch: U starts as
 * world-up projected off the tangent and is parallel-transported, so "top"
 * stays on top for ordinary (non-vertical) branches.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const dist = (a: V3, b: V3): number => len(sub(a, b));

export interface Branch {
  id: string;
  pts: V3[];
  /** Radius at the start of the branch (s = 0). */
  r: number;
  /** Radius at the end (s = total): branches thin out along their length. Equal to `r` = no taper. */
  rEnd: number;
  /** Tree species key (src/tree/species.ts) — bark look and growth style; undefined = default. Set by the layout, read by the renderer. */
  species?: string;
  /** A spider-silk thread (src/tree/silk.ts): thin, climbable, runtime-only (not part of the vault layout). */
  silk?: boolean;
  /**
   * A ground root (forest layout): an ordinary rail that runs along the ground from the central stump (it is a SIDE branch of the
   * stump, `attachS` = its height there) to a tree's base, where it sweeps up and the trunk continues from its END (`next`).
   * `r` = radius at the stump, `rEnd` = the trunk's start radius (so it WIDENS towards the tree). No leaves, not an editable folder.
   * Only cosmetics / bookkeeping may look at it; the sim treats it like any branch.
   */
  root?: boolean;
  /** Silk bridge: walking off this branch's END continues on `b` at arc length `s` (the thread's far end is attached there). */
  endLink?: { b: string; s: number };
  /** Children that continue from this branch's END point. */
  next: string[];
  /** Side branches that leave this branch somewhere along its length (see `attachS` of the child). */
  side: string[];
  /** For a side branch: arc length on the PARENT where it starts (undefined = continues from the parent's end). */
  attachS?: number;
  parent: string | null;
  cum: number[];
  total: number;
  /** Frame per point: tangent and "top" axis (B = T × U is derived). */
  T: V3[];
  U: V3[];
}

export interface World {
  branches: Map<string, Branch>;
  /** World-space height of the ground (y). Falling creatures that reach it are put back on the tree; the renderer draws it. */
  groundY?: number;
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  else if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

export function makeBranch(id: string, pts: V3[], r: number, parent: string | null = null, attachS?: number, rEnd: number = r): Branch {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const T = pts.map((_, i) => norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])));
  // rotation-minimising "top" axis
  const up = v3(0, 1, 0);
  const proj = (u: V3, t: V3): V3 => sub(u, mul(t, dot(u, t)));
  let u0 = proj(up, T[0]);
  if (len(u0) < 0.25) u0 = proj(v3(0, 0, 1), T[0]); // (near-)vertical branch: "top" faces +z
  const U: V3[] = [norm(u0)];
  for (let i = 1; i < pts.length; i++) {
    const p = proj(U[i - 1], T[i]);
    U.push(len(p) < 1e-6 ? U[i - 1] : norm(p));
  }
  return { id, pts, r, rEnd, next: [], side: [], attachS, parent, cum, total: cum[cum.length - 1], T, U };
}

/**
 * True for a twig that ends in a free, pointed tip: nothing continues from its end, no sub-folder branch leaves its side
 * (silk threads don't count), and it is not a ground root or the root stump. Layout gives these `rEnd` ~ 0.07-0.15 x `r`
 * (>= 1.2 px), the renderers cap them with a point.
 */
export function isTerminal(w: World, b: Branch): boolean {
  if (b.root || b.silk || b.parent === null || b.next.length > 0) return false;
  return !b.side.some((id) => !w.branches.get(id)?.silk);
}

export function addBranch(w: World, b: Branch): void {
  w.branches.set(b.id, b);
  const parent = b.parent ? w.branches.get(b.parent) : undefined;
  if (parent) (b.attachS === undefined ? parent.next : parent.side).push(b.id);
}

export interface Frame {
  p: V3;
  t: V3;
  u: V3;
  b: V3;
}

/** Centre point + frame at arc length s (clamped). */
export function frameAt(br: Branch, s: number): Frame {
  const ss = Math.min(br.total, Math.max(0, s));
  let i = 1;
  while (i < br.cum.length - 1 && br.cum[i] < ss) i++;
  const seg = br.cum[i] - br.cum[i - 1] || 1;
  const k = (ss - br.cum[i - 1]) / seg;
  const t = norm(lerp3(br.T[i - 1], br.T[i], k));
  let u = lerp3(br.U[i - 1], br.U[i], k);
  u = norm(sub(u, mul(t, dot(u, t)))); // re-orthonormalise
  return { p: lerp3(br.pts[i - 1], br.pts[i], k), t, u, b: cross(t, u) };
}

/** Outward unit normal for angle th at a frame. */
export function normalAt(f: Frame, th: number): V3 {
  return add(mul(f.u, Math.cos(th)), mul(f.b, Math.sin(th)));
}

export interface SurfacePoint {
  p: V3;
  n: V3;
  f: Frame;
}

/** Radius of the branch at arc length s (linear taper from `r` to `rEnd`). */
export function radiusAt(br: Branch, s: number): number {
  if (br.rEnd === br.r || br.total <= 0) return br.r;
  const k = Math.min(1, Math.max(0, s / br.total));
  return br.r + (br.rEnd - br.r) * k;
}

/** Surface (branch, s, th) → world position + outward normal (+ optional lift along the normal). */
export function surfacePoint(br: Branch, s: number, th: number, lift = 0): SurfacePoint {
  const f = frameAt(br, s);
  const n = normalAt(f, th);
  return { p: add(f.p, mul(n, radiusAt(br, s) + lift)), n, f };
}

/** Angle th (relative to a frame) of a world-space offset from the centreline. */
export function thetaOf(f: Frame, offset: V3): number {
  return Math.atan2(dot(offset, f.b), dot(offset, f.u));
}

export interface Nearest {
  s: number;
  dist: number;
}

/** Closest centreline point of `b` to the world point p. */
export function nearestOnBranch(b: Branch, p: V3): Nearest {
  let best: Nearest = { s: 0, dist: Infinity };
  for (let i = 1; i < b.pts.length; i++) {
    const a = b.pts[i - 1];
    const v = sub(b.pts[i], a);
    const l2 = dot(v, v) || 1;
    const t = Math.min(1, Math.max(0, dot(sub(p, a), v) / l2));
    const d = dist(p, add(a, mul(v, t)));
    if (d < best.dist) best = { s: b.cum[i - 1] + t * Math.sqrt(l2), dist: d };
  }
  return best;
}

/** Smooth centreline from control points (Catmull-Rom, sampled every ~step). */
export function smoothPath(ctrl: V3[], step = 24): V3[] {
  const out: V3[] = [];
  const P = (i: number): V3 => ctrl[Math.min(ctrl.length - 1, Math.max(0, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** Demo tree for the prototype page: a horizontal log that forks, with twigs to leap between — now really 3D. */
export function makeDemoWorld(): World {
  const w: World = { branches: new Map(), groundY: -900 };
  const P = (x: number, y: number, z: number): V3 => v3(x, y, z);
  addBranch(w, makeBranch("trunk", smoothPath([P(0, 0, 0), P(500, 25, 60), P(1000, -20, 160), P(1500, 30, 90), P(2000, 0, 0)]), 62));
  addBranch(w, makeBranch("up", smoothPath([P(2000, 0, 0), P(2300, 170, -80), P(2600, 290, -250), P(3000, 340, -330), P(3400, 300, -420)]), 44, "trunk"));
  addBranch(w, makeBranch("down", smoothPath([P(2000, 0, 0), P(2300, -110, 120), P(2650, -230, 260), P(3050, -250, 380), P(3400, -210, 470)]), 38, "trunk"));
  addBranch(w, makeBranch("twigA", smoothPath([P(700, 230, -20), P(900, 270, -90), P(1150, 220, -40), P(1350, 250, -120)]), 26));
  addBranch(w, makeBranch("twigB", smoothPath([P(1200, -230, 160), P(1450, -270, 200), P(1700, -240, 120), P(1900, -290, 170)]), 28));
  // a vertical branch rising from the trunk: "scale the trunk"
  addBranch(w, makeBranch("climb", smoothPath([P(1000, -20, 160), P(1010, 200, 170), P(990, 420, 150), P(1020, 650, 180), P(1000, 900, 160)]), 40, "trunk", 1010));
  return w;
}
