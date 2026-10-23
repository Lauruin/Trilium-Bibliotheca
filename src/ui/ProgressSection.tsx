/**
 * ui/ProgressSection.tsx — the shrine's "Progress" section: what is unlocked, what each locked thing still needs, the "unlock all"
 * switch and the tutorial's replay button. The rules are lib/unlocks.ts; the state state/progress.ts.
 */

import { useSyncExternalStore } from "react";
import { COUNTER_LABELS, COUNTERS, requirementText } from "../lib/unlocks";
import { finished } from "../lib/tutorial";
import { CATALOG, can, getCounters, getTutorial, progressVersion, replayTutorial, setUnlockAll, subscribe, unlockAll } from "../state/progress";

export function ProgressSection(): React.JSX.Element {
  useSyncExternalStore(subscribe, progressVersion);
  const counters = getCounters();
  const t = getTutorial();
  const all = unlockAll();
  return (
    <>
      <label className="shrine-row">
        <input type="checkbox" data-testid="unlock-all" checked={all} onChange={(e) => setUnlockAll(e.target.checked)} /> unlock everything (skip the progression)
      </label>
      <ul className="progress-list" data-testid="progress-list">
        {CATALOG.map((u) => {
          const open = can(u.id);
          return (
            <li key={u.id} className={open ? "done" : "locked"} data-testid={`unlock-${u.id}`} data-open={open ? "yes" : "no"}>
              {open ? "✓" : "🔒"} <b>{u.name}</b> — {open ? u.what : requirementText(u, counters)}
            </li>
          );
        })}
      </ul>
      <p className="progress-counters">
        {COUNTERS.map((c) => `${COUNTER_LABELS[c].name}: ${Math.floor(counters[c] ?? 0)}`).join(" · ")}
      </p>
      <div className="shrine-row">
        <button data-testid="tutorial-replay" onClick={replayTutorial}>
          {finished(t) ? "replay the tutorial" : "restart the tutorial"}
        </button>
      </div>
    </>
  );
}
