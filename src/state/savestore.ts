/**
 * state/savestore.ts — keeping the app's save (lib/save.ts) in sync with Trilium, only when the user asked for it.
 *
 * `syncOn()` is a localStorage flag (`biblio.v1.syncSave`, default OFF). While it is off nothing here ever talks to Trilium. The local
 * copy of the player's progress lives in localStorage (`biblio.v1.save`); the view settings are read straight from their own keys.
 */

import { collectSettings, emptySave, mergeSave, parseSave, sameSave, SETTING_KEYS, serializeSave, type SaveData } from "../lib/save";
import { loadSave, storeSave } from "../lib/yggdrasil";
import type { TriliumClient } from "../lib/trilium/client";

const FLAG_KEY = "biblio.v1.syncSave";
const SAVE_KEY = "biblio.v1.save";

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
    /* storage full / disabled: the save is a convenience */
  }
};

export const syncOn = (): boolean => read(FLAG_KEY) === "on";
export function setSyncOn(on: boolean): void {
  write(FLAG_KEY, on ? "on" : "off");
}

/** This device's save: the cached progress + the CURRENT view settings. */
export function localSave(): SaveData {
  const cached = parseSave(read(SAVE_KEY) ?? "");
  return { ...cached, settings: collectSettings(read) };
}

/** Remember progress locally (the settings are not stored here: they have their own keys). */
export function rememberProgress(progress: SaveData["progress"]): void {
  const cur = localSave();
  write(SAVE_KEY, serializeSave({ ...cur, settings: {}, progress, updatedAt: Date.now() }));
}

/** Adopt a (merged) save: its settings go back to their localStorage keys, its progress into the cache. */
export function adopt(save: SaveData): void {
  for (const k of SETTING_KEYS) if (save.settings[k] !== undefined) write(k, save.settings[k]);
  write(SAVE_KEY, serializeSave({ ...save, settings: {} }));
  lastSynced = save;
}

let lastSynced: SaveData | null = null;

/** Has anything changed since the last sync (so a save would write something)? */
export function dirty(): boolean {
  return lastSynced === null || !sameSave(localSave(), lastSynced);
}

export type SyncResult = { ok: true; what: "saved" | "loaded" | "nothing"; save: SaveData } | { ok: false; message: string };

/** Pull what Trilium holds and merge it in (READS only). */
export async function loadNow(client: TriliumClient): Promise<SyncResult> {
  try {
    const remote = await loadSave(client);
    if (!remote) return { ok: true, what: "nothing", save: localSave() };
    const merged = mergeSave(localSave(), remote);
    adopt(merged);
    return { ok: true, what: "loaded", save: merged };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Merge into Trilium's copy and write it (WRITES; creates the Yggdrasil folder + save note the first time). */
export async function saveNow(client: TriliumClient, rootNoteId: string): Promise<SyncResult> {
  try {
    const local = { ...localSave(), updatedAt: Date.now() };
    const merged = await storeSave(client, rootNoteId, local);
    adopt(merged);
    return { ok: true, what: "saved", save: merged };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export { emptySave };
