/**
 * lib/leafreader.ts — turning a note into text for the LEAF VIEW (the ant's reader): PURE, no DOM, unit-tested (tools/unit-leaf.mjs).
 *
 * The leaf view shows a note as plain text on a leaf (headings, paragraphs, lists, quotes, code), not as the full-fidelity HTML of the normal
 * reader (that stays one key away for images, tables and the like). So here the note's HTML / markdown / code becomes a short list of
 * `Block`s (text only: no tag, no attribute, no script ever survives), which `layoutBlocks` wraps into lines for a given column width and a
 * measuring function (the canvas' `measureText` in the app, a fixed-width stand-in in the tests). Everything is bounded and never throws:
 * a note is untrusted input.
 */

import { marked } from "marked";

export type BlockKind = "h1" | "h2" | "h3" | "p" | "li" | "quote" | "code" | "hr";

export interface Block {
  kind: BlockKind;
  text: string;
  /** List nesting depth (li) and the bullet / number shown before it. */
  depth?: number;
  mark?: string;
}

/** Largest note text the leaf view lays out (characters); the rest is cut with a notice. */
export const LEAF_TEXT_MAX = 200_000;
const BLOCK_MAX = 4000;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", copy: "©", reg: "®", deg: "°", middot: "·", bull: "•", times: "×", euro: "€", auml: "ä", ouml: "ö", uuml: "ü", szlig: "ß",
  Auml: "Ä", Ouml: "Ö", Uuml: "Ü", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", rarr: "→", larr: "←",
};

/** Decode the entities of a text node (named: the common ones; numeric: any valid code point); unknown ones are dropped. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,10});/gi, (_m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 31 && cp < 0x110000 && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "";
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? "";
  });
}

const clean = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]+/g, " ");

/** HTML (as Trilium's editor writes it, or anything else) -> text blocks. Scripts, styles, comments and every tag are dropped. */
export function htmlToBlocks(html: string): Block[] {
  const full = String(html ?? "");
  const cut = full.length > LEAF_TEXT_MAX * 2;
  const src = full.slice(0, LEAF_TEXT_MAX * 2)
    .replace(/<!--[\s\S]*?(-->|$)/g, " ")
    .replace(/<(script|style|head|svg|math)\b[\s\S]*?(<\/\1\s*>|$)/gi, " ");
  const out: Block[] = [];
  let buf = "";
  let kind: BlockKind = "p";
  let pre = false;
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let liMark = "";
  let quote = 0;
  let total = 0;
  const flush = (): void => {
    const raw = clean(decodeEntities(buf));
    buf = "";
    const text = pre ? raw.replace(/^\n+|\s+$/g, "") : raw.replace(/\s+/g, " ").trim();
    if (!text || total > LEAF_TEXT_MAX) return;
    total += text.length;
    const k: BlockKind = pre ? "code" : kind === "li" ? "li" : quote > 0 && kind === "p" ? "quote" : kind;
    const b: Block = { kind: k, text: text.slice(0, BLOCK_MAX) };
    if (k === "li") {
      b.depth = Math.max(0, lists.length - 1);
      b.mark = liMark;
    }
    out.push(b);
    kind = lists.length > 0 && k === "li" ? "li" : "p";
  };
  for (const tok of src.split(/(<[^>]*>?)/g)) {
    if (!tok) continue;
    if (tok[0] !== "<") {
      buf += tok;
      continue;
    }
    const m = /^<\s*(\/?)\s*([a-z][a-z0-9]*)/i.exec(tok);
    if (!m) continue;
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        flush();
        kind = close ? "p" : tag === "h1" ? "h1" : tag === "h2" ? "h2" : "h3";
        break;
      case "p": case "div": case "section": case "article": case "figure": case "figcaption": case "table": case "tr": case "details": case "summary": case "dt": case "dd":
        flush();
        kind = lists.length > 0 ? "li" : "p";
        break;
      case "blockquote":
        flush();
        quote = Math.max(0, quote + (close ? -1 : 1));
        break;
      case "pre":
        flush();
        pre = !close;
        break;
      case "ul": case "ol":
        flush();
        if (close) lists.pop();
        else lists.push({ ordered: tag === "ol", n: 0 });
        kind = lists.length > 0 ? "li" : "p";
        break;
      case "li":
        flush();
        if (!close && lists.length > 0) {
          const L = lists[lists.length - 1];
          L.n++;
          liMark = L.ordered ? `${L.n}.` : "•";
          kind = "li";
        }
        break;
      case "br":
        buf += pre ? "\n" : " ";
        break;
      case "td": case "th":
        if (close) buf += " | ";
        break;
      case "hr":
        flush();
        out.push({ kind: "hr", text: "" });
        break;
      default:
        break;
    }
  }
  flush();
  if (cut || total > LEAF_TEXT_MAX) out.push({ kind: "p", text: "… (the note goes on; open it in the reader to see all of it)" });
  return out;
}

/** Markdown -> blocks (rendered with `marked`, then reduced to text exactly like HTML; raw HTML in the markdown is dropped by the same tokenizer). */
export function markdownToBlocks(md: string): Block[] {
  let html = "";
  try {
    html = marked.parse(String(md ?? "").slice(0, LEAF_TEXT_MAX), { async: false }) as string;
  } catch {
    return plainToBlocks(md);
  }
  return htmlToBlocks(html);
}

/** Plain text / code -> one code block per run of lines separated by blank lines. */
export function plainToBlocks(text: string): Block[] {
  const t = String(text ?? "").slice(0, LEAF_TEXT_MAX);
  const out: Block[] = [];
  for (const chunk of t.split(/\n[ \t]*\n/)) {
    const c = clean(chunk).replace(/^\n+|\s+$/g, "");
    if (c) out.push({ kind: "code", text: c.slice(0, BLOCK_MAX) });
  }
  return out;
}

/** The blocks for a note of this (effective) type; types without readable text give one explanatory block. */
export function blocksFor(type: string, content: string): Block[] {
  if (type === "text") return htmlToBlocks(content);
  if (type === "markdown") return markdownToBlocks(content);
  if (type === "code") return plainToBlocks(content);
  return [{ kind: "p", text: `This kind of note (${type || "unknown"}) has no text to read on a leaf: open it in the reader.` }];
}

// ---- layout ---------------------------------------------------------------------------------------------------------------------------

export interface Metrics {
  /** Width in px of `text` at `size` px, bold or not. */
  measure(text: string, size: number, bold: boolean, mono: boolean): number;
}

export interface LaidLine {
  x: number;
  y: number;
  text: string;
  size: number;
  bold: boolean;
  mono: boolean;
  kind: BlockKind;
  /** Index of the block it belongs to. */
  block: number;
  /** A bullet / number drawn to the left of the first line of a list item. */
  mark?: string;
}

export const LINE_HEIGHT = 1.45;
const SIZES: Record<BlockKind, number> = { h1: 27, h2: 23, h3: 20, p: 17, li: 17, quote: 17, code: 14.5, hr: 10 };

/** Wrap blocks into lines for a column `width` px wide (greedy, word by word; a word wider than the column is broken). Total height included. */
export function layoutBlocks(blocks: readonly Block[], width: number, m: Metrics): { lines: LaidLine[]; height: number } {
  const W = Math.max(80, Number.isFinite(width) ? width : 400);
  const lines: LaidLine[] = [];
  let y = 0;
  blocks.forEach((b, bi) => {
    const size = SIZES[b.kind] ?? 17;
    const bold = b.kind === "h1" || b.kind === "h2" || b.kind === "h3";
    const mono = b.kind === "code";
    const lh = size * LINE_HEIGHT;
    if (b.kind === "hr") {
      lines.push({ x: 0, y: y + lh / 2, text: "", size, bold: false, mono: false, kind: "hr", block: bi });
      y += lh + size * 0.5;
      return;
    }
    const indent = b.kind === "li" ? 20 + (b.depth ?? 0) * 20 : b.kind === "quote" ? 18 : 0;
    const avail = Math.max(40, W - indent);
    if (b.kind === "h1" || b.kind === "h2") y += size * 0.35; // a little air above a heading
    const paras = mono ? b.text.split("\n") : [b.text];
    let first = true;
    for (const para of paras) {
      const words = mono ? [para] : para.split(" ");
      let cur = "";
      const put = (text: string): void => {
        lines.push({ x: indent, y, text, size, bold, mono, kind: b.kind, block: bi, mark: first && b.kind === "li" ? b.mark : undefined });
        first = false;
        y += lh;
      };
      if (mono) {
        // code keeps its line breaks and leading spaces; a line wider than the column is cut by width
        let rest = para.replace(/\t/g, "  ");
        if (rest === "") put("");
        while (rest.length > 0) {
          let n = rest.length;
          while (n > 1 && m.measure(rest.slice(0, n), size, false, true) > avail) n = Math.max(1, Math.floor(n * 0.85));
          while (n < rest.length && m.measure(rest.slice(0, n + 1), size, false, true) <= avail) n++;
          put(rest.slice(0, n));
          rest = rest.slice(n);
        }
        continue;
      }
      for (const word of words) {
        if (!word) continue;
        const trial = cur ? `${cur} ${word}` : word;
        if (m.measure(trial, size, bold, false) <= avail || !cur) {
          cur = trial;
          // a single word wider than the column: break it
          while (m.measure(cur, size, bold, false) > avail && cur.length > 1) {
            let n = cur.length - 1;
            while (n > 1 && m.measure(cur.slice(0, n), size, bold, false) > avail) n--;
            put(cur.slice(0, n));
            cur = cur.slice(n);
          }
        } else {
          put(cur);
          cur = word;
        }
      }
      if (cur) put(cur);
    }
    y += size * (b.kind === "li" ? 0.25 : 0.6);
  });
  return { lines, height: Math.max(0, y) };
}

// ---- the leaf ---------------------------------------------------------------------------------------------------------------------------

/** Leaf shape proportions: blade width / height. */
export const BLADE_ASPECT = 0.66;
/** Notes shorter than this look small, notes of this many characters or more fill the view (the text then scrolls). */
export const BLADE_FULL_CHARS = 4000;
const BLADE_MIN = 0.42;

/** The leaf's size in the view: dynamic magnification from the note's length (a short note = a small leaf), capped at 86 % of the view's height / 90 % of its width. */
export function bladeSize(chars: number, viewW: number, viewH: number): { w: number; h: number; scale: number } {
  const c = Number.isFinite(chars) ? Math.max(60, chars) : 60;
  const t = Math.log10(c / 60) / Math.log10(BLADE_FULL_CHARS / 60);
  const scale = Math.min(1, Math.max(BLADE_MIN, BLADE_MIN + (1 - BLADE_MIN) * t));
  const h = Math.max(120, Math.min(viewH * 0.86 * scale, (viewW * 0.9) / BLADE_ASPECT));
  return { w: h * BLADE_ASPECT, h, scale };
}

/** Scroll position (px into the text) that keeps the ant at `my` in the middle of a window `win` px tall over a text `total` px tall. */
export function scrollFor(my: number, total: number, win: number): number {
  if (!(total > win)) return 0;
  return Math.min(total - win, Math.max(0, my - win / 2));
}

/** Which laid-out line is at text position y (the nearest one at or above it), or -1. */
export function lineAt(lines: readonly LaidLine[], y: number): number {
  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].y <= y + 1) best = i;
    else break;
  }
  return best;
}
