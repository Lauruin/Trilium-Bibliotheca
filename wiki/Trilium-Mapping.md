# Trilium Mapping

How Trilium concepts become Bibliotheca concepts, and exactly what the app reads and writes.
Everything here is checked against `src/lib/library.ts`, `src/config.ts`, `src/tree/layout.ts` and friends.

## The mapping at a glance

| Trilium | Library view (rooms) | Tree view (Yggdrasil) |
|---|---|---|
| The library root note (setting, default `root`) | The "Library" room | The **hub**: a short stump at the origin that the trees grow from |
| A **top-level** folder (a child of the root that has children) | A door in the Library room | Its own **tree**: a trunk with a species (oak, birch, ...) |
| A note **with children** ("folder") | A **room** | A **branch** (a side branch of its parent folder; a top-level folder is a trunk) |
| A child that is itself a folder | A **door** in the parent room | A side branch |
| A note **without children** | A **book** (a spine on a bookcase) | A **leaf** standing on its parent folder's branch |
| A label ("tag") on a leaf note | The note is shelved on the bookcase for that label; a note with two labels stands on both | Not used for placement; the first tag only picks the leaf colour |
| A leaf with no labels | The first bookcase, "unfiled" | Normal leaf |
| `#color` label | Spine colour | Leaf colour (else the first tag's colour, else the tree species' leaf colour) |
| Note type (a `code` note with a markdown mime counts as `markdown`) | Decides how the reader shows it (text, markdown and code render; everything else shows raw source with a notice) | Leaf **kind** (broad, needle, maple, blossom, fruit) |
| Content length | Not used (spine width follows the title length, 5 to 12 px) | Leaf **size** (0.55 to 2.0, measured lazily) |
| Sibling order (`childNoteIds` order) | Door order | Order along the branch |
| A clone (note with several parents) | Appears in every parent's room | Folder: grown once under its first parent. Leaf: a leaf on each parent folder's branch |
| Trilium's `_hidden` subtree | Skipped by the walk (it would show a "Hidden Notes" door) | Same, skipped |

Details worth knowing:

- **Room versus book is decided by "has children"**, not by note type. A text note that gained a child note becomes a room (and its own text becomes the room description on the plaque).
  A folder with no children is a book.
- **Which parent is "the" parent:** the app uses the **first edge it met** for a note (`tree.edges.find(...)`), i.e. in walk order. For a clone that is not necessarily the parent Trilium marks as primary.
- **The root's room is titled "Library"** whatever the root note is called.
- Relations (`type: "relation"` attributes, including Trilium's automatic `internalLink`) are **ignored** by the app. Only attributes of type `label` are read. Link visualisation is *planned*, see [Roadmap and Ideas](Roadmap-and-Ideas.md).
- Archived notes (`#archived`): the app does not hide them. It excludes `archived` from shelves only because that label is noise (below); an archived note still appears as a room or book if the walk fetches it.

## Labels the app owns

All names are lowercase with underscores and **no dots** (Trilium strips dots from attribute names: `biblio.x` is stored as `biblio_x`). Trilium keeps the case you typed; the app reads names lowercased and matches case-insensitively.
None of these is ever written as `isInheritable`: wings are resolved inside the app.

| Label | Put on | Value format | Meaning | Written by |
|---|---|---|---|---|
| `biblio_x`, `biblio_y` | a **room** note | integers as strings, e.g. `3`, `1` | Grid cell in the overview. Both must be present and parse as integers; otherwise the room is auto-placed (6 per row, reading order; the root room at 0,0) | Dragging a room in the overview (`saveRoomPosition` through `setLabel`) |
| `biblio_inbox` | one note | no value | Marks the note quick capture files under. The first capture creates an "Inbox" note under the library root and labels it | Quick capture (`createAttribute`, not `setLabel`) |
| `biblio_theme` | a room | slug: `oak`, `midnight`, `ember`, `crypt`, `greenhouse`, `rosewood`, `slate` | Theme of this room only | Build mode |
| `biblio_wing` | a room (also valid on the root) | same slugs | Theme of this room **and its sub-rooms**; the nearest ancestor wins; a room's own `biblio_theme` beats it | Build mode |
| `biblio_wall` | a room | CSV, one entry per 96 px wall slot: `window,painting,-,auto,banner` | Wall decor. Kinds: `window`, `painting`, `clock`, `banner`. `-` = deliberately empty, `auto` or a missing entry = the deterministic default | Build mode |
| `biblio_furniture` | a room | CSV, left to right after the last bookcase: `plant,armchair,lamp` | Floor furniture. Kinds: `plant`, `armchair`, `globe`, `lamp`, `bust`, `telescope`, `fireplace` | Build mode |
| `biblio_rug` | a room | `crimson` (default), `moss`, `navy`, `none` | Rug style | Build mode |
| `biblio_case` | a room | `oak` (default), `walnut`, `ebony`, `whitewash` | Finish for every bookcase in the room | Build mode |
| `biblio_span` | a room | integer `0` to `4` | Extra empty wall, 96 px per step, to decorate | Build mode |
| `biblio_leaf` | a **note** (a leaf) | `broad`, `needle`, `maple`, `blossom`, `fruit` (any case) | Overrides the leaf kind chosen by note type in the tree view | **You, in Trilium** (the app only reads it) |
| `biblio_species` | a **folder** (branch) | `oak`, `birch`, `maple`, `pine`, `willow`, `cherry`, `acacia`, `baobab`, `redwood`, `aspen`, `ash`, `cypress`, `ghost` (any case) | Tree species of this folder **and its sub-folders** (they may override); on the root it styles the hub only. Absent = automatic (top-level trees) or inherited | Branch panel (`B`), or you in Trilium |
| `biblio_blen` | a folder | number, px, 20 to 9000 | Branch length. Absent = calculated | Branch panel |
| `biblio_bthick` | a folder | number, px, 3 to 150 | Branch start radius (thickness) | Branch panel |
| `biblio_btaper` | a folder | number, 0.2 to 1 | End radius / start radius | Branch panel |
| `biblio_bspin` | a folder | degrees, wraps at 360 | Spiral position: azimuth around the parent's axis (0 = parent's top); for a trunk around the hub | Branch panel |
| `biblio_bpitch` | a folder | degrees, 0 to 110 | Angle off the parent's direction (a trunk: off vertical) | Branch panel |
| `biblio_bat` | a folder | number, 0.03 to 0.97 | Where it leaves its parent (fraction of the parent's length); ignored for trunks | Branch panel |
| `biblio_bbend` | a folder | number, -1 to 1 | Droop (negative) or lift | Branch panel |
| `biblio_lat` | a **note** (a leaf) | `s,th`: 0 to 1 along the branch, degrees around it (0 = top) | Pins a leaf at that spot (clamped onto the branch) | **You, in Trilium** (no editor yet) |

Rules that apply to the look labels (`theme` to `span`) and, in the same spirit, to the tree labels:

- **No labels means the default look.** The app never writes a default value; choosing the default removes the label.
- **The tree labels (`biblio_species`, `biblio_b*`, `biblio_lat`) store an *override* of a calculated value.** Numbers are plain decimals as strings (`12`, `-3.5`, `2,5` and `1e3` also parse); finite values outside the range are **clamped**, garbage and non-finite values (`abc`, `1e999`) are **ignored** (the calculated value is used); `spin` wraps into 0 to 360. The app writes them rounded to the slider step.
- **Unknown or garbled values count as absent.** Unknown CSV entries are kept verbatim when a CSV is rewritten (a newer app version may know them) and drawn as the default.
- CSV limits (the decor labels): 200 characters, 24 entries.
- Every `biblio_*` label is **excluded from shelves** (so your rooms do not grow a bookcase called "biblio_theme"). The exclusion is built from `LABELS` plus a `biblio_` prefix test.

### Labels the app reads but does not own

- **`#color`**: Trilium's own note colour (CSS name or hex). Read for spine colour (library) and leaf colour (tree, validated against a colour pattern). Never written.
- **Everything else** that is not noise and does not start with `biblio_` is a **tag**: it becomes a bookcase in the library. A tag's colour is the first explicit `#color` on any of its books, else a stable palette colour derived from the tag name (no randomness).
- **Noise labels** that never become shelves: `archived`, `color`, `cssClass`, `excludeFromPreview`, `hideChildrenOverview`, `hidePromotedAttributes`, `iconClass`, `keyboardShortcut`, `run`, `runOnInstance`, `shareCss`, `shareHiddenFromTree`, `shareOmitDefaultCss`, `template`, plus all `biblio_*` labels. The list lives in `NOISE_LABELS` in `src/lib/library.ts`; extend it when a new machinery label shows up as a stray shelf.

## The own-versus-inherited gotcha

Trilium lists an **inheritable** label of an ancestor on every descendant, with the **owner's** `noteId`. If the app treated that as the child's own label it would
(a) show wrong shelves and looks, and (b) on write, silently **edit the owner's attribute** (a PATCH through an inherited attribute id returns 200 and changes the owner).
So both ends filter: `toNoteInfo` keeps a label only when `attribute.noteId` equals the note's own id, and `setLabel` re-fetches the note and only touches own labels. The tree cache key moved from `v1` to `v2` when this fix landed. Verified live; see "Verified ETAPI contract" in `AGENTS.md`.

Related name facts: `biblio-Probe.Case` is stored as `biblio_Probe_Case` (hyphens and dots become `_`, case kept); duplicate own labels are allowed by Trilium, the **last one wins** in the app and `setLabel` removes strays on write.

## What the app writes to your vault (complete list)

1. The `biblio_*` labels above, via `setLabel` (room positions, build mode, and the tree **branch panel**: `biblio_species`, `biblio_blen`, `biblio_bthick`, `biblio_btaper`, `biblio_bspin`, `biblio_bpitch`, `biblio_bat`, `biblio_bbend`, only on folder notes you edit). Never `biblio_lat` (nothing writes it yet).
2. **New notes** from quick capture: a text note under the Inbox (HTML-escaped paragraphs), plus the Inbox note itself on first use.
3. Nothing else. Existing note **content, titles and structure are never modified**; build code refuses any label name not starting with `biblio_`.

Reads: `GET /app-info`, `GET /notes/{id}` (the walk), `GET /notes/{id}/content` (reader, room plaque, leaf sizes), `GET /notes?search=` (wisp search and inbox lookup), `POST /auth/login` (only from the settings dialog).
Writes: `POST /create-note`, `POST`/`PATCH`/`DELETE /attributes`.

## How a room is derived from the tree

`buildRoomContents(tree, roomId)` is a pure function:

1. Take the room's children in tree order. Children that are rooms become **doors**.
2. Each remaining child is a **book**. Its tags are its labels minus noise, minus `biblio_*`, minus `color`.
3. No tags: the book goes on the "unfiled" case. Otherwise it goes on one shelf per tag.
4. The bookcase packer (`lib/shelving.ts`) fills a case tier by tier (3 tiers); a tag with more books than fit continues on `reading 2`, `reading 3`, ... up to the per-room cap (see [Library View](Library-View.md)).

## How the tree is derived

`layoutTree(tree)` (`src/tree/layout.ts`) is pure and deterministic (all jitter comes from a hash of the note id), so the tree looks the same on every visit and only changes where the vault changed.
The root becomes the hub and every top-level folder a tree with a species; branch radius, length, taper, leaf placement, the species table, which properties can be overridden by labels and the rules for leaf kind and size are in [Tree View (Yggdrasil)](Tree-View-Yggdrasil.md). A property label simply replaces the calculated value; remove the label and the calculated value is back ("recalculate").

## Markdown notes on a real server

ETAPI v0.106 has **no `markdown` note type**: a markdown note arrives as type `code` with a markdown mime (`text/x-markdown`; see `tools/lib/vault-apply.mjs`). The app handles this in two places: `effectiveType(type, mime)` in `src/lib/content.ts` (the reader) and `toNoteInfo` in `src/lib/library.ts` (the walk), which both turn `code` plus a mime containing "markdown" into `markdown`.
So against a real server these notes render as markdown in the reader, get the **maple** leaf in the tree and have their size measured as raw length, exactly like the fake started with `--markdown-type`. A `code` note with any other mime stays code. (Covered by unit section 21; not re-verified against a markdown note in a live Trilium for this page.)
