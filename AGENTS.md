# AGENTS.md — trilium_bibliotheca

A bibliography tool for **Trilium Notes**. React + Phaser.
Formerly `SiYuan-biblio-plugin` — **SiYuan is abandoned.** SiYuan assumptions
found in this repo are stale. Trilium is the target.

This file is **self-contained.** Do not assume `/workspace/AGENTS.md` was loaded:
when your cwd is inside this project, the nearest local file is the one that
applies.

## Architecture — decided. Do not change unilaterally.

Trilium has **no plugin SDK** — no manifest, no registry, no extension API.
What exists:
- **Code notes** — JavaScript notes executed inside Trilium
- **`#run=frontendStartup`** — the label that makes a UI extension persist
- **Custom widgets** — the sanctioned way to inject UI
- The **Script API is experimental** and may change without notice.

Therefore:
1. The deliverable is a **standalone React + Phaser web app talking to Trilium's
   ETAPI** (REST). A separate service, not a Trilium extension.
2. A widget wrapper is a **later, thin layer** that loads the built bundle. Do not
   build a "plugin framework". Do not design for the widget case first.
3. If you think an architecture change is warranted: **propose it and wait.**

Rationale: ETAPI is a stable documented contract, testable against a disposable
instance you fully control, with a fast dev loop. The Script API is unstable and
slow to iterate against. Build on the stable thing.

## Integration — Trilium

**There is no shared mock. Stand up your own Trilium inside DinD.**

Every Trilium instance on this machine is in real use. Never touch them — and you
have no route to them anyway. Run a disposable Trilium container in the DinD daemon
instead. It is yours to break, wipe, and recreate.

### Bringing it up
- Put it in `compose.yml` at the project root, alongside your app, so both share a
  DinD network and can address each other by service name.
- Publish its port **inside 31000–31099** (suggested `31090`) so it is reachable
  from this container at `http://dind:31090`.
- Back it with a named volume or project-local bind mount so a restart does not
  wipe test data. Delete the volume for a clean slate.
- **Verify the image name and tag against the official docs before writing it into
  `compose.yml`.** Do not guess it, and do not trust an image reference from memory.

### Auth — the part that actually bites
ETAPI is token-authenticated, and a **fresh instance has no token**. The token
cannot be minted without authenticating first, so the bootstrap order matters:
1. Start Trilium.
2. Set its password (first-run onboarding, or whatever the docs specify for
   headless setup).
3. Obtain a token — either `POST /auth/login` with that password (the headless
   path, and the one to script), or by hand in the web UI under **Options → ETAPI**.
4. Store it as an env var, then run integration tests.

Work this sequence out and write it down here. It is the single most annoying part
of this project, and re-deriving it costs a session every time.

Send the token in the `Authorization` header, bare or `Bearer`-prefixed.
**Probe `/etapi/app-info` first: `401 NOT_AUTHENTICATED` means the endpoint is alive
and expects a token — that is the expected response, not a bug to fix.** With a
valid token it returns app metadata; that is your green light.

### Reaching things — the three-hop model
- Container-to-container **inside DinD**: by compose service name.
- From **this** (opencode) container to a DinD-published port: `http://dind:<port>`.
- From the **host/laptop**: `http://<host-ip>:<port>`.

Use the right hop. A `200` from the wrong one may be someone else's service.

### Rules
- **Never** point tests at a real Trilium instance.
- **Load the `trilium-etapi` and `trilium-scripting` skills before writing any
  Trilium code** (`~/.config/opencode/skills/`). Do not guess at endpoints.
- `trilium-scripting` covers the widget/Code-note layer, which is **later**. Do not
  start there.
- Record every ETAPI endpoint you actually verify, with its response shape, in this
  file. Undocumented guesses are how this project stalls.

## Commands

- Install: `npm install`
- Dev server: `npm run dev` → http://localhost:31085 (port pinned in vite.config.ts)
- Build: `npm run build` (tsc + vite)
- Full verification: `npm test` → runs `tools/check.sh`
- Trilium mock lifecycle: `tools/trilium-bootstrap.sh` (start/ensure token),
  `--recreate` (wipe volume + full bootstrap), `--down`
- Seed demo content: `node tools/seed-demo.js` (idempotent)
- ETAPI integration assertions: `tools/etapi-probe.sh` (needs `.bootstrap.env`)
- Browser pass: `node tools/browser-test.js` (seeds its own vault; needs
  `.bootstrap.env`; uses odd-arcade's playwright-core + the shared
  `~/.cache/ms-playwright` chromium)

## Ports (claimed)

- 31085 — vite dev server (this project)
- 31086 — vite preview (build check)
- 31090 — Trilium mock (compose.yml), published through DinD
- (odd-arcade still owns 31080.)

## Verified ETAPI contract (v0.106.0, live instance)

All verified with `tools/etapi-probe.sh` against the disposable mock. The
authoritative spec: `apps/server/src/assets/etapi.openapi.yaml` in
TriliumNext/Trilium (v0.106.0). Base path `/etapi`, auth via `Authorization`
header (bare token, or `Bearer`-prefixed, or Basic with user "etapi").

| Endpoint | Verified behaviour |
|---|---|
| `GET /etapi/app-info` | 401 `{status,code:"NOT_AUTHENTICATED",message}` without token (expected!), 200 `{appVersion:"0.106.0",dbVersion:240,syncVersion:39,buildDate,...}` with |
| `POST /etapi/auth/login` `{password}` | 201 `{authToken}` — no auth needed; 429 blacklists the IP on too many attempts |
| `GET /etapi/notes/{id}` | Note: `{noteId,title,type,mime,attributes:[{attributeId,noteId,type:"label",name,value,position,isInheritable}],childNoteIds,parentNoteIds,...}`; `childNoteIds` is in tree order |
| `GET /etapi/notes/{id}/content` | raw content as text (HTML for text notes), Content-Type = note mime |
| `GET /etapi/notes?search=…` | `{results:[Note…]}` — full-text search |
| `POST /etapi/create-note` `{parentNoteId,title,type,content,…}` | 201 `{note:Note,branch:Branch}` |
| `DELETE /etapi/notes/{id}` | 204 |
| `POST /etapi/attributes` `{noteId,type:"label",name,value}` | 201/200 Attribute with `attributeId` |
| `PATCH /etapi/attributes/{id}` `{value}` | 200 Attribute |
| `DELETE /etapi/attributes/{id}` | 204 |

Not needed so far (documented in spec): branches CRUD, attachments,
revisions, day-notes, backup, metrics, note content PUT.

## Auth bootstrap (headless, verified — do not re-derive)

A fresh instance has NO password and NO token. The v0.106 flow (SPA-driven
since the old `#setup` page is gone — `/setup` 404s with a view-lookup error):

1. `GET /api/setup/status` → `{"isInitialized":bool,...}` (the SPA calls the
   same thing `dbInitialized`; the wire field is `isInitialized`)
2. If not initialized: `POST /api/setup/new-document?skipDemoDb` JSON
   `{locale:"en"}` → 204
3. `POST /set-password` — a plain HTML form POST (`password1` & `password2`,
   form-encoded, NOT JSON) → 302. Re-posting on an initialized instance is
   harmless (302 again).
4. `POST /etapi/auth/login` JSON `{password}` → 201 `{authToken}`

All of this is implemented in `tools/trilium-bootstrap.sh` (idempotent:
valid-token check → password login → full setup, in that order).

## Gotchas (symptom → cause)

- **Label created as `biblio.x` comes back as `biblio_x`** — Trilium
  normalises attribute names and strips dots. Use underscore names from the
  start (config.LABELS does).
- **A mystery door named "Hidden Notes" in the Library room** — that's
  Trilium's internal `_hidden` subtree; the walk skips it explicitly
  (library.ts).
- **App crashes in `StaticGroup.clear` after a React remount** — Phaser's
  `game.destroy()` is deferred to its next step, so per-scene-create event
  handlers outlive the scene. Fix: module-level handlers that forward to
  `BibliothecaScene.current` (see bottom of BibliothecaScene.ts). Do not
  register bus handlers inside `create()`.
- **`SecurityError: localStorage` in the browser test** — Playwright replays
  `addInitScript` in every frame, including the sandboxed book iframe where
  localStorage is inaccessible. Guard the init script with try/catch.
- **Player can't interact with the door at the wall** — world bounds stop
  the player ~40px short; INTERACT_RANGE (46) must exceed that. If you
  change room size, re-check this.
- **Browser can't reach ETAPI even though curl works** — CORS: the instance
  must set `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN` (+ methods/headers), since
  v0.93.0. compose.yml sets `*` for the mock only.
- **`/setup` returns "Failed to lookup view"** — expected on v0.106; the
  setup flow is SPA-driven (see bootstrap above).

## Networking (DinD)

- Spawned services publish **only within ports 31000–31099.** Ports claimed
  here: 31085 dev · 31086 preview · 31090 Trilium mock. odd-arcade owns 31080.
- Low host ports may already belong to another service. Do not trust a `curl`
  returning `200` — it may be someone else's app. Verify by content, not code.
- Reach published containers through the **`dind` service**, not a host or
  gateway IP: container-to-container by compose service name, from here via
  `http://dind:<port>`, from the host via `http://<host-ip>:<port>`.

## Safety

- `/workspace` is a bind mount with **no undo** — no trash, no snapshot.
- Commit before a move, restructure, or bulk edit.
- **Never `rm -rf` a path you haven't listed first.** Print the target, then delete.

## Verification — prove it, don't assert it

Follow the `odd-arcade` pattern: a `tools/check.sh` running real checks, all green
before you call anything done. Implemented:

- `types + build` — tsc strict + vite build
- `trilium mock from scratch` — compose down **with volume wipe**, bootstrap
  from zero (setup → password → token), proving the setup is reproducible
- `browser pass` — real headless Chromium against the fresh mock: world mounts,
  vault walks, search opens a book, overview toggles, **zero console errors**
- `etapi integration` — every endpoint above asserted live (create/read/patch/
  delete included)

`node_modules/`, `shots/` (screenshots) and `.bootstrap.env` (mock credentials)
are gitignored. Do not commit them.

## Git

- Work on **feature branches**. Never commit directly to `main`.
- Never `git push --force` or `git push -f`.
- Never commit `node_modules/`.
- Push **feature branches only**. Pushing `main`/`master` is blocked by policy —
  that is intentional. Do not work around it.

## Maintaining this file

Update it when you learn something a future session would need. Keep it short —
instructions, not a changelog. Record gotchas with the **symptom**, not just the
fix, so they are findable.