/**
 * tree/leafkind.ts — what a note looks like as a leaf: its KIND (by note type,
 * or the user's #biblio_leaf override), its SIZE (by content length) and the 2D
 * outlines both renderer looks (low-poly and voxel) build their leaves from.
 *
 * Pure data and maths — no three.js, no DOM — so it is unit-tested directly.
 */

export type LeafKind = "broad" | "needle" | "maple" | "blossom" | "fruit";

export const LEAF_KINDS: readonly LeafKind[] = ["broad", "needle", "maple", "blossom", "fruit"];

const BY_TYPE: Record<string, LeafKind> = {
  text: "broad",
  code: "needle",
  markdown: "maple",
  canvas: "blossom",
  relationMap: "blossom",
  mermaid: "blossom",
  render: "blossom",
  book: "blossom",
  search: "blossom",
  webView: "blossom",
  noteMap: "blossom",
  mindMap: "blossom",
  geoMap: "blossom",
  image: "fruit",
  file: "fruit",
  audio: "fruit",
  video: "fruit",
  pdf: "fruit",
};

/** `override` is the #biblio_leaf label value; a valid kind (any case) beats the type mapping. */
export function leafKindFor(noteType: string, override?: string): LeafKind {
  const o = override?.trim().toLowerCase();
  if (o) {
    const hit = LEAF_KINDS.find((k) => k === o);
    if (hit) return hit;
  }
  return Object.prototype.hasOwnProperty.call(BY_TYPE, noteType) ? BY_TYPE[noteType] : "broad";
}

/** [log10(1 + chars), multiplier] anchors; linear in between, clamped outside. */
const SCALE_CURVE: Array<[number, number]> = [[0, 0.55], [2, 0.85], [3, 1.25], [4, 1.65], [5, 2.0]];

/** Leaf size multiplier from the content length in characters: 0 → 0.55 … 100k+ → 2.0; unknown → 1. */
export function leafScale(chars: number | undefined): number {
  if (chars === undefined) return 1;
  if (!(chars > 0)) return SCALE_CURVE[0][1]; // NaN, negative, 0
  const x = Math.log10(1 + chars);
  const last = SCALE_CURVE[SCALE_CURVE.length - 1];
  if (!(x < last[0])) return last[1]; // also Infinity
  for (let i = 1; i < SCALE_CURVE.length; i++) {
    const [x1, y1] = SCALE_CURVE[i];
    if (x <= x1) {
      const [x0, y0] = SCALE_CURVE[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

// ------------------------------------------------------------------- outlines

type P2 = [number, number];
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const pt = (u: number, v: number): P2 => [r3(u), r3(v)];

/** A symmetric outline from its right half (u > 0, bottom to top); the left half is mirrored. CCW. */
function mirrored(right: P2[]): P2[] {
  return [...right, ...right.slice(1, -1).reverse().map(([u, v]): P2 => [-u, v])];
}

const BROAD = mirrored([pt(0, 0), pt(0.4, 0.08), pt(0.75, 0.3), pt(0.85, 0.5), pt(0.6, 0.75), pt(0.28, 0.92), pt(0, 1)]);

/** Fan of 5 thin spikes from the stalk tip, `deg` degrees off the blade axis. */
const NEEDLE: P2[][] = [-50, -25, 0, 25, 50].map((deg) => {
  const a = (deg * Math.PI) / 180;
  const len = 1 - Math.abs(deg) / 250;
  const w = 0.05;
  const d: P2 = [Math.sin(a), Math.cos(a)];
  const p: P2 = [Math.cos(a), -Math.sin(a)];
  const y0 = 0.05; // spikes start just off the stalk tip so the base corners stay at v >= 0
  return [pt(-p[0] * w, y0 - p[1] * w), pt(p[0] * w, y0 + p[1] * w), pt(d[0] * len * 0.95, y0 + d[1] * len * 0.95)];
});

/** 5-lobed star about (0, 0.5), wider than tall: tips at 90° + k·72°, valleys between. */
const MAPLE: P2[] = Array.from({ length: 10 }, (_, i) => {
  const phi = ((90 + 36 * i) * Math.PI) / 180;
  const r = i % 2 === 0 ? 1 : 0.45;
  return pt(Math.cos(phi) * r * 0.95, 0.5 + Math.sin(phi) * r * 0.5);
});

/** 5 teardrop petals around (0, 0.5). */
const BLOSSOM: P2[][] = [0, 1, 2, 3, 4].map((k) => {
  const phi = ((90 + 72 * k) * Math.PI) / 180;
  const c = Math.cos(phi), s = Math.sin(phi);
  const petal: P2[] = [[0.05, 0], [0.22, -0.14], [0.42, -0.12], [0.5, 0], [0.42, 0.12], [0.22, 0.14]];
  return petal.map(([a, b]) => pt((a * c - b * s) * 1.5, 0.5 + (a * s + b * c)));
});

const FRUIT: P2[] = Array.from({ length: 8 }, (_, i) => {
  const phi = ((22.5 + 45 * i) * Math.PI) / 180;
  return pt(Math.cos(phi) * 0.45, 0.5 + Math.sin(phi) * 0.45);
});

/**
 * Leaf outlines in unit leaf space: u across the blade (-1..1), v from the stalk tip (0) to the far tip (1);
 * counter-clockwise, simple polygons. One entry per kind, one polygon per part (needle spikes, blossom petals).
 */
export const LEAF_SHAPES: Record<LeafKind, P2[][]> = {
  broad: [BROAD],
  needle: NEEDLE,
  maple: [MAPLE],
  blossom: BLOSSOM,
  fruit: [FRUIT],
};

/** Optional accent colour for a detail of the leaf (the renderer falls back to the leaf colour). */
export const LEAF_ACCENT: Partial<Record<LeafKind, string>> = { blossom: "#f2c744" };
