# Testing

Rule of the house: **prove it, do not assert it.** A change is done when the checks are green. New behaviour gets a unit test or a browser-test step in the same change ([Contributing](Contributing.md)).

All commands run from the project folder (**CONTAINER**, see [Getting Started](Getting-Started.md)).

## The checks at a glance

| Command | What it does | Needs | Destructive? | Time |
|---|---|---|---|---|
| `node tools/unit-test.mjs` | 21 sections of pure-logic tests (below) | nothing (bundles `src/` with esbuild, runs in Node) | no | about 2 s |
| `npm run test:mock` | Fake versus real mock conformance, vault generator, the mock CLIs | nothing; the real mock only if `.bootstrap.env` and the mock are up (`--no-real` skips it) | no (the real part only touches its own scratch subtree and deletes it) | about 2 s without the real part |
| `npx tsc -b` | Strict type check | nothing | no | not timed |
| `node tools/browser-test.js` | A real headless browser pass over the whole app | the mock + `.bootstrap.env`; starts its own Vite server unless `APP_URL` is set | **writes to the mock** (see below) | not timed |
| `tools/etapi-probe.sh` | Asserts every ETAPI endpoint the app uses | the mock + `.bootstrap.env` | creates and deletes notes under root | not timed |
| `npm test` (= `tools/check.sh`) | Everything, in order | Docker, the mock | **WIPES the mock** (recreates it from a wiped volume) | not timed |
| `node tools/tree-shots.js [scenario...]` | Headless WebGL screenshots of the 3D view | a running dev server; full Chromium | writes `shots/*.png` only | slow (below) |

Non-destructive subset: `npx tsc -b && node tools/unit-test.mjs && node tools/browser-test.js`, plus `npm run test:mock`.
**Never run `npm test` unless you accept losing everything in the mock.** Never point any of this at a real Trilium.

`tools/check.sh` runs five named checks, in this order, and all must be green: **types + build** (`tsc -b` and `vite build`), **unit**, **trilium mock from scratch** (`trilium-bootstrap.sh --recreate`, proving the setup is reproducible),
**browser pass** against that fresh mock, and **etapi integration**. `BOOTSTRAP_SERVICES=trilium npm test` skips the hosted-app image build (needed when the nested containers have no npm egress).
The mock-tooling suite (`npm run test:mock`) is **not** part of `npm test`. Each tool's purpose, inputs and risks: [tools/README.md](../tools/README.md).

## Unit tests (`tools/unit-test.mjs`)

Prints `unit ok` at the end; roughly 800 `assert` calls. Sections (the numbers are the file's own; the file runs them in the order 1 to 14, 16, 15, 18, 17, 19, 20, 21):

| # | Covers |
|---|---|
| 1 | Noise labels (camelCase) never become shelves |
| 2 | The depth cap stops only that branch; `truncated`; siblings still walked |
| 3 | Clones keep every parent edge |
| 4 | Quick capture: text to title/body, inbox reuse versus creation, `sharedText` |
| 5 | Auto-placement gives every room its own cell |
| 6 | Shelving: a crowded tag continues on further cases; nothing lost unless `maxCases` |
| 7 | World building: own-label filter, themes, `setLabel`, undo journal |
| 8 | Decor slots: CSV parse/serialise, defaults, unknown entries kept |
| 9 | Review fixes: serialised undo, conflict-safe undo, duplicate labels, layout writes own labels only |
| 10 | Reader: link recognition and preference sanitising |
| 11 | Yggdrasil rails: frames, steering, trailing body, procedural feet, grip, leaps, snake reach (steering, body grip), squirrel glide pitch, ground recovery, `climbTarget` |
| 12 | Tree layout (vault to branches and leaves): connectivity, spacing, leaf data, ground, worst cases, performance |
| 13 | Leaf kinds, scale, outlines, `textLength`, the leaf-size loader with a fake client and localStorage (cache hit/miss, errors, caps, abort), `blobId` survives `toNoteInfo`, the "leaf" reader paper contrast, `biblio_leaf` never a shelf |
| 14 | Review fixes: reach keeps the tail's history, retract obeys the grip rule, leaf-size guards |
| 15 | Fliers: take-off, hover, wing flight and stall, landing and deflection, floor, random-input fuzz on the demo and a layout world; grip by gravity (a vertical trunk never drains, a 15 degree overhang is climbable, the spider clings, only the spider); auto-align and thin-branch turn damping; **number-key categories** |
| 16 | Branch radius model: twig/mid/trunk targets, monotonic in notes and depth, taper, child at most 0.85 x parent at the attach point, `radiusAt`, lengths (every folder is forced to the reference species `maple` with `biblio_species`, so the multipliers are 1) |
| 17 | **Forest layout:** hub plus one tree per top-level folder (trunks fanned, arched, at least 3 diameters apart for N = 2 to 133; a creature walks down one trunk into the hub and up another; N = 0, 1, 2, 30, 45), the 13 species (table sanity, determinism, variety: any 4 neighbours differ, inheritance, label override, invalid label, every species lays out finitely), **editable and recalculable properties** (each override, clamp, `null` reset, `calc` unchanged by its own override, descendants move), tolerant `parseOverrides` fuzz, leaf pins (`biblio_lat`), determinism, cycles, clones, depth, performance |
| 18 | **Leap aiming** (hold = aim, release = leap, a tap is the old leap, clamps and charge, Shift cancels, ignored while airborne, flying or reaching), the auto-target (finds a branch the manual aim misses, manual input still moves the cone), **preview equals actual landing** on the demo and a layout world, determinism; **blue jay landing mode** (Shift alone lands in at least 90 % of 200 trials per world, deflects without Shift, `landTarget`); fuzz |
| 19 | **The ant reaches** (never jumps, bridges a 50 px gap, retracts, grip rule), crawlers never aim, the **jumping spider** (small, dark, orange-red, strong leap per size), **spider silk** (drop, let down, reel up, ground clamp, swing, pump, let go, free thread, bridge, walking threads both ways), who may use threads, threads **survive world rebuilds** until reload (`applySilks`, gone anchors skipped, threads follow edits), a NaN-proof fuzz, and review fixes (no climb hint while flying, feet after landing, underside take-off, cat cling limit, take-off from a slip fall) |
| 20 | `lib/treeedit`: what is written when a branch property is edited, reset or recalculated (a different value is written; the calculated one is not; a saved label goes back to calculated by removal; unchanged writes nothing; species; `setPending`, `formatNumber`) |
| 21 | Markdown on Trilium v0.106: `effectiveType("code", "text/x-markdown")` is `markdown`, other mimes and types are untouched, `renderNoteContent` renders it as markdown |
| `unit-animals.mjs` | (loaded at the end by `unit-test.mjs`) **Animal models** (`src/tree/animalmodels.ts`): every sim animal has a model, the generic fallback works, tube widths stay within the sim's widest half-width, colour / profile / crest / wing-pose functions are total and finite, wings and the squirrel's membrane agree with the sim data, mesh count bound |
| `unit-forest.mjs` | (loaded at the end by `unit-test.mjs`) **Forest mode** (stump + ground roots + trunks: structure, N = 0/1/2/3/6/7/12/30/133 placement with trunk spacing and crown overlap bound, every species; walking tree to root to stump to root to tree for several animals both ways, grip on roots), the **wave** (`waveShape` for every shape: 0 at the base, bounded, continuous, finite, deterministic; `applyWave`; steepness limit; wave overrides, clamps, garbage fuzz, null reset, calc unchanged, children and leaves follow the displaced centreline, smooth rails), **pointed tips** for every species in both modes plus the sim fuzzed at a tip for every animal, hub mode unchanged, performance |
| `unit-move.mjs` | (loaded at the end by `unit-test.mjs`) **Movement modes**: `spawn` stays free, free mode unchanged; guided: W tip-ward at the animal's speed, S base-ward after a swing of at most 1.5 s for every animal, A/D bend the right way as the animal faces (flat branch, vertical pole, a branch pointing down), release straightens with no residual spiral, A/D alone creeps to the underside and back (grip rules intact, the cat keeps `maxTh`), alternating A/D keeps `th` bounded, 50 reversals never stick (flat branch, demo, forest and hub worlds), thin vs thick turn rates, numerically smooth U-turn path, junction transfers both ways (log forks, Shift-climb, trunk to ground root to stump, hub), aiming / reach / flight / silk / leaps identical in both modes, a 150k-step random-input fuzz for every animal in three worlds (finite, on a branch, on the bark) |

## Browser test (`tools/browser-test.js`)

Steps (all must pass, then **zero console errors**):

1. The world mounts: canvas present, connection online, breadcrumb "Library".
2. Search for the seeded note, open it as a book (sandboxed iframe with the seeded content).
   - 2b. Reader: an internal link navigates inside the reader, back returns, text size and the Night paper apply, the CSP restricts scripts to our nonce.
   - 2c. Tree view (**needs WebGL**, else skipped with a note): the vault lays out as branches and leaves; `E` next to a leaf opens that note; `-` zooms; `L` switches the look; `V` cycles the camera; leaf sizes get measured (some `size !== 1`); `world.groundY` is a number; `N` cycles the names; key `3` cycles the four fliers; `H` toggles auto-align; every branch tapers; **`B`** opens the branch panel on the hub, the length slider is set to 420 and **Save** writes `biblio_blen=420` on the root (read back through ETAPI), **Recalculate all** removes the label again; then `T` goes back.
3. The overview toggles from the HUD.
4. Quick capture: `C` opens it, movement letters are typeable, `Ctrl+Enter` files a note under the labelled Inbox (the note is deleted afterwards).
5. Build mode: `B`, `2`, `Enter` writes one `biblio_theme=midnight` label on the root; `Z` removes it. Then `Tab`, `]`, `Enter` writes `biblio_wall=window`; `Z` removes it.
6. The PWA share target: `/?title=...&text=...&url=...` prefills capture and clears the query.
7. Console errors: none allowed.

What it leaves in the mock: a **"Bibliotheca Demo"** room with a "Hello Note" and an **Inbox** note (both created if missing and kept); its temporary notes and the captured note are deleted. Before the app loads it also removes leftover `biblio_*` labels on the root (except `biblio_x`, `biblio_y`, `biblio_inbox`) from earlier aborted runs.
It needs credentials in `.bootstrap.env`, and `APP_URL=http://dind:8081 node tools/browser-test.js` runs it against the hosted container instead of starting Vite.

**Which Chromium:** `CHROME_PATH` if set. Otherwise the project-local full Chromium in `.playwright-browsers/chromium-*/chrome-linux64/chrome` is tried first with SwiftShader software GL (so the tree steps run); if it does not launch, it falls back to the headless shell in `.playwright-browsers/chromium_headless_shell-*` (no WebGL, tree steps skipped), then to odd-arcade's `~/.cache/ms-playwright`.
Extra shared libraries extracted from `.deb` files in `.playwright-libs/root` are added to `LD_LIBRARY_PATH` automatically. Both folders are gitignored and are downloaded on the **host** (the dev container's firewall blocks the Playwright CDN):

**HOST**

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/work/.playwright-browsers node:22-bookworm \
  npx playwright install chromium
```

## Mock tooling tests (`npm run test:mock`)

One conformance suite runs against the **fake** (spawned on a free port) and the **real mock**; response shapes, error bodies, default mimes, header values and search results must be identical. Then fake-only checks: profile counts, determinism, depth and width, label coverage, values the app understands, content hygiene,
HTTP apply equals in-memory load, the app's own `walkLibraryTree` and `captureNote` on the fake, the walk caps, the CLIs and `seed-vault`'s refusals. The last run printed 33 checks green with `--no-real`. The real part is skipped (not failed) when the mock is down, never logs out, and logs in only with `--real-login` (the real server rate-limits logins).
Details: [Mock and Seeding](Mock-and-Seeding.md).

## Screenshots of the 3D view (`tools/tree-shots.js`)

Never starts or stops servers: start the dev server yourself (**CONTAINER**, `npm run dev`) and then, in another terminal:

```bash
node tools/tree-shots.js                  # every scenario (slow)
node tools/tree-shots.js looks leaves     # just these
W=800 H=480 node tools/tree-shots.js animals
```

| Scenario | Shows |
|---|---|
| `looks` | The demo log in both looks, chase camera |
| `level` | Low-poly, level camera |
| `ground` | The floating demo log from far away (ground, horizon) |
| `leaves` | Leaves on the demo trunk, both looks |
| `squirrel` | A glide |
| `snake` | A reach (its script presses `1` three times, which since the jumping spider joined the crawlers selects the **jumping spider**, so the picture no longer shows the snake) |
| `vault` | `lizard3d.html?vault`: overview with signs and bubbles, level view, leaves, both looks |
| `kinds` | The five leaf kinds in three sizes on a demo twig (`SIGN=-1` mirrors them to the other side) |
| `animals` | Nine animals perched (the jumping spider is not in its list), both looks, plus the three fliers in the air |

Environment: `APP_URL` (default `http://localhost:5173`; the script appends `/lizard3d.html`), `W` and `H` (viewport, default 1280 by 760), `SIGN` (kinds only). Output goes to `shots/tree-*.png` (gitignored) and the script prints any console errors or warnings at the end.
**Slowness note:** the pictures are rendered by software GL (SwiftShader), so each screenshot can take many seconds (the script waits up to 120 s per shot) and the `animals` scenario takes 24 of them. There is no scenario for the forest, the species, the jump-aim preview or silk yet; those are judged live (`lizard3d.html?vault` shows a synthetic vault through the real forest layout (add `&layout=hub|forest`, `&trees=N`, `&depth=D`, `&wave=fn:amp:freq`; a vault with many deep folders can run a software-GL browser out of memory, so use `&trees=6&depth=2` or lighter), which is the closest you get; the `vault` scenario photographs it). Run one scenario at a time and shrink the viewport with `W` and `H` while iterating.
The 3D look itself is judged from these pictures, not asserted by tests.

### WebGL in the dev container

Symptom: `THREE.WebGLRenderer: A WebGL context could not be created`, or ANGLE `VK_KHR_wayland_surface` errors.
Cause: VS Code forwards `WAYLAND_DISPLAY`/`DISPLAY`; with them set, ANGLE demands an extension SwiftShader lacks. The headless shell has no WebGL at all.
Recipe: unset both variables and use the **full** Chromium with `--headless=new --use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader`.
The full Chromium also needs `libcups.so.2`; a stub library exporting the needed symbols is built with gcc into `.playwright-libs/root/usr/lib/x86_64-linux-gnu/` (gitignored). To rebuild it: `nm -D --undefined-only chrome | awk '/ U (cups|ppd|http|ipp)/{print $2}'`, one dummy function per symbol, then `gcc -shared -fPIC -Wl,-soname,libcups.so.2`.
`tools/browser-test.js`, `tools/tree-shots.js` and `tools/playwright-mcp.sh` (the Playwright MCP wrapper behind `.mcp.json`) all apply this recipe. Restart Claude Code to pick up an updated MCP wrapper.

## Flakiness and timing notes

- **Cold Vite is slow.** The first page load transforms the multi-megabyte Phaser module and can take 10 seconds or more, so the browser test uses generous timeouts (30 s for the first waits).
- **Build panel key listener.** The test waits 250 ms after the panel appears before pressing keys, so the panel's listener is attached.
- **Leaf sizes are measured asynchronously** after the tree opens; the test waits up to 15 s for a `size !== 1`.
- **`localStorage` in the sandboxed frame.** Playwright replays `addInitScript` in every frame, including the reader's sandboxed iframe where localStorage throws `SecurityError`; the init script is guarded with try/catch. Keep it that way.
- **Real-mock state leaks between runs** (Inbox, demo room, root labels left by an aborted run). `cleanRootLabels` handles the labels; a corrupted tree after an invalid branch needs `docker restart bibliotheca-trilium-mock` ([Troubleshooting](Troubleshooting.md)).
- **Login rate limit:** the real server allows 10 logins per window (`X-RateLimit-Limit: 10`); do not loop on `/auth/login`.
- **Search text:** the browser test searches for "hello"; the vault generator never produces that word for exactly this reason.
- **Canvas versus WebGL:** headless runs may use Phaser's Canvas renderer, which ignores tints; assert theme effects through scene state or labels, not pixels.
