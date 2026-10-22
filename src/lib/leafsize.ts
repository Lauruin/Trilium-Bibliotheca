/**
 * lib/leafsize.ts — content lengths for the tree view's leaf sizes.
 *
 * ETAPI has no "length" field, so the length of a note is measured by fetching
 * its content — lazily, in the background, a few at a time, and cached by the
 * note's blobId (which changes when the content does). Only the NUMBER is kept:
 * content is never stored, logged or handed on.
 */

import { STORAGE } from "../config";
import { TriliumApiError, type TriliumClient } from "./trilium/client";

/** noteId → content length at a given blob. */
export type SizeCache = Record<string, { blob: string; len: number }>;

const CACHE_MAX = 5000;

export function loadSizeCache(): SizeCache {
  try {
    const raw = localStorage.getItem(STORAGE.leafSizes);
    const v = raw === null ? null : JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const out: SizeCache = {};
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
      const o = e as { blob?: unknown; len?: unknown } | null;
      if (o && typeof o.blob === "string" && typeof o.len === "number" && Number.isFinite(o.len) && o.len >= 0) out[id] = { blob: o.blob, len: o.len };
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

export interface MeasureOptions {
  signal: AbortSignal;
  /** Parallel fetches (default 4). */
  concurrency?: number;
  /** At most this many notes are FETCHED per call (default 400); cache hits are free. */
  maxNotes?: number;
  /** Receives the lengths found since the previous call (cache hits first, immediately), noteId → chars. */
  onBatch: (sizes: Map<string, number>) => void;
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
  const todo: Array<{ noteId: string; type: string; blobId?: string }> = [];
  for (const n of notes) {
    if (textLength(n.type, "") < 0) continue; // not measurable
    const hit = cache[n.noteId];
    if (hit && n.blobId !== undefined && hit.blob === n.blobId) known.set(n.noteId, hit.len);
    else if (todo.length < maxNotes) todo.push(n);
  }
  if (signal.aborted) return;
  if (known.size > 0) onBatch(known);

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
      try {
        len = textLength(n.type, await client.getNoteContent(n.noteId));
      } catch (e) {
        // one bad note is not worth the rest — but a dead server / revoked token is
        if (e instanceof TriliumApiError && (e.isAuthError || e.isUnreachable)) dead = true;
        continue;
      }
      if (signal.aborted) return;
      if (len < 0) continue;
      if (n.blobId !== undefined) cache[n.noteId] = { blob: n.blobId, len };
      pending.set(n.noteId, len);
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
