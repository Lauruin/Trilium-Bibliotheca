/**
 * lib/content.ts — turns raw note content into displayable HTML.
 *
 * Trilium content types (v0.106): text notes store HTML (CKEditor output),
 * code notes store source, markdown notes store markdown source. We never
 * render with scripts: everything goes into a sandboxed iframe (see
 * BookPopup), so even Trilium's own HTML output can't execute JS in our UI.
 *
 * Known v1 limitation: image references inside text notes
 * (/api/attachments/...) need Trilium session cookies; with ETAPI-token
 * auth they won't load in the sandboxed iframe. Documented in the README.
 */

import { marked } from "marked";

/** Render markdown source to HTML. marked is synchronous when not told otherwise. */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface RenderedContent {
  /** Ready-to-embed HTML fragment (for the sandboxed iframe). */
  html: string;
  /** True when the content type had no dedicated preview and we fell back. */
  degraded: boolean;
}

/** Render note content by Trilium note type. Always returns something viewable. */
export function renderNoteContent(type: string, mime: string, content: string): RenderedContent {
  switch (type) {
    case "text":
      // Trilium text notes are already HTML fragments.
      return { html: content, degraded: false };
    case "markdown":
      return { html: renderMarkdown(content), degraded: false };
    case "code":
      return {
        html: `<pre class="raw-pre"><code>${escapeHtml(content)}</code></pre>`,
        degraded: false,
      };
    default:
      return {
        html:
          `<p class="degraded-note">No rendered preview for note type <code>${escapeHtml(
            type,
          )}</code> (mime <code>${escapeHtml(mime || "?")}</code>). ` +
          `Showing the raw source instead.</p>` +
          `<pre class="raw-pre"><code>${escapeHtml(content)}</code></pre>`,
        degraded: true,
      };
  }
}

/** The "terminal" toggle: always show the true source, whatever the type. */
export function renderRawContent(content: string): string {
  return `<pre class="raw-pre"><code>${escapeHtml(content)}</code></pre>`;
}

/**
 * The document shell for the sandboxed iframe. `srcdoc` content has no access
 * to our page, so styling must be self-contained. A script-less sandbox
 * (sandbox="" — no allow-scripts) makes execution structurally impossible.
 */
export function bookDocument(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Georgia, 'Times New Roman', serif; color: #e8dcc0;
           background: #2a2018; margin: 16px 20px; line-height: 1.55; }
    h1,h2,h3,h4 { color: #f0e2c0; line-height: 1.25; }
    a { color: #d8b868; }
    img { max-width: 100%; }
    code, pre { font-family: ui-monospace, 'Cascadia Mono', Menlo, monospace; font-size: 0.9em; }
    pre { background: #1a1410; border: 1px solid #4a3a28; padding: 10px;
          overflow-x: auto; border-radius: 4px; }
    blockquote { border-left: 3px solid #6a5a3a; margin: 8px 0; padding: 2px 12px;
                 color: #cbbfa5; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #55432c; padding: 4px 8px; }
    th { background: #3a2d1e; }
    .raw-pre { background: #14100c; }
    .degraded-note { color: #b89a6a; font-style: italic; }
  </style></head><body>${bodyHtml}</body></html>`;
}