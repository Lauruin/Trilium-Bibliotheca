/**
 * lib/edit.ts — session undo/redo journal for label edits (world building).
 *
 * Each entry is one label write: {noteId, name, before, after}. Undo writes
 * `before` back (null = delete the label), redo writes `after`. In-memory only:
 * undo is for "oops" within a session; Trilium's own revisions/sync are the
 * long-term safety net. Depth is capped so it can't grow without bound.
 */

import type { TriliumClient } from "./trilium/client";
import { setLabel } from "./labels";

export interface LabelEdit {
  noteId: string;
  name: string;
  before: string | null;
  after: string | null;
  /** Human text for toasts, e.g. "Midnight theme". */
  label: string;
}

const MAX_DEPTH = 50;

export class EditJournal {
  private undoStack: LabelEdit[] = [];
  private redoStack: LabelEdit[] = [];
  /** Undo/redo run one at a time: overlapping calls would both act on the same entry. */
  private chain: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  push(edit: LabelEdit): void {
    this.undoStack.push(edit);
    if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Apply the inverse of the latest edit. Returns it, or null if nothing to undo. */
  undo(client: TriliumClient): Promise<LabelEdit | null> {
    return this.serial(async () => {
      const e = this.undoStack[this.undoStack.length - 1];
      if (!e) return null;
      // Expect the value this edit wrote; if it changed elsewhere since, throw
      // LabelConflictError instead of overwriting (the entry stays on the stack).
      await setLabel(client, e.noteId, e.name, e.before, e.after);
      this.undoStack.pop();
      this.redoStack.push(e);
      return e;
    });
  }

  redo(client: TriliumClient): Promise<LabelEdit | null> {
    return this.serial(async () => {
      const e = this.redoStack[this.redoStack.length - 1];
      if (!e) return null;
      await setLabel(client, e.noteId, e.name, e.after, e.before);
      this.redoStack.pop();
      this.undoStack.push(e);
      return e;
    });
  }
}
