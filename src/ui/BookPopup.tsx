/**
 * ui/BookPopup.tsx — the "book" a note is read from.
 *
 * Text, markdown and code notes render in a CSP-locked sandboxed iframe (lib/reader.ts: note scripts cannot
 * run); image / PDF / other file notes render in the popup itself (ui/MediaView.tsx) from the note's bytes.
 * Reading preferences (font, size, width, paper look) persist in localStorage, and so does the scroll position
 * of every note (the 200 most recent). Trilium internal links navigate INSIDE the reader with back/forward
 * (Alt+←/→), external links ask before opening, pictures embedded in a text note are fetched through ETAPI and
 * inlined (lib/embeds.ts), and around the page there is a little chrome: breadcrumb, labels, edit date, reading
 * time, an outline of the headings, find-in-note (Ctrl+F), previous / next sibling ([ and ]), a zen mode
 * (Alt+Z), copy link and "open in Trilium". The ✦ toggle flips to the raw source.
 *
 * Content is fetched on open and never cached — the vault stays the single source of truth for note bodies.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { effectiveType, renderNoteContent, renderRawContent } from "../lib/content";
import { collectEmbeds, inlineEmbeddedImages } from "../lib/embeds";
import { NOISE_LABELS } from "../lib/library";
import {
  decodeText, downloadName, isBinaryNoteType, MAX_TEXT_BYTES, planMedia, sniffBytes, type MediaPlan, type Sniffed,
} from "../lib/media";
import { ancestorsOf, siblingsOf, triliumUrl } from "../lib/notepath";
import {
  FONTS, FONT_MAX, FONT_MIN, PAPERS, WIDTHS, loadReaderPrefs, makeNonce, prepareDocument, readingMinutes, readerDocument,
  recallScroll, rememberScroll, saveReaderPrefs, type FontKey, type PaperKey, type ReaderPrefs, type WidthKey,
} from "../lib/reader";
import { getClient, getState, notify } from "../state/store";
import type { EtapiNote } from "../lib/trilium/types";
import { MediaView } from "./MediaView";

interface Meta {
  title: string;
  type: string;
  mime: string;
  /** "YYYY-MM-DD" of the last change, when the server told us. */
  modified: string | null;
  /** Own labels worth showing as chips (no `biblio_*`, no Trilium bookkeeping labels). */
  labels: Array<{ name: string; value: string }>;
}

type Loaded =
  | { kind: "text"; content: string; fileNote?: string }
  | { kind: "media"; plan: Exclude<MediaPlan, "text">; blob: Blob; mime: string };

interface KeyInfo {
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** The key went to a text field / select (do not treat letters as shortcuts). */
  typing: boolean;
}

const esc = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function metaFromNote(n: EtapiNote): Meta {
  const labels = (n.attributes ?? [])
    .filter((a) => a.type === "label" && a.noteId === n.noteId)
    .map((a) => ({ name: a.name, value: a.value ?? "" }))
    .filter((a) => !NOISE_LABELS.has(a.name.toLowerCase()) && !a.name.toLowerCase().startsWith("biblio_"))
    .slice(0, 14);
  const raw = typeof n.utcDateModified === "string" ? n.utcDateModified : typeof n.dateModified === "string" ? n.dateModified : "";
  return {
    title: n.title,
    type: effectiveType(n.type, n.mime),
    mime: n.mime ?? "",
    modified: /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null,
    labels,
  };
}

export function BookPopup(props: {
  noteId: string;
  onClose: () => void;
}): React.JSX.Element {
  // In-reader navigation history (following links); starts at the opened note.
  const [hist, setHist] = useState<{ stack: string[]; pos: number }>({ stack: [props.noteId], pos: 0 });
  const noteId = hist.stack[hist.pos];
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [embeds, setEmbeds] = useState<{ src: string; html: string } | null>(null);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadReaderPrefs);
  const [pendingExt, setPendingExt] = useState<string | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [activeHead, setActiveHead] = useState("");
  const [zen, setZen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [found, setFound] = useState<{ count: number; index: number }>({ count: 0, index: -1 });
  const [restore, setRestore] = useState(() => recallScroll(props.noteId));
  const frameRef = useRef<HTMLIFrameElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef(restore);
  const nonceRef = useRef("");
  const keyRef = useRef<(k: KeyInfo, e?: KeyboardEvent) => void>(() => undefined);
  const scrollTimer = useRef<number | undefined>(undefined);

  const update = (patch: Partial<ReaderPrefs>): void => {
    setRestore(scrollRef.current); // rebuilding the document keeps your place
    setPrefs((p) => {
      const next = { ...p, ...patch };
      saveReaderPrefs(next);
      return next;
    });
  };
  const bump = (d: number): void => update({ size: Math.min(FONT_MAX, Math.max(FONT_MIN, prefs.size + d)) });

  const go = (id: string): void =>
    setHist((h) => (h.stack[h.pos] === id ? h : { stack: [...h.stack.slice(0, h.pos + 1), id], pos: h.pos + 1 }));
  const back = (): void => setHist((h) => (h.pos > 0 ? { ...h, pos: h.pos - 1 } : h));
  const forward = (): void => setHist((h) => (h.pos < h.stack.length - 1 ? { ...h, pos: h.pos + 1 } : h));

  const postToFrame = (msg: Record<string, unknown>): void => {
    frameRef.current?.contentWindow?.postMessage({ ...msg, nonce: nonceRef.current }, "*");
  };

  const tree = getState().tree;
  const sib = tree ? siblingsOf(tree, noteId) : null;
  const crumbs = tree ? ancestorsOf(tree, noteId) : [];
  const titleOf = (id: string): string => (tree && id === tree.rootNoteId ? "Library" : tree?.notes[id]?.title ?? id);
  const openInTrilium = triliumUrl(getState().settings?.serverUrl, tree, noteId);
  const isMedia = loaded?.kind === "media";

  // Keys. The same handler serves real key presses and keys forwarded from inside the iframe.
  keyRef.current = (k, e) => {
    const mod = k.ctrl || k.meta;
    const fkey = k.key === "f" || k.key === "F";
    if (k.key === "Escape") {
      if (k.typing) return; // the find box handles its own Escape
      if (findOpen) closeFind();
      else if (zen) setZen(false);
      else props.onClose();
    } else if (mod && fkey && !isMedia) {
      e?.preventDefault();
      openFind();
    } else if (k.key === "F3" && !isMedia) {
      e?.preventDefault();
      if (!findOpen) openFind();
      else postToFrame({ biblio: "findStep", dir: k.shift ? -1 : 1 });
    } else if (k.typing) {
      return;
    } else if (k.alt && k.key === "ArrowLeft") back();
    else if (k.alt && k.key === "ArrowRight") forward();
    else if (k.alt && (k.key === "z" || k.key === "Z") && !isMedia) setZen((z) => !z);
    else if (!mod && !k.alt && (k.key === "+" || k.key === "=") && !isMedia) bump(2);
    else if (!mod && !k.alt && (k.key === "-" || k.key === "_") && !isMedia) bump(-2);
    else if (!mod && !k.alt && k.key === "[" && sib?.prev) go(sib.prev);
    else if (!mod && !k.alt && k.key === "]" && sib?.next) go(sib.next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      keyRef.current({ key: e.key, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, typing }, e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openFind(): void {
    setFindOpen(true);
    window.setTimeout(() => findRef.current?.focus(), 0);
  }
  function closeFind(): void {
    setFindOpen(false);
    setFound({ count: 0, index: -1 });
    postToFrame({ biblio: "findClear" });
  }

  // Fetch what the note is made of: title + type from the server (the cached title shows at once), then text or bytes.
  useEffect(() => {
    let alive = true;
    const recalled = recallScroll(noteId);
    scrollRef.current = recalled;
    setRestore(recalled);
    setLoaded(null);
    setError(null);
    setEmbeds(null);
    setPendingExt(null);
    setActiveHead("");
    setFound({ count: 0, index: -1 });
    const client = getClient();
    if (!client) {
      setError("Not connected.");
      return;
    }
    const cached = getState().tree?.notes[noteId];
    setMeta(cached ? { title: cached.title, type: cached.type, mime: "", modified: null, labels: [] } : null);
    // Text-like notes (what the walk says) start their content fetch right away, in parallel with the note record.
    const speculative = cached && !isBinaryNoteType(cached.type) ? client.getNoteContent(noteId) : null;
    speculative?.catch(() => undefined);
    (async () => {
      try {
        const n = await client.getNote(noteId);
        if (!alive) return;
        setMeta(metaFromNote(n));
        if (isBinaryNoteType(n.type)) {
          const blob = await client.getNoteBlob(noteId);
          if (!alive) return;
          const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
          const sn: Sniffed = sniffBytes(head);
          const plan = planMedia(n.type, n.mime ?? "", sn, blob.size);
          if (plan === "text") {
            const bytes = new Uint8Array(await blob.slice(0, MAX_TEXT_BYTES + 1).arrayBuffer());
            const { text, truncated } = decodeText(bytes);
            const note = `${downloadName(n.title, "text/plain")} — text file${truncated ? `, shown up to the first ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)} MB` : ""}.`;
            if (alive) setLoaded({ kind: "text", content: text, fileNote: note });
          } else if (alive) {
            setLoaded({ kind: "media", plan, blob, mime: sn.mime });
          }
        } else {
          const content = await (speculative ?? client.getNoteContent(noteId));
          if (alive) setLoaded({ kind: "text", content });
        }
      } catch (err) {
        if (alive) setError(errorMessage(err));
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(scrollTimer.current);
      rememberScroll(noteId, scrollRef.current);
    };
  }, [noteId]);

  // The prepared note: HTML for the sandbox, the internal links, the heading outline, the word count.
  const prepared = useMemo(() => {
    if (loaded?.kind !== "text" || !meta) return null;
    if (raw) return { ...prepareDocument(renderRawContent(loaded.content)), links: [], outline: [] };
    const body = loaded.fileNote
      ? `<p class="text-file-note">${esc(loaded.fileNote)}</p>${renderRawContent(loaded.content)}`
      : renderNoteContent(meta.type, meta.mime, loaded.content).html;
    return prepareDocument(body);
  }, [loaded, meta, raw]);

  // Pictures embedded in the note: fetched through ETAPI and inlined (the sandbox cannot use Trilium's session cookie).
  useEffect(() => {
    if (!prepared || raw || collectEmbeds(prepared.html).size === 0) return;
    const client = getClient();
    if (!client) return;
    let alive = true;
    void inlineEmbeddedImages(prepared.html, {
      note: (id) => client.getNoteBlob(id),
      attachment: (id) => client.getAttachmentBlob(id),
    }).then((r) => {
      if (!alive) return;
      setRestore(scrollRef.current);
      setEmbeds({ src: prepared.html, html: r.html });
    });
    return () => {
      alive = false;
    };
  }, [prepared, raw]);

  // The sandboxed document (new nonce for every build; the message handler reads it from nonceRef).
  const doc = useMemo(() => {
    if (!prepared) return null;
    const html = embeds && embeds.src === prepared.html ? embeds.html : prepared.html;
    const nonce = makeNonce();
    return { srcDoc: readerDocument(html, prefs, nonce, { restore }), nonce };
  }, [prepared, embeds, prefs, restore]);
  nonceRef.current = doc?.nonce ?? "";

  // Messages from the iframe (opaque origin): accept only our frame and our nonce.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as {
        biblio?: string; nonce?: string; noteId?: string; href?: string; frac?: number; head?: string;
        count?: number; index?: number; key?: string; alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean;
      } | null;
      if (!d || d.nonce !== nonceRef.current) return;
      if (d.biblio === "note" && typeof d.noteId === "string") go(d.noteId);
      else if (d.biblio === "ext" && typeof d.href === "string") setPendingExt(d.href);
      else if (d.biblio === "scroll" && typeof d.frac === "number") {
        scrollRef.current = d.frac;
        setActiveHead(typeof d.head === "string" ? d.head : "");
        window.clearTimeout(scrollTimer.current);
        scrollTimer.current = window.setTimeout(() => rememberScroll(hist.stack[hist.pos], scrollRef.current), 400);
      } else if (d.biblio === "found" && typeof d.count === "number") setFound({ count: d.count, index: typeof d.index === "number" ? d.index : -1 });
      else if (d.biblio === "key" && typeof d.key === "string") {
        keyRef.current({ key: d.key, alt: !!d.alt, ctrl: !!d.ctrl, meta: !!d.meta, shift: !!d.shift, typing: false });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [hist]);

  // Find: a short debounce while typing; after the frame reloads the search is repeated.
  useEffect(() => {
    if (!findOpen) return;
    const t = window.setTimeout(() => postToFrame({ biblio: "find", q: findQ }), 140);
    return () => window.clearTimeout(t);
  }, [findQ, findOpen]);

  const copyLink = (): void => {
    const url = openInTrilium ?? `#${noteId}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => notify("info", "Link copied"))
      .catch(() => notify("warn", "Could not copy the link"));
  };

  const outline = prepared?.outline ?? [];
  const minutes = prepared ? readingMinutes(prepared.words) : 0;

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className={`modal book-modal${zen ? " zen" : ""}`}
        role="dialog"
        aria-label={meta?.title ?? "Book"}
        onClick={(e) => e.stopPropagation()}
      >
        {zen ? (
          <header className="modal-head zen-head">
            <h2 className="book-title">{meta?.title ?? noteId}</h2>
            <div className="modal-actions">
              <button onClick={() => openFind()} title="Find in note (Ctrl+F)">find</button>
              <button onClick={() => setZen(false)} title="Leave zen mode (Alt+Z)">exit zen</button>
            </div>
          </header>
        ) : (
          <header className="modal-head">
            <div className="book-nav">
              <button onClick={back} disabled={hist.pos === 0} title="Back (Alt+←)">◀</button>
              <button onClick={forward} disabled={hist.pos >= hist.stack.length - 1} title="Forward (Alt+→)">▶</button>
            </div>
            <h2 className="book-title">{meta?.title ?? noteId}</h2>
            <div className="modal-actions">
              {meta && <span className="badge">{meta.type}</span>}
              {outline.length > 0 && (
                <button className={showOutline ? "active" : ""} onClick={() => setShowOutline((s) => !s)} title="Outline of the headings">
                  outline
                </button>
              )}
              {!isMedia && <button onClick={() => openFind()} title="Find in note (Ctrl+F)">find</button>}
              {!isMedia && <button onClick={() => bump(-2)} title="Smaller text (−)">A−</button>}
              {!isMedia && <button onClick={() => bump(2)} title="Larger text (+)">A+</button>}
              {!isMedia && (
                <button className={showPrefs ? "active" : ""} onClick={() => setShowPrefs((s) => !s)} title="Font, width and paper">
                  Aa
                </button>
              )}
              {!isMedia && (
                <button onClick={() => setRaw(!raw)} title="Toggle raw source">
                  {raw ? "✦ rendered" : "⌨ raw"}
                </button>
              )}
              {!isMedia && <button onClick={() => setZen(true)} title="Zen mode: only the page (Alt+Z)">zen</button>}
              <button onClick={copyLink} title="Copy a link to this note">link</button>
              {openInTrilium && (
                <a className="media-btn" href={openInTrilium} target="_blank" rel="noopener noreferrer" title="Open this note in Trilium itself">
                  ↗ Trilium
                </a>
              )}
              <button onClick={props.onClose} title="Close (Esc)">✕</button>
            </div>
          </header>
        )}

        {!zen && showPrefs && !isMedia && (
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

        {!zen && (crumbs.length > 0 || (meta && (meta.labels.length > 0 || meta.modified || minutes > 0))) && (
          <div className="reader-meta">
            {crumbs.length > 0 && (
              <nav className="crumbs" aria-label="Where this note is">
                {crumbs.map((id, i) => (
                  <span key={id}>
                    {i > 0 && <span className="crumb-sep"> › </span>}
                    <button className="crumb" onClick={() => go(id)} title="Open this folder note">{titleOf(id)}</button>
                  </span>
                ))}
              </nav>
            )}
            <span className="meta-bits">
              {meta?.labels.map((l) => (
                <span key={l.name} className="chip" title={l.value ? `#${l.name}=${l.value}` : `#${l.name}`}>
                  #{l.name}{l.value ? `=${l.value.length > 24 ? `${l.value.slice(0, 24)}…` : l.value}` : ""}
                </span>
              ))}
              {meta?.modified && <span className="dim-line">edited {meta.modified}</span>}
              {minutes > 0 && <span className="dim-line">≈ {minutes} min</span>}
            </span>
          </div>
        )}

        {findOpen && !isMedia && (
          <div className="reader-find">
            <input
              ref={findRef}
              type="text"
              value={findQ}
              placeholder="find in this note"
              aria-label="Find in this note"
              onChange={(e) => setFindQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  postToFrame({ biblio: "findStep", dir: e.shiftKey ? -1 : 1 });
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeFind();
                }
              }}
            />
            <span className="dim-line">{findQ ? (found.count === 0 ? "no match" : `${found.index + 1} / ${found.count}${found.count >= 500 ? "+" : ""}`) : ""}</span>
            <button onClick={() => postToFrame({ biblio: "findStep", dir: -1 })} disabled={found.count === 0} title="Previous (Shift+Enter)">▲</button>
            <button onClick={() => postToFrame({ biblio: "findStep", dir: 1 })} disabled={found.count === 0} title="Next (Enter / F3)">▼</button>
            <button onClick={closeFind} title="Close (Esc)">✕</button>
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
          {!zen && showOutline && outline.length > 0 && (
            <aside className="reader-outline" aria-label="Outline">
              {outline.map((o) => (
                <button
                  key={o.id}
                  className={`outline-item l${o.level}${activeHead === o.id ? " current" : ""}`}
                  onClick={() => postToFrame({ biblio: "goto", id: o.id })}
                  title={o.text}
                >
                  {o.text}
                </button>
              ))}
            </aside>
          )}
          <div className="book-main">
            {error && <p className="error-line">{error}</p>}
            {!error && loaded === null && <p className="dim-line">opening…</p>}
            {!error && loaded?.kind === "media" && meta && (
              <MediaView plan={loaded.plan} blob={loaded.blob} mime={loaded.mime} title={meta.title} />
            )}
            {!error && doc !== null && (
              <iframe
                // a NEW element for every document: browsers sometimes ignore a `srcdoc` change while the first
                // document is still loading, which left the pre-embed page (broken pictures) on screen
                key={doc.nonce}
                ref={frameRef}
                title={raw ? "raw" : "book"}
                className="book-frame"
                // allow-scripts WITHOUT allow-same-origin: opaque origin, and the CSP in the
                // document lets only our nonce'd script run (see lib/reader.ts).
                sandbox="allow-scripts"
                srcDoc={doc.srcDoc}
                onLoad={() => {
                  if (findOpen && findQ) postToFrame({ biblio: "find", q: findQ });
                }}
              />
            )}
          </div>
        </div>

        {!zen && !error && (sib?.prev || sib?.next || (prepared && prepared.links.length > 0)) && (
          <footer className="reader-links" aria-label="Neighbours and links">
            {sib && (sib.prev || sib.next) && (
              <span className="sib-nav">
                <button onClick={() => sib.prev && go(sib.prev)} disabled={!sib.prev} title={sib.prev ? `Previous: ${titleOf(sib.prev)} ( [ )` : "No previous note"}>
                  ‹ {sib.prev ? titleOf(sib.prev) : ""}
                </button>
                <span className="dim-line small">{sib.index + 1} / {sib.total}</span>
                <button onClick={() => sib.next && go(sib.next)} disabled={!sib.next} title={sib.next ? `Next: ${titleOf(sib.next)} ( ] )` : "No next note"}>
                  {sib.next ? titleOf(sib.next) : ""} ›
                </button>
              </span>
            )}
            {prepared && prepared.links.length > 0 && (
              <>
                <span className="dim-line">links:</span>
                {prepared.links.map((l) => (
                  <button key={l.noteId} onClick={() => go(l.noteId)} title={l.noteId}>
                    {l.text !== l.noteId ? l.text : titleOf(l.noteId)}
                  </button>
                ))}
              </>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
