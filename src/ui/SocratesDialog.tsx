/**
 * ui/SocratesDialog.tsx — an honest placeholder.
 *
 * game-ui.md wants a Socratic NPC wired to the intelligence service (RAG chat
 * with a didactic persona). That service is a separate plane of the
 * architecture and does not exist yet — so the statue says exactly that
 * instead of faking an AI. When the service lands, this dialog gets a real
 * chat view scoped to the current room's notes by default.
 */

import { useEffect } from "react";

export function SocratesDialog(props: { onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section
        className="modal socrates-modal"
        role="dialog"
        aria-label="Socrates"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Socrates</h2>
          <button onClick={props.onClose}>✕</button>
        </header>
        <p className="socrates-line">
          <em>"I know that I know nothing."</em>
        </p>
        <p>
          …including, currently, how to answer you. The Socratic dialogue needs the
          <strong> intelligence service</strong> — a retrieval-augmented chat over your own
          notes, a separate plane of this project's architecture that hasn't been built
          yet. I'd rather stand here honestly than pretend to think.
        </p>
        <p className="dim-line">
          When that service exists, this dialog becomes the chat: scoped to this room's
          notes by default, whole vault on request. The keyword search over there by the
          wisp works today — try that instead.
        </p>
        <div className="modal-actions">
          <button onClick={props.onClose}>farewell</button>
        </div>
      </section>
    </div>
  );
}