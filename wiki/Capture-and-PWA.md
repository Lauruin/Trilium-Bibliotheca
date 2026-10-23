# Capture and PWA

Quick capture is the one feature that **creates notes**. The PWA parts (install, Android share target) make capture reachable from a phone. The phone side as a whole is **parked**: it works in principle and is not actively developed or tested.

## Quick capture

| Step | What happens |
|---|---|
| `C` (or the **capture** button) | Opens the box. Ignored while you type in an input, while another dialog is open, or before any settings exist |
| Type | The first non-empty line becomes the **title** (shortened to 60 characters with an ellipsis); blank-line-separated chunks become paragraphs, single newlines become line breaks; all text is HTML-escaped |
| `Ctrl+Enter` (or `Cmd+Enter`, or the **save** button) | Files a new **text** note under the inbox. The box stays open and clears, so rapid-fire capture costs no extra clicks; the footer counts "N saved to Inbox" |
| `Esc` / close | Closes. If you captured anything, a toast "N note(s) captured to Inbox." appears and the world refreshes so new notes (and the Inbox room on first use) show up |

**The inbox** is the note carrying the label `#biblio_inbox`, found by a Trilium search. If none exists, an **"Inbox"** text note is created under your library root note and labelled, so the first capture just works.
You can later rename or move the Inbox; the label travels with the note. Once it has children it is a room like any other. If saving fails, the error is shown and your text is kept so you can retry.

The game's movement letters (`a d e w o`, `Space`) can be typed into the box: the scene does not capture keys (a regression the browser test covers).

## Installing as an app

The app ships a web manifest and a service worker, so a browser can offer to install it ("Add to home screen").

- **Needs HTTPS** (a secure context). A plain `http://` LAN address will not install; see the next section.
- The service worker (`public/sw.js`) is deliberately **cache-free**: it has an empty fetch handler, because the app needs the live Trilium anyway and a caching worker would serve stale bundles. Its presence is what makes the app installable.
  It is only registered in production builds (not under `npm run dev`).
- The manifest link uses `crossorigin="use-credentials"`, so installability still works when an authenticating proxy (for example Pangolin SSO) sits in front of the app.
- Icons are `icon-192.png` and `icon-512.png`; the display mode is `standalone`.

## Android share target

The manifest declares a `share_target` (`GET /`, parameters `title`, `text`, `url`). Share a page or text from another app to "Bibliotheca" and capture opens **prefilled** with the title, the text and the URL (a URL already inside the text is not repeated).
The app then clears the query string from the address bar, so a reload does not capture the same thing twice. On a first run the settings dialog comes first, then the capture box. The prefill logic is `sharedText()` in `src/lib/capture.ts` and is unit-tested; the browser test also drives it.

## Phone controls (parked)

On coarse-pointer devices (or with `?touch=1` on a desktop) on-screen buttons appear in the library view: left, right, jump, interact, and up one folder. Tapping spines, doors and NPCs directly also works. The tree view has no touch controls.

## Away from home: HTTPS with Pangolin

Install and share target need HTTPS. With **hosted mode** (see [Getting Started](Getting-Started.md#hosted-container-optional)) it is one resource:

1. Publish **only the app** (container port 8081) as an HTTPS resource with Pangolin SSO in front. Trilium needs no public address and no CORS: the app's nginx reaches it internally and adds the ETAPI token, so the browser only talks to the app's origin and the SSO cookie covers `/etapi/` too.
2. Anyone past the SSO can read, and unless `BIBLIO_TRILIUM_READONLY=1` write labels and capture notes into, that Trilium through the app. Fine solo; use read-only for anything shared.
3. `BIBLIO_TRILIUM_PUBLIC_URL` (optional) makes "open in Trilium" links work; otherwise the real address stays hidden.

Without hosted mode (two public resources, cross-origin): both need HTTPS (mixed content is blocked), Trilium's CORS must allow the app's exact origin (`TRILIUM_NETWORK_CORS_ALLOW_ORIGIN=https://app.example.com`, not `*`, plus the methods/headers from Getting Started), and an SSO redirect in front of the *Trilium* resource breaks the browser's cross-origin ETAPI calls (leave auth off there or let `/etapi/*` through).

Check your Pangolin version's documentation for the exact resource and rule options. The proxy itself is tested end to end (`npm run test:proxy`, including a real browser) but **not against a live Pangolin**.

## Away from home: Tailscale

The networking decision in `infrastructure/networking-access.md` is **plain Tailscale** (a peer-to-peer mesh VPN) rather than a tunnel service, since a tunnel puts a third party in the traffic path. For testing the share target from a phone, `LOCAL-TESTING.md` suggests, on the machine that runs the containers:

**HOST**

```bash
tailscale serve --bg 18081
```

Then open the printed `https://...ts.net` URL on the phone, install the app and share a page to Bibliotheca. Trilium must **also** be reachable over HTTPS from the phone and allow that origin through CORS. (Not verified end to end in this documentation pass.)

Related: [Decisions](Decisions.md#security-model-summary) (the token lives in the browser), [Troubleshooting](Troubleshooting.md).
