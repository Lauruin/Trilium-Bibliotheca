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
   * OWN labels only, lowercased name → value ("" when the label has no value).
   * Trilium also lists inheritable labels of ancestors on a note (with the
   * owner's noteId); library.ts#toNoteInfo drops those, so this map is exactly
   * "what this note itself carries".
   */
  labels: Record<string, string>;
  /** True when the note has at least one child branch (i.e. it's a folder). */
  hasChildren: boolean;
  /** Trilium's content hash id; changes when the content does (leaf size cache key). */
  blobId?: string;
  /**
   * THE LEARNING GATE: true when the note carries the label `biblio_learn` itself or inherits it (an inheritable label on an ancestor folder).
   * Only such notes may be the target of any learning mode (the gardener's corrupted leaves, quizzes ...). Absent = never a target.
   */
  learn?: boolean;
  /** True when the note carries (or inherits) `biblio_noai`: its text is never sent to an AI provider, even if it is `learn`. */
  noai?: boolean;
}

/**
 * One edge in the note tree: `noteId` placed under `parentNoteId` in this
 * order. Trilium's "branch" concept, minus the fields we never use.
 */
export interface TreeEdge {
  parentNoteId: string;
  noteId: string;
  /** Always 0 as filled by the walk: sibling order is the order of the edges (= Trilium's tree order, from childNoteIds). */
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
  /** Spine colour of the "unfiled" bookcase that holds the desk notes. */
  deskColor: string;
  doors: Door[];
  /** The parent room, for the exit door. Null for the library root room. */
  parentNoteId: string | null;
}

/** Connection settings, edited in the settings modal, persisted locally. */
export interface Settings {
  /** Trilium base URL, e.g. "http://localhost:8080" (no trailing /etapi). */
  serverUrl: string;
  /** ETAPI token. Stored only in this browser's localStorage — see README. */
  token: string;
  /** Note id the library hangs from; "root" = Trilium's root note. */
  rootNoteId: string;
  /**
   * Hosted mode: the app's own origin proxies /etapi/ to the host's Trilium and injects the token server-side, so `serverUrl` is ""
   * and there is no token (see lib/serverconfig.ts). Never stored: derived from /config.json at every boot.
   */
  proxy?: boolean;
}

/** Connection status surfaced to the HUD. */
export type ConnState =
  | "disconnected" // no settings yet
  | "connecting"
  | "online"
  | "offline" // settings exist but the server is unreachable
  | "error"; // reachable but rejected us (bad token etc.)