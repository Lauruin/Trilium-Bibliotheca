---
name: trilium-etapi
description: Use before writing or changing any code that talks to Trilium Notes over ETAPI (the external REST API) — endpoints, auth/token bootstrap, search syntax, attribute rules, CORS. Covers the contract verified against v0.106.0 plus the rest of the official spec.
---

# Trilium ETAPI

Source of truth: `apps/server/src/assets/etapi.openapi.yaml` in
TriliumNext/Trilium (fetch the raw file from GitHub when in doubt — do not
guess endpoints). `AGENTS.md` in this repo records what was actually verified
live; prefer it over this file where they disagree, and add new verifications
there.

## Rules of this project
- All ETAPI calls live in `src/lib/trilium/client.ts`. Nothing else uses `fetch`
  against Trilium.
- Never test against a real Trilium instance; use the disposable mock
  (`compose.yml`, `tools/trilium-bootstrap.sh`).
- Base path `/etapi`. Auth: `Authorization: <token>` (bare or `Bearer`), or
  Basic auth with any username and the **ETAPI token** as password (not the
  Trilium password).

## Auth bootstrap (verified, headless, v0.106)
A fresh instance has no password and no token.
1. `GET /api/setup/status` → `{isInitialized}`
2. If not initialized: `POST /api/setup/new-document?skipDemoDb` JSON `{locale:"en"}` → 204
3. `POST /set-password` — **form-encoded** `password1`, `password2` (not JSON) → 302
4. `POST /etapi/auth/login` JSON `{password}` → 201 `{authToken}`
(`tools/trilium-bootstrap.sh` does all of this idempotently.)
- `GET /etapi/app-info` → **401 `NOT_AUTHENTICATED` without a token is the
  expected "alive" response**, not a bug. 200 with a valid token.
- Too many bad logins → 429 and the IP is blacklisted for a while.
- `POST /etapi/auth/logout` invalidates a token.

## Endpoints (spec paths; ✔ = verified live in this repo)
| Area | Endpoint |
|---|---|
| Notes | ✔ `POST /create-note` `{parentNoteId,title,type,content,…}` → `{note,branch}` |
| | ✔ `GET /notes?search=…` → `{results:[Note…]}` (full notes) |
| | ✔ `GET /notes/{id}` (attributes, `childNoteIds` in tree order, `parentNoteIds`) |
| | `PATCH /notes/{id}`, ✔ `DELETE /notes/{id}` → 204 |
| | ✔ `GET /notes/{id}/content` (raw; HTML for text notes) · `PUT /notes/{id}/content` |
| | `GET /notes/{id}/export` (zip), `POST /notes/{id}/import`, `POST /notes/{id}/undelete`, `GET /notes/history` |
| Branches | `POST /branches`, `GET/PATCH/DELETE /branches/{id}`, `POST /refresh-note-ordering/{parentNoteId}` |
| Attributes | ✔ `POST /attributes` `{noteId,type,name,value}` · ✔ `PATCH /attributes/{id}` `{value,position}` · ✔ `DELETE /attributes/{id}` · `GET /attributes/{id}` |
| Attachments | `POST /attachments`, `GET/PATCH/DELETE /attachments/{id}`, `/attachments/{id}/content`, `GET /notes/{id}/attachments` |
| Revisions | `POST /notes/{id}/revision`, `GET /notes/{id}/revisions`, `/revisions/{id}`, `/revisions/{id}/content` |
| Calendar | `GET /inbox/{date}`, `/calendar/days/{date}`, `/calendar/weeks/{week}`, `/calendar/week-first-day/{date}`, `/calendar/months/{month}`, `/calendar/years/{year}` |
| Meta | ✔ `GET /app-info`, `PUT /backup/{backupName}`, `GET /metrics` |

## Search (`GET /notes?search=…`)
Query syntax is Trilium's own search language (`towers #book`, `"exact phrase"`).
Optional params: `fastSearch=true` (don't search content), `includeArchivedNotes`,
`ancestorNoteId` (restrict to a subtree), `ancestorDepth` (`eq1`, `lt4`, `gt2`…),
`orderBy`, `orderDirection`, `limit`, `debug`.
Idea not yet tried here: one search scoped with `ancestorNoteId` could replace
the per-note `GET /notes/{id}` walk in `library.ts` — verify with the probe
script before relying on it.

## Gotchas
- **Attribute names are normalised**: dots are stripped (`biblio.x` → `biblio_x`).
  Use underscores from the start. Our own labels: `biblio_x`, `biblio_y`.
- **Label names from the API are not guaranteed lowercase.** Compare
  case-insensitively (the noise-label list in `library.ts` is camelCase).
- Trilium's internal `_hidden` subtree is not user content; skip it.
- A note can have several parents (clones); don't assume one parent.
- **CORS** (since v0.93.0) is off by default: the instance must set
  `TRILIUM_NETWORK_CORS_ALLOW_ORIGIN` (+ `_METHODS`, `_HEADERS`) for a
  browser app. The mock sets `*`; a real instance should list this app's origin.
- `/setup` returns "Failed to lookup view" on v0.106 — expected; setup is SPA-driven.
- Binary notes (image/file) return bytes from `/content`; don't treat as text.
- Error body shape: `{status, code, message}`.

## When you verify something new
Add the endpoint and its observed response shape to `AGENTS.md` ("Verified
ETAPI contract") and extend `tools/etapi-probe.sh`.
