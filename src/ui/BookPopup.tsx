/**
 * ui/BookPopup.tsx — the "book" a note is read from.
 *
 * Reading preferences (font, size, width, paper look) persist in localStorage.
 * Content is rendered in a CSP-locked sandboxed iframe (see lib/reader.ts: note
 * scripts cannot run); Trilium internal links navigate INSIDE the reader with
 * back/forward (Alt+←/→), external links ask before opening, and a "links" bar
 * lists the note's internal links. The ✦ toggle flips to the raw source.
 *
 * Content is fetched on open and never cached — the vault stays the single
 * source of truth for note bodies.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { renderNoteContent, renderRawContent } from "../lib/content";
import {
  FONTS, FONT_MAX, FONT_MIN, PAPERS, WIDTHS, loadReaderPrefs, makeNonce, prepareLinks, readerDocument,
  saveReaderPrefs, type FontKey, type PaperKey, type ReaderPrefs, type WidthKey,
} from "../lib/reader";
import { getClient, getState } from "../state/store";
import type { EtapiNote } from "../lib/trilium/types";

export function BookPopup(props: {
  noteId: string;
  onClose: () => void;
}): React.JSX.Element {
  // In-reader navigation history (following links); starts at the opened note.
  const [hist, setHist] = useState<{ stack: string[]; pos: number }>({ stack: [props.noteId], pos: 0 });
  const noteId = hist.stack[hist.pos];
  const [meta, setMeta] = useState<{ title: string; type: string; mime: string } | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadReaderPrefs);
  const [pendingExt, setPendingExt] = useState<string | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const update = (patch: Partial<ReaderPrefs>): void =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      saveReaderPrefs(next);
      return next;
    });
  const bump = (d: number): void => update({ size: Math.min(FONT_MAX, Math.max(FONT_MIN, prefs.size + d)) });

  const go = (id: string): void =>
    setHist((h) => (h.stack[h.pos] === id ? h : { stack: [...h.stack.slice(0, h.pos + 1), id], pos: h.pos + 1 }));
  const back = (): void => setHist((h) => (h.pos > 0 ? { ...h, pos: h.pos - 1 } : h));
  const forward = (): void => setHist((h) => (h.pos < h.stack.length - 1 ? { ...h, pos: h.pos + 1 } : h));

  // Keys: Esc closes · +/- text size · Alt+←/→ back/forward.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.altKey && e.key === "ArrowLeft") back();
      else if (e.altKey && e.key === "ArrowRight") forward();
      else if (!e.ctrlKey && !e.metaKey && (e.key === "+" || e.key === "=")) bump(2);
      else if (!e.ctrlKey && !e.metaKey && (e.key === "-" || e.key === "_")) bump(-2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Fetch title (from the walked tree when we have it, else live) + content.
  useEffect(() => {
    let alive = true;
    setContent(null);
    setError(null);
    setMeta(null);
    setPendingExt(null);
    const client = getClient();
    if (!client) {
      setError("Not connected.");
      return;
    }
    const cached = getState().tree?.notes[noteId];
    if (cached) {
      setMeta({ title: cached.title, type: cached.type, mime: "" });
    } else {
      client
        .getNote(noteId)
        .then((n: EtapiNote) => alive && setMeta({ title: n.title, type: n.type, mime: n.mime ?? "" }))
        .catch((err) => alive && setError(errorMessage(err)));
    }
    client
      .getNoteContent(noteId)
      .then((c) => alive && setContent(c))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [noteId]);

  // Build the sandboxed document (and the list of internal links) once per note/prefs/mode.
  const nonce = useMemo(() => makeNonce(), [noteId, raw, prefs, content]);
  const doc = useMemo(() => {
    if (content === null || !meta) return null;
    if (raw) return { srcDoc: readerDocument(renderRawContent(content), prefs, nonce), links: [] };
    const { html } = renderNoteContent(meta.type, meta.mime, content);
    const prepared = prepareLinks(html);
    return { srcDoc: readerDocument(prepared.html, prefs, nonce), links: prepared.links };
  }, [content, meta, raw, prefs, nonce]);

  // Link clicks arrive as postMessage from the iframe (opaque origin) — accept only
  // our frame and our nonce.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { biblio?: string; nonce?: string; noteId?: string; href?: string } | null;
      if (!d || d.nonce !== nonce) return;
      if (d.biblio === "note" && typeof d.noteId === "string") go(d.noteId);
      else if (d.biblio === "ext" && typeof d.href === "string") setPendingExt(d.href);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [nonce]);

  const titleOf = (id: string): string => getState().tree?.notes[id]?.title ?? id;

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className="modal book-modal"
        role="dialog"
        aria-label={meta?.title ?? "Book"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <div className="book-nav">
            <button onClick={back} disabled={hist.pos === 0} title="Back (Alt+←)">◀</button>
            <button onClick={forward} disabled={hist.pos >= hist.stack.length - 1} title="Forward (Alt+→)">▶</button>
          </div>
          <h2 className="book-title">{meta?.title ?? noteId}</h2>
          <div className="modal-actions">
            {meta && <span className="badge">{meta.type}</span>}
            <button onClick={() => bump(-2)} title="Smaller text (−)">A−</button>
            <button onClick={() => bump(2)} title="Larger text (+)">A+</button>
            <button className={showPrefs ? "active" : ""} onClick={() => setShowPrefs((s) => !s)} title="Font, width and paper">
              Aa
            </button>
            <button onClick={() => setRaw(!raw)} title="Toggle raw source">
              {raw ? "✦ rendered" : "⌨ raw"}
            </button>
            <button onClick={props.onClose} title="Close (Esc)">✕</button>
          </div>
        </header>

        {showPrefs && (
          <div className="reader-prefs">
            <label>
              font
              <select value={prefs.font} onChange={(e) => update({ font: e.target.value as FontKey })}>
                {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
              </select>
            </label>
            <label>
              size {prefs.size}px
              <input type="range" min={FONT_MIN} max={FONT_MAX} step={1} value={prefs.size} onChange={(e) => update({ size: Number(e.target.value) })} />
            </label>
            <label>
              width
              <select value={prefs.width} onChange={(e) => update({ width: e.target.value as WidthKey })}>
                {Object.keys(WIDTHS).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <span className="paper-swatches">
              {(Object.keys(PAPERS) as PaperKey[]).map((k) => (
                <button key={k} className={`paper-btn ${prefs.paper === k ? "active" : ""}`} onClick={() => update({ paper: k })} title={PAPERS[k].label}>
                  <span className="paper-chip" style={{ background: PAPERS[k].page.startsWith("#") ? PAPERS[k].page : undefined, backgroundImage: PAPERS[k].page.startsWith("#") ? undefined : PAPERS[k].page }} />
                  {PAPERS[k].label}
                </button>
              ))}
            </span>
          </div>
        )}

        {pendingExt && (
          <div className="reader-notice">
            Open external link <code>{pendingExt}</code>?
            <button onClick={() => { window.open(pendingExt, "_blank", "noopener,noreferrer"); setPendingExt(null); }}>open</button>
            <button onClick={() => setPendingExt(null)}>cancel</button>
          </div>
        )}

        <div className="book-body">
          {error && <p className="error-line">{error}</p>}
          {!error && doc === null && <p className="dim-line">opening…</p>}
          {!error && doc !== null && (
            <iframe
              ref={frameRef}
              title={raw ? "raw" : "book"}
              className="book-frame"
              // allow-scripts WITHOUT allow-same-origin: opaque origin, and the CSP in the
              // document lets only our nonce'd link-click script run (see lib/reader.ts).
              sandbox="allow-scripts"
              srcDoc={doc.srcDoc}
            />
          )}
        </div>

        {doc !== null && doc.links.length > 0 && !error && (
          <footer className="reader-links" aria-label="Links in this note">
            <span className="dim-line">links:</span>
            {doc.links.map((l) => (
              <button key={l.noteId} onClick={() => go(l.noteId)} title={l.noteId}>
                {l.text !== l.noteId ? l.text : titleOf(l.noteId)}
              </button>
            ))}
          </footer>
        )}
      </section>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
