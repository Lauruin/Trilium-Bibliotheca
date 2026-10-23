/**
 * tree/keymap.ts — the tree view's keys as DATA: every action, its default keys, and the player's own bindings (PURE, unit-tested:
 * tools/unit-keymap.mjs).
 *
 * The scene asks `actionFor(bindings, key)`; the pause menu's cheat sheet and the controls tab are generated from `ACTIONS`, so the
 * list of keys can never drift from what the keys do, and the tutorial's text follows a rebinding (`fillKeys`). `Escape` is not an
 * action: it is always the pause menu (and stops a walk), so a bad binding can never lock the player out of the menu.
 * Bindings are stored in localStorage `biblio.v1.keys` (JSON, part of the save): unknown actions / keys are dropped, missing ones default.
 */

export type ActionId =
  | "forward" | "back" | "left" | "right" | "leap" | "climb" | "silk" | "cut" | "interact"
  | "cat1" | "cat2" | "cat3" | "cat4"
  | "grip" | "autoAlign" | "move"
  | "camera" | "zoomIn" | "zoomOut" | "pixel"
  | "look" | "foliage" | "shadows" | "names" | "perf"
  | "edit" | "layout";

export type ActionGroup = "Move" | "Animal" | "View" | "Tools";

export interface Action {
  id: ActionId;
  group: ActionGroup;
  label: string;
  /** One line: what it does (the cheat sheet shows it). */
  help: string;
  /** Default keys (lower-case `KeyboardEvent.key` values), at most `MAX_KEYS`. */
  keys: readonly string[];
  /** Held (movement) rather than pressed once. */
  held?: boolean;
}

export const MAX_KEYS = 2;
export const KEYS_STORAGE = "biblio.v1.keys";

export const ACTIONS: readonly Action[] = [
  { id: "forward", group: "Move", label: "Forward / up the branch", help: "Walk up the branch (guided), forward (free); fliers: throttle", keys: ["w", "arrowup"], held: true },
  { id: "back", group: "Move", label: "Back / down", help: "Walk down the branch; fliers: slow down", keys: ["s", "arrowdown"], held: true },
  { id: "left", group: "Move", label: "Turn left", help: "Turn left on the branch; mouse camera fliers: strafe", keys: ["a", "arrowleft"], held: true },
  { id: "right", group: "Move", label: "Turn right", help: "Turn right on the branch; mouse camera fliers: strafe", keys: ["d", "arrowright"], held: true },
  { id: "leap", group: "Move", label: "Leap / reach / take off", help: "Hold to aim a leap and release to jump; snake and ant: hold to reach; fliers: take off, go up", keys: [" "], held: true },
  { id: "climb", group: "Move", label: "Stay / let go / down", help: "Stay on the branch instead of climbing into a side branch; spiders: let go; hover fliers: down", keys: ["shift"], held: true },
  { id: "silk", group: "Move", label: "Spider silk", help: "Tap to drop on a thread, hold to let more rope out", keys: ["x"], held: true },
  { id: "cut", group: "Move", label: "Cut the thread", help: "Cut the thread you stand on or hang from", keys: ["c"] },
  { id: "interact", group: "Move", label: "Interact / read", help: "Read the leaf next to you, or use the shrine pad you stand at", keys: ["e"] },
  { id: "cat1", group: "Animal", label: "Reader (ant)", help: "Choose the ant; next to a leaf it opens the leaf view", keys: ["1"] },
  { id: "cat2", group: "Animal", label: "Crawlers", help: "Beetle, spider, jumping spider, snake, constrictor (again = the next)", keys: ["2"] },
  { id: "cat3", group: "Animal", label: "Walkers", help: "Lizard, cat (again = the next)", keys: ["3"] },
  { id: "cat4", group: "Animal", label: "Fliers", help: "Squirrel, bee, dragonfly, blue jay, eagle (again = the next)", keys: ["4"] },
  { id: "grip", group: "Animal", label: "Grip on / off", help: "Off: you never slip", keys: ["g"] },
  { id: "autoAlign", group: "Animal", label: "Auto-align", help: "Free movement only: straighten along the branch", keys: ["h"] },
  { id: "move", group: "Animal", label: "Movement: guided / free", help: "Guided (W up, S down) or the old free steering", keys: ["m"] },
  { id: "camera", group: "View", label: "Camera", help: "Chase, level, fixed, mouse", keys: ["v"] },
  { id: "zoomIn", group: "View", label: "Zoom in", help: "Also the mouse wheel", keys: ["+", "="] },
  { id: "zoomOut", group: "View", label: "Zoom out", help: "Also the mouse wheel", keys: ["-", "_"] },
  { id: "pixel", group: "View", label: "Pixel mode", help: "A chunky pixel look", keys: ["p"] },
  { id: "look", group: "View", label: "Look", help: "Voxel or low-poly", keys: ["l"] },
  { id: "foliage", group: "View", label: "Foliage", help: "The translucent canopy on / off", keys: ["f"] },
  { id: "shadows", group: "View", label: "Shadows", help: "Off, low, medium, high", keys: ["k"] },
  { id: "names", group: "View", label: "Branch names", help: "Signs, bubbles, off", keys: ["n"] },
  { id: "perf", group: "View", label: "Performance stats", help: "Frame rate, draw calls, the profile", keys: ["i"] },
  { id: "edit", group: "Tools", label: "Edit the branch", help: "Sliders for the branch you stand on (unlocked by the tutorial)", keys: ["b"] },
  { id: "layout", group: "Tools", label: "Layout: forest / hub", help: "Every top-level folder its own tree, or all trunks from one stump", keys: ["y"] },
];

export const ACTION_IDS: readonly ActionId[] = ACTIONS.map((a) => a.id);
export const GROUPS: readonly ActionGroup[] = ["Move", "Animal", "View", "Tools"];

/** Keys that cannot be bound: they are the browser's, the menu's, or modifiers on their own. */
const RESERVED = new Set(["escape", "tab", "meta", "control", "alt", "altgraph", "capslock", "contextmenu", "dead", "unidentified", "process", "f1", "f5", "f11", "f12"]);
export const isBindable = (key: string): boolean => typeof key === "string" && key.length >= 1 && key.length <= 12 && !RESERVED.has(key.toLowerCase()) && !/[\u0000-\u001f]/.test(key);

export type Bindings = Record<ActionId, string[]>;

export const defaultBindings = (): Bindings => Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]])) as Bindings;

const norm = (k: string): string => k.toLowerCase();

/** Coerce stored JSON (or a string of it) into bindings. Never throws; unknown actions are ignored, a damaged / missing entry takes the default; a key used twice stays with the FIRST action in `ACTIONS` order. */
export function parseBindings(raw: unknown): Bindings {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      v = null;
    }
  }
  const out = defaultBindings();
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const src = v as Record<string, unknown>;
  const chosen: Partial<Bindings> = {};
  for (const a of ACTIONS) {
    const e = src[a.id];
    if (!Array.isArray(e)) continue;
    const keys: string[] = [];
    for (const k of e) if (typeof k === "string" && isBindable(k) && !keys.includes(norm(k)) && keys.length < MAX_KEYS) keys.push(norm(k));
    chosen[a.id] = keys; // an empty list is a valid choice: the action is unbound
  }
  const used = new Set<string>();
  for (const a of ACTIONS) {
    const keys = (chosen[a.id] ?? out[a.id]).filter((k) => !used.has(k));
    for (const k of keys) used.add(k);
    out[a.id] = keys;
  }
  return out;
}

export const serializeBindings = (b: Bindings): string => JSON.stringify(Object.fromEntries(ACTIONS.map((a) => [a.id, b[a.id]])));

/** Which action does this key trigger (null: none)? */
export function actionFor(b: Bindings, key: string): ActionId | null {
  const k = norm(key);
  for (const a of ACTIONS) if (b[a.id].includes(k)) return a.id;
  return null;
}

/** Bind `key` to `slot` (0..MAX_KEYS-1) of `action`. The key is taken away from whoever had it (returned, so the UI can say so). Reserved keys change nothing. */
export function rebind(b: Bindings, action: ActionId, slot: number, key: string): { bindings: Bindings; stolenFrom: ActionId | null; ok: boolean } {
  if (!isBindable(key) || !(slot >= 0 && slot < MAX_KEYS) || !ACTION_IDS.includes(action)) return { bindings: b, stolenFrom: null, ok: false };
  const k = norm(key);
  const next: Bindings = Object.fromEntries(ACTIONS.map((a) => [a.id, [...b[a.id]]])) as Bindings;
  const mine = next[action];
  if (slot < mine.length) mine[slot] = k;
  else mine.push(k);
  next[action] = mine.filter((x, i) => x !== k || i === mine.indexOf(k)).slice(0, MAX_KEYS); // (the same key in both slots is kept once)
  let stolenFrom: ActionId | null = null;
  for (const a of ACTIONS) {
    if (a.id === action) continue;
    const i = next[a.id].indexOf(k);
    if (i >= 0) {
      next[a.id].splice(i, 1);
      stolenFrom = a.id;
    }
  }
  return { bindings: next, stolenFrom, ok: true };
}

/** Unbind one slot (the action may end up with no key). */
export function unbind(b: Bindings, action: ActionId, slot: number): Bindings {
  const next: Bindings = Object.fromEntries(ACTIONS.map((a) => [a.id, [...b[a.id]]])) as Bindings;
  next[action].splice(slot, 1);
  return next;
}

/** Human label of a key: "w" -> "W", " " -> "Space", "arrowup" -> "↑". */
export function keyLabel(key: string): string {
  const k = norm(key);
  const names: Record<string, string> = { " ": "Space", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", shift: "Shift", enter: "Enter", backspace: "Backspace", delete: "Del", pageup: "PgUp", pagedown: "PgDn" };
  return names[k] ?? (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
}

/** The first key of an action as a label ("—" when unbound). */
export const firstKey = (b: Bindings, id: ActionId): string => (b[id][0] !== undefined ? keyLabel(b[id][0]) : "—");

/** Replace `{forward}`-style tokens in a text by the action's current key ("{forward}" -> "W"); unknown tokens stay. */
export function fillKeys(text: string, b: Bindings): string {
  return text.replace(/\{([A-Za-z0-9]+)\}/g, (m, id: string) => (ACTION_IDS.includes(id as ActionId) ? firstKey(b, id as ActionId) : m));
}

/** Actions whose keys appear twice (should be none after `parseBindings` / `rebind`): for tests and the UI. */
export function conflicts(b: Bindings): Array<{ key: string; actions: ActionId[] }> {
  const by = new Map<string, ActionId[]>();
  for (const a of ACTIONS) for (const k of b[a.id]) by.set(k, [...(by.get(k) ?? []), a.id]);
  return [...by].filter(([, v]) => v.length > 1).map(([key, actions]) => ({ key, actions }));
}
