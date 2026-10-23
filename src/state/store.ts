/**
 * state/store.ts — tiny external store + the shared Trilium client.
 *
 * React needs one source of truth outside the game; the scene needs the same
 * data. This module is that truth: a hand-rolled observable (no Redux/Zustand
 * — the state is a handful of fields) consumed via useSyncExternalStore.
 *
 * The TriliumClient lives here too: one client for the whole app, recreated
 * when settings change. It is passed around explicitly, never imported from
 * components directly, to keep the "only one module talks HTTP" boundary
 * auditable.
 */

import { useSyncExternalStore } from "react";
import { DEFAULT_ROOT_NOTE_ID } from "../config";
import { TriliumClient } from "../lib/trilium/client";
import { NO_HOST_CONFIG, type ServerConfig } from "../lib/serverconfig";
import type { ConnState, LibraryTree, RoomPlacement, Settings } from "../types";

export interface AppState {
  settings: Settings | null;
  /** What the host of this app configured (hosted mode: a Trilium server behind the proxy, an AI provider); no host config = all null. */
  host: ServerConfig;
  conn: ConnState;
  tree: LibraryTree | null;
  placements: Map<string, RoomPlacement> | null;
  /** Which note the current library hangs from (settings change it). */
  rootNoteId: string;
  /** noteIds from root to the current room; [] until the scene reports. */
  path: string[];
  overview: boolean;
  roomCount: number;
  /** Transient toast; `id` lets the UI re-trigger the same text. */
  notice: { level: "info" | "warn" | "error"; text: string; id: number } | null;
}

const initialState: AppState = {
  settings: null,
  host: NO_HOST_CONFIG,
  conn: "disconnected",
  tree: null,
  placements: null,
  rootNoteId: DEFAULT_ROOT_NOTE_ID,
  path: [],
  overview: false,
  roomCount: 0,
  notice: null,
};

let state: AppState = initialState;
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

/** Shallow-merge a patch and notify subscribers. */
export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React hook: re-renders the component on every store change. */
export function useAppStore(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------------------------------------------------------------------------
// Shared client
// ---------------------------------------------------------------------------

let client: TriliumClient | null = null;

/**
 * The app-wide client for the CURRENT settings. Returns null when no settings
 * exist yet (first run). Call this rather than constructing clients ad hoc —
 * exactly one instance means exactly one place where the base URL is real.
 */
export function getClient(): TriliumClient | null {
  if (!state.settings) return null;
  if (!client) {
    const s = state.settings;
    // hosted mode: our own origin, no token (nginx injects it), read-only when the host says so
    client = new TriliumClient({
      baseUrl: s.proxy ? "" : s.serverUrl,
      token: s.proxy ? undefined : s.token,
      readOnly: !!s.proxy && state.host.server?.readOnly === true,
    });
  }
  return client;
}

/** Call after settings change: drops the old client so the next getClient() rebuilds it. */
export function resetClient(): void {
  client = null;
}

let noticeId = 0;
export function notify(level: "info" | "warn" | "error", text: string): void {
  setState({ notice: { level, text, id: ++noticeId } });
}