# AGENTS.md — Trilium-Bibliotheca (repo: Lauruin/Trilium-Bibliotheca)

> Human-oriented guides (getting started, views, animals, trilium mapping, testing, troubleshooting, roadmap): `wiki/Home.md`. Script reference: `tools/README.md`.

A bibliography tool for **Trilium Notes**. React + Phaser.
Formerly `SiYuan-biblio-plugin` — **SiYuan is abandoned.** SiYuan assumptions
found in this repo are stale. Trilium is the target.

**Branch layout (as of 2026-10):** `main` = planning docs only (the user
merges; we never push it). `devbranch` = integration branch — feature
branches like `build/bibliotheca-client` land here via fast-forward push,
the user merges into `main` when satisfied. Implementation notes below were
written against the code now living on `devbranch`.

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
- Publish its port (this project: `8080`) so it is reachable from this container
  at `http://dind:8080`, and — if the sidecar publishes it — from the host browser at
  `http://localhost:8080` (see Networking).
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
- **Load the `trilium-etapi` skill before writing any Trilium code.** Claude Code:
  `.claude/skills/trilium-etapi/SKILL.md` (in this repo). opencode: your
  `~/.config/opencode/skills/`, or just read that same file. Do not guess at endpoints.
- A `trilium-scripting` skill (widget/Code-note layer) is **not written yet** and
  that layer is **later**. Do not start there.
- Record every ETAPI endpoint you actually verify, with its response shape, in this
  file. Undocumented guesses are how this project stalls.

## Commands

- Install: `npm install`
- Dev server: `npm run dev` → http://localhost:5173 (port pinned in vite.config.ts)
- Build: `npm run build` (tsc + vite)
- Full verification: `npm test` → runs `tools/check.sh` (⚠ recreates the mock: wipes its data)
- **Host the app**: `docker compose up -d --build bibliotheca` →
  http://dind:8081 (multi-stage build: node build stage → nginx serving the
  static bundle; stateless, read-only rootfs, healthchecked)
- Re-run the browser suite against the hosted container instead of vite:
  `APP_URL=http://dind:8081 node tools/browser-test.js`
- Trilium mock lifecycle: `tools/trilium-bootstrap.sh` (start/ensure token),
  `--recreate` (wipe volume + full bootstrap), `--down`.
  `BOOTSTRAP_SERVICES=trilium` starts only the mock (skips the `bibliotheca-web`
  image build). It was needed while the devcontainer dind sidecar had no DNS for
  nested containers; that is fixed (dnsmasq forwarder + `--dns=172.17.0.1`), so
  the full `npm test` / `docker compose up -d` works there too.
  Mock login password: `biblio-test-pw` (disposable; override with
  `BIBLIOTHECA_TEST_PASSWORD`).
- Seed content: `node tools/seed-vault.js [profile]` (the big one, see "Trilium mock" below), `node tools/seed-demo.js`
  (tiny), `node tools/seed-rich.js` (hand-made, varied; uses calendar/day-note endpoints the fake lacks). All idempotent.
- Unit tests: `node tools/unit-test.mjs` (18 sections + the per-feature `tools/unit-*.mjs` files, ~10 s, no network; `unit-host.mjs` covers hosted-mode config + the AI client; `unit-shrine.mjs` / `unit-save.mjs` / `unit-look.mjs` cover the shrine, wisp, star junction, world tree + crown, the save and the camera steering / threads; `unit-reader.mjs` covers media sniffing / planning, embedded pictures, note paths, the reader document and the leaf papers). Mock tooling tests: `npm run test:mock` (= `node tools/mock-test.mjs`,
  non-destructive; real mock optional; 33 checks with `--no-real`, ~2 s; NOT part of `npm test`).
- 3D screenshots: `node tools/tree-shots.js [scenario...]` (see "Yggdrasil tree view"). Every script: `tools/README.md`.
  Docker-free ETAPI: `npm run mock:fake -- --seed medium` (see "Trilium mock").
- ETAPI integration assertions: `tools/etapi-probe.sh` (needs `.bootstrap.env`)
- Hosted-mode test: `npm run test:proxy` (`tools/proxy-test.mjs [--no-build] [--browser]`; builds the image, needs docker + the mock; see "Hosted mode + AI proxy").
- Browser pass: `node tools/browser-test.js` (seeds its own vault; needs
  `.bootstrap.env`; it WRITES into the mock: a "Bibliotheca Demo" room + the Inbox stay behind). Chromium lookup order:
  `CHROME_PATH` if set; else the FULL chrome `.playwright-browsers/chromium-*/chrome-linux64/chrome` with SwiftShader GL
  (so the WebGL tree steps run; see "WebGL in the dev container"); if that does not launch, the headless shell
  `.playwright-browsers/chromium_headless_shell-*/…/chrome-headless-shell` (no WebGL, tree steps skipped) — both downloaded on the HOST,
  gitignored — then odd-arcade's `~/.cache/ms-playwright`. If the image lacks Chromium's system libraries,
  extracted .debs in `.playwright-libs/root` (gitignored) are added to
  `LD_LIBRARY_PATH` automatically. Download on the host with
  `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work -w /work
  -e PLAYWRIGHT_BROWSERS_PATH=/work/.playwright-browsers node:22-bookworm
  npx playwright install chromium` (the dev container's firewall blocks the
  Playwright CDN).

## Trilium mock — real mock, fake, vault generator (`tools/`)

Three pieces, one generator (`tools/lib/vault-gen.mjs`), all non-destructive to anything but their own subtree:
- **Real mock** = the disposable Trilium in docker (`tools/trilium-bootstrap.sh`, credentials in `.bootstrap.env`,
  `http://dind:8080`). Fill it with `node tools/seed-vault.js [profile]` (default `medium`; `--seed N`, `--clean [profile]`,
  `--list`). It builds ONE top-level note `Mock Vault (<profile>)` (deleted and rebuilt each run; the
  note sits last under root), 8 requests in parallel, progress shown, then verifies by walking what the server holds.
  It refuses any URL that is not the one in `.bootstrap.env` (or an etapi-fake, recognised by `app-info.buildRevision`).
  The `medium` vault is left in the mock for browsing (app: server `http://localhost:18080`, root note `root`).
- **Fake** = `tools/etapi-fake.mjs`, an in-memory ETAPI server (node:http only) so tests and development run WITHOUT docker:
  `npm run mock:fake -- --seed medium [--port N] [--vault-seed N] [--markdown-type]` prints `TRILIUM_URL=` / `TRILIUM_TOKEN=`
  (login password `biblio-test-pw`; it never touches `.bootstrap.env`). In-process: `startFake({seed, port, ...})` -> `{url, token,
  store, close()}`. Implements app-info, auth (bare/Bearer/Basic token, `/auth/login` + logout), notes GET/PATCH/DELETE, content
  GET/PUT, `GET /notes?search=` (words, `#label[=v]`, `~rel`, `note.<prop> op v`, and/or, archived hidden, `ancestorNoteId`, `limit`,
  `fastSearch`; header of the file lists the subset), create-note, attributes, branches (clones), CORS + preflight, the real
  `{status, code, message}` errors, content-hash `blobId`s, inheritable labels with the OWNER's `noteId`, name normalisation.
  Not implemented: `not(...)`, revisions, calendar/day notes, backup, import/export (attachments ARE implemented, see the ETAPI table). Deliberate differences: it refuses
  clone cycles and parent-less branches (see Gotchas), result order is tree order, ids come from a seeded PRNG.
- **`tools/mock-test.mjs`** (`npm run test:mock`, ~3 s): one conformance suite runs against the fake (spawned on a free port) AND
  the real mock (skipped with a note when `.bootstrap.env` or the mock is missing; `--no-real` forces that) and the recorded shapes,
  error bodies, default mimes, header values and search results must be identical. Real part touches only its scratch subtree
  `zz mock-test ...` (deleted afterwards), no logout, no root labels; real login only with `--real-login`
  (the real server rate-limits logins: 10 per window). Then fake-only: profile counts, determinism, depth/width, label coverage, values
  the app understands (`themes.ts`/`decor.ts`), content hygiene, HTTP apply == in-memory load, the app's own `walkLibraryTree` /
  `captureNote` on the fake, the walk caps, the CLIs and seed-vault's refusals.

**Profiles** (`PROFILES` in `vault-gen.mjs`; `node tools/seed-vault.js --list` prints the real numbers):

| profile | notes | shape |
|---|---|---|
| `small` | 40 | every theme in miniature, depth 4 |
| `medium` | 160 | believable personal vault, depth 4, widest folder 13; fits the walk caps |
| `large` | 600 | past `TREE_WALK.maxNodes` (400): the BFS stops at ~400 notes (batches of 8 may overshoot a few) |
| `huge` | 1500 | past both caps, depth 17, a 34-wide folder |
| `deepchain` | 76 | 25 nested folders (+2 notes each): past `TREE_WALK.maxDepth` (8) |
| `widefan` | 182 | one folder with exactly 150 children (notes + 10 small folders) |
| `longtail` | 46 | text/code/markdown notes from 0 chars to 200 000 (leaf sizes; the `len` label holds the exact length) |

Balanced profiles (small..huge) are themed: Projects (inheritable `#workspace`, `#project`, `#status`, uppercase `#Priority`,
`blockedBy` relations), Reading list (`#book #author #year #rating`, Favourites = clones, `relatedTo`), Recipes, Journal (year / month /
day, `#dateNote`), Research (papers, `cites` relations, mind maps, mermaid, a saved search), Code snippets (language folders with an
INHERITABLE `#lang`), Meeting notes, Ideas (incl. the "Attribute zoo": odd names/values), Archive (`#archived` + a deepening chain), Media &
files (valid PNGs, a tiny PDF, csv/txt/json), Wiki (internal `#root/<id>` links). Note types: text, code (+ markdown as `code` with mime
`text/x-markdown`, because ETAPI has no `markdown` type; `--markdown-type` sends `markdown` to the FAKE only, so the maple leaf can be
tried), canvas, mermaid, mindMap, image, file, search. A few rooms carry our `biblio_*` layout labels (wing, theme, wall, furniture, rug,
case, span, x/y) and a few leaves `#biblio_leaf`. Everything is deterministic (`(profile, seed)` -> identical specs); the word lists never
produce "hello" (browser-test searches for it) and the vault never carries `#biblio_inbox` (quick capture's marker).

**What the app does with the big ones** (`config.TREE_WALK`, `library.ts`): `walkLibraryTree` is a BFS from the root note with at most
400 fetched notes and depth 8; the queue is processed in batches of 8, so the count lands in 400..407. Notes beyond the node cap are simply
absent (not lazily loaded: the "fetched on demand" wording in `config.ts` is aspirational); a note at depth 8 is kept with its children not
fetched. Either cut sets `tree.truncated`, which shows the toast "Vault larger than the walk cap". Since the app walks from `root`, the
other top-level notes of the mock compete for the same 400 nodes.

**Add a profile:** an entry in `PROFILES` (`{size}` = balanced, or `{stress: "name"}` plus a `buildName(ctx, vaultRoot, budget)` in
`vault-gen.mjs`; builders create notes with `ctx.mk(budget, parentKey, spec)` and must use their whole budget), then add it to the
expectations in `mock-test.mjs` (size, depth/width). New label/relation/clone kinds go in the generator so both the fake and the real
mock get them.

**Caveats (symptom -> cause):**
- **Search on the real mock answers 500 `Maximum call stack size exceeded` (also on DELETE of some notes) after a test run** — an
  invalid `POST /branches` corrupted Trilium's in-memory tree: a clone cycle (`noteId` = a descendant or itself) or a missing
  `parentNoteId` (the request answers 400/500 but the cache keeps a broken branch). The DB is fine: `docker restart
  bibliotheca-trilium-mock` (the token survives). A cycle can also be removed with `DELETE /branches/<parent>_<note>`. Never send
  either to the real mock; the fake refuses both.
- **`POST /etapi/auth/logout` on the mock kills the token in `.bootstrap.env`** for every agent using it; re-run
  `tools/trilium-bootstrap.sh` (mints a new one) and tell the others. Logins are rate-limited (`X-RateLimit-Limit: 10`, successful ones
  count): don't loop on `/auth/login`.
- **`PUT /notes/:id/content` answers 500 "Cannot set null content"** — only `Content-Type: text/plain` (text/code) and
  `application/octet-stream` (binary) are read; `text/html` fails, `application/json` fails with another 500. Binary notes: create with
  `content: ""` (a mime), then PUT the bytes.
- Real-server quirks the fake copies: own attributes are listed in creation order (a PATCH of `position` does not reorder), inherited ones
  after; `GET /notes?search=` with `ancestorNoteId` includes that note itself; archived notes are excluded unless `includeArchivedNotes=true`;
  `=` compares case-insensitively; an unknown `note.<prop>` matches everything; parentheses and bare words after `and` are NOT understood by
  the real search (the fake is more forgiving there; don't rely on them); default mimes: text `text/html`, code `text/plain`, mermaid
  `text/vnd.mermaid`, canvas/mindMap/relationMap `application/json`, file `application/octet-stream`, image/search/book/render/webView
  empty; an untitled create-note becomes "New note"; same content = same `blobId`.
- `seed-rich.js` / `seed-demo.js` stay as they are (small, hand-made); `seed-vault.js` only ever deletes `Mock Vault (...)` notes.

## Ports (claimed)

- 5173 — vite dev server (this project)
- 4173 — vite preview (build check)
- 8081 — **hosted app container** (`bibliotheca-web`, compose.yml, nginx)
- 8080 — Trilium mock (compose.yml), published through DinD

## Hosted mode + AI proxy (nginx, `docker/`)

The container is the plain static app unless configured. `docker/30-biblio-config.sh` runs from nginx's official `/docker-entrypoint.d/` (as root, before nginx starts), validates the environment against strict character sets (a bad value stops the container with a message: config injection is the risk, the values land in nginx config) and renders into the `/tmp` tmpfs (rootfs is read-only): `/tmp/conf/http-biblio.conf` (resolver, AI rate-limit zone), `/tmp/conf/server-biblio.conf` (mode 600, holds the SECRETS) and `/tmp/config.json` (what the browser may know; never a secret). `docker/nginx.conf` includes `/tmp/conf/http-*.conf` / `server-*.conf` and serves `location = /config.json`.
- Variables (compose maps `BIBLIO_*` from `.env` to these): `TRILIUM_URL`, `TRILIUM_TOKEN`, `TRILIUM_READONLY`, `TRILIUM_ROOT_NOTE_ID`, `TRILIUM_NAME`, `TRILIUM_PUBLIC_URL`; `AI_PROVIDER` (`anthropic` | `openai-compatible`), `AI_BASE_URL`, `AI_KEY`, `AI_MODEL` (anthropic default `claude-haiku-5-5`).
- `/etapi/` is proxied with `Authorization` replaced by the token (and `Cookie` cleared), `/etapi/auth/*` is 403 (nobody behind the SSO can mint / kill tokens), read-only = `limit_except GET HEAD OPTIONS`. `/ai/v1/messages` (anthropic: `x-api-key` + `anthropic-version`) or `/ai/chat/completions` (Bearer, optional): POST only, 30 r/min per IP (burst 8), 1 MB bodies, nothing else under `/ai/`.
- App side: `lib/serverconfig.ts` (`fetchServerConfig`, `parseServerConfig`, `chooseSettings`: the user's own stored server always wins over the host's; a stored `proxy: true` marker follows the host), `Settings.proxy`, `store.getClient` (`baseUrl: ""`, no token, `readOnly` from the host), `TriliumClient` `readOnly` (every write throws `TriliumApiError(403, "READ_ONLY")` before any request), `ui/SettingsModal.tsx` host box. `lib/ai/` = the provider-neutral AI client (`createAiClient(cfg).ask({system, user, schema, validate})` -> `{ok, data}` | `{ok: false, reason: refused|invalid|http|network|aborted|timeout}`; Anthropic adapter = `@anthropic-ai/sdk` lazy-loaded with `baseURL: <origin>/ai`, placeholder key, `output_config.format` json_schema, `effort: "low"` only on 5.x models, no temperature/top_p/tools, `stop_reason: "refusal"` surfaced; the other = plain fetch with `response_format: json_object`), `lib/ai/prompt.ts` (`wrapUntrusted`: note text is DATA: control chars stripped, `<note>` delimiters defanged, capped at 6000 chars; `parseJsonLoose`). Labels `biblio_learn` (inheritable opt-in for any learning mode) and `biblio_noai` (never send) are defined in `config.LABELS` and only READ.
- Gotchas (symptom -> cause): `docker build` here uses the legacy builder, so `COPY --chmod` fails (use `RUN chmod`); busybox `grep -E` rejects `{8,512}` (max 255); the entrypoint's complaint is on stderr and exit code 1: `docker logs` shows it; `localhost` in these containers is ::1 first (healthcheck uses 127.0.0.1); `public/config.json` (`{"server":null,"ai":null}`) is the dev / plain default, because without it the vite dev server answers a JSON request for `/config.json` with a 404 that the browser test counts as a console error; in the container nginx's `location = /config.json` serves the rendered file instead (the app also requires a JSON content type, so an index.html answer = no host config).
- Tests: `tools/unit-host.mjs` (parse/choose/fetch, read-only client, AI client vs fake providers) and `npm run test:proxy` (`tools/proxy-test.mjs`, builds the image, 23 checks vs the mock; `--browser`, `--no-build`).

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
| label names (probe) | `biblio-Probe.Case` → stored `biblio_Probe_Case`: dots/hyphens become `_`, **case is kept** (the app reads names lowercased and matches case-insensitively) |
| inheritable labels (probe) | an `isInheritable` label on a parent is listed on every descendant **with the owner's `noteId`** — only labels whose `noteId` equals the note's own id are its own (`toNoteInfo` filters; `setLabel` re-checks before PATCH/DELETE) |
| label on `root` (probe) | accepted — library-wide `biblio_wing` lives on the root note |
| `GET /etapi/notes/{id}/content` of an `image` / `file` note (probe) | raw BYTES with `Content-Type` = the note's mime (`image/png`, `application/pdf`), `Content-Disposition: attachment; filename="<title>.<ext>"`; read it with `res.blob()`, never `res.text()`. Create such a note with `content: ""` + the mime, then `PUT .../content` (`application/octet-stream`) |
| `POST /etapi/attachments` `{ownerId, role, mime, title, content?, position?}` (probe) | 201 `{attachmentId, ownerId, role, mime, title, position (10), blobId, dateModified, utcDateModified}` (no `contentLength`); any `role` accepted (`image` for pictures embedded in a text note, `file`); content may be empty. No `ownerId` -> 500 GENERIC `Missing owner ID.`; unknown owner -> 400 PROPERTY_VALIDATION_ERROR; unknown property -> 400 PROPERTY_NOT_ALLOWED |
| `GET /etapi/attachments/{id}` · `GET /etapi/notes/{id}/attachments` (probe) | the attachment with `utcDateScheduledForErasureSince: null` and `contentLength`; the note's list is a BARE ARRAY ordered by position. Unknown id -> 404 `ATTACHMENT_NOT_FOUND` `Attachment 'x' not found.`; list of an unknown note -> 404 NOTE_NOT_FOUND |
| `GET /etapi/attachments/{id}/content` · `PUT` (probe) | bytes with `Content-Type` = the attachment's mime (`text/plain; charset=utf-8` for text mimes); `PUT` only `text/plain` / `application/octet-stream` -> 204, a JSON body -> 500 GENERIC. `PATCH` accepts role, mime, title, position only; `DELETE` is 204 even for an unknown id; deleting the owner note deletes its attachments. The editor embeds a picture as `<img src="api/attachments/<id>/image/<title>">` and the server keeps that HTML as written |

Also verified by `tools/mock-test.mjs` (see "Trilium mock"): `POST/GET/PATCH/DELETE /branches` (clones: 201 new, 200 for an existing
pair; `branchId` = `<parent>_<note>`), `GET /attributes/{id}`, `PATCH /notes/{id}` (`title`/`type`/`mime`), `PUT /notes/{id}/content`
(`text/plain` or `application/octet-stream` only), CORS preflight, the error envelope for every failure class.
Not needed so far (documented in spec): revisions, day-notes, backup, metrics.

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

- **nginx container `unhealthy` + `[emerg] mkdir() "/tmp/nginx/client_body"`
  while the app serves fine** — two stacked causes: (a) nginx mkdir()s only
  the LEAF temp dir, so a nested path like /tmp/nginx/client_body dies when
  /tmp/nginx doesn't exist (fresh tmpfs); (b) the healthcheck targeted
  `localhost`, which resolves to ::1 here while nginx listens IPv4 only.
  Fixes: flat temp paths (/tmp/client_body…) in docker/nginx.conf and
  `wget http://127.0.0.1/` in the Dockerfile HEALTHCHECK.
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

## Yggdrasil tree view (`src/tree/`, the START view of the app, prototype page `lizard3d.html`)

The vault as a TREE you climb as an animal, in two switchable looks: **voxel** (default) or **low-poly**
(plan: `/workspace/knowledge-planning/next-directions.md`, Addenda 2-7).
- **Pure, unit-tested** (sections 11-21 of tools/unit-test.mjs): `world3.ts` (3D branches as rails: surface coords
  `(branch, s, th)`, rotation-minimising frame, `th=0` = top, `surfacePoint`, `nearestOnBranch`; side branches via
  `attachS`; `World.groundY` = ground height; `isTerminal`), `wave.ts` (wave shapes), `forest.ts` (forest placement + ground-root geometry), `sim3.ts` (creature = data `Animal`: steered HEAD, body trails the head,
  procedural feet, leaps relative to the SURFACE normal, grip -> slip, `shake`, cat `maxTh`, mid-branch junctions need
  junctions: an ordinary side branch is entered AUTOMATICALLY walking tip-ward in its base zone, **Shift** = stay; silk threads: Shift climbs in; ground roots of a stump: walking DOWN takes them (star junction); `climbTarget` = which side branch you are standing in the base of). Rules worth knowing:
  - **Grip is decided by WORLD gravity, not by the branch's own frame:** a surface point hangs when its outward normal
    points down (`n.y < -0.12`); drain = `0.58 x k^2` per second with `k = (-n.y - 0.12)/0.88`, so a vertical trunk
    (n.y ~ 0 all round) never drains, a branch leaning 15 degrees past vertical drains ~0.015/s even on its very
    underside (climbable for minutes), a full underside slips in ~2 s; the top refills. Never use `th` against the
    branch's `u` axis for this (on a near-vertical branch it is arbitrary: that was the "I fall off the main trunk" bug).
    Single-point animals use the head's normal; the **snake** (`bodyGrip`) drains only when NO sampled body part is on
    top (`bodyOnTop(world, c)`; the head alone hanging costs nothing); **`clings`** animals (spider, jumping spider) never drain; a reaching animal
    without `bodyGrip` (the ant: its whole body leaves the branch) holds on by the spot it reached out from. `G` off
    = never slips. The cat keeps its `maxTh`.
  - **Move modes** (`Creature.moveMode`: `guided` | `free`; key **`M`** / the HUD button "move: guided/free", remembered in `biblio.v1.treeMove`; **guided is the app default**, `DEFAULT_MOVE_MODE`;
    the pure `spawn(world, animal, branch, s, moveMode = "free")` stays free, so every old sim test keeps its meaning and `TreeScene` passes its mode to every creature it spawns).
    **Guided** (`steerGuided` in sim3.ts, tuning in the exported `GUIDED`): while a creature WALKS on a branch the keys are read against the BRANCH, not the camera: **W** = tip-ward ("up the branch"),
    **S** = base-ward ("down"; continues onto the parent by the ordinary transfer: down a trunk into the hub or onto a ground root), **A/D** = turn left / right AS THE ANIMAL SEES IT (W+D bends right going up,
    S+D right going down; on a vertical trunk a sideways turn, on a horizontal branch a turn over the side). Semantics are along-branch, never world-up (a branch whose tip points down: W walks down the world).
    `phi` = angle from the branch axis in the unrolled surface (0 tip-ward, pi base-ward, + = right). The keys ask for a TARGET heading (W 0, S pi, A/D alone = the nearest axis +-`across` 1.35 rad at `creep`
    0.5 x speed = the animal goes round the bark, W/S + A/D = axis +-`bend` <= 0.75 rad, scaled by how well it already faces its way so a U-turn comes first; no key = straighten to the nearest axis at 0.6 x rate while
    standing) and the heading follows it with a smooth angular velocity: `Creature.omega` eases (`ease` 10/s) toward `clamp(4 x error, +-rate)`, `rate = animal.turnRate x 2.3 x clamp(1/fit, 0.55, 1)` (the free
    mode's width/radius rule with a floor 0.55 instead of 0.3, so a wide animal on a twig turns slower but never gets stuck), giving curves that start and end smoothly (no overshoot to speak of, no instant flip).
    A **U-turn** (error near pi) swings the way of the pressed A/D, else over the TOP side of the bark (the way whose surface normal rises: `upAround`), else the way it already leans; `Creature.swing` keeps that
    choice until the turn is nearly done so it never flips half-way. While the heading is far from the wanted one the animal slows hard (`turnSpeed` 0.15 + 0.85 x cos^3(error); slowing is immediate, speeding up eases), and
    it never goes round the bark faster than `thin` 1.6 rad/s x clamp(radius / (0.5 x animal width), 0.4, 1) (a 3 px twig under a lizard: a whole U-turn moves it 0.9 rad round the bark, it swivels instead of corkscrewing; unit-tested that 50 reversals do not accumulate a spiral). The U-turn side rule is relative to the way the animal faces (a swing that starts base-ward sweeps the other way round): a regression test starts at phi 0 and pi on both flanks and expects the swing to move toward the top. A residual heading under 0.03 rad snaps onto the axis (a lingering 0.01 rad corkscrewed long walks). Releasing everything straightens it along the axis (no residual spiral, no stuck
    sideways state); S held always turns the animal round within ~1.1 s (lizard 1.07 s, snake 1.13 s, cat 0.97 s, ant 0.57 s on a 30 px branch; thin twigs: the floor keeps it under 1.5 s). Speed = `animal.speed` for W/S,
    `creep` for A/D alone. At a tip W just stops, walking up past a side branch's base climbs into it (Shift = stay), grip / slip / cat `maxTh` / silk threads / ground roots all work as before. **Not touched by guided mode:** leap aiming (A/D/W/S
    keep their aim meaning, the animal stands still), reach (snake/ant), silk, flight (bee, dragonfly, jay), the squirrel glide (these states return before the steering). **Camera:** in guided mode the chase / level camera follows the heading through a rate limit (`TreeScene.travel`: `camFwd` turns at most `CAM_TURN` 1.7 rad/s, the level camera at most 2 rad/s), because the heading itself swings at up to ~5 rad/s: measured in the demo page (SwiftShader, 1 s U-turn on the log) the chase view yaw peaks at 2.7 rad/s (free mode's own turn: 2.0-2.4), the level view at 1.7, the camera stays 330-420 px from the animal and outside the trunk. **Auto-align (`H`) does nothing in guided mode**
    (the HUD button reads "n/a"); in **free** mode everything below is exactly as before. Measured (unit-move): peak turn rate lizard 2.9 rad/s on a thin twig / 5.1 on a thick branch, cat 3.3 / 5.9, snake 2.3 / 4.1, ant 3.8 / 6.6;
    U-turn of the lizard on a 40 px branch: 14 px ahead, 0.9 rad (35 px) sideways; A alone reaches the underside of a 40 px branch in 2.2 s (lizard), 6.5 s (ant).
  - **Steering on thin branches (free mode):** the surface turn rate is `turnRate x clamp(radiusAt / (2.2 x animal width), 0.3, 1)`
    (animal width = 2 x widest node half-width), so a wide animal on a twig turns gently instead of spiralling.
    **Auto-align** (`Creature.autoAlign`, default on, `H` toggles, FREE mode only): while moving and NOT pressing A/D the heading `phi`
    eases straight along the branch at 2.4 rad/s x `clamp(2.2 x width / radiusAt, 0.5, 2)` (thinner = faster), without
    overshoot; it aims at the nearer of phi=0 / phi=pi, so walking backwards down a branch stays backwards. Never while
    reaching, airborne or flying. Off = no correction at all (old behaviour; junction transfers then keep the sideways heading).
  - **Flight** (`Animal.flight`: bee, dragonfly = `hover`; blue jay = `wing`; `Creature.flight` while airborne, `flightBasis(c)`
    gives the renderer forward/up axes): **Space** on a branch takes off (head stays at the perch, trail gets `surf: null`
    samples); a perched flier otherwise walks. Hover: W/S fly along the heading (S at half speed), A/D yaw, **Space held**
    up, **Shift held** down, velocity eases to the input (stops within ~1 s of letting go); `bob` is a renderer-only
    wobble. Wing: always forward; W dives, S climbs (+-55 degrees), pitch eases back to a level glide when released;
    speed follows an energy model (dive -> up to `flight.speed` in ~2 s, climb bleeds to `stall` in ~2 s, nose drops
    below `stall`), **Space held** = flap (+`accel`, capped), A/D yaw scaled by speed, `bank` follows the yaw rate.
    Touching any branch lands (`autoLand`: bee/dragonfly yes, jay no — or **Shift** held, or the jay touching at < 1.4 x
    `stall`), else the flier is pushed out along the surface normal (never through bark); never below `groundY + 15`. The perch it took off from
    only lands it once the flier has **cleared** it (> radius + margin + 8 px; until then it deflects: an underside take-off with Space held no
    longer hops down and re-lands); a flier whose grip ran out (slip fall) can press Space to open its wings from the falling position (`startFlightFromFall`). Sim contract: `step()` returns early
    after `stepFlight`; sub-stepped at <= 20 ms; trail `D` grows with the distance flown (a motionless hover adds no samples).
  - **Blue jay landing mode** (wing flier, **Shift held**; `flightSub`): flares (speed eases to 1.15 x `stall`, no stall
    nose-drop), pitch eases to a gentle glide, and a TARGET MAGNET (`pickLandTarget`) picks the best spot on any branch
    within 400 px and +-45 degrees of the heading (a smaller turn, nearer, upper half preferred; the current target keeps a
    70-degree cone and a bonus so it doesn't flip) and steers yaw/pitch toward it (turn rate x1.6; manual A/D adds and
    dominates: the magnet is then a third as strong; W/S still nudge the pitch). Contact lands (existing rule).
    `Flight.landTarget = {b, p} | null` is updated every frame for the renderer (null outside landing mode / nothing
    ahead). Without Shift the jay still deflects off bark at cruise speed. Hover fliers are unchanged.
  - **Leap aiming** (`Animal.leap`: exactly lizard, cat, squirrel and the **jumping spider**; the crawlers ant / spider / snake never aim): **Space is press-and-hold to
    aim, release to leap** (`Creature.aim: Aim | null`, `{yaw, pitch, charge, t}`). A press on a surface starts the aim
    (`input.leap` is the edge, `input.reach` = Space held); while held the animal stands still (speed eases to 0, W does
    not move it), **A/D** turn `aim.yaw` (1.6 rad/s, clamp +-70 degrees, relative to the heading, + = right), **W/S**
    tilt `aim.pitch` (1 rad/s, clamp -0.35..+0.6, extra elevation over the default leap angle), `charge` grows 0.55 -> 1
    over 0.8 s and scales the WHOLE launch vector (full charge = the plain leap). **Release** launches along heading
    turned by `yaw` about the surface normal, elevation `atan2(leap.up, leap.speed) + pitch`. A tap (released within
    0.18 s, or a one-frame `leap` without `reach`) is a full-charge default leap (`charge` is 1 for the first 0.18 s,
    then dips to 0.55: the preview shows exactly what a release does now). **Shift** while aiming cancels (and Space +
    Shift never starts one). Airborne / reaching / flying states ignore it, so does a slip (grip loss drops the aim) or
    changing animals. `startLeap(world, c)` = a full default leap.
    **Aim assist** (always on, mild; `planLeap`): when the manual arc would not land on ANOTHER branch (hits on the branch
    you stand on, or within 3 x the animal's width of the launch point, don't count), it searches +-30 degrees yaw x
    +-0.25 rad pitch around the manual aim (9 x 5 grid, then two refinements) for an arc that does and takes the cheapest:
    smallest angular change, nearer, top half of the target (`|th| < pi/2`) preferred; never onto your own branch, never
    onto nothing/the ground. Manual A/D/W/S still moves the cone. **`leapPreview(world, c): Preview | null`** (null unless
    aiming) returns `{points (<= ~45; gliders every 8th step of 7 s), hit: {b, s, th, p} | null, assisted}` by simulating the
    SAME ballistics as `stepAir` (shared `airPhysics` + `airContact`, fixed 1/60 s steps, no glider steering) without
    touching `c`; the launch uses the same `planLeap`, so the preview never lies (the actual landing is checked against
    `preview.hit` in section 18). Cached per creature while its inputs don't change. Contacts use a per-world uniform
    grid of segment boxes (`branchGrid`, WeakMap-cached, rebuilt if the branch count changes) so a preview costs ~1-5 ms.
  - **Number keys = categories** (`ANIMAL_CATEGORIES`, `animalForKey(n, currentId)`): `1` crawlers (ant, spider, jumping spider, snake),
    `2` walkers (lizard, cat), `3` fliers (squirrel, bee, dragonfly, blue jay); pressing the same key again cycles through
    the category (from an animal outside it: its first); unknown key -> -1.
  - **Reach** (hold Space; **snake and ant**, they cannot jump): A/D yaw and W/S pitch the stretching head, the head stops at
    `reach.max` (snake 430, ant 130, both scaled with the animal: the 12 px ant reaches ~72 px) and holds there; it bridges to any other branch it
    touches (a 50 px gap is fine for the ant), retracts when released without contact, and falls (slip recovery) only when grip is on and nothing
    of the body is on top (snake: any sampled part; ant: the spot it reached from, `bestNormalY`).
  - **Jumping spider** (`jumper`, scaled 1.12 = ~0.7 x the spider; dark body `#2b2330`, orange-red abdomen `#c4552a`, eight legs, clings): the
    one crawler with a `leap`, strong for its size (>= 12 body lengths on the flat, ~20; lizard ~4, cat ~9), the usual hold-Space aim/assist/preview,
    and silk. ANIMALS order: lizard first, jumper last.
  - **Spider silk** (`Animal.silk = {maxLen, reel, pump}` (maxLen 1e9 = unlimited: the rope only stops 10 px above the ground, `ropeMax`): spider, jumper; keys: **X tap** = `Input.silk` (edge) drops, **X held** = `Input.drop`, **Space held** = `Input.reach`, **Shift** = `Input.climb` lets go, **C** = `cutThread`; `Creature.silk: Dangle | null`;
    `silkPoints(c)` = rope for the renderer, `dangleBasis(c)`): X on a surface drops the spider on a rope from its head's surface spot (head
    stays at the perch, trail `surf: null`, pendulum: gravity 900, rope length constraint, damping 0.5/s). Hanging: **X held** lets the rope out
    (`reel x (1 + min(3, len/300))` px/s: a long rope goes faster), **Space held** reels in 1.3 x faster (<= 6 px = climbs back onto the anchor, no
    thread kept), **A/D** swing sideways (260 px/s^2), **W/S** swing along the facing (`max(260, pump)`), the facing `yaw` only changes with the mouse camera
    (`Input.aimDir`), **Shift** lets go (ordinary fall, never a glide). The thread is then FROZEN as a free thread; if the spider touched a branch while still on the rope it
    lands there and the thread freezes as a BRIDGE. A drop from a top surface slides over the edge as the rope is let out; the origin branch
    only catches the spider once it has swung clear of it (never within 0.4 s).
  - **Threads** (`silk.ts`, pure): a thread is a real `Branch` (`id "silk:<n>"`, r = 2.5, `silk: true`, `parent`/`attachS` = the anchor, optional
    `endLink {b, s}` = where the far end is attached; in BOTH branches' `side` lists). They are climbable: off the start you step onto the
    anchor branch, off the end onto `endLink.b` (free end: stops); **Shift** within 14 px of either end climbs on (`climbTarget`/`sideEntry`;
    facing up the thread). Only animals that can use threads (`canUseThreads`: `clings`, or max node half-width <= 6 px = ant, spiders, bee,
    dragonfly) walk onto them or land on them; lizard / cat / snake / squirrel / jay ignore them in `sideEntry`, leaps, flight contacts, the
    landing magnet and the recovery. `SILKS` (module state) keeps every thread; the view persists them in localStorage (`biblio.v1.silk`, `biblio.v1.silkDemo` on the demo page) through `serializeSilks` / `parseSilks` (sanitised: ids `silk:<n>`, finite numbers, bounded, `SILK_KEEP` 200) and `restoreSilks` before the first world is built; `cutThread(world, c)` (key **C**) removes the thread you stand on from world + store (you fall: the usual recovery) or drops the rope you hang from without keeping a thread; `applySilks(world)`
    re-creates them in a (re)built world from their surface refs (they follow edits; anchors that no longer exist are skipped), `addSilk`,
    `newSilkId`, `clearSilks` (tests). Section 19 of the unit tests covers all of it (note: the test bundles sim3 + silk into ONE module so they share `SILKS`).
  - **Flying squirrel** (`leap.steer`; aims like the others): after a leap, A/D bend the glide, W dives (faster, steeper), S flares (slower,
    floatier); flights last up to 7 s before the recovery (other animals 2.2 s).
  - **Ground:** anything that falls below `world.groundY` (or misses everything) takes the same never-fatal recovery
    (put back on the nearest branch / on top of where it left); layout sets `groundY = 0`, the demo log -900 (a world without one gets
    a ground well below its lowest branch).
- **Layout** (`layout.ts` + `forest.ts` + `wave.ts`, `layoutTree(LibraryTree, {mode?, overrides?}) -> {world, leaves, rootBranchId, mode, parentOf, info}`, deterministic by
  note id). **Two modes** (`LayoutMode = "hub" | "forest"`; `layoutTree` itself defaults to `hub`, so old callers/tests are unchanged; the APP default is `forest`, `DEFAULT_LAYOUT_MODE`;
  remembered in localStorage `biblio.v1.treeLayout` by `tree/layoutpref.ts`; key **`Y`** or the HUD button "layout: forest/hub" in `ui/TreeView.tsx`; `lizard3d.html?vault&layout=hub|forest`).
  Both: the root note is the central stump (id = `rootNoteId` = `rootBranchId`, length `clamp(90 + 30 x its own notes, 90, 700)`, radius `max(18, 1.1 x the thickest trunk)`, taper 0.95,
  species oak unless labelled, its own notes are leaves on it); every top-level folder is its own TREE of one species; folder = branch, note = leaf, `#color`/tag -> leaf colour, else the
  species' leaf colour; clones are grown once (first parent), cycles are safe, `MAX_DEPTH` 12; `parentOf` of a trunk is the root note (breadcrumb: root > trunk > ...).
  - **hub** (the original): each trunk starts at the stump's END (a `next` child of the hub: the walk code goes down any trunk into the hub and up another; `attachS` undefined), fanned
    around it at azimuth `2 pi i/N` + jitter, leaving nearly horizontally (pitch 76-84 degrees off vertical) and **arching up** (direction eases to world-up per control segment) over a horizontal
    run `max(200, 70 N)` px (N <= 30; above `max(2100, run needed)`), the arch ends >= 3 trunk diameters apart. N = 0: just the hub; N = 1: the trunk continues up (3-9 degree lean, no arch).
  - **forest** (every tree stands in the ground; ground roots join the trunks to the stump): each tree is first grown around its OWN origin (trunk rising nearly vertically, 3-9 degree lean in
    the direction `spin`, `pitch` = degrees off vertical), its footprint is measured (`forest.ts#crownOf`: merged ground discs of every branch point + 50 px for leaves/foliage), `placeTrees`
    positions it (tree i prefers azimuth `base + 2 pi i/N` for N <= 6, else the sunflower/golden angle `i x 2.4 rad`, jittered; it is pushed OUT along that ray - trying +-30 degrees offsets - until it
    clears the stump (+70 px), every earlier crown (overlap <= 60 px, so >= ~90 px of branch clearance), keeps its trunk >= 3 diameters from every other trunk and both roots clear the other's trunk
    foot) and the whole tree is translated there (pts only; `cum/T/U/total` are translation-invariant). Trunk start = `footHeight(r) = 2.2 r + 6` above the ground (the trunk's first centreline point;
    the root sweeps up into it). N = 0: only the stump; N = 1 works; clones of an earlier tree are skipped. 400 notes: radius ~1100 px, 1500 notes ~3800, 133 one-note trees ~4200 (roots need
    angular room); layout 13 / 54 / 30 ms.
  - **Ground roots** (`Branch.root = true`, id `root:<treeId>`, built by `forest.ts#rootPath`): an ORDINARY rail, a **side branch of the stump** (`parent` = stump, `attachS` = its start height, ~6-11 px) that
    starts on the stump's axis a little above the ground and dips onto it (the first tangent points slightly DOWN, so a creature stepping root -> stump lands on the root's side of the stump and
    faces up it), runs along the ground (centre height 0.45 x the local radius: you walk on its top, partly sunk look; gentle deterministic undulation + sideways wander), and sweeps up in a wide knee
    into the trunk's start point with the trunk's own direction (C1-continuous), where the trunk is the root's **`next` child**. Radius `r` = 0.62 x the trunk's at the stump, `rEnd` = the trunk's
    start radius (a root WIDENS towards its tree). `trunk.parent` = the root id, but `parentOf(trunk)` = the root note. Roots carry no leaves, have NO `info` entry (not editable; `B` is a no-op like
    silk, `TreeView` only opens the panel for ids in `layout.info`), get no sign/bubble (`titlesOf` skips them) and the breadcrumb calls them "<tree> roots". Walking: down a trunk -> onto its root ->
    along it -> onto the stump happens by the ordinary junction code (tree -> root -> stump unit-tested for lizard, cat, snake, ant, spider); stump -> another root is the **star junction** (walk DOWN the trunk into its foot: the root nearest the side you face is taken, Shift = stay; see "World tree, shrine, ..." below); then it walks up that trunk (the cat clings only to the top half so it can't stand on every side of the trunk). Grip never
    drains on a root's top (n.y ~ 1), a creature left standing on a root stays there. Nothing in the sim/renderers special-cases roots (cosmetic uses of `Branch.root` only).
  - **Wave** (`wave.ts`, pure; applied in `layout.ts#grow` to the dense centreline AFTER the sway/bend trace, so children/leaves/rails follow the EFFECTIVE displaced centreline): per branch an amplitude
    (a FRACTION of its length), a frequency (cycles along it) and a shape `none | sine | zigzag | sawtooth | helix | sbend | noise`. `waveShape(fn, t, freq, seed) -> [a, b]` (|(a,b)| <= 1, exported
    for the editor's preview) is 0 at t = 0 with zero slope (base ramp over the first 25 %, so joins stay continuous), finite for any input, deterministic; the tip is not faded. `applyWave` displaces
    perpendicular to the direction in a rotation-minimising frame (planar shapes in a per-branch random plane, helix/noise use both axes). The applied amplitude is reduced so the branch never
    leans more than `WAVE_MAX_SLOPE` 0.7 (35 degrees) from its undisplaced line (`effectiveAmp`), and a branch holds at most `length / 50` cycles (`effectiveFreq`); the points are sampled
    finely enough (>= 10 per wavelength). Calculated default (species-driven, never reads its own overrides): amplitude `0.012 x sway` (trunks x0.6, rounded to 3 decimals), shape `Species.waveFn ?? noise`
    (willow sine, baobab sbend, ghost zigzag), frequency `clamp(round(4 x calc.length / 280) / 4, 0.5, 6)`.
  - **Pointed tips:** a branch with nothing attached (`isTerminal(world, b)` in world3.ts: no `next`, no non-silk side child, not a root, not the stump) ends in a point: calculated `rEnd = max(1.2, min(0.9 r, k x r))`
    with `k = clamp(0.25 x species.taper, 0.07, 0.15)` (pine/redwood/cypress sharpest ~0.075-0.1, baobab 0.15); a branch that carries sub-folders keeps `rEnd = min(0.9 r, max(4, taper x r))` so the children
    have something to grow from. A user taper/thickness override wins (floor 1.2 px). Renderers cap terminal tips with a point; the sim has no radius assumption below 1.2 px (fuzz-tested for every animal at a tip).
  **Radius model:** thickness depends on the notes a folder carries and
  how many folder levels hang below it, NOT on its own depth: `r0 = max(6 (11 with sub-folders), 4 + 4.6 x cbrt(L) + 3 x H)`
  (L = leaf notes in the whole subtree, H = folder-subtree height; trunk x1.15), x the species' `trunkR` (trunks) / `branchR` (branches), so for the
  reference species (`maple`, all multipliers 1) a 2-note folder is a ~10 twig, a 20-note folder with a sub-level ~20, a 400-note trunk ~45-60.
  **Taper:** `r` at the base, `rEnd` at the tip (above; `makeBranch(..., rEnd)`, `radiusAt(branch, s)`
  interpolates linearly). A side branch starts at most 0.85 x the parent's `radiusAt` where it grows out (floor 4.5); trunks have no cap (the hub
  is derived from them). **Length** (side) = `max(140, (130 + 42 sqrt(subtree size) + 9 x own notes) x (lengthDecay^depth + 0.15) x childLen + 90 per
  sub-folder)`, cap 2400; a trunk's = rise (`x 1.15 x trunkLen`, min 180, cap 2400) (+ the arch in hub mode). Spacing: sub-folders attach >= max(170, 3.2 x the
  thickest child radius) apart along the rising part of the parent (which grows, "roomy" rule, when crowded); leaf slots are 56 apart.
  `Leaf` = `{id, branchId, s, th, color, title, kind, size, type}`; layout sets `size` 1 (measured sizes arrive later).
- **Species** (`species.ts`, pure data): 13 kinds (`SPECIES_KEYS`: oak, birch, maple, pine, willow, cherry, acacia, baobab, redwood, aspen,
  ash, cypress, ghost) in `SPECIES: Record<SpeciesKey, Species>`; `maple` is the reference (multipliers 1). Growth fields: `trunkLen`/`trunkR`/`branchR`/
  `childLen` (multipliers), `taper` (tip/base), `pitchMin`/`pitchMax` (degrees off the parent), `upBias` (world-up added to a side branch's direction),
  `droop` (0..1, calculated `bend` = -droop), `lengthDecay` (per folder level), `azimuthRule` (`golden` | `whorl` of 3 | `alternate`), `attachFrom`/`attachTo`
  (fractions of the parent's rising part where its sub-folders attach), `sway`, `tropism` (per control segment; a trunk uses `0.14 + 0.5 x tropism`), optional `waveFn` (calculated wave shape, default `noise`).
  Look fields (for the renderer, via `Branch.species`): `bark {base [r,g,b] sRGB, variation, mark? {rgb, chance}, moss, streak}`, `leaf {color}`, `label`.
  **Choosing:** the label `biblio_species` on a folder (case-insensitive; inherits DOWN to its sub-folders, a sub-folder may override; on the root it styles
  the hub only, default oak); else top-level trees get `speciesForest(ids)` (hash of the id stepped by 5 through the key list, moved on while it equals one of
  the previous 3 trees, so any 4 neighbours differ and 6 trees show >= 4 kinds) and sub-folders inherit. `speciesFor(noteId, index, override?)`, `parseSpeciesKey`,
  `hash01` are exported too. `Branch.species` is set on every branch (the hub included).
- **Editable + recalculable properties** (`layout.ts`): every folder branch has `PropKey = length | thickness | taper | spin | pitch | attach | bend | species | wave | waveFreq | waveFn`
  (`BranchProps`, `PROP_KEYS`; `EnumPropKey` = species + waveFn, `NumPropKey` = the rest, which have a `PROP_RANGES` entry). Each has a CALCULATED value and an optional OVERRIDE; `eff = override ?? calc`; geometry uses `eff`, children grow from the
  EFFECTIVE parent geometry (edit a length / pitch / spin and everything above it moves). `layout.info: Map<id, BranchInfo {id, calc, eff, overridden}>` covers every
  branch incl. the hub. A branch's `calc` never depends on its own numeric overrides (a UI shows "calculated: X", reset restores exactly X; unit-tested for every property;
  the species is the one input that changes the OTHER calculated values, but `calc.species` is always the automatic / inherited kind). Overrides are OWN labels on the folder
  note (numbers as strings; written through `commitLabel` = undoable) or `layoutTree(tree, {overrides: Map<id, Partial<Record<PropKey, number|string|null>>>})`: an explicit
  entry beats the label, `null` forces the calculated value (label ignored), absent = the label. Garbage / NaN / `1e999` is ignored, finite out-of-range numbers are clamped to
  `PROP_RANGES` (spin wraps into [0, 360)); `parseOverrides(note)`, `sanitizeProp(key, raw)` (waveFn: `parseWaveFn`) and `parseLeafAt(note)` are pure and never throw. Label table (`PROP_LABELS`, all lower-case,
  `config.LABELS`; none ever becomes a shelf):

  | prop | label | meaning | range (`PROP_RANGES`) |
  |---|---|---|---|
  | length | `biblio_blen` | centreline length, px (a trunk: arch + rise) | 20..9000 |
  | thickness | `biblio_bthick` | start radius, px | 3..150 |
  | taper | `biblio_btaper` | end radius / start radius (tips of terminal branches are pointed, ~0.1) | 0.05..1 |
  | spin | `biblio_bspin` | **rotation around the parent** (UI: "Rotation on parent"; it used to be called azimuth / "spiral": it is WHERE on the parent's circumference the branch leaves, not a factor), degrees, 0 = the parent's top (`u`), towards its `b`; a trunk: the direction it leans (0 = +z, 90 = +x). The key `spin` and the label name are unchanged (back-compat) | wraps at 360 |
  | pitch | `biblio_bpitch` | degrees off the parent's direction (a trunk: off the hub's vertical) | 0..110 |
  | attach | `biblio_bat` | where it leaves the parent, 0..1 of its length; IGNORED for trunks (they start at the hub's end) | 0.03..0.97 |
  | bend | `biblio_bbend` | -1 droops .. +1 lifts (offset `0.35 x bend x length x t^2`) | -1..1 |
  | species | `biblio_species` | tree kind (inherits down) | a `SpeciesKey` |
  | wave | `biblio_bwave` | wave amplitude: sideways swing as a FRACTION of the branch length (0.05 = 5 %); reduced by the steepness limit | 0..0.3 |
  | waveFreq | `biblio_bwfreq` | wave cycles along the branch (capped at length / 50) | 0.25..12 |
  | waveFn | `biblio_bwfn` | wave shape (case-insensitive): none, sine, zigzag, sawtooth, helix, sbend, noise | a `WaveFn` |
  | (leaf) | `biblio_lat` | `s,th` on a LEAF note: fraction 0..1 along its branch, degrees around it (0 = top); unpinned leaves keep the rows placement | s clamped, th wraps |

  Calculated spin/pitch of a side branch come from the golden / whorl / alternate azimuth and the species' pitch range, then `upBias` and the min-up clamp are folded in
  (so the stored pitch/spin reproduce exactly that direction; an override is applied as given, only kept >= 0.12 upward). The hub ignores spin/pitch/attach/bend and wave overrides (its calc wave is 0 / none).
  Writing the labels is the UI's job (`ui/BranchPanel.tsx`, through `commitLabel`); layout only reads them.
- **Editing branch properties** (key `B` / the "edit branch" button; `ui/BranchPanel.tsx`, state in `ui/TreeView.tsx`, pure planning + writing in `lib/treeedit.ts`): B opens the
  panel for the branch the animal stands on (`hud.branch`; ignored for `silk:` ids; `kind` = hub | trunk | branch decides which rows show: the hub has no rotation/pitch/attach/bend/wave rows, a trunk no attach (its rotation row reads "Lean direction"); ground roots (`root:`) and silk are not in `layout.info`, so B ignores them).
  Every row has friendly name + one line of help (also its tooltip) + `calc X`; the wave block is amplitude (shown in % of length), frequency, and a shape `<select>` (blurred after a change so a focused dropdown never swallows game keys) with a small SVG sketch of the shape
  (true proportions, drawn from `waveShape`; a note appears when the steepness limit is reducing the amplitude). The foliage block stays at the BOTTOM of the panel. Sliders write a `Pending` (`Partial<Record<PropKey, number|string|null>>`: value = new override, `null` = force
  calculated, absent = untouched); `TreeView` re-runs `layoutTree(tree, {overrides: Map([[editId, pending]])})` (deferred value) so the preview is live and nothing is written. **Save** = `planChanges(note, info, pending)`
  -> `saveChanges` (one `commitLabel` per label, sequential, `expectedBefore` = the cached label value, so a changed label throws `LabelConflictError` -> toast "That property was changed elsewhere";
  a value whose formatted string equals the calculated one writes NOTHING / removes the label; numbers are written rounded to the slider step via `formatNumber`). **Recalculate all** = `recalcAll(note)` (remove every own `PROP_LABELS` label, no Save needed).
  The row ↺ = `null` when the value is saved (label removed on Save) or `undefined` (discard the edit). **Undo** = `undoEdit` on the shared session journal (50 deep, shared with build mode). A write failure part-way leaves earlier labels written.
  The scene swaps worlds in place (`scene.replaceWorld`), silk threads re-attach through `applySilks`. The tree view's only vault write is therefore `biblio_*` labels on folder notes (own labels, via `setLabel`).
- **Leaf look/size (pure):** `leafkind.ts` - `leafKindFor(noteType, #biblio_leaf)` (text broad, code needle, markdown
  maple, canvas/relationMap/mermaid/render/book/search/webView/noteMap/mindMap/geoMap blossom, image/file/audio/video/pdf fruit; unknown type broad; override label
  `biblio_leaf` = broad|needle|maple|blossom|fruit, hidden from shelves), `leafScale(chars)` (log curve 0.55...2.0,
  unknown = 1), `LEAF_SHAPES` (2D outlines in unit leaf space, shared by both looks), `LEAF_ACCENT`.
  `lib/leafsize.ts` - `measureLeaves(client, notes, {signal, onBatch})` fetches content lengths lazily in the
  background (4 parallel, max 400 fetches per call; text = visible characters, markdown/code = raw, other types skipped),
  caches `{blob, len}` per note in localStorage `bibliotheca.leafsizes.v1` keyed by the note's `blobId`
  (`NoteInfo.blobId`; changed blob = refetch, no blobId = never trusted); numbers only, content is never kept or logged.
  `ui/TreeView.tsx` starts it and feeds `scene.setLeafLengths(map)`, which rescales the leaves and rebuilds them.
- **Looks** (pure three.js builders, no app state; `look.ts` = bark, leaves, light rig, re-exports; `scenery.ts` = sky, clouds, ground, horizon; `lpkit.ts` = shared helpers: `VOX`, `SKY`, `SUN_DIR`,
  `hash`, value noise, the `Soup` triangle builder, `instanced`; the animals are in **Creatures** below): voxel = bark as instanced cubes snapped to a global grid, leaves as voxel clusters, tiled-block ground and stepped
  mountains; low-poly (the look the user now prefers) = flat-shaded vertex-coloured meshes. Both share the sky dome + sun, fog in the horizon colour, a grass/dirt ground, rocks, bushes, far pines and a ring of mountains, so you can always
  tell up from down and how high you are. Switching only rebuilds meshes; the simulation never notices. **Low-poly details to keep in mind when touching it:**
  - **Bark** (`lowpolyBranch`): an N-sided tube (6 / 8 / 10 / 12 sides for r < 5 / 24 / 48 / more) with **per-vertex ambient occlusion baked into the vertex colours** (dark undersides, dark near the ground - trunk bases and roots -,
    dark in the crotch where a side branch leaves and at the foot of every side branch), a **collar flare** (+20 % radius, ~1.5 r long) where a side branch leaves its parent (rounded forks; ~3 px on a 15 px twig, so
    the sim's surface is not visibly violated), facets from the species' `bark` data (lengthwise furrows = smooth noise along the branch, moss as PATCHES on up-facing facets, `mark` = thin lens-shaped decals lying on the facet: birch's
    dark dashes, cherry's pale ones), a few dark pyramid knots on branches with r >= 9, ground roots get more moss. **Branch ends are closed**: a branch with no `next` child gets a sharp cone cap (`isTerminal` or end radius < 5:
    length `max(3, 3.2 x rEnd)`, i.e. a ~1.2 px tip is a pointed needle) or, on a thick end (the stump), a short dome; the voxel bark continues its rings past the last point with a shrinking radius (one cube at the very tip). Unit-tested
    (`tools/unit-lowpoly.mjs`: the apex lies past the last centreline point for every terminal twig, both looks).
  - **Leaves** (`lowpolyLeaves`): each leaf drifts in hue/saturation/lightness around the note colour, the blade is darker at the stalk and lighter at the tip with alternating facets, and sways in the wind: a per-vertex `aSway`
    weight and one shared `WIND` uniform (`look.ts`, written by the scene every frame) move the vertices in the vertex shader (the shadow pass does not sway).
  - **Light rig** (`buildLights`): hemisphere (sky 0xcfe2ff / ground 0x77714f, 1.05) + ambient fill 0.42 + the warm sun 3.1 (the sun carries the light, so a shadow is clearly darker than a lit face) + a weak cool `rim`
    light from the opposite side (0.55, no shadow). `renderer.toneMapping = NeutralToneMapping` (Khronos PBR neutral: keeps the authored colours, rolls off only the brightest sunlit faces; the sky dome and sun sprite are
    `toneMapped: false`). A soft DOM vignette (`createVignette`, low-poly only) darkens the corners.
  - **Scenery** (`buildEnvironment(look, groundY, world?)`): the low-poly ground is a faceted terrain (150 px cells, 6400 px radius) that is FLAT (+-1.5 px) within ~150-950 px of every ground contact (`footprintsOf(world, groundY)` = branch
    points near the ground, thinned to a 70 px grid; `Foot` = grid lookup) and rolls into hills (+-60 px) beyond, with its rim sinking to the far ground plane (`RIM_DROP` 60); colours = lush / olive / deep / dry grass patches (value noise), forest-floor
    litter under the trees, a dirt patch round the stump, a pond (a dip + a water disc, beyond the forest) with a sand shore. Decorations are instanced and deterministic: grass tufts (<= 6500), flowers in patches (560, stem + head), red mushrooms at
    the trunk bases, rocks (110) and pebbles (520), bushes (150 x 3 lumpy blobs), far pines and round trees, rolling hills, snow-capped mountains; nothing is placed on a footprint or in the pond, everything sits on the exact terrain surface
    (`surfaceH`). `world` is optional (the demo log has no ground contacts: then the terrain just rolls everywhere). **Clouds**: 34 flat-bottomed puff clusters (icosahedra / cubes), the group named `CLOUDS` is kept centred on the camera
    and turned slowly by `TreeScene`. `TreeScene.buildWorld` rebuilds the environment only when `environmentKey(look, groundY, world)` changes (look, ground height, the ground contacts, the stump), so dragging a slider in the branch
    panel does not rebuild ~5k instances. Cost for an 85-branch forest (triangle counts, deterministic): bark ~29k triangles / 85 meshes, leaves ~8.8k, environment ~65k triangles / 5k instances / 17 meshes, ~150-200 ms to build in Node (once per look / forest change).
  - **Shadows** (`shadows.ts`; key **`K`** / HUD button "shadows: ..." cycles `off -> low -> medium -> high`, `biblio.v1.treeShadows`, default **medium**; `TreeScene.setShadows(q)` / `cycleShadows()` / `shadowQuality` / `shadowFit`):
    one orthographic sun shadow map (PCF, `renderer.shadowMap.type = PCFShadowMap`: in three 0.186 `PCFSoftShadowMap` is gone; softness = `shadow.radius` in texels) of 1024 / 2048 / 4096 texels (`SHADOW_TABLE`). The frustum follows the animal
    and zooms with the camera: half-size = `shadowExtent(camDist)` = ~1.1 x the camera distance, quantised to 2^(1/3) steps, clamped 420..6000 px (a close-up gets ~4-5 texels per world px, a far overview still shadows the forest in front of
    you); `fitShadow` snaps the frustum centre to whole texels in the light's plane (no shimmering edges), `shadowBias` scales the depth bias (-(0.9 + 0.55 texel)/range) and the NORMAL bias (0.6 + 0.9 texel px) with the texel so there is no
    acne and no peter-panning at any zoom; the depth range covers a 3200 px tree above the focus. A one-time patch of three's PCF chunk (`patchShadowChunk`, guarded: returns false and does nothing if the chunk changes shape) fades the shadow out over the outer 14 % of the map instead
    of cutting it off. **Who casts / receives:** bark, note leaves, the animal (`tagShadows`, once per mesh, so a rig that rebuilds its meshes is re-tagged every frame for free), foliage (cast through a `customDepthMaterial` that discards
    where the instance fade `aFade` < 0.42, so the canopy near you, which is faded out, casts no shadow on the bark you stand on), rocks / bushes / pines / mushrooms cast; the terrain, bark, leaves, animal, foliage and
    decorations receive. Transparent materials (wings) never cast unless asked. **Off** = no shadow pass at all and a soft blob (`ContactShadow`: a dark radial disc on the ground under the animal, bigger and fainter with height) so you still see where
    you are above the ground. Switching off <-> on refreshes every material once (`needsUpdate`). Cost (88-branch forest, `renderer.info` per frame incl. the shadow pass): low-poly 84 draw calls / 130k triangles with shadows off ->
    196 calls / 229k triangles with them on (the map size does not change the counts, only fill cost); voxel 77 calls / 1.10M triangles -> 125 calls / 1.57M. **Voxel casters:** the cubes only RECEIVE (`userData.noCast`); each voxel branch also gets a thin 6-sided `shadowProxy` tube (a little thinner than the cube shell, so the cubes are never shadowed by their own proxy; `userData.shadowOnly`) on `SHADOW_LAYER` (1), which the main camera never draws and `SunShadows` enables on the sun's shadow camera - redrawing every cube cost 2.75M triangles. On a weak GPU switch shadows off with `K`.
    Unit-tested: the quality table, `shadowExtent` monotone / quantised / NaN-safe, `fitShadow` texel snapping (< 1 texel of movement changes nothing), bias ranges, the chunk patch, the rig (`SunShadows`) on a fake renderer.
- **Creatures** (`animalmodels.ts` = the looks as pure DATA, `creatures.ts` = `CreatureRig`, the engine `TreeScene` calls: `rig.update(world, creature, t, look)`,
  `rig.group` (add / dispose), `rig.camScale`, `rig.headPoint` / `rig.center` (world points, debugging)). Rules: (1) **a `Model` per animal id** in `MODELS` (unscaled sim px,
  the renderer multiplies by `Animal.scale`; no model = `genericModel`): `tubes` (torso / tail / abdomen: lofted rings along the body path between two body distances `d0..d1`;
  `prof(d, w)` = half width / height, `color({d,u,i,phi,side})` = crisp per-FACE colour, `crest` = dorsal spikes; low-poly = one dynamic non-indexed vertex-coloured mesh, voxel =
  stepped square boxes in the same mesh), `atts` (blob / cone / prism / stick / plate parts placed by body distance `d` + `at = [forward, up, side]`, `mirror` makes the pair,
  `frame: "head"` follows the idle head turn / nod, `anim`: blink, twitch, antenna, mandible, tongue (flick every 4.3 s), crest), `legs(i, n, leg)` -> `LegStyle` (two-bone IK from
  the sim's feet with an optional third ankle segment, `len` = total length x the rest hip-to-ankle distance, `bend` = knee direction, paw + toes, `air: "stretch"`), `wings`
  (panels = flat vertex-coloured outlines from `WING_SHAPES`; `pose(motion, panel)` returns `[roll, yaw, pitch]`), `slither` (lateral wave from the walked distance), `tail`
  (sway + raise), `droop`, `head`, `membrane` (the squirrel's glide quads), `stance` (body height above the bark; lizard 0.5, cat 1.25) and `level` (all parts at the hips' height:
  spiders, insects, jay). (2) **The model never feeds the sim and stays inside its widths** (tube half width <= 1.15 x the widest sim node; `tools/unit-animals.mjs` checks it for
  every animal, plus colour / profile / wing-pose totality and a mesh bound of 90). (3) Body frames come from the trail's surface points (flying: rigid behind the head), with
  cosmetic offsets on top; nothing is stored between frames except small smoothing (wing open / phase, glide open). (4) All parts are plain `Mesh`es (`frustumCulled` off, the shadows
  stream tags them with `tagShadows` every frame, new ones included); materials are shared per colour with a pale **rim** (`onBeforeCompile`) and disposed with the group. (5) A creature
  is 28-55 meshes and under 2000 triangles in both looks; `update` costs about 0.1-2 ms. To change an animal's look edit its `Model`; to add one see wiki/Contributing.md.
- **Branch names** (`labels.ts`, `N` cycles `signs` -> `bubbles` -> `off`, default signs, persisted in `biblio.v1.treeLabels`): signs = a wooden board at the
  base of each BIG branch (start radius >= 13), bubbles = a speech bubble over every branch (drawn over everything); sprites keep a roughly constant screen size.
  A legend for names/labels is an open idea (next-directions Addendum 7), not built.
- **Foliage** (`foliage.ts`; toggle `F`, HUD button "foliage", checkbox + density slider at the BOTTOM of the branch panel; `biblio.v1.treeFoliage` on|off default **on**,
  `biblio.v1.treeFoliageDensity` 0.25..1.5 step 0.25 default 1; `TreeScene.setFoliage(on, density?)` / `toggleFoliage()` / `foliageStats`; a view setting, never written to notes):
  translucent canopy "fog" that hides the thin / outer wood from afar and thins out near the animal and the camera, so tips are not stumps. **Pure half:** `FOLIAGE` = one `FoliageStyle` per species
  (shape family `puff` oak/maple/ash, `leafy` birch/aspen, `tier` pine/redwood/cypress = stacked cone skirts, `curtain` willow = hanging strands, `blossom` cherry (+ white accent), `umbrella` acacia = flat plates,
  `tuft` baobab = branch ends only, `wisp` ghost; colour = the species' `leaf.color` darkened + jittered so the brighter note leaves stand out; `styleOf` falls back to maple);
  `placeFoliage(world, leaves, {density})` -> `Cluster[]` (deterministic: integer hashes of the branch id; **every branch end** (no `next`, tip radius < 40) gets one, thin stretches get more along the way:
  probability `thin(radius)` = 1 below radius 20, 0 above 44, x the species' `rate`; the trunk and thick limbs stay clear; radius `~(40 + 3.2 R + 0.13 length) x size`, 38..210; **none** on silk threads,
  on branches flagged `Branch.root` (ground roots of the forest layout) or lying on the ground (top < groundY + 60); capped at `MAX_CLUSTERS` 1600, tips first), `clearLeaves` sets `leafK` (0.25..1) on clusters that contain a note
  leaf so the notes stay readable, `buildPuffs(clusters, look, density)` expands clusters into pieces (low-poly: `blob` icosahedra + `cone`s; voxel: cubes of 28/42/56 on a global 14-grid, deduplicated, hollow middles,
  fewer bigger lumps); beyond `MAX_PUFFS` 20000 whole clusters are dropped (tips first), never single pieces. **Fade rule:** `visibility(dAnimal, dCam, dRay, k)` = product of three smoothsteps over SURFACE distances
  (centre distance - 0.7 x radius): from the animal (90 -> 440; x0.6 for clusters of the branch it stands on, x0.8 for the neighbouring branches, so the whole branch you are on is revealed), from the camera (70 -> 340)
  and from the segment camera -> animal (50 -> 230, so nothing stands between you and the animal); `k = viewScale(camDist)` 0.7..1.15 (zooming out does not strip the canopy). **Render half:** `FoliageLayer`
  (`group`, `build(world, leaves, look, density)`, `update(dt, cam, animal, animalBranch)`, `clear`/`dispose`): 1-3 `InstancedMesh`es (cube | blob + cone), one `MeshLambertMaterial` with `transparent`, `depthWrite: false`
  and an `onBeforeCompile` that multiplies alpha by a per-instance `aFade` attribute (blended, no sorting, no z-fighting; foliage is drawn after the opaque bark / leaves / creature, which is why leaves are thinned
  by `leafK` and the animal by the fade); `update` runs one CPU loop over the clusters every frame (eased ~0.2 s, first frame snaps) and rewrites the attribute only when something moved. `TreeScene.buildWorld` rebuilds it for every
  world / look / density (so `setWorld`, `replaceWorld`, `L` and the layout switch all keep it); off = nothing built. Cost for a ~100-branch vault: ~330-530 clusters, ~2-3k low-poly instances (~40-60k triangles, 2 draw calls) or
  ~14-19k voxel cubes (~170-230k triangles, 1 draw call); 133 small trees: 1394 placed clusters, ~7.4k low-poly instances / 19k cubes (cap); placement ~10-20 ms, expansion 2-130 ms (only on a rebuild). Unit: `tools/unit-foliage.mjs`.
- **Junctions, auto-climb, mouse (2026-10-23):** `moveHead` (sim3.ts) at a mid-branch junction: `sideEntry` finds the side branch whose base zone the animal's spot is in (an ORDINARY branch wins over a ground root / thread in the same spot); an ordinary one is entered automatically when `dS > 0` (tip-ward) and `Shift` (`climbHeld`) is NOT held; roots and threads need `climbHeld` as before; `Creature.noAuto` (id of the branch just walked down out of) suppresses re-entry until the animal leaves that zone. The end-of-branch fork picks the child by `0.35 x dot(heading, childTangent) + dot(surfaceNormal, childTangent)` (the side of the bark you stand on wins). Guided steering is quicker: `GUIDED` gain 4.2, ease 18, k 7, turnSpeed 0.35 (U-turn: lizard 0.58 s, ant 0.32 s); chase camera `CAM_TURN` 3.8 rad/s, level 3.4. Lizard slimmed (node half-widths x0.78, `scaled(LIZARD, 1.5)`). **Mouse:** camera mode `mouse` (4th of `CAM_MODES`; `orbitYaw`/`orbitPitch`, right-drag or a moved left-drag, `pushOutOfBark`), `pick.ts` (pure: `pickBranch` ray vs capsules with a distance-proportional tolerance, `pickLeaf` over the `LeafIndex`, `pickAt`), `autopilot.ts` (pure: `routeBetween` BFS over parent/next/side links without silk, `entryTheta`, `Autopilot` = the keys W/S/A/D/Shift with lining-up hysteresis, a fixed turning direction, drift compensation, an 8 s no-movement watchdog and a timeout), `TreeScene` wires pointer events (`pointerDown/Move/Up`, hover at 10 Hz, click = `startPilot`, double-click marks a leaf goal "read on arrival", any movement key / Esc / click on nothing cancels, a free-mode animal is switched to guided for the walk), hover + goal rings, `HudInfo.walking` / `hover`, `scene.advance(seconds)` (simulation + pilot without rendering, for tests: software GL needs seconds per frame). Tests: `tools/unit-pilot.mjs`, unit-move section 10b (auto-climb), browser-test mouse steps.
- **Performance** (`perf.ts` pure + `leafindex.ts` pure + the loop in `TreeScene.ts`, panel `ui/PerfOverlay.tsx`, key **`I`**, tests `tools/unit-perf.mjs`): the view is GPU-bound (fill rate / overdraw at dpr 2 + MSAA, ~1M voxel triangles, blended foliage, the shadow map), so the controls are pixel-oriented. `PerfProfile` = `quality` (old behaviour: dpr <= 2, MSAA, no cap) | `auto` (DEFAULT: dpr <= 1.5, 60 fps cap, MSAA only when the effective ratio <= 1.25, adaptive resolution down to 0.6) | `fast` (dpr 1, no MSAA, down to 0.5); remembered in `biblio.v1.treePerf`; `PROFILE[...]` holds the numbers. `AdaptiveScale` (steps `SCALE_STEPS` 1/0.85/0.72/0.6/0.5; slow = avg frame > 21 ms for 0.7 s, clean = <= 17.6 ms for 5 s, 1.2 s cooldown, the wait for the next step up doubles after each step up that had to be undone) is fed every 250 ms with the rolling average of `FrameClock` (90 frames; ignores NaN / <= 0 / > 1 s) and the clock is reset after every change; `FrameLimiter` caps the rate by scheduling (a naive skip-if-too-soon rule gives 48 fps on a 144 Hz screen under a 60 cap). MSAA is chosen when the renderer is created (`useMsaa`) and cannot change on a live context. `renderer.info.autoReset = false` + a manual `reset()` per frame so draw calls / triangles include the shadow pass; `TreeScene.stats` (also `window.__treeScene.stats`, used by the browser test) = `FrameSummary` + calls / triangles / geometries / textures / dpr / scale / size / profile / msaa / `diagnose()` (`gpu-bound` = long frames with short JS). Cheaper bookkeeping: `nearestLeaf` is a flat loop over a `LeafIndex` built once per world (`buildLeafIndex`, in `setWorld`/`replaceWorld`), the HUD's nearLeaf / climb are recomputed at 10 Hz (the `E` key still asks live), foliage fade updates at 30 Hz, spider-silk lines are rebuilt only when `silkVersion()` (silk.ts) or the dangling rope changes, `replaceWorld` coalesces mesh rebuilds (`queueBuild`: now if nothing was built for 150 ms, else one trailing build). In headless software GL the scene runs at ~2 fps: every browser-test wait on the scene needs a generous timeout.
- **World tree, shrine, places, wisp, save (step S, 2026-10-23).**
  - **App flow:** `App.tsx` starts in the tree (`lib/webgl.ts` `chooseStartView(search, hasWebgl)`: `?view=library` forces the library, no WebGL falls back with a toast; `START` is decided once per page load). The Phaser library is a lazy chunk (`ui/LibraryHost.tsx` via `React.lazy`, kept mounted but hidden once shown); `scene:ready` (emitted by `BibliothecaScene.create`) makes App re-send `scene:load-world`. `T` only works in the library (back to the tree: `TreeView` remounts and `scene.moveToShrine()` puts the animal at the door); the Hud hides the crumbs and the view button in the tree. **Do not put a static `#game-host` in index.html**: LibraryHost renders it (a duplicate id broke the browser test).
  - **World tree** (`layout.ts`, forest mode only: `world3 = mode === "forest"`): the hub branch (id = root note id = `rootBranchId`) becomes the giant trunk: `YGG_LENGTH` 3200, radius `clamp(YGG_R_OVER_TRUNK 3 x thickest trunk, YGG_MIN_R 190, YGG_MAX_R 320)`, taper `YGG_TAPER` 0.18 (the top ends in canopy), species `yggdrasil` (in `SPECIES`/`FOLIAGE`, excluded from the random pool `POOL_KEYS`, so existing vaults keep their tree kinds), `placeTrees(slots, hub.r + YGG_CLEAR 260)` pushes the forest out. Hub mode keeps the old short stump (HUB_* constants). **Crown:** `layoutTree(tree, {places})` (`CrownPlace {id, title}`, `tree/places.ts` registry `PLACES`, empty for now; `demoPlaces(n)` for the demo / tests) adds one side branch per place on the upper trunk (`place:<id>`, `Branch.place`, species yggdrasil, `CROWN_FROM..TO` 0.5..0.92 of the trunk, length ~900); `TreeLayout.places` lists them; they are not in `info` (not editable).
  - **Shrine** (`shrine.ts` pure, `shrinemodel.ts` one flat-shaded mesh, scaled by `footScale(R)` = clamp(R/40, 1, 4.5)): `shrineOf(world, stumpId, titles)` -> door (azimuth of the widest gap between the ground roots), altar and lantern-post gaps (2nd / 3rd widest; fixed azimuths in hub mode), `footS`, `doorTh` / `altarTh`, `pads` (`door`, `altar`, `wisp`, and `place:<id>` at 0.9 of each crown limb), ring of standing stones in the free stretches; `padNear(shrine, p)` = the nearest pad by fraction of its radius; `arrival(shrine)`. `TreeScene`: `setShrine(true)` (only the app turns it on, TreeView), `moveToShrine()`, `moveToPad(id)` (tests / tools), `nearestPad()`, `onPad(id)`; the HUD hint comes from `HudInfo.pad`; `E` prefers a pad when you stand within 0.6 of its radius, else a leaf within reach, else a pad in range. `ui/ShrinePanel.tsx` takes `ShrineSection[]` from `TreeView` (library, wisp, save).
  - **Star junction** (`sim3.ts`, exported `starRoot`, `starTop`, `STAR_ARC` 0.85, `STAR_FACING` 1.9): ground roots of a stump are removed from `sideEntry`; in `moveHead` walking DOWN (dS < 0, facing down, no Shift) below `starTop` takes the root whose entry angle (`entryTheta`, now in world3.ts, memoised) is nearest the animal's `th` within `STAR_ARC`; `noAuto` holds the root just come up (when it is the nearest, nothing is taken); also evaluated at the very foot (s clamped to 0). `climbTarget` / the hint offer it (`HudInfo.climbDown`).
  - **Autopilot fixes that came with it** (`autopilot.ts`): `entryPoint` (world3.ts) = the true base zone of a side branch (a fat parent: further up than `attachS`); `rootEntry` for stump roots (up above the zones, pivot, correct the angle with Shift held, then S); `pressFor` maps A/D by the direction the animal faces NOW (the old fixed mapping made it circle long trunks forever); `cruise` first turns a hanging animal to the world-up side (`topOf`); `topWay` turns over the top of a thin hanging branch; Shift is held only for branches BELOW the target zone (`staying(..., until)`); a short stump with fat roots no longer sends the pilot up to a height it does not have; the timeout scales with the route length. Regression tests: `tools/unit-pilot.mjs` (deep forest), `unit-shrine.mjs` (door -> every crown limb).
  - **Wisp** (`wisp.ts` pure: `wispTarget`, `wispStep` capped at `WISP_SPEED` 1100 px/s, `wispHit`): perched at `shrine.perch`, following, or lighting a note (`lightNote(id)`, a beam mesh, released after 6 s near it); `walkToNote(id)` starts the autopilot; `tree/bridge.ts` (`setTreeBridge`/`getTreeBridge`) lets `ui/SearchPanel.tsx` offer "take me there" / "light the way" for results that are in the tree. A click on the wisp (`overWisp`, screen space) opens the search.
  - **Save** (`lib/save.ts` pure, `lib/yggdrasil.ts`, `state/savestore.ts`): `SaveData {v, updatedAt, settings (allow-listed `biblio.v1.tree*` + reader prefs only), progress {counters, unlocked, tutorial}}`, `sanitizeSave` never throws and bounds everything (the connection settings can never leak into a note), `mergeSave` (newer settings/tutorial win, counters max, unlocked union). `LABELS.yggdrasil` / `LABELS.save`; the library walk skips any note with the own label `biblio_yggdrasil` (and everything below it). Writing is **opt-in** (`biblio.v1.syncSave`, shrine panel "Save in Trilium"): switching it on only READS (`loadNow`); `saveNow` creates the folder + note on first use (`client.putNoteContent`, `CreateNoteDef.mime`), merging with what is there; the tree saves when the altar closes and when it unmounts if dirty; a read-only host disables it. Conformance: `tools/mock-test.mjs` "the app's save note".
  - **Mouse camera steering** (`Input.aimDir`, set by `TreeScene.input()` only when `camMode === "mouse"`): `lookAim` (jump aim), `steerReach`, `flightSub`, `stepDangle` follow it (manual keys still win their axis); walking ignores it. Voxel look: `cubeScale(b)` makes cubes 2x / 3x on branches thicker than 70 / 140 px (the world tree would otherwise cost ~1.6M triangles). Tips: `moveHead` counts only the distance really walked at a branch tip / a stump's foot (`used`), so the body no longer piles up while W is held against an end. A/D alone: `GUIDED.creep` 0.95, up to 2x on a radius >= 120 trunk.
  - **Tests:** `unit-shrine.mjs`, `unit-save.mjs`, `unit-look.mjs`, `unit-pilot.mjs`; browser-test step 2d (tree is the start view and lazy, T does nothing, altar panel, Save toggle off by default / read-only on / save now creates folder + note / not in the forest / cleanup, wisp click -> search -> take me there / light the way, door -> library, T -> back at the door). Software GL is very slow with the world tree: step 2d switches to the low-poly look, no foliage and the `fast` profile first.
- **Rendering/app:** `TreeScene.ts` (render loop, creature, camera, input; `window.__treeScene` is a debug handle used
  by the browser test and tools/tree-shots.js). Camera (`V` cycles): **chase** (up-vector = surface normal, rolls with
  the branch), **level** (follows from behind but keeps the horizon level; keeps its last yaw when the animal points
  straight up/down), **fixed**. The camera never goes below the ground. Zoom wheel/`+`/`-`, `P` pixel mode.
  Preferences persist in localStorage: look `biblio.v1.treeLook` (voxel|lowpoly, default voxel), camera
  `biblio.v1.treeCam` (chase|level|fixed, default chase), foliage `biblio.v1.treeFoliage` (on|off, default on) + `biblio.v1.treeFoliageDensity`, shadows `biblio.v1.treeShadows` (off|low|medium|high, default medium), movement `biblio.v1.treeMove` (guided|free, default guided). `ui/TreeView.tsx` mounts it in the app (hides the Phaser
  host, pauses the library scene), shows the HUD (breadcrumb, grip bar, "look: ..."/"camera: ..." buttons, the controls
  line, and a hint "walking up enters X · hold Shift to stay" (roots / threads: "Shift climb into X") while standing in a side branch's base and "E read X" next to a leaf);
  `E` opens the note in the normal reader.
- **Controls:** `W`/`S`/`A`/`D` (or arrows): **guided (default)** W up the branch / S down / A,D turn left / right on it in a smooth curve; **`M`** = free mode (W forward, A/D steer the heading, `H` auto-align straightens it; S does not walk); `Space` **hold = aim a
  leap** (A/D turn it, W/S tilt it, power builds ~0.8 s, an arc preview + mild aim assist toward other branches), **release = leap**, a quick
  tap = the plain leap, Shift while aiming cancels (snake and ant: hold = reach, steer with WASD; spider: Space does nothing; **`X` = spider/jumping-spider silk**:
  drop on a rope, S let down, W reel up, A/D swing + turn, Space pump, X again let go, touching a branch lands = a climbable thread; squirrel: aims, then glide, W dive / S flare;
  bee/dragonfly/blue jay: take off, then hover W/S/A/D + Space up / Shift down, jay W dive / S climb / Space flap, touching (bee,
  dragonfly) lands; jay **Shift = landing mode**: flare + magnet toward the best branch ahead, touching lands, slow touching lands too); walking up past a side branch's base climbs into it (`Shift` held = stay; click = walk there, double-click a leaf = read it, `Esc` stops)
  (the on-screen hint says when); `B` edit the branch you stand on (`BranchPanel`, see "Editing branch properties" below; no-op on a silk thread); `E` read the leaf next to you; `1`/`2`/`3` crawlers/walkers/fliers, again = next animal of the category (`ANIMAL_CATEGORIES` in sim3.ts); `G` grip on/off; `H` auto-align on/off (free mode only); `M` move guided/free (remembered, also a HUD button); `N` branch names signs/bubbles/off; `Y` layout forest/hub (remembered; also a HUD button; `F` is the foliage); `F` canopy foliage on/off; `K` sun shadows off/low/medium/high (remembered, also a HUD button); `V` camera chase/level/fixed; `L` look voxel/low-poly; `I` performance panel (profile quality/auto/fast, stats); `P` pixel
  mode; wheel/`+`/`-` zoom; `T` does nothing in the tree (it leaves the library, back to the shrine door); `E` at a shrine pad / crown lantern; spiders: tap `X` drop, hold `X` down, hold `Space` up, `WASD` swing, `Shift` let go, `C` cut. The prototype page adds `R` respawn.
- **Prototype page / screenshots:** `lizard3d.html` = hand-made demo tree (no Trilium); `lizard3d.html?vault` = a
  synthetic vault (random folders, note types and lengths) through the real `layoutTree`; extra query params: `&layout=hub|forest` (default forest, NOT the stored preference),
  `&trees=N` top-level folders (default 2-4), `&depth=D` folder levels (default 3; a light vault for slow screenshots uses 1-2), `&wave=fn:amp:freq` (e.g. `helix:0.06:3`) = that wave on every folder. Headless screenshots:
  `node tools/tree-shots.js [scenario...]` (needs the vite dev server on `APP_URL`, default http://localhost:5173, and
  the full chrome below; writes `shots/tree-*.png`). Scenarios: `looks`, `level`, `ground`, `leaves`, `squirrel`,
  `snake` (its script presses `1` three times: since the jumping spider joined the crawlers that is now the **jumping spider**, not the snake), `vault`, `kinds` (the five leaf kinds x three sizes on a demo twig; `SIGN=-1` mirrors them), `animals` (nine animals perched in both looks, the jumping spider is not in its list,
  fliers also airborne: 24 shots); none given = all. Env: `APP_URL` (default http://localhost:5173), `W`/`H` viewport (default 1280x760).
  **Slow**: software GL (SwiftShader), each shot can take many seconds (120 s timeout per shot): run one scenario at a time and shrink `W`/`H` while iterating.
  It never starts or stops servers (start `npm run dev` yourself).
- **Tests (unit sections 11-21):** 11 (rails, steering, feet, grip, snake reach + steering + body grip, squirrel glide pitch,
  ground recovery, `climbTarget`), 14 (review fixes: reach keeps the tail's history, retract obeys the grip rule, leaf-size guards), 15 (fliers: take-off, hover, wing + stall, landing/deflection, floor, random-input fuzz on the demo
  and a layout world; grip by gravity: vertical trunk never drains, 15-degree overhang climbable, spider; auto-align + thin-branch turn
  damping; number-key categories), 12 (layout: hub/trunk connectivity, spacing, leaf data, ground, worst cases, perf 400 < 1 s and 1500 < 2.5 s), 13 (leaf kinds/scale/outlines,
  `textLength`, the loader with a fake client + localStorage: cache hit/miss, errors, caps, abort; `blobId` survives
  `toNoteInfo`; the "leaf" reader paper contrast; `biblio_leaf` is never a shelf), 17 (forest: hub, trunks fanned + arched >= 3 diameters apart for N = 2..133, a creature walks down one trunk into the hub and up another, N = 0/1/2/30; species table sanity, determinism, variety, inheritance, label override, invalid label; every species lays out; every property's override/clamp/null-reset/calc-unchanged, descendants move; `parseOverrides` fuzz; `biblio_lat`; clones/cycles/depth; perf), 16 (radius model, all folders forced to `maple`: twig/mid/trunk targets, monotonic in notes and depth, taper,
  child <= 0.85 x parent at the attach point, `radiusAt`, lengths), 18 (leap aiming: hold/aim/release for the four jumpers (lizard, cat, squirrel, jumping spider), tap = the old
  leap, clamps + charge, Shift cancels, ignored while airborne/flying/snake, assist finds a gap branch the manual aim misses and respects
  manual input outside the window, preview == actual landing on the demo and a layoutTree world, determinism, jay landing mode: Shift alone
  lands in >= 90% of 200 trials per world from 250-450 px and +-35 degrees off, deflects without Shift, slow touch auto-lands, `landTarget`; fuzz). 19 (ant reach: extends/steerable/bridges a 50 px gap/retracts/grip rule, never jumps; crawlers never aim; jumping spider >= 12 body lengths and far more per size than lizard/cat; silk: drop, let down, reel up, ground clamp, swing pump, let go, free thread, bridge thread + walking it both ways, who may use threads, `applySilks` on a rebuilt layoutTree world / gone anchors / moved branches, NaN fuzz; review fixes: no climb hint while flying, feet after landing, underside take-off, cat `maxTh` after transfers, take-off from a slip fall). 20 (`lib/treeedit`: `planChanges` writes a differing value, drops the label for the calculated one, a saved label recalculated = removal, unchanged = nothing, species, `setPending`, `formatNumber`). 21 (`effectiveType`: `code` + markdown mime = `markdown`, other mimes/types untouched, rendered as markdown). `tools/browser-test.js` step 2c
  (needs WebGL, else skipped with a note): the vault lays out, E next to a leaf opens the reader, zoom, `L` switches the
  look, `V` cycles the camera, leaf sizes get measured (some `size !== 1`), `world.groundY` is a number, `N` cycles the names,
  key `3` cycles the four fliers, `H` toggles auto-align, every branch tapers (ground roots excepted: they widen towards their tree), `B` on the hub + length slider 420 + Save writes `biblio_blen=420` on the root (read back via ETAPI) and Recalculate all removes it, `T` back.
  The 3D look itself is judged from the tree-shots screenshots, not asserted.
  `unit-forest.mjs` covers the forest mode (structure of roots/trunks/stump, placement for N = 0/1/2/3/6/7/12/30/133 with trunk spacing and crown overlap, roots clear of other trunks, every species, tree -> root -> stump -> root -> tree for
  several animals both ways, grip on roots, fuzz), the wave (`waveShape` properties for every shape/frequency/seed, `applyWave`, the steepness limit, wave overrides/clamps/null-reset/garbage fuzz, calc unchanged, children + leaves follow the displaced centreline,
  rails smooth, label table, `planChanges` for the new keys), pointed tips for every species in both modes (+ the sim fuzzed at a tip for every animal), hub mode unchanged, perf (400 / 1500 notes in both modes).
  `unit-move.mjs` covers the movement modes (defaults, free mode unchanged, W tip-ward at the animal's speed and S base-ward after a <= 1.5 s swing for every animal, A/D bend the right way as the animal faces on a flat branch / vertical pole / a branch pointing down, release straightens with no residual spiral, A/D alone creeps to the underside and back, alternating A/D keeps th bounded, 50 reversals x 5 animals on a flat branch and x 3 on the demo / forest / hub worlds, thin vs thick turn rates and the floor, the numeric smoothness of the U-turn path, junction transfers both ways incl. auto-climb / Shift = stay (section 10b), trunk -> ground root -> stump -> root -> trunk, hub, aiming / reach / flight / silk / leaps identical in both modes, 150k fuzzed steps for every animal in three worlds).
  Per-feature test files `tools/unit-<name>.mjs` (`export default async ({ bundle, assert }) => ...`) run at the end of `unit-test.mjs`; `unit-lowpoly.mjs` covers the shadow quality table + frustum maths + rig, bark tip caps in both looks, the scenery footprints / environment cache key / budgets; `unit-animals.mjs` covers the animal models (a model for every sim animal and a working generic fallback, tube widths inside the sim's widest half-width, colour / profile / crest / wing-pose functions total and finite, wing and membrane consistency with the sim data, a mesh bound); `unit-foliage.mjs` covers the foliage: a style per species, placement determinism / bounds
  (400-note vault, 133 trees, 1500 notes), tips, no foliage on thick wood / roots / silk / the ground, leaf thinning, density, both looks' expansion + the cap, the fade rule (monotonic, smooth, clamps, NaN), the three.js layer (draw calls, fade near the animal, easing, dispose, rebuilds).
- **WebGL in the dev container (symptom → cause):** `THREE.WebGLRenderer: A WebGL context could not be created` /
  ANGLE `VK_KHR_wayland_surface` errors → VS Code forwards `WAYLAND_DISPLAY`/`DISPLAY`; with them set ANGLE demands an
  extension SwiftShader lacks. Unset both and use the FULL chrome (`.playwright-browsers/chromium-*/chrome-linux64/chrome`)
  with `--headless=new --use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader`. Full chrome also needs
  `libcups.so.2`: a stub exports the needed symbols (built with gcc into `.playwright-libs/root/usr/lib/x86_64-linux-gnu/`,
  gitignored — rebuild: `nm -D --undefined-only chrome | awk '/ U (cups|ppd|http|ipp)/{print $2}'` → one dummy function
  each → `gcc -shared -fPIC -Wl,-soname,libcups.so.2`). `tools/browser-test.js` and `tools/playwright-mcp.sh` do this;
  the tree steps are skipped (with a note) if only the headless shell launches. The headless shell itself has no WebGL.
- Voxel branches cost ~3–5k cubes each (instanced; low-poly tubes are far cheaper); a 400-note vault is ~100 branches — fine on a GPU. Foliage adds ~2-3k low-poly pieces or <= 20k cubes (see "Foliage"). `three` is a
  dependency (its chunk only loads with the tree view / `lizard3d.html`).

## Reader (BookPopup) — security + links

- `src/lib/reader.ts`: iframe `sandbox="allow-scripts"` WITHOUT `allow-same-origin` + a CSP meta
  (`default-src 'none'; script-src 'nonce-…'`) — note scripts/handlers can't run, our one nonce'd script only
  `postMessage`s link clicks (`{biblio:'note'|'ext', nonce, …}`); the parent accepts a message only from its own
  frame with the matching nonce. Never add `allow-same-origin` or relax the CSP.
- Links: `internalNoteId(href)` recognises Trilium links (`#root/a/ID`, `/#root/ID`, `#ID`, full URL with `#root/…`);
  `prepareLinks` rewrites anchors (`data-note-id` / `data-ext`). Navigation history lives in the popup.
- Content types: `text` -> HTML as is (inside the sandbox), `markdown` -> `marked`, `code` -> escaped `<pre>`, `image`/`file` -> fetched as BYTES (`client.getNoteBlob`), the kind sniffed from the bytes (`lib/media.ts`: `sniffBytes`, `planMedia`) and shown by `ui/MediaView.tsx` in the popup (picture / PDF viewer in an unsandboxed iframe on a blob we label from the bytes / text file / download card), anything else -> a "no rendered preview" notice + raw
  source; the raw toggle shows the source of any text type. Pictures embedded in text notes (`api/attachments/ID/image/..`, `api/images/NOTEID/..`) are fetched via ETAPI and inlined as `data:` URLs (`lib/embeds.ts`, bytes verified, size limits, placeholder on failure). Reader chrome: breadcrumb / siblings / Trilium URL in `lib/notepath.ts`, outline + find + scroll memory + forwarded keys through the iframe script in `lib/reader.ts` (`prepareDocument`, `READER_SCRIPT`), `ui/BookPopup.tsx`. **Gotcha: every document needs its own `<iframe>` element (`key={doc.nonce}`)**: changing `srcdoc` on a live iframe was ignored by Chrome while the first document was still loading (stale page, broken pictures, lost `find` messages: nonce mismatch). On a real v0.106 server markdown notes are `code` + mime `text/x-markdown` (ETAPI has no `markdown` type, see "Trilium mock"); `effectiveType(type, mime)` in `lib/content.ts` (used by `renderNoteContent`) and the same rule in `library.ts#toNoteInfo` turn `code` + a mime matching /markdown/i into `markdown`, so they render as markdown and get the maple leaf (unit section 21).
- Papers: parchment (default), book page, sepia, night, study and three **leaf** papers (`leaf` spring, `leafAutumn`, `leafMaple`; procedural, `lib/leafpaper.ts`: silhouette mask from stretchable caps + serrated side mask, veins, speckle, stem; overlays <= 0.14 opacity; ink/page
  >= 7:1 and link/page >= 4.5:1 is unit-tested for each). Prefs (font/size/width/paper) persist in localStorage `biblio.v1.reader`; `sanitizePrefs` repairs bad values.

## World building (build mode, `B`) — how it works

- Design + phases: `/workspace/knowledge-planning/worldediting-plan.md` Part 2. Built: P0 plumbing, P1 themes,
  P2 wall/floor slots + rug, P3 (overview tint, door pennants, bookcase finish, wall span). Deferred: freeform
  placement, light themes (needs palette-parameterised textures), per-part wallpaper/floor overrides, structure
  editing (Part 1: rename/create/delete/move).
- **Labels on the ROOM note** (never inheritable; slugs/CSV; unknown values = absent): `biblio_theme`,
  `biblio_wing` (this room + sub-rooms, nearest ancestor wins), `biblio_wall` / `biblio_furniture` (CSV per
  slot: `window,painting,-,auto,banner`; `-` empty, `auto` default; unknown entries survive rewrites),
  `biblio_rug`, `biblio_case`, `biblio_span` (0–4). No labels = the old look; the app never writes defaults.
- **Write path:** only `src/lib/labels.ts#setLabel` (refuses non-`biblio_` names, re-fetches the note, edits OWN
  labels only), via `src/lib/worldedit.ts#commitLabel` (patches the in-memory tree + cache, journals an undo
  entry, asks the scene to redraw). Undo journal: `src/lib/edit.ts` (session only, 50 deep).
- **Safety rules (from the adversarial review, all unit-tested):** undo/redo are serialized (no overlapping
  writes) and check the label still holds the value they expect (else `LabelConflictError`, entry stays);
  `commitLabel` takes the cached value as `expectedBefore`; duplicate own labels → the LAST wins (as the
  reader does) and strays are removed; `saveRoomPosition` goes through `setLabel` too; the panel is keyed by
  room and writes to the room it was OPENED for; opening another dialog or pausing the scene ends the preview;
  pointer clicks in the world are ignored while paused.
- **Preview never writes:** `build:preview` event = label overrides applied while the room is drawn
  (`BibliothecaScene.withPreview`); `redrawRoom()` rebuilds in place (no fade, player stays).
- Slot/theme logic is pure and unit-tested: `src/game/themes.ts`, `src/game/decor.ts`, `src/lib/shelving.ts`.
- **Gotcha — Canvas renderer:** headless/no-GPU browsers make Phaser fall back to the Canvas renderer, which
  IGNORES `setTint` and doesn't blend Shapes with `MULTIPLY`. Theme washes are therefore translucent colour
  rectangles (`drawShell`) plus a grade overlay; sprite tints (glass, shafts, flames) only show under WebGL.
- Tree cache key is `biblio.v2.treeCache` (v2 = own labels only).

## Known divergences from the design docs (verified against the code, 2026-10-21)

- **Local-cache-first is only half built:** `biblio.v2.treeCache` is written after every walk/label edit but READ only when the server is unreachable (`App.tsx#handleRefreshError`);
  the world is not shown from the cache while the walk runs.
- **Lazy deeper rooms are not implemented** (the old comment in `config.ts` said so): the walk is BFS with caps (400 notes / depth 8), content beyond is absent.
- **`TreeEdge.notePosition` is always 0**; sibling order is the order of the edges (tree order from `childNoteIds`). The "primary parent" of a clone is the FIRST edge the walk met, not Trilium's flag.
- **Quick capture writes `biblio_inbox` with `createAttribute` directly**, not through `setLabel` (the `biblio_` rule for build code is about `setLabel`; capture is the one other writer).
- The room's "unfiled" case is the design's "desk/pile of scrolls". Texture packs, townsquare, quest board, Socratic chat: not built.

## Networking (DinD)

- Ports are the usual ones (this environment has no port-range restriction):
  5173 dev · 4173 preview · 8081 hosted app · 8080 Trilium mock. The homelab
  opencode setup uses a 31000–31099 window to avoid clashes; there, remap these.
- Low host ports may already belong to another service. Do not trust a `curl`
  returning `200` — it may be someone else's app. Verify by content, not code.
- Reach published containers through the **`dind` service**, not a host or
  gateway IP: container-to-container by compose service name, from here via
  `http://dind:<port>`, from the host via `http://<host-ip>:<port>`.

- **Host browser can't open the mock / hosted app** — `dind` is not a hostname on
  the host; only ports the sidecar publishes to the host loopback are reachable,
  as `http://localhost:<port>`. `.devcontainer/docker-compose.yml` publishes
  `127.0.0.1:18080-18081` → 8080-8081 (host compose commands need
  `-p claudefresh_devcontainer`). Use `http://localhost:18080` as the **server URL in the app's settings** when browsing
  from the host — the app fetches Trilium from the browser. The vite dev server
  (5173) runs in the dev container itself, so VS Code's Ports panel forwards it.
- **Pulls hang inside dind** — Docker Hub IPs rotate and the sidecar firewall is
  hostname→IP; pulls go through the `mirror` service (`--registry-mirror`). Check
  `docker info` shows `Registry Mirrors`.

## Safety

- `/workspace` is a bind mount with **no undo** — no trash, no snapshot.
- Commit before a move, restructure, or bulk edit.
- **Never `rm -rf` a path you haven't listed first.** Print the target, then delete.

## Verification — prove it, don't assert it

Follow the `odd-arcade` pattern: a `tools/check.sh` running real checks, all green
before you call anything done. Implemented:

- `types + build` — tsc strict + vite build
- `unit` — `node tools/unit-test.mjs` (18 sections, pure logic, no network)
- `trilium mock from scratch` — compose down **with volume wipe**, bootstrap
  from zero (setup → password → token), proving the setup is reproducible
- `browser pass` — real headless Chromium against the fresh mock: world mounts,
  vault walks, search opens a book, reader links/prefs/CSP, tree view (when WebGL exists), overview toggles, capture, build mode + undo,
  share target, **zero console errors**
- `etapi integration` — every endpoint above asserted live (create/read/patch/
  delete included)

`npm run test:mock` (mock tooling) is separate and not part of `check.sh`.

`node_modules/`, `shots/` (screenshots) and `.bootstrap.env` (mock credentials)
are gitignored. Do not commit them.

## Git

- Work on **feature branches**. Never commit directly to `main`.
- Never `git push --force` or `git push -f`.
- Never commit `node_modules/`.
- Push **feature branches only**. Pushing `main`/`master` is blocked by policy —
  that is intentional. Do not work around it.

## Working from several machines

This repo is developed from more than one environment (e.g. opencode and Claude
Code devcontainers, each with its own dind sidecar). So: keep
environment-specific notes in clearly labelled bullets (as above), `git pull
--rebase` before starting, push small feature branches, and don't edit the same
file from two machines at once. Agent memory is per machine — decisions that
matter to both belong in this repo (this file, README, HANDOFF), not in memory.

## Docs move with the code (standing rule)

Update the docs **in the same change** as the code — not afterwards, and not
only when someone asks. A change is not done until the docs match it. Concretely,
whenever you add, change or remove something, touch whichever of these it affects
before reporting the work as finished:

- `README.md` — user-visible features/status, quick start, security notes.
- `LOCAL-TESTING.md` — ports, commands, credentials, hotkeys/controls, test recipes.
- `AGENTS.md` — architecture decisions, commands, ports, verified ETAPI contract
  (new endpoints verified → record shape here), gotchas (symptom → cause).
- Config/code comments and `compose.yml` header comments that mention changed
  ports, keys or behaviour.
- Planning docs (`game-ui.md`, `ueberblick.md`, `/workspace/knowledge-planning/*`)
  when a decision or plan changes; mark superseded parts instead of leaving them
  silently wrong.
- Tests: new behaviour gets a unit or browser-test step in the same change.

Also: stale docs are bugs — if you notice one while working, fix it then.

## Maintaining this file

Update it when you learn something a future session would need. Keep it short —
instructions, not a changelog. Record gotchas with the **symptom**, not just the
fix, so they are findable.