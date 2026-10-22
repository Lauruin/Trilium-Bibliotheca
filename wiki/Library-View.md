# Library View

The default view: a pixel-art side-scroller (Phaser 3). You stand in **one room at a time**. A room is a Trilium folder; it is built fresh from the vault every time you enter it.
How notes map to rooms is in [Trilium Mapping](Trilium-Mapping.md); decorating them is in [Build Mode](Build-Mode.md).

## What is in a room

- **Bookcases** along the back wall, left to right: the **"unfiled"** case first (notes with no labels), then one case per label (tag). A tag that does not fit one case continues on the next (`reading`, `reading 2`, ...).
  A case is 56 by 64 px with three tiers; each tier holds up to 16, 16 and 14 spines. The nameplate on top shows the tag in the tag's colour.
- **Book spines**: one per note, width 5 to 12 px from the title length (a real length would need a content fetch per note; the tree view does measure lengths, see [Tree View](Tree-View-Yggdrasil.md)).
  Colour is the note's own `#color`, else the shelf colour. Walk up to one and the hint "E - open <title>" appears.
- **Doors** for child folders, in a row along the right wall (44 px apart, filling leftwards), hint "E - enter <title>". When the destination room's theme is not the default oak, a small pennant above the door shows that theme's colour.
- **An exit door** (left) back to the parent: "E - back up one level". The library root has none.
- **The wisp** ("E - search the vault") opens the search panel. **Socrates** ("E - talk to Socrates") opens an honest placeholder: the Socratic/RAG assistant is a separate plane of the architecture that is not built, so the statue says so instead of faking an AI.
- **Wall decor, floor furniture, a rug**: windows with light shafts, paintings, sconces and so on, drawn in code. Defaults are deterministic (a hash of the room), so a room never changes look between visits unless you change its labels.
- A **description plaque** under the top bar shows an excerpt (up to 240 characters) of the current room's own note text (text, markdown and code notes). Standing at a door shows that folder's text instead. The plaque is clickable (opens the full note) and closable.

### Limits (nothing is silently lost)

| Limit | Value | What you see |
|---|---|---|
| Bookcases per room, including "unfiled" | 12 | The last case shows "+N not shown" |
| Doors drawn per room | 10 | A "+N doors" note |
| Walk caps for the whole vault | 400 notes, depth 8 | Toast "Vault larger than the walk cap - showing the first rooms only." |

Rooms **grow wider** with their contents: width is `max(640, 72 + 60 x cases + 100 + 44 x doors + 50)` plus 96 px per `biblio_span` step.

## Controls

| Key | Action |
|---|---|
| `A`/`D` or `Left`/`Right` | Walk (110 px/s) |
| `Space`, `W` or `Up` | Jump (on the floor only) |
| `E` or `Enter` | Interact with the nearest thing in range (a book, a door, the exit, the wisp, Socrates) |
| `Q` or `Backspace` | Go one folder up (same as the exit door) |
| `O` | Toggle the overview |
| `B` | Build mode (only in a room, in the library view, not during the overview) |
| `Z` / `Shift+Z` (or `Ctrl+Z`) | Undo / redo a saved build-mode edit |
| `C` | Quick capture (ignored while typing or with a dialog open) |
| `T` | Switch to the tree view |
| Mouse | Click a spine, door, exit, wisp or Socrates to use it; the HUD has buttons for capture, tree/library, build, search, overview, refresh, settings |

Interact range is 46 px from the player's centre (the world bounds stop you about 40 px short of a wall door; if you change room size, re-check this).
Keys never fire while a dialog is open (React pauses the scene) or while you type in an input. The scene registers its keys without browser capture so letters such as `a d e w o` and `Space` can be typed into capture and search.

Arriving: going down through a door puts you at the room's exit door; going back up puts you in front of the door you came through. Never in the middle of the room.

The breadcrumb in the top bar lists the path from the library root; each part is a button that jumps there. The connection chip shows `online`, `connecting`, `offline - cached`, `not connected` or `error`.

## Overview (`O`)

Zooms out so every room is a labelled block on a grid. Each block shows the title, "N notes - M rooms", and `placed` (position stored in labels) or `auto` (placed this session).
Block colour follows the room's effective theme, so wings read at a glance; the root has a gold border.

| Input | Action |
|---|---|
| Click a block | Enter that room |
| Drag a block (6 px or more) onto a free cell | Move it; the position is written as `biblio_x` and `biblio_y` on the room's note; toast "Room position saved to the note's labels." |
| Drop on an occupied cell | Snaps back with "That cell is occupied - room snapped back." |
| Arrows / `WASD` / mouse wheel | Pan (zoom never goes below 0.3; bigger vaults pan) |
| `O` or the "exit overview" button | Back to the room |

Rooms without stored positions are auto-placed deterministically in reading order (6 per row, the root at 0,0). **Manual placements always win** and auto-placement only fills gaps.
If saving fails you get a warning and the move is kept only until the next full reload.

## Touch (parked)

Coarse-pointer devices (or `?touch=1` on a desktop) show on-screen buttons: left, right, jump, interact and up. Touch is **parked**: it works in principle and is not actively developed or tested.

## Gotchas

- Opening a dialog (search, reader, capture, settings) pauses the scene; build mode ends if another dialog opens.
- Headless or GPU-less browsers use Phaser's Canvas renderer, which ignores `setTint`; theme washes therefore use translucent rectangles. See [Build Mode](Build-Mode.md).
- A door named "Hidden Notes" would be Trilium's `_hidden` subtree; the walk skips it, so you should not see one.
- More help: [Troubleshooting](Troubleshooting.md).
