/**
 * lib/tutorial.ts — the first-run tutorial as a pure state machine (unit-tested: tools/unit-tutorial.mjs).
 *
 * The scene reports what the player DOES (`GameEvent`: walked a distance, entered a side branch, leapt, read a leaf, opened the altar,
 * changed animal, zoomed, clicked to walk); each step waits for its own action, so nobody is told to press a key they already pressed.
 * Every step names the keyboard way and the mouse way. The tutorial can be skipped at any moment and replayed from the shrine.
 * Only `{step, done, skipped}` is saved (lib/save.ts); the distance walked inside a step is not.
 */

export type StepId = "walk" | "climb" | "leap" | "read" | "altar" | "animal" | "zoom";

export interface StepInfo {
  id: StepId;
  title: string;
  /** What to do with the keyboard. */
  keys: string;
  /** The same with the mouse. */
  mouse: string;
  /** Keys to highlight on the card. */
  kbd: readonly string[];
}

export const STEPS: readonly StepInfo[] = [
  { id: "walk", title: "Walk", keys: "Hold W to walk up the branch, S to go down; A and D turn on it.", mouse: "Or click a branch: the animal walks there by itself.", kbd: ["W", "A", "S", "D"] },
  { id: "climb", title: "Climb into a side branch", keys: "Walk up past the base of a side branch: you climb in by yourself. Hold Shift to stay on the branch you are on.", mouse: "Or click a branch that leaves the one you stand on.", kbd: ["W", "Shift"] },
  { id: "leap", title: "Leap", keys: "Hold Space to aim, turn the aim with A/D (W/S tilt it), release to leap. Fliers take off with Space.", mouse: "With the mouse camera the aim follows where you look.", kbd: ["Space"] },
  { id: "read", title: "Read a leaf", keys: "Stand next to a leaf and press E to read the note.", mouse: "Or double-click a leaf: the animal walks there and opens it.", kbd: ["E"] },
  { id: "altar", title: "Open the shrine", keys: "Your nest has the altar: press E there to open the shrine (clock, saving, progress).", mouse: "Or click the altar hint at the bottom of the screen.", kbd: ["E"] },
  { id: "animal", title: "Change animal", keys: "Press 1 to 4 to pick a category (again = the next animal in it).", mouse: "Or click an animal button at the bottom.", kbd: ["1", "2", "3", "4"] },
  { id: "zoom", title: "Zoom", keys: "Use the mouse wheel, or + and -, to zoom.", mouse: "Drag with the right mouse button to turn the camera in the mouse camera mode (V).", kbd: ["+", "-"] },
];

export type GameEvent =
  | { kind: "distance"; m: number }
  | { kind: "enter"; up: boolean }
  | { kind: "leap" }
  | { kind: "read" }
  | { kind: "altar" }
  | { kind: "animal" }
  | { kind: "zoom" }
  | { kind: "walkTo" };

export interface TutorialState {
  /** The step the player is on ("" before the first event: the first step). */
  step: string;
  done: boolean;
  skipped: boolean;
}

export const freshTutorial = (): TutorialState => ({ step: "walk", done: false, skipped: false });

/** Metres of walking that finish the walk step. */
export const WALK_NEEDED = 6;

export const isActive = (t: TutorialState): boolean => !t.done && !t.skipped;

/** The step the player is on, or null when finished / skipped. An unknown saved step id restarts at the first step. */
export function currentStep(t: TutorialState): StepInfo | null {
  if (!isActive(t)) return null;
  return STEPS.find((s) => s.id === t.step) ?? STEPS[0];
}

/** 1-based number of the current step and the total (for "Step 3 of 7"). */
export function stepNumber(t: TutorialState): { n: number; of: number } {
  const i = STEPS.findIndex((s) => s.id === t.step);
  return { n: (i < 0 ? 0 : i) + 1, of: STEPS.length };
}

/** Does this event complete this step? (`walkAcc` = metres walked so far in the walk step.) */
function completes(step: StepId, e: GameEvent, walkAcc: number): boolean {
  switch (step) {
    case "walk":
      return e.kind === "walkTo" || (e.kind === "distance" && walkAcc >= WALK_NEEDED);
    case "climb":
      return e.kind === "enter" && e.up;
    case "leap":
      return e.kind === "leap";
    case "read":
      return e.kind === "read";
    case "altar":
      return e.kind === "altar";
    case "animal":
      return e.kind === "animal";
    case "zoom":
      return e.kind === "zoom";
  }
}

/** The tutorial with the transient walking distance of the walk step. */
export interface Tutorial {
  state: TutorialState;
  walked: number;
}

export const startTutorial = (state: TutorialState = freshTutorial()): Tutorial => ({ state: { ...state }, walked: 0 });

/** Feed one event. Returns the new tutorial and whether the step changed (so the UI can save / toast). Pure. */
export function feed(t: Tutorial, e: GameEvent): { tutorial: Tutorial; changed: boolean } {
  if (!isActive(t.state)) return { tutorial: t, changed: false };
  const cur = currentStep(t.state)!;
  let walked = t.walked;
  if (cur.id === "walk" && e.kind === "distance" && Number.isFinite(e.m) && e.m > 0) walked += e.m;
  if (!completes(cur.id, e, walked)) return walked === t.walked ? { tutorial: t, changed: false } : { tutorial: { state: t.state, walked }, changed: false };
  const i = STEPS.findIndex((s) => s.id === cur.id);
  const next = STEPS[i + 1];
  if (!next) return { tutorial: { state: { step: "", done: true, skipped: false }, walked: 0 }, changed: true };
  return { tutorial: { state: { step: next.id, done: false, skipped: false }, walked: 0 }, changed: true };
}

/** Skip the rest (the tools it unlocks count as unlocked: the tutorial is only a guide). */
export function skip(): Tutorial {
  return { state: { step: "", done: false, skipped: true }, walked: 0 };
}

/** Start over (the shrine's "replay"). */
export const replay = (): Tutorial => startTutorial(freshTutorial());

/** The tutorial counts as finished for unlocking when it is done or was skipped. */
export const finished = (t: TutorialState): boolean => t.done || t.skipped;
