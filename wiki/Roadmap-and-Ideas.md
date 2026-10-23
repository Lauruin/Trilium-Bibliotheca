# Roadmap and Ideas

Everything on this page is a **plan or an idea unless marked built**. The sources are `knowledge-planning/next-directions.md` (design panel and Addenda 1 to 8), `knowledge-planning/worldediting-plan.md`, `game-ui.md` and the persona-debate findings (which are archived outside the repo).
Nothing here is a promise. The standing priorities of the project owner, in order, are quick capture, reliable todos/calendar, and sync; the game world is the fun part, not the priority bar.

## Status board

| Area | Status |
|---|---|
| Walkable library, doors at any depth, bookcases by tag, reader, wisp search | **Built** ([Library View](Library-View.md), [Reader](Reader.md)) |
| Overview with draggable rooms; positions stored as labels | **Built** |
| Build mode: themes, wall, floor, rug, case, span, undo journal (worldediting Part 2, P0 to P3) | **Built** ([Build Mode](Build-Mode.md)) |
| Quick capture, PWA install, Android share target | **Built** ([Capture and PWA](Capture-and-PWA.md)); phone use parked |
| Yggdrasil as a **forest** in 3D: one tree per top-level folder standing in the ground around the central world tree (Yggdrasil, a giant trunk with a door, altar, wisp post and a crown of places) and joined to it by walkable ground roots (the star junction) (the older arched-hub layout stays selectable with `Y`), 13 species, voxel and low-poly looks (the low-poly one with real sun shadows, `K`), ten animals in three categories, flight, aimed jumps, spider silk, grip by gravity, radius model and taper, leaf kinds and sizes, branch names, ground and horizon | **Built** ([Tree View](Tree-View-Yggdrasil.md), [Animals Guide](Animals-Guide.md)) |
| Canopy **foliage** per species (puffs, tiers, strands, blossom, umbrella, tufts, wisps), fog-like: hides the thin wood from afar, fades near the animal and camera, toggle `F` + density slider; both looks | **Built** ([Tree View](Tree-View-Yggdrasil.md#foliage-f)); wind sway, seasons and leaf fall are ideas |
| Editing branch **properties** (species, length, thickness, taper, spin, pitch, attach, bend) in a panel (`B`), saved as labels, with recalculate and undo | **Built** (Addendum 5, partly) |
| Placing **leaves** by hand: the label `biblio_lat` is read by the layout, but no editor writes it | **Label built, editor UI open** |
| Mock tooling: real mock, in-memory fake, vault generator, conformance tests | **Built** ([Mock and Seeding](Mock-and-Seeding.md)) |
| Socrates as a real Socratic assistant (intelligence service, RAG) | **Not built.** The statue says so honestly |
| Structure editing from inside the game (rename, create, delete, move, retag; worldediting Part 1) | **Planned, not built** |
| Moving branches by dragging in the 3D view, and re-parenting notes (Addendum 5, see the tree list below) | **Planned, not built** |
| Links made visible (ribbons, gems, lianas), freshness, lantern trail | **Planned, not built** |
| Tilemap painter for rooms | **Planned, not built** |
| Door "depth" transitions | **Idea, not built** |
| Texture packs (PNG plus manifest, runtime swap) | **Planned, not built**; one procedural built-in pack ships |
| Multiple libraries / townsquare hub, quest board (calendar), canvas/corkboard rooms | **Parked or cut**; see `game-ui.md` |
| Widget wrapper inside Trilium, single-origin nginx proxy | **Possible later, not started** |
| Top-down view | **Skipped** (a re-skin with no new verb) |

## Recommended order from the design panel (2026-10-20)

1. **Make the library alive and links visible** (about 2 sessions): freshness glow and dust, lantern pennants on doors, spine ribbons and gems, a halo on selection, day/night grade. Reads only data the walk already fetches.
   Needs `modified` and `links` on `NoteInfo` and the tree cache key bumped to `biblio.v3.treeCache`; relations come from the `internalLink` attributes that Trilium maintains (with the catches recorded in the plan: only content saved by the editor or by `PUT /content` with `text/plain` produces them).
2. **Tilemap editor** in the side-scroller (about 2.5 sessions): one optional painted layer per room, stored in a hidden child code note pointed to by a `biblio_tilemap` label, with a procedural tileset and a painter with undo. Labels cannot hold this data (a CSV caps at 200 characters).
3. **Lizard tree**: this became the Yggdrasil view and is built. The remaining tree work is in the lists below.

Shared prerequisites: a small active-scene registry once the second scene exists (the module-level `current` wiring is its seed), and docs updated with each feature.

## Cheap fun ideas (ranked by delight per effort in the plan)

Painting your own room; freshness glow and dust; a **lantern trail** (doors lit if anything below changed recently); ribbons, gems and halo for links; real-clock day/night; a **librarian cat** sleeping on the most recently modified book; fast travel by clicking a room in the overview or from search; fog of war with "37/52 rooms" (kept in localStorage, never in the vault);
a Lost & Found for orphan notes; procedural WebAudio (off by default, `M`); Socrates as an oracle ("random note", "on this day"). Todo quests stay parked.

## Door transitions (Addendum 1, idea)

Walking into a door as *depth*, not a teleport. Level 1 (cheap): zoom and cross-fade so the child room grows out of the doorway; Level 2: depth lanes; Level 3: a fully continuous zoomable world, closest to the tree idea. Recommendation recorded: Level 1 first.

## Tree: what is built and what is open (Addenda 2 to 8)

- **Manual tree editing (Addendum 5, long-run wish): partly done.** Built: the **branch panel** (`B`) edits eleven properties per folder (length, thickness, taper, rotation on the parent, pitch, attach, bend, species and the wave: amplitude, frequency, shape), previews live, and saves one `biblio_*` label per change with recalculate and undo ([Tree View](Tree-View-Yggdrasil.md#editing-branches-b)).
  **Open:** (1) a **leaf placement editor UI** for `biblio_lat` (the layout reads it, nothing writes it, and unpinned leaves do not flow around pinned ones); (2) editing a branch by **aiming and keys in the 3D view** (the `A`/`D` rotate, `Q`/`E` slide, ghost preview sketch below) instead of sliders; (3) **re-parenting** (drag a branch or leaf onto another branch = move the note; needs `POST /branches` plus deleting the old branch, see worldediting Part 1); (4) mirrored or gnarled presets and a tree-wide style.
- **A legend for the branch names and labels.** Names exist (`N`: signs, bubbles, off). A legend idea (a key explaining what colours or signs stand for) was floated and is **open**; no design is recorded.
- **Shift = stay (done 2026-10-23).** Walking up past a side branch's base on the side where it grows now climbs into it by itself and `Shift` means "stay on this branch"; silk threads keep the Shift rule; the ground roots at the foot of the world tree are entered walking down (the star junction, done).
- **Step S (done 2026-10-23): tree first, world tree, shrine, wisp, save.** The app starts in the tree view (library = a door at the foot of Yggdrasil, lazy chunk, WebGL fallback); the root note became a giant world tree: you **start on a porch** (a nest on a low branch, with the altar), the wisp has its own low branch, the door is at the foot, and the crown has limbs for **places** (none registered until the modes exist; low limbs for later characters such as Socrates); the search wisp can light the way; saving settings / progress to a `biblio_save` note in a `biblio_yggdrasil` folder is opt-in. Still open of this step: the places themselves (clock, mite, gardener, editor), unlocks and the tutorial, "unlock all", folder content (extra notes the user adds to the Yggdrasil folder) growing as extra limbs.
- **Step L: the ant as reader (first a separate mite), the leaf view, hover excerpts, the learning gate (done 2026-10-23).** Not done: reading with markup (links, images) on the leaf, the ant's own camera in the 3D tree, learning interactions on the leaf (they arrive with the gardener).
- **Pause menu with rebindable keys (done 2026-10-23, user request).** Not done: gamepad / touch controls, per-animal bindings, import / export of key sets.
- **Steps G (gardener) and E (3D editor with a confirmation diff) are NOT done**; the run was stopped at the user's request after step U and the pause menu.
- **Step U: unlocks + tutorial (done 2026-10-23).** See [Tree View](Tree-View-Yggdrasil.md#progress-unlocks-and-the-tutorial). Not done: unlocks for looks / species, rewards from the gardener (step G feeds the same counters), a tutorial for the editor.
- **Step S extras (done 2026-10-23, from play-testing):** mouse camera steers reach / jump / flight; spider silk reworked (infinite rope, hold `X` down, `Space` up, `WASD` swing, `Shift` let go, persistent but cuttable threads); the roster: the mite is gone (the **ant** has its size and its own category `1`), the **beetle** takes the ant's old size, the very long **constrictor** (Würgeschlange) and the big fast **eagle** join; mouse-camera flight (strafe, throttle, skydive); clouds stand in the world; signs on top of big branches and names on the wood of small ones; walking from a root onto the giant trunk fixed; the data folder is found by LABEL (the oldest wins when several exist, with a warning), places can keep non-secret settings notes inside it. Open: whether the Yggdrasil folder should also hold place objects as notes you can edit in Trilium (the settings notes are the first step).
- **Step D: time of day (done 2026-10-23).** `daylight.ts` / `clock.ts` / `sky.ts`; real / fixed / fast clock at the altar; moon, stars, dusk colours, shadows fading out, the wisp as a night lantern. Not done: a latitude setting, moon phases, weather, glowing note leaves at night.
- **Spider silk rework (done 2026-10-23).** Hold `X` down / `Space` up / `WASD` swing / `Shift` let go, no maximum rope length, threads persist between sessions and `C` cuts them; the mouse camera steers reach, jump aim, flight and the swing.
- **Done in round 4 (Addendum 8):** aimed jumps with arc preview and auto-target, the blue jay's feet and landing mode, the ant reaching instead of jumping, the jumping spider, spider silk, a forest of 13 species with editable and recalculable properties.
- **Huts, agents and lodgings.** AI personas (for example Socrates) living in huts in the tree or in lodgings at ground level, with the wisp trailing the player. Idea.
- **Lianas and platforms for links.** Related notes joined by lianas or ropes, floating platforms for other link kinds; mapping from the link table: named relation as a vine you can ride, clone as a graft thread, backlink as highlighted inbound vines. Idea. (Spider silk threads exist now, but they are a session-only toy, not links.)
- **Seasons and biomes** (species per area exist now; seasons and biome areas are a very late idea).
- **Animals by zoom level.** Ant when small, lizard or snake, an ape in the semi-macro that hops between branches, a bird at maximum zoom that can jump anywhere, with continuous zoom and level-of-detail (canopy, branch, leaf-reading with text on the leaf). Idea; the ten animals exist but are chosen by number key, not by zoom.
- **Unlockable animals, skins and tree decorations; an AI-generated artificial tree with an objective seeded in notes.** Ideas.
- **Mite or fungus fast travel inside a branch** (a "wormhole" between related notes). Low priority idea.
- **Leaf interaction polish:** fast travel from search, glow for recent edits. Idea.
- **Nicer animals.** Done in round 5: every animal has a modelled look in both looks (see the [Animals Guide](Animals-Guide.md#what-they-look-like)). Still ideas: fur / feather detail, more idle behaviours, seasonal skins.
- **Persisting silk threads** across reloads. Not planned.

### Labels for tree editing (Addendum 5): built versus proposed

| Label | On | Value | Status |
|---|---|---|---|
| `biblio_species` | a folder | species name | **Built** (inherits down) |
| `biblio_blen` | a folder | length in px (the original idea was a factor) | **Built** |
| `biblio_bthick`, `biblio_btaper` | a folder | start radius in px, end/start ratio | **Built** (new, not in the original sketch) |
| `biblio_bspin`, `biblio_bpitch` | a folder | degrees around the parent / off the parent (replace the sketched `biblio_bdir` = `azimuth,pitch`) | **Built** |
| `biblio_bat` | a folder | 0 to 1 along the parent | **Built** |
| `biblio_bbend` | a folder | -1 droop to +1 lift | **Built** |
| `biblio_lat` | a note (leaf) | `s,th` | Read by the layout; **no editor** |

Remaining interaction sketch (not built): aim at a branch or leaf in the 3D view; `A`/`D` rotate, `W`/`S` pitch, `Q`/`E` slide along the parent, `[` `]` length; leaves slide with the arrow keys; `Enter` saves, `Esc` cancels, `Z` undoes, and a ghost preview shows the result before saving. The panel is the stand-in for this today.
Order of the original plan: leaf placement first (cheapest, most wanted), then branch direction and attach, then length and bend, then **re-parenting**.

## Other plans

- **Structure editing** (worldediting Part 1): Walk, Edit and Overview as exclusive modes; rename, create, delete (with undo and a typed confirmation for rooms with descendants), move by creating the new branch first and only then deleting the old one (never `DELETE /notes` to move), retag by dragging books between shelves, plain-text quick edit with a conflict check and a revision before overwriting. Protected: root, `_hidden`, the Inbox.
  Safety stance: the game should be a safe **organiser**, not an editor; long-form writing stays in Trilium.
- **Intelligence service** (RAG over the vault, Socrates and a "receptionist"), a **townsquare** between libraries, a **quest board** for calendar tasks (the calendar would live in a CalDAV server, with Trilium linking by UID): all outside the current slice. See `game-ui.md` and `knowledge-planning/odysseus-and-roadmap.md`.
- **Phase 3 game modes** (hack-and-slash defence, corruption bleeding into notes, a note that comes alive and quizzes you) are cut from active planning. Hard rule if ever revived: no game mechanic may write to real note data.
- **Insight currency / progression**: cosmetic-only, meaningful inside the world, stored as a label on a dedicated note. Idea.

## Recent feedback rounds

The user's feedback rounds and what was done about each are recorded as Addenda 2 to 8 in `knowledge-planning/next-directions.md`. Addendum 7 covers round 3 (mock build-out and docs, grip on vertical trunks, auto-align, radius and taper, branch names, voxel preferred, ant and spider, flight for bee, dragonfly and blue jay, animal categories on the number keys); Addendum 8 covers round 4 (aimed jumps, jay feet and landing, the ant, a forest of species with editable properties saved as labels, crawlers that cannot jump, spider silk, ant reach).

See also [Decisions](Decisions.md) and [Contributing](Contributing.md).
