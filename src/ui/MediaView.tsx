/**
 * ui/MediaView.tsx — shows an image / PDF note (or offers a file for download) inside the reader popup.
 *
 * These render in the PARENT document, not in the sandboxed text iframe: a picture needs no sandbox
 * (an <img> never runs scripts, SVG included), and the browser's PDF viewer does not work inside a
 * sandboxed iframe. The PDF blob is created by us with the type `application/pdf` taken from the BYTES
 * (lib/media.ts), never from the server's mime, so a note cannot make us open HTML as a document.
 * Object URLs are created on mount and revoked on unmount.
 */

import { useEffect, useState } from "react";
import { downloadName, formatBytes } from "../lib/media";
import type { MediaPlan } from "../lib/media";

export function MediaView(props: {
  plan: Exclude<MediaPlan, "text">;
  blob: Blob;
  /** The mime derived from the bytes (may be "" for a plain binary). */
  mime: string;
  title: string;
}): React.JSX.Element {
  const { plan, blob, mime, title } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [actual, setActual] = useState(false);
  const [dims, setDims] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(new Blob([blob], { type: mime || "application/octet-stream" }));
    setUrl(u);
    setDims(null);
    setActual(false);
    return () => URL.revokeObjectURL(u);
  }, [blob, mime]);

  const name = downloadName(title, mime);
  const meta = `${mime || "binary"} · ${formatBytes(blob.size)}${dims ? ` · ${dims}` : ""}`;

  if (!url) return <p className="dim-line media-wait">opening…</p>;

  if (plan === "image") {
    return (
      <div className="media-view" data-testid="media-image">
        <div className={`media-scroll ${actual ? "actual" : "fit"}`}>
          <img
            src={url}
            alt={title}
            title={actual ? "Click to fit the window" : "Click for actual size"}
            onClick={() => setActual((a) => !a)}
            onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)}
          />
        </div>
        <footer className="media-bar">
          <span className="dim-line">{meta}</span>
          <a className="media-btn" href={url} download={name}>download</a>
        </footer>
      </div>
    );
  }

  if (plan === "pdf") {
    return (
      <div className="media-view" data-testid="media-pdf">
        <iframe className="media-pdf" title={title} src={`${url}#view=FitH`} />
        <footer className="media-bar">
          <span className="dim-line">{meta} · if nothing shows, your browser cannot show PDFs inline</span>
          <a className="media-btn" href={url} download={name}>download</a>
        </footer>
      </div>
    );
  }

  return (
    <div className="media-view media-card" data-testid="media-download">
      <p className="media-name">{title}</p>
      <p className="dim-line">{meta}</p>
      <p className="dim-line">This kind of file cannot be shown here.</p>
      <a className="media-btn big" href={url} download={name}>download {name}</a>
    </div>
  );
}
