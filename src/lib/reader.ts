/**
 * lib/reader.ts — the reading experience: preferences (font, size, width,
 * paper look), Trilium link recognition, and the sandboxed document builder.
 *
 * Security model (replaces the old script-less iframe): the note HTML is shown in
 * an iframe with `sandbox="allow-scripts"` (NO allow-same-origin → opaque origin,
 * no access to the app) and a Content-Security-Policy that only lets ONE script
 * run — ours, identified by a per-render nonce. Scripts, inline handlers and
 * javascript: URLs inside the note are blocked by the CSP, so a note still
 * cannot execute anything. Our script's only job is to turn link clicks into
 * postMessage events, so links work (in-app navigation) without the iframe
 * being able to navigate itself.
 */

import { STORAGE } from "../config";

// ---------------------------------------------------------------- preferences

export type FontKey = "book" | "classic" | "sans" | "mono";
export type PaperKey = "parchment" | "page" | "sepia" | "night" | "study" | "leaf";
export type WidthKey = "narrow" | "normal" | "wide";

export interface ReaderPrefs {
  font: FontKey;
  /** px, FONT_MIN..FONT_MAX */
  size: number;
  width: WidthKey;
  paper: PaperKey;
}

export const FONT_MIN = 14;
export const FONT_MAX = 32;
export const DEFAULT_PREFS: ReaderPrefs = { font: "book", size: 19, width: "normal", paper: "parchment" };

export const FONTS: Record<FontKey, { label: string; stack: string }> = {
  book: { label: "Book serif", stack: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif" },
  classic: { label: "Classic serif", stack: "Georgia,'Times New Roman',serif" },
  sans: { label: "Clean sans", stack: "system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" },
  mono: { label: "Typewriter", stack: "ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace" },
};

export const WIDTHS: Record<WidthKey, number> = { narrow: 560, normal: 720, wide: 920 };

interface Paper {
  label: string;
  /** Surface the page sits on (the "desk"). */
  desk: string;
  /** The page itself: a CSS background value. */
  page: string;
  ink: string;
  link: string;
  rule: string;
  code: string;
  /** Soft shadow/edge making the page look like paper. */
  edge: string;
}

export const PAPERS: Record<PaperKey, Paper> = {
  parchment: {
    label: "Parchment",
    desk: "#2a2018",
    page: "radial-gradient(ellipse at 50% 40%, #f1e3bf 0%, #e8d6a8 70%, #d9c28c 100%)",
    ink: "#3a2a18", link: "#8a3a1a", rule: "#b8a070", code: "#e2cf9c",
    edge: "0 0 0 1px #b8a070, 0 6px 22px rgba(0,0,0,.55), inset 0 0 60px rgba(120,80,20,.28)",
  },
  page: {
    label: "Book page",
    desk: "#1c1a22",
    page: "linear-gradient(90deg, #ece6d8 0%, #f8f4ea 6%, #f8f4ea 94%, #e4dccb 100%)",
    ink: "#201c18", link: "#1d4f8a", rule: "#cfc6b2", code: "#ece4d0",
    edge: "0 0 0 1px #cfc6b2, 0 6px 22px rgba(0,0,0,.5), inset 14px 0 18px -14px rgba(0,0,0,.25)",
  },
  sepia: {
    label: "Sepia",
    desk: "#2c2418",
    page: "#f2e8d2",
    ink: "#4a3b28", link: "#7a4a1a", rule: "#d0c0a0", code: "#eadfc4",
    edge: "0 0 0 1px #d0c0a0, 0 4px 16px rgba(0,0,0,.45)",
  },
  night: {
    label: "Night",
    desk: "#0c0b10",
    page: "#1c1a24",
    ink: "#d9d3c4", link: "#e8b860", rule: "#3a3648", code: "#14121b",
    edge: "0 0 0 1px #3a3648, 0 6px 22px rgba(0,0,0,.7)",
  },
  study: {
    label: "Study (dark wood)",
    desk: "#14100c",
    page: "#2a2018",
    ink: "#e8dcc0", link: "#d8b868", rule: "#55432c", code: "#14100c",
    edge: "0 0 0 1px #55432c, 0 6px 22px rgba(0,0,0,.6)",
  },
  leaf: {
    label: "Leaf",
    desk: "#2b2016",
    page: "linear-gradient(160deg, #e9f0d2 0%, #dfe9c0 55%, #cddcab 100%)",
    ink: "#26301c", link: "#2f5a1a", rule: "#a9bd86", code: "#d3e0b4",
    edge: "0 0 0 1px #a9bd86, 0 6px 22px rgba(0,0,0,.5), inset 0 0 50px rgba(70,100,30,.22)",
  },
};

export function loadReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE.reader);
    return raw ? sanitizePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveReaderPrefs(p: ReaderPrefs): void {
  try {
    localStorage.setItem(STORAGE.reader, JSON.stringify(p));
  } catch {
    /* preferences are a nicety, never an error */
  }
}

/** Coerce arbitrary stored JSON into valid prefs (unknown values → defaults). */
export function sanitizePrefs(v: unknown): ReaderPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pick = <T extends string>(val: unknown, allowed: Record<string, unknown>, d: T): T =>
    typeof val === "string" && val in allowed ? (val as T) : d;
  const size = typeof o.size === "number" && Number.isFinite(o.size) ? o.size : DEFAULT_PREFS.size;
  return {
    font: pick(o.font, FONTS, DEFAULT_PREFS.font),
    size: Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size))),
    width: pick(o.width, WIDTHS, DEFAULT_PREFS.width),
    paper: pick(o.paper, PAPERS, DEFAULT_PREFS.paper),
  };
}

// --------------------------------------------------------------------- links

/**
 * Trilium internal link href → target noteId, or null if it is not one.
 * Handles `#root/a/b/NOTEID`, `/#root/NOTEID`, `#NOTEID`, `https://host/#root/NOTEID?x=1`
 * and `#root/NOTEID/viewMode`-less variants: the target is the LAST path segment
 * that looks like a note id.
 */
export function internalNoteId(href: string): string | null {
  const hash = href.indexOf("#");
  if (hash === -1) return null;
  // Only same-document or same-app style links: no scheme, or an http(s) URL with a #fragment.
  const before = href.slice(0, hash);
  if (before !== "" && before !== "/" && !/^https?:\/\/[^#]*$/i.test(before)) return null;
  const frag = href.slice(hash + 1).split("?")[0];
  // A full URL to some other site with a #fragment is only a Trilium link when the
  // fragment is a tree path (#root/…); `#section` on a foreign page is just an anchor.
  if (before !== "" && before !== "/" && !frag.startsWith("root/")) return null;
  const segments = frag.split("/").filter((s) => s !== "");
  const last = segments[segments.length - 1];
  return last && /^[A-Za-z0-9_]{4,}$/.test(last) ? last : null;
}

export interface LinkInfo {
  noteId: string;
  /** Link text as shown in the note. */
  text: string;
}

/**
 * Rewrite every <a> in the note HTML for the sandbox: internal links get
 * `data-note-id`, external http(s)/mailto links get `data-ext`, everything gets
 * a harmless href="#". Returns the new HTML and the de-duplicated internal links.
 * Browser-only (uses DOMParser).
 */
export function prepareLinks(html: string): { html: string; links: LinkInfo[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links: LinkInfo[] = [];
  const seen = new Set<string>();
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    const id = internalNoteId(href);
    a.removeAttribute("target");
    if (id) {
      a.setAttribute("data-note-id", id);
      a.classList.add("biblio-link");
      if (!seen.has(id)) {
        seen.add(id);
        links.push({ noteId: id, text: (a.textContent ?? "").trim() || id });
      }
    } else if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute("data-ext", href);
      a.classList.add("biblio-ext");
    }
    a.setAttribute("href", "#");
  });
  return { html: doc.body.innerHTML, links };
}

// ------------------------------------------------------------------ document

/** Random per-render nonce for the CSP (only our script may run). */
export function makeNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const CLICK_SCRIPT = `
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('a') : null;
  if (!a) return;
  e.preventDefault();
  var id = a.getAttribute('data-note-id');
  var ext = a.getAttribute('data-ext');
  if (id) parent.postMessage({ biblio: 'note', nonce: NONCE, noteId: id }, '*');
  else if (ext) parent.postMessage({ biblio: 'ext', nonce: NONCE, href: ext }, '*');
});
`;

/**
 * The full srcdoc for the reader iframe. `bodyHtml` should already have gone
 * through prepareLinks() when links should be clickable.
 */
export function readerDocument(bodyHtml: string, prefs: ReaderPrefs, nonce: string): string {
  const p = PAPERS[prefs.paper];
  const font = FONTS[prefs.font].stack;
  const maxW = WIDTHS[prefs.width];
  const mono = FONTS.mono.stack;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:; script-src 'nonce-${nonce}'">
<style>
  html { background: ${p.desk}; }
  body { margin: 0; padding: 28px 16px 56px; }
  .page {
    box-sizing: border-box; max-width: ${maxW}px; margin: 0 auto; padding: 44px 56px 56px;
    background: ${p.page}; color: ${p.ink}; box-shadow: ${p.edge};
    min-height: calc(100vh - 84px); font-family: ${font}; font-size: ${prefs.size}px; line-height: 1.65; overflow-wrap: anywhere;
  }
  @media (max-width: 640px) { .page { padding: 24px 20px 32px; } }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.3em 0 .5em; font-weight: 700; }
  h1 { font-size: 1.7em; border-bottom: 1px solid ${p.rule}; padding-bottom: .2em; }
  h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
  p { margin: .8em 0; }
  a { color: ${p.link}; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  a.biblio-link { text-decoration-style: dotted; }
  a.biblio-link::after { content: "\\2197"; font-size: .7em; vertical-align: super; opacity: .7; margin-left: 1px; }
  img { max-width: 100%; }
  code, pre { font-family: ${mono}; font-size: .86em; }
  pre { background: ${p.code}; border: 1px solid ${p.rule}; padding: 12px 14px; overflow-x: auto; border-radius: 3px; }
  :not(pre) > code { background: ${p.code}; padding: 1px 5px; border-radius: 3px; }
  blockquote { border-left: 3px solid ${p.rule}; margin: 1em 0; padding: 0 1.1em; opacity: .9; font-style: italic; }
  hr { border: 0; border-top: 1px solid ${p.rule}; margin: 1.6em 0; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid ${p.rule}; padding: 5px 10px; }
  th { background: ${p.code}; }
  ul, ol { padding-left: 1.5em; }
  .raw-pre { white-space: pre-wrap; }
  .degraded-note { font-style: italic; opacity: .8; }
</style></head><body><div class="page">${bodyHtml}</div>
<script nonce="${nonce}">${CLICK_SCRIPT.replace(/NONCE/g, JSON.stringify(nonce))}</script></body></html>`;
}
