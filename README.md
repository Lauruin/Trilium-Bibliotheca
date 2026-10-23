# Bibliotheca

**Your Trilium vault as a place you can walk through - and a tree you can climb.**
A standalone web app (React + Phaser + three.js) that reads your Trilium Notes vault over its external REST API (ETAPI) and shows it two ways:

- **Library** - a pixel-art side-scroller. Folders are rooms, sub-folders are doors, tags are bookcases, notes are books.
- **Tree (Yggdrasil)** - a 3D tree. Folders are branches, notes are leaves, and you climb it as an animal.

Formerly the SiYuan biblio plugin idea - **SiYuan is abandoned; Trilium is the target** (see [`AGENTS.md`](AGENTS.md) for the architecture decision).

> **Try it:** a read-only **demo** (pinned to a public demo vault) and a **bring-your-own-Trilium** build will be linked here once they are hosted. *(Not live yet.)*
>
> **About this project:** Bibliotheca is **entirely vibe-coded** (written with AI coding agents, steered by one person) and is developed **on a whim**: no roadmap promises, no support guarantees, updates whenever I feel like it. Fork it and take it your own way; that is what it is for.

> **⚠ Alpha software - read this before you connect a vault you care about.**
> Bibliotheca is **alpha**. There is **no guarantee about the safety of the Trilium database it is connected to**: it is vibe-coded, automatically tested only against a *disposable* Trilium **v0.106.0**, and parts of it **write to your vault** (never on connecting, only when you use a feature that saves something).
> The author has used it against a real vault and **has not run into any problem so far**, but that is one person's experience, not a promise. What exactly is read and written is listed in [Before you connect](#before-you-connect-what-the-app-reads-and-writes) below.
> **Make a Trilium backup first**, and keep it. As far as I know an ETAPI token cannot be limited to read-only, so whoever holds the token (and this browser's localStorage holds it) has the same power over your notes as the app does.
>
> **Status: v0.1, a first vertical slice.** Rough edges and missing pieces are listed under [Status and limitations](#status-and-limitations).
> **Documentation:** the [`wiki/`](wiki/Home.md) folder has guides for every part (start at [Home](wiki/Home.md)); [`AGENTS.md`](AGENTS.md) is the agent-oriented reference; [`LOCAL-TESTING.md`](LOCAL-TESTING.md) is the short run-it-yourself guide; [`tools/README.md`](tools/README.md) documents every script.

## What it does

### Library view (the default)

- **Walkable rooms.** One folder = one room; child folders are doors; walk with `A`/`D` or the arrows, jump with `Space`, interact with `E`, at any depth. `Q`/`Backspace` goes one folder up.
- **Shelves and books.** Leaf notes stand on tall bookcases grouped by their labels ("tags"); unlabelled notes get an "unfiled" case; a tag with more books than one case holds continues on the next ("reading 2", ...). Spine colour comes from the note's own `#color` label or a stable per-tag palette; spine width follows the title length.
  Rooms grow wider with their contents (caps: 12 bookcases and 10 doors per room, with "+N" markers).
- **Reading.** Opening a book shows the note in a reader: HTML for text notes (including what Trilium's editor writes: todo lists, admonitions, figures, tables, highlights), markdown rendering for markdown notes, source for code. **Image notes** show the picture, **PDF notes** open in the browser's PDF viewer, text files show as text, other files offer a download (the type is decided from the file's bytes, not the note's mime); **pictures embedded in text notes** are fetched through the API and shown. `A-`/`A+` (or `-`/`+`) change the text size; `Aa` opens font (book serif, classic serif, sans, typewriter), width and **paper** (parchment, book page, sepia, night, study and three **leaf** papers: spring, autumn, maple), all remembered.
  Around the page: the note's **breadcrumb**, label chips, edit date and reading time, an **outline** of its headings, **find in note** (`Ctrl+F`), previous/next note in the folder (`[` / `]`), **zen** mode (`Alt+Z`), copy link and open-in-Trilium; the scroll position of each note is remembered.
  **Links** to other Trilium notes open inside the reader with back/forward (`Alt+Left`/`Alt+Right`), a "links" bar lists the note's internal links, external links ask first, and a toggle flips to the raw source.
- **Search.** The wisp is a front end for Trilium's own full-text search. **Socrates** is an honest placeholder: the RAG/chat assistant is a later part of the architecture, so he says he cannot talk yet.
- **Folder descriptions.** A room's note text shows on a plaque under the top bar; standing at a door shows that folder's.
- **Overview (`O`).** All rooms as blocks on a grid, tinted by theme. Drag to re-arrange (the position is written to the note as `biblio_x`/`biblio_y` labels), click to enter. New rooms are auto-placed; manual placements always win.
- **Build mode (`B`).** Decorate from inside the world: a **theme** (7 colour moods, for one room or a whole wing), **wall** slots (window, painting, clock, banner, empty, plus extra wall span), **floor** furniture (plant, armchair, globe, lamp, bust, telescope, fireplace), a **rug** and a bookcase **finish**.
  Changes preview live and are saved on `Enter`; each is ONE `biblio_*` label on the room note (so it syncs and survives renames); `Z` / `Shift+Z` undo and redo. No labels = the default look. Details: [wiki/Build-Mode.md](wiki/Build-Mode.md).
- **Quick capture (`C`).** Type a thought, `Ctrl+Enter` files it as a new note under the note labelled `#biblio_inbox` (an "Inbox" is created on first use). The box stays open for rapid-fire capture.

### Tree view (`T`)

Your vault as a **forest**, in a **voxel** (default) or **low-poly** look (`L`, remembered). It needs **WebGL**.

- **The forest.** The library root is a central stump; every **top-level folder is its own tree** standing in the ground (a small forest, spread so crowns do not collide) with one of 13 species (oak, birch, maple, pine, willow, cherry, acacia, baobab, redwood, aspen, ash, cypress, ghost; picked automatically, or set with a `#biblio_species` label), joined to the stump by **ground roots** that crawlers and walkers follow like any branch (hold `Shift` at the stump's base to step into a root; fliers just fly). `Y` (or the **layout** button) switches to the old **hub** layout where all trunks arch out of one stump; the choice is remembered. Other folders are branches, notes are leaves. Branch thickness follows the notes a folder carries and how many folder levels hang below it, twigs taper to a point at their tips, and sub-folders are spread apart so it stays readable. Leaf shape follows the note type (broad, needle, maple, blossom, fruit) or a `#biblio_leaf` label;
  longer notes get bigger leaves (measured lazily in the background, cached by note version, numbers only). A ground, horizon and sky show which way is up. `N` shows branch names as signs or bubbles.
- **Ten animals in three categories** - `1` **crawlers** (ant, spider, jumping spider, snake), `2` **walkers** (lizard, cat), `3` **fliers** (flying squirrel, bee, dragonfly, blue jay); pressing a key again cycles through its category.
  `W`/`S` walk up / down the branch, `A`/`D` turn on it in smooth curves (**guided movement**; `M` = the old free mode: forward / steer the head). **Jumping is aimed**: hold `Space` (lizard, cat, flying squirrel, jumping spider), turn the aim with `A`/`D`/`W`/`S`, watch the arc preview (it auto-targets a branch when you are close), release to leap. Crawlers cannot jump, except the **jumping spider**: the **snake** and the **ant** hold `Space` to reach out as a living bridge, and the **spiders** spin **silk** with `X` (drop, let down `S`, reel up `W`, swing `A`/`D`, pump with `Space`, let go `X`; the threads stay climbable until you reload). The **flying squirrel** glides after a leap (`A`/`D` bend, `W` dive, `S` flare). The **bee and dragonfly** take off with `Space` and hover (`Space` up, `Shift` down); the **blue jay** flies forward and trades height for speed and lands in a `Shift` landing mode that steers it to a branch.
  Each animal has a hand-built model in both looks (low-poly faceted, voxel boxes): jointed legs that follow the feet, tails that sway, a snake that slithers, flapping wings, blinking eyes, a glide membrane for the squirrel. See the [Animals Guide](wiki/Animals-Guide.md).
- **Foliage.** A translucent, species-specific canopy (round puffs, cone tiers, willow curtains, blossom clouds, umbrellas...) hides the thin branches from afar and fades out near you and the camera, so tips are never stumps; `F` toggles it, a density slider sits at the bottom of the `B` panel.
- **Climbing.** Hold `Shift` at a branch's base to climb into it (an on-screen hint tells you when); `E` next to a leaf reads the note. Hanging underneath for too long makes you slip (shaking warns you; `G` turns grip off; a vertical trunk never drains grip). `H` toggles auto-align.
- **Editing branches (`B`).** Stand on a branch and press `B`: sliders for length, thickness, taper, rotation on the parent, angle off the parent, position on the parent, droop/lift, the kind of tree and a **wave** (amplitude, frequency and a shape: sine, zigzag, sawtooth, corkscrew, S-bend or natural wobble, with a small preview); every row has a one-line help. The tree re-grows live; **Save** stores each changed value as a label (`biblio_blen`, `biblio_bthick`, ...) on the folder note, ↺ and **Recalculate all** go back to the calculated values (the label is removed), **Undo** takes back the last write. Labels only, never titles or content.
- **Cameras and looks.** `V` cycles chase (rolls with the surface), level (horizon stays level) and fixed; wheel or `+`/`-` zoom; `P` for a chunky pixel look.
- **Performance (`I`).** The tree view is limited by the GPU, not by JavaScript. `I` opens a panel with the frame rate, the JS time per frame next to the total frame time (long frames with little JS = GPU-bound), draw calls, triangles and the resolution, and switches for what costs most (shadows, foliage, look) and for the **profile**: `auto` (the default: pixel ratio up to 1.5, 60 fps cap, MSAA only on normal screens, and the resolution drops by itself while frames are slow), `quality` (the old behaviour: up to 2x, MSAA, no cap) and `fast` (1x, no MSAA, down to half resolution). The renderer also asks laptops for their faster GPU.
- **Low-poly look and shadows.** The low-poly look (`L`) has real **sun shadows** (`K` cycles off, low, medium, high; remembered; off shows a soft blob under the animal instead), faceted bark with baked ambient occlusion, moss, scars, rounded forks and sharp twig tips, leaves that sway, and a living ground (flat under the forest, hills beyond, grass tufts, flowers, mushrooms, a pond, drifting low-poly clouds). The voxel look gets the shadows and pointed tips too.
- `lizard3d.html` is the same scene on a hand-made demo tree (no Trilium); `lizard3d.html?vault` uses a synthetic vault through the real layout (`&layout=hub|forest`, `&trees=N`, `&depth=D`, `&wave=helix:0.06:3`). The reader has a matching soft-green **leaf** paper.
- The tree view writes only the branch-property labels you save from the `B` panel; leaf placement (`biblio_lat`) is read but has no editor yet.

### Everywhere

- **Local snapshot.** The tree snapshot persists in localStorage; when the server is unreachable the world opens from it, with an "offline - cached" indicator. (It is a fallback: the world appears after a successful walk, otherwise from the snapshot.)
- **Phone** (parked - works in principle, not actively tested): an installable PWA with an Android share target (share a page or text into capture) and on-screen touch controls (`?touch=1` to try on a desktop). Needs HTTPS, see below.
- **Look.** A rustic library: oak floors, panelling, windows with light shafts, candles, rugs and furniture, all drawn in code (no binary assets).

## Before you connect: what the app reads and writes

Everything below is checked against the code (`src/lib/trilium/client.ts` is the only module that talks to Trilium; the write paths are `src/lib/labels.ts` and `src/lib/capture.ts`) as of this version. It talks to Trilium only through ETAPI.

**When you connect (read-only; nothing is written).**
- It checks the token with `GET /etapi/app-info`.
- It then walks your vault breadth-first from the root note you configured (default `root`): one `GET /etapi/notes/{id}` per note, **at most 400 notes and depth 8**, skipping Trilium's internal `_hidden` subtree. That reads titles, note types, mimes, labels/attributes and child ids, not note content.
- A snapshot of that structure (titles, ids, labels, no note text) is kept in this browser's localStorage so the world can open offline.

**While you use it (reads).** Note text is fetched when you open a note in the reader; for image and file notes the bytes (`GET /etapi/notes/{id}/content`), and for pictures embedded in a text note the attachment's bytes (`GET /etapi/attachments/{id}/content`). The tree view fetches content in the background only to measure how long each note is (leaf size; only the number is cached, never the text). Search uses `GET /etapi/notes?search=...`.

**Writes: only when you trigger them.**

| What you do | What gets written to Trilium |
|---|---|
| Log in with a password in Settings (optional; you can paste a token instead) | `POST /etapi/auth/login`: Trilium **mints an ETAPI token** (as far as I know a new one per login, listed under Options -> ETAPI). Pasting an existing token writes nothing. |
| Quick capture (`C`) | On first use, a new text note titled **Inbox** under the root note, carrying the label `#biblio_inbox` (the app searches for that label first and reuses an existing one). Every capture then creates **one new text note** under the Inbox from the text you typed. |
| Build mode (`B`), dragging rooms in the overview, saving in the tree's branch panel | **Labels only:** `biblio_*` labels are created, changed or removed on **existing** notes. Undo restores them. |

The `biblio_*` labels it writes: `biblio_x`, `biblio_y` (room position), `biblio_theme`, `biblio_wing`, `biblio_wall`, `biblio_furniture`, `biblio_rug`, `biblio_case`, `biblio_span` (build mode), `biblio_species`, `biblio_blen`, `biblio_bthick`, `biblio_btaper`, `biblio_bspin`, `biblio_bpitch`, `biblio_bat`, `biblio_bbend`, `biblio_bwave`, `biblio_bwfreq`, `biblio_bwfn` (tree branches). The write code refuses any label name that does not start with `biblio_`, touches only the note's **own** labels (never inherited ones), re-reads the note right before writing, and tidies up duplicate `biblio_` labels it finds. `biblio_lat` (a pinned leaf spot) and `biblio_leaf` / `#color` are only **read**.

**What it never does (in this version):** rename, move or delete notes, change any note's title or content, touch labels or relations that are not `biblio_*`, or send your data anywhere but to the Trilium URL you entered (a note whose HTML embeds a remote image makes your browser fetch that image, as any web page would; external links ask before opening). (The planned editor will change the first part of that, and is planned to ask for confirmation before saving.)

**What it keeps in your browser (localStorage):** the server URL, **the ETAPI token in plain text**, the structure snapshot above, the leaf-size cache (numbers), and your reader and view preferences (including where you stopped reading each of your 200 most recent notes). The undo history lives in memory only and is gone when you reload.

**What you will see inside Trilium:** the `biblio_*` labels show up as ordinary labels in a note's attributes and sync like any attribute; an **Inbox** note and the notes you captured. To remove the app's traces, delete the Inbox (and captured notes, if you want them gone) and remove the `biblio_*` labels, for example by searching `#biblio_x` and so on and using Trilium's bulk actions to delete the label.

The automated tests only ever run against a throwaway Trilium started from `compose.yml`, never against a real vault.

## Quick start

```bash
# 1. A disposable Trilium (Docker; publishes on port 8080). Mock only: starts the Trilium container,
#    sets the test password, mints an ETAPI token, writes .bootstrap.env (gitignored)
BOOTSTRAP_SERVICES=trilium tools/trilium-bootstrap.sh

# 2. Optional: fill it with a generated vault to look at
node tools/seed-vault.js

# 3. The app
npm install
npm run dev            # http://localhost:5173
```

Open http://localhost:5173, enter the server URL and the password or ETAPI token in the settings dialog (pre-seeded from `.env.local` if present, see `.env.example`).
No Docker? `npm run mock:fake -- --seed medium` serves an in-memory ETAPI and prints its URL and token. For a *real* Trilium instance, point the server URL at it and make sure it allows cross-origin access:

```ini
# config.ini [Network] section (or TRILIUM_NETWORK_CORS_* env vars, since v0.93.0)
corsAllowOrigin=http://localhost:5173
corsAllowMethods=GET,POST,PUT,PATCH,DELETE,OPTIONS
corsAllowHeaders=Authorization,Content-Type
```

The project is developed in a devcontainer with a Docker-in-Docker sidecar; the exact commands, ports and the host-versus-container split are in [`LOCAL-TESTING.md`](LOCAL-TESTING.md) and [wiki/Getting-Started.md](wiki/Getting-Started.md).

### Hosting the app itself

The app is plain static files once built, so it ships as a stateless container (no token inside, no volumes):

```bash
docker compose up -d --build bibliotheca   # serves on http://<host>:8081
APP_URL=http://dind:8081 node tools/browser-test.js   # verify it hosted
```

The multi-stage build runs the strict type-check and the vite build inside the image (a broken build fails the image build), then nginx serves the bundle with immutable asset caching. The container runs with a read-only rootfs;
when pointing it at a real Trilium, add this app's origin (e.g. `http://<host>:8081`) to that instance's `corsAllowOrigin`.

## Using it away from home (HTTPS / Pangolin)

The installable-app features (install, share target) need HTTPS. With a reverse-proxy tunnel such as **Pangolin** this works, provided:

1. **Two public HTTPS resources**: the app (container port `8081`) and your Trilium (its port, usually `8080`). Mixed content is blocked, so the app cannot talk to an `http://` Trilium from an `https://` page.
2. **Trilium CORS**: allow the app's exact origin - `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN=https://app.example.com` (not `*`), plus the methods/headers shown under Quick start.
3. **Auth on the Trilium resource**: the app calls Trilium's ETAPI from the browser (cross-origin `fetch`), so a Pangolin SSO login redirect in front of the *Trilium* resource breaks it. Leave Pangolin auth off for that resource (ETAPI is protected by its token; use a strong Trilium password) or add a Pangolin rule that lets `/etapi/*` through.
   Pangolin SSO in front of the *app* resource is fine - the manifest link already sends cookies.
4. In the app's settings, enter the public Trilium URL (`https://trilium.example.com`).

Check your Pangolin version's docs for the exact resource/rule options. A single-origin setup (the app's nginx proxying `/etapi/` to Trilium, no CORS) is possible but not built. Tailscale notes: [wiki/Capture-and-PWA.md](wiki/Capture-and-PWA.md).

## Keys at a glance

| View | Keys |
|---|---|
| Library | `A`/`D` or arrows walk · `Space`/`W` jump · `E`/`Enter` interact · `Q`/`Backspace` up · `O` overview · `B` build · `Z` undo · `C` capture · `T` tree |
| Reader | `+`/`-` size · `Alt+Left`/`Alt+Right` history · `Ctrl+F` find (`Enter` / `F3` next) · `[` `]` previous / next note · `Alt+Z` zen · `Esc` close |
| Tree | `W`/`S`/`A`/`D` move · `Space` leap/reach/take off · `Shift` climb in (fliers: down / land) · `E` read · `1`/`2`/`3` animal category · `G` grip · `M` move guided/free · `H` auto-align (free) · `V` camera · `L` look · `N` names · `F` foliage · `K` shadows · `I` performance · `P` pixels · wheel or `+`/`-` zoom · `T` back |

## Status and limitations

Honest list of what is not there or not as good as it sounds:

- **v0.1.** Verified against Trilium v0.106.0 only. Test coverage is strongest for pure logic (library mapping, build-mode labels, tree simulation and layout); the 3D look is judged from screenshots, not asserted.
- **Walk caps.** The vault is walked breadth-first from the root note, at most 400 notes and depth 8. Beyond that notes are simply absent (no lazy loading yet) and a toast says so.
- **Spine thickness follows the title**, not the note length (real length would need a content fetch per note; only the tree view measures lengths).
- **Notes are read-only in the app.** Capture creates notes; build mode and the tree's branch panel write `biblio_*` labels; nothing edits content, titles or structure. Renaming, creating, deleting and moving notes from inside the game is *planned*, not built.
- **Rendering limits.** `image` and `file` notes show as pictures / PDFs / text / a download card, and pictures embedded in text notes load; canvas, mermaid, mind-map and similar notes still show their raw content with a notice (no renderer yet), and math (`.math-tex`) shows its TeX source. On a real v0.106 server markdown notes are `code` notes with a markdown mime type; the app treats those as markdown.
- **Links and relations** between notes are not visualised (only labels are read); a design exists, nothing is built.
- **Socrates is a placeholder**; there is no intelligence service. One library per app instance; no townsquare, quest board or calendar.
- **The tree view needs WebGL**, and its camera/animal feel is still being tuned. In headless containers it needs a full Chromium with software GL (see the wiki).
- **Phone and touch are parked.** The share target needs HTTPS.
- **The ETAPI token is stored in the browser's localStorage** (see Security notes).
- **Art is procedural; texture packs** (swappable PNG sets) are designed but not built.

Roadmap and ideas, with built/planned marked: [wiki/Roadmap-and-Ideas.md](wiki/Roadmap-and-Ideas.md).
The persona-debate findings (archived in the separate `knowledge-planning/` folder outside this repo) deliberately deferred the not-built items.

## Verification

```bash
npm test   # = tools/check.sh  (WARNING: recreates the Trilium mock: wipes its data)
```

All five checks must be green: strict types + build; the unit tests; the disposable Trilium rebuilt from a wiped volume (reproducibility); a real headless-browser pass (world mounts, search opens a book, reader, tree view where WebGL exists, capture, build mode, zero console errors);
and live ETAPI integration asserting every endpoint the app depends on. The non-destructive subset and everything else: [wiki/Testing.md](wiki/Testing.md). The verified endpoint contract and the headless auth bootstrap are recorded in [`AGENTS.md`](AGENTS.md).

## Architecture in one paragraph

Trilium has no plugin SDK, so this is **not** a Trilium extension - it is a separate web app talking to the stable, documented ETAPI. Everything that knows Trilium lives in `src/lib/trilium/` (one client, wire types from the official OpenAPI spec); `src/lib/library.ts` maps the note tree to the world's vocabulary (rooms/shelves/books);
`src/game/` is Phaser (one room built fresh on every entry, so the world cannot drift from the vault); `src/tree/` is the three.js tree (pure layout and simulation plus a renderer); `src/ui/` is the React overlay (HUD, reader, settings, build panel), bridged to Phaser by a typed event bus.
What the app remembers about the vault (room positions, looks, the inbox marker) is stored as `biblio_*` labels on the notes themselves. More: [wiki/Architecture.md](wiki/Architecture.md), [wiki/Decisions.md](wiki/Decisions.md), and the planning docs (`game-ui.md` is the world design source).

## Documentation map

| Doc | For |
|---|---|
| [`wiki/Home.md`](wiki/Home.md) | Guides: getting started, views, animals, reader, build mode, trilium mapping, testing, troubleshooting, roadmap, glossary, contributing, decisions |
| [`AGENTS.md`](AGENTS.md) | Agent/dev reference: architecture rules, commands, verified ETAPI contract, gotchas |
| [`LOCAL-TESTING.md`](LOCAL-TESTING.md) | Short guide to running the app and the mock yourself (host versus container) |
| [`tools/README.md`](tools/README.md) | Every script in `tools/` |
| [`game-ui.md`](game-ui.md) | The world design (partly superseded, marked at the top) |
| `knowledge-planning/` (outside the repo) | Planning: next directions, world-editing plan |

## Security notes

- The ETAPI token is stored in this browser's localStorage - a deliberate v1 trade-off since the app has no backend of its own. Anyone with access to that browser profile can read the token. A widget wrapper inside Trilium (planned, later) would remove the token from the picture entirely.
- Note content is rendered in an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`: opaque origin, no access to the app) and a Content-Security-Policy that lets only one nonce'd script run - ours, which just reports link clicks. Scripts, inline handlers and `javascript:` links inside a note are blocked, so note HTML cannot execute anything.
- The app writes two kinds of data: `biblio_*` labels (room layout, build-mode looks and tree branch properties - the build code refuses to write any other label name), and new notes created by quick capture (plus the `biblio_inbox` label on the Inbox); logging in with a password also makes Trilium mint an ETAPI token. Existing note content, titles and structure are never modified. The full list is under [Before you connect](#before-you-connect-what-the-app-reads-and-writes); this is **alpha software** with no guarantee about the safety of the connected database, so back it up first.
- The compose.yml mock sets `corsAllowOrigin=*` and a known password - **for the throwaway test instance only**. Never do this on a real vault, and never point the tools in `tools/` at one.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) for this code: free to use, study, modify, fork and share for any **non-commercial** purpose; commercial use is not allowed. (This is *source-available*, not OSI "open source". Copies obtained earlier under MIT stay MIT.) Trilium itself is AGPL-3.0 (this app only talks to its unmodified API); the bundled libraries (React, Phaser, three.js, marked) keep their own MIT licenses; all art is generated in code at runtime, so no third-party asset licenses apply.
