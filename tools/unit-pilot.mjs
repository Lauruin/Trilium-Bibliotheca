// Unit checks for mouse interaction: tree/pick.ts (ray vs branches and leaves) and tree/autopilot.ts (click-to-walk: route + the key presses
// that follow it). Run by tools/unit-test.mjs (it loads every tools/unit-<name>.mjs).
export default async ({ bundle, assert }) => {
  const PK = await bundle("src/tree/pick.ts", "pick-unit.mjs");
  const AP = await bundle("src/tree/autopilot.ts", "pilot-unit.mjs");
  const S = await bundle("src/tree/sim3.ts", "sim-pilot.mjs");
  const W = await bundle("src/tree/world3.ts", "world-pilot.mjs");
  const L = await bundle("src/tree/layout.ts", "layout-pilot.mjs");
  const LI = await bundle("src/tree/leafindex.ts", "leafindex-pilot.mjs");
  const DT = 1 / 60;
  const V = (x, y, z) => W.v3(x, y, z);
  const A = (id) => S.ANIMALS.find((a) => a.id === id);
  const fin = (...xs) => xs.every(Number.isFinite);

  // 1. ray vs segment
  {
    const hit = PK.rayToSegment(V(0, 10, 0), V(0, -1, 0), V(-5, 0, 0), V(5, 0, 0));
    assert.ok(Math.abs(hit.t - 10) < 1e-9 && Math.abs(hit.u - 0.5) < 1e-9 && hit.dist < 1e-9, "straight down onto the middle of a segment");
    const off = PK.rayToSegment(V(0, 10, 3), V(0, -1, 0), V(-5, 0, 0), V(5, 0, 0));
    assert.ok(Math.abs(off.dist - 3) < 1e-9, "3 units beside it");
    const past = PK.rayToSegment(V(20, 10, 0), V(0, -1, 0), V(-5, 0, 0), V(5, 0, 0));
    assert.ok(past.u === 1 && Math.abs(past.dist - 15) < 1e-9, "beyond the end: clamped to the end point");
    const behind = PK.rayToSegment(V(0, -10, 0), V(0, -1, 0), V(-5, 0, 0), V(5, 0, 0));
    assert.ok(behind.t === 0 && Math.abs(behind.dist - 10) < 1e-9, "a segment behind the origin: t clamps to 0");
    const par = PK.rayToSegment(V(0, 5, 0), V(1, 0, 0), V(0, 0, 0), V(10, 0, 0));
    assert.ok(fin(par.t, par.u, par.dist) && Math.abs(par.dist - 5) < 1e-9, "a parallel ray is finite");
    const deg = PK.rayToSegment(V(0, 5, 0), V(0, -1, 0), V(1, 0, 0), V(1, 0, 0));
    assert.ok(fin(deg.t, deg.u, deg.dist), "a zero-length segment is finite");
  }

  // 2. picking branches: a horizontal trunk (r 20) along +x, a thin twig crossing above it
  const world = { branches: new Map(), groundY: -1000 };
  W.addBranch(world, W.makeBranch("trunk", Array.from({ length: 21 }, (_, i) => V(i * 100, 0, 0)), 20));
  W.addBranch(world, W.makeBranch("twig", [V(500, 60, -200), V(500, 60, 200)], 3));
  {
    const top = PK.pickBranch(world, V(1000, 500, 0), V(0, -1, 0));
    assert.ok(top && top.b === "trunk" && Math.abs(top.s - 1000) < 1 && Math.abs(top.th) < 1e-6 && Math.abs(top.t - 480) < 1e-6, `from above: the top of the trunk (${JSON.stringify(top)})`);
    const side = PK.pickBranch(world, V(1000, 0, 500), V(0, 0, -1));
    assert.ok(side && side.b === "trunk" && Math.abs(Math.abs(side.th) - Math.PI / 2) < 1e-6, "from the side: th = +-pi/2");
    const under = PK.pickBranch(world, V(1000, -500, 0), V(0, 1, 0));
    assert.ok(under && Math.abs(Math.abs(under.th) - Math.PI) < 1e-6, "from below: the underside");
    assert.equal(PK.pickBranch(world, V(1000, 500, 300), V(0, -1, 0)), null, "a miss");
    assert.equal(PK.pickBranch(world, V(-500, 500, 0), V(0, 1, 0)), null, "pointing away");
    const t2 = PK.pickBranch(world, V(500, 500, 0), V(0, -1, 0));
    assert.equal(t2.b, "twig", "the twig is in front of the trunk when seen from above: the nearest surface wins");
    // a thin twig far away is still hittable (the tolerance grows with distance), a hair-width miss up close is not
    const far = PK.pickBranch(world, V(500, 6060, 0), V(0, -1, 0));
    assert.ok(far && far.b === "twig");
    const slightlyOff = PK.pickBranch(world, V(508, 6060, 0), V(0, -1, 0)); // 8 units beside a 3 radius twig at 6000: inside the ~36 unit padding
    assert.ok(slightlyOff && slightlyOff.b === "twig", "far twigs get a generous pick radius");
    assert.equal(PK.pickBranch(world, V(540, 160, 0), V(0, -1, 0))?.b, "trunk", "close up the twig has no extra reach: this ray goes on to the trunk");
    // silk threads are not pickable
    const w2 = { branches: new Map(world.branches), groundY: -1000 };
    const thread = W.makeBranch("silk:1", [V(1500, 100, 300), V(1500, -100, 300)], 3);
    thread.silk = true;
    w2.branches.set(thread.id, thread);
    assert.equal(PK.pickBranch(w2, V(1500, 500, 300), V(0, -1, 0)), null, "silk threads are not pickable");
    // a tapered branch: the radius at the hit is the radius there
    const w3 = { branches: new Map(), groundY: -1000 };
    W.addBranch(w3, W.makeBranch("cone", [V(0, 0, 0), V(1000, 0, 0)], 40, null, undefined, 4));
    const near0 = PK.pickBranch(w3, V(10, 0, 200), V(0, 0, -1));
    const near1 = PK.pickBranch(w3, V(990, 0, 200), V(0, 0, -1));
    assert.ok(near0.t < 200 - 35 && near1.t > 200 - 8, `the cone is fat at the base (t ${near0.t.toFixed(1)}) and thin at the tip (t ${near1.t.toFixed(1)})`);
  }

  // 3. picking leaves, and a leaf beats the branch it hangs on
  {
    const mk = (id, x, y, z, size = 1) => ({ id, branchId: "trunk", s: x, th: 0, color: "#fff", title: id, kind: "broad", size, type: "text" });
    const idx = { leaves: [mk("near", 1000, 30, 0), mk("far", 1400, 30, 0), mk("big", 600, 30, 0, 2)], x: Float64Array.from([1000, 1400, 600]), y: Float64Array.from([30, 30, 30]), z: Float64Array.from([0, 0, 0]) };
    const o = V(1000, 500, 5), d = V(0, -1, 0);
    const lf = PK.pickLeaf(idx, o, d);
    assert.ok(lf && lf.leaf.id === "near", "the leaf under the pointer");
    assert.equal(PK.pickLeaf(idx, V(1000, 500, 200), d), null, "a ray that passes 200 units from every leaf");
    const both = PK.pickAt(world, idx, o, d);
    assert.equal(both.kind, "leaf", "a leaf on the trunk wins over the trunk");
    const wide = PK.pickLeaf(idx, V(600, 500, 22), d);
    assert.equal(wide?.leaf.id, "big", "a big leaf (a long note) is easier to hit");
    assert.equal(PK.pickLeaf(idx, V(600, 500, 22 + 40), d), null);
    const branchOnly = PK.pickAt(world, null, V(1700, 500, 0), d);
    assert.equal(branchOnly.kind, "branch");
    assert.equal(PK.pickAt(world, idx, V(9000, 500, 0), d), null, "nothing there");
    // a leaf far BEHIND the trunk (the trunk is in front) does not win
    const behind = { leaves: [mk("hidden", 1000, -300, 0)], x: Float64Array.from([1000]), y: Float64Array.from([-300]), z: Float64Array.from([0]) };
    assert.equal(PK.pickAt(world, behind, o, d).kind, "branch", "a leaf behind the trunk is not picked through it");
  }

  // 4. round trip on a real layout: aim at a surface point from outside along its normal and get the same branch back (when nothing is in front)
  const mkTree = (spec) => {
    const notes = {}, edges = [];
    const add = (n, parent) => {
      notes[n.id] = { noteId: n.id, title: n.id, type: "text", labels: {}, hasChildren: !!(n.kids && n.kids.length) };
      if (parent) edges.push({ parentNoteId: parent, noteId: n.id, notePosition: 0 });
      (n.kids ?? []).forEach((k) => add(k, n.id));
    };
    add({ id: "root", kids: spec }, null);
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const nn = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: `${tag}n${i}` }));
  const spec = (n) => Array.from({ length: n }, (_, i) => ({ id: "F" + i, kids: [...nn("x" + i, 6), { id: "G" + i, kids: [...nn("g" + i, 3), { id: "H" + i, kids: nn("h" + i, 2) }] }] }));
  const forest = L.layoutTree(mkTree(spec(4)), { mode: "forest" });
  const hub = L.layoutTree(mkTree(spec(4)), { mode: "hub" });
  const demo = W.makeDemoWorld();
  {
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let good = 0, total = 0;
    for (const lay of [forest, hub]) {
      const bs = [...lay.world.branches.values()].filter((b) => !b.silk && b.total > 80 && b.r > 5);
      for (let k = 0; k < 150; k++) {
        const b = bs[Math.floor(rnd() * bs.length)];
        const s = b.total * (0.1 + 0.8 * rnd());
        const th = (rnd() - 0.5) * Math.PI * 1.6; // the upper half: seen from outside
        const sp = W.surfacePoint(b, s, th);
        const o = W.add(sp.p, W.mul(sp.n, 150));
        const h = PK.pickBranch(lay.world, o, W.mul(sp.n, -1));
        total++;
        if (h && fin(h.s, h.th, h.t) && (h.b === b.id ? Math.abs(h.s - s) < 12 || Math.abs(h.s - s) < b.r * 1.5 : true)) good++;
        if (h) assert.ok(h.t >= 0 && h.t <= 160, "the hit is on the ray");
      }
    }
    assert.ok(good / total >= 0.97, `aiming at a surface point gives that branch back (${good}/${total})`);
  }
  // perf of one pick on the biggest realistic world
  {
    const big = L.layoutTree(mkTree(Array.from({ length: 20 }, (_, i) => ({ id: "F" + i, kids: Array.from({ length: 19 }, (_, j) => ({ id: "x" + i + "_" + j })) }))), { mode: "forest" });
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) PK.pickBranch(big.world, V(0, 800, 3000), V(0, -0.2, -1));
    assert.ok((performance.now() - t0) / 20 < 25, `a pick over ${big.world.branches.size} branches takes < 25 ms`);
  }

  // 5. routes
  {
    for (const [name, w] of [["forest", forest.world], ["hub", hub.world]]) {
      const ids = [...w.branches.keys()];
      for (let i = 0; i < ids.length; i += 3) {
        for (let j = 0; j < ids.length; j += 5) {
          const r = AP.routeBetween(w, ids[i], ids[j]);
          assert.ok(r, `${name}: ${ids[i]} -> ${ids[j]} has a route`);
          assert.equal(r[0], ids[i]); assert.equal(r[r.length - 1], ids[j]);
          for (let k = 1; k < r.length; k++) {
            const a = w.branches.get(r[k - 1]), b = w.branches.get(r[k]);
            assert.ok(a.parent === b.id || b.parent === a.id, `${name}: consecutive route hops are parent / child (${r[k - 1]} ${r[k]})`);
          }
          assert.equal(new Set(r).size, r.length, "no branch twice");
        }
      }
    }
    assert.deepEqual(AP.routeBetween(forest.world, "F0", "F0"), ["F0"]);
    assert.equal(AP.routeBetween(forest.world, "F0", "nope"), null);
    assert.equal(AP.routeBetween(forest.world, "nope", "F0"), null);
    // disconnected branches (the demo's floating twigs) have no walking route
    assert.equal(AP.routeBetween(demo, "trunk", "twigA"), null, "no route to a floating twig");
    // silk threads are never routed over
    const wsilk = { branches: new Map(forest.world.branches), groundY: forest.world.groundY };
    const tr = W.makeBranch("silk:9", [V(0, 100, 0), V(0, 0, 0)], 2.5, "F0", 100);
    tr.silk = true;
    wsilk.branches.set(tr.id, tr);
    assert.equal(AP.routeBetween(wsilk, "F0", "silk:9"), null);
    // shortest: the route between two trunks goes through their roots and the stump only
    const r = AP.routeBetween(forest.world, "F0", "F2");
    assert.deepEqual(r, ["F0", "root:F0", "root", "root:F2", "F2"]);
  }

  // 5b. the closest-approach angle of a side branch's base zone matches the simulation's own zone test
  {
    const w = forest.world;
    let checked = 0;
    for (const b of w.branches.values()) {
      for (const id of b.side) {
        const ch = w.branches.get(id);
        if (ch.silk || b.total < 100) continue;
        const attach = ch.attachS;
        const th = AP.entryTheta(b, ch, attach);
        assert.ok(fin(th) && Math.abs(th) <= Math.PI + 1e-9, "a finite angle");
        // the child's centreline is nearer to the bark at this angle than at the opposite side
        const d1 = W.nearestOnBranch(ch, W.surfacePoint(b, attach, th).p).dist;
        const d2 = W.nearestOnBranch(ch, W.surfacePoint(b, attach, th + Math.PI).p).dist;
        assert.ok(d1 <= d2 + 1e-6, `${b.id} -> ${ch.id}: the entry angle is the near side`);
        checked++;
      }
    }
    assert.ok(checked >= 6, `side branches checked (${checked})`);
  }

  // 6. the autopilot reaches goals: random start / goal pairs, every walking animal, forest + hub
  const trials = (world, animal, n, seed0) => {
    let seed = seed0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ids = [...world.branches.values()].filter((b) => !b.silk && b.total > 60).map((b) => b.id);
    let ok = 0, tsum = 0;
    const fails = [];
    for (let k = 0; k < n; k++) {
      const sb = world.branches.get(ids[Math.floor(rnd() * ids.length)]);
      const gb = world.branches.get(ids[Math.floor(rnd() * ids.length)]);
      const c = S.spawn(world, A(animal), sb.id, sb.total * (0.1 + 0.8 * rnd()), "guided");
      c.head.th = (rnd() - 0.5) * 2;
      const goal = { b: gb.id, s: gb.total * (0.1 + 0.8 * rnd()), th: (rnd() - 0.5) * 2.4 };
      const pil = new AP.Autopilot(goal);
      for (let i = 0; i < 60 * 120 && pil.status === "walking"; i++) {
        const inp = pil.step(world, c, DT);
        if (pil.status !== "walking") break; // judge the animal at the moment of arrival (it would coast a few px, maybe into a side branch's zone)
        S.step(world, c, inp, DT);
        if (i % 600 === 0) assert.ok(fin(c.head.s, c.head.th, c.phi, c.omega) && !!world.branches.get(c.head.b), `${animal}: finite state while walking`);
      }
      if (pil.status === "arrived") {
        ok++;
        tsum += pil.elapsed;
        // really there: on the goal branch, within the arrival tolerance (the cat's cling limit clamps the angle)
        assert.equal(c.head.b, goal.b, `${animal}: arrived on the goal branch`);
        assert.ok(Math.abs(c.head.s - goal.s) < AP.ARRIVE_S + 6, `${animal}: arrived at the goal's arc length (${(c.head.s - goal.s).toFixed(1)})`);
      } else fails.push(`${sb.id}->${gb.id}:${pil.status}:${pil.reason}@${c.head.b}/${c.head.s.toFixed(0)}/${c.head.th.toFixed(2)}`);
    }
    return { ok, n, avg: tsum / Math.max(1, ok), fails };
  };
  const rates = {};
  for (const [wname, w] of [["forest", forest.world], ["hub", hub.world]]) {
    for (const id of ["lizard", "snake", "ant", "spider", "jumper", "squirrel"]) {
      const r = trials(w, id, 14, 17 + id.length);
      rates[`${wname}/${id}`] = `${r.ok}/${r.n}`; if (r.fails.length && process.env.PILOT_FAILS) console.log("  pilot fails", wname, id, r.fails.join(" "));
      assert.ok(r.ok / r.n >= 0.85, `${wname}/${id}: click-to-walk arrives in at least 85% of random trials (${r.ok}/${r.n}; ${r.fails.slice(0, 3).join(", ")})`);
    }
  }
  // the cat clings to the upper half of a branch: it reaches what it can reach and says so for the rest (never loops forever, never NaN)
  for (const [wname, w] of [["forest", forest.world], ["hub", hub.world]]) {
    const r = trials(w, "cat", 12, 5);
    rates[`${wname}/cat`] = `${r.ok}/${r.n}`;
    assert.ok(r.ok >= 3, `${wname}/cat: reaches the reachable goals (${r.ok}/${r.n})`);
    assert.ok(r.fails.every((f) => /failed|walking|timeout|stuck|out of reach/.test(f)), "the cat's failures are reported, not thrown");
  }

  // 7. behaviours
  {
    // a goal on the branch you stand on: just walk (W / S), no detours
    const w = forest.world;
    const c = S.spawn(w, A("lizard"), "F1", 100, "guided");
    c.head.th = 0;
    const pil = new AP.Autopilot({ b: "F1", s: 300, th: 0 });
    let steps = 0;
    for (; steps < 60 * 30 && pil.status === "walking"; steps++) S.step(w, c, pil.step(w, c, DT), DT);
    assert.equal(pil.status, "arrived");
    assert.equal(c.head.b, "F1", "stayed on the branch");
    // and back down
    const down = new AP.Autopilot({ b: "F1", s: 60, th: 0 });
    for (let i = 0; i < 60 * 30 && down.status === "walking"; i++) S.step(w, c, down.step(w, c, DT), DT);
    assert.equal(down.status, "arrived");
    // already there = arrived at once (no keys)
    const here = new AP.Autopilot({ b: "F1", s: c.head.s, th: c.head.th });
    const inp = here.step(w, c, DT);
    assert.equal(here.status, "arrived");
    assert.deepEqual(inp, S.NO_INPUT);
    // finished pilots are inert
    assert.deepEqual(here.step(w, c, DT), S.NO_INPUT);
    // unknown goal branch / missing route / thread: failed with a reason, no keys, no throw
    const bad = new AP.Autopilot({ b: "nope", s: 0, th: 0 });
    assert.deepEqual(bad.step(w, c, DT), S.NO_INPUT);
    assert.equal(bad.status, "failed");
    const nr = new AP.Autopilot({ b: "twigA", s: 10, th: 0 });
    const dc = S.spawn(demo, A("lizard"), "trunk", 100, "guided");
    nr.step(demo, dc, DT);
    assert.ok(nr.status === "failed" && nr.reason === "no route", `no route: ${nr.reason}`);
    // timeout
    const slow = new AP.Autopilot({ b: "F1", s: 800, th: 0 }, 0.5);
    const c3 = S.spawn(w, A("lizard"), "F1", 100, "guided");
    for (let i = 0; i < 120; i++) S.step(w, c3, slow.step(w, c3, DT), DT);
    assert.ok(slow.status === "failed" && slow.reason === "timeout", "gives up after the timeout");
    // while flying it waits, then gives up; while airborne it waits quietly
    const fly = S.spawn(w, A("bee"), "F1", 100, "guided");
    S.step(w, fly, { ...S.NO_INPUT, leap: true }, DT);
    const fp = new AP.Autopilot({ b: "F2", s: 100, th: 0 });
    assert.ok(fly.flight);
    assert.deepEqual(fp.step(w, fly, DT), S.NO_INPUT);
    assert.equal(fp.status, "walking", "a flier waits a moment");
    for (let i = 0; i < 60 * 5; i++) fp.step(w, fly, DT);
    assert.ok(fp.status === "failed" && fp.reason === "not walking");
    // a user key press cancels it from the outside (the scene's job): the pilot itself keeps no hidden state that would fight the keys
    const k1 = new AP.Autopilot({ b: "F1", s: 700, th: 0 });
    const c4 = S.spawn(w, A("lizard"), "F1", 100, "guided");
    for (let i = 0; i < 30; i++) S.step(w, c4, k1.step(w, c4, DT), DT);
    for (let i = 0; i < 30; i++) S.step(w, c4, { ...S.NO_INPUT, back: true }, DT); // the player takes over
    assert.ok(c4.head.s < 700 && fin(c4.head.s));
  }

  // 8. into a side branch and a ground root (Shift for roots), on a hand-made junction: a trunk with an upward side branch
  {
    const w = { branches: new Map(), groundY: -9000 };
    W.addBranch(w, W.makeBranch("b", Array.from({ length: 81 }, (_, i) => V(i * 50, 0, 0)), 20));
    W.addBranch(w, W.makeBranch("side", W.smoothPath([V(1000, 0, 0), V(1000, 200, 0), V(1000, 600, 0)]), 12, "b", 1000));
    for (const id of ["lizard", "snake", "ant", "spider", "jumper"]) {
      for (const th0 of [0, 1.2, -1.2, 2.8]) {
        const c = S.spawn(w, A(id), "b", 300, "guided");
        c.head.th = th0;
        c.gripOn = false;
        const pil = new AP.Autopilot({ b: "side", s: 250, th: 0.4 });
        for (let i = 0; i < 60 * 90 && pil.status === "walking"; i++) S.step(w, c, pil.step(w, c, DT), DT);
        assert.equal(pil.status, "arrived", `${id} from th ${th0}: walks into the side branch and up it (${pil.reason}, on ${c.head.b})`);
        assert.equal(c.head.b, "side");
      }
    }
  }
  // roots: from one tree to another across the stump: the star junction (walk DOWN into the root's zone; Shift would stay on the stump)
  {
    const w = forest.world;
    for (const id of ["lizard", "snake", "spider", "ant"]) {
      const c = S.spawn(w, A(id), "F0", 200, "guided");
      c.gripOn = false;
      const pil = new AP.Autopilot({ b: "F2", s: 300, th: 0 });
      let shiftBack = false, walkedDown = false;
      for (let i = 0; i < 60 * 120 && pil.status === "walking"; i++) {
        const inp = pil.step(w, c, DT);
        const before = c.head.b;
        S.step(w, c, inp, DT);
        if (before === "root" && inp.back) walkedDown = true;
        if (before === "root" && c.head.b.startsWith("root:") && inp.climb) shiftBack = true; // (Shift while lining up low on the stump is fine; entering with it would stay)
      }
      assert.equal(pil.status, "arrived", `${id}: from tree F0 to tree F2 across the stump (${pil.reason})`);
      assert.ok(walkedDown && !shiftBack, `${id}: the pilot walked down into the root without Shift (Shift = stay)`);
    }
  }

  assert.ok(Object.keys(rates).length >= 13);
  console.log("  pilot success:", JSON.stringify(rates));
};
