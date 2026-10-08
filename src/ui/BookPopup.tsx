/**
 * ui/BookPopup.tsx — the "book" a note is read from.
 *
 * Content is rendered inside a sandboxed iframe (sandbox="" — script
 * execution is structurally impossible, and the document is self-styled, see
 * lib/content.ts). The ✦ toggle flips between the rendered view and the raw
 * source (the "terminal pane" of game-ui.md).
 *
 * Content is fetched on open and never cached — the vault stays the single
 * source of truth for note bodies.
 */

import { useEffect, useState } from "react";
import { bookDocument, renderNoteContent, renderRawContent } from "../lib/content";
import { getClient, getState } from "../state/store";
import type { EtapiNote } from "../lib/trilium/types";

export function BookPopup(props: {
  noteId: string;
  onClose: () => void;
}): React.JSX.Element {
  const [meta, setMeta] = useState<{ title: string; type: string; mime: string } | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc closes the book.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  // Fetch title (from the walked tree when we have it, else live) + content.
  useEffect(() => {
    let alive = true;
    const client = getClient();
    if (!client) {
      setError("Not connected.");
      return;
    }
    const cached = getState().tree?.notes[props.noteId];
    if (cached) {
      setMeta({ title: cached.title, type: cached.type, mime: "" });
    } else {
      client
        .getNote(props.noteId)
        .then((n: EtapiNote) =>
          setMeta({ title: n.title, type: n.type, mime: n.mime ?? "" }),
        )
        .catch((err) => alive && setError(errorMessage(err)));
    }
    client
      .getNoteContent(props.noteId)
      .then((c) => alive && setContent(c))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [props.noteId]);

  const rendered =
    meta && content !== null ? renderNoteContent(meta.type, meta.mime, content) : null;

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className="modal book-modal"
        role="dialog"
        aria-label={meta?.title ?? "Book"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 className="book-title">{meta?.title ?? props.noteId}</h2>
          <div className="modal-actions">
            {meta && (
              <span className="badge">{meta.type}</span>
            )}
            <button onClick={() => setRaw(!raw)} title="Toggle raw source">
              {raw ? "✦ rendered" : "⌨ raw"}
            </button>
            <button onClick={props.onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>
        <div className="book-body">
          {error && <p className="error-line">{error}</p>}
          {!error && content === null && <p className="dim-line">opening…</p>}
          {!error &&
            content !== null &&
            (raw ? (
              <iframe
                title="raw"
                className="book-frame"
                sandbox=""
                srcDoc={bookDocument(renderRawContent(content))}
              />
            ) : rendered ? (
              <iframe
                title="book"
                className="book-frame"
                sandbox=""
                srcDoc={bookDocument(rendered.html)}
              />
            ) : (
              <p className="dim-line">opening…</p>
            ))}
        </div>
      </section>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}