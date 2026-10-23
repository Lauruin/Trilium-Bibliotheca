/**
 * App.tsx — the orchestrator: owns connection lifecycle, event wiring and
 * which overlay is open. The Phaser game and the UI components are dumb;
 * all coordination happens here.
 *
 * Boot order:
 *   1. The start view is the TREE (three.js) when WebGL works, else the library (lib/webgl.ts `chooseStartView`; `?view=library`
 *      forces the library). The Phaser library is a lazy chunk: it is fetched and started the first time the library is shown
 *      (the shrine's door; or at once as the fallback) and tells React it is ready (`scene:ready`) so it gets the world.
 *   2. Settings are loaded from localStorage (cache.ts) / the host's /config.json. None → settings modal.
 *   3. With settings: refresh() — probe app-info, walk the tree, compute
 *      placements, hand everything to the scene via `scene:load-world`.
 *   4. On failure: fall back to the cached snapshot (offline mode) or, on an
 *      auth error, show a toast asking the user to check the settings.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_ROOT_NOTE_ID } from "./config";
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
import { can } from "./state/progress";
import { redoEdit, undoEdit } from "./lib/worldedit";
import { SearchPanel } from "./ui/SearchPanel";
import { TouchControls } from "./ui/TouchControls";
import { SettingsModal } from "./ui/SettingsModal";
import { SocratesDialog } from "./ui/SocratesDialog";
import { chooseStartView, webglAvailable, type ViewName } from "./lib/webgl";

/** The Phaser library is a separate chunk, fetched the first time the library is shown. */
const LibraryHost = lazy(() => import("./ui/LibraryHost"));

/** Decided once per page load (the toast for a missing WebGL is shown after mount). */
const START = chooseStartView(typeof window === "undefined" ? "" : window.location.search, typeof document === "undefined" ? true : webglAvailable());

export default function App(): React.JSX.Element {
  const state = useAppStore();
  const [book, setBook] = useState<{ noteId: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socratesOpen, setSocratesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  /** "tree" = the Yggdrasil view (three.js, the default start view); "library" = the walkable rooms (Phaser), reached through the shrine's door. */
  const [view, setView] = useState<ViewName>(START.view);
  /** The library chunk is only loaded once the library has been shown (it then stays mounted, hidden, while you are in the tree). */
  const [libraryLoaded, setLibraryLoaded] = useState(START.view === "library");
  /** Text handed over by the OS share sheet (PWA share target), consumed once. */
  const [shared, setShared] = useState<string | null>(null);
  /** A share arrived with the page load (the ref survives StrictMode's second effect run, which no longer sees the query). */
  const shareArrived = useRef(false);

  useEffect(() => {
    if (view === "library") setLibraryLoaded(true);
  }, [view]);
  useEffect(() => {
    if (START.fellBack) notify("warn", "This browser has no WebGL, so the tree view is unavailable: showing the library.");
  }, []);

  /** The shrine's door: walk into the library's root room. */
  const enterLibrary = useCallback((): void => {
    setLibraryLoaded(true);
    setView("library");
    const st = getState();
    if (st.tree) bus.emit("scene:enter-room", { noteId: st.rootNoteId }); // (a library that is not loaded yet starts in the root room anyway)
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
      bus.on("scene:ready", () => {
        const st = getState();
        if (st.tree && st.placements) bus.emit("scene:load-world", { tree: st.tree, placements: st.placements, rootNoteId: st.rootNoteId });
      }),
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

  // build mode is a tool the unlock system holds back until the tutorial is finished (or "unlock all" is on at the altar)
  const openBuild = (): void => {
    if (can("tool:build")) setBuildOpen(true);
    else notify("info", "Build mode unlocks after the tutorial (finish or skip it in the tree), or switch on “unlock all” at the altar.");
  };

  // --- "b" opens build mode; z / shift+z / ctrl+z undo / redo world edits -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (modalOpen || e.altKey) return;
      const st = getState();
      const k = e.key.toLowerCase();
      if (k === "t" && !e.ctrlKey && !e.metaKey && st.tree) {
        // T only LEAVES the library (back to the tree, at the shrine's door); in the tree it does nothing: the library is entered through the door
        if (view === "library" && webglAvailable()) {
          e.preventDefault();
          setView("tree");
        }
      } else if (k === "b" && !e.ctrlKey && !e.metaKey && st.tree && st.path.length > 0 && !st.overview && view === "library") {
        e.preventDefault();
        openBuild();
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
        onOpenBuild={() => state.tree && state.path.length > 0 && !state.overview && openBuild()}
        view={view}
        onToggleView={() => webglAvailable() && setView("tree")}
        onToggleOverview={() =>
          bus.emit("scene:overview", { on: !getState().overview })
        }
        onRefresh={() => void refresh()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {libraryLoaded && (
        <Suspense fallback={null}>
          <LibraryHost hidden={view !== "library"} />
        </Suspense>
      )}
      {view === "tree" && <TreeView enabled={!modalOpen} onOpenNote={(id) => setBook({ noteId: id })} onEnterLibrary={enterLibrary} onOpenSearch={() => setSearchOpen(true)} />}
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