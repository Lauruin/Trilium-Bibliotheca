/**
 * ui/Hud.tsx — top bar: breadcrumb, connection state, actions.
 * Bottom bar: controls hint (and overview-specific hint when in overview).
 * Pure presentation; every action is a prop from App.
 */

import { CONTROLS_HINT } from "../config";
import { getState, useAppStore } from "../state/store";
import { bus } from "../game/events";

const CONN_LABEL: Record<string, string> = {
  disconnected: "not connected",
  connecting: "connecting…",
  online: "online",
  offline: "offline · cached",
  error: "error",
};

export function Hud(props: {
  onOpenSearch: () => void;
  onOpenCapture: () => void;
  onOpenBuild: () => void;
  view: "library" | "tree";
  onToggleView: () => void;
  onToggleOverview: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const state = useAppStore();
  const titles = state.tree?.notes ?? {};

  return (
    <>
      <header className="hud">
        <div className="hud-left">
          <span className="brand">Bibliotheca</span>
          {props.view === "library" && <nav className="crumbs" aria-label="Room path">
            {state.path.map((noteId, i) => (
              <span key={noteId} className="crumb">
                {i > 0 && <span className="crumb-sep">›</span>}
                <button
                  className="crumb-btn"
                  title={noteId}
                  onClick={() => bus.emit("scene:enter-room", { noteId })}
                >
                  {noteId === (state.tree?.rootNoteId ?? "") ? "Library" : titles[noteId]?.title ?? noteId}
                </button>
              </span>
            ))}
            {state.path.length === 0 && <span className="crumb-dim">no room loaded</span>}
          </nav>}
        </div>
        <div className="hud-right">
          <span className={`conn conn-${state.conn}`} title={CONN_LABEL[state.conn]}>
            ● {CONN_LABEL[state.conn]}
          </span>
          <button onClick={props.onOpenCapture} title="Quick capture a thought (C)">
            capture
          </button>
          {props.view === "library" && (
            <button onClick={props.onToggleView} title="Back to the Yggdrasil tree, at the shrine's door (T)">
              tree
            </button>
          )}
          {props.view === "library" && (
            <button onClick={props.onOpenBuild} title="Build mode: change this room's look (B)">
              build
            </button>
          )}
          <button onClick={props.onOpenSearch} title="Search the vault (the wisp)">
            search
          </button>
          {props.view === "library" && (
          <button
              onClick={props.onToggleOverview}
              className={getState().overview ? "active" : ""}
              title="Overview: drag rooms to re-arrange (O)"
            >
              {state.overview ? "exit overview" : "overview"}
            </button>
          )}
          <button onClick={props.onRefresh} title="Re-walk the vault">
            refresh
          </button>
          <button onClick={props.onOpenSettings} title="Connection settings">
            settings
          </button>
        </div>
      </header>
      {props.view === "library" && <footer className="hintbar">
        {state.overview
          ? "drag rooms to re-arrange · click a room to enter it · arrows/wheel to pan · O to exit"
          : CONTROLS_HINT}
      </footer>}
    </>
  );
}