/**
 * ui/CaptureModal.tsx — quick capture: type a thought, Ctrl/Cmd+Enter saves it
 * to the inbox note. The modal stays open after a save (cleared, ready for the
 * next thought) so several captures in a row cost no extra clicks; Esc closes.
 */

import { useEffect, useRef, useState } from "react";
import { captureNote } from "../lib/capture";
import { getClient, getState } from "../state/store";

export function CaptureModal(props: { initialText?: string; onClose: (captured: number) => void }): React.JSX.Element {
  const [text, setText] = useState(props.initialText ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => areaRef.current?.focus(), []);

  const close = (): void => props.onClose(saved);

  const save = async (): Promise<void> => {
    const client = getClient();
    if (!client || busy || text.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await captureNote(client, getState().rootNoteId, text);
      setText("");
      setSaved((n) => n + 1);
      areaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); // text is kept for retry
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal capture-modal"
        role="dialog"
        aria-label="Quick capture"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Quick capture</h2>
          <button onClick={close}>✕</button>
        </header>
        <textarea
          ref={areaRef}
          className="capture-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="a thought, a link, a todo… (first line becomes the title)"
          rows={6}
        />
        {error && <p className="error-line">{error}</p>}
        <div className="capture-foot">
          <span className="dim-line">
            {saved > 0 ? `${saved} saved to Inbox · ` : ""}Ctrl+Enter to save · Esc to close
          </span>
          <button onClick={() => void save()} disabled={busy || text.trim() === ""}>
            {busy ? "…" : "save"}
          </button>
        </div>
      </section>
    </div>
  );
}
