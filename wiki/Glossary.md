# Glossary

Terms in alphabetical order. Where a word means two things (Trilium and Bibliotheca both say "branch"), both are given.

**Animal** - a creature in the tree view, defined as data (`Animal` in `src/tree/sim3.ts`). Ten exist, in three categories. See [Animals Guide](Animals-Guide.md).

**Aim** - holding `Space` with a jumping animal (lizard, cat, flying squirrel, jumping spider): you stand still, steer the aim with `A`/`D`/`W`/`S`, an arc preview with an auto-target shows the landing, releasing leaps.

**Attribute** - Trilium's umbrella term for a label or a relation attached to a note. The app reads only `type: "label"` attributes.

**Auto-align** - `H` in the tree view (free movement only): gently straightens the heading along the branch while you are not steering.

**Guided / free movement** - `M` in the tree view: guided (default) = `W` up the branch, `S` down, `A`/`D` turn on it in smooth curves; free = the old steered heading.

**Blob id (`blobId`)** - a content hash id Trilium puts on a note; it changes when the content does. The leaf-size cache is keyed by it.

**Book** - a leaf note (no children) shown as a spine on a bookcase in the library.

**Bookcase / case** - a shelf unit in a room, holding the books of one label (tag). 56 by 64 px, three tiers.

**Branch (Trilium)** - Trilium's link between a parent note and a child note. A note with several parents has several branches (a clone). `branchId` is `<parentNoteId>_<noteId>`.
**Branch (tree view)** - a folder drawn as a 3D rail you can walk on. Not to be confused with the Trilium meaning.

**Branch properties** - the eight editable values of a folder branch: length, thickness, taper, spin, pitch, attach, bend, species. Each is calculated by the layout and can be overridden by a `biblio_b*` / `biblio_species` label; edited in the branch panel (`B`).

**Build mode** - `B` in a room: decorate it by writing `biblio_*` labels. See [Build Mode](Build-Mode.md).

**Bus (event bus)** - the typed emitter in `src/game/events.ts` connecting Phaser and React.

**Calculated / override / effective** - for a branch property: what the layout computes, the label that replaces it (only present while it differs), and the value used (`override ?? calculated`). Removing the label is "recalculate".

**Category** - a group of animals on a number key: `1` crawlers (ant, spider, jumping spider, snake), `2` walkers (lizard, cat), `3` fliers (flying squirrel, bee, dragonfly, blue jay).

**Clone** - a note that has more than one parent in Trilium. The app records every parent edge and fetches the note once.

**Container / devcontainer** - the development container this project is worked on in. Commands "run in the CONTAINER" come from its terminal. See [Getting Started](Getting-Started.md).

**Desk / unfiled** - the first bookcase of a room, holding notes with no labels at all.

**Door** - a child folder of the current room; walking in and pressing `E` enters it.

**`dind`** - the Docker-in-Docker sidecar of the devcontainer; a hostname that exists only inside the Docker network (`http://dind:8080`).

**ETAPI** - Trilium's external REST API (`/etapi/...`), token-authenticated. The only backend interface the app uses.

**Fake** - `tools/etapi-fake.mjs`, an in-memory ETAPI look-alike for development and tests. See [Mock and Seeding](Mock-and-Seeding.md).

**Flight (hover / wing)** - the two free-flight models of fliers: hover (bee, dragonfly) and wing (blue jay).

**Frame (rotation-minimising)** - the tangent/up/side axes along a 3D branch that keep "top" on top.

**Glide** - the flying squirrel's steerable, slow-falling leap.

**Grip** - the 0 to 1 meter that drains while hanging on a surface whose normal points down. Empty grip is a never-fatal slip. `G` toggles it.

**Head / trail** - you steer the animal's head; the body follows the head's recorded path (the trail).

**Hub** - the library root as seen in the tree view in hub layout: a short fat stump at the origin from which every top-level folder's tree grows. In forest layout the root is **Yggdrasil** instead (the giant world tree with the door, altar, wisp post and a crown of places). **Place** - a game mode or tool on a limb of Yggdrasil's crown. **Star junction** - where the ground roots meet at the world tree's foot.

**Inbox** - the note labelled `biblio_inbox` that quick capture files new notes under.

**Inheritable label** - a Trilium label flagged `isInheritable`; it appears on every descendant with the **owner's** note id. The app treats only labels whose owner is the note itself as its own.

**Label** - a Trilium attribute with a name and an optional value (`#name=value`). The app uses labels both as **tags** (shelves) and as its **save file** (`biblio_*`).

**Leaf** - a note in the tree view, drawn with a kind (shape) and a size.

**Leaf kind** - broad, needle, maple, blossom or fruit, chosen by note type or the `biblio_leaf` label.

**Library root** - the note the world hangs from; setting "Library root note id", default `root`.

**Look** - the tree view's render style: **voxel** (cubes) or **low-poly** (flat-shaded facets). `L` switches.

**Mock (real mock)** - the disposable Trilium container the tests use (`bibliotheca-trilium-mock`). Never a real vault.

**Noise label** - a Trilium machinery label (such as `iconClass`) that must not become a shelf; see `NOISE_LABELS`.

**Overview** - `O`: all rooms as blocks on a grid, draggable.

**Own label** - a label whose owner note is the note itself (as opposed to one inherited from an ancestor).

**Pangolin** - a reverse-proxy tunnel service mentioned in the HTTPS setup notes. See [Capture and PWA](Capture-and-PWA.md).

**Plaque** - the box under the top bar that shows a room's (or a door's) description text.

**Profile (seed profile)** - a named vault shape the generator can build: small, medium, large, huge, deepchain, widefan, longtail.

**PWA** - progressive web app: the installable form of Bibliotheca, with a share target.

**Rail** - a branch as a path you can walk on, with surface coordinates `(branch, s, th)`.

**Reach** - the hold-`Space` stretch of the snake and the ant (the animals that cannot jump) that can bridge to another branch.

**Room** - a folder note shown as one walkable screen in the library.

**Share target** - the manifest feature letting Android share text or links into quick capture.

**Silk (thread)** - what the spider and jumping spider spin with `X`: a rope to swing on that stays behind as a climbable thread until the page reloads (never saved to the vault).

**Slot** - a fixed place for decor: wall slots (96 px apart) and floor slots.

**Socrates** - the statue NPC; an honest placeholder for a not-yet-built Socratic assistant.

**Span** - `biblio_span`: extra empty wall (0 to 4 units of 96 px).

**Species** - the kind of a tree in the tree view (oak, birch, maple, pine, willow, cherry, acacia, baobab, redwood, aspen, ash, cypress, ghost): how it grows and what colour its bark and leaves are. Set with `biblio_species`, else automatic.

**SwiftShader** - software GL used to get WebGL in headless Chromium in the container.

**Tag** - a label on a leaf note (not noise, not `biblio_*`); it becomes a bookcase.

**Taper** - a branch's radius falling linearly from base to tip.

**Theme** - one of seven room colour moods; `biblio_theme` for a room, `biblio_wing` for a room and its descendants.

**Voxel** - a cube on a grid; the default look is built from them.

**Tree (forest)** - in the tree view each top-level folder is its own tree (trunk, branches, leaves), all growing from the hub.

**Walk (the tree walk)** - the breadth-first fetch of the vault note by note, with caps of 400 notes and depth 8.

**Walk cap** - those limits; exceeding them sets `truncated` and shows a toast.

**Wing** - a room and all its sub-rooms sharing a theme through `biblio_wing`.

**Wisp** - the search NPC in every room; opens Trilium's full-text search.

**Yggdrasil** - the name of the tree view (the world tree).
