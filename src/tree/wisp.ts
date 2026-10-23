/**
 * tree/wisp.ts — where the search wisp is (pure maths; the sprite lives in TreeScene).
 *
 * The wisp has three places to be, in this order of priority: beside a leaf it was asked to **light** (it flies there and hovers,
 * with a beam of light straight up so the leaf can be found among the foliage), **following** the animal like a lantern, or
 * **perched** over the shrine's lantern post (the default; a scene without a shrine, such as the demo page, always follows).
 * It never teleports: it flies at a limited speed and eases in, so a "light the way" visibly crosses the forest.
 */

import type { V3 } from "./world3";

export type WispMode = "perch" | "follow";
export const WISP_MODES: readonly WispMode[] = ["perch", "follow"];
export const parseWispMode = (v: unknown): WispMode => (v === "follow" ? "follow" : "perch");

/** Flight speed limit, px/s, and the easing rate of the approach. */
export const WISP_SPEED = 1100;
export const WISP_EASE = 4;

export interface WispWhere {
  mode: WispMode;
  /** The shrine's perch, or null when the scene has no shrine. */
  perch: V3 | null;
  /** The animal's head and the camera scale (the wisp keeps a constant look on screen). */
  head: V3;
  camScale: number;
  /** Seconds, for the bobbing. */
  t: number;
  /** A leaf to hover beside (where the leaf is), or null. */
  guide: V3 | null;
}

/** The point the wisp is heading for right now. */
export function wispTarget(w: WispWhere): V3 {
  const cs = Math.max(0.4, w.camScale);
  if (w.guide) return { x: w.guide.x, y: w.guide.y + (46 + Math.sin(w.t * 2.1) * 5) * cs, z: w.guide.z };
  if (w.mode === "follow" || !w.perch) {
    return { x: w.head.x + (-50 + Math.cos(w.t * 1.7) * 12) * cs, y: w.head.y + (100 + Math.sin(w.t * 2.3) * 10) * cs, z: w.head.z + 60 * cs };
  }
  return { x: w.perch.x, y: w.perch.y + Math.sin(w.t * 1.6) * 5, z: w.perch.z };
}

/** One step towards the target: exponential approach, capped at `WISP_SPEED`. Never overshoots, never NaN. */
export function wispStep(pos: V3, target: V3, dt: number): V3 {
  if (!(dt > 0) || ![pos.x, pos.y, pos.z, target.x, target.y, target.z].every(Number.isFinite)) return { ...pos };
  const k = Math.min(1, dt * WISP_EASE);
  let dx = (target.x - pos.x) * k, dy = (target.y - pos.y) * k, dz = (target.z - pos.z) * k;
  const len = Math.hypot(dx, dy, dz);
  const cap = WISP_SPEED * dt;
  if (len > cap) {
    dx *= cap / len;
    dy *= cap / len;
    dz *= cap / len;
  }
  return { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
}

/** Is the pointer (pixels) on the wisp's glow (screen position, radius in px)? */
export function wispHit(px: number, py: number, wisp: { x: number; y: number } | null, radius: number): boolean {
  return !!wisp && Math.hypot(px - wisp.x, py - wisp.y) <= radius;
}
