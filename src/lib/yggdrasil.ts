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

/** The data folder's note id, or null when it does not exist. */
export async function findYggdrasil(client: TriliumClient): Promise<string | null> {
  const found = await client.searchNotes(`#${LABELS.yggdrasil}`);
  return found.results[0]?.noteId ?? null;
}

/** The data folder, created (and labelled) under `rootNoteId` if absent. WRITES. */
export async function ensureYggdrasil(client: TriliumClient, rootNoteId: string): Promise<string> {
  const have = await findYggdrasil(client);
  if (have) return have;
  const created = await client.createNote({ parentNoteId: rootNoteId, title: "Yggdrasil", type: "text", content: "<p>Data of the Bibliotheca app (settings, progress). Safe to leave alone; the app keeps it out of your library.</p>" });
  await client.createAttribute({ noteId: created.note.noteId, type: "label", name: LABELS.yggdrasil });
  return created.note.noteId;
}

/** The save note's id, or null. */
export async function findSaveNote(client: TriliumClient): Promise<string | null> {
  const found = await client.searchNotes(`#${LABELS.save}`);
  return found.results[0]?.noteId ?? null;
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
