/**
 * lib/yggdrasil.ts — the Yggdrasil data folder in the vault, and the save note inside it.
 *
 * ONLY used when the user switches "save progress in Trilium" on at the shrine (off by default: connecting and playing writes nothing).
 * Then, on the first save, this creates (once) a text note "Yggdrasil" under the library root carrying the label `#biblio_yggdrasil`
 * (the walk keeps that folder out of the library and the forest) and, inside it, a code note "Yggdrasil save" (mime application/json)
 * carrying `#biblio_save`. Both are found by label, so the user may rename or move them. A save first reads what is already there and
 * merges (lib/save.ts), so two devices never overwrite each other's progress.
 */

import { LABELS } from "../config";
import { mergeSave, parseSave, serializeSave, type SaveData } from "./save";
import type { TriliumClient } from "./trilium/client";

/** Oldest first (creation time, then id): the order that decides which of several candidates is THE one. */
function oldestFirst(notes: Array<{ noteId: string; utcDateCreated?: unknown; dateCreated?: unknown }>): Array<{ noteId: string }> {
  const key = (n: { utcDateCreated?: unknown; dateCreated?: unknown }): string => String(n.utcDateCreated ?? n.dateCreated ?? "");
  return [...notes].sort((a, b) => key(a).localeCompare(key(b)) || a.noteId.localeCompare(b.noteId));
}

/**
 * The Yggdrasil folder is found by its LABEL, so it may be renamed or moved. If more than one note carries the label (a copied folder, a second
 * device that created its own), THE folder is the oldest one (everything is found and written there; the others are left alone and reported).
 */
export async function listYggdrasil(client: TriliumClient): Promise<string[]> {
  const found = await client.searchNotes(`#${LABELS.yggdrasil}`);
  return oldestFirst(found.results).map((n) => n.noteId);
}

/** The data folder's note id (the oldest when there are several), or null when it does not exist. */
export async function findYggdrasil(client: TriliumClient): Promise<string | null> {
  return (await listYggdrasil(client))[0] ?? null;
}

/** The data folder, created (and labelled) under `rootNoteId` if absent. WRITES. */
export async function ensureYggdrasil(client: TriliumClient, rootNoteId: string): Promise<string> {
  const have = await findYggdrasil(client);
  if (have) return have;
  const created = await client.createNote({ parentNoteId: rootNoteId, title: "Yggdrasil", type: "text", content: "<p>Data of the Bibliotheca app (settings, progress, places). Safe to leave alone; the app keeps it out of your library.</p>" });
  await client.createAttribute({ noteId: created.note.noteId, type: "label", name: LABELS.yggdrasil });
  return created.note.noteId;
}

/** Candidates with a label, oldest first; those directly inside `folderId` come first. */
async function labelled(client: TriliumClient, label: string, value: string | null, folderId: string | null): Promise<string[]> {
  const found = await client.searchNotes(value === null ? `#${label}` : `#${label}="${value.replace(/["\\]/g, "")}"`);
  const ordered = oldestFirst(found.results);
  if (!folderId) return ordered.map((n) => n.noteId);
  const inside = found.results.filter((n) => (n.parentNoteIds ?? []).includes(folderId)).map((n) => n.noteId);
  return [...ordered.map((n) => n.noteId).filter((id) => inside.includes(id)), ...ordered.map((n) => n.noteId).filter((id) => !inside.includes(id))];
}

/** The save note's id (the one inside THE Yggdrasil folder when there are several), or null. */
export async function findSaveNote(client: TriliumClient): Promise<string | null> {
  const folder = await findYggdrasil(client);
  return (await labelled(client, LABELS.save, null, folder))[0] ?? null;
}

/** What the vault holds: the folder in use, how many extra folders / save notes carry the labels (a warning for the user), the save note. */
export async function inspectYggdrasil(client: TriliumClient): Promise<{ folder: string | null; extraFolders: number; save: string | null; extraSaves: number }> {
  const folders = await listYggdrasil(client);
  const folder = folders[0] ?? null;
  const saves = await labelled(client, LABELS.save, null, folder);
  return { folder, extraFolders: Math.max(0, folders.length - 1), save: saves[0] ?? null, extraSaves: Math.max(0, saves.length - 1) };
}

/** The save stored in Trilium (null when there is none yet). Never throws on a damaged note: that is an empty save. */
export async function loadSave(client: TriliumClient): Promise<SaveData | null> {
  const id = await findSaveNote(client);
  if (!id) return null;
  return parseSave(await client.getNoteContent(id));
}

/**
 * Merge `local` into what Trilium holds and write the result (creating the folder + note on first use). Returns the merged save, which
 * the caller should adopt. WRITES (one content PUT, or the creation of the two notes the first time).
 */
export async function storeSave(client: TriliumClient, rootNoteId: string, local: SaveData): Promise<SaveData> {
  let id = await findSaveNote(client);
  let merged = local;
  if (id) {
    merged = mergeSave(local, parseSave(await client.getNoteContent(id)));
    merged = { ...merged, updatedAt: Math.max(local.updatedAt, merged.updatedAt) };
    await client.putNoteContent(id, serializeSave(merged));
  } else {
    const folder = await ensureYggdrasil(client, rootNoteId);
    const created = await client.createNote({ parentNoteId: folder, title: "Yggdrasil save", type: "code", mime: "application/json", content: serializeSave(local) });
    id = created.note.noteId;
    await client.createAttribute({ noteId: id, type: "label", name: LABELS.save });
  }
  return merged;
}

// ---- places: each point of interest may keep its own settings in a note inside the Yggdrasil folder ---------------------------------------

/** Longest place-settings note we read / write (characters). */
export const PLACE_PROPS_MAX = 8000;
const SECRET_KEY = /(key|token|secret|passw|credential|auth)/i;

/**
 * Coerce stored place settings (JSON text or a value) into a flat, bounded object of strings / numbers / booleans. Keys that look like secrets
 * are DROPPED on read and refused on write: an API key lives in the host's environment (the proxy adds it), never in a note.
 */
export function sanitizePlaceProps(v: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  let size = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 60)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,40}$/.test(k) || SECRET_KEY.test(k)) continue;
    let x: string | number | boolean;
    if (typeof val === "string") x = val.slice(0, 4000);
    else if (typeof val === "number" && Number.isFinite(val)) x = val;
    else if (typeof val === "boolean") x = val;
    else continue;
    size += k.length + String(x).length;
    if (size > PLACE_PROPS_MAX) break;
    out[k] = x;
  }
  return out;
}

/** The note holding a place's settings (inside THE Yggdrasil folder; the oldest when there are several), or null. */
export async function findPlaceNote(client: TriliumClient, placeId: string): Promise<string | null> {
  const folder = await findYggdrasil(client);
  return (await labelled(client, LABELS.place, placeId, folder))[0] ?? null;
}

/** A place's saved settings ({} when none / damaged). READS only. */
export async function readPlaceProps(client: TriliumClient, placeId: string): Promise<Record<string, string | number | boolean>> {
  const id = await findPlaceNote(client, placeId);
  if (!id) return {};
  try {
    return sanitizePlaceProps(JSON.parse(await client.getNoteContent(id)));
  } catch {
    return {};
  }
}

/** Save a place's settings (creates the Yggdrasil folder and the place's note on first use). WRITES. Returns what was stored (secret-looking keys removed). */
export async function writePlaceProps(client: TriliumClient, rootNoteId: string, placeId: string, props: Record<string, unknown>): Promise<Record<string, string | number | boolean>> {
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(placeId)) throw new Error("bad place id");
  const clean = sanitizePlaceProps(props);
  const text = `${JSON.stringify(clean, null, 2)}\n`;
  const have = await findPlaceNote(client, placeId);
  if (have) await client.putNoteContent(have, text);
  else {
    const folder = await ensureYggdrasil(client, rootNoteId);
    const created = await client.createNote({ parentNoteId: folder, title: `Place: ${placeId}`, type: "code", mime: "application/json", content: text });
    await client.createAttribute({ noteId: created.note.noteId, type: "label", name: LABELS.place, value: placeId });
  }
  return clean;
}
