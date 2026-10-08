/**
 * App.tsx — the orchestrator: owns connection lifecycle, event wiring and
 * which overlay is open. The Phaser game and the UI components are dumb;
 * all coordination happens here.
 *
 * Boot order:
 *   1. Phaser starts immediately (shows "waiting" until world data arrives).
 *   2. Settings are loaded from localStorage (cache.ts). None → settings modal.
 *   3. With settings: refresh() — probe app-info, walk the tree, compute
 *      placements, hand everything to the scene via `scene:load-world`.
 *   4. On failure: fall back to the cached snapshot (offline mode) or ask for
 *      settings again (auth error).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_ROOT_NOTE_ID } from "./config";
import { startGame } from "./game/game";
import { bus } from "./game/events";
import { loadTreeCache, saveSettings, saveTreeCache } from "./lib/cache";
import { computePlacements, saveRoomPosition } from "./lib/layout";
import { walkLibraryTree } from "./lib/library";
import { TriliumApiError } from "./lib/trilium/client";
import { getClient, getState, notify, resetClient, setState, useAppStore } from "./state/store";
import type { Settings } from "./types";
import { BookPopup } from "./ui/BookPopup";
import { Hud } from "./ui/Hud";
import { SearchPanel } from "./ui/SearchPanel";
import { SettingsModal } from "./ui/SettingsModal";
import { SocratesDialog } from "./ui/SocratesDialog";

export default function App(): React.JSX.Element {
  const state = useAppStore();
  const [book, setBook] = useState<{ noteId: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socratesOpen, setSocratesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // --- Phaser boot (once) ---------------------------------------------------
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    const game = startGame(hostRef.current);
    return () => void game.destroy(true);
  }, []);

  // --- first run: no settings → open the settings modal ---------------------
  useEffect(() => {
    if (getState().settings === null) setSettingsOpen(true);
  }, []);

  // --- connection lifecycle ---------------------------------------------------
  const refresh = useCallback(async () => {
    const s = getState().settings;
    if (!s) return;
    const client = getClient();
    if (!client) return;
    setState({ conn: "connecting" });
    try {
      await client.getAppInfo(); // cheap: validates token AND reachability
      const rootNoteId = s.rootNoteId || DEFAULT_ROOT_NOTE_ID;
      const tree = await walkLibraryTree(client, rootNoteId);
      const roomIds = Object.values(tree.notes)
        .filter((n) => n.hasChildren)
        .map((n) => n.noteId);
      const placements = computePlacements(tree, roomIds);
      saveTreeCache(tree);
      setState({ conn: "online", tree, placements, rootNoteId });
      bus.emit("scene:load-world", { tree, placements, rootNoteId });
      if (tree.truncated) {
        notify("warn", `Vault larger than the walk cap — showing the first rooms only.`);
      }
    } catch (err) {
      handleRefreshError(err);
    }
  }, []);
  useEffect(() => {
    void refresh();
    // Re-run when credentials change (settings save resets the client).
  }, [state.settings?.serverUrl, state.settings?.token, refresh]);

  // --- Phaser → React events -------------------------------------------------
  useEffect(() => {
    const offs = [
      bus.on("hud:state", ({ path, overview, roomCount }) =>
        setState({ path, overview, roomCount }),
      ),
      bus.on("book:open", ({ noteId }) => setBook({ noteId })),
      bus.on("search:open", () => setSearchOpen(true)),
      bus.on("socrates:open", () => setSocratesOpen(true)),
      bus.on("notice", ({ level, text }) => notify(level, text)),
      bus.on("layout:move", ({ noteId, x, y }) => void persistLayout(noteId, x, y)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // --- pause the scene while any modal is open --------------------------------
  const modalOpen = book !== null || searchOpen || socratesOpen || settingsOpen;
  useEffect(() => {
    bus.emit("scene:paused", { on: modalOpen });
  }, [modalOpen]);

  // --- toast auto-hide ---------------------------------------------------------
  useEffect(() => {
    if (!state.notice) return;
    const id = state.notice.id;
    const t = window.setTimeout(() => {
      if (getState().notice?.id === id) setState({ notice: null });
    }, 4500);
    return () => window.clearTimeout(t);
  }, [state.notice]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    // Closed without saving and still nothing configured → keep it openable via HUD.
  }, []);

  return (
    <div className="app">
      <Hud
        onOpenSearch={() => setSearchOpen(true)}
        onToggleOverview={() =>
          bus.emit("scene:overview", { on: !getState().overview })
        }
        onRefresh={() => void refresh()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div ref={hostRef} id="game-host" />
      {book !== null && (
        <BookPopup noteId={book.noteId} onClose={() => setBook(null)} />
      )}
      {searchOpen && (
        <SearchPanel onClose={() => setSearchOpen(false)} onOpenNote={(id) => setBook({ noteId: id })} />
      )}
      {socratesOpen && <SocratesDialog onClose={() => setSocratesOpen(false)} />}
      {settingsOpen && (
        <SettingsModal onClose={closeSettings} onSaved={() => setSettingsOpen(false)} />
      )}
      {state.notice && <div className={`toast toast-${state.notice.level}`}>{state.notice.text}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestration helpers
// ---------------------------------------------------------------------------

/** React → Trilium: persist an overview drag as biblio.x/biblio.y labels. */
async function persistLayout(noteId: string, x: number, y: number): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await saveRoomPosition(client, noteId, x, y);
    notify("info", "Room position saved to the note's labels.");
  } catch (err) {
    notify("warn", `Could not save position: ${errorMessage(err)} (kept locally)`);
  }
}

/**
 * Refresh failure policy:
 *   unreachable      → offline mode: build the world from the cached snapshot.
 *   auth (401)       → token rejected: tell the user, open settings.
 *   anything else    → error notice, keep whatever world we have.
 */
function handleRefreshError(err: unknown): void {
  if (err instanceof TriliumApiError && err.isUnreachable) {
    const cached = loadTreeCache();
    if (cached) {
      const roomIds = Object.values(cached.notes)
        .filter((n) => n.hasChildren)
        .map((n) => n.noteId);
      const placements = computePlacements(cached, roomIds);
      setState({ conn: "offline", tree: cached, placements });
      bus.emit("scene:load-world", {
        tree: cached,
        placements,
        rootNoteId: cached.rootNoteId,
      });
      notify("warn", "Server unreachable — showing the cached snapshot.");
      return;
    }
    setState({ conn: "offline" });
    notify("error", "Server unreachable and no cached snapshot exists yet.");
    return;
  }
  if (err instanceof TriliumApiError && err.isAuthError) {
    setState({ conn: "error" });
    notify("error", "Trilium rejected the token — check settings (server URL / token).");
    return;
  }
  setState({ conn: "error" });
  notify("error", `Connection problem: ${errorMessage(err)}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Saved by the settings modal; stored + applied by the store. */
export function applySettings(s: Settings): void {
  saveSettings(s);
  resetClient();
  setState({ settings: s });
}