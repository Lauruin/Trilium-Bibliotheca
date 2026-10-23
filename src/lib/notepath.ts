/**
 * lib/notepath.ts — where a note sits in the walked vault: breadcrumb path, siblings, and the link to open it in Trilium.
 *
 * Pure functions over the walked `LibraryTree` (no network). The tree stores edges parent -> child in Trilium's order;
 * a cloned note has several edges and the FIRST one found is its "primary" parent (the same rule the layouts use).
 */

import type { LibraryTree } from "../types";

interface Index {
  parentOf: Map<string, string>;
  children: Map<string, string[]>;
}

const cache = new WeakMap<LibraryTree, { edges: number; idx: Index }>();

function indexOf(tree: LibraryTree): Index {
  const hit = cache.get(tree);
  if (hit && hit.edges === tree.edges.length) return hit.idx;
  const parentOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const e of tree.edges) {
    if (!parentOf.has(e.noteId)) parentOf.set(e.noteId, e.parentNoteId);
    const list = children.get(e.parentNoteId);
    if (list) list.push(e.noteId);
    else children.set(e.parentNoteId, [e.noteId]);
  }
  const idx = { parentOf, children };
  cache.set(tree, { edges: tree.edges.length, idx });
  return idx;
}

/**
 * Ids from the vault root down to the PARENT of `noteId` (the note itself excluded). Empty for the root or an
 * unknown note. Cycle-safe (a clone cycle cannot loop) and bounded.
 */
export function ancestorsOf(tree: LibraryTree, noteId: string): string[] {
  const { parentOf } = indexOf(tree);
  const out: string[] = [];
  const seen = new Set<string>([noteId]);
  let cur = parentOf.get(noteId);
  while (cur !== undefined && !seen.has(cur) && out.length < 64) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return out.reverse();
}

export interface Siblings {
  prev: string | null;
  next: string | null;
  /** 0-based position among the siblings, and how many there are. */
  index: number;
  total: number;
}

/** The notes before and after `noteId` under its (first) parent, in Trilium's tree order. */
export function siblingsOf(tree: LibraryTree, noteId: string): Siblings {
  const { parentOf, children } = indexOf(tree);
  const parent = parentOf.get(noteId);
  const list = parent !== undefined ? children.get(parent) ?? [] : [];
  const index = list.indexOf(noteId);
  if (index === -1) return { prev: null, next: null, index: -1, total: 0 };
  return { prev: index > 0 ? list[index - 1] : null, next: index < list.length - 1 ? list[index + 1] : null, index, total: list.length };
}

/**
 * A link that opens the note in Trilium's own web UI. Best effort: Trilium's URL is `<server>/#root/<note path>`, and
 * the path from the walked tree is only right when the walk started at Trilium's real `root` and the note's primary
 * parent chain is the one Trilium shows. Returns null when the server URL is unknown or the walk did not start at `root`.
 */
export function triliumUrl(serverUrl: string | undefined, tree: LibraryTree | null, noteId: string): string | null {
  if (!serverUrl || !/^https?:\/\//i.test(serverUrl)) return null;
  const base = serverUrl.replace(/\/+$/, "");
  if (!tree || tree.rootNoteId !== "root") return `${base}/#${noteId}`;
  const path = [...ancestorsOf(tree, noteId), noteId];
  return path[0] === "root" ? `${base}/#${path.join("/")}` : `${base}/#root/${path.join("/")}`;
}
