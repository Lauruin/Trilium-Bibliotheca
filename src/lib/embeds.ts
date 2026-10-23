/**
 * lib/embeds.ts — pictures embedded in text notes.
 *
 * A Trilium text note stores a picture as `<img src="api/attachments/ID/image/name.png">` (current editor) or
 * `<img src="api/images/NOTEID/name.png">` (an image note; older notes). Those URLs need Trilium's SESSION cookie,
 * which this app does not have (it talks ETAPI with a token), so in the sandboxed reader they never loaded.
 * Fix: find those URLs, fetch the bytes through ETAPI (`/attachments/{id}/content`, `/notes/{id}/content`)
 * with the token, check the bytes really are a picture, and inline them as `data:` URLs (the reader's CSP already
 * allows `img-src data:`). A picture that cannot be fetched or is too big becomes a small "unavailable" placeholder,
 * so the sandbox never makes a request to the Trilium URL.
 *
 * Pure string work plus two injected fetchers: unit-tested in Node. The URL shapes are the only place that
 * knows how Trilium names these resources; they were verified against v0.106.0 (the attachment id appears
 * as `api/attachments/<id>/image/<title>`; the exact shape of old notes is covered by the generic fallback).
 */

import { sniffBytes } from "./media";

export type EmbedRef = { kind: "note" | "attachment"; id: string };

const ID = "([A-Za-z0-9_]{4,32})";
const SHAPES: Array<{ kind: EmbedRef["kind"]; re: RegExp }> = [
  { kind: "attachment", re: new RegExp(`(?:^|/)api/attachments/${ID}/(?:image|download)(?:/|\\?|$)`) },
  { kind: "note", re: new RegExp(`(?:^|/)api/images/${ID}(?:/|\\?|$)`) },
  // generic fallbacks (a different prefix, e.g. when the note was made behind a reverse proxy path)
  { kind: "attachment", re: new RegExp(`/attachments/${ID}/(?:image|download)(?:/|\\?|$)`) },
  { kind: "note", re: new RegExp(`/images/${ID}(?:/|\\?|$)`) },
];

/** Which Trilium resource an `<img src>` points at, or null (data: URLs, other sites, anything else). */
export function classifyImageSrc(src: string): EmbedRef | null {
  const s = src.trim();
  if (!s || /^(data|blob|javascript):/i.test(s)) return null;
  // a full URL to some OTHER site that merely contains such a path is still a Trilium-shaped URL; we only ever
  // fetch it through the user's own ETAPI endpoint (by id), never from the URL itself
  for (const { kind, re } of SHAPES) {
    const m = re.exec(s);
    if (m) return { kind, id: m[1] };
  }
  return null;
}

const IMG_SRC = /(<img\b[^>]*?\ssrc=")([^"]*)(")/gi;

/** Distinct embedded Trilium pictures in (already DOM-normalised) HTML: raw src value → ref. */
export function collectEmbeds(html: string): Map<string, EmbedRef> {
  const out = new Map<string, EmbedRef>();
  for (const m of html.matchAll(IMG_SRC)) {
    const src = decodeAttr(m[2]);
    const ref = classifyImageSrc(src);
    if (ref && !out.has(m[2])) out.set(m[2], ref);
  }
  return out;
}

/** Replace the raw `src` values listed in `map` (raw src → new src); everything else is untouched. */
export function replaceImageSrcs(html: string, map: Map<string, string>): string {
  return html.replace(IMG_SRC, (all, a: string, src: string, c: string) => (map.has(src) ? `${a}${map.get(src)}${c}` : all));
}

function decodeAttr(v: string): string {
  return v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** A small grey "picture unavailable" SVG (as a data URL), shown instead of a picture we could not load. */
export const PLACEHOLDER_SRC =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60" viewBox="0 0 220 60"><rect width="220" height="60" rx="6" fill="#8883" stroke="#8886"/><text x="110" y="35" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#888">picture unavailable</text></svg>`,
  );

export interface EmbedFetcher {
  note(id: string): Promise<Blob>;
  attachment(id: string): Promise<Blob>;
}

export interface EmbedLimits {
  /** Largest single picture (bytes). */
  perImage: number;
  /** Largest sum of all inlined pictures of one note (bytes). */
  total: number;
  /** Most distinct pictures fetched for one note. */
  count: number;
  /** Parallel fetches. */
  parallel: number;
}

export const EMBED_LIMITS: EmbedLimits = { perImage: 6 * 1024 * 1024, total: 24 * 1024 * 1024, count: 40, parallel: 4 };

export interface EmbedResult {
  html: string;
  inlined: number;
  /** Pictures replaced by the placeholder (fetch failed, not a picture, or over a limit). */
  failed: number;
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * Inline every embedded Trilium picture of `html`. Never throws: a failure is the placeholder.
 * The mime of the data URL comes from sniffing the BYTES (an HTML or script response is rejected), not from the server.
 * SVG is inlined as an image data URL, where scripts never run.
 */
export async function inlineEmbeddedImages(
  html: string,
  fetcher: EmbedFetcher,
  limits: EmbedLimits = EMBED_LIMITS,
): Promise<EmbedResult> {
  const refs = collectEmbeds(html);
  if (refs.size === 0) return { html, inlined: 0, failed: 0 };

  const entries = [...refs.entries()];
  const replacement = new Map<string, string>();
  let total = 0;
  let inlined = 0;
  let failed = 0;
  // de-duplicate by resource: the same attachment used twice is fetched once
  const cache = new Map<string, Promise<string | null>>();

  const load = (ref: EmbedRef): Promise<string | null> => {
    const key = `${ref.kind}:${ref.id}`;
    let p = cache.get(key);
    if (!p) {
      p = (async () => {
        try {
          const blob = await (ref.kind === "attachment" ? fetcher.attachment(ref.id) : fetcher.note(ref.id));
          if (blob.size > limits.perImage) return null;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const sn = sniffBytes(bytes);
          if (sn.kind !== "image" && sn.kind !== "svg") return null;
          if (total + bytes.length > limits.total) return null;
          total += bytes.length;
          return `data:${sn.mime};base64,${base64(bytes)}`;
        } catch {
          return null;
        }
      })();
      cache.set(key, p);
    }
    return p;
  };

  // bounded parallelism, in document order (so the byte budget goes to the first pictures)
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= entries.length) return;
      const [raw, ref] = entries[i];
      if (i >= limits.count) {
        replacement.set(raw, PLACEHOLDER_SRC);
        failed++;
        continue;
      }
      const url = await load(ref);
      if (url) {
        replacement.set(raw, url);
        inlined++;
      } else {
        replacement.set(raw, PLACEHOLDER_SRC);
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limits.parallel, entries.length)) }, worker));
  return { html: replaceImageSrcs(html, replacement), inlined, failed };
}
