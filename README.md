# Bibliotheca

**Your Trilium vault as a place you can walk through - and a tree you can climb.**
A standalone web app (React + Phaser + three.js) that reads your Trilium Notes vault over its external REST API (ETAPI) and shows it two ways:

- **Tree (Yggdrasil)** - the start view: a 3D forest around a giant world tree. Folders are branches, notes are leaves, and you climb it as an animal. A door in the world tree's foot leads to ...
- **Library** - a pixel-art side-scroller. Folders are rooms, sub-folders are doors, tags are bookcases, notes are books.

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

### Library view (through the door in Yggdrasil)

- **How you get there.** The app starts in the **tree view** (below); the library is the door in the foot of the world tree (`E` at the door), and `T` takes you back out to that door. Without WebGL the library is simply what you get. (Its code is a separate chunk that is only loaded when you first walk through the door.)
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

### Tree view (the start view)

Your vault as a **forest**, in a **voxel** (default) or **low-poly** look (`L`, remembered). It needs **WebGL** (without it the app opens the library and says so). `?view=library` forces the library.

- **Yggdrasil, the world tree.** The library root is a **giant tree** in the middle that towers over the forest (3200 px of trunk, 190-320 px thick, species "Yggdrasil", the others stand well away from it). You **start on its porch**: a sturdy low branch a few steps up the trunk with a **nest** at its end and the **altar** in it (`E` opens the shrine panel: the library door again, the clock, saving to Trilium, later unlocks, tutorial and editor). Other points of interest sit on similar **low branches**: the **search wisp** has its own (an iron cradle at the tip), and the **door** into the library is at the foot of the trunk. Up in its **crown** (a real canopy of limbs now) there is one limb per **place** (a game mode or tool; each ends in a hanging lantern, `E` there opens it): the crown grows as those features arrive (none yet are unlocked in this version; the demo page shows stand-ins with `&places=4`). Walking from one of the roots **onto the trunk** works like any other branch. The notes of the root folder itself are leaves on its trunk.
- **The forest.** Every **top-level folder is its own tree** standing in the ground (a small forest, spread so crowns do not collide) with one of 13 species (oak, birch, maple, pine, willow, cherry, acacia, baobab, redwood, aspen, ash, cypress, ghost; picked automatically, or set with a `#biblio_species` label), joined to Yggdrasil by **ground roots** that crawlers and walkers follow like any branch: the roots meet at its foot like a **star** - walking **down** the trunk into the foot takes the root on the side of the bark you face (`Shift` = stay on the trunk); fliers just fly. `Y` (or the **layout** button) switches to the old **hub** layout where all trunks arch out of one short stump (no world tree, no crown there); the choice is remembered. Other folders are branches, notes are leaves. Branch thickness follows the notes a folder carries and how many folder levels hang below it, twigs taper to a point at their tips, and sub-folders are spread apart so it stays readable. Leaf shape follows the note type (broad, needle, maple, blossom, fruit) or a `#biblio_leaf` label;
  longer notes get bigger leaves (measured lazily in the background, cached by note version, numbers only). A ground, horizon and sky show which way is up. `N` shows branch names as signs or bubbles (a sign stands fixed on top of a big branch; a smaller branch has its name written on the wood).
- **Twelve animals in four categories** - `1` **reader** (the **ant**, the tiniest animal), `2` **crawlers** (beetle, spider, jumping spider, snake, the very long **constrictor**), `3` **walkers** (lizard, cat), `4` **fliers** (flying squirrel, bee, dragonfly, blue jay, the big fast **eagle**); pressing a key again cycles through its category.
  `W`/`S` walk up / down the branch, `A`/`D` turn on it in smooth curves (**guided movement**; `M` = the old free mode: forward / steer the head; `A`/`D` alone go round the bark at nearly walking pace, quicker still round a fat trunk). **Jumping is aimed**: hold `Space` (lizard, cat, flying squirrel, jumping spider), turn the aim with `A`/`D`/`W`/`S`, watch the arc preview (it auto-targets a branch when you are close), release to leap. Crawlers cannot jump, except the **jumping spider**: the **snake**, the **constrictor** and the **ant** hold `Space` to reach out as a living bridge, and the **spiders** spin **silk**: tap `X` to drop, then **hold `X` to go down, hold `Space` to go up**, swing with `W`/`A`/`S`/`D`, `Shift` lets go, `C` cuts the thread you stand on or hang from. The rope has no maximum length (it stops 10 px above the ground), the threads stay climbable, and they are **remembered between sessions** (browser storage) until you cut them. The **flying squirrel** glides after a leap (`A`/`D` bend, `W` dive, `S` flare). The **bee and dragonfly** take off with `Space` and hover (`Space` up, `Shift` down); the **blue jay** and the **eagle** fly forward, trade height for speed and land in a `Shift` landing mode that steers them to a branch. With the **mouse camera** a flier flies where you look: `W` is the throttle, `S` slows, `A`/`D` **strafe**, and `W` while looking steeply down is a **skydive** (a higher top speed that bleeds away when you pull up).
  Each animal has a hand-built model in both looks (low-poly faceted, voxel boxes): jointed legs that follow the feet, tails that sway, a snake that slithers, flapping wings, blinking eyes, a glide membrane for the squirrel. See the [Animals Guide](wiki/Animals-Guide.md).
- **Pause menu (`Esc`).** `Esc` stops a click-to-walk, and with nothing to stop it opens the **pause menu** (the game stands still): **Game** (the world's clock, restart the tutorial, unlock everything, movement, layout, the wisp, the library door), **Graphics** (look, shadows, foliage + density, the performance profile, pixel mode, camera, branch names, the stats panel) and **Controls**: a structured **cheat sheet** generated from the same list the keys use, with every key **rebindable** (click a key, press the new one; a taken key moves over and the menu says so; reset to defaults). Bindings are remembered (`biblio.v1.keys`, part of the save). The long key line at the bottom is gone.
- **Progress, unlocks and a tutorial.** Toys and tools unlock as you play; **reading, search, capture and the library always work**. A new browser starts with the lizard and the ant (the reader); the other animals earn their place by what you do (distance walked, leaves read, branches entered, leaps, minutes in the tree: the list with what each still needs is the **Progress** section at the altar), the branch editor (`B`) and build mode unlock when you finish **or skip** the **tutorial** (a card in the corner: walk, climb into a side branch, leap, read a leaf, open the shrine, change animal, zoom; each step waits for the action itself and names the mouse way too; replay it from the altar). **Unlock everything** (checkbox at the altar, or `?unlock=all` for one session) skips the progression: a browser that had already used the tree view starts with it ON so nothing is taken away. Counters and unlocks are stored locally and, if you switch the save on, in the save note.
- **Time of day.** The world has a day: the **sun, moon, stars, sky, fog, clouds and lights** follow a clock you set at the **altar** (the Clock section): **real time** (your local time, with the season: long summer days, short winter ones), a **fixed hour** (slider), or **fast** (a whole day in 24, 6 or 2 minutes). Dusk and dawn are slow and warm, sun shadows fade out towards dusk (and the shadow pass is skipped at night), the moon and stars come out, and the **wisp becomes a lantern** that lights the bark near it; a **night brightness** slider keeps the dark readable. The hour is shown next to the animal's name; the clock is remembered (and saved with the rest if you switch that on).
- **The ant reads on a leaf.** The ant (key `1`, alone in its category) is the tiniest, slowest animal. Choose it next to a leaf (or press `E` at a leaf with the ant selected, or double-click a leaf) and the view climbs **onto the leaf**: a magnified low-poly leaf (bigger for longer notes, capped) with the note's text laid out on it as plain text (headings, paragraphs, lists, quotes, code) and the ant walking on it: `S`/`W` read on / back, `A`/`D` sideways, the wheel scrolls, and notes longer than the leaf scroll past along its midrib. `R` opens the normal reader (images, tables), `Esc` or choosing any other animal (`2`/`3`/`4`) climbs back out. Notes that carry the label `biblio_learn` (own, or inherited from a folder: make it **inheritable**) show "learning leaf" there; `biblio_noai` marks notes that must never go to an AI. Nothing is written to your vault by reading.
- **Hover preview.** Next to a leaf (and under the mouse pointer) a short **excerpt** of the note (its first ~160 characters, plain text) is shown. The excerpts are fetched in the background together with the leaf sizes and **kept in this browser's localStorage** (160 characters per note at most; delete the key `bibliotheca.leafsizes.v1` to clear them).
- **Foliage.** A translucent, species-specific canopy (round puffs, cone tiers, willow curtains, blossom clouds, umbrellas...) hides the thin branches from afar and fades out near you and the camera, so tips are never stumps; `F` toggles it, a density slider sits at the bottom of the `B` panel.
- **Climbing.** Walking up past a side branch's base **climbs into it by itself** when you are on the side of the bark where it grows (walk on the other side and you pass it); hold `Shift` to **stay** on the branch you are on. Walking down never turns you into a side branch. (Ground roots and silk threads keep the old rule: `Shift` climbs in.) An on-screen hint tells you what the branch ahead will do; `E` next to a leaf reads the note. Hanging underneath for too long makes you slip (shaking warns you; `G` turns grip off; a vertical trunk never drains grip). `H` toggles auto-align.
- **Editing branches (`B`).** Stand on a branch and press `B`: sliders for length, thickness, taper, rotation on the parent, angle off the parent, position on the parent, droop/lift, the kind of tree and a **wave** (amplitude, frequency and a shape: sine, zigzag, sawtooth, corkscrew, S-bend or natural wobble, with a small preview); every row has a one-line help. The tree re-grows live; **Save** stores each changed value as a label (`biblio_blen`, `biblio_bthick`, ...) on the folder note, ↺ and **Recalculate all** go back to the calculated values (the label is removed), **Undo** takes back the last write. Labels only, never titles or content.
- **Cameras and looks.** `V` cycles chase (rolls with the surface), level (horizon stays level), fixed, **mouse** and **first person** (you see through the animal's eyes: a wide view, the body hidden, drag the mouse to look around, the wheel changes the field of view; like the mouse camera, where you look steers reach, jump aim and flight) (the mouse orbits the camera round the animal: drag with the right button, or drag the left one; **in this free camera the direction you look steers the snake's and ant's reach, the jump aim, flight (the heading turns to the camera, a hover flier flies where you look) and the spider's swing**); wheel or `+`/`-` zoom; `P` for a chunky pixel look.
- **Mouse.** Point at a branch or a leaf: a ring shows what a click would do and a tooltip names it. **Click = walk there**: the animal walks to that spot along the branches by itself (it presses the same keys you would: it turns round the bark to the right side, enters side branches, crosses the foot of Yggdrasil between trees by walking down into the root it wants); **click the wisp** to search, and in the results **take me there** walks you to a note and **light the way** sends the wisp to hover beside it with a beam of light; **double-click a leaf** = walk there and read it; any key or `Esc` stops the walk, and walking switches a free-moving animal to guided movement for its duration. Fliers have to land first.
- **Performance (`I`).** The tree view is limited by the GPU, not by JavaScript. `I` opens a panel with the frame rate, the JS time per frame next to the total frame time (long frames with little JS = GPU-bound), draw calls, triangles and the resolution, and switches for what costs most (shadows, foliage, look) and for the **profile**: `auto` (the default: pixel ratio up to 1.5, 60 fps cap, MSAA only on normal screens, and the resolution drops by itself while frames are slow), `quality` (the old behaviour: up to 2x, MSAA, no cap) and `fast` (1x, no MSAA, down to half resolution). The renderer also asks laptops for their faster GPU.
- **Low-poly look and shadows.** The low-poly look (`L`) has real **sun shadows** (`K` cycles off, low, medium, high; remembered; off shows a soft blob under the animal instead), faceted bark with baked ambient occlusion, moss, scars, rounded forks and sharp twig tips, leaves that sway, and a living ground (flat under the forest, hills beyond, grass tufts, flowers, mushrooms, a pond, low-poly clouds that stand in the world and drift - you can fly up among them). The voxel look gets the shadows and pointed tips too.
- `lizard3d.html` is the same scene on a hand-made demo tree (no Trilium); `lizard3d.html?vault` uses a synthetic vault through the real layout (`&layout=hub|forest`, `&trees=N`, `&depth=D`, `&wave=helix:0.06:3`). The reader has a matching soft-green **leaf** paper.
- The tree view writes only the branch-property labels you save from the `B` panel, and - only if you switch it on at the altar - a save note (below); leaf placement (`biblio_lat`) is read but has no editor yet.

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
| Switching on **"save progress and settings in Trilium"** at the altar (off by default; connecting and playing write nothing), then "save now" / closing the altar / leaving the tree | The first save creates **one text note "Yggdrasil"** under the root note (label `#biblio_yggdrasil`) and, inside it, **one code note "Yggdrasil save"** (`application/json`, label `#biblio_save`); later saves replace that note's content (merged with what is there, so two devices never overwrite each other). It holds only your view settings (look, camera, shadows, ...) and progress counters; the app keeps that folder out of the library and the trees. Never your connection settings or token. If you (or a copy / re-import) end up with **several** notes carrying `#biblio_yggdrasil`, the **oldest** one is used and the altar's save section warns about the others; nothing is deleted or merged. Places on the tree may later keep their own settings as small JSON notes `Place: <id>` (label `#biblio_place`) inside that folder - never an API key or token: those stay on the server. |

The `biblio_*` labels it writes: `biblio_x`, `biblio_y` (room position), `biblio_theme`, `biblio_wing`, `biblio_wall`, `biblio_furniture`, `biblio_rug`, `biblio_case`, `biblio_span` (build mode), `biblio_species`, `biblio_blen`, `biblio_bthick`, `biblio_btaper`, `biblio_bspin`, `biblio_bpitch`, `biblio_bat`, `biblio_bbend`, `biblio_bwave`, `biblio_bwfreq`, `biblio_bwfn` (tree branches), and - only with the save switched on - `biblio_yggdrasil` and `biblio_save` on the two notes above (and `biblio_place` on a place's settings note, once a place saves something). The write code refuses any label name that does not start with `biblio_`, touches only the note's **own** labels (never inherited ones), re-reads the note right before writing, and tidies up duplicate `biblio_` labels it finds. `biblio_lat` (a pinned leaf spot), `biblio_leaf` / `#color` and the learning labels `biblio_learn` / `biblio_noai` (reserved for the planned learning modes; the leaf view shows them) are only **read**.

**What it never does (in this version):** rename, move or delete notes, change any note's title or content, touch labels or relations that are not `biblio_*`, or send your data anywhere but to the Trilium URL you entered (a note whose HTML embeds a remote image makes your browser fetch that image, as any web page would; external links ask before opening). (The planned editor will change the first part of that, and is planned to ask for confirmation before saving.)

**In hosted mode** the same requests go to the app's own `/etapi/` and nginx adds the token; with `BIBLIO_TRILIUM_READONLY=1` the app does not even try to write.

**What it keeps in your browser (localStorage):** the spider threads you spun (positions on branches, no text), a **160-character excerpt of each note** the tree view has measured (hover previews), the server URL (unless the host proxies Trilium for you), **the ETAPI token in plain text**, the structure snapshot above, the leaf-size cache (numbers), and your reader and view preferences (including where you stopped reading each of your 200 most recent notes). The undo history lives in memory only and is gone when you reload.

**What you will see inside Trilium:** the `biblio_*` labels show up as ordinary labels in a note's attributes and sync like any attribute; an **Inbox** note and the notes you captured. To remove the app's traces, delete the Inbox (and captured notes, if you want them gone) and remove the `biblio_*` labels, for example by searching `#biblio_x` and so on and using Trilium's bulk actions to delete the label.

The automated tests only ever run against a throwaway Trilium started from `compose.yml`, never against a real vault.

## Install with Docker Compose (ready-made image)

The fastest way to run it: a small container that serves the app and talks to your Trilium **on the server side** (single origin: no CORS setup, and your ETAPI token never reaches the browser). The image is `ghalen123/tryldrasil` on Docker Hub (built for `linux/amd64`). Read [Before you connect](#before-you-connect-what-the-app-reads-and-writes) first and **make a Trilium backup**: this is an alpha.

**1. Save this as `docker-compose.yml`** (it includes a Trilium; if you already run one, delete the `trilium` service and the `depends_on` lines and point `TRILIUM_URL` at yours):

```yaml
services:
  trilium:
    image: triliumnext/trilium:v0.106.0      # pinned: do not use "latest" for your notes
    restart: unless-stopped
    volumes:
      - trilium-data:/home/node/trilium-data
    ports:
      - "127.0.0.1:8080:8080"                # only for the first setup below; remove it afterwards

  app:
    image: ghalen123/tryldrasil:0.1.0-alpha.1
    restart: unless-stopped
    ports:
      - "8081:80"                            # the app: http://<your-host>:8081
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    depends_on:
      - trilium
    environment:
      TRILIUM_URL: http://trilium:8080       # where the container reaches Trilium
      TRILIUM_TOKEN: ${TRILIUM_TOKEN}        # from the .env file next to this one
      TRILIUM_NAME: "My notes"
      # TRILIUM_READONLY: "1"                # optional: the app can only read
      # AI is off unless you set these (see "Optional AI" below):
      # AI_PROVIDER: anthropic
      # AI_KEY: ${AI_KEY}

volumes:
  trilium-data:
```

**2. First start of Trilium, once:**

```bash
docker compose up -d trilium
```

Open http://localhost:8080, set a password, then in Trilium go to **Options -> ETAPI** and create a token.

**3. Give the app the token and start it:**

```bash
echo 'TRILIUM_TOKEN=<paste the ETAPI token>' > .env
docker compose up -d
```

Open **http://localhost:8081** (or `http://<your-server>:8081`). The app opens in the tree: you start on the porch of Yggdrasil. `Esc` is the menu (controls, graphics, time).

**Updating:** `docker compose pull && docker compose up -d`. **Stopping:** `docker compose down` (your notes stay in the `trilium-data` volume). **Away from home:** put HTTPS and your SSO in front of port 8081 only, see [Using it away from home](#using-it-away-from-home-https--pangolin). Anyone who gets past the SSO can read, and unless `TRILIUM_READONLY=1` write labels and capture notes into that Trilium, so use read-only for anything shared. Every variable is described under [Hosting the app itself](#hosting-the-app-itself).

**Build it yourself instead:** `git clone` this repository and run `docker compose up -d --build bibliotheca` (the repository's own `compose.yml` also starts a throw-away test Trilium; see Quick start).

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

The app is plain static files once built, so it ships as a small nginx container (read-only rootfs, healthchecked). Two ways to use it:

```bash
docker compose up -d --build bibliotheca   # serves on http://<host>:8081
APP_URL=http://dind:8081 node tools/browser-test.js   # verify it hosted
```

**Plain (no configuration):** stateless, no secrets. Each visitor enters a Trilium URL + token in Settings and the *browser* talks to that Trilium directly, so that Trilium must allow this app's origin (CORS, see Quick start).

**Hosted mode (single origin, recommended for your own server):** put these in a `.env` file next to `compose.yml` and nginx serves your Trilium on the app's own origin:

```bash
BIBLIO_TRILIUM_URL=http://trilium:8080     # where the container reaches your Trilium (compose service name works)
BIBLIO_TRILIUM_TOKEN=<an ETAPI token>      # stays in the container; the browser never sees it
BIBLIO_TRILIUM_READONLY=1                  # optional: only GET/HEAD/OPTIONS pass; the app turns its writes off
# optional: BIBLIO_TRILIUM_ROOT_NOTE_ID, BIBLIO_TRILIUM_NAME, BIBLIO_TRILIUM_PUBLIC_URL (see .env.example)
```

nginx proxies `/etapi/` to that Trilium and **adds the token itself** (anything the browser sends is replaced; `/etapi/auth/*` is refused so nobody can mint or kill tokens through it). `/config.json` tells the app which server and (optionally) which AI the host configured; it never contains a secret. The user's own server option stays: a connection entered in Settings always wins over the host's. Details and every variable: [`docker/30-biblio-config.sh`](docker/30-biblio-config.sh), [`.env.example`](.env.example).

**Optional AI (off unless you set it, nothing uses it yet).** `BIBLIO_AI_PROVIDER=anthropic` (default model `claude-haiku-5-5`) or `openai-compatible` (OpenRouter, a local Ollama / llama.cpp server), with `BIBLIO_AI_KEY` / `BIBLIO_AI_BASE_URL` / `BIBLIO_AI_MODEL`. nginx forwards only `POST /ai/v1/messages` (Anthropic) or `POST /ai/chat/completions`, rate limited, with the key added server-side. The client side (`src/lib/ai/`) exists and is tested against fake providers; the learning modes that will use it are planned (they will only ever send notes that carry the inheritable label `biblio_learn`, never ones with `biblio_noai`, and note text is always treated as untrusted data). Be aware that with a cloud provider the text of such notes leaves your machine; a local model keeps it home.

The multi-stage build runs the strict type-check and the vite build inside the image (a broken build fails the image build), then nginx serves the bundle with immutable asset caching.

## Using it away from home (HTTPS / Pangolin)

The installable-app features (install, share target) need HTTPS. With **hosted mode** above the setup is one resource:

1. Publish **only the app** (container port `8081`) as an HTTPS resource, with Pangolin SSO in front of it. Trilium needs **no public address and no CORS**: the app's nginx reaches it over the internal network and adds the token. The browser only ever talks to the app's origin, so the SSO login cookie covers everything, including `/etapi/`.
2. Everyone who gets past the SSO can read (and, unless `BIBLIO_TRILIUM_READONLY=1`, write labels and quick-capture notes into) that Trilium through the app. That is fine for a solo setup; use read-only for anything shared.
3. Optional `BIBLIO_TRILIUM_PUBLIC_URL` makes "open in Trilium" links work (the real address is otherwise hidden).

Without hosted mode (two public resources, the browser talking to Trilium cross-origin): the app and Trilium both need HTTPS (mixed content is blocked), Trilium needs `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN=https://app.example.com` (not `*`) plus the methods/headers shown under Quick start, and an SSO redirect in front of the *Trilium* resource breaks the browser's cross-origin ETAPI calls (leave auth off there, ETAPI is token-protected, or let `/etapi/*` through). Check your Pangolin version's docs for the exact resource/rule options; I could only test the proxy against a local stand-in for the SSO. Tailscale notes: [wiki/Capture-and-PWA.md](wiki/Capture-and-PWA.md).

## Keys at a glance

| View | Keys |
|---|---|
| Library | `A`/`D` or arrows walk · `Space`/`W` jump · `E`/`Enter` interact · `Q`/`Backspace` up · `O` overview · `B` build · `Z` undo · `C` capture · `T` back out to the tree (at the door) |
| Reader | `+`/`-` size · `Alt+Left`/`Alt+Right` history · `Ctrl+F` find (`Enter` / `F3` next) · `[` `]` previous / next note · `Alt+Z` zen · `Esc` close |
| Tree | `W`/`S`/`A`/`D` move · `Space` leap/reach/take off · `Shift` stay on the branch (threads: climb in; fliers: down / land) · `E` read · `1`/`2`/`3` animal category · `G` grip · `M` move guided/free · `H` auto-align (free) · `V` camera · click = walk there · `L` look · `N` names · `F` foliage · `K` shadows · `I` performance · `P` pixels · wheel or `+`/`-` zoom · `E` at the shrine (door / altar / wisp) or a crown lantern · spiders: `X` drop, hold `X` down, hold `Space` up, `Shift` let go, `C` cut · `T` does nothing here |

## Status and limitations

Honest list of what is not there or not as good as it sounds:

- **v0.1.** Verified against Trilium v0.106.0 only. Test coverage is strongest for pure logic (library mapping, build-mode labels, tree simulation and layout); the 3D look is judged from screenshots, not asserted.
- **Walk caps.** The vault is walked breadth-first from the root note, at most 400 notes and depth 8. Beyond that notes are simply absent (no lazy loading yet) and a toast says so.
- **Spine thickness follows the title**, not the note length (real length would need a content fetch per note; only the tree view measures lengths).
- **Notes are read-only in the app.** Capture creates notes; build mode and the tree's branch panel write `biblio_*` labels; nothing edits content, titles or structure. Renaming, creating, deleting and moving notes from inside the game is *planned*, not built.
- **Rendering limits.** `image` and `file` notes show as pictures / PDFs / text / a download card, and pictures embedded in text notes load; canvas, mermaid, mind-map and similar notes still show their raw content with a notice (no renderer yet), and math (`.math-tex`) shows its TeX source. On a real v0.106 server markdown notes are `code` notes with a markdown mime type; the app treats those as markdown.
- **Links and relations** between notes are not visualised (only labels are read); a design exists, nothing is built.
- **Socrates is a placeholder**; there is no intelligence service. One library per app instance; no townsquare, quest board or calendar.
- **The tree view needs WebGL**, and its camera/animal feel is still being tuned (the app falls back to the library without it). In headless containers it needs a full Chromium with software GL (see the wiki). The giant Yggdrasil trunk is heavier to draw than the old stump, especially in the voxel look (its cubes are bigger to keep the cost down): use `I` to see the cost and `L` for the low-poly look.
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

- In plain mode the ETAPI token is stored in this browser's localStorage - a deliberate trade-off since the app has no backend of its own. Anyone with access to that browser profile can read the token. In **hosted mode** the token lives only in the container's environment and nginx config (a mode-600 file in a tmpfs): the browser holds none. Do not put a token in a `VITE_*` variable for a hosted build: those are baked into the JavaScript every visitor downloads.
- Note content is rendered in an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`: opaque origin, no access to the app) and a Content-Security-Policy that lets only one nonce'd script run - ours, which just reports link clicks. Scripts, inline handlers and `javascript:` links inside a note are blocked, so note HTML cannot execute anything.
- The app writes two kinds of data: `biblio_*` labels (room layout, build-mode looks and tree branch properties - the build code refuses to write any other label name), new notes created by quick capture (plus the `biblio_inbox` label on the Inbox), and - only if you switch it on - the Yggdrasil save folder and note; logging in with a password also makes Trilium mint an ETAPI token. Existing note content, titles and structure are never modified. The full list is under [Before you connect](#before-you-connect-what-the-app-reads-and-writes); this is **alpha software** with no guarantee about the safety of the connected database, so back it up first.
- The compose.yml mock sets `corsAllowOrigin=*` and a known password - **for the throwaway test instance only**. Never do this on a real vault, and never point the tools in `tools/` at one.

## License

[AGPL-3.0](LICENSE) for this code (the same license as Trilium): free to use, study, modify, fork and share, commercial use included, as long as derivative works stay AGPL and, if you run a modified version as a network service, you offer its users the source. Copies obtained earlier under MIT stay MIT. This app only talks to Trilium through its public API (no Trilium code inside); the bundled libraries (React, Phaser, three.js, marked) keep their own MIT licenses; all art is generated in code at runtime, so no third-party asset licenses apply.
