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
 * GOTCHA (verified against v0.106.0): Trilium normalises attribute names and
 * *strips dots* — a label created as `biblio.x` comes back as `biblio_x`.
 * So these names use underscores from the start; never write dotted names.
 * Names are lowercase-insensitive server-side.
 */
export const LABELS = {
  /** Horizontal grid cell of a room (integer as string). Absent = auto-placed. */
  roomX: "biblio_x",
  /** Vertical grid cell of a room (integer as string). Absent = auto-placed. */
  roomY: "biblio_y",
  /**
   * Note colour override, in Trilium's own convention (#color label, CSS
   * colour name or hex). NOT written by us — we only read it for spine colour.
   */
  color: "color",
  /** Marks the note that quick capture files new notes under (the "inbox"). */
  inbox: "biblio_inbox",
  // --- world building (docs: knowledge-planning/worldediting-plan.md, Part 2) ---
  // All live on ROOM notes, are never `isInheritable` (wings are resolved in the
  // app), and hold slugs/CSV — see src/game/themes.ts for the value sets.
  /** Look of this room only: a theme slug (oak, midnight, ember, …). */
  theme: "biblio_theme",
  /** Look of this room AND its sub-rooms (nearest ancestor wins). */
  wing: "biblio_wing",
  /** Wall decor per 96px slot, CSV: window,painting,-,auto,banner. */
  wall: "biblio_wall",
  /** Floor furniture left→right after the last bookcase, CSV. */
  furniture: "biblio_furniture",
  /** Rug style: crimson | moss | navy | none. */
  rug: "biblio_rug",
  /** Bookcase finish for every case in the room: oak | walnut | ebony | whitewash. */
  bookcase: "biblio_case",
  /** Extra empty wall to decorate: integer 0–4, each adds one 96px wall slot. */
  span: "biblio_span",
  /** Optional leaf style override on a note (tree view): broad|needle|maple|blossom|fruit. */
  leaf: "biblio_leaf",
  /** The Yggdrasil data folder (app data: the save note, ...): kept out of the library and the forest. Auto-created only when saving to Trilium is switched on. */
  yggdrasil: "biblio_yggdrasil",
  /** The note inside it that holds the app's save (settings, unlocks, progress; JSON). */
  save: "biblio_save",
  /** A note inside the Yggdrasil folder that holds the settings of one PLACE (value = the place id; JSON, never a secret). */
  place: "biblio_place",
  /** Learning modes (quizzes, the leaf view, the gardener) may only use notes that carry this label, own or INHERITED (put it on a folder to opt a whole branch in). Absent = never a target. */
  learn: "biblio_learn",
  /** Never send this note (or, inherited, a whole folder) to an AI provider, even when it also carries `biblio_learn`. */
  noai: "biblio_noai",
  // --- tree view: per-folder branch properties (src/tree/layout.ts, PROP_LABELS). Own labels of the FOLDER note,
  // numbers as strings; absent / invalid = the calculated value. Out-of-range numbers are clamped, garbage is ignored.
  /** Tree species of a folder (oak, birch, maple, pine, ...; tree/species.ts), case-insensitive. Inherits DOWN to sub-folders (they may override). */
  species: "biblio_species",
  /** Branch length in px (the whole centreline). */
  branchLength: "biblio_blen",
  /** Branch thickness: start radius in px. */
  branchThickness: "biblio_bthick",
  /** Branch taper: end radius / start radius, 0.2..1. */
  branchTaper: "biblio_btaper",
  /** Rotation around the parent ("side", stored as `spin`; the old name was "spiral"/azimuth): degrees around the parent's axis where the branch leaves,
   *  0 = the parent's top (for a tree trunk: the direction it leans, 0 = +z, 90 = +x). Wraps at 360. */
  branchSpin: "biblio_bspin",
  /** Pitch: degrees off the parent's direction (a trunk: off the hub's vertical). */
  branchPitch: "biblio_bpitch",
  /** Attach point along the parent, 0..1 of its length (ignored for tree trunks: they start at the hub's end / in the ground). */
  branchAttach: "biblio_bat",
  /** Bend: -1 droops .. +1 lifts the branch. */
  branchBend: "biblio_bbend",
  /** Wave amplitude: sideways swing of the centreline as a FRACTION of the branch's length (0..0.3). */
  branchWave: "biblio_bwave",
  /** Wave frequency: cycles along the branch (0.25..12). */
  branchWaveFreq: "biblio_bwfreq",
  /** Wave shape: none | sine | zigzag | sawtooth | helix | sbend | noise (case-insensitive). */
  branchWaveFn: "biblio_bwfn",
  /** Leaf (note) placement on its branch: `s,th` = fraction 0..1 along the branch, degrees around it (0 = top). */
  leafAt: "biblio_lat",
} as const;

/** Prefix of every label this app owns; such labels never become shelves. */
export const BIBLIO_PREFIX = "biblio_";

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
 * gracefully: notes beyond the node cap are simply absent (there is no lazy
 * fetch on entering a room), a note AT the depth cap is kept but its children
 * are not fetched, and `tree.truncated` shows a toast. See library.ts.
 */
export const TREE_WALK = {
  maxNodes: 400,
  maxDepth: 8,
} as const;

/** localStorage keys. Versioned so a format change invalidates old data. */
export const STORAGE = {
  settings: "biblio.v1.settings",
  reader: "biblio.v1.reader",
  readerScroll: "biblio.v1.readerScroll", // noteId → 0..1 scroll position of the reader (the 200 most recent notes)
  treeCache: "biblio.v2.treeCache", // v2: labels are own-only (inherited ones dropped)
  leafSizes: "bibliotheca.leafsizes.v1", // noteId → {blob, len}: content lengths for leaf sizes (numbers only)
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
export const CONTROLS_HINT = "←→/AD move · Space/W jump · E/Enter interact · O overview · Q up · C capture · B build · Z undo";