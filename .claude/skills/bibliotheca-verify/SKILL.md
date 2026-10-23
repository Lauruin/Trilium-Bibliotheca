---
name: bibliotheca-verify
description: How to verify Trilium-Bibliotheca changes without wasting a session (test order, software-GL gotchas, mock cleanup, docs checklist). Use before running tests or finishing any change in this repo.
---

# Verifying a change in Trilium-Bibliotheca

Run in this order, stop at the first red: `npx tsc -b` -> `node tools/unit-test.mjs` (~10 s) -> `node tools/mock-test.mjs --no-real` -> `node tools/browser-test.js` (10-20 min under software GL). **Never `npm test`** (it wipes the mock). Never touch a real Trilium; the mock is `.bootstrap.env`.

## Gotchas that cost sessions (symptom -> cause)
- Browser test times out at a `waitForFunction`: options go THIRD, `waitForFunction(fn, undefined, { timeout })`; `(fn, { timeout })` silently means 30 s.
- A keypress does nothing in the test: a focused `<input>` / checkbox swallows game keys -> `document.activeElement.blur()`.
- After the library -> tree round trip `window.__treeScene` is the OLD scene until the new one mounts: clear it before pressing `T`.
- "an Yggdrasil folder exists already": an aborted earlier run left the test's folder in the mock. List `#biblio_yggdrasil` via ETAPI and delete the test's `Yggdrasil` note (disposable mock only).
- Leaked Chromium after `process.exit` in a probe script: `pkill -f "[c]hrome-linux64"` (never put the bare pattern in the same command line: it kills your own shell).
- Software GL runs ~1 fps: use `scene.advance(seconds)` for simulation, wait on `scene.frameCount`, give generous timeouts.
- Blank 3D view with shadows on + GL "texture format and sampler type" errors: a never-rendered frozen shadow map (`SunShadows.syncUpdate`).
- Probe scripts: put them in `tools/_*.js`, delete afterwards; `shots/_*.png` too.

## Docs checklist (same change as the code)
README (user-visible), AGENTS.md (architecture / gotchas, symptom -> cause), wiki page of the feature, LOCAL-TESTING.md (keys / recipes), tools/README.md (new test files), comments. New behaviour gets a unit or browser step.

## Git
Feature branch only, commit locally per green milestone, never push `main`, never force-push; trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No rename of the project / repo without an explicit yes.
