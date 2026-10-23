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
import { leafDecor, type LeafVariant } from "./leafpaper";

// ---------------------------------------------------------------- preferences

export type FontKey = "book" | "classic" | "sans" | "mono";
export type PaperKey = "parchment" | "page" | "sepia" | "night" | "study" | "leaf" | "leafAutumn" | "leafMaple";
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
  /** Leaf papers: which procedural leaf (lib/leafpaper.ts) is drawn around and under the page. */
  leaf?: LeafVariant;
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
    leaf: "spring",
  },
  leafAutumn: {
    label: "Leaf (autumn)",
    desk: "#2a2014",
    page: "linear-gradient(160deg, #f6e8b8 0%, #efd68f 55%, #e3c06e 100%)",
    ink: "#33230d", link: "#8a3414", rule: "#cdb072", code: "#ecd9a0",
    edge: "0 0 0 1px #cdb072, 0 6px 22px rgba(0,0,0,.5)",
    leaf: "autumn",
  },
  leafMaple: {
    label: "Leaf (maple)",
    desk: "#241512",
    page: "linear-gradient(160deg, #f4d2b4 0%, #ecb68f 55%, #e19f78 100%)",
    ink: "#2b1409", link: "#7e1a1a", rule: "#cf9a78", code: "#efc3a0",
    edge: "0 0 0 1px #cf9a78, 0 6px 22px rgba(0,0,0,.5)",
    leaf: "maple",
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
  const { html: out, links } = prepareDocument(html);
  return { html: out, links };
}

// ------------------------------------------------------------------ document

/** Random per-render nonce for the CSP (only our script may run). */
export function makeNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}


export interface OutlineItem {
  /** The id we give the heading in the sandboxed document ("bh-0", "bh-1", ...). */
  id: string;
  /** 1..4 */
  level: number;
  text: string;
}

export interface PreparedDocument {
  html: string;
  /** De-duplicated internal links, in document order. */
  links: LinkInfo[];
  /** h1..h4 in document order (for the outline panel). */
  outline: OutlineItem[];
  /** Word count of the visible text (for the reading-time estimate). */
  words: number;
}

/** Reading time in whole minutes at ~220 words per minute (at least 1 for any text at all, 0 for none). */
export function readingMinutes(words: number): number {
  return words > 0 ? Math.max(1, Math.round(words / 220)) : 0;
}

/**
 * `prepareLinks` plus the heading outline: gives every h1..h4 a stable id (`bh-N`, marked `data-bh`) so the
 * reader can scroll to it and report which one is current, and counts the words. Browser-only (DOMParser).
 */
export function prepareDocument(html: string): PreparedDocument {
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
  const outline: OutlineItem[] = [];
  doc.querySelectorAll("h1, h2, h3, h4").forEach((h, i) => {
    const text = (h.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const id = `bh-${i}`;
    h.setAttribute("id", id);
    h.setAttribute("data-bh", "1");
    outline.push({ id, level: Number(h.tagName.slice(1)), text });
  });
  const plain = (doc.body.textContent ?? "").trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  return { html: doc.body.innerHTML, links, outline, words };
}

/**
 * The only script that runs in the reader iframe (CSP nonce). It: turns link clicks into postMessage events;
 * reports scroll progress and the current heading; scrolls to a heading on request; finds and highlights text
 * on request; forwards a few shortcut keys (the iframe swallows them when it has focus); restores the scroll
 * position. Messages from the parent are accepted only from `parent` and only with the nonce.
 */
const READER_SCRIPT = String.raw`
(function () {
  var NONCE = NONCE_TOKEN;
  var RESTORE = RESTORE_TOKEN;
  function post(o) { o.nonce = NONCE; parent.postMessage(o, '*'); }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    e.preventDefault();
    var id = a.getAttribute('data-note-id');
    var ext = a.getAttribute('data-ext');
    if (id) post({ biblio: 'note', noteId: id });
    else if (ext) post({ biblio: 'ext', href: ext });
  });

  document.addEventListener('keydown', function (e) {
    var k = e.key, mod = e.ctrlKey || e.metaKey;
    var fwd = k === 'Escape' || k === 'F3' ||
      ((k === '+' || k === '=' || k === '-' || k === '_') && !mod && !e.altKey) ||
      (e.altKey && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'z' || k === 'Z')) ||
      (mod && (k === 'f' || k === 'F')) ||
      ((k === '[' || k === ']') && !mod && !e.altKey);
    if (!fwd) return;
    if (mod || k === 'F3') e.preventDefault();
    post({ biblio: 'key', key: k, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });
  });

  var marks = [], cur = -1;
  function clearFind() {
    marks.forEach(function (m) {
      var p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
    marks = []; cur = -1;
  }
  function show() {
    marks.forEach(function (m, i) { m.classList.toggle('cur', i === cur); });
    if (cur >= 0) marks[cur].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function find(q) {
    clearFind();
    if (!q) { post({ biblio: 'found', count: 0, index: -1 }); return; }
    var root = document.querySelector('.page');
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = w.nextNode())) {
      var pn = n.parentNode && n.parentNode.nodeName;
      if (pn === 'SCRIPT' || pn === 'STYLE') continue;
      nodes.push(n);
    }
    var lq = q.toLowerCase(), count = 0;
    for (var i = 0; i < nodes.length && count < 500; i++) {
      var t = nodes[i], text = t.nodeValue, lt = text.toLowerCase();
      if (lt.length !== text.length) continue;
      var pos = 0, idx, last = 0, frag = null;
      while (count < 500 && (idx = lt.indexOf(lq, pos)) !== -1) {
        if (!frag) frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(text.slice(last, idx)));
        var m = document.createElement('mark');
        m.className = 'biblio-find';
        m.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(m);
        marks.push(m);
        last = idx + q.length; pos = last; count++;
      }
      if (frag) {
        frag.appendChild(document.createTextNode(text.slice(last)));
        t.parentNode.replaceChild(frag, t);
      }
    }
    cur = marks.length ? 0 : -1;
    show();
    post({ biblio: 'found', count: marks.length, index: cur });
  }
  function step(d) {
    if (!marks.length) return;
    cur = (cur + d + marks.length) % marks.length;
    show();
    post({ biblio: 'found', count: marks.length, index: cur });
  }

  var heads = Array.prototype.slice.call(document.querySelectorAll('[data-bh]'));
  var ticking = false;
  function report() {
    ticking = false;
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    var id = '';
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= 96) id = heads[i].id; else break;
    }
    post({ biblio: 'scroll', frac: Math.min(1, Math.max(0, y / max)), head: id });
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(report); }
  }, { passive: true });

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || d.nonce !== NONCE) return;
    if (d.biblio === 'goto') {
      var el = document.getElementById(String(d.id));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (d.biblio === 'find') find(String(d.q || ''));
    else if (d.biblio === 'findStep') step(d.dir < 0 ? -1 : 1);
    else if (d.biblio === 'findClear') clearFind();
    else if (d.biblio === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function restore() {
    if (RESTORE > 0) {
      var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, RESTORE * max);
    }
    report();
  }
  window.addEventListener('load', function () { restore(); setTimeout(restore, 350); });
})();
`;

/** Document-level options for `readerDocument`. */
export interface ReaderDocOptions {
  /** Scroll position to restore after load, 0..1 of the scrollable height (default: top). */
  restore?: number;
}

/**
 * The full srcdoc for the reader iframe. `bodyHtml` should already have gone through prepareDocument()
 * when links should be clickable.
 */
export function readerDocument(bodyHtml: string, prefs: ReaderPrefs, nonce: string, opts: ReaderDocOptions = {}): string {
  const p = PAPERS[prefs.paper];
  const font = FONTS[prefs.font].stack;
  const maxW = WIDTHS[prefs.width];
  const mono = FONTS.mono.stack;
  const decor = p.leaf ? leafDecor(p.leaf, maxW) : null;
  const restore = Number.isFinite(opts.restore) ? Math.min(1, Math.max(0, opts.restore as number)) : 0;
  const script = READER_SCRIPT.replace("NONCE_TOKEN", JSON.stringify(nonce)).replace("RESTORE_TOKEN", String(restore));
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:; script-src 'nonce-${nonce}'">
<style>
  html { background: ${p.desk}; }
  body { margin: 0; padding: 28px 16px 56px; }
  .page {
    --leaf-base: ${p.page};
    box-sizing: border-box; max-width: ${maxW}px; margin: 0 auto; padding: 44px 56px 56px;
    background: ${p.page}; color: ${p.ink}; box-shadow: ${p.edge};
    min-height: calc(100vh - 84px); font-family: ${font}; font-size: ${prefs.size}px; line-height: 1.65; overflow-wrap: anywhere;
  }
  @media (max-width: 640px) { .page { padding: 24px 20px 32px; } }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.3em 0 .5em; font-weight: 700; }
  h1 { font-size: 1.7em; border-bottom: 1px solid ${p.rule}; padding-bottom: .2em; }
  h2 { font-size: 1.4em; } h3 { font-size: 1.15em; }
  h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
  p { margin: .8em 0; }
  a { color: ${p.link}; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  a.biblio-link { text-decoration-style: dotted; }
  a.biblio-link::after { content: "\\2197"; font-size: .7em; vertical-align: super; opacity: .7; margin-left: 1px; }
  img { max-width: 100%; height: auto; }
  code, pre { font-family: ${mono}; font-size: .86em; }
  pre { background: ${p.code}; border: 1px solid ${p.rule}; padding: 12px 14px; overflow-x: auto; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  :not(pre) > code { background: ${p.code}; padding: 1px 5px; border-radius: 3px; }
  blockquote { border-left: 3px solid ${p.rule}; margin: 1em 0; padding: 0 1.1em; opacity: .9; font-style: italic; }
  hr { border: 0; border-top: 1px solid ${p.rule}; margin: 1.6em 0; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid ${p.rule}; padding: 5px 10px; vertical-align: top; }
  th { background: ${p.code}; }
  ul, ol { padding-left: 1.5em; }
  mark { background: rgba(255, 220, 90, .55); color: inherit; padding: 0 1px; border-radius: 2px; }
  kbd { font-family: ${mono}; font-size: .8em; border: 1px solid ${p.rule}; border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: ${p.code}; }
  sub, sup { line-height: 0; }
  details { border: 1px solid ${p.rule}; border-radius: 4px; padding: .3em .8em; margin: 1em 0; }
  summary { cursor: pointer; font-weight: 600; }
  .raw-pre { white-space: pre-wrap; }
  .degraded-note { font-style: italic; opacity: .8; }
  .text-file-note { font-size: .8em; opacity: .7; margin: 0 0 .8em; }

  /* what Trilium's editor (CKEditor) writes */
  figure { margin: 1em 0; }
  figure.image { text-align: center; }
  figure.image img { display: inline-block; }
  figure.image figcaption, figure.table figcaption { font-size: .85em; opacity: .75; margin-top: .35em; text-align: center; }
  figure.image-style-side, figure.image-style-align-right { float: right; max-width: 50%; margin: .3em 0 .8em 1.4em; }
  figure.image-style-align-left { float: left; max-width: 50%; margin: .3em 1.4em .8em 0; }
  figure.image-style-block-align-left { text-align: left; }
  figure.image-style-block-align-right { text-align: right; }
  figure.table { display: block; overflow-x: auto; }
  figure.table table { margin: 0 auto; }
  .text-tiny { font-size: .7em; } .text-small { font-size: .85em; } .text-big { font-size: 1.4em; } .text-huge { font-size: 1.8em; }
  .marker-yellow { background: #fdfd77; color: #222; } .marker-green { background: #62f962; color: #222; }
  .marker-pink { background: #fc7899; color: #222; } .marker-blue { background: #72ccfd; color: #222; }
  .pen-red { color: #e91313; background: none; } .pen-green { color: #118800; background: none; }
  ul.todo-list { list-style: none; padding-left: .3em; }
  .todo-list__label { display: inline-flex; align-items: baseline; gap: .55em; }
  .todo-list__label input[type="checkbox"] { accent-color: ${p.link}; margin: 0; transform: translateY(.1em); }
  .todo-list__label input:checked + span { text-decoration: line-through; opacity: .6; }
  aside.admonition { margin: 1.1em 0; padding: .5em 1.1em; border-left: 4px solid #7a8aa0; border-radius: 3px; background: rgba(120, 140, 170, .16); }
  aside.admonition.tip { border-left-color: #3f9b5a; background: rgba(63, 155, 90, .16); }
  aside.admonition.important { border-left-color: #8f5fc7; background: rgba(143, 95, 199, .16); }
  aside.admonition.caution { border-left-color: #d68a1c; background: rgba(214, 138, 28, .16); }
  aside.admonition.warning { border-left-color: #c43c3c; background: rgba(196, 60, 60, .16); }
  section.include-note { border: 1px dashed ${p.rule}; border-radius: 4px; padding: .1em 1em; margin: 1em 0; }
  .math-tex { font-family: ${mono}; font-size: .9em; background: ${p.code}; padding: 0 4px; border-radius: 3px; }
  .footnote-reference { font-size: .75em; vertical-align: super; line-height: 0; }
  .footnote-section, section.footnotes { border-top: 1px solid ${p.rule}; margin-top: 2em; padding-top: .6em; font-size: .88em; }
  mark.biblio-find { background: rgba(255, 213, 79, .6); }
  mark.biblio-find.cur { background: rgba(255, 150, 40, .85); outline: 2px solid rgba(255, 120, 20, .9); }
${decor ? decor.css : ""}
</style></head><body>${decor ? decor.before : ""}<div class="page">${bodyHtml}</div>${decor ? decor.after : ""}
<script nonce="${nonce}">${script}</script></body></html>`;
}

// ------------------------------------------------------------ scroll memory

const SCROLL_KEEP = 200;

/** Parse the stored scroll map; anything malformed is dropped entry by entry (never throws). */
export function sanitizeScrollMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = Math.min(1, Math.max(0, val));
  }
  return out;
}

/** Where the reader was in this note last time (0..1), or 0. */
export function recallScroll(noteId: string): number {
  try {
    const raw = localStorage.getItem(STORAGE.readerScroll);
    return raw ? sanitizeScrollMap(JSON.parse(raw))[noteId] ?? 0 : 0;
  } catch {
    return 0;
  }
}

/** Remember the scroll position of a note. Near the top (< 2 %) forgets the note; keeps the 200 most recent. */
export function rememberScroll(noteId: string, frac: number): void {
  try {
    const raw = localStorage.getItem(STORAGE.readerScroll);
    const map = raw ? sanitizeScrollMap(JSON.parse(raw)) : {};
    delete map[noteId]; // re-insert last = most recent
    if (Number.isFinite(frac) && frac >= 0.02) map[noteId] = Math.min(1, frac);
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - SCROLL_KEEP))) delete map[k];
    localStorage.setItem(STORAGE.readerScroll, JSON.stringify(map));
  } catch {
    /* a nicety, never an error */
  }
}
