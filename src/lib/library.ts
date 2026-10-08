/**
 * lib/library.ts — turns a Trilium note tree into the app's domain model.
 *
 * Mapping rules (from game-ui.md, "Core concept", adapted to Trilium):
 *   - Library root   → the configured root note (default: Trilium's `root`).
 *   - Room           → any note that has at least one child branch (a folder).
 *   - Door           → a child note that is itself a room; entering navigates.
 *   - Shelf          → a label ("tag"); the room's leaf notes carrying that
 *                      label stand on that shelf. A note with two labels is
 *                      cross-listed on both shelves.
 *   - Desk / scrolls → leaf notes with no labels at all ("unfiled" notes).
 *   - Spine colour   → the note's `#color` label if present (Trilium's own
 *                      note-colour feature), else a stable palette colour
 *                      derived from the shelf's tag name (Trilium has no tag
 *                      colours, so we derive one deterministically).
 *   - Spine thickness≈ note length. ETAPI would force a content fetch per
 *                      note to know real length, so v1 uses title length as a
 *                      cheap, deterministic proxy (documented divergence).
 *
 * The tree walk: ETAPI has no subtree endpoint, so we walk note-by-note with
 * GET /notes/{id} (which returns childNoteIds + attributes). Sibling order is
 * the order of childNoteIds, which Trilium reports in tree order. The walk is
 * breadth-first with caps (config.TREE_WALK) and per-note error tolerance.
 */

import { LABELS, TREE_WALK } from "../config";
import type { Book, LibraryTree, NoteInfo, RoomContents, Shelf, TreeEdge } from "../types";
import type { TriliumClient } from "./trilium/client";
import { TriliumApiError } from "./trilium/client";
import type { EtapiNote } from "./trilium/types";

/**
 * Labels that are Trilium machinery rather than user tags. They are excluded
 * from shelf grouping so rooms don't fill with shelves like "iconClass".
 * Pragmatic blocklist — extend it when a new noise label shows up.
 */
const NOISE_LABELS = new Set([
  "archived",
  "color",
  "cssClass",
  "excludeFromPreview",
  "hideChildrenOverview",
  "hidePromotedAttributes",
  "iconClass",
  "keyboardShortcut",
  "run",
  "runOnInstance",
  "shareCss",
  "shareHiddenFromTree",
  "shareOmitDefaultCss",
  "template",
  ...Object.values(LABELS).filter((v) => v !== LABELS.color), // our own biblio.* labels
]);

/**
 * Walk the vault breadth-first from `rootNoteId`.
 *
 * Concurrency: a pool of 8 in-flight getNote calls keeps a 400-note vault
 * from crawling while staying polite to the server. A single failing note
 * (deleted mid-walk, permission hiccup) is skipped, never fatal — the world
 * is still built from what we got.
 */
export async function walkLibraryTree(
  client: TriliumClient,
  rootNoteId: string,
  caps = TREE_WALK,
): Promise<LibraryTree> {
  const notes: Record<string, NoteInfo> = {};
  const edges: TreeEdge[] = [];
  let fetched = 0;
  let truncated = false;

  /** BFS queue; each item carries its depth so no recomputation is needed. */
  const queue: Array<{ id: string; parent: string | null; depth: number }> = [
    { id: rootNoteId, parent: null, depth: 0 },
  ];

  // Simple promise pool over the BFS queue: pop up to POOL jobs at once,
  // refill as they finish, stop when the queue is empty or caps are hit.
  const POOL = 8;
  while (queue.length > 0 && fetched < caps.maxNodes && !truncated) {
    const batch = queue.splice(0, POOL);
    const results = await Promise.all(
      batch.map(async ({ id, parent, depth }) => {
        // "_hidden" is Trilium's own internal subtree (search home, launcher
        // notes, etc.). It is not user content — it would otherwise show up
        // as a permanent door in the Library room. Skip it and its descendants.
        if (id === "_hidden") return null;
        try {
          const n = await client.getNote(id);
          return { n, parent, depth };
        } catch (err) {
          // 404/401 on one note must not kill the walk. Auth errors (401)
          // abort explicitly — no point walking with a dead token.
          if (err instanceof TriliumApiError && err.isAuthError) throw err;
          console.warn(`[library] skipping note ${id}:`, err);
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r === null) continue;
      const { n, parent, depth } = r;
      if (notes[n.noteId] !== undefined) continue; // clone / already visited
      fetched++;

      const children = n.childNoteIds ?? [];
      notes[n.noteId] = toNoteInfo(n, children.length > 0);

      if (parent !== null) {
        edges.push({ parentNoteId: parent, noteId: n.noteId, notePosition: 0 });
      }
      // Expand only up to maxDepth. A note AT the cap is still in the world
      // (as a book or door); its children simply aren't fetched. Clones can
      // loop the queue forever — the `already visited` check above stops that.
      if (depth < caps.maxDepth) {
        queue.push(...children.map((cid) => ({ id: cid, parent: n.noteId, depth: depth + 1 })));
      } else if (children.length > 0) {
        truncated = true;
      }
    }
  }

  // If the loop ended with work left over, a cap (nodes or depth) cut the walk
  // short. Surfaces as a HUD notice rather than a silent truncation.
  const walkedEverything = queue.length === 0;

  return { rootNoteId, notes, edges, truncated: !walkedEverything };
}

function toNoteInfo(n: EtapiNote, hasChildren: boolean): NoteInfo {
  const labels: Record<string, string> = {};
  for (const a of n.attributes ?? []) {
    if (a.type === "label") labels[a.name.toLowerCase()] = a.value ?? "";
  }
  return { noteId: n.noteId, title: n.title, type: n.type, labels, hasChildren };
}

/** Children of `noteId` in tree order. */
export function childIdsOf(tree: LibraryTree, noteId: string): string[] {
  return tree.edges
    .filter((e) => e.parentNoteId === noteId)
    .map((e) => e.noteId)
    .filter((id) => tree.notes[id] !== undefined);
}

/** A room is any note with at least one child branch. */
export function isRoom(tree: LibraryTree, noteId: string): boolean {
  return tree.notes[noteId]?.hasChildren === true;
}

/** CSS colour palette for shelves/tags without their own colour. */
const PALETTE = [
  "#8a5a44", "#5a6e8a", "#5f8a5a", "#8a5a7e", "#8a7a4a",
  "#4a8a86", "#7e8a5a", "#8a5a5a", "#5a5a8a", "#6e8a4a",
];

/** Stable colour for an arbitrary string (tag name) — no randomness anywhere. */
export function stableColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * Build one room's contents from the tree. Pure function of (tree, roomId) —
 * the world can never drift from the vault because nothing here is cached
 * between room visits.
 */
export function buildRoomContents(tree: LibraryTree, roomId: string): RoomContents {
  const note = tree.notes[roomId];
  if (!note) throw new Error(`buildRoomContents: unknown room ${roomId}`);

  const parentEdge = tree.edges.find((e) => e.noteId === roomId);

  // Group leaf children by label; unlabelled ones go to the desk.
  const shelfMap = new Map<string, { color?: string; books: Book[] }>();
  const desk: Book[] = [];

  for (const childId of childIdsOf(tree, roomId)) {
    const child = tree.notes[childId];
    if (!child || isRoom(tree, childId)) continue; // rooms become doors, not books

    const tags = Object.keys(child.labels).filter(
      (name) => !NOISE_LABELS.has(name) && name !== LABELS.color,
    );
    const book: Book = {
      noteId: child.noteId,
      title: child.title,
      type: child.type,
      color: child.labels[LABELS.color] || "",
    };

    if (tags.length === 0) {
      desk.push(book);
    } else {
      for (const tag of tags) {
        const entry = shelfMap.get(tag) ?? { books: [] };
        entry.books.push(book);
        // First explicit colour on any book of this shelf becomes the shelf colour.
        if (book.color && !entry.color) entry.color = book.color;
        shelfMap.set(tag, entry);
      }
    }
  }

  const shelves: Shelf[] = [...shelfMap.entries()].map(([tag, entry]) => ({
    tag,
    color: entry.color || stableColor(tag),
    // Fill in per-book spine colours: explicit #color, else the shelf colour.
    books: entry.books.map((b) => ({ ...b, color: b.color || entry.color || stableColor(tag) })),
  }));
  desk.forEach((b) => {
    if (!b.color) b.color = stableColor("desk");
  });

  const doors = childIdsOf(tree, roomId)
    .filter((id) => isRoom(tree, id))
    .map((id) => ({ noteId: id, title: tree.notes[id].title }));

  return {
    roomId,
    title: roomId === tree.rootNoteId ? "Library" : note.title,
    shelves,
    desk,
    doors,
    parentNoteId: parentEdge?.parentNoteId ?? null,
  };
}