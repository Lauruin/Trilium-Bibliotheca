# Mock and Seeding

**There is no shared Trilium to test against.** Every real Trilium instance on the development machine is in use, so the project stands up its own disposable one and can also run a Docker-free fake. Never point a test or seed tool at a real vault.
This page summarises the "Trilium mock" section of `AGENTS.md`, which is the authoritative version (it also holds the verified ETAPI contract). Commands: [Getting Started](Getting-Started.md); the tests that use these: [Testing](Testing.md); every script: [tools/README.md](../tools/README.md).

## Three pieces, one generator

| Piece | What it is | Start it |
|---|---|---|
| **Real mock** | A real Trilium (`triliumnext/trilium:v0.106.0`) in Docker, from `compose.yml`, in the `dind` daemon. Named volume `trilium-mock-data`. Credentials in `.bootstrap.env` (gitignored). Port 8080 (host: 18080 in the devcontainer setup). | `tools/trilium-bootstrap.sh` |
| **Fake** | `tools/etapi-fake.mjs`: an in-memory ETAPI server (only `node:http`) so tests and development run **without Docker**. | `npm run mock:fake -- --seed medium` |
| **Vault generator** | `tools/lib/vault-gen.mjs` (deterministic specs) and `tools/lib/vault-apply.mjs` (write them through ETAPI to either server). Used by `seed-vault.js`, the fake's `--seed` and `mock-test.mjs`. | `node tools/seed-vault.js [profile]` |

### Real mock lifecycle

```bash
tools/trilium-bootstrap.sh                 # start if needed, make sure a working token exists
tools/trilium-bootstrap.sh --recreate      # wipe the volume and bootstrap from zero
tools/trilium-bootstrap.sh --down          # stop and remove the container
BOOTSTRAP_SERVICES=trilium tools/trilium-bootstrap.sh   # only the mock; skip the hosted-app image build
```

It is idempotent: a still-valid token in `.bootstrap.env` means "nothing to do"; else a password login; else a full headless setup (`/api/setup/new-document`, `/set-password` form post, `/etapi/auth/login`). Password `biblio-test-pw` (override with `BIBLIOTHECA_TEST_PASSWORD`). `/setup` returning "Failed to lookup view" is normal on v0.106: setup is SPA-driven.

### Seeding the real mock

```bash
node tools/seed-vault.js [profile]        # default medium; --seed N (default 1)
node tools/seed-vault.js --list           # profiles and their real numbers (no network)
node tools/seed-vault.js --clean [profile]
```

It builds **one** top-level note `Mock Vault (<profile>)` (deleted and rebuilt on every run, so it is idempotent; the note ends up last under root), 8 requests in parallel with progress, and then **verifies** by walking what the server holds (it fails on a mismatch).
`--clean` without a profile removes every top-level `Mock Vault (...)` note. **Safety:** it refuses any URL that is not the one in `.bootstrap.env` unless the server is an etapi-fake (recognised by `app-info.buildRevision`); only an etapi-fake may be targeted with `--url`/`--token`. It only ever deletes `Mock Vault (...)` notes.
The `medium` vault is left in the mock for browsing (app server `http://localhost:18080`, root note `root`).
`tools/seed-demo.js` (tiny: a "Bibliotheca Demo" room) and `tools/seed-rich.js` (hand-made "Rich Mock Library", uses calendar/day-note/attachment endpoints that the fake lacks) stay as they are.

### The fake

`npm run mock:fake -- --seed medium [--port N] [--host H] [--password P] [--token T] [--vault-seed N] [--markdown-type]` prints `TRILIUM_URL=` and `TRILIUM_TOKEN=`; it never touches `.bootstrap.env`. In-process: `startFake({seed, port, ...})` returns `{url, token, store, close()}`.

Implements: app-info; auth (bare, Bearer and Basic tokens; `/auth/login` and logout); notes GET/PATCH/DELETE; content GET/PUT; `GET /notes?search=` (words, quoted phrases, `#label[=v]`, `~relation`, `note.<prop> op v`, and/or, parentheses, archived hidden, `ancestorNoteId`, `limit`, `fastSearch`, ...); create-note; attributes; branches (clones); `refresh-note-ordering`; CORS with preflight;
the real `{status, code, message}` error envelope; content-hash `blobId`s; inheritable labels listed with the **owner's** `noteId`; attribute-name normalisation.
**Not implemented:** `not(...)`, fuzzy operators, attachments, revisions, calendar/day notes, backup, import/export.
**Deliberate differences:** it refuses clone cycles and parent-less branches (the real server accepts them and corrupts itself, see below), it refuses to delete root, result order is tree order, and ids come from a seeded PRNG.

### Conformance: `npm run test:mock`

One assertion suite runs against the fake and the real mock; recorded shapes must match. See [Testing](Testing.md#mock-tooling-tests-npm-run-testmock). The real part touches only its scratch subtree `zz mock-test ...`.

## Profiles

`PROFILES` in `tools/lib/vault-gen.mjs`; `node tools/seed-vault.js --list` prints the real numbers. Everything is deterministic: `(profile, seed)` gives identical specs.

| Profile | Notes | Shape |
|---|---|---|
| `small` | 40 | Every theme in miniature, depth 4 |
| `medium` | 160 | A believable personal vault, depth 4, widest folder 13; fits the walk caps |
| `large` | 600 | Past `TREE_WALK.maxNodes` (400): the app's BFS stops at about 400 notes (batches of 8 may overshoot a few) |
| `huge` | 1500 | Past both caps, depth 17, a 34-wide folder |
| `deepchain` | 76 | 25 nested folders (+2 notes each): past `TREE_WALK.maxDepth` (8) |
| `widefan` | 182 | One folder with exactly 150 children (notes + 10 small folders) |
| `longtail` | 46 | Text/code/markdown notes from tiny to about 200,000 characters (leaf sizes; the `len` label holds the exact length) |

The balanced profiles (small to huge) are themed folders: Projects (inheritable `#workspace`, `#project`, `#status`, uppercase `#Priority`, `blockedBy` relations), Reading list (`#book #author #year #rating`, Favourites as clones, `relatedTo`), Recipes, Journal (year/month/day, `#dateNote`),
Research (papers, `cites` relations, mind maps, mermaid, a saved search), Code snippets (language folders with an **inheritable** `#lang`), Meeting notes, Ideas (including an "Attribute zoo" of odd names and values), Archive (`#archived` and a deepening chain), Media & files (valid PNGs, a tiny PDF, csv/txt/json) and Wiki (internal `#root/<id>` links).
Note types: text, code (markdown is `code` with mime `text/x-markdown`), canvas, mermaid, mindMap, image, file, search. A few rooms carry our `biblio_*` layout labels and a few leaves `#biblio_leaf`. The word lists never produce "hello" (the browser test searches for it) and the vault never carries `#biblio_inbox`.

### What the app does with the big ones

`walkLibraryTree` is a BFS from the root with at most 400 fetched notes and depth 8; batches of 8 mean the count lands in 400 to 407. Notes beyond the cap are absent; a note at depth 8 is kept with its children not fetched; either sets `tree.truncated` and the toast "Vault larger than the walk cap". Because the app walks from `root`, the other top-level notes of the mock compete for the same 400 notes.

## Markdown notes

ETAPI v0.106 has no `markdown` type, so the generator sends markdown notes as `code` with mime `text/x-markdown`. `--markdown-type` (seed-vault and the fake) sends `markdown` to the **fake only**; since the app maps `code` plus a markdown mime to `markdown` (`effectiveType`), the maple leaf and the rendered markdown path show up with either form, so this flag is no longer needed to see them.

## Gotchas (symptom to cause)

- **Search on the real mock answers 500 `Maximum call stack size exceeded` (also DELETE of some notes) after a test run.** An invalid `POST /branches` corrupted Trilium's in-memory tree: a clone cycle (`noteId` is a descendant or itself) or a missing `parentNoteId` (the request answers 400/500 but the cache keeps a broken branch). The DB is fine: `docker restart bibliotheca-trilium-mock` (the token survives). A cycle can also be removed with `DELETE /branches/<parent>_<note>`. Never send either to the real mock; the fake refuses both.
- **`POST /etapi/auth/logout` on the mock kills the token in `.bootstrap.env`** for everybody using it; re-run `tools/trilium-bootstrap.sh` (mints a new one) and tell the others. Logins are rate-limited (`X-RateLimit-Limit: 10`, successful ones count).
- **`PUT /notes/:id/content` answers 500 "Cannot set null content".** Only `Content-Type: text/plain` (text/code) and `application/octet-stream` (binary) are read; `text/html` fails, `application/json` fails with another 500. Binary notes: create with `content: ""`, then PUT the bytes.
- Real-server quirks the fake copies: own attributes are listed in creation order (a PATCH of `position` does not reorder), inherited ones after; search with `ancestorNoteId` includes that note itself; archived notes are excluded unless `includeArchivedNotes=true`; `=` compares case-insensitively; an unknown `note.<prop>` matches everything;
  parentheses and bare words after `and` are **not** understood by the real search (the fake is more forgiving, do not rely on that); default mimes are text `text/html`, code `text/plain`, mermaid `text/vnd.mermaid`, canvas/mindMap/relationMap `application/json`, file `application/octet-stream`; an untitled create-note becomes "New note"; the same content gives the same `blobId`.
- Notes created with initial content through `create-note` have **no automatic `internalLink` relations**; only content saved by the Trilium editor or a follow-up `PUT` with `text/plain` does. (Relevant for the *planned* link features.)

## Adding a profile

See [Contributing](Contributing.md#add-a-seed-profile).
