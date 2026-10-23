/**
 * tree/silk.ts — spider silk threads (PURE, no three.js, unit-tested in tools/unit-test.mjs section 19).
 *
 * A thread is a REAL `Branch` (id "silk:<n>", radius 2.5, `silk: true`, no species) so the simulation can walk on it with
 * the ordinary branch code: it starts on the branch it hangs from (`parent` = the anchor's branch, `attachS` = the anchor's arc
 * length, so it is in the parent's `side` list) and ends either FREE in the air or on another branch (`endLink`, and the
 * thread is also in that branch's `side` list, so a thread between two branches is a climbable bridge both ways).
 *
 * Threads live in the module-level store `SILKS`; the view keeps them in localStorage between sessions (`serializeSilks` / `restoreSilks`,
 * bounded and sanitised: it is data from storage, so it is never trusted) and a thread can be cut (sim3 `cutThread`). When the world is rebuilt
 * (the tree data changed) `applySilks(world)` re-creates them from their SURFACE references, so they follow edits; a thread
 * whose anchor branch (or arc length) no longer exists is skipped (but stays in the store).
 */

import { add, dist, makeBranch, surfacePoint, v3, type Branch, type V3, type World } from "./world3";
import type { SurfacePos } from "./sim3";

export type SilkEnd = { kind: "free"; dx: number; dy: number; dz: number } | { kind: "surface"; ref: SurfacePos };

export interface SilkRecord {
  id: string;
  /** Where the thread hangs from (surface coordinates, so it follows edits). */
  ref: SurfacePos;
  /** Free = the far end hangs in the air at this offset from the anchor; surface = attached to another branch. */
  end: SilkEnd;
}

/** Radius of a thread (px). */
export const SILK_RADIUS = 2.5;
/** Threads shorter than this (px) are not worth keeping. */
export const SILK_MIN_LEN = 8;

/** Every thread spun this session (runtime only: gone on reload). */
export const SILKS: SilkRecord[] = [];

let counter = 0;
let version = 0;
/**
 * Bumped whenever a thread is added, removed, or the threads are re-created in a rebuilt world: a renderer compares it to
 * know whether the thread geometry changed (instead of rebuilding a signature string every frame).
 */
export function silkVersion(): number {
  return version;
}
/** A fresh thread id "silk:<n>". */
export function newSilkId(): string {
  counter++;
  return `silk:${counter}`;
}

/** Forget every thread (tests). */
export function clearSilks(): void {
  SILKS.length = 0;
  counter = 0;
  version++;
}

/** Remove a thread branch from a world (also from the side lists it is in) and optionally from the store. */
export function removeSilk(world: World, id: string, forget = true): void {
  version++;
  world.branches.delete(id);
  for (const b of world.branches.values()) {
    const i = b.side.indexOf(id);
    if (i >= 0) b.side.splice(i, 1);
  }
  if (forget) {
    const k = SILKS.findIndex((r) => r.id === id);
    if (k >= 0) SILKS.splice(k, 1);
  }
}

/** The world points a record connects (null when its anchor / target is gone from this world). */
function endpoints(world: World, rec: SilkRecord): { a: V3; e: V3; parent: Branch; target: Branch | null } | null {
  const parent = world.branches.get(rec.ref.b);
  if (!parent || !(rec.ref.s >= 0) || rec.ref.s > parent.total + 1e-6) return null;
  const a = surfacePoint(parent, rec.ref.s, rec.ref.th).p;
  if (rec.end.kind === "free") {
    const e = add(a, v3(rec.end.dx, rec.end.dy, rec.end.dz));
    return Number.isFinite(e.x + e.y + e.z) ? { a, e, parent, target: null } : null;
  }
  const target = world.branches.get(rec.end.ref.b);
  if (!target || !(rec.end.ref.s >= 0) || rec.end.ref.s > target.total + 1e-6) return null;
  return { a, e: surfacePoint(target, rec.end.ref.s, rec.end.ref.th).p, parent, target };
}

function build(world: World, rec: SilkRecord): Branch | null {
  const ep = endpoints(world, rec);
  if (!ep || dist(ep.a, ep.e) < SILK_MIN_LEN) return null;
  const mid = v3((ep.a.x + ep.e.x) / 2, (ep.a.y + ep.e.y) / 2, (ep.a.z + ep.e.z) / 2);
  const br = makeBranch(rec.id, [ep.a, mid, ep.e], SILK_RADIUS, rec.ref.b, rec.ref.s, SILK_RADIUS);
  br.silk = true;
  if (ep.target && rec.end.kind === "surface") br.endLink = { b: rec.end.ref.b, s: rec.end.ref.s };
  world.branches.set(br.id, br);
  ep.parent.side.push(br.id);
  if (ep.target && ep.target !== ep.parent) ep.target.side.push(br.id);
  return br;
}

/** Spin a thread: store it (until reload) and create its branch in `world`. Null when it is degenerate or its anchor is missing (nothing stored). */
export function addSilk(world: World, rec: SilkRecord): Branch | null {
  if (world.branches.has(rec.id)) removeSilk(world, rec.id, false);
  const br = build(world, rec);
  if (!br) return null;
  version++;
  const k = SILKS.findIndex((r) => r.id === rec.id);
  if (k >= 0) SILKS[k] = rec;
  else SILKS.push(rec);
  return br;
}

/** Re-create every stored thread in a (re)built world (anchors that no longer exist are skipped). Returns how many were built. */
export function applySilks(world: World): number {
  version++;
  let n = 0;
  for (const rec of SILKS) {
    if (world.branches.has(rec.id)) removeSilk(world, rec.id, false);
    if (build(world, rec)) n++;
  }
  return n;
}

/** How close (px) a surface point must be to a thread's end to count as standing at it. */
export const SILK_ENTRY = 14;

// ---- persistence (localStorage, by the view) ------------------------------------------------------------------------------------------

/** At most this many threads are kept between sessions (the oldest go first). */
export const SILK_KEEP = 200;

const finite = (...xs: unknown[]): boolean => xs.every((x) => typeof x === "number" && Number.isFinite(x));
const refOf = (v: unknown): SurfacePos | null => {
  const r = v as Partial<SurfacePos> | null;
  if (!r || typeof r !== "object" || typeof r.b !== "string" || r.b.length === 0 || r.b.length > 80 || !finite(r.s, r.th) || (r.s as number) < 0 || Math.abs(r.th as number) > 10) return null;
  return { b: r.b, s: r.s as number, th: r.th as number };
};

/** One stored record -> a SilkRecord (any damage = null). */
export function sanitizeSilk(v: unknown): SilkRecord | null {
  const r = v as { id?: unknown; ref?: unknown; end?: { kind?: unknown; dx?: unknown; dy?: unknown; dz?: unknown; ref?: unknown } } | null;
  if (!r || typeof r !== "object" || typeof r.id !== "string" || !/^silk:\d{1,9}$/.test(r.id)) return null;
  const ref = refOf(r.ref);
  if (!ref || !r.end || typeof r.end !== "object") return null;
  if (r.end.kind === "free") {
    if (!finite(r.end.dx, r.end.dy, r.end.dz) || Math.hypot(r.end.dx as number, r.end.dy as number, r.end.dz as number) > 1e6) return null;
    return { id: r.id, ref, end: { kind: "free", dx: r.end.dx as number, dy: r.end.dy as number, dz: r.end.dz as number } };
  }
  if (r.end.kind === "surface") {
    const to = refOf(r.end.ref);
    return to ? { id: r.id, ref, end: { kind: "surface", ref: to } } : null;
  }
  return null;
}

/** The stored threads as text (the newest SILK_KEEP). */
export function serializeSilks(recs: readonly SilkRecord[] = SILKS): string {
  return JSON.stringify(recs.slice(-SILK_KEEP));
}

/** Text -> sanitised records (never throws; duplicates by id dropped, at most SILK_KEEP). */
export function parseSilks(text: string | null): SilkRecord[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: SilkRecord[] = [];
  const seen = new Set<string>();
  for (const v of raw.slice(-SILK_KEEP)) {
    const r = sanitizeSilk(v);
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

/** Replace the store with stored records and continue numbering after the highest id (call before the first world is built). */
export function restoreSilks(recs: readonly SilkRecord[]): void {
  SILKS.length = 0;
  SILKS.push(...recs);
  counter = Math.max(counter, ...recs.map((r) => Number(r.id.slice(5))), 0);
  version++;
}
