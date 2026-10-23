/**
 * lib/unlocks.ts — the basic unlock system (PURE, unit-tested: tools/unit-unlocks.mjs).
 *
 * What is lockable: TOYS and TOOLS, never the core. Reading, search, capture and the library always work. You start with the lizard
 * and the ant (the reader); the other animals, the branch editor, build mode and future places unlock as you play: each entry of
 * `CATALOG` asks for a few COUNTERS (leaves read, distance walked, leaps, minutes in the tree ...) and some also for the tutorial.
 * Counters and the unlocked ids live in the save (lib/save.ts `progress`), so they follow the user when they save in Trilium.
 * An "unlock all" switch (state/progress.ts) overrides everything: this is a personal tool, nobody has to grind.
 */

export type Counter = "read" | "distance" | "branches" | "leaps" | "minutes" | "captures" | "altar" | "switches";

/** What each counter counts, for the progress list. */
export const COUNTER_LABELS: Record<Counter, { name: string; unit: string }> = {
  read: { name: "leaves read", unit: "" },
  distance: { name: "distance walked or flown", unit: " m" },
  branches: { name: "branches entered", unit: "" },
  leaps: { name: "leaps and take-offs", unit: "" },
  minutes: { name: "minutes in the tree", unit: "" },
  captures: { name: "notes captured", unit: "" },
  altar: { name: "visits to the altar", unit: "" },
  switches: { name: "times you changed animal", unit: "" },
};

export const COUNTERS = Object.keys(COUNTER_LABELS) as Counter[];

export interface Need {
  counter: Counter;
  n: number;
}

export type UnlockKind = "animal" | "tool" | "place";

export interface Unlock {
  /** `animal:<id>`, `tool:<name>` or `place:<id>`. */
  id: string;
  kind: UnlockKind;
  name: string;
  /** What it gives you, one line. */
  what: string;
  needs: readonly Need[];
  /** Also needs the tutorial to be finished (or skipped). */
  tutorial?: boolean;
}

/** Ids that are always available. */
export const START: readonly string[] = ["animal:lizard", "animal:ant"];

export const animalUnlockId = (animalId: string): string => `animal:${animalId}`;

const A = (id: string, name: string, what: string, ...needs: Need[]): Unlock => ({ id: animalUnlockId(id), kind: "animal", name, what, needs });

/** The catalog. Numbers are small on purpose: a few minutes of play unlock the first animals, an hour the last. */
export const CATALOG: readonly Unlock[] = [
  A("cat", "Cat", "the fastest walker, the strongest leap", { counter: "distance", n: 150 }),
  A("beetle", "Beetle", "a sturdy little crawler", { counter: "branches", n: 5 }),
  A("squirrel", "Flying squirrel", "leaps become glides", { counter: "leaps", n: 3 }),
  A("spider", "Spider", "spins silk and never loses its grip", { counter: "read", n: 2 }),
  A("bee", "Bee", "hovers and flies", { counter: "minutes", n: 3 }),
  A("snake", "Snake", "reaches out as a living bridge", { counter: "distance", n: 400 }),
  A("jumper", "Jumping spider", "a small spider that really jumps", { counter: "leaps", n: 8 }, { counter: "read", n: 3 }),
  A("dragonfly", "Dragonfly", "hovers fast and darting", { counter: "minutes", n: 8 }),
  A("bluejay", "Blue jay", "a gliding flier that lands where you aim", { counter: "leaps", n: 15 }, { counter: "minutes", n: 10 }),
  A("constrictor", "Constrictor", "a very long snake with a very long reach", { counter: "distance", n: 1200 }, { counter: "branches", n: 25 }),
  A("eagle", "Eagle", "big, fast, and it can skydive", { counter: "leaps", n: 25 }, { counter: "minutes", n: 20 }),
  { id: "tool:edit", kind: "tool", name: "Branch editor", what: "B in the tree: sliders for a branch, saved as labels", needs: [], tutorial: true },
  { id: "tool:build", kind: "tool", name: "Build mode", what: "B in the library: themes, furniture and decoration of a room", needs: [], tutorial: true },
];

export interface UnlockState {
  counters: Readonly<Record<string, number>>;
  unlocked: ReadonlySet<string> | readonly string[];
  /** The "unlock all" switch. */
  all: boolean;
  /** The tutorial is finished or was skipped. */
  tutorialDone: boolean;
}

const has = (set: UnlockState["unlocked"], id: string): boolean => (Array.isArray(set) ? (set as readonly string[]).includes(id) : (set as ReadonlySet<string>).has(id));

/** Is this id available right now? Ids that are not in the catalog and not in `START` are NOT lockable (always true). */
export function isUnlocked(id: string, s: UnlockState): boolean {
  if (s.all || START.includes(id)) return true;
  if (!CATALOG.some((u) => u.id === id)) return true;
  return has(s.unlocked, id);
}

/** Per need: how far along. */
export function progressOf(u: Unlock, counters: Readonly<Record<string, number>>): Array<{ need: Need; have: number; ok: boolean }> {
  return u.needs.map((need) => {
    const have = Math.max(0, Math.floor(counters[need.counter] ?? 0));
    return { need, have, ok: have >= need.n };
  });
}

/** Do the counters (and the tutorial) satisfy the entry? */
export function earned(u: Unlock, counters: Readonly<Record<string, number>>, tutorialDone: boolean): boolean {
  return progressOf(u, counters).every((p) => p.ok) && (!u.tutorial || tutorialDone);
}

/** Entries that are earned but not yet in the unlocked set (in catalog order). */
export function newlyEarned(s: UnlockState): Unlock[] {
  return CATALOG.filter((u) => !has(s.unlocked, u.id) && earned(u, s.counters, s.tutorialDone));
}

/** A line for the progress list / tooltip: "needs 3 leaps and take-offs (1/3), 8 minutes in the tree (2/8)". */
export function requirementText(u: Unlock, counters: Readonly<Record<string, number>>): string {
  const parts = progressOf(u, counters).map((p) => `${p.need.n}${COUNTER_LABELS[p.need.counter].unit} ${COUNTER_LABELS[p.need.counter].name} (${Math.min(p.have, p.need.n)}/${p.need.n})`);
  if (u.tutorial) parts.push("the tutorial (finish or skip it)");
  return parts.length ? `needs ${parts.join(", ")}` : "available";
}

/** Add to a counter (a non-finite or negative amount adds nothing; the sum is bounded). Returns a new counters object. */
export function bumpCounter(counters: Readonly<Record<string, number>>, c: Counter, by: number): Record<string, number> {
  const add = Number.isFinite(by) && by > 0 ? by : 0;
  return { ...counters, [c]: Math.min(1e9, (counters[c] ?? 0) + add) };
}
