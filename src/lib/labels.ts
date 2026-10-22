/**
 * lib/labels.ts — the ONLY write path for world-building labels.
 *
 * Rules (from the world-building design): build code may write `biblio_*`
 * labels and nothing else; every write re-fetches the note first and works on
 * its OWN labels only (a PATCH through an inherited attribute id would silently
 * edit the owner's attribute); the caller learns the previous value so it can be
 * undone; an unexpected previous value (changed on another device) is reported
 * instead of overwritten blindly.
 */

import { BIBLIO_PREFIX } from "../config";
import type { LibraryTree } from "../types";
import type { TriliumClient } from "./trilium/client";

export class LabelConflictError extends Error {
  constructor(
    readonly noteId: string,
    readonly name: string,
    readonly actual: string | null,
  ) {
    super(`label ${name} on ${noteId} changed elsewhere`);
  }
}

/**
 * Set (value string) or remove (null) the own label `name` on `noteId`.
 * `expectedBefore` (optional): if given and the server's current value differs,
 * throws LabelConflictError and writes nothing. Returns the previous value
 * (null = label did not exist).
 */
export async function setLabel(
  client: TriliumClient,
  noteId: string,
  name: string,
  value: string | null,
  expectedBefore?: string | null,
): Promise<{ before: string | null }> {
  if (!name.startsWith(BIBLIO_PREFIX)) {
    throw new Error(`refusing to write non-biblio label "${name}"`);
  }
  const note = await client.getNote(noteId);
  const own = (note.attributes ?? []).filter(
    // Trilium keeps the name's case as typed; the app reads names lowercased, so match that way.
    (a) => a.type === "label" && a.noteId === noteId && a.name.toLowerCase() === name,
  );
  // The reader (library.ts#toNoteInfo) lets the LAST duplicate win, so that is
  // the one we treat as "the" label; stray duplicates are removed on write.
  const existing = own[own.length - 1];
  const before = existing ? existing.value ?? "" : null;
  if (expectedBefore !== undefined && expectedBefore !== before) {
    throw new LabelConflictError(noteId, name, before);
  }
  if (value === null) {
    for (const a of own) await client.deleteAttribute(a.attributeId);
  } else if (existing) {
    for (const stray of own.slice(0, -1)) await client.deleteAttribute(stray.attributeId);
    if (existing.value !== value) await client.patchAttribute(existing.attributeId, { value });
  } else {
    await client.createAttribute({ noteId, type: "label", name, value });
  }
  return { before };
}

/** Optimistically mirror a successful label write into the in-memory tree. */
export function patchTreeLabel(
  tree: LibraryTree,
  noteId: string,
  name: string,
  value: string | null,
): void {
  const note = tree.notes[noteId];
  if (!note) return;
  const key = name.toLowerCase();
  if (value === null) delete note.labels[key];
  else note.labels[key] = value;
}
