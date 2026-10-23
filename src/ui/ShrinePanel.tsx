/**
 * ui/ShrinePanel.tsx — the shrine's altar: the app's own tools, in one place.
 *
 * Opened with E at the altar (or a click on it in the HUD hint). Sections are plain React children handed in by TreeView so
 * each feature (library door, wisp, save, clock, unlocks, tutorial, the later editor) adds its own without this file knowing them.
 */

import { useEffect } from "react";

export interface ShrineSection {
  id: string;
  title: string;
  /** One line of help under the title. */
  help?: string;
  body: React.ReactNode;
}

export function ShrinePanel(props: { sections: ShrineSection[]; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section className="modal shrine-modal" role="dialog" aria-label="Shrine" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>The shrine</h2>
          <button onClick={props.onClose}>✕</button>
        </header>
        <div className="shrine-body">
          {props.sections.map((s) => (
            <section key={s.id} className="shrine-sec" data-testid={`shrine-${s.id}`}>
              <h3>{s.title}</h3>
              {s.help && <p>{s.help}</p>}
              {s.body}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
