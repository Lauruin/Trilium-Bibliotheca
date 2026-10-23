# Reader

Opening a book (`E` at a spine, a leaf in the tree view, a search result, or the room plaque) shows the note in the **reader**, a modal dialog (`src/ui/BookPopup.tsx`, `src/lib/reader.ts`).
Content is fetched when you open it and **never cached**: the vault stays the single source of truth for note bodies.

## What it can show

| Note type | Rendering |
|---|---|
| `text` | Trilium's HTML, used as is (inside the sandbox, below) |
| `markdown` | Rendered with `marked`. On a real v0.106 server markdown notes are `code` notes with a markdown mime; `effectiveType` in `lib/content.ts` treats those as markdown (see [Trilium Mapping](Trilium-Mapping.md#markdown-notes-on-a-real-server)) |
| `code` | Escaped source in a `<pre>` block |
| `image`, `file` | Fetched as **bytes** (`GET /notes/{id}/content`), and the kind is decided from the bytes (magic numbers, `lib/media.ts`), not from the note's mime (a fresh image note can have an empty mime): a **picture** (PNG, JPEG, GIF, WEBP, AVIF, BMP, SVG; click toggles fit / actual size), a **PDF** (the browser's own viewer in an *unsandboxed* iframe on a blob we label `application/pdf`; the viewer does not work inside a sandbox), a **text file** (shown as text, cut at 2 MB), otherwise a **download card**. Anything over 40 MB is a download. Shown by `ui/MediaView.tsx` in the popup itself, not in the sandbox (an `<img>` never runs scripts) |
| anything else (canvas, mermaid, mind map, ...) | A notice "No rendered preview for note type ..." plus the raw content |

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
| Links bar at the bottom | Previous / next note in the same folder, and every internal link of the note, de-duplicated, as buttons |
| `Ctrl+F` (or `find`) | Find in note: highlights every match (up to 500) inside the sandbox, `Enter` / `Shift+Enter` or `F3` step through, `Esc` closes |
| `outline` button | Panel with the note's headings (h1 to h4); a click scrolls there, the current heading is highlighted |
| `[` / `]` | Previous / next note among the siblings in the walked tree |
| `Alt+Z` (or `zen`) | Zen mode: only the page |
| `link` / `Trilium` buttons | Copy a link to the note / open it in Trilium's own web UI (best effort: `#root/<path>` from the walked tree) |

Above the page: the **breadcrumb** (clickable ancestors), the note's own labels as chips (no `biblio_*`, no Trilium bookkeeping labels), the last edit date and a reading-time estimate (220 words/min). The scroll position of every note is remembered (`biblio.v1.readerScroll`, the 200 most recent, forgotten near the top).

## Preferences (remembered)

Stored in localStorage `biblio.v1.reader` and repaired on load (`sanitizePrefs`: unknown values fall back to defaults, size is clamped).

- **Font:** Book serif (default), Classic serif, Clean sans, Typewriter.
- **Width:** narrow 560 px, normal 720 (default), wide 920.
- **Paper** (page, desk, ink, link and rule colours): **Parchment** (default), **Book page**, **Sepia**, **Night**, **Study** (dark wood) and three **leaf** papers: **Leaf** (spring green), **Leaf (autumn)** and **Leaf (maple)**. A leaf paper is drawn by `lib/leafpaper.ts` (pure, deterministic): a pointed leaf silhouette (top cap with a stem, serrated sides, tapering tip: a mask built from stretchable caps and a solid middle, so a one-line note and a very long one both look right), a midrib with curved side veins and a fine speckle at very low opacity (<= 14 %), and a drop shadow that follows the shape. The text area stays an ordinary rectangle. Contrast is unit-tested for every leaf paper: ink on page at least 7:1, link on page at least 4.5:1.

## Links

`internalNoteId(href)` recognises Trilium links: `#root/a/b/ID`, `/#root/ID`, `#ID`, and a full `http(s)` URL whose fragment is a tree path (`#root/...`). The target is the **last** path segment that looks like a note id (4 or more of letters, digits, `_`).
A foreign page's `#section` anchor is not a Trilium link. `prepareLinks` rewrites every anchor: internal links get `data-note-id`, external `http(s):`/`mailto:` links get `data-ext`, and everything gets a harmless `href="#"` so the frame can never navigate itself.
Internal links show a small arrow marker and a dotted underline.

## Security model

The note's HTML is untrusted input (it may contain anything the vault ever received). So:

- It is rendered in an `<iframe sandbox="allow-scripts">` **without `allow-same-origin`**: the frame has an opaque origin and no access to the app, its localStorage or the ETAPI token.
- Inside, a **Content-Security-Policy** meta lets only **one** script run: `default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:; script-src 'nonce-<random>'`. Scripts, inline handlers and `javascript:` links inside a note are blocked.
  Our one nonce'd script only talks to the parent through `postMessage`: link clicks (`{biblio: 'note' | 'ext', nonce, ...}`), scroll progress and the current heading, find results, and a few forwarded shortcut keys (the iframe swallows keys while it has focus). The parent talks back (scroll to a heading, find, step, clear), and the script accepts those only from `parent` and only with the nonce.
- A fresh 16-byte random nonce is made per render. The parent accepts a message **only** from its own frame **and** with the matching nonce. **Every document gets its own `<iframe>` element** (`key` = the nonce): browsers sometimes ignore a `srcdoc` change while the first document is still loading, which once left a stale page (broken pictures, lost find messages) on screen.
- **Never add `allow-same-origin` and never relax the CSP.** The browser test asserts that the CSP is present.
- Honest limits: `img-src` allows `http:` and `https:` images, so a note with a remote image will make your browser request it.
- **Pictures embedded in text notes** (`<img src="api/attachments/ID/image/name.png">` or `api/images/NOTEID/...`) need Trilium's session cookie, which the app does not have. `lib/embeds.ts` finds those `src` values, fetches the bytes through ETAPI with the token (`/attachments/{id}/content`, `/notes/{id}/content`), **checks that the bytes really are a picture** (an HTML or script response is rejected), and inlines them as `data:` URLs; limits: 6 MB per picture, 24 MB and 40 pictures per note, otherwise a small "picture unavailable" placeholder (so the sandbox never requests the Trilium URL). SVG is inlined as an *image* data URL, where scripts do not run. Other remote images are left alone.
- The PDF view is the one place where something other than our own sandboxed document is shown: a blob of a file from your vault in the browser's PDF viewer (which has its own sandbox). Images and PDFs get the type from their **bytes**, never from the server's mime.

Summary of the whole security stance: [Decisions](Decisions.md#security-model-summary).

## Where the reader is used

The library (`E` at a spine, plaque), the search panel, the tree view (`E` at a leaf), and links inside the reader itself. The room description plaque uses the same note content but flattens it to text. Related: [Library View](Library-View.md), [Tree View](Tree-View-Yggdrasil.md).
