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
 *   4. On failure: fall back to the cached snapshot (offline mode) or, on an
 *      auth error, show a toast asking the user to check the settings.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_ROOT_NOTE_ID } from "./config";
import { startGame } from "./game/game";
import { bus } from "./game/events";
import { sharedText } from "./lib/capture";
import { clearSettings, loadSettings, loadTreeCache, saveSettings, saveTreeCache } from "./lib/cache";
import { chooseSettings, fetchServerConfig } from "./lib/serverconfig";
import { computePlacements, saveRoomPosition } from "./lib/layout";
import { walkLibraryTree } from "./lib/library";
import { TriliumApiError } from "./lib/trilium/client";
import { getClient, getState, notify, resetClient, setState, useAppStore } from "./state/store";
import type { Settings } from "./types";
import { CaptureModal } from "./ui/CaptureModal";
import { BookPopup } from "./ui/BookPopup";
import { Hud } from "./ui/Hud";
import { RoomPlaque } from "./ui/RoomPlaque";
import { TreeView } from "./ui/TreeView";
import { BuildPanel } from "./ui/BuildPanel";
import { redoEdit, undoEdit } from "./lib/worldedit";
import { SearchPanel } from "./ui/SearchPanel";
import { TouchControls } from "./ui/TouchControls";
import { SettingsModal } from "./ui/SettingsModal";
import { SocratesDialog } from "./ui/SocratesDialog";

export default function App(): React.JSX.Element {
  const state = useAppStore();
  const [book, setBook] = useState<{ noteId: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socratesOpen, setSocratesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  /** "library" = the walkable rooms (Phaser); "tree" = the Yggdrasil view (three.js). */
  const [view, setView] = useState<"library" | "tree">("library");
  /** Text handed over by the OS share sheet (PWA share target), consumed once. */
  const [shared, setShared] = useState<string | null>(null);
  /** A share arrived with the page load (the ref survives StrictMode's second effect run, which no longer sees the query). */
  const shareArrived = useRef(false);

  // --- Phaser boot (once) ---------------------------------------------------
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    const game = startGame(hostRef.current);
    return () => void game.destroy(true);
  }, []);

  // --- first run / boot: hydrate settings, open modal if none ---------------
  useEffect(() => {
    const incoming = sharedText(window.location.search);
    if (incoming !== null) {
      window.history.replaceState(null, "", window.location.pathname); // don't re-capture on reload
      setShared(incoming);
      shareArrived.current = true;
    }
    let alive = true;
    void (async () => {
      // what the host configured (hosted mode); a dev server / a plain deployment answers "nothing"
      const host = await fetchServerConfig();
      if (!alive) return;
      setState({ host });
      const s = chooseSettings(loadSettings(), host);
      if (s) {
        resetClient();
        setState({ settings: s, conn: "connecting" });
        if (shareArrived.current) setCaptureOpen(true);
      } else {
        setSettingsOpen(true);
      }
    })();
    return () => {
      alive = false;
    };
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
  }, [state.settings?.serverUrl, state.settings?.token, state.settings?.proxy, refresh]);

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
  const modalOpen = book !== null || searchOpen || socratesOpen || settingsOpen || captureOpen || buildOpen;
  useEffect(() => {
    bus.emit("scene:paused", { on: modalOpen || view === "tree" });
  }, [modalOpen, view]);

  // Phaser's FIT scaling needs a nudge after its host was hidden.
  useEffect(() => {
    if (view === "library") window.dispatchEvent(new Event("resize"));
  }, [view]);

  // --- "c" opens quick capture (ignored while typing or with a modal open) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "c" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (getState().settings && !modalOpen) {
        e.preventDefault();
        setCaptureOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  // --- "b" opens build mode; z / shift+z / ctrl+z undo / redo world edits -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (modalOpen || e.altKey) return;
      const st = getState();
      const k = e.key.toLowerCase();
      if (k === "t" && !e.ctrlKey && !e.metaKey && st.tree) {
        e.preventDefault();
        setView((v) => (v === "tree" ? "library" : "tree"));
      } else if (k === "b" && !e.ctrlKey && !e.metaKey && st.tree && st.path.length > 0 && !st.overview && view === "library") {
        e.preventDefault();
        setBuildOpen(true);
      } else if (k === "z") {
        if (e.repeat) return; // holding Z must not queue a pile of undos
        const client = getClient();
        if (!client || !st.tree) return;
        e.preventDefault();
        const run = e.shiftKey ? redoEdit : undoEdit;
        run(client, st.tree)
          .then((edit) => {
            if (edit) notify("info", `${e.shiftKey ? "Redid" : "Undid"}: ${edit.label}`);
          })
          .catch((err) => notify("error", `Could not ${e.shiftKey ? "redo" : "undo"}: ${errorMessage(err)}`));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, view]);

  // --- another dialog opening (HUD stays clickable) ends build mode, dropping its preview ---
  useEffect(() => {
    if (buildOpen && (book !== null || searchOpen || socratesOpen || settingsOpen || captureOpen)) {
      bus.emit("build:preview", { labels: null });
      setBuildOpen(false);
    }
  }, [buildOpen, book, searchOpen, socratesOpen, settingsOpen, captureOpen]);

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
    <div className={`app${buildOpen ? " building" : ""}`}>
      <Hud
        onOpenSearch={() => setSearchOpen(true)}
        onOpenCapture={() => setCaptureOpen(true)}
        onOpenBuild={() => state.tree && state.path.length > 0 && !state.overview && setBuildOpen(true)}
        view={view}
        onToggleView={() => setView((v) => (v === "tree" ? "library" : "tree"))}
        onToggleOverview={() =>
          bus.emit("scene:overview", { on: !getState().overview })
        }
        onRefresh={() => void refresh()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div ref={hostRef} id="game-host" style={view === "tree" ? { display: "none" } : undefined} />
      {view === "tree" && <TreeView enabled={!modalOpen} onOpenNote={(id) => setBook({ noteId: id })} />}
      {view === "library" && <TouchControls />}
      {view === "library" && <RoomPlaque onOpen={(id) => setBook({ noteId: id })} />}
      {book !== null && (
        <BookPopup key={book.noteId} noteId={book.noteId} onClose={() => setBook(null)} />
      )}
      {searchOpen && (
        <SearchPanel onClose={() => setSearchOpen(false)} onOpenNote={(id) => setBook({ noteId: id })} />
      )}
      {captureOpen && (
        <CaptureModal
          initialText={shared ?? undefined}
          onClose={(captured) => {
            setCaptureOpen(false);
            setShared(null);
            if (captured > 0) {
              notify("info", `${captured} note${captured > 1 ? "s" : ""} captured to Inbox.`);
              void refresh(); // pick up the new notes (and the Inbox room on first use)
            }
          }}
        />
      )}
      {buildOpen && state.tree && state.path.length > 0 && (
        <BuildPanel key={state.path[state.path.length - 1]} roomId={state.path[state.path.length - 1]} onClose={() => setBuildOpen(false)} />
      )}
      {socratesOpen && <SocratesDialog onClose={() => setSocratesOpen(false)} />}
      {settingsOpen && (
        <SettingsModal onClose={closeSettings} onSaved={() => {
            setSettingsOpen(false);
            if (shared !== null) setCaptureOpen(true); // first run via share sheet
          }} />
      )}
      {state.notice && <div className={`toast toast-${state.notice.level}`}>{state.notice.text}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestration helpers
// ---------------------------------------------------------------------------

/** React → Trilium: persist an overview drag as biblio_x/biblio_y labels. */
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
    notify(
      "error",
      getState().settings?.proxy
        ? "The host's Trilium token was rejected: ask whoever runs this app (or connect to your own server in the settings)."
        : "Trilium rejected the token — check settings (server URL / token).",
    );
    return;
  }
  setState({ conn: "error" });
  notify("error", `Connection problem: ${errorMessage(err)}`);
  console.error("[App] refresh failed:", err); // stack in devtools; surfaced as toast too
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

/** Hosted mode: forget the user's own server and use the host's (the proxied one) again. */
export function useHostServer(): void {
  clearSettings();
  resetClient();
  setState({ settings: chooseSettings(null, getState().host) });
}