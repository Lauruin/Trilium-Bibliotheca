/**
 * lib/treeedit.ts — saving the tree view's branch properties as labels (see ui/BranchPanel.tsx).
 *
 * A property is stored on the FOLDER's note as a `biblio_b*` label only while it differs from the
 * calculated value: setting it back to the calculated value (or pressing ↺) removes the label, so
 * "recalculate" is just "no label". The pure planning (`planChanges`) is separate from the writing
 * (`saveChanges`, one undoable `commitLabel` per label, conflict-checked against the cached value).
 */

import { PROP_LABELS, PROP_RANGES, type BranchInfo, type EnumPropKey, type NumPropKey, type PropKey } from "../tree/layout";
import type { LibraryTree, NoteInfo } from "../types";
import { commitLabel } from "./worldedit";
import type { TriliumClient } from "./trilium/client";

/** Pending edits of one branch: number/string = new override, null = force the calculated value, absent = untouched. */
export type Pending = Partial<Record<PropKey, number | string | null>>;

export interface LabelChange {
  name: string;
  /** null = remove the label. */
  value: string | null;
  /** Human text for the undo journal / notices. */
  label: string;
}

/** The text-valued properties (species, wave shape): written as given, the rest are numbers rounded to their slider step. */
export const isEnumKey = (key: PropKey): key is EnumPropKey => key === "species" || key === "waveFn";

/** Set (value), force-recalculate (null) or drop (undefined) one pending edit; returns a new object. */
export function setPending(p: Pending, key: PropKey, value: number | string | null | undefined): Pending {
  const next = { ...p };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

const decimals = (step: number): number => (step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(step))));

/** The string a number is stored as: rounded to its slider step (no 12.000000001 in someone's notes). */
export function formatNumber(key: NumPropKey, v: number): string {
  return Number(v.toFixed(decimals(PROP_RANGES[key].step))).toString();
}

/** Labels to write/remove so that `note` ends up with `pending` applied (values equal to the calculated one drop the label). */
export function planChanges(note: NoteInfo, info: BranchInfo, pending: Pending): LabelChange[] {
  const out: LabelChange[] = [];
  for (const key of Object.keys(pending) as PropKey[]) {
    const name = PROP_LABELS[key];
    const has = Object.prototype.hasOwnProperty.call(note.labels, name);
    const v = pending[key];
    if (v === undefined) continue;
    let value: string | null;
    if (v === null) value = null;
    else if (isEnumKey(key)) value = String(v) === info.calc[key] ? null : String(v);
    else {
      const s = formatNumber(key, Number(v));
      value = s === formatNumber(key, info.calc[key]) ? null : s;
    }
    if (value === null && !has) continue; // nothing to remove
    if (value !== null && has && note.labels[name] === value) continue; // unchanged
    out.push({ name, value, label: value === null ? `${key} recalculated` : `${key} = ${value}` });
  }
  return out;
}

/** Remove every saved override of this note (the "Recalculate all" button). */
export function recalcAll(note: NoteInfo): LabelChange[] {
  return (Object.keys(PROP_LABELS) as PropKey[])
    .filter((k) => Object.prototype.hasOwnProperty.call(note.labels, PROP_LABELS[k]))
    .map((k) => ({ name: PROP_LABELS[k], value: null, label: `${k} recalculated` }));
}

/** Write the changes one by one (each is one undoable journal entry). Returns how many were written. */
export async function saveChanges(client: TriliumClient, tree: LibraryTree, noteId: string, changes: LabelChange[]): Promise<number> {
  let written = 0;
  for (const c of changes) {
    const cached = tree.notes[noteId]?.labels[c.name] ?? null;
    await commitLabel(client, tree, noteId, c.name, c.value, c.label, cached);
    written++;
  }
  return written;
}
