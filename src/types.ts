/**
 * types.ts — the app's own domain model.
 *
 * These types are deliberately *not* Trilium's wire shapes (those live in
 * lib/trilium/types.ts). The mapping from wire shapes to this model happens
 * once, in lib/library.ts, so the rest of the app (game scene, UI, cache)
 * never sees ETAPI details. That boundary is the "portability discipline"
 * from architecture-scope.md: swapping the backend means rewriting one file,
 * not the whole codebase.
 */

/**
 * A note as this app cares about it — a flat record, no tree structure.
 * The tree is expressed separately (see TreeNode) so rooms can be re-parented
 * or re-laid-out without touching note data.
 */
export interface NoteInfo {
  noteId: string;
  title: string;
  /** Trilium note type: "text" | "code" | "markdown" | "canvas" | ... */
  type: string;
  /**
   * Labels, lowercased name → value ("" when the label has no value).
   * Includes inherited labels only if Trilium included them; we treat the
   * map as "what this note itself carries".
   */
  labels: Record<string, string>;
  /** True when the note has at least one child branch (i.e. it's a folder). */
  hasChildren: boolean;
}

/**
 * One edge in the note tree: `noteId` placed under `parentNoteId` in this
 * order. Trilium's "branch" concept, minus the fields we never use.
 */
export interface TreeEdge {
  parentNoteId: string;
  noteId: string;
  /** Sibling order as reported by Trilium (10, 20, 30...). */
  notePosition: number;
}

/** The walked portion of the vault: all notes + all edges, flat. */
export interface LibraryTree {
  /** Which note the world was built from. */
  rootNoteId: string;
  notes: Record<string, NoteInfo>;
  edges: TreeEdge[];
  /** True when the walk hit the caps in config.TREE_WALK (HUD shows a notice). */
  truncated: boolean;
}

/**
 * A room = one folder note. The world is a grid of rooms; `x`/`y` are grid
 * cells (not pixels). Everything inside the room (shelves, books, doors,
 * NPCs) is derived fresh from the tree on every room entry — it is *not*
 * stored, so the world can never drift from the vault.
 */
export interface RoomPlacement {
  noteId: string;
  x: number;
  y: number;
  /** True when the position came from stored labels (user-placed), false when auto-placed this session. */
  manual: boolean;
}

/**
 * A book on a shelf — a leaf note inside the current room. Thickness and
 * colour are display properties derived in library.ts (documented there).
 */
export interface Book {
  noteId: string;
  title: string;
  type: string;
  /** CSS colour for the spine. */
  color: string;
}

/**
 * A shelf groups the room's books by one label ("tag"). Unlabelled books go
 * to the desk pile instead (see game-ui.md).
 */
export interface Shelf {
  /** Label name without our prefix, e.g. "project". Displayed on the shelf edge. */
  tag: string;
  /** CSS colour of the shelf/book spines. */
  color: string;
  books: Book[];
}

/**
 * A door = a child note that is itself a folder (has children). Entering it
 * navigates into that child room.
 */
export interface Door {
  noteId: string;
  title: string;
}

/** Loose scrolls on the desk — leaf notes with no labels at all. */
export type Scroll = Book;

/** Everything needed to build one room's contents. Derived, never stored. */
export interface RoomContents {
  roomId: string;
  title: string;
  shelves: Shelf[];
  desk: Scroll[];
  doors: Door[];
  /** The parent room, for the exit door. Null for the library root room. */
  parentNoteId: string | null;
}

/** Connection settings, edited in the settings modal, persisted locally. */
export interface Settings {
  /** Trilium base URL, e.g. "http://localhost:31090" (no trailing /etapi). */
  serverUrl: string;
  /** ETAPI token. Stored only in this browser's localStorage — see README. */
  token: string;
  /** Note id the library hangs from; "root" = Trilium's root note. */
  rootNoteId: string;
}

/** Connection status surfaced to the HUD. */
export type ConnState =
  | "disconnected" // no settings yet
  | "connecting"
  | "online"
  | "offline" // settings exist but the server is unreachable
  | "error"; // reachable but rejected us (bad token etc.)