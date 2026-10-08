/**
 * config.ts — global constants and conventions.
 *
 * Everything that a future session would otherwise have to re-derive lives
 * here, with the reason attached. Keep this file boring and truthful.
 */

/**
 * Labels this app reads and writes on Trilium notes.
 *
 * Trilium stores labels as attributes (type "label") with a lowercase name and
 * an optional string value — they are the natural place for app-specific data
 * because they travel with the note (renames/moves keep them) and are synced
 * by whatever already syncs Trilium (see game-ui.md, "Layout is data").
 *
 * Naming: we namespace with `biblio.` so the app can never collide with
 * labels a user (or another tool) already uses. Trilium normalises attribute
 * names to lowercase, so `Biblio.X` and `biblio.x` are the same label.
 */
export const LABELS = {
  /** Horizontal grid cell of a room (integer as string). Absent = auto-placed. */
  roomX: "biblio.x",
  /** Vertical grid cell of a room (integer as string). Absent = auto-placed. */
  roomY: "biblio.y",
  /**
   * Note colour override, in Trilium's own convention (#color label, CSS
   * colour name or hex). NOT written by us — we only read it for spine colour.
   */
  color: "color",
} as const;

/**
 * Which note the library hangs from. v1 supports one "library" (one root
 * note); the townsquare hub / multiple libraries concept from game-ui.md is a
 * later increment. `null` means "Trilium's root note" (`root` is Trilium's
 * well-known noteId for the tree root).
 */
export const DEFAULT_ROOT_NOTE_ID = "root";

/**
 * Hard caps for the initial tree walk. ETAPI has no "get subtree" endpoint,
 * so the world is built by walking GET /notes/{id} recursively. The caps keep
 * a huge vault from stalling the first load; hitting a cap degrades
 * gracefully (deeper rooms still exist as doors and are fetched on demand
 * when entered). See library.ts.
 */
export const TREE_WALK = {
  maxNodes: 400,
  maxDepth: 8,
} as const;

/** localStorage keys. Versioned so a format change invalidates old data. */
export const STORAGE = {
  settings: "biblio.v1.settings",
  treeCache: "biblio.v1.treeCache",
} as const;

/**
 * Ground-floor amenity names, used as interactable labels in the world.
 * From game-ui.md: wisp/PC = keyword search, receptionist/Socrates = the
 * (not yet built) intelligence service. We render Socrates as an honest
 * placeholder until that service exists — no fake AI.
 */
export const NPC = {
  wisp: "Wisp",
  socrates: "Socrates",
} as const;

/** Display hints for the player, surfaced by the HUD. */
export const CONTROLS_HINT = "←→/AD move · Space/W jump · E/Enter interact · O overview";