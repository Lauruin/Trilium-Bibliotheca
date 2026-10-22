# Troubleshooting

Symptom, then cause, then fix. Collected from `AGENTS.md`, `LOCAL-TESTING.md` and the code. Messages in quotes are the toast or error texts the app shows (long dashes written as hyphens here).

## Connecting

| Symptom | Cause | Fix |
|---|---|---|
| Toast "Server unreachable - showing the cached snapshot." and the chip says "offline - cached" | The browser could not reach the server (down, wrong URL, or **CORS**: a CORS failure and a network failure look identical to `fetch`) | Check the Server URL. It must work **from the browser** (host browser: `http://localhost:18080`; browser inside the devcontainer: `http://dind:8080`). Then check CORS below. The cached snapshot is last session's tree; it is only a fallback |
| "Server unreachable and no cached snapshot exists yet." | First run, server unreachable | Fix the URL in settings |
| The browser cannot reach ETAPI although `curl` works | **CORS**: the instance must set `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN` (plus methods and headers), since Trilium v0.93.0. `compose.yml` sets `*` for the disposable mock only | Set the origin of the app on your Trilium (see [Getting Started](Getting-Started.md)) |
| "Trilium rejected the token - check settings (server URL / token)" | 401: wrong or revoked token. `POST /etapi/auth/logout` on the mock kills the token in `.bootstrap.env` for everyone | Paste a valid token or the password in settings; for the mock re-run `tools/trilium-bootstrap.sh` |
| Login fails with HTTP 429 | Trilium blacklists the client IP after repeated failed logins; the real server also rate-limits logins (10 per window) | Wait; use a token; do not loop on `/auth/login` |
| `curl /etapi/app-info` returns 401 `NOT_AUTHENTICATED` | **Expected**: the endpoint is alive and wants a token | Send the token; 200 plus app metadata is the green light |
| `/setup` answers "Failed to lookup view" | Expected on v0.106: setup is SPA-driven | Use `tools/trilium-bootstrap.sh` |
| "Connection problem: ..." | Any other failure during the refresh; the console has the stack | Read the message and the browser console |
| Host browser cannot open `localhost:18080` or `18081` | The sidecar does not publish them, services are not running, or a port clash | Check `docker ps`; `.devcontainer/docker-compose.yml` must map `127.0.0.1:18080-18081:8080-8081` under `dind`; see [LOCAL-TESTING.md](../LOCAL-TESTING.md) section 0 |
| `dind` does not resolve on the host | Expected: `dind` is only a name inside the Docker network | Use `localhost` and the published port |
| A `200` from the wrong thing | Another service owns the port | Verify by **content**, not status code |
| Pulls hang inside dind | Docker Hub IPs rotate and the sidecar firewall is hostname-to-IP | Pulls go through the `mirror` service; `docker info` should show `Registry Mirrors` |
| `tools/trilium-bootstrap.sh: No such file` or `npm ENOENT package.json` | You are in `/workspace`, not the project | `cd /workspace/Trilium-Bibliotheca` |

## Hosted container

| Symptom | Cause | Fix |
|---|---|---|
| nginx container `unhealthy` plus `[emerg] mkdir() "/tmp/nginx/client_body"` while the app serves fine | Two stacked causes: nginx `mkdir()`s only the leaf temp dir, so a nested path dies on a fresh tmpfs; and the healthcheck hit `localhost`, which resolves to `::1` while nginx listens on IPv4 only | Flat temp paths (`/tmp/client_body`, ...) in `docker/nginx.conf` and `wget http://127.0.0.1/` in the Dockerfile `HEALTHCHECK` (both already done; keep them) |
| The hosted app cannot talk to your Trilium | Its origin is not in Trilium's `corsAllowOrigin`, or an `https://` page calls an `http://` Trilium (mixed content) | See [Capture and PWA](Capture-and-PWA.md) |
| `tools/trilium-bootstrap.sh` spends time building the hosted-app image you do not need | By default it runs `docker compose up -d` for all services | `BOOTSTRAP_SERVICES=trilium tools/trilium-bootstrap.sh` starts only the mock. (It was once also a workaround for nested containers lacking DNS; that is fixed in the devcontainer sidecar with a dnsmasq forwarder) |

## Library view

| Symptom | Cause | Fix |
|---|---|---|
| Toast "Vault larger than the walk cap - showing the first rooms only." | The walk stops at 400 notes / depth 8 (`config.TREE_WALK`) | Expected for big vaults; set a smaller "Library root note id" in settings to build the world from a sub-tree |
| "+N not shown" on a case, or "+N doors" | A room holds at most 12 bookcases and shows 10 doors | By design; nothing is lost silently. Split the folder or retag |
| A mystery door named "Hidden Notes" | Trilium's internal `_hidden` subtree | The walk skips it explicitly; if one returns, check `library.ts` |
| A shelf named like a Trilium machinery label (for example `iconClass`) | The label is not in the noise list | Add it (lowercased) to `NOISE_LABELS` in `src/lib/library.ts` |
| A note I expected as a book is a room (or the reverse) | The rule is "has children": a note with a child is a room | Move or delete the child; see [Trilium Mapping](Trilium-Mapping.md) |
| Cannot interact with a door standing at the wall | World bounds stop the player about 40 px short, so `INTERACT_RANGE` (46) must exceed that | If you change room size, re-check this |
| Crash in `StaticGroup.clear` after a React remount | Phaser's `game.destroy()` is deferred, so per-scene event handlers outlive the scene | Register bus handlers at **module level** and forward to `BibliothecaScene.current`; never inside `create()` |
| Overview: "That cell is occupied - room snapped back." | You dropped a room on a taken cell | Drop on a free cell |
| Overview: "Could not save position: ... (kept locally)" | The label write failed | The move is only in memory until the next reload; fix the connection and drag again |
| A label created as `biblio.x` comes back as `biblio_x` | Trilium normalises attribute names and strips dots | Use underscore names from the start (`config.LABELS` does) |
| Wrong looks or a label edit changed an ancestor | An inherited label was treated as the note's own | Fixed by the own-label filter (`toNoteInfo`, `setLabel`); see [Trilium Mapping](Trilium-Mapping.md) |
| An old cached tree shows stale looks | A cache from before the own-label fix | The cache key is `biblio.v2.treeCache`; v1 data is ignored |

## Build mode and capture

| Symptom | Cause | Fix |
|---|---|---|
| `B` does nothing | It needs a loaded tree, being in a room, the library view (not the tree), not the overview, no open dialog or text input | Leave the overview or tree, close dialogs |
| "<label> was changed elsewhere - press refresh, then try again" | The label's value on the server differs from the cached one (another device) | Press **refresh**, then redo the edit |
| Panel says "N pieces don't fit in this room and are hidden" | Not enough floor between the last case and the door | Add wall span or remove pieces; nothing is deleted |
| `Z` has nothing to undo | The undo journal is session-only (50 deep) | Edit the label in Trilium instead |
| Theme tints invisible in a headless run | The Canvas renderer ignores `setTint` | Washes are rectangles; glass, shafts and flames only show under WebGL |
| `C` does nothing | You are typing in an input, a dialog is open, or no settings exist | Close the dialog; configure settings |
| Letters swallowed in capture or search (historic bug) | Phaser captured keys page-wide | The scene registers keys without capture; the browser test guards it |
| "Could not ..." on undo | The label changed elsewhere since | Refresh and redo manually |

## Reader

| Symptom | Cause | Fix |
|---|---|---|
| Images in a note do not load | Trilium attachment URLs need session cookies; the app uses token auth and the reader is sandboxed | Known v1 limitation; remote `http(s)` images do load |
| A markdown note shows as source | A `code` note whose mime does not contain "markdown" is code (v0.106 sends markdown as `code` plus a markdown mime, and the app maps that to markdown) | Check the note's mime in Trilium; use the raw toggle meanwhile |
| A canvas or image note shows "No rendered preview for note type ..." | Only text, markdown and code have a renderer | Raw source is shown instead |
| Clicking a link in a note does nothing | Only Trilium-internal links and `http(s)`/`mailto:` links are live; links with other schemes (`javascript:`, `tel:`, `ftp:`) are neutralised by design | Open the note in Trilium |

## Tree view

| Symptom | Cause | Fix |
|---|---|---|
| "The tree view needs WebGL, which is not available in this browser." | No WebGL (software rendering off, headless shell, remote desktop) | Enable hardware acceleration. In the dev container use the full-Chromium recipe in [Testing](Testing.md#webgl-in-the-dev-container) |
| `THREE.WebGLRenderer: A WebGL context could not be created`, ANGLE `VK_KHR_wayland_surface` errors | VS Code forwards `WAYLAND_DISPLAY`/`DISPLAY`, and ANGLE then demands an extension SwiftShader lacks | Unset both variables and use the full Chromium with SwiftShader flags |
| "I fall off the main trunk" (historic bug) | Grip was judged against the branch's own up axis, arbitrary on a near-vertical branch | Grip is now decided by world gravity (`n.y < -0.12`); do not change that back. A trunk should never drain |
| I keep slipping while hanging underneath | That is the grip rule: a full underside slips in about 2 s | `G` turns slipping off; use a spider (never slips) or the snake (safe while any part is on top) |
| I cannot get into a side branch | Climbing needs `Shift` **held** while standing in the side branch's base | The on-screen hint "Shift climb into ..." says when |
| The animal spirals around a thin branch | Free movement (`M`) with a wide animal on a twig | Use guided movement (default, `M`), or in free mode leave auto-align (`H`) on; try a smaller animal (ant, spider) |
| The jay will not land | Touching bark at cruise speed deflects it by design | Hold `Shift` (landing mode: it flares and is drawn to a branch ahead, a green reticle marks the target) and let it touch; a slow touch lands it too |
| `Space` makes the ant, spider or snake not jump | Crawlers cannot jump; only the jumping spider can | Ant and snake: hold `Space` to reach. Spiders: `X` for silk. Or switch to a lizard, cat or jumping spider (`2`, `1`) |
| My jump lands nowhere | Aiming: the preview arc is orange when it would land on nothing | Hold `Space`, turn with `A`/`D`, tilt with `W`/`S` until the reticle is white or green, then release |
| `X` does nothing | Only the spider and jumping spider spin silk, and only from a surface (not in the air or while aiming) | Press `1` until you are one of them |
| My silk threads are gone | Threads live only until the page reloads; they are never saved | By design |
| `B` does nothing | You are on a silk thread, a dialog is open, or focus is in a text field | Step onto a real branch; click the canvas first |
| A branch property I typed in a label has no effect | Garbage or non-finite values are ignored and the calculated value is used (numbers outside the range are clamped) | Check the label name (`biblio_blen`, `biblio_bthick`, `biblio_btaper`, `biblio_bspin`, `biblio_bpitch`, `biblio_bat`, `biblio_bbend`, `biblio_species`) and use a plain number |
| Saving a branch property says "That property was changed elsewhere" | The label changed in Trilium after the tree was loaded (conflict check) | Close the panel (`B`), refresh, reopen it |
| A pinned leaf (`biblio_lat`) overlaps another | Unpinned leaves keep their automatic slots | Pin the neighbour too, or move the pin |
| A bee or dragonfly lands when I did not want to | `autoLand`: touching any branch lands it | Fly clear of the bark |
| All leaves are the same size | Sizes are measured lazily after the tree opens, only for text, markdown and code, and only up to 400 fetches; a note without a `blobId` is never cached | Wait a moment; image and file notes stay at size 1 |
| The tree is cut off or has "missing" rooms | The 400-note / depth-8 walk caps | See above |
| Slow frame rate | Voxel bark costs about 3 to 5 thousand cubes per branch | Press `L` for low-poly, `P` for the pixel mode, use a smaller window |
| `T` or other keys do nothing | Typing in an input, a dialog is open, a modifier key is held, or (for `T`) the tree is not loaded yet | Close the dialog and try again |

## Mock, tools and tests

| Symptom | Cause | Fix |
|---|---|---|
| Search on the mock answers 500 `Maximum call stack size exceeded` (or DELETE of some notes) | An invalid `POST /branches` (clone cycle or missing parent) corrupted Trilium's in-memory tree | `docker restart bibliotheca-trilium-mock` (token survives). Never send those to the real mock; the fake refuses them |
| `PUT /notes/:id/content` answers 500 "Cannot set null content" | Only `text/plain` and `application/octet-stream` are read | Use one of those; binary notes: create with `content: ""`, then PUT |
| `SecurityError: localStorage` in the browser test | Playwright replays `addInitScript` in every frame, including the sandboxed book iframe | Guard the init script with try/catch (it is) |
| Browser test cannot find Chromium | Nothing in `.playwright-browsers`, no `CHROME_PATH` | Download on the **host** (the dev container's firewall blocks the CDN); see [Testing](Testing.md) |
| The browser test skips the tree steps | Only the headless shell launched (no WebGL) | Needs the full Chromium and the libcups stub |
| `tree-shots` times out or crawls | Software GL; each shot can take many seconds | One scenario at a time, smaller `W`/`H`; see [Testing](Testing.md) |
| `npm test` wiped my mock data | `check.sh` runs `trilium-bootstrap.sh --recreate` (volume wipe) | By design. Use the non-destructive subset instead |
| `seed-vault` refuses my server | It only talks to the mock in `.bootstrap.env` or an etapi-fake | Correct behaviour; never bypass it |
| `npm run test:mock` says the real part was skipped | `.bootstrap.env` or the mock is missing/down | Optional; start the mock to include it |

Still stuck? `AGENTS.md` has the long-form "Gotchas (symptom to cause)" section, and the browser console shows the real error.
