/**
 * tree/layoutpref.ts — the remembered layout mode of the tree view (localStorage `biblio.v1.treeLayout`: `forest` | `hub`,
 * default `forest`). Kept out of layout.ts so that module stays pure. Never throws (no storage, blocked storage, junk value).
 */

import { DEFAULT_LAYOUT_MODE, parseLayoutMode, type LayoutMode } from "./layout";

export const LAYOUT_KEY = "biblio.v1.treeLayout";

export function loadLayoutMode(): LayoutMode {
  try {
    return parseLayoutMode(localStorage.getItem(LAYOUT_KEY)) ?? DEFAULT_LAYOUT_MODE;
  } catch {
    return DEFAULT_LAYOUT_MODE;
  }
}

export function saveLayoutMode(mode: LayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_KEY, mode);
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}
