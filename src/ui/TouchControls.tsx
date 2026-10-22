/**
 * ui/TouchControls.tsx — on-screen buttons for phones/tablets (no keyboard).
 *
 * Shown on coarse-pointer devices (or with `?touch=1` for testing). Buttons
 * emit `input:touch` events the scene folds into the same actions as the keys:
 * ◀ ▶ walk, ▲ jump, ● interact (open the book/door in reach), ⬆ one folder up.
 * Tapping a spine/door/NPC directly still works, since the world is clickable.
 */

import { bus } from "../game/events";

type Action = "left" | "right" | "jump" | "interact" | "up";

export function touchEnabled(): boolean {
  return (
    new URLSearchParams(window.location.search).has("touch") ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function TouchButton(props: { action: Action; label: string; title: string }): React.JSX.Element {
  const send = (down: boolean) => (e: React.PointerEvent) => {
    e.preventDefault();
    bus.emit("input:touch", { action: props.action, down });
  };
  return (
    <button
      className={`touch-btn touch-${props.action}`}
      title={props.title}
      aria-label={props.title}
      onPointerDown={send(true)}
      onPointerUp={send(false)}
      onPointerCancel={send(false)}
      onPointerLeave={send(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.label}
    </button>
  );
}

export function TouchControls(): React.JSX.Element | null {
  if (!touchEnabled()) return null;
  return (
    <div className="touch-controls">
      <div className="touch-pad">
        <TouchButton action="left" label="◀" title="Walk left" />
        <TouchButton action="right" label="▶" title="Walk right" />
      </div>
      <div className="touch-pad">
        <TouchButton action="up" label="⬆" title="Up one folder" />
        <TouchButton action="jump" label="▲" title="Jump" />
        <TouchButton action="interact" label="●" title="Interact" />
      </div>
    </div>
  );
}
