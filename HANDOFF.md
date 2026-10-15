# Knowledge App — Handoff

> **⚠ This document is outdated (SiYuan era, 2026-09).** Kept for context on
> how the project evolved; the decisions worth keeping were re-homed into
> `AGENTS.md` (current state, verified ETAPI contract) and `README.md`
> (what Bibliotheca is today). Read those first.

Status as of 2026-09-24: user is trial-running self-hosted SiYuan (can't set up Radicale/Tailscale for a few more days). Nothing built yet — planning docs only. Re-read this file first on resume, then follow the links below for whatever's relevant to the immediate task; don't re-derive anything already decided.

## Doc map

- **`thoughts.md`** — original wishlist, unedited. The source of truth for what the user actually asked for.
- **`architecture-scope.md`** — three-planes overview (SiYuan + Radicale data plane, intelligence service, game-skin client) and the build order. Start here for the big picture.
- **`backend-research.md`** — why SiYuan, full gap analysis vs. the wishlist, every alternative note app considered and why it was ruled out, Trilium reconsidered, plugin ecosystem, licensing.
- **`scheduling-calendar.md`** — the todo/calendar subsystem: Radicale, client-side CalDAV architecture, Google migration, Proton Calendar ruled out, Android client stack, SiYuan-plugin option.
- **`game-ui.md`** — the game-skin client in full: perspective/engine choice, room/door/NPC/shelf concept, texture packs, dynamic tilemap, Phase 3 game modes, alternatives if the full world is too much.
- **`persona-debate.md`** — six-persona critical debate (2026-09-25) with independent GitHub verification: found real gaps (no disaster-recovery plan, WebCalDav is itself a hobby project) and one sharp unasked question (does gamification even solve the stated problem). Read before acting on any of the game-UI or calendar-plugin recommendations elsewhere.
- **`infrastructure/networking-access.md`** — remote access and ops: Tailscale decision, Android VPN conflict + fixes, Fritzbox specifics, locked-down-device access, optional ProtonVPN exit-node routing, and the Proton Drive backup/disaster-recovery plan. Infra-only docs live under `infrastructure/` — separate from the design/decision docs above; more will land there once servers are actually stood up (hosting/Docker specifics, etc.).

## User's stated priorities (don't lose these under the interesting tangents)

In order: **quick capture** of thoughts, **reliable** todos/calendar (explicitly called out as needing "good implementation," more important than game-UI polish), **everything synced**. Mobile app is "nice, not a dealbreaker" (softer than the original hard Android requirement, doesn't reverse it). The game world is the fun part but is not the priority bar — build order reflects this (see `architecture-scope.md`).

## Before development starts — setup checklist

1. **SiYuan self-hosted** and reachable via Tailscale from wherever Claude Code runs.
2. **Radicale self-hosted** alongside it (see `scheduling-calendar.md`).
3. **OpenRouter API key** + a chosen default cheap model, stored in an env var/`.env` (never committed).
4. **Decision on embeddings**: local model (e.g. a small sentence-transformer via Ollama or similar) vs. an embedding API — cost/privacy tradeoff, still open.
5. **A dedicated project folder with git initialized** — e.g. a new `code/knowledgeapp` subfolder in this repo (matches the pattern of the other `code/*` subprojects already here), so work can be committed incrementally like normal software, not just planning docs.
6. **Recommended: bootstrap GSD planning** — this repo already uses the GSD skill system for other subprojects (see `.planning/`). Once ready, `/gsd-ingest-docs` (feeding it the docs above) or `/gsd-new-project` gives structured phase planning instead of ad hoc building — recommended given the project has several distinct phases (backend, calendar, game UI) that benefit from goal-backward verification per phase.
7. **Optional: a browser-automation MCP** (e.g. chrome-devtools or Playwright) for visually verifying the Phaser game UI directly, rather than relying on the user to screenshot/describe it. Not set up in this environment yet.
8. **Confirm phase order**: intelligence service → calendar/task pipeline → game UI, per `architecture-scope.md` — don't start on the game skin first.

## Rough cost/effort expectation (Claude Code, Sonnet 5 pricing: $2/$10 per MTok in/out)

Loose, directional only — actual cost depends heavily on iteration count and debugging loops, not just feature scope:
- **Intelligence service** (indexing, RAG chat, one agent persona, tested against SiYuan's API): a handful of focused sessions, roughly 500K–1.5M tokens total. At Sonnet 5 rates that's single-digit-to-low-teens dollars of raw API-equivalent usage.
- **Calendar/task pipeline** (Radicale + client module, tested plain): smaller than the above, a session or two once servers exist.
- **Game UI** (Phaser + React overlay, mapped to real folder/tag/task data): more iteration-heavy since visual/UX work needs repeated look-and-adjust cycles — roughly 2–4x the backend's cost, likely a few million tokens total if built incrementally, room by room, over several weeks.
- **If on a Claude subscription (Pro/Max)** rather than pay-per-token API billing: none of this is extra cost beyond the plan — it only matters against the plan's rolling usage limits. Token cost only becomes real money if billed via direct API key.
- Default to Sonnet 5 (current model) for most implementation work; reach for Opus only on genuinely hard architecture/design decisions where the higher cost buys meaningfully better judgment.

## Open questions (consolidated, detail in the linked doc)

- Local embeddings vs. an embedding API — cost/privacy tradeoff not yet decided. (`architecture-scope.md`)
- **Local model vs. GDPR-hosted provider for the chat/agent endpoint itself** — separate, larger tension than the embeddings question above: sending note content to any external model conflicts with the project's self-hosted/no-cloud stance elsewhere. Not yet resolved, decide before building the chat/agent endpoint. (`architecture-scope.md`)
- Physical hosting target (which home machine runs SiYuan + Radicale + the intelligence service) — networking approach itself is decided (Tailscale), this is just which box. (`infrastructure/networking-access.md`)
- Whether siyuan-plugin-caldav-sync supports note→calendar (not just calendar→note), and its reliability against Radicale — untestable until servers exist. (`scheduling-calendar.md`)
- Whether SiYuan's native quick-capture already satisfies "put my thoughts down quickly" — check during the trial. (`scheduling-calendar.md`)
- Whether to throwaway-prototype the "no-engine" alternative before committing to Phaser+Capacitor — low-stakes, engine choice is otherwise settled. (`game-ui.md`)

## Next session should

1. Ask how the SiYuan trial went — specific friction points, not just yes/no.
2. Check whether Radicale/Tailscale are set up yet; if not, that's the blocker, not code.
3. If proceeding: start with the intelligence service (see `architecture-scope.md` build order), not the game UI.
4. Re-read this file + whichever linked doc is relevant before re-deriving anything.
