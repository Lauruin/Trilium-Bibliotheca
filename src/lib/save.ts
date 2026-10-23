/**
 * lib/save.ts — the app's SAVE: what is worth keeping across devices (PURE, unit-tested).
 *
 * The save is one small JSON document: the view settings (look, camera, shadows, ...), and the player's progress (counters, what is
 * unlocked, how far the tutorial is). It lives in localStorage as a cache and, if the user switches it on at the shrine, in a code note
 * inside the Yggdrasil data folder (lib/yggdrasil.ts) so it follows them between devices and is versioned by Trilium. Everything read from
 * a note is untrusted: `parseSave` never throws, drops unknown fields, and bounds every value.
 */

export const SAVE_VERSION = 1;

/** The localStorage keys of the view settings that are part of the save (and ONLY these: nothing else is ever copied into a note). */
export const SETTING_KEYS = [
  "biblio.v1.treeLook",
  "biblio.v1.treeCam",
  "biblio.v1.treeFoliage",
  "biblio.v1.treeFoliageDensity",
  "biblio.v1.treeShadows",
  "biblio.v1.treeMove",
  "biblio.v1.treeLabels",
  "biblio.v1.treePerf",
  "biblio.v1.treeLayout",
  "biblio.v1.treeWisp",
  "biblio.v1.treeClock",
  "biblio.v1.reader",
  "biblio.v1.unlockAll",
] as const;

export interface SaveProgress {
  /** Named counters (leaves read, branches visited, ...): non-negative integers. */
  counters: Record<string, number>;
  /** Ids of unlocked things (lib/unlocks.ts). */
  unlocked: string[];
  /** The tutorial: the step it is on, and whether it is finished or was skipped. */
  tutorial: { step: string; done: boolean; skipped: boolean };
}

export interface SaveData {
  v: typeof SAVE_VERSION;
  /** ms since the epoch of the last change (the newer save wins a merge). */
  updatedAt: number;
  settings: Record<string, string>;
  progress: SaveProgress;
}

export const emptyProgress = (): SaveProgress => ({ counters: {}, unlocked: [], tutorial: { step: "", done: false, skipped: false } });
export const emptySave = (): SaveData => ({ v: SAVE_VERSION, updatedAt: 0, settings: {}, progress: emptyProgress() });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ID = /^[A-Za-z0-9_.:-]{1,60}$/;
const MAX_COUNTERS = 100;
const MAX_UNLOCKED = 200;
const MAX_SETTING = 600;
const MAX_COUNT = 1e9;

/** Coerce arbitrary JSON into a SaveData. Never throws. */
export function sanitizeSave(v: unknown): SaveData {
  const out = emptySave();
  if (!isObj(v)) return out;
  out.updatedAt = typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) && v.updatedAt > 0 ? Math.floor(v.updatedAt) : 0;
  if (isObj(v.settings)) {
    for (const k of SETTING_KEYS) {
      const val = v.settings[k];
      if (typeof val === "string" && val.length <= MAX_SETTING) out.settings[k] = val;
    }
  }
  if (isObj(v.progress)) {
    const p = v.progress;
    if (isObj(p.counters)) {
      for (const [k, n] of Object.entries(p.counters).slice(0, MAX_COUNTERS)) {
        if (ID.test(k) && typeof n === "number" && Number.isFinite(n)) out.progress.counters[k] = Math.min(MAX_COUNT, Math.max(0, Math.floor(n)));
      }
    }
    if (Array.isArray(p.unlocked)) {
      const seen = new Set<string>();
      for (const id of p.unlocked) if (typeof id === "string" && ID.test(id) && !seen.has(id) && seen.size < MAX_UNLOCKED) seen.add(id);
      out.progress.unlocked = [...seen];
    }
    if (isObj(p.tutorial)) {
      out.progress.tutorial = {
        step: typeof p.tutorial.step === "string" && (p.tutorial.step === "" || ID.test(p.tutorial.step)) ? p.tutorial.step : "",
        done: p.tutorial.done === true,
        skipped: p.tutorial.skipped === true,
      };
    }
  }
  return out;
}

/** Note text -> SaveData (an empty or broken note is an empty save). */
export function parseSave(text: string): SaveData {
  try {
    return sanitizeSave(JSON.parse(text));
  } catch {
    return emptySave();
  }
}

/** SaveData -> the note's text (stable key order, readable in Trilium). */
export function serializeSave(d: SaveData): string {
  const s = sanitizeSave(d);
  const settings: Record<string, string> = {};
  for (const k of SETTING_KEYS) if (s.settings[k] !== undefined) settings[k] = s.settings[k];
  const counters = Object.fromEntries(Object.entries(s.progress.counters).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ v: SAVE_VERSION, updatedAt: s.updatedAt, settings, progress: { counters, unlocked: [...s.progress.unlocked].sort(), tutorial: s.progress.tutorial } }, null, 2)}\n`;
}

/**
 * Merge two saves (this device's and the note's): the newer one wins the settings and the tutorial; counters take the larger value and the
 * unlocked sets are united, so progress made on two devices is never lost. `updatedAt` is the later of the two.
 */
export function mergeSave(a: SaveData, b: SaveData): SaveData {
  const [older, newer] = a.updatedAt <= b.updatedAt ? [a, b] : [b, a];
  const counters: Record<string, number> = { ...older.progress.counters };
  for (const [k, n] of Object.entries(newer.progress.counters)) counters[k] = Math.max(counters[k] ?? 0, n);
  return sanitizeSave({
    v: SAVE_VERSION,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    settings: { ...older.settings, ...newer.settings },
    progress: { counters, unlocked: [...new Set([...older.progress.unlocked, ...newer.progress.unlocked])].sort(), tutorial: newer.progress.tutorial },
  });
}

/** Do two saves say the same thing (ignoring `updatedAt`)? */
export function sameSave(a: SaveData, b: SaveData): boolean {
  const strip = (d: SaveData): string => serializeSave({ ...d, updatedAt: 0 });
  return strip(a) === strip(b);
}

/** Read the settings part of a save out of a key/value store (localStorage); only the allowlisted keys. */
export function collectSettings(read: (key: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SETTING_KEYS) {
    const v = read(k);
    if (v !== null && v.length <= MAX_SETTING) out[k] = v;
  }
  return out;
}
