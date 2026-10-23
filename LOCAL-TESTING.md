# Local testing — quick guide

How to run Bibliotheca and a throw-away Trilium and try the app yourself.
(Agents: `AGENTS.md` is the authoritative reference; this is the short human version. Longer guides for every part of the app live in [`wiki/`](wiki/Home.md); every script in `tools/` is described in [`tools/README.md`](tools/README.md).)

**Where does each command run?** Every command block below is tagged:

- 🐳 **CONTAINER** — run in the devcontainer's terminal, **from `/workspace/Trilium-Bibliotheca`**
  (the terminal opens in `/workspace`, so `cd Trilium-Bibliotheca` first).
  Claude can run these for you.
- 🖥️ **HOST** — run on your own machine, outside the devcontainer. Claude cannot run these.
- 🌐 **BROWSER** — just open a URL in your host's browser.

## Ports

The sidecar publishes the services to your host on **different** port numbers
(`127.0.0.1:18080-18081` → container ports 8080-8081), because 8080 is often taken on a host.

| Service        | Runs in         | Start with (🐳)                    | In the devcontainer | In your host browser (🌐) |
|----------------|-----------------|------------------------------------|---------------------|---------------------------|
| Vite dev       | dev container   | `npm run dev`                      | `localhost:5173`    | `http://localhost:5173` (VS Code forwards it) |
| Vite preview   | dev container   | `npm run build && npm run preview` | `localhost:4173`    | `http://localhost:4173` (VS Code forwards it) |
| Hosted app     | `dind` sidecar  | `docker compose up -d`             | `http://dind:8081`  | `http://localhost:18081` |
| Trilium mock   | `dind` sidecar  | `tools/trilium-bootstrap.sh`       | `http://dind:8080`  | `http://localhost:18080` |

`dind` is only a name inside the Docker network; it does **not** exist on your host.

## 0. Host-side stack notes (🖥️ HOST — only if the sidecar needs (re)creating)

The mapping lives in `.devcontainer/docker-compose.yml` (`ports:` of `dind`) and applies
when the stack is created. Rules learned the hard way:

- **Always pass the VS Code project name** for host compose commands:
  `docker compose -p claudefresh_devcontainer -f .devcontainer/docker-compose.yml …`
  (without `-p`, a second project `devcontainer` competes for the same ports).
- Port clash (`port is already allocated` / `address already in use`): close all VS Code
  windows, check `ss -ltnp | grep -E ':(31000|18080|18081)\b'` is empty, `docker rm -f` the
  broken `dind-1`/`dev-1`, bring the stack up from a terminal, then reopen the devcontainer.
- Set `"remote.autoForwardPorts": false` in VS Code user settings so it stops grabbing ports.

```bash
# 🖥️ HOST — check that the mock is published (after step 1 below)
curl -sI http://localhost:18080 | head -1     # HTTP/1.1 200
```

## 1. Start the Trilium mock (🐳 CONTAINER)

```bash
# 🐳 CONTAINER
tools/trilium-bootstrap.sh            # start + create an ETAPI token
tools/trilium-bootstrap.sh --recreate # wipe the volume and start from scratch
tools/trilium-bootstrap.sh --down     # stop it
```

This writes `.bootstrap.env` (gitignored) with `TRILIUM_URL` and `TRILIUM_TOKEN`.
The mock's instance password is `biblio-test-pw` (disposable).
`BOOTSTRAP_SERVICES=trilium tools/trilium-bootstrap.sh` starts only the mock, skipping the hosted-app image build.

## Credentials (disposable mock only)

| What | Value |
|------|-------|
| Trilium URL (host browser) | `http://localhost:18080` |
| Trilium URL (inside devcontainer) | `http://dind:8080` |
| Instance password | `biblio-test-pw` (override with `BIBLIOTHECA_TEST_PASSWORD` before bootstrap) |
| ETAPI token ("API key") | in `.bootstrap.env` → `grep TRILIUM_TOKEN .bootstrap.env` (🐳). A new one is minted on every `--recreate`, so it is not written here |
| Hosted app | `http://localhost:18081` (no login of its own) |

Use **either** the password **or** the token in the app's settings dialog; the password
is easiest (the app exchanges it for a token). These credentials only protect the throw-away
mock — never reuse them, and never put a real Trilium token or any provider API key in this
repo or this doc.

## 2. Run the app (🐳 CONTAINER)

Dev server with hot reload — run it **inside the project folder** (the terminal starts in
`/workspace`, which has no `package.json`; that is the `ENOENT /workspace/package.json` error):

```bash
# 🐳 CONTAINER
cd /workspace/Trilium-Bibliotheca
npm install
npm run dev
# or from anywhere:  npm --prefix /workspace/Trilium-Bibliotheca run dev
```
→ 🌐 `http://localhost:5173`

Or the hosted container (rebuild after code changes):

```bash
# 🐳 CONTAINER
docker build -t bibliotheca-web:latest .
docker compose up -d
```
→ 🌐 `http://localhost:18081`

In the app's **settings** dialog (🌐):
- **Server URL:** `http://localhost:18080` (the browser fetches Trilium directly, so the
  URL must work *from the browser*; use `http://dind:8080` only for a browser inside the
  devcontainer).
- **Password:** `biblio-test-pw`, or paste the token (see Credentials above).
- **Library root note id:** `root` (default).

Demo content (optional; the browser test also seeds it):

```bash
# 🐳 CONTAINER
node tools/seed-demo.js               # tiny
node tools/seed-vault.js              # "Mock Vault (medium)": ~160 themed notes, every note type, labels, clones, relations
node tools/seed-vault.js large        # small | medium | large | huge | deepchain | widefan | longtail  (--list shows numbers)
node tools/seed-vault.js --list       # profiles with their real note/folder/depth/width numbers (no network)
node tools/seed-vault.js --clean      # remove the generated vault(s) again
node tools/seed-rich.js               # hand-made, varied "Rich Mock Library" (rebuilds only its own subtree)
```
`seed-vault.js` rebuilds only its own `Mock Vault (<profile>)` note under root and refuses any server that is not the mock from
`.bootstrap.env`. The app walks at most 400 notes / depth 8 from root, so `large`, `huge` and `deepchain` show the "walk cap" toast on
purpose. Details and the profile table: AGENTS.md "Trilium mock".

## 2b. No docker? Use the fake (🐳 CONTAINER)

```bash
# 🐳 CONTAINER
npm run mock:fake -- --seed medium     # in-memory ETAPI; prints TRILIUM_URL=... and TRILIUM_TOKEN=... (password biblio-test-pw)
npm run test:mock                      # conformance (fake vs real mock, real part skipped if it is down) + generator tests
```
Point the app's settings at the printed URL (a browser inside the devcontainer; the host cannot reach it) and paste the token or the
password. Nothing is persisted; stop it with Ctrl-C. (`npm run test:mock -- --no-real` runs the conformance and generator tests against the fake only.)

## 3. Things to try (🌐 BROWSER)

- Walk with ←→/AD, jump with Space/W, interact with E/Enter, `O` toggles overview.
- **Quick capture:** press `C` (or the "capture" button), type, `Ctrl+Enter`.
  Notes land under the note labelled `#biblio_inbox` (an "Inbox" is created on first use).
- **Up one folder:** `Q` or `Backspace` (or walk into the exit door). Standing at a door shows
  that folder's description; the plaque under the top bar shows the current room's.
- **Touch controls:** on a phone the on-screen ◀ ▶ ⬆ ▲ ● buttons appear; on a desktop add
  `?touch=1` to the URL to try them.
- **Build mode:** press `B` in a room (library view, not in the overview). `Tab` / `Shift+Tab` switches tabs (theme · wall · floor · rug · case);
  theme: `1`–`7` pick (one key per theme in `THEMES`), `S` room↔wing; wall/floor: `←→` slot, `[` `]` (or `↑↓`) change kind, wall `+`/`−` extra
  wall; rug/case: `1`–`4`; `0` resets the tab; `Enter` saves (one label per change), `Esc` cancels. The world is paused while the strip is open.
  `Z` / `Shift+Z` undo / redo saved edits. Edits write `biblio_*` labels on the room note.
- **Reader:** open a book (walk to a spine + `E`, or search). `A−`/`A+` or `-`/`+` text size; `Aa`
  font / width / paper; click a link to another note to follow it, `◀`/`Alt+←` to go back.
- **Tree view (Yggdrasil):** press `T` (or the "tree" button) — the vault as a **forest** (the root is a central stump, every top-level folder is its own tree of one of 13 species standing in the ground, joined to the stump by walkable ground roots; voxel or low-poly), needs WebGL. `Y` or the "layout: forest/hub" button switches to the old hub layout (remembered in localStorage `biblio.v1.treeLayout`).
  **guided movement (default):** `W` up the branch, `S` down, `A`/`D` turn left / right on it in a smooth curve (let go = it straightens along the branch); **`M`** = free movement (remembered, `biblio.v1.treeMove`): `W`/`S` forward/back, `A`/`D` steer the head (`H` auto-align straightens it again when you let go; no effect in guided); `Space` **hold = aim a jump**
  (lizard, cat, squirrel, jumping spider: `A`/`D` turn, `W`/`S` tilt, an arc preview shows the landing, white = lands, green = auto-targeted, orange = nothing; release = leap, a quick tap = plain leap, `Shift` cancels;
  snake and ant: hold = reach, steer it with `WASD`, it stops at max length, they can't jump; spider: no jump, `X` = silk: drop on a thread, `S` let down, `W` reel up, `A`/`D` swing, `Space` held pumps, `X` again lets go, the thread stays climbable until reload (the jumping spider also spins silk); flying squirrel: aimed leap then glide, `W` dive / `S` flare;
  bee / dragonfly / blue jay: `Space` takes off — bee and dragonfly then hover: `W`/`S`/`A`/`D`, `Space` up, `Shift` down, touching bark lands;
  jay: always forward, `W` dive / `S` climb / `Space` flap, hold `Shift` = landing mode (flare + steer to a branch ahead; touching lands)),
  walking up past a side branch's base climbs into it by itself (hold `Shift` = stay; roots / silk threads: `Shift` climbs in), mouse: click = walk there (double-click a leaf = read it, `Esc` / any key stops), `V` includes a mouse camera (drag to orbit), `E` read the leaf next to you,
  `1`/`2`/`3` animal **category** — crawlers (ant, spider, jumping spider, snake), walkers (lizard, cat), fliers (squirrel, bee, dragonfly, blue jay); press the same number again to cycle inside the category,
  `G` grip (hang underneath too long → you slip, a vertical trunk never drains; the snake only loses grip when no part of it is on top; the spiders never; shaking warns),
  `B` **edit the branch you stand on**: sliders for length, thickness, taper, rotation on the parent, angle off the parent, position, droop/lift, a kind-of-tree select and the wave (amplitude, frequency, shape select + preview); the tree re-grows live; **Save** writes one `biblio_b*` / `biblio_species` label per changed value on the folder note (on the mock!), ↺ / **Recalculate all** remove the label (back to calculated), **Undo** takes back the last write,
  `V` camera (chase/level/fixed), `L` look (voxel/low-poly), `N` branch names (signs/bubbles/off), `Y` layout forest/hub, `F` canopy foliage on/off (a translucent canopy that hides the thin branches from afar and fades out near you / the camera; density slider at the bottom of the `B` panel), `K` sun shadows off/low/medium/high (a soft blob under the animal when off), `I` performance panel (FPS, JS vs frame time, draw calls; profile quality/auto/fast), wheel/`+`/`-` zoom, `P` pixel look, `T` back.
  Leaf style follows the note type or a `#biblio_leaf` label (broad|needle|maple|blossom|fruit); leaf size follows the
  note length (measured in the background after the tree opens, text/markdown/code notes only; the reader's "leaf" paper matches the look).
  Branches are thicker for folders that carry more notes and taper towards the tip; a `#biblio_species` label on a folder sets its tree kind (oak, birch, maple, pine, willow, cherry, acacia, baobab, redwood, aspen, ash, cypress, ghost), `biblio_lat` = `s,th` on a note pins a leaf (no editor yet).
  Markdown notes: a v0.106 `code` note with a markdown mime counts as markdown (rendered, maple leaf).
  Look, camera, names, foliage and shadows are remembered (localStorage `biblio.v1.treeLook` / `biblio.v1.treeCam` / `biblio.v1.treeLabels` / `biblio.v1.treeFoliage` + `biblio.v1.treeFoliageDensity` / `biblio.v1.treeShadows`).
  Demo tree without Trilium: `http://localhost:5173/lizard3d.html` (hosted: `:18081/lizard3d.html`); add `?vault` for a
  synthetic vault through the real layout; `R` respawns there.
  Headless screenshots of the 3D view: see below, "Screenshots of the 3D view".
- Search via the "search" button; drag rooms in overview to save their position.
- **Share target (phone):** needs HTTPS. On the machine that runs the containers:

  ```bash
  # 🖥️ HOST
  tailscale serve --bg 18081
  ```
  Then open the printed `https://…ts.net` URL on the phone, install the app, and share a
  page to "Bibliotheca". Trilium must also be reachable over HTTPS from the phone and
  allow that origin via CORS.

## 4. Automated checks (🐳 CONTAINER)

```bash
# 🐳 CONTAINER
npm test                        # ⚠ WIPES the mock (fresh Trilium) — all notes you added are lost! Five checks: types+build, unit, mock from scratch, browser, etapi
npx tsc -b && node tools/unit-test.mjs && node tools/browser-test.js   # non-destructive subset (the browser test writes into the mock: demo room, Inbox)
npm run test:mock               # mock tooling: fake vs real mock conformance, vault generator, CLIs (non-destructive, ~2 s; 33 checks with --no-real)
node tools/unit-test.mjs        # unit tests only (21 sections, ~800 assertions, ~2 s; 11–21 = tree rails, layout, leaf kinds/sizes, fliers, radius model, forest + species + editable properties, leap aiming, ant/jumping spider/silk, treeedit, markdown mime)
APP_URL=http://dind:8081 node tools/browser-test.js   # browser pass against the hosted container
tools/etapi-probe.sh            # ETAPI contract assertions (creates/deletes notes under root of the mock)
```

Screenshots from the browser pass go to `shots/` (gitignored). The browser pass prefers the full Chromium with software GL (so its tree-view
steps run) and falls back to the headless shell (tree steps skipped with a note).

### Screenshots of the 3D view (🐳 CONTAINER)

Start the dev server yourself (`npm run dev`), then in another terminal:

```bash
# 🐳 CONTAINER
node tools/tree-shots.js looks leaves                  # scenarios: looks level ground leaves squirrel snake vault kinds animals (none = all)
W=800 H=480 node tools/tree-shots.js animals           # W / H = viewport size (default 1280x760); APP_URL overrides http://localhost:5173
```

Pictures land in `shots/tree-*.png` (gitignored); it never starts or stops servers. It renders with software GL (SwiftShader), which is **slow**: each
screenshot can take many seconds (the script waits up to 120 s per shot) and `animals` takes 26 of them (ten animals x two looks, plus the three fliers in the air), so run one scenario at a time and use a small
`W`/`H` while iterating. Needs the full Chromium and the WebGL recipe in AGENTS.md ("WebGL in the dev container"). `vault` uses `lizard3d.html?vault` (default layout = forest; extra params `&layout=hub|forest`, `&trees=N`, `&depth=D`, `&wave=fn:amp:freq`; for slow software-GL screenshots use a light vault such as `?vault&trees=6&depth=2`).

## Troubleshooting

- **Host can't open `localhost:18080` / `18081`:** check the services run (🐳 `docker ps`),
  that `.devcontainer/docker-compose.yml` has `127.0.0.1:18080-18081:8080-8081` under `dind`,
  and see step 0 for port clashes.
- **`tools/trilium-bootstrap.sh: No such file` / `npm ENOENT package.json`:** you're in `/workspace`; `cd /workspace/Trilium-Bibliotheca`.
- **`dind` doesn't resolve on the host:** expected, use `localhost`.
- **Port already in use / wrong app answers:** verify by content, not just a 200.
- **CORS errors in the console:** the mock sets `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN`;
  a real Trilium needs the same option.
- **Pulls hang:** 🐳 `docker info` should show the registry mirror (`mirror` service).
- **Offline / unreachable:** the app falls back to the last cached snapshot.
- **"The tree view needs WebGL":** the browser has no WebGL; in the dev container see the WebGL recipe (AGENTS.md / wiki Testing). The library keeps working.
- **`B` or `T` do nothing:** a dialog or text input has focus, or the tree has not loaded yet; build mode only works in a room in the library view.
- More symptom → cause → fix tables: [`wiki/Troubleshooting.md`](wiki/Troubleshooting.md).
