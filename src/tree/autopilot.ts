/**
 * tree/autopilot.ts — click-to-walk. An `Autopilot` turns a goal (a spot on a branch) into the SAME key presses a player would
 * make (W / S / A / D / Shift), so every rule of the guided movement (grip, turning, junctions, auto-climb) applies unchanged
 * (PURE: no three.js, no DOM, unit-tested in tools/unit-pilot.mjs). It only works in GUIDED movement (W = tip-ward, S = base-ward,
 * A/D turn); the scene switches the animal to it for the duration of a walk.
 *
 * The route is a breadth-first search over the branch tree (parent / continuation / side links; silk threads are not routed over).
 * Per frame it looks at the next hop:
 *   - to the parent: S (base-ward; the step off the branch's start lands on the parent),
 *   - to a continuation child at the end: W (steering left / right when the end forks, so the child it wants is the one it heads for),
 *   - to a side branch: walk up to just below where it leaves, turn round the bark to the side it grows from (A / D), then walk W into
 *     its base zone (an ordinary branch is entered by itself; a thread needs Shift, which the pilot holds); a ground root at the
 *     stump's foot is entered walking DOWN (S): the pilot lines up above the roots' zones, turns to that root's side and walks S,
 *   - on the goal branch: turn round the bark to the goal's side first, then walk to its arc length.
 * While walking W past ordinary side branches it holds Shift ("stay on this branch") so it is not pulled into one it does not want.
 */

import { NO_INPUT, starTop, type Creature, type Input } from "./sim3";
import { dist, entryTheta, radiusAt, surfacePoint, wrapAngle, type Branch, type V3, type World } from "./world3";

export { entryTheta }; // (lives in world3.ts: the simulation's star junction needs it too)

export interface Goal {
  /** Branch id, arc length and angle around the branch of the spot to walk to. */
  b: string;
  s: number;
  th: number;
  /** A leaf to read when the walk ends (the scene opens it). */
  leafId?: string;
}

export type PilotStatus = "walking" | "arrived" | "failed";

/** Close enough along the branch (px) and round the bark (px of arc) to count as arrived (a leaf can be read from 70 px). */
export const ARRIVE_S = 14;
export const ARRIVE_ARC = 26;

/** The branch ids to walk through from `from` to `to` (both included), or null when no walkable route exists. Silk threads are never used. */
export function routeBetween(world: World, from: string, to: string): string[] | null {
  const a = world.branches.get(from);
  const b = world.branches.get(to);
  if (!a || !b || a.silk || b.silk) return null;
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, ""]]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const br = world.branches.get(id);
    if (!br) continue;
    const nb: string[] = [];
    if (br.parent) nb.push(br.parent);
    nb.push(...br.next, ...br.side);
    for (const n of nb) {
      const nbr = world.branches.get(n);
      if (!nbr || nbr.silk || prev.has(n)) continue;
      prev.set(n, id);
      if (n === to) {
        const path = [n];
        for (let p = id; p !== ""; p = prev.get(p) ?? "") path.push(p);
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

export class Autopilot {
  status: PilotStatus = "walking";
  /** Simulated seconds since the walk began. */
  elapsed = 0;
  /** Why it stopped, for the HUD / tests. */
  reason = "";
  private route: string[] | null = null;
  private waited = 0;
  /**
   * Hysteresis for lining up: "rotate" = turn round the bark until it is close (< 0.15 rad), then "enter" = commit to walking in and only
   * line up again when it has drifted far (> 0.8 rad). Without it, the U-turn swing that W triggers when the animal faces base-ward nudges
   * it out of tolerance and the pilot turns, swings, turns, ... forever.
   */
  private phase: "rotate" | "enter" = "rotate";
  private phaseFor = "";
  private turn: "left" | "right" = "right";
  /** Watchdog: where the animal was when it last moved a real distance, and how long ago (simulated seconds). */
  private entry = new Map<string, number>();
  private anchor: V3 | null = null;
  private anchorAge = 0;

  constructor(
    readonly goal: Goal,
    /** Give up after this many simulated seconds. */
    readonly timeout = 120,
  ) {}

  private fail(reason: string): Input {
    this.status = "failed";
    this.reason = reason;
    return NO_INPUT;
  }

  /** The keys to press this frame (idle once arrived / failed). */
  step(world: World, c: Creature, dt: number): Input {
    if (this.status !== "walking") return NO_INPUT;
    this.elapsed += dt;
    if (this.elapsed > this.timeout) return this.fail("timeout");
    if (c.flight || c.reach || c.silk) {
      // cannot walk while flying / reaching / hanging: wait a moment, then give up
      this.waited += dt;
      return this.waited > 4 ? this.fail("not walking") : NO_INPUT;
    }
    this.waited = 0;
    if (c.air) return NO_INPUT; // a fall or a leap: wait until it lands
    const goal = world.branches.get(this.goal.b);
    const cur = world.branches.get(c.head.b);
    if (!goal || !cur) return this.fail("branch gone");
    if (cur.silk) return this.fail("on a thread");
    // watchdog: if the animal has not moved 30 px in 8 simulated seconds it is stuck (a dither, an unreachable side of the bark)
    const here = surfacePoint(cur, c.head.s, c.head.th).p;
    if (!this.anchor || dist(here, this.anchor) > 30) {
      this.anchor = here;
      this.anchorAge = 0;
    } else if ((this.anchorAge += dt) > 8) return this.fail("stuck");
    if (cur.id === goal.id) return this.finalApproach(world, c, cur);

    let idx = this.route ? this.route.indexOf(cur.id) : -1;
    if (idx < 0) {
      this.route = routeBetween(world, cur.id, goal.id);
      if (!this.route) return this.fail("no route");
      idx = 0;
    }
    const nextId = this.route![idx + 1];
    const next = world.branches.get(nextId);
    if (!next) return this.fail("route broken");
    const s = c.head.s;

    if (cur.parent === nextId) return { ...NO_INPUT, back: true };

    if (cur.next.includes(nextId)) {
      // one continuation: just walk to the end; several (a fork, the hub): turn to the side of the bark the wanted one leaves from first
      if (cur.next.length > 1) return this.sideApproach(world, c, cur, next);
      return { ...NO_INPUT, forward: true, climb: this.staying(world, cur, s, null) };
    }

    if (cur.side.includes(nextId)) return this.sideApproach(world, c, cur, next);
    return this.fail("route inconsistent");
  }

  /** Hold Shift (= stay on this branch) while walking W if an ordinary side branch would otherwise pull us in and no root / thread zone is near. */
  private staying(world: World, cur: Branch, s: number, exclude: string | null): boolean {
    let ordinary = false;
    let special = false;
    const lo = s - 25;
    const hi = s + 170;
    for (const id of cur.side) {
      if (id === exclude) continue;
      const ch = world.branches.get(id);
      if (!ch || ch.silk) continue;
      const a = ch.attachS ?? cur.total;
      if (a < lo || a > hi) continue;
      if (ch.root) special = true;
      else ordinary = true;
    }
    return ordinary && !special;
  }

  /**
   * Walk up to just below where `child` leaves `cur` (a side branch at its `attachS`, a continuation at the branch's end), turn to the
   * side of the bark it grows from, then walk on into its base zone / through the end.
   */
  private sideApproach(world: World, c: Creature, cur: Branch, child: Branch): Input {
    const isNext = cur.next.includes(child.id);
    const attach = isNext ? cur.total : child.attachS ?? cur.total;
    const key = `${cur.id}>${child.id}@${attach.toFixed(1)}`;
    let thT = this.entry.get(key);
    if (thT === undefined) {
      thT = entryTheta(cur, child, attach); // the side of the bark the child's base zone is on
      this.entry.set(key, thT);
    }
    // The stump's ground roots form a star at its foot: walking DOWN into one's base zone takes it (no Shift). The animal lines up ABOVE
    // the zones, turns to the side of its root, then walks S.
    if (!isNext && child.root && child.parent === cur.id && !cur.root && !cur.silk) return this.rootEntry(world, c, cur, thT);
    const needShift = !isNext && (!!child.root || !!child.silk);
    // The base zone of a thin branch is only a few px tall around where it leaves, so the animal lines up BELOW it (about 70 px under it,
    // or at the bottom of the stump) and then walks up through the zone; starting inside / above the zone it first goes back down.
    const approach = Math.max(0, attach - 70);
    const s = c.head.s;
    const hop = `${cur.id}>${child.id}`;
    const entering = this.phaseFor === hop && this.phase === "enter";
    if (!isNext && ((!entering && s > approach + 25) || s > attach + 35)) {
      this.phaseFor = ""; // (too high, or it overshot while entering: line up again from below)
      return { ...NO_INPUT, back: true };
    }
    if (s < approach - 4) return { ...NO_INPUT, forward: true, climb: this.staying(world, cur, s, child.id) };
    const lim = c.animal.maxTh;
    if (lim !== undefined && Math.abs(thT) > lim + 0.15) return this.fail("that side of the bark is out of reach"); // (the cat clings only to the upper half)
    const dth = wrapAngle(thT - c.head.th);
    const turn = this.lineUp(hop, dth, 0.15, 0.8);
    // turning round the bark (A / D alone) creeps the animal tip-ward a little: while it has drifted well up, walk down at the same time
    // (facing base-ward, left and right swap: to keep turning the same way round the bark the other key is needed)
    if (turn) {
      if (s > approach + 18 && !isNext) return { ...NO_INPUT, back: true, [turn === "left" ? "right" : "left"]: true };
      return { ...NO_INPUT, [turn]: true };
    }
    return { ...NO_INPUT, forward: true, climb: needShift || (isNext && this.staying(world, cur, s, null)) };
  }

  /**
   * Stump -> one of its ground roots (the star junction: walking DOWN below the roots' top takes the root nearest the side of the bark
   * you face; Shift = stay). Climb above the zones, swing round to face DOWN there (the U-turn shifts the angle round the bark, so the
   * angle is corrected only afterwards), correct the angle with Shift held (Shift = stay: no root can be entered by accident) and then
   * walk S.
   */
  private rootEntry(world: World, c: Creature, cur: Branch, thT: number): Input {
    const top = starTop(world, cur); // the top of every root zone
    const hi = top + 34;
    const s = c.head.s;
    const facingDown = Math.abs(wrapAngle(c.phi - Math.PI)) < 1.0; // (a bent descent, back + A/D, keeps the heading within ~0.75 rad of straight down)
    if (!facingDown) {
      if (Math.abs(c.phi) < 1.8 && s < hi) return { ...NO_INPUT, forward: true, climb: true }; // up first (Shift: no ordinary branch in the way)
      return { ...NO_INPUT, back: true, climb: s < top + 6 }; // pivot (a short step down), staying on the stump if it gets low
    }
    const dth = wrapAngle(thT - c.head.th);
    if (Math.abs(dth) > 0.12) {
      // descend in a bend towards the root's side; facing base-ward, left and right swap. Low down Shift = stay keeps any root from being taken early.
      const turn = this.lineUp(`${cur.id}>star`, dth, 0.1, 0.5);
      if (turn) return { ...NO_INPUT, back: true, [turn === "left" ? "right" : "left"]: true, climb: s < top + 6 };
    }
    return { ...NO_INPUT, back: true };
  }

  /**
   * "left" / "right" while the animal should still turn round the bark (see `phase`), null once it is lined up; `key` names the hop so a
   * new hop starts afresh. The turning DIRECTION is fixed when the turn starts: a target on the opposite side of the bark (an angle of
   * about pi away) has no shortest way round, and re-choosing every frame makes the animal jitter in place.
   */
  private lineUp(key: string, dth: number, near: number, far: number, arcOf = 1): "left" | "right" | null {
    const abs = Math.abs(dth) * arcOf;
    if (this.phaseFor !== key) {
      this.phaseFor = key;
      this.phase = "rotate";
      this.turn = dth >= 0 ? "right" : "left";
    }
    if (this.phase === "enter" && abs > far) {
      this.phase = "rotate";
      this.turn = dth >= 0 ? "right" : "left";
    } else if (this.phase === "rotate" && abs < near) this.phase = "enter";
    return this.phase === "rotate" ? this.turn : null;
  }

  /** On the goal's branch: turn round the bark to its side, then walk to its arc length. */
  private finalApproach(world: World, c: Creature, cur: Branch): Input {
    const g = this.goal;
    const lim = c.animal.maxTh;
    const goalTh = lim !== undefined ? Math.min(lim, Math.max(-lim, g.th)) : g.th; // a clinging animal can only reach the part of the bark it may stand on
    const ds = g.s - c.head.s;
    const dth = wrapAngle(goalTh - c.head.th);
    const arc = Math.abs(dth) * radiusAt(cur, c.head.s);
    if (Math.abs(ds) < ARRIVE_S && arc < ARRIVE_ARC) {
      this.status = "arrived";
      return NO_INPUT;
    }
    const turn = Math.abs(ds) < 400 ? this.lineUp("goal:" + cur.id, dth, 10, 60, radiusAt(cur, c.head.s)) : null;
    if (turn) return { ...NO_INPUT, [turn]: true };
    if (Math.abs(ds) >= ARRIVE_S) {
      if (ds > 0) return { ...NO_INPUT, forward: true, climb: this.staying(world, cur, c.head.s, null) };
      return { ...NO_INPUT, back: true };
    }
    return dth > 0 ? { ...NO_INPUT, right: true } : { ...NO_INPUT, left: true };
  }
}
