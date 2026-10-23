/**
 * lib/leafsize.ts — content lengths for the tree view's leaf sizes.
 *
 * ETAPI has no "length" field, so the length of a note is measured by fetching
 * its content — lazily, in the background, a few at a time, and cached by the
 * note's blobId (which changes when the content does). What is kept is the NUMBER and a short plain-text
 * EXCERPT (the first ~160 characters, for the hover preview next to a leaf); the content itself is never
 * stored, logged or handed on. The excerpts live in this browser's localStorage only.
 */

import { STORAGE } from "../config";
import { TriliumApiError, type TriliumClient } from "./trilium/client";

/** noteId → content length at a given blob. */
export type SizeCache = Record<string, { blob: string; len: number; ex?: string }>;

/** Longest excerpt kept per note (characters). */
export const EXCERPT_MAX = 160;

const CACHE_MAX = 5000;

export function loadSizeCache(): SizeCache {
  try {
    const raw = localStorage.getItem(STORAGE.leafSizes);
    const v = raw === null ? null : JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: SizeCache = {};
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
      const o = e as { blob?: unknown; len?: unknown; ex?: unknown } | null;
      if (o && typeof o.blob === "string" && typeof o.len === "number" && Number.isFinite(o.len) && o.len >= 0) {
        out[id] = { blob: o.blob, len: o.len };
        if (typeof o.ex === "string") out[id].ex = o.ex.slice(0, EXCERPT_MAX + 1);
      }
    }
    return out;
  } catch {
    return {}; // corrupted or inaccessible — treat as empty
  }
}

export function saveSizeCache(cache: SizeCache): void {
  try {
    const ids = Object.keys(cache);
    const kept = ids.length > CACHE_MAX ? Object.fromEntries(ids.slice(ids.length - CACHE_MAX).map((id) => [id, cache[id]])) : cache;
    localStorage.setItem(STORAGE.leafSizes, JSON.stringify(kept));
  } catch {
    /* sizes are a nicety, never an error */
  }
}

/**
 * Length in characters of what a reader would see: text → visible text (tags, entities and whitespace runs
 * collapsed); markdown/code → raw length; every other type → -1 ("not measurable": binary or structured content).
 */
export function textLength(type: string, content: string): number {
  if (type === "markdown" || type === "code") return content.length;
  if (type !== "text") return -1;
  if (content.length > 400_000) return content.length; // already the biggest leaf; keeps the tag regexes linear-ish
  return content
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, "_")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * The first ~160 characters of what a reader would see, as one line of plain text (tags, entities and whitespace runs collapsed; markdown /
 * code: the raw text), cut at a word with an ellipsis; "" for types without text. Never throws.
 */
export function excerptOf(type: string, content: string): string {
  if (type !== "text" && type !== "markdown" && type !== "code") return "";
  const head = String(content ?? "").slice(0, 4000); // enough for 160 visible characters in any sane note
  const text = (type === "text"
    ? head
        .replace(/<(script|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, " ")
        .replace(/<[^>]*>?/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, " ")
    : head
  ).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= EXCERPT_MAX) return text;
  const cut = text.slice(0, EXCERPT_MAX);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > EXCERPT_MAX * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

export interface MeasureOptions {
  signal: AbortSignal;
  /** Parallel fetches (default 4). */
  concurrency?: number;
  /** At most this many notes are FETCHED per call (default 400); cache hits are free. */
  maxNotes?: number;
  /** Receives the lengths found since the previous call (cache hits first, immediately), noteId → chars. */
  onBatch: (sizes: Map<string, number>) => void;
  /** Receives the excerpts found (cache hits first), noteId → text; only non-empty ones. */
  onExcerpts?: (excerpts: Map<string, string>) => void;
}

const BATCH_EVERY = 8;
const BATCH_MS = 400;
const PERSIST_EVERY = 32;

/**
 * Measure the content length of `notes` (non-measurable types are skipped). Cached lengths are reused when the
 * cached blob id equals the note's blobId; the rest are fetched by a small worker pool. A failing fetch is skipped,
 * never fatal; aborting stops quietly (no further fetches, no further onBatch).
 */
export async function measureLeaves(
  client: Pick<TriliumClient, "getNoteContent">,
  notes: Array<{ noteId: string; type: string; blobId?: string }>,
  opts: MeasureOptions,
): Promise<void> {
  const { signal, onBatch } = opts;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4));
  const maxNotes = Math.max(0, Math.floor(opts.maxNotes ?? 400));
  const cache = loadSizeCache();
  const known = new Map<string, number>();
  const knownEx = new Map<string, string>();
  const todo: Array<{ noteId: string; type: string; blobId?: string }> = [];
  for (const n of notes) {
    if (textLength(n.type, "") < 0) continue; // not measurable
    const hit = cache[n.noteId];
    if (hit && n.blobId !== undefined && hit.blob === n.blobId && hit.ex !== undefined) {
      known.set(n.noteId, hit.len);
      if (hit.ex) knownEx.set(n.noteId, hit.ex);
    } else if (todo.length < maxNotes) todo.push(n); // (an entry from before excerpts existed is fetched once more to get one)
  }
  if (signal.aborted) return;
  if (known.size > 0) onBatch(known);
  if (knownEx.size > 0) opts.onExcerpts?.(knownEx);

  let pending = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pending.size === 0 || signal.aborted) return;
    const batch = pending;
    pending = new Map();
    onBatch(batch);
  };

  let fetched = 0;
  let next = 0;
  let dead = false;
  const worker = async (): Promise<void> => {
    while (!signal.aborted && !dead && next < todo.length) {
      const n = todo[next++];
      let len = -1;
      let ex = "";
      try {
        const content = await client.getNoteContent(n.noteId);
        len = textLength(n.type, content);
        ex = excerptOf(n.type, content);
      } catch (e) {
        // one bad note is not worth the rest — but a dead server / revoked token is
        if (e instanceof TriliumApiError && (e.isAuthError || e.isUnreachable)) dead = true;
        continue;
      }
      if (signal.aborted) return;
      if (len < 0) continue;
      if (n.blobId !== undefined) cache[n.noteId] = { blob: n.blobId, len, ex };
      pending.set(n.noteId, len);
      if (ex) opts.onExcerpts?.(new Map([[n.noteId, ex]]));
      if (pending.size >= BATCH_EVERY) flush();
      else if (timer === undefined) timer = setTimeout(flush, BATCH_MS);
      if (++fetched % PERSIST_EVERY === 0) saveSizeCache(cache);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    flush();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (fetched > 0) saveSizeCache(cache);
  }
}
