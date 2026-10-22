# Reader

Opening a book (`E` at a spine, a leaf in the tree view, a search result, or the room plaque) shows the note in the **reader**, a modal dialog (`src/ui/BookPopup.tsx`, `src/lib/reader.ts`).
Content is fetched when you open it and **never cached**: the vault stays the single source of truth for note bodies.

## What it can show

| Note type | Rendering |
|---|---|
| `text` | Trilium's HTML, used as is (inside the sandbox, below) |
| `markdown` | Rendered with `marked`. On a real v0.106 server markdown notes are `code` notes with a markdown mime; `effectiveType` in `lib/content.ts` treats those as markdown (see [Trilium Mapping](Trilium-Mapping.md#markdown-notes-on-a-real-server)) |
| `code` | Escaped source in a `<pre>` block |
| anything else (canvas, image, file, mermaid, ...) | A notice "No rendered preview for note type ..." plus the raw content. Binary notes are fetched as text, so image and file notes are a known v1 limitation |

The toggle in the header flips any note to its **raw source** ("raw" / "rendered"), the "terminal pane" of the original design.

## Controls

| Control | Action |
|---|---|
| `Esc` | Close |
| `+` / `-` (or `A+` / `A-` buttons) | Text size in steps of 2 px, from 14 to 32 (default 19) |
| `Aa` button | Opens the preferences row: font, size slider, width, paper |
| `Alt+Left` / `Alt+Right` (or the back/forward buttons) | In-reader history |
| Click an internal link | Opens that note inside the reader (adds to history) |
| Click an external link | Asks first ("Open external link ...?"), then opens in a new tab with `noopener,noreferrer` |
| Links bar at the bottom | Lists every internal link of the note, de-duplicated, as buttons |

## Preferences (remembered)

Stored in localStorage `biblio.v1.reader` and repaired on load (`sanitizePrefs`: unknown values fall back to defaults, size is clamped).

- **Font:** Book serif (default), Classic serif, Clean sans, Typewriter.
- **Width:** narrow 560 px, normal 720 (default), wide 920.
- **Paper** (page, desk, ink, link and rule colours): **Parchment** (default), **Book page**, **Sepia**, **Night**, **Study** (dark wood) and **Leaf** (soft green, made to sit next to the tree view). The leaf paper's contrast is unit-tested: ink on page at least 7:1, link on page at least 4.5:1.

## Links

`internalNoteId(href)` recognises Trilium links: `#root/a/b/ID`, `/#root/ID`, `#ID`, and a full `http(s)` URL whose fragment is a tree path (`#root/...`). The target is the **last** path segment that looks like a note id (4 or more of letters, digits, `_`).
A foreign page's `#section` anchor is not a Trilium link. `prepareLinks` rewrites every anchor: internal links get `data-note-id`, external `http(s):`/`mailto:` links get `data-ext`, and everything gets a harmless `href="#"` so the frame can never navigate itself.
Internal links show a small arrow marker and a dotted underline.

## Security model

The note's HTML is untrusted input (it may contain anything the vault ever received). So:

- It is rendered in an `<iframe sandbox="allow-scripts">` **without `allow-same-origin`**: the frame has an opaque origin and no access to the app, its localStorage or the ETAPI token.
- Inside, a **Content-Security-Policy** meta lets only **one** script run: `default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:; script-src 'nonce-<random>'`. Scripts, inline handlers and `javascript:` links inside a note are blocked.
  Our one nonce'd script does nothing but `postMessage` link clicks (`{biblio: 'note' | 'ext', nonce, ...}`).
- A fresh 16-byte random nonce is made per render. The parent accepts a message **only** from its own frame **and** with the matching nonce.
- **Never add `allow-same-origin` and never relax the CSP.** The browser test asserts that the CSP is present.
- Honest limits: `img-src` allows `http:` and `https:` images, so a note with a remote image will make your browser request it. Images that need Trilium session cookies (`/api/attachments/...`) do **not** load, because the app authenticates with a token, not a cookie; this is a documented v1 limitation.

Summary of the whole security stance: [Decisions](Decisions.md#security-model-summary).

## Where the reader is used

The library (`E` at a spine, plaque), the search panel, the tree view (`E` at a leaf), and links inside the reader itself. The room description plaque uses the same note content but flattens it to text. Related: [Library View](Library-View.md), [Tree View](Tree-View-Yggdrasil.md).
