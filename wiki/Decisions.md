# Decisions

Why things are the way they are. Each entry says what was decided, why, and where the reasoning lives. A decision marked **decided** should not be changed unilaterally: propose it and wait (rule from `AGENTS.md`).

## Architecture

### A standalone web app, not a Trilium plugin (decided)

Trilium has no plugin SDK: no manifest, no registry, no extension API. What exists is JavaScript code notes, the `#run=frontendStartup` label and custom widgets, and the Script API is experimental and may change without notice.
So the deliverable is a React + Phaser app talking to **ETAPI**, a stable, documented contract that can be tested against a disposable instance with a fast dev loop. A widget wrapper that loads the built bundle is a possible later, thin layer; do not build a "plugin framework" and do not design for the widget case first. *(Source: `AGENTS.md`, "Architecture".)*

### ETAPI straight from the browser, no backend of our own

The app is plain static files once built. The browser calls Trilium directly, so the container that serves it is **stateless**: no token, no environment, no volumes. The dev path and the production path stay identical (no dev proxy).
Consequences: Trilium must allow the app's origin through CORS (`TRILIUM_NETWORK_CORS_ALLOW_ORIGIN`, since v0.93.0); an `https://` page cannot call an `http://` Trilium; the ETAPI token has to live in the browser (see the security summary below).
A single-origin setup (the app's nginx proxying `/etapi/` to Trilium, no CORS) is possible and **not built**. *(Sources: `vite.config.ts`, `Dockerfile`, README.)*

### Labels are the save file, not a database or a sidecar file

Layout and looks are labels on the notes themselves (`biblio_x`, `biblio_theme`, ...). They sync with whatever already syncs Trilium, follow a note when it is renamed or moved (attributes stick to the note id, not the path), and there is no hidden file that can go stale. The persona debate rejected a sidecar for exactly this reason.
The exception is **device preferences** (look, camera, reader font, texture choice): they are not "about" a note, so they stay in unsynced local storage. Labels hold only slugs and short CSV (200 characters); bigger payloads (a tile map) were designed as a child note instead, not as a label. *(Sources: `game-ui.md`, `lib/layout.ts`, worldediting plan.)*

### Rooms are derived, never stored

Every room is rebuilt from the tree on each entry (`buildRoomContents` is a pure function), so the world cannot drift from the vault. Destroying and rebuilding a room is cheap (a few dozen objects) and always correct. *(Source: `src/types.ts`, `BibliothecaScene.ts` header.)*

### Phaser for the world, React for the overlay

A canvas engine for the walkable world, and DOM for text-heavy parts (reader, search, settings), so nobody fights a canvas engine to render markdown or text input. The two talk only through a typed event bus. Godot was ruled out because its rich text is BBCode, not markdown/HTML (it would need a native WebView bridge); LÖVE has no official web export. *(Source: `game-ui.md`.)*

### Procedural art, zero binary assets

Every sprite is painted onto a canvas at boot and registered under a **stable asset key**, never a file path. The repo ships no images and carries no third-party licence obligations. A PNG-plus-manifest texture-pack loader would plug in behind the same keys; the persona debate recommended not building the manifest swapping until the static world had been lived in. *(Source: `src/game/textures.ts`.)*

### Walk caps: 400 notes, depth 8

ETAPI has no subtree endpoint, so the vault is walked note by note. The caps keep the first load from stalling; hitting one degrades gracefully (a toast, deeper content absent). Lazy loading deeper rooms is described in old comments but **not implemented**. *(Source: `config.ts`, `library.ts`.)*

### The tree snapshot is an offline fallback

The design asked for local-cache-first. What is built is narrower: the world appears after a successful walk, and the snapshot is used only when the server is unreachable. Showing the cache while the walk runs is not done. *(Sources: `game-ui.md`, `App.tsx`.)*

## The tree view

### three.js and a real 3D tree (decided, Addendum 3 to 4)

A 2D prototype (the cylinder illusion on a rail) proved the feel; the question was whether to go 3D. The controls and logic were already renderer-independent (surface coordinates), and 3D gives free perspective, true branch-over-branch occlusion at forks, a chase camera that rolls with the surface, and a ground and horizon.
The costs were a new dependency, WebGL in tests (SwiftShader headless works, with the recipe in [Testing](Testing.md)), and a harder pixel-art look. 3D won. *(Source: `next-directions.md`, Addenda 2 to 4.)*

### Voxel is the default look; low-poly is one key away

The user asked for low-poly but also liked the voxel look; switching was requested. Both exist (`L`, remembered), built from the same data. Voxel stays the default because it is the look the user preferred in the latest round. *(Source: Addenda 4, 6, 7.)* **Round 5:** the user now prefers the low-poly look, so it got the polish (shadows, bark, scenery, clouds); whether it also becomes the default is not decided yet (`TreeScene` falls back to voxel when no look is stored).

### The simulation is separate from the renderer, and a creature is data

`world3.ts` and `sim3.ts` import no three.js, so the climbing feel is unit-tested in Node. An `Animal` is a spec (nodes, legs, abilities), so snake, ant, spider, bee, dragonfly and jay are data rather than code forks. *(Source: `sim3.ts`, Addendum 2.)*

### Grip is decided by world gravity (bug history)

Early grip compared `th` against the branch's own up axis, which is arbitrary on a near-vertical branch, so animals fell off the main trunk. Now a surface point hangs when its normal points down in world space; a vertical trunk never drains. Falls are never fatal: you are put back on a branch. *(Source: `AGENTS.md`, `sim3.ts`.)*

### The tree view writes only branch-property labels (was: read-only)

Until round 4 the tree view wrote nothing. Now it writes exactly one kind of thing: `biblio_*` property labels (species, length, thickness, taper, rotation on the parent (`spin`), pitch, attach, bend, wave amplitude/frequency/shape) on **folder notes you edit in the branch panel**, through the same guarded write path as build mode. It still never changes titles, content or structure.
Dragging branches, placing leaves by hand (`biblio_lat` exists in the layout but has no editor yet) and re-parenting notes are designed (Addendum 5) and **not built**. *(Source: `lib/treeedit.ts`, `ui/BranchPanel.tsx`, `next-directions.md` Addenda 5 and 8.)*

### Branch properties are labels with a calculated default

Every property of a branch has a **calculated** value (the layout's formulas, modulated by the tree's species) and an optional **override** stored as a label on the folder note; the value used is `override ?? calculated`. Reasons, all from the code and the project's existing rules:

- **Labels are the save file** (above): the tweaks sync with the vault, follow the note when it is renamed or moved, and cost no database.
- **Absence means automatic**, as for the room looks: a vault without labels looks exactly as the formulas say, a label exists only while it differs from the calculated value, and "recalculate" is simply *removing the label* (so there is no second state to keep in sync).
- **Recalculation must be exact:** a branch's calculated value never depends on its own overrides (only on the parent's *effective* geometry), so "calc 12" shown beside a slider is what the reset button restores. Children grow from their parent's effective geometry, so edits propagate upwards naturally.
- **Tolerant parsing:** a hand-typed label can be anything. Garbage and non-finite values are ignored, finite out-of-range numbers are clamped, so a bad label can never break the tree.
- **Undoable and conflict-checked** by reusing `commitLabel` (one journal entry per label), so tree edits and build-mode edits share one undo journal.

*(Source: `layout.ts` header, `treeedit.ts` header.)*

### A forest of species, not one tree

The root is the central stump and each top-level folder is its own tree with a species (13 kinds as plain data in `species.ts`): each top-level folder's growth and colours come from data, not code, so neighbouring trees look different. The automatic pick is a hash of the note id stepped so that any four neighbours differ; `biblio_species` overrides it and inherits down to sub-folders.
The user asked for "a forest of species trees with editable, recalculable properties saved as labels" (Addendum 8). *(Source: `species.ts`, `layout.ts`.)*

### The forest is the default layout; trees are joined by ground roots (round 5)

Feedback: every top-level folder should be its own tree rooted in the ground, with the hub kept as an option. Decisions: **forest is the default** and the hub stays selectable (`Y`, remembered in `biblio.v1.treeLayout`; `layoutTree` itself still defaults to `hub`, so existing callers and tests are unchanged). Between the trees the animal follows **ground roots**: ordinary rails running along the ground from each trunk's foot to the central stump (crawlers and walkers follow them like any branch; fliers just fly), and the root note's own notes are leaves on that central stump. Going from the stump into a root uses the existing `Shift` side-branch entry rather than a special case in the simulation. `F` was already the foliage key, so the layout key is `Y`.
The property formerly called "spiral" (the azimuth around the parent) is shown as **"Rotation on parent"** (the stored label `biblio_bspin` and the key `spin` are unchanged); the wave properties are new labels (`biblio_bwave`, `biblio_bwfreq`, `biblio_bwfn`). Terminal branches now end in a point (tip radius 7 to 15 % of the start radius, at least 1.2 px). *(Source: `layout.ts`, `forest.ts`, `wave.ts`, `next-directions.md` Addendum 9.)*

### Crawlers cannot jump (except the jumping spider); spiders spin silk; the ant reaches

Round 4 feedback: the ant, spider and snake no longer leap; instead the snake and the ant **reach** (`Space` held) and the spiders have **silk** (`X`). The one crawler that jumps is the **jumping spider**, which also spins silk. Jump landing became **aimed** (hold, arc preview, mild auto-target), also asked for in that round. *(Source: Addendum 8, `sim3.ts` headers.)*

### Silk threads are not persisted

Threads are real branches while the page is open (and survive world rebuilds), but they live in a module-level store and vanish on reload. Saving them to the vault (a label format, cleanup rules) is not planned. *(Source: `silk.ts` header.)*

### Markdown notes are recognised by mime (effectiveType)

Trilium v0.106 has no `markdown` note type: markdown arrives as `code` with a markdown mime. The app now maps `code` plus a markdown mime to `markdown` in one rule (`content.ts#effectiveType`, mirrored in `library.ts#toNoteInfo`), so the reader renders it and the leaf is a maple, as with the fake's `--markdown-type`. *(Source: unit section 21.)*

### Branch thickness follows content, not depth; branches taper

Thickness depends on how many notes a folder carries and how many folder levels hang below it, so a big folder is a thick trunk even when it is shallow, and a child is never fatter than its parent. Branches thin out along their length. *(Source: `src/tree/layout.ts`, Addendum 7; the formula is now multiplied by the tree species' factors.)*

### Skipped: a top-down view

It is a re-skin with no new verb, a second 1,100-line scene, and its main benefit (grid-based editing) is covered by build mode in the side-scroller. *(Source: design panel, `next-directions.md`.)*

## World building

### Build mode may only write `biblio_*` labels, with preview that never writes

The edit code refuses any other label name, edits only the note's own labels, re-fetches before writing, compares against the cached value, and records an undo entry per write. Presets and slots come before freeform placement. Absence of labels is the default look, and the app never writes defaults.
Structure editing (rename, create, delete, move) is a **separate, later** piece (worldediting Part 1), because deleting or moving notes needs much stronger safeguards. *(Source: `worldediting-plan.md`.)*

### Socrates is an honest placeholder

The Socratic/RAG assistant is a separate plane of the architecture that does not exist. The statue says so rather than faking an AI. *(Source: `SocratesDialog.tsx`.)*

## Testing

### Own disposable Trilium, plus a fake

Every real Trilium instance on the machine is in use, so the project stands up its own throwaway one inside the Docker-in-Docker daemon and also provides an in-memory ETAPI fake for Docker-free work. A conformance suite runs against both so the fake cannot drift from the real shapes. *(Source: `AGENTS.md`, [Mock and Seeding](Mock-and-Seeding.md).)*

## Security model summary

What the app trusts and what it protects:

- **The ETAPI token lives in the browser's localStorage** (`biblio.v1.settings`). That is a deliberate v1 trade-off: there is no backend of our own to hold a session. Anyone with access to that browser profile can read the token. A widget wrapper inside Trilium (planned, later) would remove the token from the picture entirely.
  Use a strong Trilium password (the README's advice).
- **Note content is untrusted.** It renders in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) under a CSP that lets only one nonce'd script run, and the parent accepts messages only from that frame with the matching nonce. Scripts, inline handlers and `javascript:` links in a note cannot execute. See [Reader](Reader.md).
  Remote `http(s)` images are allowed by that CSP.
- **Writes are narrow.** The app writes `biblio_*` labels (room layout and look; build code refuses any other name) and new notes from quick capture (plus the `biblio_inbox` label on the Inbox). Existing note content, titles and structure are never modified. The tree view writes only the branch-property labels you save from its panel.
- **The hosted container is stateless** and runs with a read-only root filesystem, a tmpfs `/tmp`, `no-new-privileges`, and no token inside.
- **CORS:** the disposable mock allows `*` and has a known password; this is for the throwaway instance only. On a real instance allow the app's **exact origin**, not `*`.
- **No secrets in the repo.** `.bootstrap.env` (mock credentials) is gitignored; never commit a real token or any provider API key.
- **Do not use a real vault for testing:** `tools/` creates and deletes notes.

Setup notes for HTTPS access away from home: [Capture and PWA](Capture-and-PWA.md). Related: [Architecture](Architecture.md), [Roadmap and Ideas](Roadmap-and-Ideas.md).
