# Build Mode

Press `B` in a room to change how it **looks**: theme, wall decor, floor furniture, rug and bookcase finish. Every choice is stored as **one `biblio_*` label on the room's note**, so it syncs with the vault and survives renames. The label formats are in [Trilium Mapping](Trilium-Mapping.md); the full design and phases are in `knowledge-planning/worldediting-plan.md` Part 2.

Build mode only changes how rooms look. It never touches note content, titles, or the tree structure (renaming, creating, deleting and moving notes from inside the game is *planned*, see [Roadmap and Ideas](Roadmap-and-Ideas.md)).

## Principles

- **Labels are the save file.** No labels means the default look; the app never writes a default value (picking the default removes the label).
- **Preview never writes.** Everything you pick shows live in the room and is saved only when you press `Enter`.
- **One write per change**, each journalled for undo.
- **Build code can only write labels whose names start with `biblio_`.**
- Procedural art only: no images are involved.

## Using it

`B` opens a strip at the bottom of the screen (an amber frame appears around the game). It works only in the library view, in a room, outside the overview. Build mode **pauses the world**: you do not walk while it is open (the original design had walk-while-building; this is a recorded deviation).

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Next / previous tab: **theme, wall, floor, rug, case** |
| Theme tab: `1` to `7` | Pick a theme (chips are clickable too) |
| Theme tab: `S` | Toggle scope: **this room** or **this wing** (the wing button shows "this wing (N rooms)") |
| Wall / Floor tabs: `Left` / `Right` | Select a slot |
| Wall / Floor tabs: `[` `]` (or `Up` / `Down`) | Cycle the slot's kind |
| Wall tab: `+` / `-` | Add or remove extra wall (`biblio_span`, 0 to 4, 96 px each) |
| Rug / Case tabs: `1` to `4` | Pick a style |
| `0` | Reset the current tab (removes its label) |
| `Enter` | Apply: writes one label per change |
| `Esc` | Cancel: drops the preview and closes |
| `Z` / `Shift+Z` | Undo / redo saved edits (also usable outside the panel) |

### Themes (tabs: theme)

Seven moods: **Oak** (the default, no tint), **Midnight**, **Ember**, **Crypt**, **Greenhouse**, **Rosewood**, **Slate**. A theme is a set of colour tints (wall, wainscot, floor, window glass, light shafts, candle flames) plus an optional full-room colour grade.
Tint multiplies, so themes can only darken or shift the base art; all shipped themes are dark-compatible. Light themes need palette-parameterised textures and are *deferred*.

Resolution: the room's own `biblio_theme`, else the nearest ancestor's `biblio_wing` (including the room itself), else Oak. The ancestor walk follows the first parent edge, has a cycle guard and a depth cap of 16. A label on the library root (`biblio_wing`) therefore themes the whole library.
Unknown theme names count as absent.

### Wall slots

One slot per 96 px along the back wall (slot 0 at x=130; the count depends on the room's width). Kinds: `auto` (the deterministic default), `window`, `painting`, `clock`, `banner`, `empty`. Editing one slot is one CSV write (`biblio_wall`: `window,painting,-,auto,banner`), with trailing `auto`s dropped.

### Floor furniture

Up to 8 slots, left to right after the last bookcase: `plant`, `armchair`, `globe`, `lamp`, `bust`, `telescope`, `fireplace` (each has a width; the panel warns "N pieces don't fit in this room and are hidden" and never moves or drops them silently).

### Rug and bookcase finish

Rug: `crimson` (default), `moss`, `navy`, `none`. Case: `oak` (default), `walnut`, `ebony`, `whitewash`; it applies to every bookcase in the room.

### Effects outside the room

The overview tints each room block by its effective theme, and a door shows a small pennant in the destination room's theme colour (when it is not Oak).

## Safety rules (all unit-tested)

- **Own labels only.** `setLabel` re-fetches the note and edits only labels the note itself owns; a write through an inherited attribute would silently edit the ancestor's label.
- **Conflict-safe.** `commitLabel` passes the cached value as `expectedBefore`. If the server's value differs (changed on another device), nothing is written and you get "<label> was changed elsewhere - press refresh, then try again".
- **Undo/redo are serialised** (no overlapping writes) and check the label still holds the value they expect; otherwise a `LabelConflictError` is shown and the entry stays on the stack. Holding `Z` does not queue a pile of undos.
- **The journal is session-only and 50 entries deep.** After a reload there is nothing to undo; Trilium's own revisions and sync are the long-term safety net.
- Duplicate own labels: the **last** wins (as the reader of labels does) and strays are removed on write.
- **The panel writes to the room it was opened for**, not to whichever room is current later. Opening another dialog or pausing the scene ends the preview. Pointer clicks in the world are ignored while paused.
- If saving partly fails, what was *not* saved stays pending (and previewed) so you can retry or cancel, and the message says how many were already saved.

## How it works (for developers)

- `BuildPanel.tsx` keeps a `pending` map of label to value, emits `build:preview` on every change, and on `Enter` calls `commitLabel` for each entry.
- `BibliothecaScene.withPreview` temporarily applies the overrides to the room's labels while drawing; `redrawRoom()` rebuilds in place (no fade, no player move).
- After a commit, `lib/worldedit.ts` patches the in-memory tree and the cache and emits `scene:redraw`.
- Pure logic lives in `game/themes.ts`, `game/decor.ts` and `lib/shelving.ts` and is unit-tested (section 7 to 9 of `tools/unit-test.mjs`).
- **Canvas-renderer gotcha:** headless or GPU-less browsers fall back to Phaser's Canvas renderer, which ignores `setTint` and does not blend shapes with `MULTIPLY`. Theme washes are therefore translucent colour rectangles plus a grade overlay; sprite tints (glass, shafts, flames) only show under WebGL.

## Not built yet

Freeform drag placement, light themes, per-part wallpaper/floor overrides (`biblio_wallpaper`, `biblio_floor` are reserved in the design), the "Organise" tab (structure editing) and in-world ghost slot markers (slots are edited in the panel). See [Roadmap and Ideas](Roadmap-and-Ideas.md). Adding a theme or a label: [Contributing](Contributing.md).
