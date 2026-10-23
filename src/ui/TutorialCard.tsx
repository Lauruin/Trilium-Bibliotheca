/**
 * ui/TutorialCard.tsx — the first-run tutorial's card in the tree view (state machine: lib/tutorial.ts, store: state/progress.ts).
 * One step at a time, the keys highlighted, the mouse way underneath; "skip" is always there. Replaying it is in the shrine's Progress section.
 */

import { useSyncExternalStore } from "react";
import { currentStep, stepNumber } from "../lib/tutorial";
import { getTutorial, progressVersion, skipTutorial, subscribe } from "../state/progress";

export function TutorialCard(props: { mouseCamera: boolean }): React.JSX.Element | null {
  useSyncExternalStore(subscribe, progressVersion);
  const t = getTutorial();
  const step = currentStep(t);
  if (!step) return null;
  const { n, of } = stepNumber(t);
  return (
    <aside className="tutorial-card" data-testid="tutorial-card" data-step={step.id} aria-label="Tutorial">
      <div className="tutorial-head">
        <b>
          Tutorial {n}/{of}: {step.title}
        </b>
        <button data-testid="tutorial-skip" onClick={skipTutorial} title="Skip the tutorial (replay it from the altar)">
          skip
        </button>
      </div>
      <p>{props.mouseCamera ? step.mouse : step.keys}</p>
      <p className="tutorial-alt">{props.mouseCamera ? step.keys : step.mouse}</p>
      <div className="tutorial-keys">
        {step.kbd.map((k) => (
          <kbd key={k}>{k}</kbd>
        ))}
      </div>
    </aside>
  );
}
