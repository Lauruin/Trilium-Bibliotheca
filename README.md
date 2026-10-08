# Bibliotheca

**Your Trilium vault as a walkable pixel-art library.** A standalone React +
Phaser web app that reads Trilium Notes over its external REST API (ETAPI) and
renders the note tree as an explorable side-scroller world: folders become
rooms, tags become shelves, notes become books on those shelves.

Formerly the SiYuan biblio plugin idea — **SiYuan is abandoned; Trilium is the
target** (see `AGENTS.md` for the architecture decision).

## Status — v0.1, first vertical slice

Working, tested against a disposable Trilium v0.106.0:

- **Walkable rooms** — one folder = one room; child folders are doors; the
  tree is navigated by walking and interacting (`E`), at any depth.
- **Shelves & books** — leaf notes stand on shelves grouped by their labels
  ("tags"); unlabelled notes pile up as scrolls on a desk; spine colour comes
  from the note's own `#color` label or a stable per-tag palette; spine size
  follows the title (real note length would need a content fetch per note —
  later).
- **Reading** — opening a book renders the note in a script-less sandboxed
  iframe (HTML for text notes, markdown for markdown notes, source for code);
  a toggle flips to the raw source ("terminal pane").
- **Search** — the Wisp is a front-end for Trilium's full-text search.
- **Socrates** — a statue and an honest placeholder: the RAG/chat
  "intelligence service" is a later plane of the architecture, so he admits
  he can't talk yet instead of faking it.
- **Room layout** — every room's grid position is stored ON the room's note
  as two labels (`biblio_x`, `biblio_y`), so it syncs with the vault and
  survives renames/moves. Overview mode (`O`) shows all rooms as blocks:
  drag to re-arrange (writes the labels back via ETAPI), click to enter.
  New rooms without stored positions are auto-placed in reading order —
  manual placements always win.
- **Local-cache-first** — the tree snapshot persists in localStorage; when
  the server is unreachable the world still opens from the cache, with a
  clear "offline" indicator.

Not built yet (deliberately): multiple libraries/townsquare hub, quest board
(calendar), Socratic chat, texture-pack swapping, canvas/corkboard rooms,
mobile/touch controls. The persona-debate findings in the planning docs
deliberately deferred all of these.

## Quick start

```bash
# 1. A disposable Trilium (Docker; publishes on port 31090)
docker compose up -d

# 2. Bootstrap it headlessly: sets up an empty document, sets the test
#    password, mints an ETAPI token, writes .bootstrap.env (gitignored)
tools/trilium-bootstrap.sh

# 3. The app
npm install
npm run dev            # http://localhost:31085
```

Open http://localhost:31085, enter the server URL and password/token in the
settings dialog (pre-seeded from `.env.local` if present — see
`.env.example`). For a *real* Trilium instance, point the server URL at it
and make sure it allows cross-origin access:

```ini
# config.ini [Network] section (or TRILIUM_NETWORK_CORS_* env vars, since v0.93.0)
corsAllowOrigin=http://localhost:31085
corsAllowMethods=GET,POST,PUT,PATCH,DELETE,OPTIONS
corsAllowHeaders=Authorization,Content-Type
```

## Verification

```bash
npm test   # = tools/check.sh
```

All four checks must be green: strict types + build; the disposable Trilium
rebuilt from a wiped volume (reproducibility); a real headless-browser pass
(world mounts, search opens a book, zero console errors); and live ETAPI
integration asserting every endpoint the app depends on. The verified
endpoint contract and the headless auth bootstrap are recorded in
[`AGENTS.md`](AGENTS.md).

## Architecture in one paragraph

Trilium has no plugin SDK, so this is **not** a Trilium extension — it is a
separate web app talking to the stable, documented ETAPI. Everything that
knows Trilium lives in `src/lib/trilium/` (one client, wire types from the
official OpenAPI spec); `src/lib/library.ts` maps the note tree to the
world's vocabulary (rooms/shelves/books); `src/game/` is Phaser (one room
built fresh on every entry, so the world can't drift from the vault);
`src/ui/` is the React overlay (HUD, book popup, settings), bridged by a
typed event bus. Room positions are the only thing the app writes, and they
are written as labels on the notes themselves. Details and the full doc map
of the original planning docs live in [`AGENTS.md`](AGENTS.md) and the
planning docs at the repo root (`game-ui.md` is the world design source).

## Security notes

- The ETAPI token is stored in this browser's localStorage — a deliberate
  v1 trade-off since the app has no backend of its own. Anyone with access
  to that browser profile can read the token. A widget wrapper inside
  Trilium (planned, later) would remove the token from the picture entirely.
- Note content is rendered in a script-less sandboxed iframe (`sandbox=""`),
  so note HTML cannot execute in the app.
- The app writes only one kind of data: the two `biblio_*` layout labels on
  room notes. No note content, titles or structure are ever modified.
- The compose.yml mock sets `corsAllowOrigin=*` and a known password —
  **for the throwaway test instance only**. Never do this on a real vault.

## License

MIT for this code. Trilium itself is AGPL-3.0 (this app only talks to its
unmodified API); all art is generated in code at runtime, so no third-party
asset licenses apply.