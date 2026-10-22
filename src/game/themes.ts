/**
 * game/themes.ts — room themes (world building, phase 1).
 *
 * A theme is a set of colour TINTS applied on top of the one shared texture
 * set, plus an optional full-room colour grade. Tint multiplies, so a theme
 * can only darken/shift the base art: all shipped themes are dark-compatible
 * (lighter variants need palette-parameterised textures — a later phase).
 * `oak` is the default and has NO tints, so a vault without any biblio_*
 * labels renders exactly as before.
 *
 * Stored as slugs in labels (`biblio_theme` on one room, `biblio_wing` on a
 * room and all its sub-rooms); unknown slugs are treated as absent.
 */

import { LABELS } from "../config";
import type { LibraryTree } from "../types";

/** A tint colour (0xRRGGBB) or null for "leave the texture as drawn". */
type Tint = number | null;

export interface Theme {
  id: string;
  /** Shown on the chip. */
  name: string;
  wall: Tint;
  wainscot: Tint;
  floor: Tint;
  /** Window glass + light shafts. */
  glass: Tint;
  shaft: Tint;
  flame: Tint;
  /** Full-room colour grade drawn over the room (under the player). */
  grade: { color: number; alpha: number } | null;
}

const NONE = { wall: null, wainscot: null, floor: null, glass: null, shaft: null, flame: null, grade: null } as const;

export const THEMES: readonly Theme[] = [
  { id: "oak", name: "Oak", ...NONE },
  { id: "midnight", name: "Midnight", wall: 0x7080b0, wainscot: 0x626c9c, floor: 0x6a6e98, glass: 0x8a9ad0, shaft: 0xa0b0ff, flame: 0xc0d0ff, grade: { color: 0x0c1038, alpha: 0.22 } },
  { id: "ember", name: "Ember", wall: 0xd09070, wainscot: 0xc08060, floor: 0xd09868, glass: 0xe0a070, shaft: 0xffc890, flame: null, grade: { color: 0x401400, alpha: 0.16 } },
  { id: "crypt", name: "Crypt", wall: 0x8a9098, wainscot: 0x70767e, floor: 0x7c8088, glass: 0x90a0a8, shaft: 0xb0c0c8, flame: 0xa0ffc0, grade: { color: 0x061408, alpha: 0.2 } },
  { id: "greenhouse", name: "Greenhouse", wall: 0x90b088, wainscot: 0x80a070, floor: 0xa8a470, glass: 0xa0e0b0, shaft: 0xd0ffc0, flame: null, grade: { color: 0x0c2a10, alpha: 0.14 } },
  { id: "rosewood", name: "Rosewood", wall: 0xc08090, wainscot: 0xb06070, floor: 0xc08078, glass: 0xe0a0b0, shaft: 0xffc0d0, flame: 0xffb0b0, grade: { color: 0x300810, alpha: 0.14 } },
  { id: "slate", name: "Slate", wall: 0x98a0b0, wainscot: 0x8890a0, floor: 0x9098a8, glass: 0xa8b8d0, shaft: 0xc8d4f0, flame: null, grade: { color: 0x10141c, alpha: 0.18 } },
];

export const DEFAULT_THEME: Theme = THEMES[0];

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/** Slug → theme, or undefined for unknown/garbled values (treated as absent). */
export function parseTheme(value: string | undefined): Theme | undefined {
  return value === undefined ? undefined : BY_ID.get(value.trim().toLowerCase());
}

/** Parent of a room along the primary edge (first edge whose child is it). */
function parentOf(tree: LibraryTree, id: string): string | null {
  return tree.edges.find((e) => e.noteId === id)?.parentNoteId ?? null;
}

const MAX_WALK = 16;

/**
 * Effective theme of a room: its own `biblio_theme`, else the nearest
 * `biblio_wing` on the room itself or an ancestor, else oak. Cycle-safe and
 * depth-capped (clones can make the tree a graph).
 */
export function resolveTheme(tree: LibraryTree, roomId: string): Theme {
  const own = parseTheme(tree.notes[roomId]?.labels[LABELS.theme]);
  if (own) return own;
  const seen = new Set<string>();
  let cur: string | null = roomId;
  for (let i = 0; i < MAX_WALK && cur !== null && !seen.has(cur); i++) {
    seen.add(cur);
    const wing = parseTheme(tree.notes[cur]?.labels[LABELS.wing]);
    if (wing) return wing;
    cur = parentOf(tree, cur);
  }
  return DEFAULT_THEME;
}

/** Rooms (notes with children) in the subtree of `roomId`, itself included. */
export function wingRoomCount(tree: LibraryTree, roomId: string): number {
  const seen = new Set<string>();
  const stack = [roomId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of tree.edges) if (e.parentNoteId === id) stack.push(e.noteId);
  }
  return [...seen].filter((id) => tree.notes[id]?.hasChildren).length;
}
