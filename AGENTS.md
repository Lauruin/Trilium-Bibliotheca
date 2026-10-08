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

Not yet scaffolded. Fill this in the moment real scripts exist, then delete this note.

- Install: `npm install`
- Dev server: `npm run dev` — publish on a port in **31000–31099**
- Build: `npm run build`
- Test: `npm test`

## Networking (DinD)

- Spawned services publish **only within ports 31000–31099.**
- Low host ports may already belong to another service. Do not trust a `curl`
  returning `200` — it may be someone else's app.
- Reach published containers through the **`dind` service**, not a host or gateway IP.
- From inside a container, `http://[IP_ADDRESS]:<port>/` is the fastest way to
  confirm a service is serving at all.
- **`odd-arcade` currently owns 31080.** Check what is taken before claiming a port.

## Safety

- `/workspace` is a bind mount with **no undo** — no trash, no snapshot.
- `git init` **before** the first destructive step, not after.
- Commit before a move, restructure, or bulk edit.
- **Never `rm -rf` a path you haven't listed first.** Print the target, then delete.

## Verification — prove it, don't assert it

Follow the `odd-arcade` pattern: a `tools/check.sh` running real checks, all green
before you call anything done. Planned:
- build passes
- dev server serves `200` on its port
- ETAPI integration against the disposable Trilium in DinD (auth, read a note, write a note)
- the Trilium container is torn down and recreated from scratch, proving the setup is reproducible
- browser pass: every screen mounts, zero console errors

`node_modules/` and screenshots are gitignored. Do not commit them.

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