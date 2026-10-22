/**
 * lib/worldedit.ts — React-side glue for world-building edits: write a label,
 * mirror it into the in-memory tree + cache, record it in the undo journal and
 * tell the scene to redraw. (The scene itself never talks to Trilium.)
 */

import { bus } from "../game/events";
import { saveTreeCache } from "./cache";
import { EditJournal, type LabelEdit } from "./edit";
import { patchTreeLabel, setLabel } from "./labels";
import type { TriliumClient } from "./trilium/client";
import { getState } from "../state/store";
import type { LibraryTree } from "../types";

/** The session's one undo journal. */
export const journal = new EditJournal();

function mirror(tree: LibraryTree, e: LabelEdit, value: string | null): void {
  // Patch the tree that is current NOW: a refresh may have replaced it while the write was in flight.
  const live = getState().tree ?? tree;
  patchTreeLabel(live, e.noteId, e.name, value);
  if (live !== tree) patchTreeLabel(tree, e.noteId, e.name, value);
  saveTreeCache(live);
  bus.emit("scene:redraw", undefined);
}

/** Write `value` (null = remove) as an undoable edit. Throws if the write fails. */
export async function commitLabel(
  client: TriliumClient,
  tree: LibraryTree,
  noteId: string,
  name: string,
  value: string | null,
  label: string,
  /** What the caller believes the label is now (from the cached tree); a mismatch throws LabelConflictError. */
  expectedBefore?: string | null,
): Promise<LabelEdit> {
  const { before } = await setLabel(client, noteId, name, value, expectedBefore);
  const edit: LabelEdit = { noteId, name, before, after: value, label };
  journal.push(edit);
  mirror(tree, edit, value);
  return edit;
}

export async function undoEdit(client: TriliumClient, tree: LibraryTree): Promise<LabelEdit | null> {
  const e = await journal.undo(client);
  if (e) mirror(tree, e, e.before);
  return e;
}

export async function redoEdit(client: TriliumClient, tree: LibraryTree): Promise<LabelEdit | null> {
  const e = await journal.redo(client);
  if (e) mirror(tree, e, e.after);
  return e;
}
