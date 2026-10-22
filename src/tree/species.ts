/**
 * tree/species.ts — tree kinds for the forest view: pure data + tiny helpers (no three.js, no DOM).
 *
 * The vault root is a hub; every top-level folder is its own tree and gets a species. A species changes how the
 * tree GROWS (layout.ts reads the growth fields) and how it LOOKS (the renderer reads `bark` and `leaf` through
 * `Branch.species`). `maple` is the reference kind: its multipliers are 1 and its numbers are the layout's classic ones.
 *
 * Choosing: the label `biblio_species` on a folder wins (case-insensitive, inherits down to sub-folders, a sub-folder
 * may override); otherwise top-level trees get `speciesForest` (a hash of the note id, stepped so that neighbours
 * differ: any 4 neighbouring trees are 4 different kinds) and sub-folders inherit their tree's species.
 */

import type { WaveFn } from "./wave";

export type SpeciesKey =
  | "oak" | "birch" | "maple" | "pine" | "willow" | "cherry" | "acacia"
  | "baobab" | "redwood" | "aspen" | "ash" | "cypress" | "ghost";

export interface Species {
  key: SpeciesKey;
  /** Display name for pickers. */
  label: string;

  // --- growth (read by layout.ts) ---
  /** x the calculated trunk rise length (the part above the root arch). */
  trunkLen: number;
  /** x the trunk's start thickness. */
  trunkR: number;
  /** x the start thickness of sub-branches (before the "<= 0.85 x parent" cap). */
  branchR: number;
  /** Tip radius / base radius of a branch (the layout keeps the tip >= 4 px). */
  taper: number;
  /** Side branches leave the parent between these angles (degrees off the parent's direction). */
  pitchMin: number;
  pitchMax: number;
  /** Extra reaching for the light: this much world-up is added to a side branch's direction (0 = none, 1 = strong). */
  upBias: number;
  /** How far side branches sag towards their tips, 0..1 (becomes the calculated `bend` = -droop). */
  droop: number;
  /** Side-branch length falls by this factor per folder level (smaller = shorter twigs). */
  lengthDecay: number;
  /** x the length of side branches. */
  childLen: number;
  /** How side branches spiral around the parent: golden angle, tight whorls of three, or alternating sides. */
  azimuthRule: "golden" | "whorl" | "alternate";
  /** Side branches attach between these fractions of the parent's rising part. */
  attachFrom: number;
  attachTo: number;
  /** Centreline wobble, x the classic amount (0 = ruler straight). */
  sway: number;
  /** Per control segment, a branch's direction eases towards world-up by this fraction (0..0.3). */
  tropism: number;
  /** The calculated wave shape of its branches (default `noise` = a gentle natural wobble; amplitude comes from `sway`, see layout.ts). */
  waveFn?: WaveFn;

  // --- look (read by the renderer) ---
  bark: {
    /** Base colour, sRGB 0..1. */
    base: [number, number, number];
    /** Per-block brightness variation, 0..1. */
    variation: number;
    /** Optional marks (birch's dark scars, cherry's lenticels): colour + chance per block. */
    mark?: { rgb: [number, number, number]; chance: number };
    /** Amount of moss on the upper side, 0..1. */
    moss: number;
    /** Vertical furrows / streaks, 0..1. */
    streak: number;
  };
  leaf: {
    /** CSS colour of a leaf whose note has no #color and no tag. */
    color: string;
  };
}

const S = (s: Species): Species => s;

export const SPECIES: Record<SpeciesKey, Species> = {
  oak: S({
    key: "oak", label: "Oak",
    trunkLen: 0.8, trunkR: 1.3, branchR: 1.15, taper: 0.5, pitchMin: 50, pitchMax: 85, upBias: 0.15, droop: 0.35,
    lengthDecay: 0.9, childLen: 1.15, azimuthRule: "golden", attachFrom: 0.25, attachTo: 0.9, sway: 1.3, tropism: 0.03,
    bark: { base: [0.3, 0.21, 0.13], variation: 0.18, moss: 0.25, streak: 0.7 },
    leaf: { color: "#3f7a35" },
  }),
  birch: S({
    key: "birch", label: "Birch",
    trunkLen: 1.25, trunkR: 0.7, branchR: 0.75, taper: 0.5, pitchMin: 22, pitchMax: 42, upBias: 0.7, droop: 0.1,
    lengthDecay: 0.84, childLen: 0.8, azimuthRule: "golden", attachFrom: 0.3, attachTo: 0.97, sway: 0.7, tropism: 0.1,
    bark: { base: [0.9, 0.9, 0.86], variation: 0.06, mark: { rgb: [0.1, 0.1, 0.1], chance: 0.22 }, moss: 0, streak: 0.3 },
    leaf: { color: "#b5c93a" },
  }),
  maple: S({
    key: "maple", label: "Maple",
    trunkLen: 1, trunkR: 1, branchR: 1, taper: 0.55, pitchMin: 38, pitchMax: 70, upBias: 0.4, droop: 0.2,
    lengthDecay: 0.86, childLen: 1, azimuthRule: "golden", attachFrom: 0.2, attachTo: 0.95, sway: 1, tropism: 0.05,
    bark: { base: [0.42, 0.33, 0.26], variation: 0.14, moss: 0.1, streak: 0.4 },
    leaf: { color: "#c8432a" },
  }),
  pine: S({
    key: "pine", label: "Pine",
    trunkLen: 1.3, trunkR: 0.85, branchR: 0.7, taper: 0.35, pitchMin: 60, pitchMax: 80, upBias: 0, droop: 0.45,
    lengthDecay: 0.75, childLen: 0.55, azimuthRule: "whorl", attachFrom: 0.15, attachTo: 0.97, sway: 0.4, tropism: 0.04,
    bark: { base: [0.22, 0.15, 0.11], variation: 0.16, moss: 0.05, streak: 0.8 },
    leaf: { color: "#2a5a30" },
  }),
  willow: S({
    key: "willow", label: "Willow",
    trunkLen: 0.9, trunkR: 0.9, branchR: 0.6, taper: 0.4, pitchMin: 35, pitchMax: 60, upBias: 0.25, droop: 1,
    lengthDecay: 0.9, childLen: 1.35, azimuthRule: "golden", attachFrom: 0.3, attachTo: 0.97, sway: 1.1, tropism: 0.02, waveFn: "sine",
    bark: { base: [0.38, 0.34, 0.26], variation: 0.14, moss: 0.3, streak: 0.6 },
    leaf: { color: "#a8c9a0" },
  }),
  cherry: S({
    key: "cherry", label: "Cherry",
    trunkLen: 0.8, trunkR: 0.9, branchR: 0.95, taper: 0.5, pitchMin: 55, pitchMax: 90, upBias: 0.2, droop: 0.25,
    lengthDecay: 0.87, childLen: 1, azimuthRule: "golden", attachFrom: 0.25, attachTo: 0.9, sway: 1.1, tropism: 0.05,
    bark: { base: [0.36, 0.18, 0.15], variation: 0.12, mark: { rgb: [0.7, 0.55, 0.5], chance: 0.25 }, moss: 0, streak: 0.2 },
    leaf: { color: "#f2a7c3" },
  }),
  acacia: S({
    key: "acacia", label: "Acacia",
    trunkLen: 0.7, trunkR: 0.6, branchR: 0.7, taper: 0.45, pitchMin: 78, pitchMax: 100, upBias: 0.05, droop: 0.1,
    lengthDecay: 0.95, childLen: 1.5, azimuthRule: "alternate", attachFrom: 0.6, attachTo: 0.98, sway: 0.6, tropism: 0.01,
    bark: { base: [0.45, 0.34, 0.22], variation: 0.12, moss: 0, streak: 0.5 },
    leaf: { color: "#7d9a2e" },
  }),
  baobab: S({
    key: "baobab", label: "Baobab",
    trunkLen: 0.45, trunkR: 1.9, branchR: 1.5, taper: 0.6, pitchMin: 40, pitchMax: 65, upBias: 0.3, droop: 0.1,
    lengthDecay: 0.8, childLen: 0.6, azimuthRule: "golden", attachFrom: 0.5, attachTo: 0.97, sway: 0.5, tropism: 0.05, waveFn: "sbend",
    bark: { base: [0.52, 0.43, 0.36], variation: 0.1, moss: 0, streak: 0.15 },
    leaf: { color: "#6f9a3a" },
  }),
  redwood: S({
    key: "redwood", label: "Redwood",
    trunkLen: 1.8, trunkR: 1.1, branchR: 0.6, taper: 0.3, pitchMin: 55, pitchMax: 75, upBias: 0.1, droop: 0.35,
    lengthDecay: 0.72, childLen: 0.4, azimuthRule: "whorl", attachFrom: 0.35, attachTo: 0.98, sway: 0.3, tropism: 0.08,
    bark: { base: [0.45, 0.2, 0.12], variation: 0.15, moss: 0.05, streak: 0.9 },
    leaf: { color: "#2d5a2f" },
  }),
  aspen: S({
    key: "aspen", label: "Aspen",
    trunkLen: 1.15, trunkR: 0.65, branchR: 0.55, taper: 0.5, pitchMin: 15, pitchMax: 35, upBias: 0.8, droop: 0.05,
    lengthDecay: 0.9, childLen: 0.9, azimuthRule: "alternate", attachFrom: 0.1, attachTo: 0.98, sway: 0.35, tropism: 0.12,
    bark: { base: [0.82, 0.8, 0.74], variation: 0.08, mark: { rgb: [0.2, 0.2, 0.18], chance: 0.15 }, moss: 0, streak: 0.25 },
    leaf: { color: "#e0b33a" },
  }),
  ash: S({
    key: "ash", label: "Ash",
    trunkLen: 1.05, trunkR: 0.95, branchR: 0.9, taper: 0.5, pitchMin: 30, pitchMax: 58, upBias: 0.5, droop: 0.15,
    lengthDecay: 0.86, childLen: 1, azimuthRule: "alternate", attachFrom: 0.25, attachTo: 0.95, sway: 0.9, tropism: 0.06,
    bark: { base: [0.5, 0.48, 0.44], variation: 0.12, moss: 0.08, streak: 0.6 },
    leaf: { color: "#6e9a3c" },
  }),
  cypress: S({
    key: "cypress", label: "Cypress",
    trunkLen: 1.4, trunkR: 0.8, branchR: 0.6, taper: 0.4, pitchMin: 12, pitchMax: 28, upBias: 0.9, droop: 0,
    lengthDecay: 0.8, childLen: 0.6, azimuthRule: "whorl", attachFrom: 0.1, attachTo: 0.95, sway: 0.3, tropism: 0.15,
    bark: { base: [0.35, 0.27, 0.2], variation: 0.1, moss: 0, streak: 0.5 },
    leaf: { color: "#1f4a2e" },
  }),
  ghost: S({
    key: "ghost", label: "Ghost (dead tree)",
    trunkLen: 1, trunkR: 0.9, branchR: 0.8, taper: 0.35, pitchMin: 40, pitchMax: 95, upBias: 0.1, droop: 0.5,
    lengthDecay: 0.88, childLen: 1.1, azimuthRule: "golden", attachFrom: 0.2, attachTo: 0.95, sway: 1.6, tropism: 0, waveFn: "zigzag",
    bark: { base: [0.55, 0.55, 0.55], variation: 0.15, moss: 0, streak: 0.5 },
    leaf: { color: "#8a8f86" },
  }),
};

/** Every kind, in a fixed order (the order `speciesFor` steps through; a prime count keeps every step coprime). */
export const SPECIES_KEYS: SpeciesKey[] = Object.keys(SPECIES) as SpeciesKey[];

/** Deterministic hash of a string into [0,1) (FNV-1a). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** A species key from user text (case-insensitive, trimmed); anything else (unknown, non-string) -> null. */
export function parseSpeciesKey(v: unknown): SpeciesKey | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SPECIES, k) ? (k as SpeciesKey) : null;
}

/** Step between neighbouring top-level trees in `SPECIES_KEYS` (coprime to the count). */
const STEP = 5;

/**
 * The species of a tree: a valid `override` wins, else a hash of the note id plus `indexAmongSiblings` x a fixed step
 * (so top-level neighbours differ). Pure. `speciesForest` additionally guarantees 4 different kinds among 4 neighbours.
 */
export function speciesFor(noteId: string, indexAmongSiblings = 0, override?: string | null): SpeciesKey {
  const o = parseSpeciesKey(override);
  if (o) return o;
  const idx = Number.isFinite(indexAmongSiblings) ? Math.max(0, Math.floor(indexAmongSiblings)) : 0;
  const n = SPECIES_KEYS.length;
  return SPECIES_KEYS[(Math.floor(hash01(noteId) * n) + idx * STEP) % n];
}

/** How many neighbouring trees must all differ. */
const FOREST_WINDOW = 3;

/**
 * Species of the top-level trees in order. `calc[i]` = the automatic pick for tree i (never depends on its own
 * `explicit[i]`): `speciesFor`, moved on to the next kind while it equals one of the previous 3 trees' EFFECTIVE kinds.
 * `eff[i]` = `explicit[i] ?? calc[i]`. So any 4 neighbours differ (as far as the user's explicit choices allow).
 */
export function speciesForest(ids: readonly string[], explicit: ReadonlyArray<SpeciesKey | null | undefined> = []): { calc: SpeciesKey[]; eff: SpeciesKey[] } {
  const calc: SpeciesKey[] = [];
  const eff: SpeciesKey[] = [];
  const n = SPECIES_KEYS.length;
  ids.forEach((id, i) => {
    const recent = calc.slice(-FOREST_WINDOW); // the CALCULATED neighbours, so overriding one tree never re-skins the next
    let k = SPECIES_KEYS.indexOf(speciesFor(id, i));
    for (let tries = 0; tries < n && recent.includes(SPECIES_KEYS[k]); tries++) k = (k + 1) % n;
    calc.push(SPECIES_KEYS[k]);
    eff.push(explicit[i] ?? SPECIES_KEYS[k]);
  });
  return { calc, eff };
}
