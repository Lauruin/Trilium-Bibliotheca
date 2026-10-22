/**
 * lib/content.ts — turns raw note content into displayable HTML.
 *
 * Trilium content types (v0.106): text notes store HTML (CKEditor output),
 * code notes store source, markdown notes store markdown source. We never
 * render with scripts: everything goes into a CSP-locked sandboxed iframe (see
 * lib/reader.ts), so even Trilium's own HTML output can't execute JS in our UI.
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
/** Trilium v0.106 stores markdown notes as type "code" with a markdown mime; treat them as markdown everywhere. */
export function effectiveType(type: string, mime: string | undefined): string {
  return type === "code" && /markdown/i.test(mime ?? "") ? "markdown" : type;
}

export function renderNoteContent(type: string, mime: string, content: string): RenderedContent {
  type = effectiveType(type, mime);
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
