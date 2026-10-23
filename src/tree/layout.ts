/**
 * tree/layout.ts — the vault as a FOREST: LibraryTree → 3D branches and leaves.
 *
 * Pure and deterministic (all jitter comes from a hash of the note id), so the
 * forest looks the same on every visit and only changes where the vault changed.
 *
 *   root note                   → the HUB: a short fat stump straight up from the origin (its own notes are leaves on it)
 *   top-level folder            → its OWN TREE: a trunk growing from the hub's END, fanned evenly around it, leaving
 *                                 nearly horizontally and arching up ("root arch") so the trunk bases are well apart
 *   folder (note with children) → a branch (side branch of its parent folder)
 *   note without children       → a leaf standing on its parent's branch
 *   notes + depth of the subtree → branch thickness; subtree size → branch length
 *   #color / first tag          → leaf colour (else the tree species' leaf colour)
 *
 * Every folder branch has EIGHT PROPERTIES (PropKey): length, thickness, taper, spin (azimuth), pitch, attach, bend and
 * species. Each has a CALCULATED value (the formulas below, modulated by the species) and an optional OVERRIDE (a label
 * on the folder note, see PROP_LABELS, or an explicit `opts.overrides` entry); `eff = override ?? calc`. Geometry is built
 * from `eff`, children from the EFFECTIVE geometry of their parent; a branch's `calc` never depends on its own numeric
 * overrides, so a UI can always show "calculated: X" and "reset" restores exactly X. (The species is the exception that
 * proves the rule: it selects the formula set, so overriding it changes the other calculated values — but never
 * `calc.species`.)
 */

import { NOISE_LABELS, isRoom, stableColor } from "../lib/library";
import { BIBLIO_PREFIX, LABELS } from "../config";
import type { LibraryTree, NoteInfo } from "../types";
import { leafKindFor, type LeafKind } from "./leafkind";
import { SPECIES, hash01, parseSpeciesKey, speciesForest, type SpeciesKey } from "./species";
import { applyWave, effectiveFreq, parseWaveFn, type WaveFn } from "./wave";
import { crownOf, placeTrees, rootPath, type Crown } from "./forest";
import {
  addBranch, frameAt, makeBranch, norm, radiusAt, smoothPath, v3, add, cross, dot, mul, wrapAngle,
  type Branch, type Frame, type V3, type World,
} from "./world3";

export { WAVE_FNS, WAVE_LABELS, parseWaveFn, waveShape, type WaveFn } from "./wave";

/**
 * `hub` = the original layout: the root note is a stump the trees' trunks arch out of (walk down one trunk, up another).
 * `forest` = every top-level folder is its own tree standing in the ground around the root's central stump, joined to it by
 * GROUND ROOTS (ordinary rails: `Branch.root`). `layoutTree` defaults to `hub` (old callers unchanged); the app's default is `forest`.
 */
export type LayoutMode = "hub" | "forest";
export const LAYOUT_MODES: readonly LayoutMode[] = ["forest", "hub"];
export const DEFAULT_LAYOUT_MODE: LayoutMode = "forest";
/** A mode from stored / user text; anything unknown -> null. */
export function parseLayoutMode(v: unknown): LayoutMode | null {
  return v === "hub" || v === "forest" ? v : null;
}

export interface Leaf {
  /** The note id. */
  id: string;
  branchId: string;
  s: number;
  th: number;
  color: string;
  title?: string;
  /** Leaf style: by note type, or the #biblio_leaf override. */
  kind: LeafKind;
  /** leafScale multiplier; layout always sets 1, measured sizes arrive later (lib/leafsize.ts). */
  size: number;
  /** Trilium note type. */
  type: string;
}

/** The editable properties of a branch. */
export type PropKey = "length" | "thickness" | "taper" | "spin" | "pitch" | "attach" | "bend" | "species" | "wave" | "waveFreq" | "waveFn";
/** The text-valued properties (the rest are numbers with a `PROP_RANGES` entry). */
export type EnumPropKey = "species" | "waveFn";
export type NumPropKey = Exclude<PropKey, EnumPropKey>;

export interface BranchProps {
  /** Centreline length, px. */
  length: number;
  /** Start radius, px. */
  thickness: number;
  /** End radius / start radius. */
  taper: number;
  /**
   * Rotation around the parent ("side"; the property used to be called azimuth / "spiral"): where on the parent's circumference
   * the branch leaves, in degrees from the parent's top ("u" axis) towards its "b" axis; [0, 360). For a trunk the parent is the
   * hub / the vertical (the direction it leans: 0 = +z, 90 = +x). The key stays `spin` (label `biblio_bspin`).
   */
  spin: number;
  /** Degrees off the parent's direction (a trunk: off the hub's vertical). */
  pitch: number;
  /** Where it leaves the parent, 0..1 of the parent's length (1 and ignored for trunks, which start at the hub's end). */
  attach: number;
  /** -1 droops .. +1 lifts. */
  bend: number;
  species: SpeciesKey;
  /** Wave amplitude: sideways swing of the centreline as a FRACTION of the branch's length (0 = straight). */
  wave: number;
  /** Wave frequency: cycles along the branch. */
  waveFreq: number;
  /** Wave shape. */
  waveFn: WaveFn;
}

export interface BranchInfo {
  id: string;
  /** What the usual calculation gives (never depends on this branch's own numeric overrides). */
  calc: BranchProps;
  /** What is used: `override ?? calc`. */
  eff: BranchProps;
  /** The properties that currently have an override (label or `opts.overrides`). */
  overridden: ReadonlySet<PropKey>;
}

export interface TreeLayout {
  world: World;
  leaves: Leaf[];
  /** The hub (the root note's stump). */
  rootBranchId: string;
  /** The mode this layout was built in. */
  mode: LayoutMode;
  /** noteId of the folder → its parent folder (null for the root); for breadcrumbs. Ground roots (`root:<tree>`) map to the root note. */
  parentOf: Map<string, string | null>;
  /** Every branch (the hub included): calculated, effective and overridden properties. */
  info: Map<string, BranchInfo>;
  /** The crown limbs (forest layout): one per place asked for, `branchId` = `place:<id>`. */
  places: Array<{ id: string; title: string; branchId: string }>;
}

export const PROP_KEYS: readonly PropKey[] = ["length", "thickness", "taper", "spin", "pitch", "attach", "bend", "species", "wave", "waveFreq", "waveFn"];

/** The label that stores each property's override on the folder note. */
export const PROP_LABELS: Record<PropKey, string> = {
  length: LABELS.branchLength,
  thickness: LABELS.branchThickness,
  taper: LABELS.branchTaper,
  spin: LABELS.branchSpin,
  pitch: LABELS.branchPitch,
  attach: LABELS.branchAttach,
  bend: LABELS.branchBend,
  species: LABELS.species,
  wave: LABELS.branchWave,
  waveFreq: LABELS.branchWaveFreq,
  waveFn: LABELS.branchWaveFn,
};

/** Accepted range of each numeric property (overrides are clamped to it; `spin` wraps); also the UI slider ranges. */
export const PROP_RANGES: Record<NumPropKey, { min: number; max: number; step: number; unit: string }> = {
  length: { min: 20, max: 9000, step: 10, unit: "px" },
  thickness: { min: 3, max: 150, step: 0.5, unit: "px" },
  taper: { min: 0.05, max: 1, step: 0.01, unit: "" }, // tips of terminal branches are pointed (~0.1)
  spin: { min: 0, max: 360, step: 1, unit: "deg" },
  pitch: { min: 0, max: 110, step: 1, unit: "deg" },
  attach: { min: 0.03, max: 0.97, step: 0.01, unit: "" },
  bend: { min: -1, max: 1, step: 0.05, unit: "" },
  wave: { min: 0, max: 0.3, step: 0.005, unit: "" },
  waveFreq: { min: 0.25, max: 12, step: 0.25, unit: "" },
};

/** A plain decimal number from user text (`12`, `-3.5`, `1e3`, `2,5`); anything else, and non-finite results, -> null. */
function parseNum(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(",", ".");
  if (t.length === 0 || t.length > 40 || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * One property value from user input (label text, or a number/string from the UI): numbers are clamped to
 * PROP_RANGES (spin wraps into [0, 360)), species keys are validated case-insensitively; garbage / non-finite -> null.
 */
export function sanitizeProp(key: PropKey, raw: unknown): number | SpeciesKey | WaveFn | null {
  if (key === "species") return parseSpeciesKey(raw);
  if (key === "waveFn") return parseWaveFn(raw);
  const v = parseNum(raw);
  if (v === null) return null;
  const r = PROP_RANGES[key];
  if (key === "spin") return ((v % 360) + 360) % 360 || 0;
  return Math.min(r.max, Math.max(r.min, v)) || 0;
}

/** The overrides a folder note carries (own labels only): valid ones, clamped; missing, garbage and non-finite ones are ignored. Never throws. */
export function parseOverrides(note: NoteInfo): Partial<BranchProps> {
  const out: Record<string, number | SpeciesKey | WaveFn> = {};
  const labels = note && typeof note === "object" && note.labels && typeof note.labels === "object" ? note.labels : {};
  for (const key of PROP_KEYS) {
    const raw = labels[PROP_LABELS[key]];
    if (raw === undefined) continue;
    const v = sanitizeProp(key, raw);
    if (v !== null) out[key] = v;
  }
  return out as Partial<BranchProps>;
}

/** A leaf's pinned placement from `biblio_lat` = `s,th` (s = fraction 0..1 along the branch, th = degrees around it, 0 = top); null when absent or invalid. */
export function parseLeafAt(note: NoteInfo): { s: number; th: number } | null {
  const raw = note && typeof note === "object" && note.labels && typeof note.labels === "object" ? note.labels[LABELS.leafAt] : undefined;
  if (typeof raw !== "string" || raw.length > 80) return null;
  const parts = raw.split(/[,;\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const s = parseNum(parts[0]);
  const th = parseNum(parts[1]);
  if (s === null || th === null) return null;
  return { s: Math.min(1, Math.max(0, s)) || 0, th: (((th % 360) + 360) % 360 || 0) };
}

/** Deterministic pseudo-random in [0,1) from an id and a salt. */
const rnd = (id: string, salt: number): number => {
  const x = Math.sin((hash01(id) * 1e5 + salt * 91.7) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const GOLDEN = 2.399963229728653;
const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Kids = Map<string, string[]>;

/** Number of notes in the subtree (itself included); cycle-safe. */
function subtreeSizes(kidsOf: Kids, rootId: string): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const size = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 1;
    visiting.add(id);
    let n = 1;
    for (const c of kidsOf.get(id) ?? []) n += size(c);
    visiting.delete(id);
    memo.set(id, n);
    return n;
  };
  size(rootId);
  return memo;
}

/** Per folder: leaf notes in its whole subtree and the height of its folder subtree (0 = only notes); cycle-safe. */
function subtreeShapes(tree: LibraryTree, kidsOf: Kids): Map<string, { notes: number; height: number }> {
  const memo = new Map<string, { notes: number; height: number }>();
  const visiting = new Set<string>();
  const shape = (id: string): { notes: number; height: number } => {
    const known = memo.get(id);
    if (known) return known;
    if (visiting.has(id)) return { notes: 0, height: 0 };
    visiting.add(id);
    let notes = 0;
    let height = 0;
    for (const c of kidsOf.get(id) ?? []) {
      if (isRoom(tree, c)) {
        const sub = shape(c);
        notes += sub.notes;
        height = Math.max(height, sub.height + 1);
      } else notes++;
    }
    visiting.delete(id);
    const res = { notes, height };
    memo.set(id, res);
    return res;
  };
  shape(tree.rootNoteId);
  return memo;
}

function leafColor(n: NoteInfo, fallback: string): string {
  const c = n.labels[LABELS.color];
  if (c && /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$|^[a-zA-Z]+$/.test(c)) return /^[0-9a-fA-F]{3,8}$/.test(c) ? `#${c}` : c;
  const tag = Object.keys(n.labels).find((k) => !NOISE_LABELS.has(k) && !k.startsWith(BIBLIO_PREFIX) && k !== LABELS.color);
  return tag ? stableColor(tag) : fallback;
}

/** Two unit vectors perpendicular to d (and to each other). */
function basis(d: V3): [V3, V3] {
  const ref = Math.abs(d.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const e1 = norm(cross(d, ref));
  return [e1, norm(cross(d, e1))];
}

const MAX_DEPTH = 12;
/** Along-branch room one leaf slot takes; large leaves (scale up to 2) still clear their neighbours. */
const LEAF_SLOT = 56;
/** A branch's rise never grows longer than this, however many sub-folders it carries. */
const MAX_LENGTH = 2400;
/** Shortest calculated side branch / trunk rise. */
const MIN_SIDE = 140;
const MIN_RISE = 180;

/** No branch starts thinner than this (it also keeps the taper `rEnd` >= 4 below `r`). */
const MIN_RADIUS = 4.5;

/** Pointed tips: a branch with no sub-folder ends at `TIP_K x` its start radius (species-sharper: 0.25 x taper, 0.07..0.15), never thinner than TIP_MIN px. */
const TIP_MIN = 1.2;
const tipFactor = (taper: number): number => clamp(0.25 * taper, 0.07, 0.15);

/** The calculated wave amplitude is this x the species' `sway` (a fraction of the length; trunks x0.6): a gentle natural wobble. */
const WAVE_PER_SWAY = 0.012;
/** The trunk of a forest tree starts this much above the ground (2.2 x its radius + 6): the root sweeps up into it in a wide buttress-like knee. */
const footHeight = (r: number): number => 2.2 * r + 6;
/** Unit frame of a forest trunk's "parent": straight up, top = +z (as the hub's frame is). */
const VERT: Frame = { p: v3(0, 0, 0), t: v3(0, 1, 0), u: v3(0, 0, 1), b: v3(1, 0, 0) };

/** A side branch always starts at least this far upwards (y of its unit direction): trees reach for the light. */
const MIN_UP = 0.12;

/** bend (-1..1) x this x length x t^2 = the vertical offset of the centreline at fraction t (the classic droop 0.07 = bend -0.2). */
const BEND_SCALE = 0.35;

// the hub: a short fat stump the trees grow from
const HUB_BASE = 90;
const HUB_PER_NOTE = 30;
const HUB_MAX = 700;
const HUB_MIN_R = 18;
const HUB_R_OVER_TRUNK = 1.1;
const HUB_TAPER = 0.95;
const HUB_SPECIES: SpeciesKey = "oak";

// the world tree (the hub in FOREST mode): the root note's trunk is a giant that towers over the forest, its crown carries the places
/** Its rise; the other trees are at most MAX_LENGTH (2400) of trunk, so it stands well above them. */
export const YGG_LENGTH = 3200;
/** Trunk radius: at least this, or this x the thickest other trunk. */
export const YGG_MIN_R = 190;
export const YGG_R_OVER_TRUNK = 3;
export const YGG_MAX_R = 320;
const YGG_TAPER = 0.18;
/** Extra free ground around the world tree beyond its radius (the other trees stand "a bit further away"). */
export const YGG_CLEAR = 260;
/** Crown limbs: where on the trunk they leave (fractions of its length) and how long they are. */
const CROWN_FROM = 0.5;
const CROWN_TO = 0.92;
const CROWN_LEN = 900;
/** LOW places (the porch, the wisp's branch ...): a few steps up the trunk, above the roots' zones, nearly horizontal and sturdy. */
export const LOW_FROM = 190;
export const LOW_STEP = 80;
const LOW_LEN = 430;

/** A place on a limb of the world tree (a point of interest, game mode or tool; see tree/places.ts): one limb each. `slot` low = near the foot, crown = high up. */
export interface CrownPlace {
  id: string;
  title: string;
  slot?: "low" | "crown";
}

/** Root-arch horizontal run: max(200, 70 per tree); beyond 30 trees it is only as large as the trunk thickness needs. */
const ARCH_MIN = 200;
const ARCH_PER_TREE = 70;
const ARCH_FLAT = 70 * 30;
/** Trunk bases at least this many diameters apart (3 is the promise, the rest is margin for jitter and sway). */
const SPACING_DIAMETERS = 3 * 1.7;

/**
 * Start radius of a folder branch: grows with the notes it carries (cube root) and with how many folder levels hang
 * below it, never with its own depth (a 2-note twig ~10, a 20-note folder with a sub-level ~20, a 400-note trunk 45-60).
 * Monotonic: more notes or more levels never thin a branch. A branch with sub-folders stays >= 11 so that its children
 * (cap 0.85 x the radius where they grow out, floor 5) have something to grow from.
 */
function radiusFor(notes: number, height: number, hasFolders: boolean, trunk: boolean): number {
  const r = Math.max(hasFolders ? 11 : 6, 4 + 4.6 * Math.cbrt(notes) + 3 * height);
  return trunk ? r * 1.15 : r;
}

/** Unit direction leaving a parent frame: `pitch` degrees off its tangent, `spin` degrees around it (0 = the frame's top). */
function direction(f: Frame, pitchDeg: number, spinDeg: number): V3 {
  const p = pitchDeg * DEG;
  const a = spinDeg * DEG;
  const side = add(mul(f.u, Math.cos(a)), mul(f.b, Math.sin(a)));
  return norm(add(mul(f.t, Math.cos(p)), mul(side, Math.sin(p))));
}

/** Keep a direction pointing at least MIN_UP upwards without changing its azimuth; idempotent. */
function lift(d: V3): V3 {
  if (d.y >= MIN_UP) return d;
  const h = Math.hypot(d.x, d.z) || 1;
  const k = Math.sqrt(1 - MIN_UP * MIN_UP) / h;
  return v3(d.x * k, MIN_UP, d.z * k);
}

/**
 * The root arch in unit steps: a direction starting `pitchDeg` off vertical eases towards up by `tau` per step until it
 * is nearly vertical; `run` = horizontal distance covered, `arc` = number of steps (the same recurrence `trace` walks).
 */
function archUnits(pitchDeg: number, tau: number): { run: number; arc: number } {
  let x = Math.sin(pitchDeg * DEG);
  let y = Math.cos(pitchDeg * DEG);
  let run = 0;
  let arc = 0;
  while (y < 0.96 && arc < 80) {
    run += x;
    arc++;
    x -= x * tau;
    y += (1 - y) * tau;
    const l = Math.hypot(x, y) || 1;
    x /= l;
    y /= l;
  }
  return { run, arc };
}

/** Tropism of a trunk: eases up faster than its branches (an arch rises instead of sprawling). */
const trunkTropism = (tropism: number): number => clamp(0.14 + 0.5 * tropism, 0.1, 0.3);
/** Arch step length bounds (px); the step is `run / unitsRun`. */
const ARCH_SEG_MIN = 40;
const ARCH_SEG_MAX = 700;
const archSeg = (run: number, units: { run: number }): number => clamp(run / Math.max(units.run, 0.5), ARCH_SEG_MIN, ARCH_SEG_MAX);

/** The explicit-override input of `layoutTree`: per note id, per property: a value, `null` = force the calculated one, absent = the label (if any). */
export type ExplicitOverrides = ReadonlyMap<string, Partial<Record<PropKey, number | string | null>>>;

type Role =
  | { kind: "trunk"; i: number; n: number; run: number; calcSp: SpeciesKey; az: number; forest?: boolean }
  | { kind: "side"; i: number; n: number; inherited: SpeciesKey; parentIdx: number; sCalc: number };

export function layoutTree(tree: LibraryTree, opts: { overrides?: ExplicitOverrides; mode?: LayoutMode; places?: readonly CrownPlace[]; crown?: boolean } = {}): TreeLayout {
  const mode: LayoutMode = opts.mode === "forest" ? "forest" : "hub";
  const world: World = { branches: new Map(), groundY: 0 }; // the hub grows from y = 0
  const leaves: Leaf[] = [];
  const parentOf = new Map<string, string | null>();
  const info = new Map<string, BranchInfo>();
  const kidsOf: Kids = new Map();
  for (const e of tree.edges) {
    if (!tree.notes[e.noteId]) continue;
    const list = kidsOf.get(e.parentNoteId);
    if (list) list.push(e.noteId);
    else kidsOf.set(e.parentNoteId, [e.noteId]);
  }
  const sizes = subtreeSizes(kidsOf, tree.rootNoteId);
  const shapes = subtreeShapes(tree, kidsOf);
  const r0Of = (id: string, trunk: boolean): number => {
    const sh = shapes.get(id) ?? { notes: 0, height: 0 };
    return radiusFor(sh.notes, sh.height, sh.height > 0, trunk);
  };
  const seen = new Set<string>();

  // overrides: the folder's own labels, then explicit entries on top (null = ignore the label for that property)
  const ovMemo = new Map<string, Partial<BranchProps>>();
  const ovFor = (id: string): Partial<BranchProps> => {
    const known = ovMemo.get(id);
    if (known) return known;
    const note = tree.notes[id];
    const out: Record<string, number | SpeciesKey | WaveFn> = note ? { ...parseOverrides(note) } : {};
    const ex = opts.overrides?.get(id);
    if (ex) {
      for (const key of PROP_KEYS) {
        const raw = ex[key];
        if (raw === null) delete out[key];
        else if (raw !== undefined) {
          const v = sanitizeProp(key, raw);
          if (v !== null) out[key] = v;
        }
      }
    }
    ovMemo.set(id, out as Partial<BranchProps>);
    return out as Partial<BranchProps>;
  };
  const used = (ov: Partial<BranchProps>, ...skip: PropKey[]): Set<PropKey> =>
    new Set(PROP_KEYS.filter((k) => ov[k] !== undefined && !skip.includes(k)));

  /** Centreline: `k` segments of `seg` px along `dir0`, the direction easing towards up by `tau` per segment, then sway and bend offsets. */
  const trace = (id: string, start: V3, dir0: V3, k: number, seg: number, tau: number, sway: number, swayMul: number, bend: number, floorY: number): V3[] => {
    const length = k * seg;
    const ctrl: V3[] = [start];
    let p = start;
    let d = dir0;
    const up = v3(0, 1, 0);
    const amp = 0.714 * sway * swayMul * seg * Math.min(1, Math.sqrt(3 / k));
    for (let j = 1; j <= k; j++) {
      p = add(p, mul(d, seg));
      let q = p;
      if (j < k) {
        const [e1, e2] = basis(d);
        q = add(q, add(mul(e1, (rnd(id, j) - 0.5) * amp), mul(e2, (rnd(id, j + 7) - 0.5) * amp)));
      }
      const t = j / k;
      q = add(q, v3(0, BEND_SCALE * bend * length * t * t, 0));
      ctrl.push(v3(q.x, Math.max(q.y, floorY), q.z));
      d = norm(add(d, mul(add(up, mul(d, -1)), tau)));
    }
    return ctrl;
  };

  /** Leaves (the notes of this folder): spread along the branch on both sides, in rows when crowded; `biblio_lat` pins one. */
  const placeLeaves = (branch: Branch, noteLeaves: string[], fallback: string): void => {
    const m = noteLeaves.length;
    if (m === 0) return;
    const usable = branch.total * 0.88;
    const perRow = Math.max(1, Math.floor(usable / LEAF_SLOT));
    const rows = Math.ceil(m / perRow);
    noteLeaves.forEach((nid, j) => {
      const note = tree.notes[nid];
      const pin = parseLeafAt(note);
      let s: number;
      let th: number;
      if (pin) {
        s = clamp(pin.s * branch.total, Math.min(8, branch.total / 2), Math.max(branch.total - 8, 1));
        th = wrapAngle(pin.th * DEG);
      } else {
        const row = j % rows;
        const col = Math.floor(j / rows);
        const colsInRow = Math.ceil(m / rows);
        s = Math.min(branch.total - 8, branch.total * 0.08 + (usable * (col + 0.5 + (row % 2) * 0.3)) / (colsInRow + 0.3));
        const side = j % 2 === 0 ? 1 : -1;
        th = side * (1.0 + 0.32 * Math.floor(row / 1) + 0.25 * rnd(nid, 3));
      }
      leaves.push({ id: nid, branchId: branch.id, s, th, color: leafColor(note, fallback), title: note.title,
        kind: leafKindFor(note.type, note.labels[LABELS.leaf]), size: 1, type: note.type });
    });
  };

  /** Where along a trunk the arch is done and it rises (arc length at the first tangent with y >= 0.9); 0 for everything else. */
  const riseStart = new Map<string, number>();

  const grow = (id: string, par: Branch, role: Role, depth: number): void => {
    if (seen.has(id)) return; // clones: grown once, under their first parent
    seen.add(id);
    const ov = ovFor(id);
    const trunk = role.kind === "trunk";
    const calcSp = role.kind === "trunk" ? role.calcSp : role.inherited;
    const spKey = ov.species ?? calcSp;
    const sp = SPECIES[spKey];
    const kids = (kidsOf.get(id) ?? []).filter((c) => tree.notes[c]);
    const folders = kids.filter((c) => isRoom(tree, c));
    const noteLeaves = kids.filter((c) => !isRoom(tree, c));
    const w = sizes.get(id) ?? 1;
    const own = 130 + 42 * Math.sqrt(w) + 9 * noteLeaves.length;
    // side branches need room: neighbours at least `gap` apart along the parent, so crowded folders grow longer
    const gap = Math.max(170, 3.2 * Math.max(0, ...folders.map((f) => r0Of(f, false) * sp.branchR)));
    const attSpan = Math.max(0.2, sp.attachTo - sp.attachFrom);
    const roomy = folders.length > 0 ? (folders.length * gap * 1.05) / attSpan : 0;

    // ---- calculated values (species-modulated; none of them reads this branch's own numeric overrides) ----
    let calcLength: number;
    let calcR: number;
    if (trunk) {
      calcLength = Math.min(MAX_LENGTH, Math.max(MIN_RISE, own * 1.15 * sp.trunkLen + 90 * folders.length, roomy)); // the rise; the arch is added below
      calcR = Math.max(MIN_RADIUS, 5, r0Of(id, true) * sp.trunkR);
    } else {
      const decay = Math.pow(sp.lengthDecay, depth);
      calcLength = Math.min(MAX_LENGTH, Math.max(MIN_SIDE, own * (decay + 0.15) * sp.childLen + 90 * folders.length, roomy));
      const sCalc = (role as Extract<Role, { kind: "side" }>).sCalc;
      // never fatter than 0.85 x where it grows from; the 4.5 floor only beats the cap at the thin tail of deep chains
      const cap = 0.85 * radiusAt(par, sCalc);
      calcR = Math.max(MIN_RADIUS, Math.min(Math.max(5, r0Of(id, false) * sp.branchR), cap));
    }
    // a branch with no sub-folder ends in a point; one that carries sub-folders keeps a thicker end for them to grow from
    const terminal = folders.length === 0;
    const calcREnd = terminal ? Math.max(TIP_MIN, Math.min(0.9 * calcR, tipFactor(sp.taper) * calcR)) : Math.min(0.9 * calcR, Math.max(4, sp.taper * calcR));
    const calcTaper = calcREnd / calcR;
    const calcBend = trunk ? 0 : -sp.droop;
    const tau = trunk ? trunkTropism(sp.tropism) : sp.tropism;

    // direction in the parent's frame: trunk = fanned around the hub; side = golden / whorl / alternate azimuth
    let calcPitch: number;
    let calcSpin: number;
    let calcAttach: number;
    if (role.kind === "trunk") {
      calcPitch = role.n >= 2 && !role.forest ? 76 + 8 * rnd(id, 2) : 3 + 6 * rnd(id, 2);
      calcSpin = role.forest ? rnd(id, 1) * 360 : ((role.az / DEG) % 360 + 360) % 360;
      calcAttach = 1;
    } else {
      calcAttach = role.sCalc / par.total;
      const fc = frameAt(par, role.sCalc);
      const i = role.i;
      let az: number;
      if (sp.azimuthRule === "whorl") az = (i % 3) * ((2 * Math.PI) / 3) + Math.floor(i / 3) * (Math.PI / 3) + role.parentIdx * 0.5 + (rnd(id, 1) - 0.5) * 0.3;
      else if (sp.azimuthRule === "alternate") az = i * Math.PI + (rnd(id, 1) - 0.5) * 0.6 + role.parentIdx;
      else az = i * GOLDEN + rnd(id, 1) * 0.8 + role.parentIdx;
      const pitch0 = (sp.pitchMin + (sp.pitchMax - sp.pitchMin) * rnd(id, 2)) * DEG;
      const [u, b] = [fc.u, fc.b];
      const side = add(mul(u, Math.cos(az)), mul(b, Math.sin(az)));
      let cd = add(mul(fc.t, Math.cos(pitch0)), mul(side, Math.sin(pitch0)));
      cd = lift(norm(add(cd, v3(0, sp.upBias, 0)))); // trees reach for the light
      calcPitch = Math.acos(clamp(dot(cd, fc.t), -1, 1)) / DEG;
      calcSpin = ((Math.atan2(dot(cd, b), dot(cd, u)) / DEG) % 360 + 360) % 360;
    }
    // the root arch (trunks of a forest): horizontal run `run`, so the trunk's calculated length = rise + arch
    let archLen = 0;
    if (role.kind === "trunk" && role.n >= 2 && !role.forest) {
      const u0 = archUnits(calcPitch, tau);
      archLen = u0.arc * archSeg(role.run, u0);
    }
    // wave: a gentle natural wobble by default (amplitude from the species' sway, trunks calmer); never reads this branch's own overrides
    const calcWave = Math.round(clamp(WAVE_PER_SWAY * sp.sway * (trunk ? 0.6 : 1), 0, PROP_RANGES.wave.max) * 1000) / 1000;
    const calcWaveFn: WaveFn = sp.waveFn ?? "noise";
    const calcWaveFreq = clamp(Math.round(((calcLength + archLen) / 280) * 4) / 4, 0.5, 6);
    const calc: BranchProps = {
      length: calcLength + archLen, thickness: calcR, taper: calcTaper, spin: calcSpin, pitch: calcPitch,
      attach: calcAttach, bend: calcBend, species: calcSp, wave: calcWave, waveFreq: calcWaveFreq, waveFn: calcWaveFn,
    };

    // ---- effective values ----
    const eff: BranchProps = {
      length: ov.length ?? calc.length,
      thickness: ov.thickness ?? calc.thickness,
      taper: ov.taper ?? calc.taper,
      spin: ov.spin ?? calc.spin,
      pitch: ov.pitch ?? calc.pitch,
      attach: trunk ? 1 : ov.attach ?? calc.attach,
      bend: ov.bend ?? calc.bend,
      species: spKey,
      wave: ov.wave ?? calc.wave,
      waveFreq: ov.waveFreq ?? calc.waveFreq,
      waveFn: ov.waveFn ?? calc.waveFn,
    };
    const r = eff.thickness;
    const rEnd = ov.taper === undefined && ov.thickness === undefined ? calcREnd : Math.max(TIP_MIN, Math.min(r, eff.taper * r));

    // start point and initial direction from the EFFECTIVE parent geometry
    let start: V3;
    let dir: V3;
    let attachS: number | undefined;
    let k: number;
    let seg: number;
    if (role.kind === "trunk") {
      const f = role.forest ? VERT : frameAt(par, par.total);
      start = role.forest ? v3(0, footHeight(r), 0) : f.p; // a forest tree grows around its own origin first and is moved into place afterwards
      dir = lift(direction(f, eff.pitch, eff.spin));
      attachS = undefined;
      if (role.n >= 2 && !role.forest) {
        const ue = archUnits(eff.pitch, tau);
        const segHint = archSeg(role.run, ue);
        k = clamp(Math.round(eff.length / segHint), 3, 80);
      } else k = clamp(Math.round(eff.length / 260), 3, 12);
      seg = eff.length / k;
    } else {
      attachS = clamp(eff.attach, PROP_RANGES.attach.min, PROP_RANGES.attach.max) * par.total;
      const f = frameAt(par, attachS);
      start = f.p;
      dir = lift(direction(f, eff.pitch, eff.spin));
      k = clamp(Math.round(eff.length / 260), 3, 12);
      seg = eff.length / k;
    }
    const sway = trunk && role.kind === "trunk" && role.n >= 2 && !role.forest ? 0.3 : 1; // an arch keeps its spacing; the wobble starts above it
    const ctrl = trace(id, start, dir, k, seg, tau, sp.sway, sway, eff.bend, r + 4);
    // the wave displaces the dense centreline sideways (0 at the base); sampled finely enough to resolve its wavelength
    const waving = eff.waveFn !== "none" && eff.wave > 0;
    let path = smoothPath(ctrl, waving ? clamp(eff.length / (effectiveFreq(eff.waveFreq, eff.length) * 10), 5, 22) : 22);
    if (waving) {
      path = applyWave(path, eff.waveFn, eff.wave, eff.waveFreq, rnd(id, 13), rnd(id, 14) * Math.PI);
      for (const p of path) if (p.y < 4) p.y = 4;
    }
    // a forest trunk's parent is its ground root (added later, which then lists the trunk in `next`)
    const parentId = role.kind === "trunk" && role.forest ? `root:${id}` : par.id;
    const branch = makeBranch(id, path, r, parentId, attachS, rEnd);
    branch.species = spKey;
    addBranch(world, branch);
    parentOf.set(id, role.kind === "trunk" && role.forest ? tree.rootNoteId : par.id);
    if (trunk) {
      let i = 0;
      while (i < branch.T.length - 1 && branch.T[i].y < 0.9) i++;
      riseStart.set(id, branch.T[i].y >= 0.9 ? branch.cum[i] : 0);
    }
    info.set(id, { id, calc, eff, overridden: used(ov, ...(trunk ? (["attach"] as PropKey[]) : [])) });

    placeLeaves(branch, noteLeaves, sp.leaf.color);

    // sub-folders: side branches leaving at spread-out points of the rising part, fanned around the parent direction
    const r0 = riseStart.get(id) ?? 0;
    const idx = role.i;
    folders.forEach((fid, i) => {
      const t = sp.attachFrom + (attSpan * (i + 0.5)) / folders.length;
      const sCalc = r0 + (branch.total - r0) * t;
      grow(fid, branch, { kind: "side", i, n: folders.length, inherited: spKey, parentIdx: idx, sCalc }, Math.min(MAX_DEPTH, depth + 1));
    });
  };

  // ---- the hub ----
  const rootId = tree.rootNoteId;
  seen.add(rootId);
  const rootKids = (kidsOf.get(rootId) ?? []).filter((c) => tree.notes[c] && c !== rootId);
  const rootNotes = rootKids.filter((c) => !isRoom(tree, c));
  const trunkIds = [...new Set(rootKids.filter((c) => isRoom(tree, c)))];
  const N = trunkIds.length;
  const hubOv = ovFor(rootId);
  const forest = speciesForest(trunkIds, trunkIds.map((id) => ovFor(id).species ?? null));
  const trunkCalcR = trunkIds.map((id, i) => Math.max(MIN_RADIUS, 5, r0Of(id, true) * SPECIES[forest.eff[i]].trunkR));
  const maxTrunkR = Math.max(0, ...trunkCalcR);
  const world3 = mode === "forest"; // the hub is the WORLD TREE: a giant trunk with a crown (the hub mode keeps the short stump)
  const hubCalc: BranchProps = world3
    ? {
        length: YGG_LENGTH,
        thickness: clamp(YGG_R_OVER_TRUNK * maxTrunkR, YGG_MIN_R, YGG_MAX_R),
        taper: YGG_TAPER, spin: 0, pitch: 0, attach: 0, bend: 0, species: "yggdrasil", wave: 0, waveFreq: 1, waveFn: "none",
      }
    : {
        length: clamp(HUB_BASE + HUB_PER_NOTE * rootNotes.length, HUB_BASE, HUB_MAX),
        thickness: Math.max(HUB_MIN_R, HUB_R_OVER_TRUNK * maxTrunkR),
        taper: HUB_TAPER, spin: 0, pitch: 0, attach: 0, bend: 0, species: HUB_SPECIES, wave: 0, waveFreq: 1, waveFn: "none",
      };
  const hubEff: BranchProps = {
    ...hubCalc,
    length: hubOv.length ?? hubCalc.length,
    thickness: hubOv.thickness ?? hubCalc.thickness,
    taper: hubOv.taper ?? hubCalc.taper,
    species: hubOv.species ?? hubCalc.species,
  };
  const hubSp = SPECIES[hubEff.species];
  {
    const L = hubEff.length;
    const pts = smoothPath([v3(0, 0, 0), v3(0, L / 3, 0), v3(0, (2 * L) / 3, 0), v3(0, L, 0)], 22);
    const hub = makeBranch(rootId, pts, hubEff.thickness, null, undefined, Math.max(1.5, Math.min(hubEff.thickness, hubEff.taper * hubEff.thickness)));
    hub.species = hubEff.species;
    addBranch(world, hub);
    parentOf.set(rootId, null);
    info.set(rootId, { id: rootId, calc: hubCalc, eff: hubEff, overridden: used(hubOv, "spin", "pitch", "attach", "bend", "wave", "waveFreq", "waveFn") });
    placeLeaves(hub, rootNotes, hubSp.leaf.color);

    if (mode === "hub") {
      // ---- hub: one tree per top-level folder, fanned around the hub's end ----
      // Horizontal run of the root arch: bases >= 3 trunk diameters apart; the chord between neighbours is 2 R sin(pi/N).
      const need = N >= 2 ? (SPACING_DIAMETERS * 2 * maxTrunkR) / (2 * Math.sin(Math.PI / N)) : 0;
      const run = N >= 2 ? Math.max(ARCH_MIN, N <= 30 ? ARCH_PER_TREE * N : ARCH_FLAT, need) : 0;
      const base = rnd(rootId, 5) * 2 * Math.PI;
      trunkIds.forEach((tid, i) => {
        const az = N >= 2 ? base + (2 * Math.PI * i) / N + (rnd(tid, 4) - 0.5) * 0.24 * ((2 * Math.PI) / N) : rnd(tid, 1) * 2 * Math.PI;
        grow(tid, hub, { kind: "trunk", i, n: N, run, calcSp: forest.calc[i], az }, 0);
      });
    } else {
      // ---- forest: every top-level folder is a tree standing in the ground; ground roots join the trunks to the stump ----
      // 1. grow each tree around its own origin (its trunk foot) and measure its footprint
      const grown: Array<{ tid: string; made: Branch[]; crown: Crown }> = [];
      trunkIds.forEach((tid, i) => {
        const before = world.branches.size;
        grow(tid, hub, { kind: "trunk", i, n: N, run: 0, calcSp: forest.calc[i], az: 0, forest: true }, 0);
        if (!world.branches.has(tid)) return; // a clone of something grown earlier
        const made = [...world.branches.values()].slice(before);
        grown.push({ tid, made, crown: crownOf(made) });
      });
      // 2. spread them out: sunflower (N > 6) or an even ring (N <= 6) of preferred azimuths, each pushed out until nothing collides
      const base = rnd(rootId, 5) * 2 * Math.PI;
      const M = grown.length;
      const slots = grown.map((g, i) => ({
        az: base + (M <= 6 ? (2 * Math.PI * i) / M : i * GOLDEN) + (rnd(g.tid, 4) - 0.5) * 0.3,
        crown: g.crown,
        footR: world.branches.get(g.tid)!.r,
      }));
      const spots = placeTrees(slots, hub.r + YGG_CLEAR);
      // 3. move each tree there and lay its root: stump -> ground -> sweeps up into the trunk
      grown.forEach((g, i) => {
        const { x, z } = spots[i];
        for (const b of g.made) b.pts = b.pts.map((p) => v3(p.x + x, p.y, p.z + z));
        const trunk = world.branches.get(g.tid)!;
        const rs0 = clamp(0.62 * trunk.r, 5, trunk.r);
        const path = rootPath({ x, z }, trunk.pts[0], trunk.T[0], rs0, trunk.r, rnd(g.tid, 6), hub.r * 0.9);
        const root = makeBranch(`root:${g.tid}`, path.pts, rs0, rootId, path.c0, trunk.r);
        root.root = true;
        root.species = trunk.species;
        addBranch(world, root);
        root.next.push(g.tid); // the trunk continues from the root's END
        trunk.parent = root.id;
        parentOf.set(root.id, rootId);
      });
    }
  }

  // ---- limbs of the world tree (forest only): LOW places near the foot (the porch you start on, the wisp's branch ...), CROWN places up high, and
  // with `opts.crown` a real crown of decorative limbs and a treetop so the top of the tree is a tree and not a pole ----
  const placed: Array<{ id: string; title: string; branchId: string }> = [];
  if (world3) {
    const hub = world.branches.get(rootId)!;
    const places = (opts.places ?? []).filter((pl, i, a) => pl.id && a.findIndex((x) => x.id === pl.id) === i);
    const low = places.filter((p) => p.slot === "low");
    const high = places.filter((p) => p.slot !== "low");
    const limb = (bid: string, par: Branch, attachS: number, az: number, pitchDeg: number, len: number, r: number, rEnd: number, tau: number, bend: number, upBias: number): Branch => {
      const f = frameAt(par, attachS);
      const pitch = pitchDeg * DEG;
      const side = add(mul(f.u, Math.cos(az)), mul(f.b, Math.sin(az)));
      const dir = lift(norm(add(add(mul(f.t, Math.cos(pitch)), mul(side, Math.sin(pitch))), v3(0, upBias, 0))));
      const k = Math.max(3, Math.min(8, Math.round(len / 160)));
      const ctrl = trace(bid, f.p, dir, k, len / k, tau, 1, 1, bend, f.p.y);
      const br = makeBranch(bid, smoothPath(ctrl, 22), r, par.id, attachS, rEnd);
      br.species = "yggdrasil";
      addBranch(world, br);
      parentOf.set(bid, rootId);
      return br;
    };
    // low places: sturdy, nearly horizontal, a little lift, spread round the trunk (the first one is the porch you spawn on)
    low.forEach((pl, i) => {
      const bid = `place:${pl.id}`;
      const R = radiusAt(hub, LOW_FROM);
      const r = Math.max(15, 0.11 * R);
      const br = limb(bid, hub, LOW_FROM + LOW_STEP * i, i * 2.4 + rnd(bid, 1) * 0.6, 74 + 8 * rnd(bid, 2), LOW_LEN * (0.9 + 0.25 * rnd(bid, 3)), r, Math.max(9, 0.62 * r), 0.02, -0.04, 0.12);
      br.place = pl.id;
      placed.push({ id: pl.id, title: pl.title, branchId: bid });
    });
    // crown places
    high.forEach((pl, i) => {
      const bid = `place:${pl.id}`;
      const t = high.length === 1 ? 0.7 : CROWN_FROM + ((CROWN_TO - CROWN_FROM) * (i + 0.5)) / high.length;
      const attachS = hub.total * t;
      const br = limb(bid, hub, attachS, i * GOLDEN + rnd(bid, 1) * 0.5, 52 + 18 * rnd(bid, 2), CROWN_LEN * (0.85 + 0.3 * rnd(bid, 3)), Math.max(20, 0.2 * radiusAt(hub, attachS)), 0, 0.05, -0.1, 0.3);
      br.place = pl.id;
      placed.push({ id: pl.id, title: pl.title, branchId: bid });
    });
    if (opts.crown) {
      // decorative crown: limbs round the upper trunk, each with side twigs, plus a treetop of leaders: it carries the canopy
      const NL = 9;
      for (let i = 0; i < NL; i++) {
        const bid = `crown:${i}`;
        const t = 0.6 + (0.34 * (i + rnd(bid, 4))) / NL;
        const attachS = hub.total * t;
        const len = CROWN_LEN * (0.8 + 0.5 * rnd(bid, 3)) * (1.15 - 0.45 * ((t - 0.6) / 0.34));
        const r = Math.max(14, 0.17 * radiusAt(hub, attachS));
        const L = limb(bid, hub, attachS, i * GOLDEN + 0.7, 50 + 22 * rnd(bid, 2), len, r, Math.max(5, 0.22 * r), 0.06, -0.12, 0.35);
        const sub = 2 + (i % 2);
        for (let j = 0; j < sub; j++) {
          const sid = `crown:${i}.${j}`;
          const sa = L.total * (0.35 + (0.5 * (j + rnd(sid, 4))) / sub);
          limb(sid, L, sa, j * 2.6 + rnd(sid, 1), 38 + 24 * rnd(sid, 2), len * (0.42 + 0.2 * rnd(sid, 3)), Math.max(5, 0.5 * radiusAt(L, sa)), 2.2, 0.06, -0.15, 0.3);
        }
      }
      for (let i = 0; i < 3; i++) {
        const bid = `crown:top${i}`;
        const attachS = hub.total * (0.965 + 0.012 * i);
        limb(bid, hub, attachS, i * 2.1 + 0.4, 16 + 8 * i, 520 + 120 * i, Math.max(14, 0.2 * radiusAt(hub, attachS)), 3, 0.08, 0, 0.5);
      }
    }
  }

  return { world, leaves, rootBranchId: rootId, mode, parentOf, info, places: placed };
}

/** Breadcrumb: folder ids from the root down to `branchId`. */
export function pathToRoot(layout: TreeLayout, branchId: string): string[] {
  const path: string[] = [];
  let cur: string | null = branchId;
  const guard = new Set<string>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur);
    path.unshift(cur);
    cur = layout.parentOf.get(cur) ?? null;
  }
  return path;
}
