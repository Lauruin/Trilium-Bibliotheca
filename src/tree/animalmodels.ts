/**
 * tree/animalmodels.ts — the LOOK of every animal as DATA (pure: no three.js), drawn by creatures.ts in both looks.
 *
 * A `Model` describes one animal in unscaled sim pixels (the numbers of the `Animal` spec in sim3.ts before `scaled()`; the
 * renderer multiplies by `Animal.scale`). Positions are in the BODY FRAME at a distance `d` behind the head: `at = [forward, up, side]`
 * with side mirrored for `mirror: true` parts. Parts are `blob` (ellipsoid / voxel box), `cone` and `prism` (both start at their base
 * and point along +forward after `rot`), and `stick` (a thin tapered limb between two body-frame points). The torso, tail, abdomen
 * etc. are `tubes`: lofted rings along the body path (low-poly: faceted, crisp per-face colours; voxel: stepped square boxes).
 * Legs are two-bone IK from the sim's procedural feet (`LegStyle`), wings are chains of flat panels (`WingModel`).
 * Nothing here changes sim numbers (width, feet, speed): the model only has to stay inside the sim's half-widths.
 */

export type Kind = "blob" | "cone" | "prism" | "stick" | "plate";
export type V3t = [number, number, number];
export type AttAnim = "blink" | "twitch" | "antenna" | "mandible" | "tongue" | "crest";

export interface Att {
  kind: Kind;
  /** Body position (px behind the head) whose frame the offsets are in. */
  d: number;
  /** (forward, up, side) offset in that frame; stick: its start point. */
  at: V3t;
  /** Stick: end point. */
  to?: V3t;
  /** (side, up, forward) full extents; stick: [thickness at the start, thickness at the end, unused]. */
  size: V3t;
  /** pitch (nose up +), yaw (turn toward +side... mirrored), roll; radians, applied in the part's own frame. */
  rot?: V3t;
  col: string;
  /** Multiplies the colour (lighting trick for cheap shading variety). */
  shade?: number;
  mirror?: boolean;
  /** `head`: follows the head's turn / nod (pivoting at the neck). */
  frame?: "body" | "head";
  anim?: AttAnim;
  /** Anim scaling pivot (tongue, whiskers): body-frame point the part grows from. */
  pivot?: V3t;
  alpha?: number;
  /** Low detail geometry (eyes, toes). */
  lo?: boolean;
  /** `plate` only: key of a flat shape in PLATES. */
  plate?: string;
  /** Hidden in this look / state. */
  only?: "voxel" | "lowpoly";
  hide?: "flight" | "ground" | "air";
}

export interface TubeCtx {
  /** Distance behind the head (unscaled px). */
  d: number;
  /** 0..1 along the tube. */
  u: number;
  /** Ring index. */
  i: number;
  /** Angle from the top (0) to the belly (PI), sign dropped. */
  phi: number;
  /** -1, 0, 1: which flank. */
  side: number;
}

export interface TubeSpec {
  d0: number;
  d1: number;
  /** Ring spacing (low-poly) and box length (voxel), unscaled px. */
  step: number;
  voxStep?: number;
  /** Cross-section sides in the low-poly look (the voxel look is always square). Default 8. */
  sides?: number;
  /** Half width and half height at `d` for the sim's half-width `w` there (all unscaled px). 0 closes the tube. */
  prof: (d: number, w: number) => [number, number];
  color: (c: TubeCtx) => string;
  /** Extra px at the top vertex of ring i (dorsal spikes). */
  crest?: (d: number, i: number) => number;
}

/** Leg look + bend, from the sim's feet. All lengths unscaled px. */
export interface LegStyle {
  /** Total leg length as a multiple of the rest hip-to-ankle distance (> 1: bent). */
  len: number;
  /** Where the knee points: (forward, up, outward). */
  bend: V3t;
  /** Thickness of the upper and lower segment (and the third, if any). */
  th: [number, number, number?];
  /** Length share of the upper segment. */
  split?: number;
  /** Height of the ankle above the foot: adds a third, short, nearly vertical segment (insects, spiders). */
  ankle?: number;
  col: string;
  colLow?: string;
  /** Joint blobs (knee, ankle) in this colour. */
  joint?: string;
  paw?: { size: V3t; col: string; toes?: { n: number; len: number; th: number; spread: number; col: string } };
  /** Hip sits this fraction of the torso half width from the axis. Default 0.85. */
  hipOut?: number;
  /** Airborne (not flying): `stretch` legs reach out, `tuck` pulls them under. Default tuck. */
  air?: "stretch" | "tuck";
  hide?: "flight";
}

export interface Panel {
  /** Panel length along its span and chord (px). */
  len: number;
  chord: number;
  /** Key of the outline in WING_SHAPES. */
  shape: string;
}

export interface WingMotion {
  /** Flap phase (rad), flap strength 0..1 (insects 1; the jay follows its Space-flap effort), how open the wings are (0 folded .. 1 spread). */
  phase: number;
  amp: number;
  open: number;
  /** Pair index (0 fore, 1 hind) and the body pitch (rad). */
  pair: number;
  pitch: number;
}

export interface WingModel {
  pairs: 1 | 2;
  /** Shoulder: body position and offset. */
  d: number;
  at: V3t;
  panels: Panel[];
  /** Per panel: (roll, yaw, pitch) in radians relative to its parent. Roll lifts the tip, yaw swings it back, pitch tilts the leading edge. */
  pose: (m: WingMotion, panel: number) => V3t;
  /** Colour of the panel's outline cells; alpha. */
  alpha: number;
  /** Visible while perched (folded) too? Default true. */
  foldedVisible?: boolean;
}

export interface Model {
  /** Body height above the bark: 0 hugs, 1 = the old stance. Default 1. */
  stance?: number;
  /** Stand every body part at the hips' height (spiders, insects, birds), instead of by its own half width (lizards: thin tail lies on the bark). */
  level?: boolean;
  tubes: TubeSpec[];
  atts: Att[];
  legs?: (i: number, n: number, leg: { node: number; side: 1 | -1; lead: number }) => LegStyle;
  wings?: WingModel;
  /** Lateral wave along the body while moving: amplitude (px), wavelength (px), and an idle sway. */
  slither?: { amp: number; wave: number; idle?: number; from?: number };
  /** Tail: sway (px lateral, Hz), raise (px up at the end, power) from `d0`. */
  tail?: { d0: number; sway: number; hz: number; raise?: number; pow?: number; flatInGlide?: boolean };
  /** Droop the rear body (insects hovering): px down at the end from `d0`. */
  droop?: { d0: number; amount: number };
  /** Head idle motion amplitude (rad): look around, nod. */
  head?: { look: number; nod: number; bob?: number };
  /** The squirrel's glide membranes between the front and hind legs. */
  membrane?: { col: string; edge: string };
  /** Eye height factor for blinks etc. is baked in the parts; breathing amplitude (fraction of tube height). */
  breathe?: number;
}

// ---- colour helpers (css hex) ----------------------------------------------------------------------

const h2 = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** Blend a toward b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  return `#${h2(ar + (br - ar) * t)}${h2(ag + (bg - ag) * t)}${h2(ab + (bb - ab) * t)}`;
}
export const dark = (c: string, k: number): string => mix(c, "#000000", k);
export const light = (c: string, k: number): string => mix(c, "#ffffff", k);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- flat shapes: outlines in unit space (x along the span 0..1, z across the chord -1..1, +z = leading edge) ------------------

export interface Outline {
  /** Polygon points [x, z]. */
  pts: Array<[number, number]>;
  /** Colour of the cell centred at (x, z). */
  col: (x: number, z: number) => string;
}

const ellipse = (n: number, x0: number, x1: number, zl: number, zt: number, tipPull = 0): Array<[number, number]> => {
  const pts: Array<[number, number]> = [];
  // leading edge out, trailing edge back
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI;
    pts.push([x0 + (x1 - x0) * (1 - Math.cos(a)) * 0.5 + tipPull * Math.sin(a) * 0.0, zl * Math.sin(a)]);
  }
  for (let k = n - 1; k >= 1; k--) {
    const a = (k / n) * Math.PI;
    pts.push([x0 + (x1 - x0) * (1 - Math.cos(a)) * 0.5, -zt * Math.sin(a)]);
  }
  return pts;
};

const JAY = "#3b6fd0";
const JAY_D = "#1c2a4a";
export const WING_SHAPES: Record<string, Outline> = {
  // bee: forewing, hindwing
  bee1: { pts: ellipse(6, 0, 1, 0.55, 0.45), col: () => "#e6efff" },
  bee2: { pts: ellipse(6, 0, 0.82, 0.4, 0.34), col: () => "#e6efff" },
  // dragonfly: long narrow wings with a dark node mark near the leading tip
  dragon1: { pts: ellipse(8, 0, 1, 0.5, 0.4), col: (x, z) => (x > 0.72 && x < 0.88 && z > 0.2 ? "#2a3a4a" : "#d8ecff") },
  dragon2: { pts: ellipse(8, 0, 0.94, 0.62, 0.55), col: (x, z) => (x > 0.68 && x < 0.84 && z > 0.25 ? "#2a3a4a" : "#d8ecff") },
  // blue jay: inner wing (arm) and outer wing (hand) with a feathered trailing edge, black bars, white tips
  jayArm: {
    pts: [[0, 0.7], [0.5, 0.78], [1, 0.62], [1, -0.55], [0.82, -0.78], [0.55, -0.62], [0.3, -0.82], [0.08, -0.6], [0, -0.45]],
    col: (x, z) => (x > 0.7 && x < 0.86 ? JAY_D : z < -0.5 && x > 0.35 ? "#2a58b0" : x > 0.55 && z < 0.1 && z > -0.5 ? "#f0f2f8" : x < 0.5 && z > 0.1 ? "#4a84e0" : JAY),
  },
  jayHand: {
    pts: [[0, 0.62], [0.45, 0.55], [1, 0.12], [0.88, -0.12], [0.72, -0.3], [0.55, -0.55], [0.38, -0.7], [0.2, -0.7], [0, -0.55]],
    col: (x) => (x > 0.85 ? "#f2f4fa" : Math.abs(((x * 7) | 0) % 2) === 0 ? JAY_D : "#2a58b0"),
  },
  // blue jay tail: a fan of feathers, blue with black bars and white tips
  jayTail: {
    pts: [[0, 0.22], [0.5, 0.42], [1, 0.34], [1.0, 0.12], [0.96, -0.12], [1.0, -0.34], [0.5, -0.42], [0, -0.22]],
    col: (x) => (x > 0.9 ? "#f2f4fa" : x > 0.62 && x < 0.76 ? JAY_D : x > 0.34 && x < 0.44 ? JAY_D : "#2f64c4"),
  },
};

// ---- the ten models --------------------------------------------------------------------------------

// LIZARD ---------------------------------------------------------------------------------------------
const LZ = { base: "#6a9a4c", dorsal: "#436f34", mid: "#82ae58", belly: "#d4dc8e", eye: "#ecc040" };
const lizardTube: TubeSpec = {
  d0: 5, d1: 172, step: 5.5, voxStep: 11, sides: 8,
  prof: (d, w) => {
    const neck = smooth(8, 22, d);
    const tail = smooth(70, 120, d);
    return [w * (0.62 + 0.3 * neck), w * (0.5 + 0.22 * neck + 0.1 * tail) + 0.2];
  },
  color: (c) => {
    const band = Math.floor(c.d / 11) % 2 === 0;
    if (c.phi > 2.2) return c.d > 70 ? mix(LZ.belly, LZ.base, smooth(70, 150, c.d)) : LZ.belly;
    if (c.phi > 1.15) return c.d > 74 ? (band ? LZ.dorsal : LZ.mid) : mix(LZ.mid, LZ.belly, 0.25);
    if (c.d > 74) return band ? LZ.dorsal : LZ.base; // banded tail
    return c.d > 14 && c.d < 70 && c.i % 3 === 0 ? LZ.dorsal : LZ.base; // dark saddles along the back
  },
  crest: (d, i) => (d > 12 && d < 105 && i % 2 === 0 ? 2.4 * (1 - smooth(60, 105, d)) + 0.6 : 0),
};
export const LIZARD_MODEL: Model = {
  stance: 0.5,
  tubes: [lizardTube],
  atts: [
    { kind: "blob", d: 0, at: [1.4, 0.3, 0], size: [10, 6.4, 15.5], col: LZ.base, frame: "head" },
    { kind: "blob", d: 0, at: [10.8, -0.4, 0], size: [5.8, 4, 10], col: LZ.base, shade: 1.05, frame: "head" },
    { kind: "blob", d: 0, at: [8, -3, 0], size: [6.4, 2.6, 12.5], col: LZ.belly, frame: "head" },
    // eyes: gold, with a dark slit; the brow ridge is a darker blob above
    { kind: "blob", d: 0, at: [3.4, 3, 4.7], size: [3.8, 3.8, 4.2], col: LZ.eye, mirror: true, frame: "head", lo: true, anim: "blink" },
    { kind: "blob", d: 0, at: [4.6, 3.2, 6.4], size: [1.3, 3, 1.4], col: "#141414", mirror: true, frame: "head", lo: true, anim: "blink" },
    { kind: "blob", d: 0, at: [3, 4.4, 3.6], size: [3.4, 1.8, 6], col: LZ.dorsal, mirror: true, frame: "head", lo: true },
    // forked tongue (flicks every few seconds)
    { kind: "stick", d: 0, at: [14, -1.6, 0], to: [24, -1.6, 0], size: [1.2, 0.9, 0], col: "#d8405a", frame: "head", anim: "tongue", pivot: [14, -1.6, 0], only: "lowpoly" },
    { kind: "stick", d: 0, at: [24, -1.6, 0], to: [29, -1.6, 2.4], size: [0.9, 0.5, 0], col: "#d8405a", frame: "head", anim: "tongue", pivot: [14, -1.6, 0], mirror: true, only: "lowpoly" },
  ],
  legs: (i) => ({
    len: 1.42, bend: i < 2 ? [-0.55, 0.45, 1] : [0.55, 0.45, 1], th: [4.6, 3.4], col: LZ.base, colLow: LZ.dorsal, joint: LZ.base, air: "stretch",
    paw: { size: [5.4, 2.4, 6.5], col: LZ.dorsal, toes: { n: 4, len: 4.6, th: 1.6, spread: 0.5, col: LZ.dorsal } },
  }),
  slither: { amp: 3.2, wave: 80, idle: 0.6, from: 14 },
  tail: { d0: 80, sway: 2.2, hz: 0.7 },
  head: { look: 0.35, nod: 0.12, bob: 0.1 },
  breathe: 0.04,
};

/** Fallback for an `Animal` without a model: one tube over its nodes, a head blob with eyes, plain legs. */
export function genericModel(a: { nodes: Array<{ d: number; w: number }>; legs: unknown[]; body?: string; belly?: string; scale?: number }): Model {
  const k = a.scale || 1;
  const last = a.nodes.length ? a.nodes[a.nodes.length - 1].d / k : 10;
  const body = a.body ?? "#888888";
  const belly = a.belly ?? "#cccccc";
  return {
    tubes: [{ d0: 2, d1: Math.max(6, last), step: 8, sides: 6, prof: (_d, w) => [w * 0.9, w * 0.8], color: (c) => (c.phi > 2.2 ? belly : body) }],
    atts: [
      { kind: "blob", d: 0, at: [0, 0, 0], size: [9, 8, 10], col: body, frame: "head" },
      { kind: "blob", d: 0, at: [3, 3, 3.4], size: [2.4, 2.4, 2.4], col: "#101010", mirror: true, frame: "head", lo: true },
    ],
    legs: () => ({ len: 1.3, bend: [0, 0.5, 1], th: [3, 2.4], col: body }),
  };
}


// CAT ------------------------------------------------------------------------------------------------
const CT = { base: "#d08a42", stripe: "#8a4a1e", cream: "#f4e6cc", pink: "#e88a98", green: "#8ccf4a" };
const catTube: TubeSpec = {
  d0: 5, d1: 134, step: 6, voxStep: 10, sides: 8,
  prof: (d, w) => {
    const tail = smooth(56, 72, d);
    const tr = 3.4 - 1.7 * smooth(66, 134, d);
    return [w * 0.9 * (1 - tail) + tr * tail, w * 0.88 * (1 - tail) + tr * tail];
  },
  color: (c) => {
    if (c.d > 66) return c.d > 120 || c.i % 2 === 0 ? CT.stripe : CT.base; // ringed tail with a dark tip
    if (c.phi > 2.15 || (c.d < 30 && c.phi > 1.5)) return CT.cream; // belly + chest bib
    return c.i % 3 === 0 && c.d > 12 ? CT.stripe : c.phi > 1.5 ? mix(CT.base, CT.cream, 0.3) : CT.base;
  },
};
export const CAT_MODEL: Model = {
  stance: 1.25,
  tubes: [catTube],
  atts: [
    { kind: "blob", d: 0, at: [1, 0.5, 0], size: [12.5, 11, 12], col: CT.base, frame: "head" },
    { kind: "blob", d: 0, at: [7.4, -1.8, 0], size: [6.8, 4.6, 5.4], col: CT.cream, frame: "head" },
    { kind: "blob", d: 0, at: [10, -0.5, 0], size: [2.6, 1.8, 1.6], col: CT.pink, frame: "head", lo: true },
    // forehead stripes
    { kind: "stick", d: 0, at: [1.5, 5.6, 0], to: [7.5, 4.2, 0], size: [1.1, 0.9, 0], col: CT.stripe, frame: "head", only: "lowpoly" },
    { kind: "stick", d: 0, at: [1.8, 5.5, 1.3], to: [6.8, 4.1, 2.2], size: [0.9, 0.7, 0], col: CT.stripe, frame: "head", mirror: true, only: "lowpoly" },
    // eyes (green, vertical black pupils)
    { kind: "blob", d: 0, at: [4.9, 2.4, 3.7], size: [3.4, 3.8, 2.2], col: CT.green, frame: "head", mirror: true, lo: true, anim: "blink" },
    { kind: "blob", d: 0, at: [5.9, 2.4, 4.1], size: [0.9, 3.2, 0.7], col: "#101010", frame: "head", mirror: true, lo: true, anim: "blink" },
    // ears: pointed, with pink insides
    { kind: "cone", d: 0, at: [-0.4, 4.2, 4.3], size: [5, 2.6, 7], rot: [1.38, 0, -0.32], col: CT.base, frame: "head", mirror: true, anim: "twitch" },
    { kind: "cone", d: 0, at: [0.3, 4.4, 4.1], size: [3, 1.4, 5], rot: [1.38, 0, -0.32], col: CT.pink, frame: "head", mirror: true, anim: "twitch" },
    // whiskers
    { kind: "stick", d: 0, at: [7.8, -1.4, 2.6], to: [6.8, -0.4, 11], size: [0.5, 0.15, 0], col: "#f4f4f4", frame: "head", mirror: true, only: "lowpoly" },
    { kind: "stick", d: 0, at: [7.8, -1.9, 2.6], to: [6.6, -1.9, 11.5], size: [0.5, 0.15, 0], col: "#f4f4f4", frame: "head", mirror: true, only: "lowpoly" },
    { kind: "stick", d: 0, at: [7.8, -2.4, 2.6], to: [6.8, -3.4, 10.5], size: [0.5, 0.15, 0], col: "#f4f4f4", frame: "head", mirror: true, only: "lowpoly" },
    // shoulders and haunches
    { kind: "blob", d: 20, at: [0, 0.4, 5], size: [6, 10.5, 13], col: CT.base, mirror: true },
    { kind: "blob", d: 48, at: [0, 0.6, 5.2], size: [6.5, 12.5, 16], col: CT.base, mirror: true },
  ],
  legs: (i) => ({
    len: 1.14, bend: i < 2 ? [-0.4, 0.3, 0.3] : [0.95, 0.2, 0.25], th: [4.8, 3.6], col: CT.base, colLow: mix(CT.base, CT.cream, 0.55), joint: CT.base, air: "stretch",
    paw: { size: [5.2, 3.4, 7], col: CT.cream },
  }),
  tail: { d0: 66, sway: 3, hz: 0.6, raise: 24, pow: 1.5 },
  head: { look: 0.5, nod: 0.1, bob: 0.06 },
  breathe: 0.04,
};

// FLYING SQUIRREL ------------------------------------------------------------------------------------
const SQ = { base: "#8e7e6a", belly: "#e4d8c4", dark: "#4a3e34", pink: "#d8a0a0" };
const squirrelTube: TubeSpec = {
  d0: 4, d1: 96, step: 5, voxStep: 10, sides: 8,
  prof: (d, w) => {
    const tailK = smooth(34, 48, d);
    const tip = 1 - 0.7 * smooth(80, 96, d);
    return [w * (0.88 + 0.22 * tailK) * tip, w * (0.84 + 0.1 * tailK) * tip];
  },
  color: (c) => {
    if (c.d > 78) return c.i % 3 === 0 ? SQ.dark : mix(SQ.base, SQ.dark, 0.45);
    if (c.d < 44) return c.phi > 2.0 ? SQ.belly : c.phi < 0.5 ? mix(SQ.base, SQ.dark, 0.28) : c.phi > 1.35 ? mix(SQ.base, SQ.belly, 0.4) : SQ.base;
    return c.phi > 2.2 ? mix(SQ.belly, SQ.base, 0.5) : c.phi > 1.3 ? mix(SQ.base, SQ.belly, 0.3) : SQ.base;
  },
};
export const SQUIRREL_MODEL: Model = {
  stance: 0.85,
  tubes: [squirrelTube],
  atts: [
    { kind: "blob", d: 0, at: [1.2, 0.4, 0], size: [10.8, 9.6, 11], col: SQ.base, frame: "head" },
    { kind: "blob", d: 0, at: [6.4, -1.5, 0], size: [5.2, 4.2, 5.4], col: SQ.belly, frame: "head" },
    { kind: "blob", d: 0, at: [8.8, -0.6, 0], size: [1.9, 1.5, 1.5], col: "#3a2a2a", frame: "head", lo: true },
    { kind: "blob", d: 0, at: [3.6, 2.8, 4.3], size: [4.2, 4.8, 3.2], col: "#14100e", frame: "head", mirror: true, lo: true, anim: "blink" },
    { kind: "blob", d: 0, at: [4.7, 3.8, 4.8], size: [1.1, 1.1, 1.1], col: "#ffffff", frame: "head", mirror: true, lo: true, only: "lowpoly" },
    { kind: "blob", d: 0, at: [-1, 5.2, 3.7], size: [3.6, 4.8, 1.8], rot: [0, 0, -0.35], col: SQ.base, frame: "head", mirror: true, lo: true, anim: "twitch" },
    { kind: "blob", d: 0, at: [-0.5, 5, 3.9], size: [2.3, 3.4, 0.9], rot: [0, 0, -0.35], col: SQ.pink, frame: "head", mirror: true, lo: true, anim: "twitch" },
    { kind: "stick", d: 0, at: [6.6, -1, 2.4], to: [5.4, -0.2, 9], size: [0.5, 0.15, 0], col: "#f0f0f0", frame: "head", mirror: true, only: "lowpoly" },
    { kind: "stick", d: 0, at: [6.6, -1.6, 2.4], to: [5.2, -2.4, 8.6], size: [0.5, 0.15, 0], col: "#f0f0f0", frame: "head", mirror: true, only: "lowpoly" },
  ],
  legs: (i) => ({
    len: 1.28, bend: i < 2 ? [-0.4, 0.4, 0.8] : [0.7, 0.3, 0.7], th: i < 2 ? [3.6, 2.8] : [4.8, 3.4], col: SQ.base, colLow: mix(SQ.base, SQ.belly, 0.4), joint: SQ.base, air: "stretch",
    paw: { size: [4, 2.2, 5], col: SQ.belly, toes: { n: 3, len: 2.6, th: 1.1, spread: 0.45, col: SQ.belly } },
  }),
  tail: { d0: 36, sway: 2.6, hz: 0.5, raise: 30, pow: 1.3, flatInGlide: true },
  membrane: { col: "#b9a68c", edge: "#8a7660" },
  head: { look: 0.5, nod: 0.15, bob: 0.08 },
  breathe: 0.05,
};

// ANT ------------------------------------------------------------------------------------------------
const AN = { dark: "#2e2218", thorax: "#8a4a28", leg: "#3a2a20", jaw: "#8a6a40" };
export const ANT_MODEL: Model = {
  level: true,
  stance: 1.1,
  tubes: [],
  atts: [
    { kind: "blob", d: 0, at: [1.2, 0.2, 0], size: [6.2, 5.4, 6.6], col: AN.dark, frame: "head" },
    { kind: "blob", d: 0, at: [2.4, 1.6, 2.8], size: [1.6, 1.8, 1.8], col: "#0a0806", frame: "head", mirror: true, lo: true },
    { kind: "cone", d: 0, at: [3.9, -0.9, 1.1], size: [1, 1, 3.2], rot: [0, -0.55, 0], col: AN.jaw, frame: "head", mirror: true, anim: "mandible", lo: true },
    { kind: "stick", d: 0, at: [3.2, 1.8, 1], to: [6, 3.6, 1.8], size: [0.55, 0.45, 0], col: AN.leg, frame: "head", mirror: true },
    { kind: "stick", d: 0, at: [6, 3.6, 1.8], to: [9.4, 2.2, 3.8], size: [0.45, 0.3, 0], col: AN.leg, frame: "head", mirror: true, anim: "antenna" },
    { kind: "blob", d: 8.2, at: [0.2, 1.5, 0], size: [4.2, 4.4, 4.4], col: AN.thorax, shade: 1.08 },
    { kind: "blob", d: 10.6, at: [0, 0.9, 0], size: [4.6, 4.8, 8.8], col: AN.thorax },
    { kind: "blob", d: 13, at: [-0.2, 1.3, 0], size: [3.4, 3.4, 3.6], col: AN.thorax, shade: 0.9 },
    { kind: "blob", d: 17.6, at: [0, 1, 0], size: [2, 2.4, 3.6], col: AN.dark, lo: true },
    { kind: "blob", d: 23.6, at: [0, 0.6, 0], size: [7.4, 7, 10.8], col: AN.dark },
    { kind: "blob", d: 24.4, at: [0, 1.6, 0], size: [5.4, 3.2, 7.5], col: "#4a3a2a", lo: true },
  ],
  legs: () => ({ len: 1.75, bend: [0, 1, 0.55], th: [0.95, 0.75, 0.5], ankle: 1.5, col: AN.leg, joint: AN.leg }),
  head: { look: 0.5, nod: 0.12, bob: 0.12 },
  breathe: 0,
};

// SPIDERS --------------------------------------------------------------------------------------------
const SP = { body: "#4a342a", abd: "#5c4232", pale: "#d0b080", leg: "#3a2a22", joint: "#7a5a44", eye: "#0c0c10" };
const ovoid = (d0: number, d1: number, rw: number, rh: number, k = 0.8) => (d: number): [number, number] => {
  const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  const b = Math.sin(Math.PI * Math.pow(t, k));
  return [rw * b + 0.1, rh * b + 0.1];
};
export const SPIDER_MODEL: Model = {
  level: true,
  stance: 1,
  tubes: [{
    d0: 15, d1: 37, step: 3, voxStep: 5.8, sides: 8, prof: ovoid(15, 37, 6.2, 5.6),
    color: (c) => (c.phi > 2.0 ? "#3a281e" : c.phi < 1.0 && c.i % 3 === 0 ? SP.pale : c.phi < 0.35 ? "#7a5a3a" : SP.abd),
  }],
  atts: [
    { kind: "blob", d: 5.5, at: [0, 0.9, 0], size: [10.4, 7, 14.5], col: SP.body },
    { kind: "blob", d: 13.4, at: [0, 0.8, 0], size: [3.2, 3, 4.4], col: SP.body, shade: 0.8, lo: true },
    { kind: "blob", d: 0, at: [1.6, 1.1, 0], size: [6.2, 5, 5.2], col: SP.body, shade: 1.05, frame: "head" },
    { kind: "blob", d: 0, at: [3.2, 3.2, 1.1], size: [1.8, 1.8, 1.8], col: SP.eye, frame: "head", mirror: true, lo: true },
    { kind: "blob", d: 0, at: [2.5, 3.6, 2.5], size: [1.4, 1.4, 1.4], col: SP.eye, frame: "head", mirror: true, lo: true },
    { kind: "blob", d: 0, at: [0.9, 3.7, 1.7], size: [1.2, 1.2, 1.2], col: SP.eye, frame: "head", mirror: true, lo: true },
    { kind: "cone", d: 0, at: [3.8, 0.2, 1.1], size: [1.6, 1.6, 3.2], rot: [-1.2, 0, 0], col: "#6a4430", frame: "head", mirror: true, lo: true },
    { kind: "stick", d: 0, at: [3.8, 0.8, 1.7], to: [7.2, -0.2, 2.6], size: [0.9, 0.6, 0], col: SP.body, frame: "head", mirror: true },
  ],
  legs: (i) => ({ len: 2.15, bend: [i < 2 ? 0.2 : -0.1, 1, 0.5], th: [1.9, 1.45, 0.9], split: 0.5, ankle: 3.6, col: SP.leg, joint: SP.joint, hide: undefined }),
  head: { look: 0.3, nod: 0.08, bob: 0.06 },
  breathe: 0.03,
};
const JP = { body: "#2b2330", abd: "#c4552a", abd2: "#e07a3a", fuzz: "#e8e0d0", leg: "#2b2330", ring: "#d8d0c0" };
export const JUMPER_MODEL: Model = {
  level: true,
  stance: 0.9,
  tubes: [{
    d0: 14, d1: 35, step: 3, voxStep: 5.6, sides: 8, prof: ovoid(14, 35, 6.4, 5.8, 0.85),
    color: (c) => (c.phi > 2.1 ? "#7a3420" : c.phi < 0.45 ? "#2b2330" : c.phi < 1.2 && c.i % 4 === 1 ? JP.abd2 : JP.abd),
  }],
  atts: [
    { kind: "blob", d: 5, at: [0, 1, 0], size: [9.6, 7, 12.5], col: JP.body },
    { kind: "blob", d: 12.4, at: [0, 0.8, 0], size: [3.2, 3, 4], col: JP.body, shade: 0.8, lo: true },
    { kind: "blob", d: 0, at: [1.4, 1.5, 0], size: [7.6, 6.2, 5.8], col: JP.body, shade: 1.1, frame: "head" },
    { kind: "blob", d: 0, at: [3.4, 0.1, 0], size: [6.8, 3.4, 2.8], col: JP.fuzz, frame: "head" },
    // two big forward eyes with a glint, a smaller pair above, tiny ones behind
    { kind: "blob", d: 0, at: [3.6, 1.9, 1.5], size: [3.4, 3.8, 2.4], col: "#0a0a10", frame: "head", mirror: true, lo: true, anim: "blink" },
    { kind: "blob", d: 0, at: [4.6, 2.6, 1.9], size: [0.9, 0.9, 0.7], col: "#9ab4d8", frame: "head", mirror: true, lo: true, only: "lowpoly" },
    { kind: "blob", d: 0, at: [2.2, 3.1, 3.4], size: [2.2, 2.2, 2.2], col: "#0a0a10", frame: "head", mirror: true, lo: true },
    { kind: "blob", d: 0, at: [-0.2, 3.9, 3], size: [1.3, 1.3, 1.3], col: "#0a0a10", frame: "head", mirror: true, lo: true },
    { kind: "stick", d: 0, at: [4, -0.8, 1.4], to: [6.8, -1.2, 2.2], size: [1, 0.7, 0], col: JP.fuzz, frame: "head", mirror: true },
  ],
  legs: (i) => ({ len: 1.78, bend: [i < 2 ? 0.2 : -0.1, 1, 0.5], th: [2.5, 1.9, 1.2], split: 0.5, ankle: 2.5, col: JP.leg, joint: JP.ring, air: "stretch" }),
  head: { look: 0.45, nod: 0.12, bob: 0.06 },
  breathe: 0.03,
};

// SNAKE ----------------------------------------------------------------------------------------------
const SN = { base: "#a48448", dark: "#4a321a", belly: "#ead9a8", head: "#8c6c3a" };
export const SNAKE_MODEL: Model = {
  tubes: [{
    d0: 8, d1: 634, step: 6.5, voxStep: 10, sides: 8,
    prof: (d, w) => {
      const m = 0.78 + 0.22 * smooth(10, 60, d);
      return [w * 0.95 * m, w * 0.85 * m];
    },
    color: (c) => {
      if (c.phi > 2.1) return SN.belly;
      const k = c.i % 6;
      if (c.phi < 0.9 && k < 3) return SN.dark; // dorsal diamonds
      if (c.phi >= 0.9 && k === 3) return mix(SN.dark, SN.base, 0.4); // flank spots
      return c.phi > 1.6 ? mix(SN.base, SN.belly, 0.3) : SN.base;
    },
  }],
  atts: [
    { kind: "blob", d: 0, at: [4.5, 0, 0], size: [10.4, 5, 17], col: SN.head, frame: "head" },
    { kind: "blob", d: 0, at: [11.6, -0.4, 0], size: [5.6, 3.6, 8], col: SN.head, shade: 1.06, frame: "head" },
    { kind: "blob", d: 0, at: [8, -2.2, 0], size: [6.4, 2.4, 11], col: SN.belly, frame: "head" },
    { kind: "blob", d: 0, at: [6.6, 2, 4], size: [2.8, 3, 2.8], col: "#e8c840", frame: "head", mirror: true, lo: true, anim: "blink" },
    { kind: "blob", d: 0, at: [7.2, 2.1, 4.9], size: [0.8, 2.4, 0.9], col: "#101010", frame: "head", mirror: true, lo: true, anim: "blink" },
    { kind: "stick", d: 0, at: [13.8, -1.2, 0], to: [27, -1.2, 0], size: [1.1, 0.8, 0], col: "#d8405a", frame: "head", anim: "tongue", pivot: [13.8, -1.2, 0], only: "lowpoly" },
    { kind: "stick", d: 0, at: [27, -1.2, 0], to: [32.5, -1.2, 3.2], size: [0.8, 0.4, 0], col: "#d8405a", frame: "head", anim: "tongue", pivot: [13.8, -1.2, 0], mirror: true, only: "lowpoly" },
  ],
  slither: { amp: 4.2, wave: 96, idle: 1.3, from: 22 },
  head: { look: 0.35, nod: 0.08, bob: 0.05 },
  breathe: 0.03,
};

// BEE ------------------------------------------------------------------------------------------------
const BE = { yellow: "#e8b830", dark: "#2a2018", fuzz: "#d8a828" };
export const BEE_MODEL: Model = {
  level: true,
  stance: 1,
  tubes: [{
    d0: 10, d1: 28.5, step: 2.6, voxStep: 4.6, sides: 8,
    prof: (d) => {
      const t = Math.min(1, Math.max(0, (d - 10) / 18.5));
      const b = Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.9))));
      return [4.1 * b + 0.1, 3.7 * b + 0.1];
    },
    color: (c) => (Math.floor((c.d - 10) / 3.4) % 2 === 0 ? BE.yellow : BE.dark),
  }],
  atts: [
    { kind: "blob", d: 0, at: [0.6, 0.2, 0], size: [4.8, 4.6, 4.4], col: BE.dark, frame: "head" },
    { kind: "blob", d: 0, at: [1.2, 0.9, 2.1], size: [2.1, 3, 2.8], col: "#3a2a28", frame: "head", mirror: true, lo: true },
    { kind: "stick", d: 0, at: [2, 1.6, 0.8], to: [4.8, 3.4, 1.8], size: [0.4, 0.3, 0], col: BE.dark, frame: "head", mirror: true, anim: "antenna" },
    { kind: "blob", d: 6.6, at: [0, 0.5, 0], size: [6.6, 6.2, 6.8], col: BE.fuzz },
    { kind: "blob", d: 6.6, at: [-0.4, 2.6, 0], size: [4.6, 2.4, 4.6], col: "#4a3420", lo: true },
    { kind: "cone", d: 28.5, at: [0, 0, 0], size: [1.4, 1.4, 2.6], rot: [0, Math.PI, 0], col: BE.dark, lo: true },
  ],
  legs: () => ({ len: 1.5, bend: [0, 1, 0.6], th: [0.95, 0.75, 0.5], ankle: 1, col: BE.dark, joint: BE.dark }),
  wings: {
    pairs: 2, d: 6.2, at: [0, 3, 1.2], alpha: 0.55,
    panels: [{ len: 9, chord: 5.4, shape: "bee1" }],
    pose: (m) => {
      const rest: V3 = [0.5, 1.5, 0]; // folded back over the abdomen
      const air: V3 = [0.15 + 0.9 * Math.sin(m.phase), 0.45 + (m.pair ? 0.35 : 0), 0.25 * Math.cos(m.phase)];
      return lerpV(rest, air, m.open);
    },
  },
  droop: { d0: 12, amount: 2.5 },
  head: { look: 0.3, nod: 0.1, bob: 0.06 },
  breathe: 0.03,
};
type V3 = V3t;
const lerpV = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// DRAGONFLY ------------------------------------------------------------------------------------------
const DR = { green: "#3a9a52", blue: "#2f8fd8", navy: "#1c3a58", eye: "#2f8ad0" };
export const DRAGONFLY_MODEL: Model = {
  level: true,
  stance: 1,
  tubes: [{
    d0: 12, d1: 60, step: 3.7, voxStep: 7.4, sides: 6,
    prof: (d) => {
      const seg = Math.sin(((d - 12) / 7.4) * Math.PI * 2);
      const r = 2.1 * (1 - 0.42 * smooth(12, 60, d)) * (1 + 0.16 * seg);
      return [r, r * 0.95];
    },
    color: (c) => (c.phi > 2.1 ? DR.navy : Math.floor((c.d - 12) / 7.4) % 2 === 0 ? DR.blue : DR.navy),
  }],
  atts: [
    { kind: "blob", d: 0, at: [0.8, 0, 0], size: [5.4, 5, 4.6], col: DR.green, frame: "head" },
    { kind: "blob", d: 0, at: [0.6, 1, 2.6], size: [3.8, 4.4, 4.6], col: DR.eye, frame: "head", mirror: true, lo: true },
    { kind: "blob", d: 0, at: [2.6, -0.6, 0], size: [3.8, 3.2, 2.4], col: "#d8e8a0", frame: "head", lo: true },
    { kind: "blob", d: 7.2, at: [0, 0.8, 0], size: [8.4, 8, 10.4], col: DR.green },
    { kind: "blob", d: 7.2, at: [0, 3.6, 0], size: [4, 2.2, 8], col: "#1c5a38", lo: true },
  ],
  legs: () => ({ len: 1.4, bend: [0.3, 0.8, 0.6], th: [0.95, 0.75], col: "#222a26", joint: "#222a26" }),
  wings: {
    pairs: 2, d: 7, at: [0.8, 3.2, 1.2], alpha: 0.5,
    panels: [{ len: 17.5, chord: 4.8, shape: "dragon1" }],
    pose: (m) => {
      const hind = m.pair === 1;
      const rest: V3 = [-0.1, hind ? 0.18 : -0.1, 0];
      const air: V3 = [0.5 * Math.sin(m.phase) * m.amp, hind ? 0.18 : -0.12, 0.12 * Math.cos(m.phase) * m.amp];
      return lerpV(rest, air, m.amp > 0.01 ? m.open : 0);
    },
  },
  head: { look: 0.4, nod: 0.08, bob: 0.04 },
  breathe: 0.02,
};

// BLUE JAY -------------------------------------------------------------------------------------------
const BJ = { blue: "#3b6fd0", deep: "#2a58b0", navy: "#1c2a4a", light: "#4a84e0", white: "#eef0f4" };
export const BLUEJAY_MODEL: Model = {
  level: true,
  stance: 1,
  tubes: [{
    d0: 6, d1: 52, step: 4.6, voxStep: 9, sides: 8,
    prof: (d, w) => {
      const tail = smooth(36, 52, d);
      return [w * 0.96 * (1 - 0.35 * tail), w * 0.92 * (1 - 0.35 * tail)];
    },
    color: (c) => {
      if (c.d > 8.5 && c.d < 14.5 && c.phi > 0.4) return BJ.navy; // black necklace
      if (c.phi > 1.55) return c.d > 44 ? "#dde0ea" : BJ.white;
      return c.phi < 0.6 ? BJ.deep : BJ.blue;
    },
  }],
  atts: [
    { kind: "blob", d: 0, at: [1, 0.8, 0], size: [9.6, 9.2, 10.6], col: BJ.blue, frame: "head" },
    { kind: "blob", d: 0, at: [3.4, -0.9, 3.6], size: [1.8, 3.4, 4.4], col: "#e8ecf4", frame: "head", mirror: true, lo: true },
    { kind: "cone", d: 0, at: [4.6, -0.4, 0], size: [3.6, 3.4, 7.4], col: "#1a1a1a", frame: "head" },
    { kind: "cone", d: 0, at: [4.4, -1.8, 0], size: [2.8, 2.2, 5.6], rot: [-0.06, 0, 0], col: "#262626", frame: "head", lo: true },
    { kind: "blob", d: 0, at: [2.6, 1.8, 4.1], size: [2.2, 2.4, 2.2], col: "#0a0a10", frame: "head", mirror: true, lo: true, anim: "blink" },
    // crest, swept back; a bigger centre feather
    { kind: "cone", d: 0, at: [-0.4, 4.2, 0], size: [3.6, 2.2, 7.2], rot: [2.05, 0, 0], col: BJ.light, frame: "head", anim: "crest" },
    { kind: "cone", d: 0, at: [0.6, 3.8, 1.6], size: [3, 2, 6], rot: [1.9, 0, -0.18], col: BJ.blue, frame: "head", mirror: true, anim: "crest" },
    // tail fan
    { kind: "plate", d: 44, at: [0, 0.4, 0], size: [30, 1, 9], rot: [-0.06, Math.PI / 2, 0], col: BJ.blue, plate: "jayTail", alpha: 1 },
  ],
  legs: () => ({
    len: 1.4, bend: [0.9, 0.3, 0.1], th: [1.8, 1.4], col: "#2a2a2a", joint: "#2a2a2a", hipOut: 0.7, hide: "flight",
    paw: { size: [2.6, 1.2, 3.2], col: "#2a2a2a", toes: { n: 3, len: 3.6, th: 1.1, spread: 0.5, col: "#2a2a2a" } },
  }),
  wings: {
    pairs: 1, d: 19, at: [1, 3.8, 3.4], alpha: 1,
    panels: [{ len: 15, chord: 13, shape: "jayArm" }, { len: 17, chord: 12, shape: "jayHand" }],
    pose: (m, pi) => {
      const rest: V3 = pi === 0 ? [-0.3, 1.45, 0] : [-0.12, 0.3, 0];
      const lag = pi === 0 ? 0 : 0.9;
      const air: V3 = pi === 0 ? [0.1 + 0.65 * m.amp * Math.sin(m.phase), 0.18, 0.05] : [0.05 + 0.95 * m.amp * Math.sin(m.phase - lag), 0.28, 0.1];
      return lerpV(rest, air, m.open);
    },
  },
  head: { look: 0.55, nod: 0.18, bob: 0.1 },
  breathe: 0.03,
};

export const MODELS: Record<string, Model> = {
  lizard: LIZARD_MODEL,
  cat: CAT_MODEL,
  squirrel: SQUIRREL_MODEL,
  ant: ANT_MODEL,
  spider: SPIDER_MODEL,
  jumper: JUMPER_MODEL,
  snake: SNAKE_MODEL,
  bee: BEE_MODEL,
  dragonfly: DRAGONFLY_MODEL,
  bluejay: BLUEJAY_MODEL,
};

