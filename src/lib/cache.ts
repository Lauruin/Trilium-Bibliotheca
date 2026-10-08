/**
 * lib/cache.ts — settings + local snapshot persistence (localStorage).
 *
 * Local-cache-first (game-ui.md, "Connectivity note"): the world is built
 * from the last known tree before the network answers, and stays usable when
 * Trilium is unreachable. The snapshot is explicitly a cache — the vault on
 * the server remains the single source of truth, and we only ever cache
 * what a read-only walk produced (titles, types, labels — never content).
 *
 * Security note: the ETAPI token is stored in localStorage. That is a
 * deliberate v1 trade-off (no backend of our own to hold a session); it is
 * documented in the README and must not be understated there.
 */

import { STORAGE } from "../config";
import type { LibraryTree, Settings } from "../types";

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null; // corrupted or inauthentic entry — treat as absent
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // Quota/private-mode failures must never break the app; caching is
    // an optimisation, not a requirement.
    console.warn("[cache] could not persist", key, err);
  }
}

export function loadSettings(): Settings | null {
  return readJson<Settings>(STORAGE.settings);
}

export function saveSettings(settings: Settings): void {
  writeJson(STORAGE.settings, settings);
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE.settings);
}

export function loadTreeCache(): LibraryTree | null {
  return readJson<LibraryTree>(STORAGE.treeCache);
}

export function saveTreeCache(tree: LibraryTree): void {
  writeJson(STORAGE.treeCache, tree);
}