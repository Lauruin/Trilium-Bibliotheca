/**
 * ui/ControlsTab.tsx — the pause menu's CONTROLS: a structured cheat sheet and the key bindings. Everything is generated from
 * `ACTIONS` (tree/keymap.ts), so it can never disagree with what the keys do. Click a key to rebind it, press the new key
 * (Esc cancels, Backspace / Delete clears the slot). A key that belonged to another action is taken from it (and the menu says so).
 */

import { useEffect, useState } from "react";
import { ACTIONS, GROUPS, MAX_KEYS, defaultBindings, isBindable, keyLabel, rebind, unbind, type ActionId, type Bindings } from "../tree/keymap";

/** What the animals' main keys do (the actions above are the same for all; these are the differences worth knowing). */
const ANIMAL_NOTES: ReadonlyArray<[string, string]> = [
  ["Lizard, cat, squirrel, jumping spider", "Hold the leap key to aim (turn / tilt, an arc preview shows the landing), release to jump. The squirrel then glides."],
  ["Snake, constrictor, ant", "Hold the leap key to reach out as a living bridge; steer it with the move keys (or the mouse camera)."],
  ["Spiders", "Silk key: tap to drop on a thread, hold to let rope out; leap key up; move keys swing; the stay key lets go; the cut key snips a thread."],
  ["Bee, dragonfly", "Leap key takes off, then hover: leap key up, stay key down, move keys fly."],
  ["Blue jay, eagle", "Always forward: forward dives, back climbs, leap key flaps; hold the stay key for landing mode (it steers to a branch). With the mouse camera: forward = throttle, back = slow, left/right = strafe, forward while looking down = skydive."],
  ["Mouse", "Click = walk there; double-click a leaf = read it; right-drag turns the camera (mouse camera); the wheel zooms; Esc stops a walk, then opens this menu."],
];

export function ControlsTab(props: { bindings: Bindings; onBindings: (b: Bindings) => void }): React.JSX.Element {
  const { bindings, onBindings } = props;
  const [capture, setCapture] = useState<{ id: ActionId; slot: number } | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent): void => {
      if (["Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(e.key)) return; // (Shift alone is a fine key: "stay on the branch")
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapture(null);
        setNote("");
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        onBindings(unbind(bindings, capture.id, capture.slot));
        setCapture(null);
        setNote("");
        return;
      }
      if (!isBindable(e.key)) {
        setNote(`${keyLabel(e.key)} cannot be used.`);
        return;
      }
      const r = rebind(bindings, capture.id, capture.slot, e.key);
      if (r.ok) {
        onBindings(r.bindings);
        const from = r.stolenFrom ? ACTIONS.find((a) => a.id === r.stolenFrom)?.label : null;
        setNote(from ? `${keyLabel(e.key)} now belongs here; “${from}” lost it.` : "");
      }
      setCapture(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capture, bindings, onBindings]);

  const changed = JSON.stringify(bindings) !== JSON.stringify(defaultBindings());
  return (
    <div data-testid="cheatsheet">
      <p className="pause-help">
        Click a key to change it, then press the new key (Backspace clears it, Esc cancels). Esc itself always opens this menu. Each action has {MAX_KEYS} slots.
      </p>
      {note && <p className="pause-note" data-testid="controls-note">{note}</p>}
      {GROUPS.map((g) => (
        <section key={g} className="cheat-group">
          <h4>{g}</h4>
          <table className="cheat-table">
            <tbody>
              {ACTIONS.filter((a) => a.group === g).map((a) => (
                <tr key={a.id}>
                  <td className="cheat-keys">
                    {Array.from({ length: MAX_KEYS }, (_, slot) => {
                      const k = bindings[a.id][slot];
                      const active = capture?.id === a.id && capture.slot === slot;
                      return (
                        <button
                          key={slot}
                          className={`cheat-key${active ? " capturing" : ""}${k === undefined ? " empty" : ""}`}
                          data-testid={`bind-${a.id}-${slot}`}
                          onClick={() => {
                            setNote("");
                            setCapture(active ? null : { id: a.id, slot });
                          }}
                          title={k === undefined ? "Unbound: click to set a key" : "Click to change"}
                        >
                          {active ? "press a key…" : k === undefined ? "—" : keyLabel(k)}
                        </button>
                      );
                    })}
                  </td>
                  <td>
                    <b>{a.label}</b>
                    <span className="cheat-help"> — {a.help}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <section className="cheat-group">
        <h4>What the animals do with them</h4>
        <ul className="cheat-notes">
          {ANIMAL_NOTES.map(([who, what]) => (
            <li key={who}>
              <b>{who}:</b> {what}
            </li>
          ))}
        </ul>
      </section>
      <div className="shrine-row">
        <button data-testid="controls-reset" disabled={!changed} onClick={() => { onBindings(defaultBindings()); setNote("Back to the default keys."); }}>
          reset all keys to the defaults
        </button>
      </div>
    </div>
  );
}
