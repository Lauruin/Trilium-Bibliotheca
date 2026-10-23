/**
 * tree/bridge.ts — the one place other parts of the UI (the search panel) reach into the running tree view without importing it.
 * TreeView registers the scene's three note actions while it is mounted and clears them when it unmounts; with no tree view (the
 * library, or WebGL missing) there is no bridge and the search offers only "open".
 */

export interface TreeBridge {
  /** Is this note a leaf or a folder branch of the current tree? */
  has(noteId: string): boolean;
  /** The animal walks there by itself (click-to-walk). */
  walkTo(noteId: string): boolean;
  /** The wisp flies there and hovers beside it with a beam of light. */
  lightTo(noteId: string): boolean;
}

let current: TreeBridge | null = null;

export function setTreeBridge(b: TreeBridge | null): void {
  current = b;
}

export function getTreeBridge(): TreeBridge | null {
  return current;
}
