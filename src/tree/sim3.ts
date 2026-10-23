/**
 * tree/sim3.ts — creature simulation on 3D branches (renderer-agnostic, pure, unit-tested).
 *
 * The HEAD is steered by the player (W forward along its heading, A/D turn it); the body is a chain that
 * TRAILS the head along its recorded path; feet are placed PROCEDURALLY (planted until the stride is exceeded,
 * then stepped). A creature is data (`Animal`).
 *
 * Heading `phi` = angle between the direction of travel and the branch tangent in the UNROLLED surface: phi=0
 * walks straight along the branch, phi≠0 spirals around it. Thin branches are hard to steer on, so (a) the turn
 * rate shrinks when the animal is wide compared to the branch (`turnScale`) and (b) `Creature.autoAlign`
 * (default on, key H) eases phi back to straight along the branch (0, or π when walking backwards) while you walk
 * without pressing A/D. With autoAlign off there is no correction at all.
 *
 * Two MOVE MODES (`Creature.moveMode`, key M in the scene): **free** (above) and **guided** (the app default): W / S walk up / down
 * the branch (tip-ward / base-ward), A / D turn the animal (left / right as it sees it), and the heading eases in a smooth curve
 * to the heading the keys ask for (`steerGuided`); see `GUIDED`. `spawn` itself defaults to free, so the sim tests are unchanged.
 *
 * Grip is decided by WORLD gravity, not by the branch's own frame: a surface point hangs when its outward normal
 * points down (`n.y < -0.12`); the drain grows with the square of how far down it points (a vertical trunk never
 * drains, a lightly overhanging stretch only slowly, a full underside slips in ~2 s), the top refills. Empty = slip
 * off (never fatal: you land on a branch below, or climb back onto the one you fell from; falling below
 * `world.groundY` takes the same recovery). The snake (`bodyGrip`) only drains when NO part of its body is on top;
 * `clings` animals (spider, jumping spider) never drain. `shake` (0..1) tells the renderer to tremble when a fall is near.
 *
 * Reach (hold Space; snake and ant, the animals with a `reach` and no `leap`) is steerable (A/D yaw, W/S pitch the stretching
 * head) and stops at `reach.max`; it only falls when the grip runs out. "On top" means some sampled body part for the snake
 * (`bodyGrip`); an animal without `bodyGrip` (the ant, whose whole 12 px body leaves the branch) holds on by its rear: the spot
 * it stretched out from counts (`bestNormalY`). Gliders (`leap.steer`) pitch with W (dive: fast,
 * steep) / S (flare: slow, floaty) and bend with A/D. `climbTarget` says which side branch Shift would climb into
 * (shared with `moveHead`).
 *
 * Flight (`Animal.flight`, see FlightSpec): Space on a branch takes off; `Creature.flight` then holds the free-flight
 * state and `step()` runs `stepFlight` (position/velocity in the air, trail samples with surf: null, the head stays at
 * the perch). `hover` fliers (bee, dragonfly) fly where they point (W/S, A/D yaw, Space up, Shift down) and stop when
 * you let go; the `wing` flier (blue jay) always moves forward and trades height for speed (an energy model with
 * stall). Touching a branch lands (`autoLand`, or Shift held) or deflects you off it; never below `groundY + 15`.
 * `flightBasis` gives the renderer the body axes.
 *
 * Leap aiming (exactly the animals with a `leap`: lizard, cat, squirrel, jumping spider; crawlers ant / spider / snake never
 * aim): Space is PRESS-AND-HOLD to aim, RELEASE to leap (`Creature.aim`). While held the
 * animal stands still, A/D turn the aim (`yaw`, relative to the heading), W/S tilt it (`pitch`, relative to the default
 * leap angle) and `charge` builds 0.55 -> 1 over 0.8 s and scales the launch speed (full charge = the plain leap); a quick
 * tap (< 0.18 s) is a full-power default leap, Shift cancels. AIM ASSIST (always on, mild): when the manual arc would not
 * land on ANOTHER branch, `planLeap` searches +-30 degrees / +-0.25 rad around it for an arc that does. `leapPreview`
 * runs the very ballistics `stepAir` uses (shared `airPhysics` / `airContact`), so the drawn arc is the one you fly.
 * Blue jay landing mode: Shift held in wing flight flares (speed -> 1.15 x stall), levels out and magnetises toward the
 * best branch ahead (`Flight.landTarget`); touching a branch below 1.4 x stall lands without Shift. The perch a flier took off from
 * only lands it once it has cleared it (`Flight.cleared`; until then it deflects), and a flier whose grip ran out can open its
 * wings while it falls (`startFlightFromFall`).
 *
 * Spider silk (`Animal.silk`: spider, jumping spider; key X = `Input.silk`, edge): on a surface X drops on a rope (`Creature.silk:
 * Dangle`, a pendulum under `anchor`; the head keeps the perch, the trail gets surf: null samples). While hanging: S lets the rope out
 * (`silk.reel` px/s, up to `silk.maxLen`, never below groundY + 10), W reels it in (1.3 x faster; fully reeled = back on the anchor,
 * no thread), A/D swing sideways and turn the facing (`yaw`), Space held pumps the swing along the facing (`silk.pump`), X again lets
 * go (ballistic fall, `slip: false`) and the thread freezes as a FREE thread; touching any branch lands there (reuse of `land`) and the
 * rope freezes as a BRIDGE (silk.ts: real `Branch` with `silk: true`, `endLink`). The origin branch only catches the spider once it
 * has swung clear of it. Threads are walkable (`canUseThreads`: clingers and animals up to 6 px half-width: ant, spiders, bee,
 * dragonfly): off a thread's start you land on its anchor branch, off its end on `endLink.b`; Shift near either end climbs on
 * (`climbTarget`); everyone else ignores threads in `sideEntry` and in every contact test. Threads live in silk.ts `SILKS` until
 * the page reloads (`applySilks` re-creates them in a rebuilt world).
 */

import {
  add, cross, dist, entryTheta, frameAt, len, lerp3, mul, nearestOnBranch, normalAt, norm, radiusAt, sub, surfacePoint, thetaOf, v3, wrapAngle,
  type Branch, type Nearest, type V3, type World,
} from "./world3";
import { SILKS, SILK_ENTRY, addSilk, newSilkId, removeSilk } from "./silk";

export interface Node {
  /** Distance behind the head along the trail. */
  d: number;
  /** Half width. */
  w: number;
}

export interface Leg {
  node: number;
  side: 1 | -1;
  /** Gait group: legs of different groups don't step together (unless badly lagging). */
  group: 0 | 1;
  lead: number;
}

export interface Animal {
  id: string;
  name: string;
  nodes: Node[];
  legs: Leg[];
  speed: number;
  turnRate: number;
  stride: number;
  splay: number;
  stepTime: number;
  /** Colours (css). */
  body: string;
  belly: string;
  scale: number;
  /** Leap along the surface normal + forward. null = cannot jump (crawlers: ant, spider, snake; fliers). */
  leap: { speed: number; up: number; gravity: number; steer: boolean } | null;
  /** Hold-to-reach (snake, ant): extend the head past the branch; falls without contact / grip. */
  reach?: { speed: number; max: number };
  /** Grip drains only when NO part of the body is on top (snake), not when just the head hangs. */
  bodyGrip?: boolean;
  /** Cling limit around the branch (rad from the top); cat: "mostly walks on top". */
  maxTh?: number;
  /** Per-node body colour overrides (css), e.g. the bee's stripes; missing entries use `body`. */
  colors?: string[];
  /** Leg proportions for the renderer: how far the knee sticks out / up (× node half-width) and limb thickness. Default 0.55 / 0.5 / 0.4. */
  legShape?: { out: number; up: number; thick: number };
  /** Sticks to anything (spider, jumping spider): hanging underneath never drains grip; may walk on silk threads. */
  clings?: boolean;
  /** Spins silk (key X): lets itself down on a thread and swings. maxLen = longest rope, reel = let down / reel up speed, pump = swing push (px/s^2). */
  silk?: { maxLen: number; reel: number; pump: number };
  /** Can fly: Space on a branch takes off (see FlightSpec). */
  flight?: FlightSpec;
  /** Visible wings (flap while flying, folded while perched). */
  wings?: WingSpec;
}

/**
 * Free flight. `hover` (bee, dragonfly): W/S fly forward/back, A/D yaw, Space up, Shift down; stops when you let go.
 * `wing` (bluejay): always moves forward; A/D bank-turn, W dives (speed up), S climbs (speed down), Space flaps
 * (thrust + lift); below `stall` the nose drops. Touching a branch lands when `autoLand` (or Shift is held),
 * otherwise you are pushed off it.
 */
export interface FlightSpec {
  kind: "hover" | "wing";
  /** Top speed (px/s). */
  speed: number;
  /** hover: how quickly velocity follows the input (1/s). wing: thrust of a flap (px/s²). */
  accel: number;
  /** Yaw rate (rad/s). */
  turnRate: number;
  /** hover: vertical speed (px/s). wing: pitch rate (rad/s). */
  climb: number;
  /** wing: speed it settles at when gliding level; below `stall` it can't hold its nose up. */
  cruise?: number;
  stall?: number;
  autoLand: boolean;
  /** Cosmetic hover wobble amplitude (px). */
  bob: number;
}

export interface WingSpec {
  pairs: 1 | 2;
  /** Body node the wings are attached to. */
  node: number;
  /** Tip-to-tip span per pair (px) and chord (px). */
  span: number;
  chord: number;
  color: string;
  alpha: number;
  flapHz: number;
}

const taper = (n: number, d0: number, step: number, w0: number, w1: number): Node[] =>
  Array.from({ length: n }, (_, i) => ({ d: d0 + i * step, w: w0 + (w1 - w0) * (i / Math.max(1, n - 1)) }));

export const LIZARD: Animal = {
  id: "lizard", name: "Lizard",
  // (slimmed 2026-10-23: half-widths x0.78 of the first version, and scaled 1.5 instead of 1.7 in ANIMALS: "quite fat and big")
  nodes: [{ d: 0, w: 7 }, { d: 11, w: 5.5 }, { d: 24, w: 7.8 }, { d: 38, w: 8.6 }, { d: 52, w: 7.8 }, { d: 66, w: 8.6 }, ...taper(9, 80, 11, 7, 1)],
  legs: [
    { node: 2, side: 1, group: 0, lead: 6 }, { node: 2, side: -1, group: 1, lead: 6 },
    { node: 5, side: 1, group: 1, lead: 4 }, { node: 5, side: -1, group: 0, lead: 4 },
  ],
  speed: 130, turnRate: 2.3, stride: 26, splay: 18, stepTime: 0.11, body: "#5f8f4a", belly: "#a8c070", scale: 1,
  leap: { speed: 520, up: 330, gravity: 1, steer: false },
};

export const CAT: Animal = {
  id: "cat", name: "Cat",
  nodes: [{ d: 0, w: 7 }, { d: 9, w: 6 }, { d: 20, w: 8 }, { d: 34, w: 9 }, { d: 48, w: 8.5 }, { d: 60, w: 8 }, ...taper(8, 70, 9, 4, 1.5)],
  legs: [
    { node: 2, side: 1, group: 0, lead: 5 }, { node: 2, side: -1, group: 1, lead: 5 },
    { node: 4, side: 1, group: 1, lead: 4 }, { node: 4, side: -1, group: 0, lead: 4 },
  ],
  speed: 170, turnRate: 2.6, stride: 24, splay: 13, stepTime: 0.1, body: "#c8803a", belly: "#f0d8a8", scale: 1,
  leap: { speed: 700, up: 420, gravity: 1, steer: false }, maxTh: 1.2,
};

export const SQUIRREL: Animal = {
  id: "squirrel", name: "Flying squirrel",
  nodes: [
    { d: 0, w: 6 }, { d: 8, w: 6 }, { d: 18, w: 8 }, { d: 30, w: 8 }, { d: 40, w: 7 },
    { d: 50, w: 9 }, { d: 60, w: 10 }, { d: 70, w: 9 }, { d: 80, w: 7 }, { d: 90, w: 4 },
  ],
  legs: [
    { node: 2, side: 1, group: 0, lead: 4 }, { node: 2, side: -1, group: 1, lead: 4 },
    { node: 3, side: 1, group: 1, lead: 3 }, { node: 3, side: -1, group: 0, lead: 3 },
  ],
  speed: 140, turnRate: 2.5, stride: 20, splay: 15, stepTime: 0.1, body: "#8a7a68", belly: "#d8cbb8", scale: 1,
  leap: { speed: 430, up: 260, gravity: 0.22, steer: true },
};

/** Long, straight, no jumping: Space extends the body out past the branch (a living bridge). */
export const SNAKE: Animal = {
  id: "snake", name: "Snake",
  nodes: taper(64, 0, 10, 7, 1.5),
  legs: [],
  speed: 110, turnRate: 1.8, stride: 20, splay: 0, stepTime: 0.2, body: "#8a6a3a", belly: "#d8c08a", scale: 1,
  leap: null, reach: { speed: 170, max: 430 }, bodyGrip: true,
};

/** Smaller than a spider and built for twigs: scaled() down in ANIMALS. */
export const ANT: Animal = {
  id: "ant", name: "Ant",
  nodes: [{ d: 0, w: 3.2 }, { d: 7, w: 2.2 }, { d: 14, w: 3.6 }, { d: 23, w: 4.4 }],
  legs: [
    { node: 1, side: 1, group: 0, lead: 3 }, { node: 1, side: -1, group: 1, lead: 3 },
    { node: 1, side: 1, group: 1, lead: -1 }, { node: 1, side: -1, group: 0, lead: -1 },
    { node: 2, side: 1, group: 0, lead: -3 }, { node: 2, side: -1, group: 1, lead: -3 },
  ],
  speed: 70, turnRate: 3, stride: 9, splay: 9, stepTime: 0.07, body: "#2a2018", belly: "#4a3a28", scale: 1,
  leap: null, reach: { speed: 130, max: 130 },
};

/**
 * The MITE: the smallest and slowest animal (scaled() to a few px in ANIMALS). Eight legs, clings to anything. It walks the tree like any
 * crawler, but its job is READING: with the mite selected and a leaf within reach, E (or choosing the mite next to a leaf) opens the
 * LEAF VIEW (ui/LeafView.tsx: the note's text on a magnified leaf); choosing any other animal climbs back out of it.
 */
export const MITE: Animal = {
  id: "mite", name: "Mite",
  nodes: [{ d: 0, w: 2.8 }, { d: 5, w: 4.2 }, { d: 11, w: 5.4 }, { d: 16, w: 4.2 }],
  legs: [
    { node: 1, side: 1, group: 0, lead: 4 }, { node: 1, side: -1, group: 1, lead: 4 },
    { node: 1, side: 1, group: 1, lead: 1 }, { node: 1, side: -1, group: 0, lead: 1 },
    { node: 2, side: 1, group: 0, lead: -2 }, { node: 2, side: -1, group: 1, lead: -2 },
    { node: 2, side: 1, group: 1, lead: -5 }, { node: 2, side: -1, group: 0, lead: -5 },
  ],
  speed: 34, turnRate: 3.5, stride: 6, splay: 9, stepTime: 0.08, body: "#b5472c", belly: "#e8c090", scale: 1,
  leap: null, clings: true,
};

/** Eight legs, high knees; clings to anything (no grip loss). */
export const SPIDER: Animal = {
  id: "spider", name: "Spider",
  nodes: [{ d: 0, w: 3.4 }, { d: 7, w: 4.6 }, { d: 17, w: 6.4 }, { d: 25, w: 6 }, { d: 31, w: 3 }],
  legs: [
    { node: 1, side: 1, group: 0, lead: 9 }, { node: 1, side: -1, group: 1, lead: 9 },
    { node: 1, side: 1, group: 1, lead: 4 }, { node: 1, side: -1, group: 0, lead: 4 },
    { node: 1, side: 1, group: 0, lead: -1 }, { node: 1, side: -1, group: 1, lead: -1 },
    { node: 1, side: 1, group: 1, lead: -6 }, { node: 1, side: -1, group: 0, lead: -6 },
  ],
  speed: 85, turnRate: 3, stride: 11, splay: 15, stepTime: 0.07, body: "#3a2a22", belly: "#7a4a30", scale: 1,
  leap: null, silk: { maxLen: 1e9, reel: 90, pump: 170 },
  legShape: { out: 1.5, up: 2.3, thick: 0.28 }, clings: true,
};

/**
 * Small, dark, orange-red abdomen: the one crawler that can jump (hold Space to aim, strong for its size: ~20 body lengths on
 * the flat), also spins silk and clings. ANIMALS scales it to ~0.7 x the spider.
 */
export const JUMPER: Animal = {
  id: "jumper", name: "Jumping spider",
  nodes: [{ d: 0, w: 3.2 }, { d: 7, w: 4.4 }, { d: 15, w: 6 }, { d: 23, w: 6.6 }, { d: 30, w: 3.4 }],
  legs: [
    { node: 1, side: 1, group: 0, lead: 8 }, { node: 1, side: -1, group: 1, lead: 8 },
    { node: 1, side: 1, group: 1, lead: 3 }, { node: 1, side: -1, group: 0, lead: 3 },
    { node: 1, side: 1, group: 0, lead: -2 }, { node: 1, side: -1, group: 1, lead: -2 },
    { node: 1, side: 1, group: 1, lead: -7 }, { node: 1, side: -1, group: 0, lead: -7 },
  ],
  speed: 95, turnRate: 3.2, stride: 10, splay: 14, stepTime: 0.06, body: "#2b2330", belly: "#c4552a", scale: 1,
  colors: ["#2b2330", "#2b2330", "#2b2330", "#c4552a", "#c4552a"],
  leap: { speed: 560, up: 400, gravity: 1, steer: false }, silk: { maxLen: 1e9, reel: 90, pump: 170 },
  legShape: { out: 1.4, up: 2, thick: 0.3 }, clings: true,
};

/** Small, fast to hover; walks slowly on the bark. */
export const BEE: Animal = {
  id: "bee", name: "Bee",
  nodes: [{ d: 0, w: 2.4 }, { d: 6, w: 3.6 }, { d: 13, w: 3.8 }, { d: 18, w: 3.6 }, { d: 23, w: 2.4 }],
  legs: [
    { node: 1, side: 1, group: 0, lead: 3 }, { node: 1, side: -1, group: 1, lead: 3 },
    { node: 1, side: 1, group: 1, lead: -1 }, { node: 1, side: -1, group: 0, lead: -1 },
    { node: 2, side: 1, group: 0, lead: -3 }, { node: 2, side: -1, group: 1, lead: -3 },
  ],
  speed: 45, turnRate: 3, stride: 6, splay: 6, stepTime: 0.06, body: "#2a2018", belly: "#e0b030", scale: 1,
  colors: ["#2a2018", "#e0b030", "#e0b030", "#2a2018", "#e0b030"],
  leap: null,
  flight: { kind: "hover", speed: 210, accel: 4, turnRate: 3.2, climb: 140, autoLand: true, bob: 3 },
  wings: { pairs: 2, node: 1, span: 17, chord: 7, color: "#dfeaff", alpha: 0.55, flapHz: 28 },
};

/** A bit bigger than the bee, long and thin; quick darting hover. */
export const DRAGONFLY: Animal = {
  id: "dragonfly", name: "Dragonfly",
  nodes: [
    { d: 0, w: 3.4 }, { d: 7, w: 4.2 }, { d: 15, w: 2.6 }, { d: 23, w: 2.3 }, { d: 31, w: 2.1 },
    { d: 39, w: 2 }, { d: 47, w: 1.8 }, { d: 55, w: 1.4 },
  ],
  legs: [
    { node: 1, side: 1, group: 0, lead: 3 }, { node: 1, side: -1, group: 1, lead: 3 },
    { node: 1, side: 1, group: 1, lead: -1 }, { node: 1, side: -1, group: 0, lead: -1 },
    { node: 1, side: 1, group: 0, lead: -4 }, { node: 1, side: -1, group: 1, lead: -4 },
  ],
  speed: 50, turnRate: 3, stride: 7, splay: 7, stepTime: 0.06, body: "#2f8f7a", belly: "#9fe0c8", scale: 1,
  colors: ["#2f8f7a", "#2f8f7a", "#2f6fb0", "#2f8f7a", "#2f6fb0", "#2f8f7a", "#2f6fb0", "#2f6fb0"],
  leap: null,
  flight: { kind: "hover", speed: 330, accel: 6, turnRate: 4, climb: 190, autoLand: true, bob: 1.5 },
  wings: { pairs: 2, node: 1, span: 36, chord: 9, color: "#cfe8ff", alpha: 0.42, flapHz: 38 },
};

/** Bigger, faster, real flight: never hovers, trades height for speed. */
export const BLUEJAY: Animal = {
  id: "bluejay", name: "Blue jay",
  nodes: [
    { d: 0, w: 5 }, { d: 9, w: 6 }, { d: 19, w: 8.5 }, { d: 29, w: 8 }, { d: 38, w: 6 },
    { d: 48, w: 4 }, { d: 58, w: 3.6 }, { d: 68, w: 3.2 }, { d: 78, w: 2.8 },
  ],
  legs: [{ node: 3, side: 1, group: 0, lead: 3 }, { node: 3, side: -1, group: 1, lead: 3 }],
  speed: 140, turnRate: 2.6, stride: 14, splay: 5, stepTime: 0.1, body: "#3b6fd0", belly: "#eef0f4", scale: 1,
  colors: ["#3b6fd0", "#1c2a4a", "#3b6fd0", "#3b6fd0", "#3b6fd0", "#2a58b0", "#2a58b0", "#eef0f4", "#2a58b0"],
  leap: null,
  flight: { kind: "wing", speed: 640, accel: 260, turnRate: 1.7, climb: 1.1, cruise: 420, stall: 190, autoLand: false, bob: 0 },
  wings: { pairs: 1, node: 2, span: 56, chord: 26, color: "#2f5fb8", alpha: 1, flapHz: 5 },
};

/** Uniformly resize a creature spec (body, legs, gait and speed). */
export function scaled(a: Animal, k: number): Animal {
  return {
    ...a,
    nodes: a.nodes.map((n) => ({ d: n.d * k, w: n.w * k })),
    legs: a.legs.map((l) => ({ ...l, lead: l.lead * k })),
    speed: a.speed * k, stride: a.stride * k, splay: a.splay * k, scale: a.scale * k,
    leap: a.leap && { ...a.leap, speed: a.leap.speed * k, up: a.leap.up * k },
    reach: a.reach && { speed: a.reach.speed * k, max: a.reach.max * k },
    silk: a.silk && { maxLen: a.silk.maxLen * k, reel: a.silk.reel * k, pump: a.silk.pump * k },
    flight: a.flight && { ...a.flight, speed: a.flight.speed * k, accel: a.flight.kind === "wing" ? a.flight.accel * k : a.flight.accel, climb: a.flight.kind === "hover" ? a.flight.climb * k : a.flight.climb, cruise: a.flight.cruise && a.flight.cruise * k, stall: a.flight.stall && a.flight.stall * k, bob: a.flight.bob * k },
    wings: a.wings && { ...a.wings, span: a.wings.span * k, chord: a.wings.chord * k },
  };
}

export const ANIMALS: Animal[] = [
  scaled(LIZARD, 1.5), scaled(SNAKE, 1.5), scaled(ANT, 0.55), scaled(CAT, 1.9), scaled(SQUIRREL, 1.7),
  scaled(SPIDER, 1.6), scaled(BEE, 1.1), scaled(DRAGONFLY, 1.1), scaled(BLUEJAY, 1.6), scaled(JUMPER, 1.12), scaled(MITE, 0.55),
];

/** The number keys: 1/2/3 pick a category, pressing the same key again cycles through its animals. */
export const ANIMAL_CATEGORIES: ReadonlyArray<{ label: string; ids: readonly string[] }> = [
  { label: "Crawlers", ids: ["ant", "spider", "jumper", "snake", "mite"] },
  { label: "Walkers", ids: ["lizard", "cat"] },
  { label: "Fliers", ids: ["squirrel", "bee", "dragonfly", "bluejay"] },
];

/** Index in ANIMALS of the animal the number key `n` (1-based) selects, given the current one: next in the category, else its first. */
export function animalForKey(n: number, currentId: string): number {
  const cat = ANIMAL_CATEGORIES[n - 1];
  if (!cat) return -1;
  const at = cat.ids.indexOf(currentId);
  const id = cat.ids[(at + 1) % cat.ids.length];
  return ANIMALS.findIndex((a) => a.id === id);
}

export interface SurfacePos {
  b: string;
  s: number;
  th: number;
}

interface TrailSample {
  D: number;
  p: V3;
  surf: SurfacePos | null;
}

export interface Foot {
  at: SurfacePos;
  from: SurfacePos;
  to: SurfacePos;
  /** 0..1 while stepping, −1 when planted. */
  t: number;
}

export interface Air {
  p: V3;
  v: V3;
  t: number;
  from: SurfacePos;
  /** Seconds during which the origin branch can't catch us. */
  ignore: number;
  slip: boolean;
  /** A thread (branch id) that can't catch us for the first ~1.2 s: the one a spider just let go of. */
  skip?: string;
}

/** A spider hanging on its own silk (key X): a pendulum on a rope of length `len` from `anchor`. */
export interface Dangle {
  /** Where the rope hangs from (world point on the surface) and the same spot in surface coordinates (the thread's anchor). */
  anchor: V3;
  ref: SurfacePos;
  /** Rope length (px). */
  len: number;
  /** The spider's head and velocity. */
  p: V3;
  v: V3;
  /** Facing around the y axis (atan2(z, x)); A/D turn it, Space pumps the swing along it. */
  yaw: number;
  /** Seconds since the drop. */
  t: number;
  /** The perch it dropped from (the origin branch can't catch it until it has swung clear, and never within 0.4 s). */
  from: SurfacePos;
  /** The spider has been clear of the origin branch (it may land on it again). */
  clear: boolean;
}

export interface Reach {
  p: V3;
  dir: V3;
  len: number;
  from: SurfacePos;
  /** Surface normal at the origin (pitch is measured against it). */
  up: V3;
}

/** A leap being aimed (Space held). */
export interface Aim {
  /** Radians relative to the current heading, + = right (clamped +-70 degrees). */
  yaw: number;
  /** Extra elevation relative to the animal's default leap angle (rad, -0.35 .. 0.6). */
  pitch: number;
  /** 0..1 launch power (0.55 -> 1 over 0.8 s; 1 during the first 0.18 s so a tap is the full leap). */
  charge: number;
  /** Seconds held. */
  t: number;
}

/** The arc a release would fly now (for the renderer). `hit` = where it lands on a branch (null: lands on nothing). */
export interface Preview {
  points: V3[];
  hit: { b: string; s: number; th: number; p: V3 } | null;
  /** The aim assist bent the arc away from the manual aim. */
  assisted: boolean;
}

/** Free flight (fliers only, see FlightSpec). */
export interface Flight {
  p: V3;
  v: V3;
  /** Heading around the y axis (radians, atan2(z, x) like the level camera) and pitch (up positive). */
  yaw: number;
  pitch: number;
  /** Current speed along the heading (px/s); for hover fliers just |v|. */
  speed: number;
  /** Roll into the turn, −1..1 (renderer only). */
  bank: number;
  /** Wing phase / flapping effort 0..1 (renderer drives the flap from time; this says how hard). */
  flap: number;
  /** Seconds since take-off. */
  t: number;
  /** The perch it took off from (the origin branch can't land it, it only deflects, until the flier has cleared it). */
  from: SurfacePos;
  /** Has been clear of the origin branch (radius + margin + 8 px): from then on the origin lands it like any branch. */
  cleared: boolean;
  /** Landing mode (wing flier, Shift held): the spot it is steering for (null otherwise). */
  landTarget: { b: string; p: V3 } | null;
}

export type MoveMode = "free" | "guided";
export const MOVE_MODES: readonly MoveMode[] = ["guided", "free"];
/** What the app starts with (`TreeScene`); the pure `spawn` keeps `free` unless told otherwise. */
export const DEFAULT_MOVE_MODE: MoveMode = "guided";

export interface Creature {
  animal: Animal;
  /** Set while flying; the trail then has surf: null samples and `head` keeps the last perch. */
  flight: Flight | null;
  /** Gently straightens the heading when you are not steering (default on); toggled with H. Free mode only. */
  autoAlign: boolean;
  /** `free` = heading steered by A/D, W walks (the original); `guided` = W up / S down the branch, A/D turn, smooth curves. */
  moveMode: MoveMode;
  /** Guided mode: angular velocity of the heading (rad/s; eased, so turns start and end smoothly). */
  omega: number;
  /** Guided mode: which way a U-turn is swinging (-1 left, +1 right, 0 none): kept until the turn is nearly done, so it never flips half-way. */
  swing: number;
  /** Seconds left in which a thread's end can't be re-entered (set when you walk off a silk bridge). */
  threadCool?: number;
  /**
   * Auto-climb: the side branch whose base zone we just walked DOWN out of (returned to its parent). Until the animal steps out of that
   * zone it is not entered again, so coming back down a branch and then walking on up the parent does not pull you into it a second time.
   */
  noAuto?: string;
  head: SurfacePos;
  phi: number;
  speedNow: number;
  D: number;
  trail: TrailSample[];
  feet: Foot[];
  air: Air | null;
  reach: Reach | null;
  /** Set while hanging on a silk rope (spiders only, key X); `head` keeps the perch it dropped from. */
  silk: Dangle | null;
  /** Set while Space is held to aim a leap (see Aim); null otherwise. */
  aim: Aim | null;
  grip: number;
  gripOn: boolean;
  /** 0..1: how close to falling (renderer shakes the model). */
  shake: number;
  /** Climb key currently held (read by the junction logic). */
  climbHeld: boolean;
  time: number;
}

export interface Input {
  forward: boolean;
  left: boolean;
  right: boolean;
  /** Edge-triggered: leap this frame. */
  leap: boolean;
  /** Held: reach out (snake). */
  reach: boolean;
  /** Held (S / arrow-down): reach steers down; gliders flare. */
  back: boolean;
  /** Held: turn onto a side branch whose base you are standing in (Shift). */
  climb: boolean;
  /** Edge-triggered (key X): a spider on a surface drops on a silk rope. */
  silk: boolean;
  /** Held (key X): a hanging spider lets the rope out (goes down). */
  drop: boolean;
  /**
   * The direction the player is LOOKING (the mouse camera's forward vector, unit): reach, jump aim, flight and the swing follow it, so the
   * free camera steers them. Absent in every other camera mode (the keys A/D/W/S steer as before).
   */
  aimDir?: V3;
}

export const NO_INPUT: Input = { forward: false, left: false, right: false, leap: false, reach: false, back: false, climb: false, silk: false, drop: false };

function maxD(a: Animal): number {
  return Math.max(...a.nodes.map((n) => n.d));
}

export function spawn(world: World, animal: Animal, branchId: string, s: number, moveMode: MoveMode = "free", th = 0): Creature {
  const head: SurfacePos = { b: branchId, s, th };
  const c: Creature = { animal, flight: null, autoAlign: true, moveMode, omega: 0, swing: 0, head, phi: 0, speedNow: 0, D: 0, trail: [], feet: [], air: null, reach: null, silk: null, aim: null, grip: 1, gripOn: true, shake: 0, climbHeld: false, time: 0 };
  c.feet = animal.legs.map(() => ({ at: { ...head }, from: { ...head }, to: { ...head }, t: -1 }));
  prefillTrail(world, c);
  settleFeet(world, c);
  return c;
}

/** Lay the trail out straight behind the head along its branch (th = head.th) so the body starts stretched out. */
function prefillTrail(world: World, c: Creature): void {
  const b = world.branches.get(c.head.b)!;
  const { s, th } = c.head;
  c.trail = [];
  for (let d = maxD(c.animal) + 40; d >= 0; d -= 4) {
    const sb = Math.max(0, s - d);
    c.trail.push({ D: c.D - d, p: surfacePoint(b, sb, th).p, surf: { b: c.head.b, s: sb, th } });
  }
  c.trail.push({ D: c.D, p: surfacePoint(b, s, th).p, surf: { ...c.head } });
}

/** Unrolled surface distance between two points on the SAME branch (Infinity otherwise). */
export function surfaceDist(world: World, a: SurfacePos, b: SurfacePos): number {
  if (a.b !== b.b) return Infinity;
  const br = world.branches.get(a.b)!;
  return Math.hypot(a.s - b.s, radiusAt(br, (a.s + b.s) / 2) * wrapAngle(a.th - b.th));
}

/** Body point `back` px behind the head along the trail: surface coords (if on a branch) + world position. */
export function bodyPoint(c: Creature, back: number): { surf: SurfacePos | null; p: V3 } {
  const target = c.D - back;
  const tr = c.trail;
  let i = tr.length - 1;
  while (i > 0 && tr[i - 1].D >= target) i--;
  const hi = tr[Math.min(tr.length - 1, i)];
  const lo = tr[Math.max(0, i - 1)];
  const span = hi.D - lo.D;
  const t = span > 1e-6 ? Math.min(1, Math.max(0, (target - lo.D) / span)) : 1;
  const p = lerp3(lo.p, hi.p, t);
  if (lo.surf && hi.surf && lo.surf.b === hi.surf.b) {
    return { surf: { b: lo.surf.b, s: lo.surf.s + (hi.surf.s - lo.surf.s) * t, th: wrapAngle(lo.surf.th + wrapAngle(hi.surf.th - lo.surf.th) * t) }, p };
  }
  return { surf: t < 0.5 ? lo.surf : hi.surf, p };
}

/** Unit vector of the head's direction of travel (in world space). */
export function headingVector(world: World, c: Creature): V3 {
  const b = world.branches.get(c.head.b)!;
  const f = frameAt(b, c.head.s);
  const around = add(mul(f.u, -Math.sin(c.head.th)), mul(f.b, Math.cos(c.head.th))); // d(normal)/dθ
  return norm(add(mul(f.t, Math.cos(c.phi)), mul(around, Math.sin(c.phi))));
}

/** Surface normal at the head. */
export function headNormal(world: World, c: Creature): V3 {
  const b = world.branches.get(c.head.b)!;
  return normalAt(frameAt(b, c.head.s), c.head.th);
}

/**
 * Where leg i would stand with the body on the trail. `fallback` (just landed / dropped back: the trail behind the head is the
 * flight path, not the surface) = place the hips straight behind that spot along the heading instead.
 */
function restSpot(world: World, c: Creature, i: number, fallback?: SurfacePos): SurfacePos | null {
  const leg = c.animal.legs[i];
  const dn = c.animal.nodes[leg.node].d;
  let hip = fallback ? null : bodyPoint(c, dn).surf;
  if (fallback) {
    const fb = world.branches.get(fallback.b)!;
    hip = { b: fallback.b, s: clamp(fallback.s - dn * Math.cos(c.phi), 0, fb.total), th: wrapAngle(fallback.th - (dn * Math.sin(c.phi)) / radiusAt(fb, fallback.s)) };
  }
  if (!hip) return null;
  const b = world.branches.get(hip.b)!;
  return {
    b: hip.b,
    s: hip.s + leg.lead * Math.cos(c.phi),
    th: wrapAngle(hip.th + (leg.side * c.animal.splay) / radiusAt(b, hip.s) + (leg.lead * Math.sin(c.phi)) / radiusAt(b, hip.s)),
  };
}

function settleFeet(world: World, c: Creature, fallback?: SurfacePos): void {
  c.animal.legs.forEach((_, i) => {
    const r = restSpot(world, c, i, fallback);
    if (r) c.feet[i] = { at: r, from: r, to: r, t: -1 };
  });
}

function updateFeet(world: World, c: Creature, dt: number): void {
  const a = c.animal;
  const stepping = (g: number): boolean => a.legs.some((l, i) => l.group === g && c.feet[i].t >= 0);
  const st = a.stepTime * Math.min(1, a.speed / Math.max(a.speed * 0.5, c.speedNow));
  a.legs.forEach((leg, i) => {
    const f = c.feet[i];
    const rest = restSpot(world, c, i);
    if (!rest) return;
    if (f.t >= 0) {
      f.t += dt / st;
      if (f.t >= 1) {
        f.at = { ...f.to };
        f.t = -1;
      } else {
        const k = f.t * f.t * (3 - 2 * f.t);
        f.at = f.from.b === f.to.b
          ? { b: f.to.b, s: f.from.s + (f.to.s - f.from.s) * k, th: wrapAngle(f.from.th + wrapAngle(f.to.th - f.from.th) * k) }
          : { ...f.to };
      }
      return;
    }
    const drift = surfaceDist(world, f.at, rest);
    const other: 0 | 1 = leg.group === 0 ? 1 : 0;
    const overdue = drift > a.stride * 1.7;
    if (drift > a.stride && c.speedNow > 1 && (overdue || !stepping(other))) {
      const b = world.branches.get(rest.b)!;
      const lead = a.stride * 0.8;
      f.from = { ...f.at };
      f.to = { b: rest.b, s: rest.s + lead * Math.cos(c.phi), th: wrapAngle(rest.th + (lead * Math.sin(c.phi)) / radiusAt(b, rest.s)) };
      f.t = 0;
    } else if (!Number.isFinite(drift)) {
      c.feet[i] = { at: rest, from: rest, to: rest, t: -1 };
    }
  });
}

/** Foot lift (px) for rendering: 0 when planted, arc while stepping. */
export function footLift(c: Creature, i: number): number {
  const f = c.feet[i];
  return f.t < 0 ? 0 : Math.sin(f.t * Math.PI) * c.animal.stride * 0.55;
}

const GRAVITY = 900;

/** The unit-vector `y` component of the surface normal at a surface position (world gravity decides what hangs). */
function normalY(world: World, sf: SurfacePos): number {
  return normalAt(frameAt(world.branches.get(sf.b)!, sf.s), sf.th).y;
}

/** Below this normal.y a surface counts as hanging (a vertical trunk has n.y ≈ 0 all round and never does). */
const HANG_FREE = 0.12;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** 2 × the widest node half-width. */
const animalWidth = (a: Animal): number => 2 * Math.max(...a.nodes.map((n) => n.w));

/** Tuning of the guided move mode (exported for the tests / docs). Angles are in the unrolled surface: 0 = tip-ward, pi = base-ward, + = right. */
export const GUIDED = {
  /** Heading turn rate = `animal.turnRate x gain x scale` rad/s; `scale = clamp(1 / fit, floor, 1)` (the free mode's width / radius rule, with a milder floor). */
  gain: 4.2,
  floor: 0.55,
  /** Heading error -> angular velocity (1/s); the angular velocity itself follows with `ease` (1/s): turns start and end smoothly. */
  k: 7,
  ease: 18,
  /** Largest bend (rad) held while W/S and A/D are pressed together (on a thin branch the circumferential rate stays <= `thin`). */
  bend: 0.75,
  /** Heading offset (rad) from the branch axis while only A/D are held: the animal creeps around the branch. */
  across: 1.35,
  /** Speed factor for A/D alone (x up to 2 on a thick trunk, radius >= 120: going round a fat trunk would take ages at walking pace). */
  creep: 0.95,
  /** Cap (rad/s) on how fast the animal may go round a branch (x 0.4..1: slower on a branch narrower than half its width). */
  thin: 1.6,
  /** Speed factor while the heading is a quarter turn (or more) from the wanted one: it swivels more than it walks. */
  turnSpeed: 0.35,
  /** Fraction of the turn rate used to straighten up while no key is held. */
  idle: 0.6,
} as const;

/**
 * Guided steering (moveMode "guided"): the keys are read against the BRANCH, not the camera. W asks for heading 0 (tip-ward), S for pi
 * (base-ward), A/D add a bend to the left / right as the animal sees it (W+D bends right going up, S+D right going down), A/D alone
 * ask for a sideways heading (`across`) at creep speed (the animal goes round the bark), no key = straighten up along the nearest axis.
 * The heading eases there: `omega` follows `k x error` (capped at the turn rate) through a first-order lag, so turns are curves that
 * start and end smoothly. A U-turn swings the way of the pressed A/D, else over the TOP side of the bark (the way whose surface
 * normal rises), else the way it already leans; the choice is kept (`swing`) until the turn is nearly done. While the heading is
 * far from the wanted one the animal slows (it arcs round instead of walking on). Returns the speed (px/s) the animal wants and an immediate cap.
 */
function steerGuided(world: World, c: Creature, input: Input, dt: number, fit: number, r: number): { target: number; cap: number } {
  const a = c.animal;
  if (!Number.isFinite(c.phi)) c.phi = 0;
  if (!Number.isFinite(c.omega)) c.omega = 0;
  const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const lat = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const around = GUIDED.thin * clamp(r / (0.5 * animalWidth(a)), 0.4, 1); // rad/s the animal may go round THIS branch (a twig narrower than the animal: slowly)
  const axis = fwd > 0 ? 0 : fwd < 0 ? Math.PI : Math.abs(c.phi) > Math.PI / 2 ? Math.PI : 0;
  const axisErr = Math.abs(wrapAngle(axis - c.phi));
  let offset = 0;
  if (lat !== 0) {
    // a bend only once the animal faces (roughly) along its way: a U-turn first, then the curve
    const bend = clamp(Math.asin(Math.min(1, (around * r) / Math.max(1, a.speed))), 0.15, GUIDED.bend) * clamp(1 - axisErr / (Math.PI / 2), 0, 1);
    offset = lat * (fwd !== 0 ? bend : GUIDED.across);
  }
  let err = wrapAngle(axis + offset - c.phi);
  if (Math.abs(err) > Math.PI - 0.6) {
    if (c.swing === 0) {
      let pref = lat;
      if (!pref) {
        const b = world.branches.get(c.head.b)!;
        const f = frameAt(b, c.head.s);
        const upAround = -f.u.y * Math.sin(c.head.th) + f.b.y * Math.cos(c.head.th); // how fast the normal rises with th
        // the heading sweeps through the side `sweep` x `around` (a turn that starts facing tip-ward passes through + when swinging right, one that starts facing base-ward the other way round)
        const sweep = Math.abs(upAround) > 0.15 ? Math.sign(upAround) : Math.sin(c.phi) < 0 ? -1 : 1;
        pref = Math.cos(c.phi) >= 0 ? sweep : -sweep;
      }
      c.swing = pref;
    }
  } else if (Math.abs(err) < 1.6) c.swing = 0;
  if (c.swing * err < 0 && Math.abs(err) > 1.6) err += c.swing * Math.PI * 2; // keep swinging the same way round
  const rate = a.turnRate * GUIDED.gain * clamp(1 / fit, GUIDED.floor, 1) * (fwd === 0 && lat === 0 ? GUIDED.idle : 1);
  const want = clamp(err * GUIDED.k, -rate, rate);
  c.omega += (want - c.omega) * Math.min(1, dt * GUIDED.ease);
  c.phi = wrapAngle(c.phi + c.omega * dt);
  if (lat === 0 && Math.abs(err) < 0.03 && Math.abs(c.omega) < 0.35) {
    c.phi = axis; // arrived: sit exactly on the axis (a lingering 0.01 rad would slowly corkscrew a long walk)
    c.omega = 0;
  }
  if (fwd === 0 && lat === 0) return { target: 0, cap: Infinity };
  const v = (fwd !== 0 ? a.speed : Math.min(a.speed * GUIDED.creep * clamp(r / 60, 1, 2), around * r)) * (GUIDED.turnSpeed + (1 - GUIDED.turnSpeed) * Math.max(0, Math.cos(err)) ** 3);
  // `cap`: slowing down is immediate (the animal swivels, it does not slide on; `step` applies it after the speed eased), and never
  // faster round the bark than `thin` rad/s
  const sn = Math.abs(Math.sin(c.phi));
  return { target: v, cap: Math.min(v, sn > 1e-3 ? (around * r) / sn : Infinity) };
}

/** Advance the creature by dt seconds. */
export function step(world: World, c: Creature, input: Input, dt: number): void {
  c.time += dt;
  if (c.threadCool) c.threadCool = Math.max(0, c.threadCool - dt);
  c.climbHeld = input.climb;
  const a = c.animal;
  if (c.aim && (c.flight || c.air || c.reach || c.silk || !a.leap)) c.aim = null; // aiming only happens standing on a surface
  // a perched flier whose grip ran out is falling: Space spreads its wings and takes off from there
  if (c.air && c.air.slip && input.leap && a.flight && !c.flight) startFlightFromFall(world, c);

  if (c.flight) {
    stepFlight(world, c, input, dt);
    c.grip = 1;
    updateShake(c);
    return;
  }

  if (c.air) {
    stepAir(world, c, dt, input);
    updateShake(c);
    return;
  }

  // --- spiders: hanging on a silk rope (X lets go) ---------------------------------------
  if (c.silk) {
    stepDangle(world, c, input, dt);
    updateShake(c);
    return;
  }

  // --- snake / ant: hold Space to reach out beyond the branch ---------------------------
  if (a.reach && (input.reach || c.reach)) {
    stepReach(world, c, input, dt);
    updateShake(c);
    if (c.air) return;
    if (c.reach) return;
  }

  // --- fliers: Space on a branch takes off ---------------------------------------------
  if (input.leap && a.flight) {
    startFlight(world, c);
    c.grip = 1;
    updateShake(c);
    return;
  }

  // --- spiders: X on a surface = drop on a silk rope ----------------------------------------
  if (input.silk && a.silk && !c.aim) {
    startDangle(world, c);
    c.grip = 1;
    updateShake(c);
    return;
  }

  // --- leap aiming: Space press = start, held = A/D/W/S aim + charge, release = launch, Shift = cancel -----------
  let aiming = false;
  if (a.leap) {
    let fresh = false;
    if (!c.aim && input.leap && !input.climb) {
      c.aim = { yaw: 0, pitch: 0, charge: aimCharge(0), t: 0 };
      fresh = true;
    }
    if (c.aim) {
      if (input.climb) c.aim = null;
      else if (!input.reach) { // released (or a press that was never held = a tap): leap
        launchAimed(world, c);
        updateShake(c);
        return;
      } else {
        aiming = true;
        if (!fresh) {
          updateAim(c.aim, input, dt);
          if (input.aimDir) lookAim(world, c, input, dt);
        }
      }
    }
  }

  // --- steering: A/D turn the heading; a wide animal on a thin branch turns gently (not while aiming: you stand still) --------
  const b0 = world.branches.get(c.head.b)!;
  const rHere = radiusAt(b0, c.head.s);
  const fit = (animalWidth(a) * 2.2) / rHere; // > 1: the animal is wide for this branch
  let target: number;
  let cap = Infinity;
  if (c.moveMode === "guided" && !aiming) ({ target, cap } = steerGuided(world, c, input, dt, fit, rHere));
  else {
    const turn = aiming ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    c.phi = wrapAngle(c.phi + turn * a.turnRate * clamp(1 / fit, 0.3, 1) * dt);
    if (c.autoAlign && !aiming && !input.left && !input.right && c.speedNow > 1) {
      // ease straight along the branch (forwards, or backwards when you are walking that way), never past it
      const goal = Math.abs(c.phi) > Math.PI / 2 ? Math.PI : 0;
      const k = 2.4 * clamp(fit, 0.5, 2) * dt;
      c.phi = wrapAngle(c.phi + clamp(wrapAngle(goal - c.phi), -k, k));
    }
    target = input.forward && !aiming ? a.speed : 0;
  }
  c.speedNow = Math.min(cap, c.speedNow + (target - c.speedNow) * Math.min(1, dt * 8));
  const dist = c.speedNow * dt;
  if (dist > 0) moveHead(world, c, dist * Math.cos(c.phi), dist * Math.sin(c.phi), Math.abs(dist));

  // --- grip: by world gravity (the normal's y), not by the branch's own frame ------------
  if (c.gripOn && !a.clings) {
    const ny = a.bodyGrip ? bestNormalY(world, c) : headNormal(world, c).y;
    const k = Math.max(0, -ny - HANG_FREE) / (1 - HANG_FREE); // 0 = not hanging .. 1 = fully underneath
    if (k > 0) c.grip = Math.max(0, c.grip - 0.58 * k * k * dt);
    else c.grip = Math.min(1, c.grip + 0.9 * dt);
    if (c.grip <= 0) {
      startSlip(world, c);
      updateShake(c);
      return;
    }
  } else c.grip = 1;
  updateShake(c);

  updateFeet(world, c, dt);
}

/**
 * Highest surface normal y over body samples (every 4th node) that are on a branch; -1 when all are in the air.
 * A reaching animal WITHOUT `bodyGrip` (the ant: its whole 12 px body leaves the branch during a reach, and a head-only
 * sample would always read "in the air") holds on by its rear: the spot it stretched out from counts as the body part
 * that is on the branch (so an ant reaching from a top surface never tires, from an underside it slips in ~3 s).
 */
function bestNormalY(world: World, c: Creature): number {
  if (c.reach && !c.animal.bodyGrip) return normalY(world, c.reach.from);
  let best = -1;
  c.animal.nodes.forEach((n, i) => {
    if (i % 4) return;
    const sf = bodyPoint(c, n.d).surf;
    if (sf) best = Math.max(best, normalY(world, sf));
  });
  return best;
}

/** True when some sampled part of the body is on top of a branch (not hanging, not in the air). */
export function bodyOnTop(world: World, c: Creature): boolean {
  return bestNormalY(world, c) > -HANG_FREE;
}

/** Animals that can use silk threads: the clingers (spider, jumping spider) and anything whose widest half-width is <= 6 px (ant, bee, dragonfly). */
export function canUseThreads(a: Animal): boolean {
  return !!a.clings || Math.max(...a.nodes.map((n) => n.w)) <= 6;
}

// ---- the star junction at the stump's foot -----------------------------------------------------------------------------------
/** How far round the bark (radians) a ground root still counts as "the root on the side you face". */
export const STAR_ARC = 0.85;
/** The heading (radians from the branch axis, pi = straight down) beyond which a walker counts as facing down: a U-turn that is still swinging round does not take a root yet. */
export const STAR_FACING = 1.9;
const rootAngle = new WeakMap<Branch, number>();

/** The ground roots of a stump (side branches flagged `root`); empty for any other branch. */
function rootsOf(world: World, b: Branch): Branch[] {
  if (b.silk || b.root) return [];
  const out: Branch[] = [];
  for (const id of b.side) {
    const ch = world.branches.get(id);
    if (ch && ch.root && !ch.silk && ch.parent === b.id) out.push(ch);
  }
  return out;
}

/** Height on the stump below which a root's zone applies. */
const starFoot = (ch: Branch): number => (ch.attachS ?? 0) + radiusAt(ch, 0) * 0.8 + 24;

/** The top of every root zone of the stump `b` (0 when it has no roots). */
export function starTop(world: World, b: Branch): number {
  let top = 0;
  for (const ch of rootsOf(world, b)) top = Math.max(top, starFoot(ch));
  return top;
}

/**
 * The ground root a walker at (b, s, th) would take walking DOWN: the root whose angle round the stump is nearest (within STAR_ARC) when
 * the walker is below that root's top. `skip` = the root it just came up out of: when that one is the nearest, nothing is taken. Null on any other branch.
 */
export function starRoot(world: World, b: Branch, s: number, th: number, skip?: string): Branch | null {
  let best: Branch | null = null;
  let bd = STAR_ARC;
  const roots = rootsOf(world, b);
  if (roots.length === 0 || s > starTop(world, b)) return null; // (one common height, so the NEAREST root is chosen, not the first one whose own top is reached)
  for (const ch of roots) {
    let a = rootAngle.get(ch);
    if (a === undefined) {
      a = entryTheta(b, ch, ch.attachS ?? 0);
      rootAngle.set(ch, a);
    }
    const d = Math.abs(wrapAngle(th - a));
    if (d < bd) {
      bd = d;
      best = ch;
    }
  }
  return best && best.id === skip ? null : best; // (the nearest root is the one it just came up: no other root is "on the side it faces")
}

/** The side branch (or silk thread) Shift would climb into right now (standing in its base / at the thread's end), else null. */
export function climbTarget(world: World, c: Creature): Branch | null {
  if (c.air || c.reach || c.flight || c.silk) return null;
  const b = world.branches.get(c.head.b)!;
  return sideEntry(world, b, c.head.s, c.head.th, canUseThreads(c.animal) && !(c.threadCool && c.threadCool > 0))?.ch ?? starRoot(world, b, c.head.s, c.head.th, c.noAuto);
}

/**
 * The side branch whose base the spot (b, s, th) stands in. A silk thread counts at EITHER end (its start hangs from `b`, or its
 * far end is attached to `b`: `end` says which; 0 = start, 1 = end) when the spot is within SILK_ENTRY px of that end, and only
 * for animals that can use threads.
 */
function sideEntry(world: World, b: Branch, s: number, th: number, threads: boolean, skip?: string): { ch: Branch; end: 0 | 1 | null } | null {
  const here = surfacePoint(b, s, th).p;
  let other: { ch: Branch; end: 0 | 1 | null } | null = null;
  for (const id of b.side) {
    const ch = world.branches.get(id);
    if (!ch || id === skip) continue;
    if (ch.root && ch.parent === b.id && !b.root && !b.silk) continue; // a stump's roots are the star junction's business (starRoot)
    if (ch.silk) {
      if (!threads) continue;
      const d0 = ch.parent === b.id ? dist(here, ch.pts[0]) : Infinity;
      const d1 = ch.endLink?.b === b.id ? dist(here, ch.pts[ch.pts.length - 1]) : Infinity;
      if (!other && Math.min(d0, d1) < SILK_ENTRY) other = { ch, end: d0 <= d1 ? 0 : 1 };
      continue;
    }
    if (inBaseZone(b, s, ch, here)) {
      if (!ch.root) return { ch, end: null }; // an ordinary side branch wins over a ground root / thread in the same spot
      other ??= { ch, end: null };
    }
  }
  return other;
}

/** Is the spot `here` (on `b` at arc length s) in the base zone of its side branch `ch` (the zone auto-climb / Shift act in)? */
function inBaseZone(b: Branch, s: number, ch: Branch, here: V3): boolean {
  const n = nearestOnBranch(ch, here);
  return n.dist < radiusAt(ch, n.s) * 0.8 + 4 && n.s < radiusAt(b, s) * 2.5 + ch.r;
}

function updateShake(c: Creature): void {
  c.shake = c.gripOn ? Math.max(0, (0.45 - c.grip) / 0.45) : 0;
}

function moveHead(world: World, c: Creature, dS: number, dW: number, travelled: number): void {
  let used = 1; // share of `travelled` that was real movement (the head stopped at a tip / at a stump's foot)
  let b = world.branches.get(c.head.b)!;
  let s = c.head.s + dS;
  let th = wrapAngle(c.head.th + dW / radiusAt(b, c.head.s));
  const lim = c.animal.maxTh;
  if (lim !== undefined) th = clamp(th, -lim, lim);

  /**
   * Move onto branch nb at arc length ns, keeping the same world-space spot on the circumference and heading. `at` = a world point
   * on nb's surface to land on instead (leaving a silk thread: it meets the surface at its anchor / end point, and a thread
   * runs about perpendicular to the surface, so there is no heading to keep: phi = 0).
   */
  const transfer = (nb: Branch, ns: number, at?: V3): void => {
    const f0 = frameAt(b, Math.min(b.total, Math.max(0, s)));
    const n = normalAt(f0, th);
    const wh = headingFromFrame(f0, th, c.phi);
    const f1 = frameAt(nb, ns);
    const th1 = at ? thetaOf(f1, sub(at, f1.p)) : thetaOf(f1, n);
    const along = dotV(wh, f1.t), around = dotV(wh, crossAround(f1, th1));
    c.phi = at && Math.hypot(along, around) < 0.35 ? 0 : Math.atan2(around, along);
    th = th1;
    b = nb;
    s = ns;
  };

  if (s > b.total) {
    const link = b.endLink ? world.branches.get(b.endLink.b) : undefined;
    if (link && b.endLink) {
      c.threadCool = 0.5; // don't re-enter the thread you just left (Shift held)
      transfer(link, clamp(b.endLink.s, 0, link.total), b.pts[b.pts.length - 1]); // the far end of a silk bridge
    } else {
      const f = frameAt(b, b.total);
      const wh = headingFromFrame(f, th, c.phi);
      const nrm = normalAt(f, th);
      let best: Branch | null = null;
      let bestDot = -Infinity;
      for (const id of b.next) {
        const ch = world.branches.get(id)!;
        // the child on the side of the bark you stand on wins (like a side branch); the heading breaks ties between children on the same side
        // (a ring of near-horizontal branches that all leave at the same angle off the end cannot be told apart by heading alone)
        const ct = frameAt(ch, 0).t;
        const d0 = 0.35 * dotV(wh, ct) + dotV(nrm, ct);
        if (d0 > bestDot) {
          bestDot = d0;
          best = ch;
        }
      }
      if (best) transfer(best, s - b.total);
      else {
        // the tip: the head stops here. The distance walked counts only as far as the head really moved, or the body (which follows the trail by
        // distance) would pile up on the end while W is held ("bunched up" at the top of a trunk)
        used = dS > 0 ? clamp((b.total - c.head.s) / dS, 0, 1) : 0;
        s = b.total;
      }
    }
  } else if (s < 0) {
    const parent = b.parent ? world.branches.get(b.parent) : undefined;
    if (parent && b.silk) {
      c.threadCool = 0.5;
      transfer(parent, clamp(b.attachS ?? 0, 0, parent.total), b.pts[0]); // a thread's start is its anchor
    }
    else if (parent) {
      c.noAuto = b.silk ? undefined : b.id; // we just came down out of this branch's base (a ground root: up onto the stump): do not walk straight back in
      transfer(parent, (b.attachS ?? parent.total) + s);
    } else {
      used = dS < 0 ? clamp(c.head.s / -dS, 0, 1) : 0; // (same as at a tip: only the distance really walked counts)
      s = 0; // the foot of a stump (no parent): the star junction still applies right at the bottom
      const r = dS < 0 && !c.climbHeld && Math.abs(c.phi) > STAR_FACING ? starRoot(world, b, 0, th, c.noAuto) : null;
      if (r) transfer(r, nearestOnBranch(r, surfacePoint(b, 0, th).p).s);
    }
  } else {
    // side branches. An ORDINARY side branch (not a ground root, not a silk thread) is entered AUTOMATICALLY while you walk tip-ward in
    // the zone where it leaves the bark (that zone is the side of the bark it grows from: walking on the other side passes it);
    // holding Shift means "stay on this branch". Walking down (S) never turns you into an ordinary side branch. Silk threads and
    // ground roots that do not leave a stump keep the old rule: Shift climbs in (you can still walk past); the stump's roots
    // are entered walking DOWN (the star junction, below).
    const e = sideEntry(world, b, s, th, canUseThreads(c.animal) && !(c.threadCool && c.threadCool > 0), c.noAuto); // (the branch we just came out of is not offered again)
    if (e && e.end !== null) {
      if (c.climbHeld) {
        transfer(e.ch, e.end === 0 ? 0 : e.ch.total); // a thread: start walking along it, away from the end you stand at
        c.phi = e.end === 0 ? 0 : Math.PI;
      }
    } else if (e) {
      if (!c.climbHeld && dS > 0) transfer(e.ch, nearestOnBranch(e.ch, surfacePoint(b, s, th).p).s);
    }
    if (!e || e.end === null) {
      // THE STAR JUNCTION: the ground roots meet at the stump like a star. Walking DOWN the stump below the roots' tops takes the root
      // nearest the side of the bark you face (STAR_ARC); Shift = stay on the stump. Nothing to do on any other branch.
      const r = dS < 0 && !c.climbHeld && Math.abs(c.phi) > STAR_FACING ? starRoot(world, b, s, th, c.noAuto) : null; // (facing down: not in the middle of a U-turn)
      if (r) transfer(r, nearestOnBranch(r, surfacePoint(b, s, th).p).s);
    }
    if (c.noAuto) {
      const ch = world.branches.get(c.noAuto);
      if (!ch || ch.parent !== b.id) c.noAuto = undefined;
      else if (ch.root ? starRoot(world, b, s, th)?.id !== ch.id : !inBaseZone(b, s, ch, surfacePoint(b, s, th).p)) c.noAuto = undefined; // out of that zone: auto-climb is armed again
    }
  }

  if (lim !== undefined && Math.abs(th) > lim) {
    // a transfer / landing may have put the cat past its cling limit: clamp NOW (not next frame) and keep the world heading
    const f = frameAt(b, s);
    const wh = headingFromFrame(f, th, c.phi);
    th = clamp(th, -lim, lim);
    c.phi = Math.atan2(dotV(wh, crossAround(f, th)), dotV(wh, f.t));
  }
  c.head = { b: b.id, s, th };
  c.D += travelled * used;
  const sample = { D: c.D, p: surfacePoint(b, s, th).p, surf: { ...c.head } };
  const last = c.trail[c.trail.length - 1];
  if (used === 0 && last && last.surf !== null && last.D === c.D) {
    c.trail[c.trail.length - 1] = sample; // nothing was walked: the head sample is just refreshed
    const prev = c.trail[c.trail.length - 2];
    if (prev && prev.surf === null && prev.D === c.D) c.trail.splice(c.trail.length - 2, 1); // (and an airborne sample at the very same D, from the landing, would shadow it)
  } else {
    if (used === 0 && last && last.D === c.D) sample.D = c.D += 0.01; // (the sample before was an airborne one: keep D strictly increasing)
    pushTrail(c, sample);
  }
}

const dotV = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const crossAround = (f: { u: V3; b: V3 }, th: number): V3 => add(mul(f.u, -Math.sin(th)), mul(f.b, Math.cos(th)));
function headingFromFrame(f: { t: V3; u: V3; b: V3 }, th: number, phi: number): V3 {
  return norm(add(mul(f.t, Math.cos(phi)), mul(crossAround(f, th), Math.sin(phi))));
}

function pushTrail(c: Creature, sample: TrailSample): void {
  c.trail.push(sample);
  const keep = maxD(c.animal) + 60 + (c.animal.reach?.max ?? 0); // a reach runs the head ahead; retracting needs the tail's history
  while (c.trail.length > 2 && c.trail[1].D < c.D - keep) c.trail.shift();
}

// --- broad phase: a uniform grid over the branches (cached per world) so the leap preview's many arcs stay cheap ---

interface BranchGrid {
  /** Branches in the world's Map order (contact checks keep that order, so the first hit is the same as a full scan). */
  list: Branch[];
  /** Bounding box of each branch's centreline. */
  boxes: Map<Branch, { lo: V3; hi: V3 }>;
  /** Cell -> ascending `bi * SEG_RANGE + segment` codes (bi = index into `list`) of the segments whose radius-inflated box reaches the cell. */
  cells: Map<number, number[]>;
  /** Segment codes near p (a stored list, don't mutate). */
  near(p: V3): readonly number[];
}

const GRID_CELL = 160;
const SEG_RANGE = 65536;
const NO_CELL: readonly number[] = [];
const cellKey = (cx: number, cy: number, cz: number): number => ((cx & 1023) << 20) | ((cy & 1023) << 10) | (cz & 1023); // (collisions only add candidates)
const gridCache = new WeakMap<World, { size: number; grid: BranchGrid }>();

function branchGrid(world: World): BranchGrid {
  const hit = gridCache.get(world);
  if (hit && hit.size === world.branches.size) return hit.grid;
  const list = [...world.branches.values()];
  const cells = new Map<number, number[]>();
  const boxes = new Map<Branch, { lo: V3; hi: V3 }>();
  const mark = (code: number, lo: V3, hi: V3): void => {
    for (let x = Math.floor(lo.x / GRID_CELL); x <= Math.floor(hi.x / GRID_CELL); x++)
      for (let y = Math.floor(lo.y / GRID_CELL); y <= Math.floor(hi.y / GRID_CELL); y++)
        for (let z = Math.floor(lo.z / GRID_CELL); z <= Math.floor(hi.z / GRID_CELL); z++) {
          const k = cellKey(x, y, z);
          const l = cells.get(k);
          if (!l) cells.set(k, [code]);
          else if (l[l.length - 1] !== code) l.push(code);
        }
  };
  list.forEach((b, bi) => {
    boxes.set(b, {
      lo: v3(Math.min(...b.pts.map((q) => q.x)), Math.min(...b.pts.map((q) => q.y)), Math.min(...b.pts.map((q) => q.z))),
      hi: v3(Math.max(...b.pts.map((q) => q.x)), Math.max(...b.pts.map((q) => q.y)), Math.max(...b.pts.map((q) => q.z))),
    });
    const m = Math.max(b.r, b.rEnd) + 4; // >= every contact distance used (0.9 r + 4, and a little more)
    for (let i = 1; i < b.pts.length; i++) {
      const n = Math.max(1, Math.ceil(dist(b.pts[i - 1], b.pts[i]) / GRID_CELL)); // long segments in chunks
      for (let k = 0; k < n; k++) {
        const p = lerp3(b.pts[i - 1], b.pts[i], k / n), q = lerp3(b.pts[i - 1], b.pts[i], (k + 1) / n);
        mark(bi * SEG_RANGE + i, v3(Math.min(p.x, q.x) - m, Math.min(p.y, q.y) - m, Math.min(p.z, q.z) - m), v3(Math.max(p.x, q.x) + m, Math.max(p.y, q.y) + m, Math.max(p.z, q.z) + m));
      }
    }
  });
  const grid: BranchGrid = { list, boxes, cells, near: (p) => cells.get(cellKey(Math.floor(p.x / GRID_CELL), Math.floor(p.y / GRID_CELL), Math.floor(p.z / GRID_CELL))) ?? NO_CELL };
  gridCache.set(world, { size: list.length, grid });
  return grid;
}

// --- leaping (relative to the SURFACE: away from it along the normal, plus forward) ------

const AIM_TAP = 0.18;
const AIM_RAMP = 0.8;
const AIM_YAW = (70 * Math.PI) / 180;
const AIM_PITCH_MIN = -0.35;
const AIM_PITCH_MAX = 0.6;
/** Assist search window around the manual aim. */
const ASSIST_YAW = (30 * Math.PI) / 180;
const ASSIST_PITCH = 0.25;
/** The preview / launch ballistics step (the app runs at about this). */
const ARC_DT = 1 / 60;

/** Launch power after `t` seconds held: a tap (< 0.18 s) is the full leap, then 0.55 -> 1 over 0.8 s. */
const aimCharge = (t: number): number => (t < AIM_TAP ? 1 : 0.55 + 0.45 * clamp((t - AIM_TAP) / (AIM_RAMP - AIM_TAP), 0, 1));

function updateAim(aim: Aim, input: Input, dt: number): void {
  aim.t += dt;
  aim.yaw = clamp(aim.yaw + ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 1.6 * dt, -AIM_YAW, AIM_YAW);
  aim.pitch = clamp(aim.pitch + ((input.forward ? 1 : 0) - (input.back ? 1 : 0)) * dt, AIM_PITCH_MIN, AIM_PITCH_MAX);
  aim.charge = aimCharge(aim.t);
}

/**
 * The mouse camera steers the jump aim: yaw (about the surface normal, relative to the heading) and pitch follow the look direction at up to ~3.5 rad/s;
 * a manual A/D / W/S in the same frame wins for that axis.
 */
function lookAim(world: World, c: Creature, input: Input, dt: number): void {
  const aim = c.aim!;
  const look = input.aimDir!;
  const b = world.branches.get(c.head.b);
  const lp = c.animal.leap;
  if (!b || !lp) return;
  const f = frameAt(b, c.head.s);
  const n = normalAt(f, c.head.th);
  const h = headingFromFrame(f, c.head.th, c.phi);
  const p = sub(look, mul(n, dotV(look, n)));
  const rate = 3.5 * dt;
  if (!input.left && !input.right && len(p) > 1e-3) {
    const want = clamp(Math.atan2(dotV(cross(h, n), p), dotV(h, p)), -AIM_YAW, AIM_YAW);
    aim.yaw = clamp(aim.yaw + clamp(want - aim.yaw, -rate, rate), -AIM_YAW, AIM_YAW);
  }
  if (!input.forward && !input.back) {
    const want = clamp(Math.asin(clamp(dotV(look, n), -1, 1)) - Math.atan2(lp.up, lp.speed), AIM_PITCH_MIN, AIM_PITCH_MAX);
    aim.pitch = clamp(aim.pitch + clamp(want - aim.pitch, -rate, rate), AIM_PITCH_MIN, AIM_PITCH_MAX);
  }
}

/** Launch velocity: heading turned by `yaw` about the surface normal, elevation = default leap angle + `pitch`, scaled by `charge`. */
function leapVelocity(lp: NonNullable<Animal["leap"]>, fwd: V3, n: V3, yaw: number, pitch: number, charge: number): V3 {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const dir = add(mul(fwd, cs), mul(cross(fwd, n), sn)); // + yaw = right (right = forward x up, as in steerReach)
  const e = clamp(Math.atan2(lp.up, lp.speed) + pitch, -0.6, 1.45);
  const mag = Math.hypot(lp.speed, lp.up) * charge;
  return add(mul(dir, Math.cos(e) * mag), mul(n, Math.sin(e) * mag));
}

interface Hit {
  b: string;
  s: number;
  th: number;
  p: V3;
}

/** Everything the leap code needs to know about the spot it leaps from. */
interface Launch {
  from: SurfacePos;
  p0: V3;
  fwd: V3;
  n: V3;
  lp: NonNullable<Animal["leap"]>;
  /** Silk threads count as something to land on (animals that can use them). */
  threads: boolean;
  /** Hits closer than this to the launch point don't count as "another branch" (the junction you stand in). */
  minHop: number;
}

function launchOf(world: World, c: Creature): Launch {
  const b = world.branches.get(c.head.b)!;
  const sp = surfacePoint(b, c.head.s, c.head.th);
  return { from: { ...c.head }, p0: sp.p, fwd: headingVector(world, c), n: sp.n, lp: c.animal.leap!, threads: canUseThreads(c.animal), minHop: 3 * animalWidth(c.animal) };
}

/**
 * Fly a leap with exactly the ballistics of `stepAir` (fixed ARC_DT, no steering): the first branch it touches, or null when it
 * runs out (2.2 s, 7 s for gliders) or reaches the ground. `rec` collects ~40-60 points (every `every`th step, plus the last).
 */
function flyArc(world: World, L: Launch, v0: V3, rec: V3[] | null): Hit | null {
  const air: Air = { p: L.p0, v: v0, t: 0, from: L.from, ignore: 0.3, slip: false };
  const maxT = L.lp.steer ? 7 : 2.2;
  const every = L.lp.steer ? 8 : 3;
  const floor = world.groundY ?? -2500;
  rec?.push(air.p);
  for (let i = 1; ; i++) {
    air.t += ARC_DT;
    airPhysics(air, L.lp, ARC_DT, 0);
    const hit = air.t > 0.12 ? airContact(world, air, L.threads) : null;
    if (hit) {
      rec?.push(air.p);
      const f = frameAt(hit.b, hit.n.s);
      return { b: hit.b.id, s: hit.n.s, th: thetaOf(f, sub(air.p, f.p)), p: air.p };
    }
    if (air.t > maxT || air.p.y < floor) {
      rec?.push(air.p);
      return null;
    }
    if (rec && i % every === 0) rec.push(air.p);
  }
}

interface LeapPlan {
  launch: Launch;
  v: V3;
  /** Final yaw / pitch (manual + assist). */
  yaw: number;
  pitch: number;
  assisted: boolean;
}

/** Does this hit count as a target: another branch, and not just the junction next to us. */
const validHit = (L: Launch, h: Hit | null): h is Hit => h !== null && h.b !== L.from.b && dist(h.p, L.p0) >= L.minHop;

/** The aim (manual, plus the mild assist toward another branch when the manual arc would not land on one). Pure: preview and launch share it. */
function planLeap(world: World, c: Creature, aim: Aim): LeapPlan {
  const L = launchOf(world, c);
  const vel = (dy: number, dp: number): V3 => leapVelocity(L.lp, L.fwd, L.n, aim.yaw + dy, aim.pitch + dp, aim.charge);
  const manual = vel(0, 0);
  const plan = (dy: number, dp: number, v: V3, assisted: boolean): LeapPlan => ({ launch: L, v, yaw: aim.yaw + dy, pitch: aim.pitch + dp, assisted });
  if (validHit(L, flyArc(world, L, manual, null))) return plan(0, 0, manual, false);

  // search: smallest angular change first, nearer and top-half landings preferred
  const range = Math.hypot(L.lp.speed, L.lp.up) * aim.charge + 1;
  let best = null as { dy: number; dp: number; cost: number; v: V3 } | null;
  const tryAim = (dy: number, dp: number): void => {
    if (Math.abs(dy) > ASSIST_YAW + 1e-9 || Math.abs(dp) > ASSIST_PITCH + 1e-9) return;
    const v = vel(dy, dp);
    const h = flyArc(world, L, v, null);
    if (!validHit(L, h)) return;
    const cost = Math.abs(dy) / ASSIST_YAW + Math.abs(dp) / ASSIST_PITCH + 0.3 * Math.min(2, dist(h.p, L.p0) / range) + (Math.abs(h.th) < Math.PI / 2 ? 0 : 0.5);
    if (!best || cost < best.cost) best = { dy, dp, cost, v };
  };
  for (let i = -4; i <= 4; i++) for (let j = -2; j <= 2; j++) if (i || j) tryAim((i * ASSIST_YAW) / 4, (j * ASSIST_PITCH) / 2);
  for (const k of [2, 4]) { // refine around the best cell with half, then quarter steps
    if (!best) break;
    const { dy, dp } = best;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i || j) tryAim(dy + (i * ASSIST_YAW) / (4 * k), dp + (j * ASSIST_PITCH) / (2 * k));
  }
  return best ? plan(best.dy, best.dp, best.v, true) : plan(0, 0, manual, false);
}

/** Release: launch along the planned aim. */
function launchAimed(world: World, c: Creature): void {
  const aim = c.aim!;
  c.aim = null;
  const plan = planLeap(world, c, aim);
  c.air = { p: plan.launch.p0, v: plan.v, t: 0, from: plan.launch.from, ignore: 0.3, slip: false };
}

/** A plain full-power leap along the heading (the aim assist still applies). */
export function startLeap(world: World, c: Creature): void {
  c.aim = { yaw: 0, pitch: 0, charge: 1, t: 0 };
  launchAimed(world, c);
}

const previewCache = new WeakMap<Creature, { key: string; grid: BranchGrid; preview: Preview }>();

/**
 * The arc the creature would fly if Space were released now (null unless it is aiming). Does not touch `c`. Cached per creature while
 * nothing it depends on changes, so calling it every frame is cheap; treat the result as read-only.
 */
export function leapPreview(world: World, c: Creature): Preview | null {
  const aim = c.aim;
  if (!aim || !c.animal.leap || c.air || c.flight || c.reach) return null;
  const grid = branchGrid(world);
  const key = [c.animal.id, c.head.b, c.head.s, c.head.th, c.phi, aim.yaw, aim.pitch, aim.charge].join("|");
  const hit0 = previewCache.get(c);
  if (hit0 && hit0.key === key && hit0.grid === grid) return hit0.preview;
  const plan = planLeap(world, c, aim);
  const points: V3[] = [];
  const hit = flyArc(world, plan.launch, plan.v, points);
  const preview = { points, hit, assisted: plan.assisted };
  previewCache.set(c, { key, grid, preview });
  return preview;
}

/** Lose the grip: drop away from the branch, then land/snap as usual. */
function startSlip(world: World, c: Creature): void {
  const b = world.branches.get(c.head.b)!;
  const sp = surfacePoint(b, c.head.s, c.head.th);
  c.air = { p: sp.p, v: add(mul(sp.n, 50), v3(0, -30, 0)), t: 0, from: { ...c.head }, ignore: 0.9, slip: true };
  c.grip = 1;
}

/** Gravity (reduced for gliders, with an eased terminal fall) and the move: the one integration step shared by `stepAir` and the leap preview. `pitch` = glider dive (+1) / flare (-1). */
function airPhysics(air: Air, lp: Animal["leap"], dt: number, pitch: number): void {
  const gravity = air.slip || !lp ? 1 : lp.gravity;
  air.v = { ...air.v, y: air.v.y - (GRAVITY * gravity + (pitch > 0 ? 500 : 0)) * dt };
  if (gravity < 1 && !air.slip) {
    // glide: slow terminal fall (eased, so changing pitch doesn't snap the speed)
    const term = pitch > 0 ? -420 : pitch < 0 ? -70 : -140;
    if (air.v.y < term) air.v.y = Math.min(term, air.v.y + 700 * dt);
  }
  air.p = add(air.p, mul(air.v, dt));
}

/** nearestOnBranch restricted to the listed segments (ascending): same arithmetic, so same result whenever the true nearest is among them. */
function nearestInSegments(b: Branch, codes: readonly number[], from: number, to: number, p: V3): Nearest {
  let best: Nearest = { s: 0, dist: Infinity };
  for (let j = from; j < to; j++) {
    const i = codes[j] % SEG_RANGE;
    const a = b.pts[i - 1];
    const v = sub(b.pts[i], a);
    const l2 = dotV(v, v) || 1;
    const t = Math.min(1, Math.max(0, dotV(sub(p, a), v) / l2));
    const d = dist(p, add(a, mul(v, t)));
    if (d < best.dist) best = { s: b.cum[i - 1] + t * Math.sqrt(l2), dist: d };
  }
  return best;
}

/** The first branch the airborne creature touches (the origin branch can't catch it during `ignore`), with the nearest point on it. */
function airContact(world: World, air: Air, threads: boolean): { b: Branch; n: Nearest } | null {
  const g = branchGrid(world);
  const codes = g.near(air.p);
  for (let k = 0; k < codes.length; ) {
    const bi = Math.floor(codes[k] / SEG_RANGE), from = k;
    while (k < codes.length && Math.floor(codes[k] / SEG_RANGE) === bi) k++;
    const b = g.list[bi];
    if (b.silk && (!threads || (b.id === air.skip && air.t < 1.2))) continue; // threads only catch animals that can use them (never the one a spider just let go of)
    const n = nearestInSegments(b, codes, from, k, air.p);
    if (n.dist < radiusAt(b, n.s) * 0.9 + 4 && !(b.id === air.from.b && air.t < air.ignore)) return { b, n };
  }
  return null;
}

function stepAir(world: World, c: Creature, dt: number, input: Input): void {
  const air = c.air!;
  air.t += dt;
  const lp = c.animal.leap;
  if (lp && lp.steer && !air.slip) {
    // gliders bend their flight with A/D (rotate the horizontal velocity)
    const turn = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 1.6 * dt;
    const cs = Math.cos(turn), sn = Math.sin(turn);
    air.v = { x: air.v.x * cs - air.v.z * sn, y: air.v.y, z: air.v.x * sn + air.v.z * cs };
  }
  // glide pitch: W dives (fast, steep), S flares (slow, floaty), neither = plain glide
  const pitch = lp && lp.steer && !air.slip ? (input.forward ? 1 : 0) - (input.back ? 1 : 0) : 0;
  if (pitch !== 0) {
    const vh = Math.hypot(air.v.x, air.v.z);
    const goal = lp!.speed * (pitch > 0 ? 1.4 : 0.55);
    const nvh = pitch > 0 ? Math.min(goal, vh + 400 * dt) : Math.max(goal, vh - 400 * dt);
    if (vh > 1e-6 && (pitch > 0 ? vh < goal : vh > goal)) air.v = { x: air.v.x * (nvh / vh), y: air.v.y, z: air.v.z * (nvh / vh) };
  }
  airPhysics(air, lp, dt, pitch);
  c.D += Math.hypot(air.v.x, air.v.y, air.v.z) * dt;
  pushTrail(c, { D: c.D, p: air.p, surf: null });

  if (air.t > 0.12) {
    const hit = airContact(world, air, canUseThreads(c.animal));
    if (hit) {
      land(world, c, hit.b, hit.n.s, air.p, air.v);
      return;
    }
  }
  // Never fatal: miss everything → snap to the nearest branch within reach, else back on top of the origin.
  // gliders get a longer flight before the "missed everything" recovery (the ground catches them anyway)
  if (air.t > (lp?.steer && !air.slip ? 7 : 2.2) || air.p.y < (world.groundY ?? -2500)) {
    let best: { b: Branch; s: number; d: number } | null = null;
    for (const b of world.branches.values()) {
      if (b.silk) continue; // (a rescue puts you on the tree, not on a thread)
      const n = nearestOnBranch(b, air.p);
      if (!best || n.dist < best.d) best = { b, s: n.s, d: n.dist };
    }
    if (best && best.d < 480) land(world, c, best.b, best.s, air.p, air.v);
    else {
      const o = world.branches.get(air.from.b)!;
      c.air = null;
      c.reach = null;
      c.flight = null;
      c.silk = null;
      c.head = { ...air.from, th: 0 };
      c.speedNow = 0;
      c.grip = 1;
      pushTrail(c, { D: c.D, p: surfacePoint(o, c.head.s, 0).p, surf: { ...c.head } });
      settleFeet(world, c, c.head);
    }
  }
}

function land(world: World, c: Creature, b: Branch, s: number, p: V3, v: V3): void {
  const f = frameAt(b, s);
  const off = sub(p, f.p);
  let th = thetaOf(f, off);
  const lim = c.animal.maxTh;
  if (lim !== undefined) th = clamp(th, -lim, lim); // (the cat only clings mostly to the top; the heading below is computed for the clamped spot)
  c.head = { b: b.id, s, th };
  // heading: project the flight direction onto the surface tangent plane at the landing spot
  const fwd = norm(v.x === 0 && v.y === 0 && v.z === 0 ? f.t : v);
  const around = add(mul(f.u, -Math.sin(th)), mul(f.b, Math.cos(th)));
  c.phi = Math.atan2(dotV(fwd, around), dotV(fwd, f.t));
  c.air = null;
  c.reach = null;
  c.flight = null;
  c.silk = null;
  c.speedNow = c.animal.speed * 0.5;
  pushTrail(c, { D: c.D, p: surfacePoint(b, s, th).p, surf: { ...c.head } });
  settleFeet(world, c, c.head); // (the trail behind the head is still the flight path: put the feet where the body will stand)
}

// --- flight ---------------------------------------------------------------------------------

const MAX_PITCH = (55 * Math.PI) / 180;
/** Wing flier energy model: speed gain per unit of -sin(pitch), and drag pulling the speed back to cruise (1/s). */
const WING_DRAG = 0.35;
/** Keeps fliers this far above the ground. */
const FLOOR_CLEARANCE = 15;
/** Landing magnet reach (px). */
const LAND_RANGE = 400;

const wingCruise = (fl: FlightSpec): number => fl.cruise ?? fl.speed * 0.65;
const wingStall = (fl: FlightSpec): number => fl.stall ?? wingCruise(fl) * 0.45;
/** How far from a branch's surface the body is considered touching it. */
const flightMargin = (a: Animal): number => Math.max(3, a.nodes[0].w * 0.8);
const dirOf = (yaw: number, pitch: number): V3 => v3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));

/** Body axes while flying (unit vectors): forward from yaw/pitch, up rolled into the turn by the bank. Level axes when not flying. */
export function flightBasis(c: Creature): { fwd: V3; up: V3 } {
  const f = c.flight;
  if (!f) return { fwd: v3(1, 0, 0), up: v3(0, 1, 0) };
  const fwd = dirOf(f.yaw, f.pitch);
  const right = norm(cross(fwd, v3(0, 1, 0)));
  const up0 = cross(right, fwd);
  const roll = f.bank * 0.9;
  return { fwd, up: norm(add(mul(up0, Math.cos(roll)), mul(right, Math.sin(roll)))) };
}

/** Leave the perch: a hop along normal + forward; the head (and the trail's last surface sample) stay where it took off. */
function startFlight(world: World, c: Creature): void {
  const a = c.animal;
  const fl = a.flight!;
  const b = world.branches.get(c.head.b)!;
  const sp = surfacePoint(b, c.head.s, c.head.th);
  const fwd = headingVector(world, c);
  const m = flightMargin(a);
  const threads = canUseThreads(a);
  let p = add(sp.p, mul(sp.n, m + 2));
  // at a fork the spot just above the perch may be inside the other branch: lift out along the normal, else straight up
  for (let k = 1; k <= 10 && touchesBranch(world, p, m, threads); k++) p = add(sp.p, mul(k <= 5 ? sp.n : v3(0, 1, 0), m + 2 + 12 * (k <= 5 ? k : k - 5)));
  p = { ...p, y: Math.max(p.y, (world.groundY ?? -2500) + FLOOR_CLEARANCE) }; // (a perch at the foot of a trunk: start above the floor)
  let yaw: number, pitch: number, speed: number, v: V3;
  if (fl.kind === "wing") {
    const dir = norm(add(fwd, mul(sp.n, 0.5)));
    yaw = Math.hypot(dir.x, dir.z) > 1e-3 ? Math.atan2(dir.z, dir.x) : 0;
    pitch = clamp(Math.asin(clamp(dir.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
    speed = wingCruise(fl) * 0.8;
    v = mul(dirOf(yaw, pitch), speed);
  } else {
    const h = Math.hypot(fwd.x, fwd.z) > 0.2 ? fwd : sp.n; // straight up/down a trunk: face away from it
    yaw = Math.hypot(h.x, h.z) > 1e-3 ? Math.atan2(h.z, h.x) : 0;
    pitch = 0;
    v = mul(sp.n, fl.climb * 0.5);
    speed = len(v);
  }
  c.flight = { p, v, yaw, pitch, speed, bank: 0, flap: 1, t: 0, from: { ...c.head }, cleared: false, landTarget: null };
  c.speedNow = speed;
  c.feet.forEach((f) => { f.t = -1; });
}

/**
 * A perched flier whose grip ran out (slip fall) opens its wings: flight starts from the falling position and velocity. Hover
 * fliers keep the velocity (it eases to the input like always) and face the direction they were falling sideways, else the way
 * they were heading; a wing flier points along its velocity and is given at least its stall speed.
 */
function startFlightFromFall(world: World, c: Creature): void {
  const air = c.air!;
  const fl = c.animal.flight!;
  const h = headingVector(world, c);
  const dirH = Math.hypot(air.v.x, air.v.z) > 20 ? air.v : h;
  const yaw = Math.hypot(dirH.x, dirH.z) > 1e-3 ? Math.atan2(dirH.z, dirH.x) : 0;
  let pitch = 0, speed = len(air.v), v = air.v;
  if (fl.kind === "wing") {
    pitch = speed > 1 ? clamp(Math.asin(clamp(air.v.y / speed, -1, 1)), -MAX_PITCH, MAX_PITCH) : 0;
    speed = Math.max(speed, wingStall(fl));
    v = mul(dirOf(yaw, pitch), speed);
  }
  c.flight = { p: { ...air.p, y: Math.max(air.p.y, (world.groundY ?? -2500) + FLOOR_CLEARANCE) }, v, yaw, pitch, speed, bank: 0, flap: 1, t: 0, from: { ...air.from }, cleared: false, landTarget: null };
  c.air = null;
  c.speedNow = speed;
  c.feet.forEach((f) => { f.t = -1; });
}

/** Is a body of radius `margin` at p touching any branch? */
function touchesBranch(world: World, p: V3, margin: number, threads: boolean): boolean {
  for (const b of world.branches.values()) {
    if (b.silk && !threads) continue;
    const n = nearestOnBranch(b, p);
    if (n.dist < radiusAt(b, n.s) + margin) return true;
  }
  return false;
}

/** Free flight, in sub-steps of at most 20 ms so a fast flier can't skip through a twig. */
function stepFlight(world: World, c: Creature, input: Input, dt: number): void {
  const n = Math.max(1, Math.ceil(dt / 0.02 - 1e-9));
  for (let i = 0; i < n && c.flight; i++) flightSub(world, c, input, dt / n);
}

function flightSub(world: World, c: Creature, input: Input, dt: number): void {
  const f = c.flight!;
  const fl = c.animal.flight!;
  f.t += dt;
  let turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // the mouse camera steers: the heading turns towards where the camera looks (A/D still win while pressed)
  const look = input.aimDir;
  if (look && turn === 0 && Math.hypot(look.x, look.z) > 1e-3) turn = clamp(wrapAngle(Math.atan2(look.z, look.x) - f.yaw) * 3, -1, 1);

  if (fl.kind === "hover") {
    // fly where you point: W forward, S back (half speed), A/D yaw, Space up, Shift down; velocity eases to the input
    f.yaw = wrapAngle(f.yaw + turn * fl.turnRate * dt);
    const along = (input.forward ? 1 : 0) - (input.back ? 0.5 : 0);
    const vert = (input.reach ? 1 : 0) - (input.climb ? 1 : 0);
    const lift = look ? clamp(look.y, -0.9, 0.9) : 0; // looking up / down: W flies up / down too
    const flat = Math.sqrt(1 - lift * lift);
    const goal = v3(Math.cos(f.yaw) * along * fl.speed * flat, vert * fl.climb + along * lift * fl.speed, Math.sin(f.yaw) * along * fl.speed * flat);
    const k = Math.min(1, fl.accel * dt);
    f.v = add(f.v, mul(sub(goal, f.v), k));
    f.speed = len(f.v);
    f.pitch += (clamp(f.v.y / fl.climb, -1, 1) * 0.3 - f.pitch) * Math.min(1, dt * 6);
    f.bank += (turn * 0.5 - f.bank) * Math.min(1, dt * 6);
    f.flap = 1;
  } else {
    // wing: always forward; height <-> speed. Diving gains speed, climbing bleeds it, below the stall the nose drops.
    // Shift = LANDING MODE: flare to 1.15 x stall, level out, and let a magnet steer toward the best branch ahead.
    const cruise = wingCruise(fl), stall = wingStall(fl);
    const K = 0.9 * (cruise - stall);
    let pitchIn = (input.back ? 1 : 0) - (input.forward ? 1 : 0); // S climbs, W dives
    if (look && pitchIn === 0 && !input.climb) pitchIn = clamp((Math.asin(clamp(look.y, -1, 1)) - f.pitch) * 3, -1, 1); // the camera's elevation
    const flapping = input.reach || input.leap;
    const landing = input.climb;
    const tgt = landing ? pickLandTarget(world, f) : null;
    f.landTarget = tgt;
    const aim = tgt ? norm(sub(tgt.p, f.p)) : null;
    if (landing) {
      f.speed += (stall * 1.15 - f.speed) * Math.min(1, dt * 2);
      if (aim) {
        const goal = clamp(Math.asin(clamp(aim.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
        f.pitch += clamp(goal - f.pitch, -fl.climb * 1.5 * dt, fl.climb * 1.5 * dt);
      } else f.pitch += (-0.08 - f.pitch) * Math.min(1, dt * fl.climb * 1.5);
      f.pitch = clamp(f.pitch + pitchIn * fl.climb * 0.5 * dt, -MAX_PITCH, MAX_PITCH);
    } else {
      if (f.speed < stall) f.pitch -= fl.climb * 1.5 * dt;
      else if (pitchIn !== 0) f.pitch += pitchIn * fl.climb * dt;
      else f.pitch += (-0.02 - f.pitch) * Math.min(1, dt * fl.climb * 0.9); // let go: settle into a level glide
      f.pitch = clamp(f.pitch, -MAX_PITCH, MAX_PITCH);
      let ds = -Math.sin(f.pitch) * K - WING_DRAG * (f.speed - cruise);
      if (flapping) ds += fl.accel;
      f.speed = clamp(f.speed + ds * dt, stall * 0.3, fl.speed);
    }
    const scale = clamp(cruise / Math.max(f.speed, 1), 0.45, 1.25); // fast = wide turns
    let yawRate = turn * fl.turnRate * scale;
    if (aim) {
      // magnet: turn x1.6 toward the target (a manual A/D still adds and dominates: the magnet is then only a third as strong)
      const rate = fl.turnRate * scale * 1.6 * (turn !== 0 ? 0.33 : 1);
      yawRate += clamp(wrapAngle(Math.atan2(aim.z, aim.x) - f.yaw) / dt, -rate, rate);
    }
    f.yaw = wrapAngle(f.yaw + yawRate * dt);
    f.bank += (clamp(yawRate / fl.turnRate, -1, 1) - f.bank) * Math.min(1, dt * 5);
    f.v = mul(dirOf(f.yaw, f.pitch), f.speed);
    if (flapping) f.v = { ...f.v, y: f.v.y + fl.accel * 0.2 };
    f.flap += ((flapping ? 1 : f.speed < stall ? 0.8 : 0.2) - f.flap) * Math.min(1, dt * 8);
  }

  const p0 = f.p;
  f.p = add(f.p, mul(f.v, dt));
  if (flightContacts(world, c, input, p0)) return;

  const floor = (world.groundY ?? -2500) + FLOOR_CLEARANCE;
  if (f.p.y < floor) {
    f.p = { ...f.p, y: floor };
    if (f.v.y < 0) f.v = { ...f.v, y: 0 };
    if (fl.kind === "wing" && f.pitch < 0) f.pitch = 0;
  }
  c.speedNow = f.speed;
  const last = c.trail[c.trail.length - 1];
  const moved = dist(f.p, last.p);
  if (moved >= 1) { // (a hovering bee would otherwise pile up samples at one spot)
    c.D += moved;
    pushTrail(c, { D: c.D, p: f.p, surf: null });
  }
}

/**
 * Landing magnet (wing flier, Shift held): the best spot on a branch ahead (within 400 px, +-45 degrees of the heading; the branch
 * it is already steering for keeps a wider cone and a bonus so it doesn't flip). Prefers a small turn, near, and the upper half
 * (the aim point sits just inside the surface on the side facing the bird, tilted up).
 */
function pickLandTarget(world: World, f: Flight): { b: string; p: V3 } | null {
  const fwd = dirOf(f.yaw, f.pitch);
  const prev = f.landTarget?.b;
  const boxes = branchGrid(world).boxes;
  let best: { b: string; p: V3; cost: number } | null = null;
  for (const b of world.branches.values()) {
    if (b.silk || (b.id === f.from.b && f.t < 0.6)) continue; // (only the jay lands by magnet, and it can't use threads)
    const r = Math.max(b.r, b.rEnd);
    const { lo, hi } = boxes.get(b)!; // cheap reject: the branch's bounding box (inflated) must be within range
    const dx = Math.max(lo.x - f.p.x, 0, f.p.x - hi.x), dy = Math.max(lo.y - f.p.y, 0, f.p.y - hi.y), dz = Math.max(lo.z - f.p.z, 0, f.p.z - hi.z);
    if (Math.hypot(dx, dy, dz) > LAND_RANGE + r) continue;
    const cone = Math.cos(((b.id === prev ? 70 : 45) * Math.PI) / 180);
    for (let i = 0; i < b.pts.length; i++) {
      const rr = radiusAt(b, b.cum[i]);
      const w = sub(f.p, b.pts[i]);
      const d0 = len(w);
      const out = d0 > 1e-6 ? mul(w, 1 / d0) : v3(0, 1, 0); // from the branch toward the bird
      const nrm = norm(add(mul(out, 0.8), v3(0, 0.6, 0)));
      const p = add(b.pts[i], mul(nrm, rr * 0.7));
      const to = sub(p, f.p), d = len(to);
      if (d > LAND_RANGE || d < 1e-6) continue;
      const cosA = dotV(fwd, to) / d;
      if (cosA < cone) continue;
      const cost = Math.acos(clamp(cosA, -1, 1)) / (Math.PI / 4) + 0.6 * (d / LAND_RANGE) + (nrm.y < 0 ? 0.5 : 0) - (out.y > 0.2 ? 0.25 : 0) - (b.id === prev ? 0.2 : 0);
      if (!best || cost < best.cost) best = { b: b.id, p, cost };
    }
  }
  return best ? { b: best.b, p: best.p } : null;
}

/** Touching a branch: land (autoLand / Shift / a wing flier slower than 1.4 x stall) or be pushed out along the surface normal. True when it landed. `p0` = where it was before this move. */
function flightContacts(world: World, c: Creature, input: Input, p0: V3): boolean {
  const f = c.flight!;
  const fl = c.animal.flight!;
  const margin = flightMargin(c.animal);
  const threads = canUseThreads(c.animal);
  const touching = (p: V3): boolean => touchesBranch(world, p, margin, threads);
  for (let pass = 0; pass < 6; pass++) { // (a crotch between two branches needs a few rounds of pushing)
    let hit = false;
    for (const b of world.branches.values()) {
      if (b.silk && !threads) continue;
      const n = nearestOnBranch(b, f.p);
      const r = radiusAt(b, n.s);
      const origin = b.id === f.from.b;
      // the perch it took off from only lands it once the flier has really cleared it (an underside take-off with Space held
      // hops down and would otherwise re-land at once): until then it just deflects
      if (origin && !f.cleared && f.t > 0.05 && n.dist >= r + margin + 8) f.cleared = true;
      if (n.dist >= r + margin) continue;
      if ((fl.autoLand || input.climb || (fl.kind === "wing" && f.speed < wingStall(fl) * 1.4)) && !(origin && !f.cleared)) {
        land(world, c, b, n.s, f.p, f.v);
        return true;
      }
      const fr = frameAt(b, n.s);
      const off = sub(f.p, fr.p);
      const nrm = len(off) > 1e-6 ? mul(off, 1 / len(off)) : fr.u;
      f.p = add(fr.p, mul(nrm, r + margin + 0.01));
      const vn = dotV(f.v, nrm);
      if (vn < 0) f.v = sub(f.v, mul(nrm, vn));
      if (fl.kind === "wing") {
        // the heading follows the deflected velocity (straight into the bark: turn out along the normal)
        const dir = len(f.v) > 0.05 * Math.max(f.speed, 1) ? norm(f.v) : nrm;
        f.yaw = Math.atan2(dir.z, dir.x);
        f.pitch = clamp(Math.asin(clamp(dir.y, -1, 1)), -MAX_PITCH, MAX_PITCH);
      }
      hit = true;
    }
    if (!hit) return false;
  }
  // wedged between two branches (pushing out of one goes into the other): stay where it was, it is clear of both
  if (touching(f.p) && !touching(p0)) {
    f.p = p0;
    f.v = v3();
  }
  return false;
}

// --- snake reach: a living bridge ---------------------------------------------------------

/** A/D yaw the stretching head about the origin's normal (D = right, like surface steering), W/S pitch it. */
function steerReach(r: Reach, input: Input, turnRate: number, dt: number): void {
  let yaw = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * turnRate * dt;
  let pitchKey = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  if (input.aimDir) {
    // the mouse camera steers the stretching head: yaw about the origin's normal towards the look direction, pitch towards its elevation
    const flatL = sub(input.aimDir, mul(r.up, dotV(input.aimDir, r.up)));
    const flatD = sub(r.dir, mul(r.up, dotV(r.dir, r.up)));
    if (yaw === 0 && len(flatL) > 1e-3 && len(flatD) > 1e-3) {
      const err = Math.atan2(dotV(cross(flatD, r.up), flatL), dotV(flatD, flatL)); // + = right (right = dir x up)
      yaw = clamp(err, -turnRate * dt * 1.5, turnRate * dt * 1.5);
    }
    if (pitchKey === 0) {
      const err = Math.asin(clamp(dotV(input.aimDir, r.up), -1, 1)) - Math.asin(clamp(dotV(r.dir, r.up), -1, 1));
      pitchKey = clamp(err * 3, -1, 1);
    }
  }
  if (yaw !== 0) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw), k = dotV(r.up, r.dir) * (1 - cs);
    r.dir = norm(add(add(mul(r.dir, cs), mul(cross(r.dir, r.up), sn)), mul(r.up, k)));
  }
  const pitch = pitchKey * 1.2 * dt;
  if (pitch !== 0) {
    const y = dotV(r.dir, r.up);
    const flat = sub(r.dir, mul(r.up, y));
    if (len(flat) > 1e-6) {
      const e = Math.asin(Math.max(-1, Math.min(1, y))) + pitch;
      const ny = Math.max(-0.5, Math.min(0.9, Math.sin(e)));
      r.dir = norm(add(mul(norm(flat), Math.sqrt(1 - ny * ny)), mul(r.up, ny)));
    }
  }
}

function stepReach(world: World, c: Creature, input: Input, dt: number): void {
  const a = c.animal;
  const rc = a.reach!;
  if (input.reach) {
    if (!c.reach) {
      const b = world.branches.get(c.head.b)!;
      const sp = surfacePoint(b, c.head.s, c.head.th);
      c.reach = { p: sp.p, dir: headingVector(world, c), len: 0, from: { ...c.head }, up: sp.n };
      c.speedNow = 0;
    }
    const r = c.reach;
    steerReach(r, input, a.turnRate, dt);
    // the head keeps stretching until `max`, then just holds there
    const d = Math.max(0, Math.min(rc.speed * dt, rc.max - r.len));
    if (d > 0) {
      r.p = add(r.p, mul(r.dir, d));
      r.len += d;
      c.D += d;
      pushTrail(c, { D: c.D, p: r.p, surf: null });
    }
    // stretched out: hanging on by the body — drains only while no part of it is on top, empty → fall
    if (c.gripOn) c.grip = bodyOnTop(world, c) ? Math.min(1, c.grip + 0.5 * dt) : Math.max(0, c.grip - 0.32 * dt);
    // contact: any other branch within reach of the head → bridge! attach there (a short reach, like the ant's, needs less than 14 px first)
    const threads = canUseThreads(a);
    for (const b of world.branches.values()) {
      if (b.id === r.from.b || r.len < Math.min(14, rc.max * 0.2) || (b.silk && !threads)) continue; // a branch overlapping the origin is not a bridge
      const n = nearestOnBranch(b, r.p);
      if (n.dist < radiusAt(b, n.s) * 0.9 + 3) {
        land(world, c, b, n.s, r.p, mul(r.dir, 1));
        c.speedNow = 0;
        c.grip = Math.min(1, c.grip + 0.3);
        return;
      }
    }
    if (c.gripOn && c.grip <= 0) {
      c.air = { p: r.p, v: add(mul(r.dir, 40), v3(0, -60, 0)), t: 0, from: { ...r.from }, ignore: 0.9, slip: true };
      c.reach = null;
      c.grip = 1;
    }
    return;
  }
  // released without contact: pull the head back in along its own trail
  const r = c.reach!;
  const back = rc.speed * 1.4 * dt;
  r.len = Math.max(0, r.len - back);
  c.D -= back;
  while (c.trail.length > 2 && c.trail[c.trail.length - 1].D > c.D) c.trail.pop();
  if (c.gripOn) c.grip = bodyOnTop(world, c) ? Math.min(1, c.grip + 0.5 * dt) : Math.max(0, c.grip - 0.32 * dt); // same rule as stretching out
  if (r.len <= 0) {
    c.reach = null;
    c.head = { ...r.from };
    c.D = Math.max(c.D, 0);
    const b = world.branches.get(c.head.b)!;
    pushTrail(c, { D: c.D, p: surfacePoint(b, c.head.s, c.head.th).p, surf: { ...c.head } });
  } else {
    r.p = bodyPoint(c, 0).p;
  }
}

// --- spider silk: let yourself down on a rope and swing (key X) --------------------------------

/** The rope's first length (px), the swing push of A/D (px/s^2), facing turn rate (rad/s), pendulum damping (1/s), reel-up factor, and the length at which the spider climbs back. */
const ROPE_START = 10;
const SWING_SIDE = 260;
const SWING_TURN = 1.6;
const SWING_DAMP = 0.5;
const REEL_UP = 1.3;
const CLIMB_BACK_LEN = 6;
/** The rope never lets the spider below this far over the ground. */
const GROUND_CLEARANCE = 10;
const DANGLE_STEP = 1 / 120;

/** The rope the renderer draws while the spider dangles: from its anchor on the branch to the spider (null otherwise). */
export function silkPoints(c: Creature): { anchor: V3; p: V3 } | null {
  return c.silk ? { anchor: c.silk.anchor, p: c.silk.p } : null;
}

/** Body axes while dangling: forward = the facing (horizontal), up = world up. Level axes when not dangling. */
export function dangleBasis(c: Creature): { fwd: V3; up: V3 } {
  const d = c.silk;
  return { fwd: d ? v3(Math.cos(d.yaw), 0, Math.sin(d.yaw)) : v3(1, 0, 0), up: v3(0, 1, 0) };
}

/** Longest rope allowed from this anchor: the species' maxLen, and never so long that the hanging spider is within 10 px of the ground. */
const ropeMax = (world: World, d: Dangle, maxLen: number): number =>
  Math.max(CLIMB_BACK_LEN + 2, Math.min(maxLen, d.anchor.y - ((world.groundY ?? -2500) + GROUND_CLEARANCE)));

/** X on a surface: drop. The head leaves the surface at its spot (the thread's anchor) and hangs there as a pendulum. */
function startDangle(world: World, c: Creature): void {
  const b = world.branches.get(c.head.b)!;
  const sp = surfacePoint(b, c.head.s, c.head.th);
  const fwd = headingVector(world, c);
  let h = v3(fwd.x, 0, fwd.z);
  if (len(h) < 0.2) h = v3(sp.n.x, 0, sp.n.z);
  const yaw = len(h) > 1e-3 ? Math.atan2(h.z, h.x) : 0;
  let v = v3();
  if (sp.n.y > -0.2) {
    // not hanging under the branch: a little push away from it sideways so the spider slides over the edge as the rope is let out
    let side = v3(sp.n.x, 0, sp.n.z);
    if (len(side) < 0.2) side = v3(sp.f.b.x, 0, sp.f.b.z);
    if (len(side) < 0.2) side = v3(-Math.sin(yaw), 0, Math.cos(yaw));
    v = mul(norm(side), 45);
  }
  const d: Dangle = { anchor: sp.p, ref: { ...c.head }, len: ROPE_START, p: add(sp.p, mul(sp.n, ROPE_START)), v, yaw, t: 0, from: { ...c.head }, clear: false };
  d.len = Math.min(d.len, ropeMax(world, d, c.animal.silk!.maxLen));
  keepOffGround(world, d);
  c.silk = d;
  c.aim = null;
  c.reach = null;
  c.speedNow = 0;
  c.feet.forEach((f) => { f.t = -1; });
  c.D += dist(d.p, sp.p);
  pushTrail(c, { D: c.D, p: d.p, surf: null });
}

/** The thread between the anchor and where the spider ended up (a free end where it let go, a surface where it landed). */
function spin(world: World, d: Dangle, end: { kind: "free"; dx: number; dy: number; dz: number } | { kind: "surface"; ref: SurfacePos }, id = newSilkId()): string {
  addSilk(world, { id, ref: { ...d.ref }, end });
  return id;
}

/** Is the world point inside (or within 2 px of) the bark of branch `id`? */
function insideBark(world: World, id: string, p: V3): boolean {
  const b = world.branches.get(id);
  if (!b) return false;
  const n = nearestOnBranch(b, p);
  return n.dist < radiusAt(b, n.s) + 2;
}

/** X again: leave the rope with the current velocity (an ordinary fall) and freeze the thread as it hangs. */
function letGo(world: World, c: Creature): void {
  const d = c.silk!;
  const id = spin(world, d, { kind: "free", dx: d.p.x - d.anchor.x, dy: d.p.y - d.anchor.y, dz: d.p.z - d.anchor.z });
  c.silk = null;
  c.air = { p: d.p, v: d.v, t: 0, from: { ...d.from }, ignore: d.clear || !insideBark(world, d.from.b, d.p) ? 0 : 0.3, slip: false, skip: id };
}

/**
 * Cut a thread: the rope you hang on (no thread is kept: you fall) or the thread you are standing on (it is gone from the world and from
 * the store: you fall too, never fatally: the usual recovery puts you on a branch below). Null when there is nothing to cut.
 */
export function cutThread(world: World, c: Creature): "rope" | "thread" | null {
  if (c.silk) {
    const d = c.silk;
    c.silk = null;
    c.air = { p: d.p, v: d.v, t: 0, from: { ...d.from }, ignore: d.clear || !insideBark(world, d.from.b, d.p) ? 0 : 0.3, slip: false };
    return "rope";
  }
  const b = world.branches.get(c.head.b);
  if (!b || !b.silk || c.air || c.flight || c.reach) return null;
  const id = b.id;
  const rec = SILKS.find((r) => r.id === id);
  const anchor: SurfacePos = rec && world.branches.has(rec.ref.b) ? { ...rec.ref } : world.branches.has(b.parent ?? "") ? { b: b.parent as string, s: b.attachS ?? 0, th: 0 } : { ...c.head };
  const sp = surfacePoint(b, c.head.s, c.head.th);
  const fix = (pos: SurfacePos): SurfacePos => (pos.b === id ? { ...anchor } : pos);
  c.trail = c.trail.map((t) => (t.surf?.b === id ? { ...t, surf: null } : t));
  c.feet.forEach((f) => { f.at = fix(f.at); f.from = fix(f.from); f.to = fix(f.to); f.t = -1; });
  removeSilk(world, id);
  c.head = fix(c.head);
  c.air = { p: sp.p, v: v3(0, -30, 0), t: 0, from: { ...anchor }, ignore: 0.4, slip: true };
  c.speedNow = 0;
  return "thread";
}

/** Reeled all the way up: back on the anchor surface, no thread kept. */
function climbBack(world: World, c: Creature): void {
  const d = c.silk!;
  c.silk = null;
  c.head = world.branches.has(d.ref.b) ? { ...d.ref } : { ...d.from };
  c.speedNow = 0;
  c.grip = 1;
  c.trail = [];
  prefillTrail(world, c);
  settleFeet(world, c);
}

/** Touched a branch while hanging: land there; the rope becomes a bridge between the anchor and the landing spot. */
function landOnRope(world: World, c: Creature, b: Branch, s: number): void {
  const d = c.silk!;
  land(world, c, b, s, d.p, d.v);
  spin(world, d, { kind: "surface", ref: { ...c.head } });
}

function stepDangle(world: World, c: Creature, input: Input, dt: number): void {
  const d = c.silk!;
  const sp = c.animal.silk!;
  if (input.climb) {
    letGo(world, c); // Shift = let go
    return;
  }
  d.t += dt;
  const turn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  // the mouse camera turns the facing (W / S then swing along where you look); in every other camera mode the facing stays as it was at the drop
  const look = input.aimDir;
  if (look && Math.hypot(look.x, look.z) > 1e-3) d.yaw = wrapAngle(d.yaw + clamp(wrapAngle(Math.atan2(look.z, look.x) - d.yaw), -SWING_TURN * 2.5 * dt, SWING_TURN * 2.5 * dt));
  // X held lets the rope out (a long rope goes faster), Space held reels it in (faster still); reeled all the way up = climb back onto the anchor
  const rate = sp.reel * (1 + Math.min(3, d.len / 300));
  d.len += ((input.drop ? 1 : 0) - (input.reach ? REEL_UP : 0)) * rate * dt;
  d.len = Math.min(d.len, ropeMax(world, d, sp.maxLen));
  if (d.len <= CLIMB_BACK_LEN) {
    climbBack(world, c);
    return;
  }
  const n = Math.max(1, Math.ceil(dt / DANGLE_STEP - 1e-9));
  for (let i = 0; i < n && c.silk; i++) dangleSub(world, c, input, turn, dt / n);
  const d2 = c.silk;
  if (!d2) return; // landed
  const last = c.trail[c.trail.length - 1];
  const moved = dist(d2.p, last.p);
  if (moved >= 1) {
    c.D += moved;
    pushTrail(c, { D: c.D, p: d2.p, surf: null });
  }
}

function dangleSub(world: World, c: Creature, input: Input, turn: number, h: number): void {
  const d = c.silk!;
  const sp = c.animal.silk!;
  // forces: gravity; A/D swing sideways (perpendicular to the facing), W / S swing forward / back along it
  const fwd = v3(Math.cos(d.yaw), 0, Math.sin(d.yaw));
  const right = v3(-fwd.z, 0, fwd.x);
  let a = v3(0, -GRAVITY, 0);
  if (turn !== 0) a = add(a, mul(right, turn * SWING_SIDE));
  const along = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  if (along !== 0) a = add(a, mul(fwd, along * Math.max(SWING_SIDE, sp.pump)));
  d.v = mul(add(d.v, mul(a, h)), Math.exp(-SWING_DAMP * h));
  const sp2 = len(d.v);
  if (sp2 > 1500) d.v = mul(d.v, 1500 / sp2);
  d.p = add(d.p, mul(d.v, h));
  // the rope: never longer than `len`, and nothing pulls outward along it
  const rel = sub(d.p, d.anchor);
  const rl = len(rel);
  if (rl > d.len) {
    const nr = mul(rel, 1 / rl);
    d.p = add(d.anchor, mul(nr, d.len));
    const vr = dotV(d.v, nr);
    if (vr > 0) d.v = sub(d.v, mul(nr, vr));
  }
  // branches (threads don't count). The origin only lands it again once it has swung clear of it (never within 0.4 s); until then it just pushes out.
  const margin = flightMargin(c.animal);
  for (const b of world.branches.values()) {
    if (b.silk) continue;
    const nr = nearestOnBranch(b, d.p);
    const r = radiusAt(b, nr.s);
    const origin = b.id === d.from.b;
    if (origin && !d.clear && d.t > 0.4 && nr.dist > r + margin + 10) d.clear = true;
    if (nr.dist >= r + margin) continue;
    if ((origin && !d.clear) || d.t < 0.12) {
      const fr = frameAt(b, nr.s);
      const off = sub(d.p, fr.p);
      const nrm = len(off) > 1e-6 ? mul(off, 1 / len(off)) : fr.u;
      d.p = add(fr.p, mul(nrm, r + margin + 0.01));
      const vn = dotV(d.v, nrm);
      if (vn < 0) d.v = sub(d.v, mul(nrm, vn));
      continue;
    }
    landOnRope(world, c, b, nr.s);
    return;
  }
  keepOffGround(world, d);
}

/** The hanging spider never goes below ground + 10 px (the rope length is limited too: `ropeMax`). */
function keepOffGround(world: World, d: Dangle): void {
  const floor = (world.groundY ?? -2500) + GROUND_CLEARANCE;
  if (d.p.y < floor) {
    d.p = { ...d.p, y: floor };
    if (d.v.y < 0) d.v = { ...d.v, y: 0 };
  }
}

export { dist, norm };
