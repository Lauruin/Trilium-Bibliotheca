/**
 * tree/foliage.ts — canopy "fog" for the Yggdrasil view: translucent clusters around the thin / outer / terminal
 * branches that hide the wood from afar and thin out as the animal / the camera come near.
 *
 * Two halves in one file:
 *   PURE   — `FOLIAGE` (one style per species), `placeFoliage(world, leaves, opts)` -> `Cluster[]` (deterministic from the
 *            branch ids, bounded), `buildPuffs(clusters, look)` -> the shapes of one look (low-poly blobs / cones, voxel
 *            cubes on a grid), `visibility(...)` = the fade rule. No DOM, no randomness (integer hashes of ids).
 *   THREE  — `FoliageLayer`: one to three instanced meshes (low-poly: blobs + cones; voxel: cubes), a per-instance `aFade`
 *            attribute (alpha blending, no depth write, so there is no sorting and no z-fighting) that `update()` fills
 *            every frame from the fade rule (CPU: one loop over the clusters, smoothed in time).
 *
 * Rules of the look: the trunk and thick limbs stay clear (clusters follow `thin(radius)`); every branch END gets a
 * cluster (tips are not stumps); the note LEAVES stay readable (a cluster near a leaf is thinned: `leafK`) and the
 * animal is never hidden (clusters near it / near the camera / near the line camera -> animal fade out).
 * Roots (`Branch.root`), silk threads and ground-hugging branches get none.
 */

import * as THREE from "three";
import { SPECIES, hash01, type SpeciesKey } from "./species";
import { radiusAt, surfacePoint, type Branch, type World } from "./world3";
import { disposeGroup, type Look } from "./look";

// ---- styles ---------------------------------------------------------------------------------------

export type FoliageShape = "puff" | "leafy" | "tier" | "curtain" | "blossom" | "umbrella" | "tuft" | "wisp";

export interface FoliageStyle {
  shape: FoliageShape;
  /** Cluster radius multiplier. */
  size: number;
  /** Clusters along a thin branch per cluster-radius step (0 = branch ends only). */
  rate: number;
  /** Largest opacity of a cluster, 0..1. */
  alpha: number;
  /** Cluster centre raised over the wood, in radii (umbrella high, curtain low). */
  lift: number;
  /** Vertical stretch of the shapes. */
  tall: number;
  /** Shapes per cluster (low-poly); the voxel look turns every shape into a few cubes. */
  puffs: number;
  /** Colour jitter per cluster: hue (turns), saturation, lightness (relative). */
  jit: [number, number, number];
  /** Lightness of the canopy relative to the species' leaf colour (note leaves are the brighter ones, so they stand out). */
  shade: number;
  /** A second colour mixed into some shapes (cherry's white blossom, maple's orange). */
  accent?: { color: string; chance: number };
}

export const FOLIAGE: Record<SpeciesKey, FoliageStyle> = {
  oak: { shape: "puff", size: 1.15, rate: 1, alpha: 0.82, lift: 0.25, tall: 0.85, puffs: 6, jit: [0.012, 0.1, 0.07], shade: 0.86 },
  birch: { shape: "leafy", size: 0.8, rate: 1.5, alpha: 0.62, lift: 0.2, tall: 1.1, puffs: 8, jit: [0.02, 0.12, 0.1], shade: 0.95 },
  maple: { shape: "puff", size: 1, rate: 1.1, alpha: 0.8, lift: 0.22, tall: 0.9, puffs: 6, jit: [0.012, 0.1, 0.07], shade: 0.9, accent: { color: "#e08a2a", chance: 0.28 } },
  pine: { shape: "tier", size: 0.9, rate: 1.3, alpha: 0.86, lift: 0, tall: 1, puffs: 3, jit: [0.01, 0.08, 0.06], shade: 0.9 },
  willow: { shape: "curtain", size: 1, rate: 1.2, alpha: 0.64, lift: 0.1, tall: 1, puffs: 8, jit: [0.015, 0.1, 0.07], shade: 0.95 },
  cherry: { shape: "blossom", size: 1.1, rate: 1.2, alpha: 0.74, lift: 0.22, tall: 0.85, puffs: 7, jit: [0.012, 0.08, 0.05], shade: 0.97, accent: { color: "#fff1f6", chance: 0.3 } },
  acacia: { shape: "umbrella", size: 1.25, rate: 0.55, alpha: 0.82, lift: 0.5, tall: 0.3, puffs: 4, jit: [0.012, 0.1, 0.07], shade: 0.9 },
  baobab: { shape: "tuft", size: 0.7, rate: 0, alpha: 0.72, lift: 0.3, tall: 0.9, puffs: 3, jit: [0.012, 0.1, 0.07], shade: 0.9 },
  redwood: { shape: "tier", size: 0.78, rate: 1.4, alpha: 0.86, lift: 0, tall: 1.2, puffs: 3, jit: [0.01, 0.08, 0.06], shade: 0.85 },
  aspen: { shape: "leafy", size: 0.78, rate: 1.5, alpha: 0.58, lift: 0.2, tall: 1.2, puffs: 8, jit: [0.02, 0.1, 0.1], shade: 0.97 },
  ash: { shape: "puff", size: 1.05, rate: 1, alpha: 0.76, lift: 0.25, tall: 0.9, puffs: 5, jit: [0.012, 0.1, 0.07], shade: 0.95 },
  cypress: { shape: "tier", size: 0.55, rate: 1.5, alpha: 0.9, lift: 0, tall: 2.2, puffs: 3, jit: [0.008, 0.06, 0.05], shade: 0.9 },
  ghost: { shape: "wisp", size: 1, rate: 0.8, alpha: 0.38, lift: 0.3, tall: 1.6, puffs: 4, jit: [0.005, 0.05, 0.08], shade: 1.1 },
};

/** The style of a species key (unknown / undefined = maple's). */
export const styleOf = (species: string | undefined): FoliageStyle => (species && (FOLIAGE as Record<string, FoliageStyle | undefined>)[species]) || FOLIAGE.maple;

// ---- numbers & hashing ----------------------------------------------------------------------------

/** Default density multiplier, and its bounds (the panel slider). */
export const DENSITY = { min: 0.25, max: 1.5, def: 1 };
/** Hard caps: clusters (placement) and instances (expansion; whole clusters are dropped beyond it). */
export const MAX_CLUSTERS = 1600;
export const MAX_PUFFS = 20000;

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
export const clampDensity = (d: unknown): number => (typeof d === "number" && Number.isFinite(d) ? clamp(d, DENSITY.min, DENSITY.max) : DENSITY.def);

/** Integer hash of up to three numbers -> [0,1). */
function ih(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const seedOf = (id: string): number => Math.floor(hash01(id) * 4294967296) | 0;

type RGB = [number, number, number];

function parseHex(c: string): RGB {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(c.trim());
  if (!m) return [0.35, 0.6, 0.3];
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function rgb2hsl([r, g, b]: RGB): RGB {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hsl2rgb([h, s, l]: RGB): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    const x = ((t % 1) + 1) % 1;
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** `c` (sRGB) with hue/saturation/lightness moved by the three offsets (relative for s and l), clamped. */
function jitter(c: RGB, dh: number, ds: number, dl: number): RGB {
  const [h, s, l] = rgb2hsl(c);
  return hsl2rgb([h + dh, clamp(s * (1 + ds), 0, 1), clamp(l * (1 + dl), 0.03, 0.97)]);
}

// ---- placement ------------------------------------------------------------------------------------

/** One canopy cluster: a roundish region of fog around a bit of branch. */
export interface Cluster {
  /** The branch it hugs (the animal's branch and its neighbours are revealed more). */
  branch: string;
  x: number;
  y: number;
  z: number;
  /** Radius, world units. */
  r: number;
  /** A cluster at the END of a branch (the tip). */
  tip: boolean;
  /** Integer seed (from the branch id and the slot); every shape of the cluster derives from it. */
  seed: number;
  species: SpeciesKey;
  /** Unit horizontal direction the branch runs in (curtain rows, tier lean). */
  ax: number;
  az: number;
  /** 0.25..1: thinner where a note leaf sits inside the cluster, so the leaves stay readable. */
  leafK: number;
  /** Canopy colour, sRGB 0..1 (the species' leaf colour, shaded + jittered). */
  color: RGB;
}

/** Where the foliage stops covering thick wood: fully there below `FULL`, none above `NONE` (world units of radius). */
const THIN_FULL = 20;
const THIN_NONE = 44;
export const thin = (radius: number): number => 1 - smoothstep(THIN_FULL, THIN_NONE, radius);

/** Branches with no foliage: silk threads, ground roots (`root` flag, set by the forest layout) and ones lying on the ground. */
function bare(b: Branch, ground: number): boolean {
  if (b.silk || (b as Branch & { root?: boolean }).root || b.pts.length < 2 || !(b.total > 0)) return true;
  let top = -Infinity;
  for (const p of b.pts) top = Math.max(top, p.y);
  return top < ground + 60;
}

export interface PlaceOptions {
  density?: number;
}

type LeafPos = { branchId: string; s: number; th: number };

/**
 * Canopy clusters for a world, deterministic. Every branch end (a branch with no `next`) gets one, thin stretches of
 * branch get more along the way (`thin(radius)` x the species' `rate`), the thick wood none. Clusters inside the reach
 * of a note leaf are thinned (`leafK`). At most `MAX_CLUSTERS`: tips first, then by a per-cluster hash.
 */
export function placeFoliage(world: World, leaves: ReadonlyArray<LeafPos> = [], opts: PlaceOptions = {}): Cluster[] {
  const density = clampDensity(opts.density);
  const ground = world.groundY ?? -Infinity;
  const out: Cluster[] = [];
  for (const b of world.branches.values()) {
    if (bare(b, ground)) continue;
    const sp = (SPECIES as Record<string, { key: SpeciesKey } | undefined>)[b.species ?? ""];
    const key: SpeciesKey = sp ? sp.key : "maple";
    const st = styleOf(key);
    const base = parseHex(SPECIES[key].leaf.color);
    const bs = seedOf(b.id);
    const add = (s: number, slot: number, tip: boolean): void => {
      const R = radiusAt(b, s);
      const rad = clamp(st.size * (40 + 3.2 * R + 0.13 * b.total) * (tip ? 1.3 : 1), 38, 210);
      const sp3 = surfacePoint(b, s, 0, -R); // lift -R = the centreline point
      const t = sp3.f.t;
      const hl = Math.hypot(t.x, t.z) || 1;
      const seed = (bs ^ Math.imul(slot + 1, 0x9e3779b1)) | 0;
      // a little off the wood, mostly up; tips reach past the end so the point is swallowed
      const jx = (ih(seed, 1) - 0.5) * 0.5 * rad, jz = (ih(seed, 2) - 0.5) * 0.5 * rad;
      const along = tip ? 0.3 * rad : 0;
      let y = sp3.p.y + st.lift * rad * 0.6 + R * 0.4;
      y = Math.max(y, ground + rad * 0.45);
      const cc = jitter(
        jitter(base, 0, 0, st.shade - 1),
        (ih(seed, 3) - 0.5) * 2 * st.jit[0], (ih(seed, 4) - 0.5) * 2 * st.jit[1], (ih(seed, 5) - 0.5) * 2 * st.jit[2],
      );
      out.push({
        branch: b.id, x: sp3.p.x + jx + t.x * along, y, z: sp3.p.z + jz + t.z * along, r: rad, tip, seed, species: key,
        ax: t.x / hl, az: t.z / hl, leafK: 1, color: cc,
      });
    };
    // the end of the branch (unless it is a thick stub: a limb whose end carries nothing and is wider than a twig)
    if (b.next.length === 0 && b.rEnd < 40) add(b.total, 0, true);
    // thin stretches along the branch
    if (st.rate > 0) {
      const rad0 = st.size * (40 + 3.2 * radiusAt(b, b.total * 0.7) + 0.13 * b.total);
      const step = Math.max(60, (rad0 * 0.8) / (st.rate * density));
      let slot = 1;
      for (let s = b.total * 0.2 + step * 0.5 * ih(bs, 99); s < b.total - 0.25 * step; s += step, slot++) {
        if (ih(bs, slot, 7) < thin(radiusAt(b, s)) * Math.min(1, 0.55 + 0.45 * density)) add(s, slot, false);
      }
    }
  }
  clearLeaves(world, out, leaves);
  if (out.length > MAX_CLUSTERS) {
    // tips first, then the rest by hash; stable and deterministic
    const ranked = out.map((c, i) => ({ c, i, k: (c.tip ? 0 : 1) + ih(c.seed, 11) * 0.99 }));
    ranked.sort((a, b2) => a.k - b2.k || a.i - b2.i);
    return ranked.slice(0, MAX_CLUSTERS).sort((a, b2) => a.i - b2.i).map((x) => x.c);
  }
  return out;
}

/** Thin the clusters that contain a note leaf (position of the leaf's blade) so notes stay readable and findable. */
function clearLeaves(world: World, clusters: Cluster[], leaves: ReadonlyArray<LeafPos>): void {
  if (leaves.length === 0 || clusters.length === 0) return;
  const GRID = 200;
  const grid = new Map<number, number[]>();
  const key = (gx: number, gy: number, gz: number): number => ((gx + 512) * 1024 + (gy + 512)) * 1024 + (gz + 512);
  const pts: number[] = [];
  for (const l of leaves) {
    const b = world.branches.get(l.branchId);
    if (!b || !Number.isFinite(l.s) || !Number.isFinite(l.th)) continue;
    const p = surfacePoint(b, l.s, l.th, 34).p; // about the middle of the stalk + blade
    const i = pts.length / 3;
    pts.push(p.x, p.y, p.z);
    const k = key(Math.floor(p.x / GRID), Math.floor(p.y / GRID), Math.floor(p.z / GRID));
    const cell = grid.get(k);
    if (cell) cell.push(i);
    else grid.set(k, [i]);
  }
  for (const c of clusters) {
    const reach = c.r * 0.8 + 50;
    let k = 1;
    const n = Math.ceil(reach / GRID);
    const cx = Math.floor(c.x / GRID), cy = Math.floor(c.y / GRID), cz = Math.floor(c.z / GRID);
    for (let gx = cx - n; gx <= cx + n; gx++) for (let gy = cy - n; gy <= cy + n; gy++) for (let gz = cz - n; gz <= cz + n; gz++) {
      const cell = grid.get(key(gx, gy, gz));
      if (!cell) continue;
      for (const i of cell) {
        const d = Math.hypot(pts[i * 3] - c.x, pts[i * 3 + 1] - c.y, pts[i * 3 + 2] - c.z);
        k = Math.min(k, 0.25 + 0.75 * smoothstep(0.3 * reach, reach, d));
      }
    }
    c.leafK = k;
  }
}

// ---- shapes ---------------------------------------------------------------------------------------

/**
 * One drawable piece of a cluster. `blob`/`cone` are low-poly (unit sphere / unit cone: apex up, radius 1, FULL height 1),
 * `cube` is voxel.
 */
export interface Puff {
  x: number;
  y: number;
  z: number;
  /** Semi-axes (blob: all three; cone: radius x, FULL height y, radius z) or the edge (cube: all three). */
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  shape: "blob" | "cone" | "cube";
  /** sRGB. */
  color: RGB;
  /** This piece's own opacity factor, 0..1 (times the style alpha and the cluster's leafK/fade). */
  a: number;
  /** Index into the cluster list (the fade is per cluster). */
  cluster: number;
}

/** Voxel cube edges are 2-4 x this (this = 2 x the bark grid VOX = 7): the canopy is chunkier than the bark. */
const CELL = 14;

/** The pieces of one cluster (in world space). The voxel look reuses them as shapes to fill with cubes. */
export function clusterShapes(c: Cluster, ci: number, density = 1, look: Look = "lowpoly"): Puff[] {
  const st = styleOf(c.species);
  const out: Puff[] = [];
  const r = c.r;
  // the voxel look needs fewer, bigger lumps (every one becomes a pile of cubes); strands and tiers keep their count
  const lumpy = look === "voxel" && (st.shape === "puff" || st.shape === "blossom" || st.shape === "leafy" || st.shape === "curtain");
  const n = Math.max(lumpy ? 3 : 1, Math.round(st.puffs * (0.6 + 0.4 * density) * (lumpy ? 0.5 : 1)));
  const H = (i: number, k = 0): number => ih(c.seed, i + 17, k);
  const accent = st.accent ? parseHex(st.accent.color) : null;
  const colourOf = (i: number, lighten = 0): { color: RGB; a: number } => {
    let col: RGB = c.color;
    if (accent && H(i, 9) < st.accent!.chance) col = jitter(accent, 0, 0, (H(i, 10) - 0.5) * 0.1);
    col = jitter(col, 0, 0, (H(i, 8) - 0.5) * 0.16 + lighten);
    return { color: col, a: 0.78 + 0.22 * H(i, 12) };
  };
  const put = (i: number, dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, shape: Puff["shape"] = "blob", lighten = 0): void => {
    const cc = colourOf(i, lighten);
    out.push({ x: c.x + dx, y: c.y + dy, z: c.z + dz, sx, sy, sz, ry: H(i, 13) * Math.PI * 2, shape, color: cc.color, a: cc.a, cluster: ci });
  };
  // a point in a ball (x, z round, y squashed by `tall`)
  const ball = (i: number, rad: number, tall = 1): [number, number, number] => {
    const th = H(i, 1) * Math.PI * 2, ph = Math.acos(1 - 2 * H(i, 2)), d = rad * Math.cbrt(H(i, 3));
    return [d * Math.sin(ph) * Math.cos(th), d * Math.cos(ph) * tall, d * Math.sin(ph) * Math.sin(th)];
  };
  switch (st.shape) {
    case "puff":
    case "blossom": {
      const small = st.shape === "blossom";
      put(0, 0, 0, 0, r * (small ? 0.62 : 0.82), r * (small ? 0.62 : 0.8) * st.tall, r * (small ? 0.62 : 0.82));
      for (let i = 1; i < n; i++) {
        const [dx, dy, dz] = ball(i, r * 0.6, st.tall);
        const s = r * ((small ? 0.34 : 0.42) + 0.25 * H(i, 4));
        put(i, dx, dy * 0.85 + r * 0.06, dz, s, s * st.tall, s);
      }
      break;
    }
    case "leafy": {
      for (let i = 0; i < n; i++) {
        const [dx, dy, dz] = ball(i, r * 0.85, st.tall);
        const s = r * (0.24 + 0.18 * H(i, 4));
        put(i, dx, dy, dz, s, s * 0.85 * st.tall, s, "blob", 0.04);
      }
      break;
    }
    case "tier": {
      // stacked skirts (cones, apex up), widest at the bottom; a tip cluster crowns the end
      const tiers = Math.max(2, Math.min(4, Math.round(n)));
      const h = r * 0.9 * st.tall;
      const base = c.tip ? 0.15 * r : -0.1 * r;
      for (let k = 0; k < tiers; k++) {
        const f = k / (tiers - 1);
        const rad = r * (0.95 - 0.58 * f) * (0.9 + 0.2 * H(k, 4));
        put(k, (H(k, 5) - 0.5) * 0.12 * r, base + (-0.35 + 0.75 * f) * h, (H(k, 6) - 0.5) * 0.12 * r, rad, h * 0.75, rad, "cone", 0.05 * f);
      }
      break;
    }
    case "curtain": {
      // a small canopy on the branch + long hanging strands along it
      put(0, 0, r * 0.1, 0, r * 0.62, r * 0.28, r * 0.62);
      for (let i = 1; i < n; i++) {
        const u = (i / (n - 1) - 0.5) * 2; // -1..1 along the branch
        const len = r * (1.1 + 1.1 * H(i, 4));
        const w = r * (0.13 + 0.07 * H(i, 5));
        const off = (H(i, 6) - 0.5) * 0.5 * r;
        put(i, c.ax * u * r * 0.85 - c.az * off, r * 0.05 - len * 0.5, c.az * u * r * 0.85 + c.ax * off, w, len * 0.5, w, "blob", -0.02 * u);
      }
      break;
    }
    case "umbrella": {
      // flat layered plates; the top one lighter
      put(0, 0, 0, 0, r, r * 0.2, r);
      put(1, (H(1, 1) - 0.5) * 0.3 * r, r * 0.2, (H(1, 2) - 0.5) * 0.3 * r, r * 0.7, r * 0.16, r * 0.7, "blob", 0.06);
      for (let i = 2; i < Math.max(3, n); i++) {
        const a = H(i, 1) * Math.PI * 2;
        put(i, Math.cos(a) * r * 0.72, -r * 0.03, Math.sin(a) * r * 0.72, r * 0.38, r * 0.14, r * 0.38);
      }
      break;
    }
    case "tuft": {
      for (let i = 0; i < n; i++) {
        const [dx, dy, dz] = ball(i, r * 0.45, st.tall);
        const s = r * (0.5 - (0.1 * i) / n);
        put(i, dx, Math.abs(dy) * 0.5 + r * 0.1, dz, s, s * 0.8, s);
      }
      break;
    }
    case "wisp": {
      for (let i = 0; i < n; i++) {
        const [dx, , dz] = ball(i, r * 0.55);
        const hgt = r * (0.55 + 0.5 * H(i, 4)) * st.tall;
        const w = r * (0.2 + 0.12 * H(i, 5));
        put(i, dx, hgt * 0.35 + r * 0.05, dz, w, hgt * 0.5, w);
      }
      break;
    }
  }
  return out;
}

/**
 * Pieces for every cluster in a look. Low-poly: the cluster shapes. Voxel: each shape turned into cubes on a global
 * 28 / 42 / 56 unit grid (deduplicated, ragged edges, hollow middles), so the canopy is blocky and clusters merge into one
 * mass. At most `MAX_PUFFS`: beyond that whole clusters are dropped (tips first, then by hash), never single pieces.
 */
export function buildPuffs(clusters: readonly Cluster[], look: Look, density = 1): Puff[] {
  const expand = (keep: (i: number) => boolean): Puff[] => {
    const all: Puff[] = [];
    const seen = new Set<number>();
    clusters.forEach((c, ci) => {
      if (!keep(ci)) return;
      for (const p of clusterShapes(c, ci, density, look)) {
        if (look === "lowpoly") all.push(p);
        else voxelize(p, all, seen);
      }
    });
    return all;
  };
  const all = expand(() => true);
  if (all.length <= MAX_PUFFS) return all;
  const rank = clusters.map((c, i) => ({ i, k: (c.tip ? 0 : 1) + ih(c.seed, 21) * 0.99 })).sort((a, b) => a.k - b.k || a.i - b.i);
  const keepN = Math.max(1, Math.floor(((clusters.length * MAX_PUFFS) / all.length) * 0.97));
  const kept = new Set(rank.slice(0, keepN).map((x) => x.i));
  let out = expand((i) => kept.has(i));
  if (out.length > MAX_PUFFS) out = out.filter((_, i) => ih(i, 5, 3) < MAX_PUFFS / out.length); // dedupe made it bigger than estimated: last resort
  return out;
}

const cubeKey = (cell: number, gx: number, gy: number, gz: number): number => (((gx + 2048) * 4096 + (gy + 2048)) * 4096 + (gz + 2048)) * 4 + Math.round(cell / CELL);

/** Cubes of one blob / cone, on the grid (centres at multiples of the cell edge). */
function voxelize(p: Puff, out: Puff[], seen: Set<number>): void {
  // the cube edge follows the shape: 28 for strands and small lumps up to 56 for the big masses (multiples of the bark grid's 14)
  const cell = clamp(Math.round(Math.min(p.sx, p.sz) / 1.8 / CELL) * CELL, 2 * CELL, 4 * CELL);
  const emit = (gx: number, gy: number, gz: number): void => {
    const k = cubeKey(cell, gx, gy, gz);
    if (seen.has(k)) return;
    seen.add(k);
    const j = ih(gx, gy, gz + cell);
    out.push({ x: gx * cell, y: gy * cell, z: gz * cell, sx: cell, sy: cell, sz: cell, ry: 0, shape: "cube", color: jitter(p.color, 0, 0, (j - 0.5) * 0.14), a: p.a * (0.85 + 0.15 * j), cluster: p.cluster });
  };
  if (p.shape === "cone") {
    // a stack of discs, one cell thick, shrinking to the apex
    const layers = Math.max(1, Math.round(p.sy / cell));
    const y0 = p.y - p.sy / 2;
    for (let l = 0; l < layers; l++) {
      const y = y0 + ((l + 0.5) * p.sy) / layers;
      const rho = Math.max(cell * 0.5, p.sx * (1 - (l + 0.5) / layers));
      const gy = Math.round(y / cell);
      const n = Math.ceil(rho / cell);
      for (let gx = Math.round(p.x / cell) - n; gx <= Math.round(p.x / cell) + n; gx++) for (let gz = Math.round(p.z / cell) - n; gz <= Math.round(p.z / cell) + n; gz++) {
        const d = Math.hypot(gx * cell - p.x, gz * cell - p.z);
        if (d <= rho && (d < 0.01 || ih(gx, gy, gz) < 0.9)) emit(gx, gy, gz);
      }
    }
    return;
  }
  const nx = Math.ceil(p.sx / cell), ny = Math.ceil(p.sy / cell), nz = Math.ceil(p.sz / cell);
  const cx = Math.round(p.x / cell), cy = Math.round(p.y / cell), cz = Math.round(p.z / cell);
  const hollow = Math.min(nx, ny, nz) >= 2;
  let any = false;
  for (let gx = cx - nx; gx <= cx + nx; gx++) for (let gy = cy - ny; gy <= cy + ny; gy++) for (let gz = cz - nz; gz <= cz + nz; gz++) {
    const d = ((gx * cell - p.x) / p.sx) ** 2 + ((gy * cell - p.y) / p.sy) ** 2 + ((gz * cell - p.z) / p.sz) ** 2;
    if (d > 1 || (hollow && d < 0.3)) continue;
    if (ih(gx, gy, gz) > 0.93) continue;
    emit(gx, gy, gz);
    any = true;
  }
  if (!any) emit(cx, cy, cz); // thin strands / small tufts always keep one cube
}

// ---- fade -----------------------------------------------------------------------------------------

/** Distances (world units) where a cluster is fully faded (`near`) and fully there (`far`). */
export const FADE = {
  /** From the animal: the whole neighbourhood of the creature is clear. */
  animal: { near: 90, far: 440 },
  /** From the camera (so the lens is never inside a fog bank). */
  cam: { near: 70, far: 340 },
  /** From the line camera -> animal (so nothing stands between the two). */
  ray: { near: 50, far: 230 },
  /** Multiplier on the animal distance for clusters of the branch the animal is on / the branches around it. */
  sameBranch: 0.6,
  neighbour: 0.8,
};

/**
 * Visibility 0..1 of a cluster from three SURFACE distances (centre distance minus 0.7 x the radius, >= 0): to the
 * animal (already scaled by the branch relation), to the camera and to the camera -> animal segment. `k` scales the
 * thresholds with the view (a farther camera clears a wider ring). Monotonic in every distance, 0 at 0, smooth.
 */
export function visibility(dAnimal: number, dCam: number, dRay: number, k = 1): number {
  const kk = clamp(Number.isFinite(k) ? k : 1, 0.5, 3);
  const D = (d: number): number => (d === d ? Math.max(0, d) : 1e9); // NaN counts as "far": garbage never hides anything
  return smoothstep(FADE.animal.near * kk, FADE.animal.far * kk, D(dAnimal))
    * smoothstep(FADE.cam.near * kk, FADE.cam.far * kk, D(dCam))
    * smoothstep(FADE.ray.near * kk, FADE.ray.far * kk, D(dRay));
}

/** Distance from point p to the segment a-b. */
export function distToSegment(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const l2 = vx * vx + vy * vy + vz * vz;
  const t = l2 > 1e-9 ? clamp(((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t), pz - (az + vz * t));
}

/** View scale of the fade thresholds: a close camera clears a little less, a far one a little more (capped: zooming out must not strip the canopy). */
export const viewScale = (camDist: number): number => clamp(camDist / 420, 0.7, 1.15);

// ---- three.js layer -------------------------------------------------------------------------------

interface Part {
  mesh: THREE.InstancedMesh;
  fade: THREE.InstancedBufferAttribute;
  /** Cluster index per instance, and the instance's own opacity (style alpha x leafK x piece alpha). */
  cluster: Uint32Array;
  base: Float32Array;
}

/** Lambert material whose alpha is multiplied by the per-instance `aFade` attribute (blended, no depth write). */
function foliageMaterial(poly: boolean): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: poly, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh): void => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFade;\nvarying float vFade;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFade = aFade;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFade;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vFade;\nif (diffuseColor.a < 0.01) discard;");
  };
  mat.customProgramCacheKey = (): string => "biblio-foliage";
  return mat;
}

const srgb = (c: RGB): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

export interface FoliageStats {
  clusters: number;
  instances: number;
  drawCalls: number;
  triangles: number;
}

const NO_STATS: FoliageStats = { clusters: 0, instances: 0, drawCalls: 0, triangles: 0 };

/** The canopy of a world: build once per world / look / density, `update` every frame. */
export class FoliageLayer {
  readonly group = new THREE.Group();
  stats: FoliageStats = NO_STATS;
  private clusters: Cluster[] = [];
  private parts: Part[] = [];
  private cur = new Float32Array(0);
  private snap = true;
  private rel = new Float32Array(0);
  private relFor: string | undefined | null = null;
  private world: World | null = null;

  constructor() {
    this.group.name = "foliage";
  }

  get clusterCount(): number {
    return this.clusters.length;
  }

  /** Current visibility (0..1) of cluster i, for tests and the debug handle. */
  visibilityOf(i: number): number {
    return this.cur[i] ?? 0;
  }

  clear(): void {
    disposeGroup(this.group);
    this.parts = [];
    this.clusters = [];
    this.cur = new Float32Array(0);
    this.rel = new Float32Array(0);
    this.relFor = null;
    this.world = null;
    this.stats = NO_STATS;
  }

  /** (Re)build the meshes. Disposes the previous ones. */
  build(world: World, leaves: ReadonlyArray<LeafPos>, look: Look, density = 1): void {
    this.clear();
    this.world = world;
    this.clusters = placeFoliage(world, leaves, { density });
    const puffs = buildPuffs(this.clusters, look, density);
    const poly = look === "lowpoly";
    const geos: Record<Puff["shape"], THREE.BufferGeometry> = {
      cube: new THREE.BoxGeometry(1, 1, 1),
      blob: new THREE.IcosahedronGeometry(1, 0),
      cone: new THREE.ConeGeometry(1, 1, 7, 1),
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let tris = 0;
    for (const shape of ["cube", "blob", "cone"] as const) {
      const list = puffs.filter((p) => p.shape === shape);
      if (list.length === 0) continue;
      const geo = geos[shape].clone();
      const fade = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
      fade.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aFade", fade);
      const mesh = new THREE.InstancedMesh(geo, foliageMaterial(poly), list.length);
      const cluster = new Uint32Array(list.length);
      const base = new Float32Array(list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.ry);
        m.compose(pos.set(p.x, p.y, p.z), q, sc.set(p.sx, p.sy, p.sz));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, srgb(p.color));
        cluster[i] = p.cluster;
        const c = this.clusters[p.cluster];
        base[i] = styleOf(c.species).alpha * c.leafK * p.a;
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false; // instanced meshes have no per-instance bounds; the whole canopy is one thing
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.parts.push({ mesh, fade, cluster, base });
      tris += list.length * (geo.index ? geo.index.count / 3 : geo.getAttribute("position").count / 3);
    }
    for (const g of Object.values(geos)) g.dispose();
    this.cur = new Float32Array(this.clusters.length);
    this.snap = true;
    this.stats = { clusters: this.clusters.length, instances: puffs.length, drawCalls: this.parts.length, triangles: tris };
  }

  /** Clusters of the animal's branch and the branches next to it are revealed from farther away. */
  private relations(branch: string | undefined): void {
    if (branch === this.relFor && this.rel.length === this.clusters.length) return;
    this.relFor = branch;
    this.rel = new Float32Array(this.clusters.length).fill(1);
    const w = this.world;
    let b = branch ? w?.branches.get(branch) : undefined;
    if (b?.silk && b.parent) b = w?.branches.get(b.parent) ?? b; // a thread: reveal around its anchor
    if (!w || !b) return;
    const near = new Set<string>([...b.next, ...b.side]);
    if (b.parent) near.add(b.parent);
    const id = b.id;
    this.clusters.forEach((c, i) => {
      if (c.branch === id) this.rel[i] = FADE.sameBranch;
      else if (near.has(c.branch)) this.rel[i] = FADE.neighbour;
    });
  }

  /** Per frame: new targets from the camera / animal, eased in time (about 0.2 s), written to the instance attributes. */
  update(dt: number, cam: { x: number; y: number; z: number }, animal: { x: number; y: number; z: number }, animalBranch?: string): void {
    const n = this.clusters.length;
    if (n === 0 || !this.group.visible) return;
    this.relations(animalBranch);
    const camDist = Math.hypot(cam.x - animal.x, cam.y - animal.y, cam.z - animal.z);
    const k = viewScale(camDist);
    const ease = this.snap ? 1 : 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * 6);
    let moved = this.snap;
    for (let i = 0; i < n; i++) {
      const c = this.clusters[i];
      const edge = c.r * 0.7;
      const dA = Math.max(0, Math.hypot(c.x - animal.x, c.y - animal.y, c.z - animal.z) - edge) * this.rel[i];
      const dC = Math.max(0, Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z) - edge);
      const dR = Math.max(0, distToSegment(c.x, c.y, c.z, cam.x, cam.y, cam.z, animal.x, animal.y, animal.z) - edge);
      const t = visibility(dA, dC, dR, k);
      const v = this.cur[i] + (t - this.cur[i]) * ease;
      if (Math.abs(v - this.cur[i]) > 0.002) moved = true;
      this.cur[i] = v;
    }
    this.snap = false;
    if (!moved) return;
    for (const p of this.parts) {
      const a = p.fade.array as Float32Array;
      for (let i = 0; i < a.length; i++) a[i] = p.base[i] * this.cur[p.cluster[i]];
      p.fade.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
  }
}
