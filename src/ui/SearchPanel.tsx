/**
 * ui/SearchPanel.tsx — the wisp's keyword search.
 *
 * A thin window over Trilium's own search engine (ETAPI GET /notes?search=…).
 * Results are full notes; clicking one opens the book popup. This is the
 * "basic keyword search" amenity from game-ui.md — the semantic/RAG
 * "receptionist" is a later capability of the intelligence service.
 * In the tree view a result that is part of the tree can also be walked to ("take me there": the animal's autopilot) or lit up
 * ("light the way": the wisp flies to it and hovers beside it with a beam), see tree/bridge.ts.
 */

import { useEffect, useRef, useState } from "react";
import { getClient } from "../state/store";
import { getTreeBridge } from "../tree/bridge";

export function SearchPanel(props: {
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ noteId: string; title: string; type: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const run = async (): Promise<void> => {
    const client = getClient();
    if (!client || query.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.searchNotes(query.trim());
      setResults(
        res.results.map((n) => ({ noteId: n.noteId, title: n.title, type: n.type })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className="modal search-modal"
        role="dialog"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Search the vault</h2>
          <button onClick={props.onClose}>✕</button>
        </header>
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="keywords… (Trilium full-text search)"
          />
          <button type="submit" disabled={busy}>
            {busy ? "…" : "search"}
          </button>
        </form>
        {error && <p className="error-line">{error}</p>}
        <ul className="search-results">
          {results.map((r) => {
            const bridge = getTreeBridge();
            const inTree = bridge?.has(r.noteId) ?? false;
            return (
              <li key={r.noteId} className="search-result">
                <button
                  className="search-open"
                  title="Open it in the reader"
                  onClick={() => {
                    props.onClose();
                    props.onOpenNote(r.noteId);
                  }}
                >
                  <span className="badge">{r.type}</span>
                  {r.title}
                </button>
                {inTree && (
                  <>
                    <button
                      className="search-act"
                      title="The animal walks there by itself (any key stops it)"
                      onClick={() => {
                        props.onClose();
                        bridge?.walkTo(r.noteId);
                      }}
                    >
                      take me there
                    </button>
                    <button
                      className="search-act"
                      title="The wisp flies there and hovers beside it with a beam of light"
                      onClick={() => {
                        props.onClose();
                        bridge?.lightTo(r.noteId);
                      }}
                    >
                      light the way
                    </button>
                  </>
                )}
              </li>
            );
          })}
          {results.length === 0 && !busy && !error && (
            <li className="dim-line">no results yet — type and search</li>
          )}
        </ul>
      </section>
    </div>
  );
}