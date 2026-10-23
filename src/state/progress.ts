/**
 * state/progress.ts — the player's progress: counters, unlocks, the tutorial, and the "unlock all" switch.
 *
 * The rules are pure (lib/unlocks.ts, lib/tutorial.ts); this module holds the current values, saves them locally (localStorage
 * `biblio.v1.save`, via savestore) and tells the UI. Whether it also goes into the Trilium save note is savestore's business (opt-in).
 *
 * "Unlock all" (`biblio.v1.unlockAll`, `?unlock=all` for one session): decided ONCE for a browser that has never had the switch: someone who
 * already played the tree keeps everything unlocked (the unlock system must not take animals away from them), a new browser starts locked.
 */

import { COUNTERS, CATALOG, bumpCounter, isUnlocked, newlyEarned, type Counter, type UnlockState } from "../lib/unlocks";
import { feed, finished, isActive, replay, skip, startTutorial, type GameEvent, type Tutorial, type TutorialState } from "../lib/tutorial";
import type { SaveProgress } from "../lib/save";
import { localSave, rememberProgress } from "./savestore";
import { notify } from "./store";

export const UNLOCK_ALL_KEY = "biblio.v1.unlockAll";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage disabled: progress stays in memory */
  }
};

/** Has this browser played the tree before (any remembered tree view setting / the leaf-size cache)? */
function hasPlayed(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (k.startsWith("biblio.v1.tree") || k === "bibliotheca.leafsizes.v1" || k === "biblio.v1.silk") return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

let counters: Record<string, number> = {};
let unlocked = new Set<string>();
let tutorial: Tutorial = startTutorial();
let all = false;
let queryAll = false;
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();
let saveTimer = 0;

function changed(): void {
  version++;
  for (const l of [...listeners]) l();
}

function persistSoon(): void {
  if (saveTimer) return;
  saveTimer = window.setTimeout(flushProgress, 1500);
}

/** Write the progress to the local save now (also called when the tree closes). */
export function flushProgress(): void {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  const p: SaveProgress = { counters: { ...counters }, unlocked: [...unlocked], tutorial: { ...tutorial.state } };
  rememberProgress(p);
}

/** Load from the local save (the first call; `reloadProgress` after a merge from Trilium). */
export function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const p = localSave().progress;
  counters = { ...p.counters };
  unlocked = new Set(p.unlocked);
  tutorial = startTutorial(p.tutorial);
  try {
    queryAll = new URLSearchParams(window.location.search).get("unlock") === "all";
  } catch {
    queryAll = false;
  }
  const flag = read(UNLOCK_ALL_KEY);
  if (flag === "on" || flag === "off") all = flag === "on";
  else {
    all = hasPlayed();
    write(UNLOCK_ALL_KEY, all ? "on" : "off");
  }
  settle(false); // (quietly: a save that already holds a finished tutorial but not yet its tools)
}

/** Re-read after the local save was replaced (a merge with Trilium's copy). */
export function reloadProgress(): void {
  loaded = false;
  ensureLoaded();
  settle(false);
  changed();
}

export const progressVersion = (): number => version;
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function unlockAll(): boolean {
  ensureLoaded();
  return all || queryAll;
}
export function setUnlockAll(on: boolean): void {
  ensureLoaded();
  all = on;
  write(UNLOCK_ALL_KEY, on ? "on" : "off");
  changed();
}

export function getCounters(): Readonly<Record<string, number>> {
  ensureLoaded();
  return counters;
}
export function getTutorial(): TutorialState {
  ensureLoaded();
  return tutorial.state;
}
export function unlockedIds(): ReadonlySet<string> {
  ensureLoaded();
  return unlocked;
}

export function state(): UnlockState {
  ensureLoaded();
  return { counters, unlocked, all: all || queryAll, tutorialDone: finished(tutorial.state) };
}

/** Is this thing available now? (Things that are not in the catalog are never locked.) */
export const can = (id: string): boolean => isUnlocked(id, state());
export const canAnimal = (animalId: string): boolean => can(`animal:${animalId}`);

/** Move everything that has been earned into the unlocked set (toast for each new one unless `quiet`). */
function settle(announce = true): void {
  const fresh = newlyEarned(state());
  for (const u of fresh) {
    unlocked.add(u.id);
    if (announce) notify("info", `Unlocked: ${u.name} — ${u.what}`);
  }
}

/** Add to a counter, then unlock what that earns. */
export function bump(c: Counter, by = 1): void {
  ensureLoaded();
  if (!COUNTERS.includes(c)) return;
  counters = bumpCounter(counters, c, by);
  settle();
  persistSoon();
  changed();
}

/** What the player did: feeds the tutorial and the counters. */
export function game(e: GameEvent): void {
  ensureLoaded();
  switch (e.kind) {
    case "distance":
      bump("distance", e.m);
      break;
    case "enter":
      bump("branches", 1);
      break;
    case "leap":
      bump("leaps", 1);
      break;
    case "read":
      bump("read", 1);
      break;
    case "altar":
      bump("altar", 1);
      break;
    case "animal":
      bump("switches", 1);
      break;
    default:
      break;
  }
  if (!isActive(tutorial.state)) return;
  const r = feed(tutorial, e);
  tutorial = r.tutorial;
  if (r.changed) {
    if (finished(tutorial.state)) {
      notify("info", "Tutorial finished — the branch editor and build mode are unlocked.");
      settle();
    }
    persistSoon();
    changed();
  }
}

export function skipTutorial(): void {
  ensureLoaded();
  tutorial = skip();
  settle();
  persistSoon();
  changed();
}

export function replayTutorial(): void {
  ensureLoaded();
  tutorial = replay();
  persistSoon();
  changed();
}

/** Forget everything (tests, "start over"). */
export function resetProgress(): void {
  ensureLoaded();
  counters = {};
  unlocked = new Set();
  tutorial = startTutorial();
  persistSoon();
  changed();
}

export { CATALOG };
