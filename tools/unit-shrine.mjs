// Unit checks for the shrine (tree/shrine.ts: geometry + pads), the search wisp's maths (tree/wisp.ts) and the star junction at the
// stump's foot (sim3.ts `starRoot`: walking DOWN the stump takes the root on the side you face; Shift = stay). Run by tools/unit-test.mjs.
export default async ({ bundle, assert }) => {
  const L = await bundle("src/tree/layout.ts", "layout-shrine.mjs");
  const W = await bundle("src/tree/world3.ts", "world-shrine.mjs");
  const S = await bundle("src/tree/sim3.ts", "sim-shrine.mjs");
  const SH = await bundle("src/tree/shrine.ts", "shrine-unit.mjs");
  const PL = await bundle("src/tree/places.ts", "places-unit.mjs");
  const AP = await bundle("src/tree/autopilot.ts", "pilot-shrine.mjs");
  const WI = await bundle("src/tree/wisp.ts", "wisp-unit.mjs");
  const fin = (...xs) => xs.every(Number.isFinite);
  const A = (id) => S.ANIMALS.find((a) => a.id === id);
  const DT = 1 / 60;

  const mk = (spec) => {
    const notes = {}, edges = [];
    const add = (n, parent) => {
      notes[n.id] = { noteId: n.id, title: n.id, type: "text", labels: {}, hasChildren: !!(n.kids && n.kids.length) };
      if (parent) edges.push({ parentNoteId: parent, noteId: n.id, notePosition: 0 });
      (n.kids ?? []).forEach((k) => add(k, n.id));
    };
    add({ id: "root", kids: spec }, null);
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const forest = (n, notes = 5) => Array.from({ length: n }, (_, i) => ({ id: "F" + i, kids: Array.from({ length: notes }, (_, j) => ({ id: `x${i}_${j}` })) }));
  const trunkIdsOf = (lay) => lay.world.branches.get("root").side.filter((id) => lay.world.branches.get(id).root).map((id) => lay.world.branches.get(id).next[0]);
  const angDiff = (a, b) => Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

  // 1. geometry for several forest sizes and for hub mode
  for (const [n, mode] of [[0, "forest"], [1, "forest"], [2, "forest"], [3, "forest"], [6, "forest"], [12, "forest"], [30, "forest"], [4, "hub"]]) {
    const lay = L.layoutTree(mk(forest(n)), { mode });
    const sh = SH.shrineOf(lay.world, lay.rootBranchId);
    assert.ok(sh, `${mode}/${n}: a shrine exists`);
    assert.ok(fin(sh.centre.x, sh.centre.y, sh.centre.z, sh.stumpR, sh.doorAz, sh.wispAz, sh.altarAz, sh.doorTh, sh.altarTh, sh.footS, sh.perch.x, sh.perch.y, sh.perch.z), `${mode}/${n}: finite`);
    assert.equal(sh.pads.length, 3);
    assert.deepEqual(sh.pads.map((p) => p.id).sort(), ["altar", "door", "wisp"]);
    for (const p of sh.pads) assert.ok(fin(p.pos.x, p.pos.y, p.pos.z) && p.radius > 0 && p.label.length > 3, `${mode}/${n}: pad ${p.id}`);
    assert.ok(sh.perch.y > sh.groundY + 60, "the wisp rests above the post");
    if (n >= 2 && mode === "forest") {
      const roots = SH.rootAzimuths(lay.world, lay.rootBranchId);
      assert.equal(roots.length, n, `${n}: one root azimuth per tree`);
      // the door sits in a gap: as far from every root as the widest gap allows (the widest gap's midpoint)
      const gaps = SH.azimuthGaps(roots);
      assert.ok(Math.abs(gaps[0].width - Math.max(...gaps.map((g) => g.width))) < 1e-9);
      for (const r of roots) assert.ok(angDiff(sh.doorAz, r) >= gaps[0].width / 2 - 1e-6, `${n}: the door is in the widest gap`);
      assert.ok(angDiff(sh.doorAz, sh.wispAz) > 0.05 || n <= 2, `${n}: door and wisp post are in different gaps`);
      // stones never sit on a root / the door / the post
      for (const st of sh.stones) {
        const a = Math.atan2(st.z - sh.centre.z, st.x - sh.centre.x);
        for (const r of [...roots, sh.doorAz, sh.wispAz, sh.altarAz]) assert.ok(angDiff(a, r) > 0.24, `${n}: a stone is clear of a root / pad`);
      }
    }
    // deterministic
    assert.deepEqual(JSON.parse(JSON.stringify(SH.shrineOf(lay.world, lay.rootBranchId))), JSON.parse(JSON.stringify(sh)));
    // arriving: at the door, and the door is the pad there
    const a = SH.arrival(sh);
    assert.equal(a.branch, lay.rootBranchId);
    const c = S.spawn(lay.world, A("lizard"), a.branch, a.s, "guided", a.th);
    assert.ok(Math.abs(c.head.th - a.th) < 1e-9, "spawn takes the angle");
    const hp = W.surfacePoint(lay.world.branches.get(a.branch), c.head.s, c.head.th).p;
    assert.equal(SH.padNear(sh, hp)?.id, "door", `${mode}/${n}: at the door`);
    // the altar side
    const ap = W.surfacePoint(lay.world.branches.get(a.branch), sh.footS, sh.altarTh).p;
    assert.equal(SH.padNear(sh, ap)?.id, "altar", `${mode}/${n}: at the altar`);
    // far away: no pad
    assert.equal(SH.padNear(sh, { x: sh.centre.x + 5000, y: sh.groundY + 50, z: sh.centre.z }), null);
    assert.equal(SH.padNear(null, hp), null);
    // standing at the lantern post's side of the foot reaches the wisp or at least some pad (E always does something at the foot)
    const wp = W.surfacePoint(lay.world.branches.get(a.branch), sh.footS, W.thetaOf(W.frameAt(lay.world.branches.get(a.branch), sh.footS), { x: Math.cos(sh.wispAz), y: 0, z: Math.sin(sh.wispAz) }), 0).p;
    assert.ok(SH.padNear(sh, wp) !== null, `${mode}/${n}: a pad is in reach at the foot facing the lantern post`);
  }
  assert.equal(SH.shrineOf({ branches: new Map(), groundY: 0 }, "root"), null, "no stump, no shrine");

  // 2. the wisp
  {
    const head = { x: 100, y: 50, z: 0 };
    const perch = { x: 0, y: 200, z: 0 };
    const base = { mode: "perch", perch, head, camScale: 1, t: 0, guide: null };
    const tp = WI.wispTarget(base);
    assert.ok(Math.hypot(tp.x - perch.x, tp.y - perch.y, tp.z - perch.z) < 6, "perched: over the post (bobbing only)");
    const tf = WI.wispTarget({ ...base, mode: "follow" });
    assert.ok(Math.hypot(tf.x - head.x, tf.z - head.z) < 90 && tf.y > head.y + 80, "following: beside and above the animal");
    assert.deepEqual(WI.wispTarget({ ...base, perch: null }).y > head.y, true, "no shrine: it follows even when perched");
    const tg = WI.wispTarget({ ...base, mode: "follow", guide: { x: 900, y: 10, z: 900 } });
    assert.ok(Math.abs(tg.x - 900) < 1e-9 && tg.y > 40 && tg.y < 70, "a guide wins over everything");
    assert.equal(WI.parseWispMode("follow"), "follow");
    assert.equal(WI.parseWispMode("x"), "perch");
    assert.equal(WI.parseWispMode(null), "perch");
    // flight: speed capped, converges, never NaN
    let p = { x: 0, y: 0, z: 0 };
    const goal = { x: 3000, y: 400, z: -1500 };
    let t = 0, maxStep = 0;
    for (; t < 10 && Math.hypot(goal.x - p.x, goal.y - p.y, goal.z - p.z) > 1; t += DT) {
      const q = WI.wispStep(p, goal, DT);
      maxStep = Math.max(maxStep, Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) / DT);
      p = q;
    }
    assert.ok(maxStep <= WI.WISP_SPEED + 1e-6, `capped at ${WI.WISP_SPEED} px/s (${maxStep.toFixed(0)})`);
    assert.ok(Math.hypot(goal.x - p.x, goal.y - p.y, goal.z - p.z) < 25, "it arrives");
    assert.ok(t > 2.5, "a 3.4k px flight takes a visible time (not a teleport)");
    for (const bad of [NaN, Infinity]) assert.deepEqual(WI.wispStep({ x: 1, y: 2, z: 3 }, { x: bad, y: 0, z: 0 }, DT), { x: 1, y: 2, z: 3 });
    assert.deepEqual(WI.wispStep({ x: 1, y: 2, z: 3 }, goal, 0), { x: 1, y: 2, z: 3 });
    assert.ok(WI.wispHit(100, 100, { x: 110, y: 105 }, 20) && !WI.wispHit(100, 100, { x: 140, y: 100 }, 20) && !WI.wispHit(0, 0, null, 20));
  }

  // 3. the star junction
  {
    const lay = L.layoutTree(mk(forest(6, 8)), { mode: "forest" });
    const w = lay.world;
    const stump = w.branches.get("root");
    const roots = stump.side.filter((id) => w.branches.get(id).root);
    assert.equal(roots.length, 6);
    const rootTh = (id) => W.entryTheta(stump, w.branches.get(id), w.branches.get(id).attachS);
    const top = S.starTop(w, stump);
    assert.ok(top > 15 && top < stump.total, `the zones' top is on the stump (${top.toFixed(1)})`);

    for (const animal of ["lizard", "snake", "ant", "spider"]) {
      for (const id of roots) {
        // walking down (S, guided) facing down at the root's side: enters it, no Shift
        const c = S.spawn(w, A(animal), "root", top + 30, "guided", rootTh(id));
        c.phi = Math.PI;
        c.gripOn = false;
        for (let i = 0; i < 60 * 6 && c.head.b === "root"; i++) S.step(w, c, { ...S.NO_INPUT, back: true }, DT);
        assert.equal(c.head.b, id, `${animal}: walking down on the side of ${id} enters it`);
        // the hint says so too
        // Shift = stay
        const d = S.spawn(w, A(animal), "root", top + 30, "guided", rootTh(id));
        d.phi = Math.PI;
        d.gripOn = false;
        for (let i = 0; i < 60 * 4; i++) S.step(w, d, { ...S.NO_INPUT, back: true, climb: true }, DT);
        assert.equal(d.head.b, "root", `${animal}: Shift stays on the stump at the foot of ${id}`);
        assert.ok(d.head.s < 2, "(it walked right down to the foot)");
        // walking UP never takes a root
        const e = S.spawn(w, A(animal), "root", 3, "guided", rootTh(id));
        e.gripOn = false;
        for (let i = 0; i < 60 * 3; i++) S.step(w, e, { ...S.NO_INPUT, forward: true }, DT);
        assert.equal(e.head.b, "root", `${animal}: walking up the stump stays on it`);
      }
    }
    // coming UP a root onto the stump and pressing S does not bounce straight back (noAuto), a turn to another root's side then enters that one
    {
      const c = S.spawn(w, A("lizard"), "root:F1", w.branches.get("root:F1").total * 0.5, "guided");
      c.gripOn = false;
      c.phi = Math.PI;
      for (let i = 0; i < 60 * 30 && c.head.b !== "root"; i++) S.step(w, c, { ...S.NO_INPUT, back: true }, DT);
      assert.equal(c.head.b, "root", "from the root onto the stump");
      for (let i = 0; i < 20; i++) S.step(w, c, { ...S.NO_INPUT, back: true }, DT);
      assert.equal(c.head.b, "root", "pressing S at once does not walk back into the root it came up");
      // (holding S on: the animal U-turns and, facing down, takes the root on the side it then faces: back into the one it came from is fine)
      for (let i = 0; i < 60 * 4; i++) S.step(w, c, { ...S.NO_INPUT, back: true }, DT);
      assert.ok(c.head.b === "root" || c.head.b.startsWith("root:"), "still on the stump or a root");
    }
    // the free-mode default (spawn without a move mode) behaves the same: heading base-ward = walking down
    {
      const c = S.spawn(w, A("lizard"), "root", top + 30);
      c.head.th = rootTh(roots[2]);
      c.phi = Math.PI;
      c.gripOn = false;
      for (let i = 0; i < 60 * 6 && c.head.b === "root"; i++) S.step(w, c, { ...S.NO_INPUT, forward: true }, DT);
      assert.equal(c.head.b, roots[2], "free mode: heading down enters the root too");
    }
    // a wide gap: with few trees there is room at the foot where no root is taken (the door side stays on the stump)
    {
      const lay3 = L.layoutTree(mk(forest(3, 6)), { mode: "forest" });
      const w3 = lay3.world;
      const sh = SH.shrineOf(w3, "root");
      const c = S.spawn(w3, A("lizard"), "root", 80, "guided", sh.doorTh);
      c.phi = Math.PI;
      c.gripOn = false;
      for (let i = 0; i < 60 * 6; i++) S.step(w3, c, { ...S.NO_INPUT, back: true }, DT);
      const st = w3.branches.get("root");
      const ang = ["root:F0", "root:F1", "root:F2"].map((id) => Math.abs(W.wrapAngle(sh.doorTh - W.entryTheta(st, w3.branches.get(id), w3.branches.get(id).attachS))));
      assert.ok(Math.min(...ang) > S.STAR_ARC - 0.3 || c.head.b !== "root", "(geometry sanity)");
      if (Math.min(...ang) > S.STAR_ARC) assert.equal(c.head.b, "root", "3 trees: the door side of the stump has no root: it stands at the foot");
    }
    // climbTarget (the HUD hint) names the root at the foot; nothing higher up
    {
      const id = roots[0];
      const c = S.spawn(w, A("lizard"), "root", 5, "guided", rootTh(id));
      assert.equal(S.climbTarget(w, c)?.id, id, "at the foot: the hint offers the root");
      const hi = S.spawn(w, A("lizard"), "root", top + 25, "guided", rootTh(id));
      assert.equal(S.climbTarget(w, hi), null, "above the roots' zones: nothing");
    }
    // hub mode has no roots: the stump behaves as before
    {
      const hub = L.layoutTree(mk(forest(4, 6)), { mode: "hub" }).world;
      assert.equal(S.starTop(hub, hub.branches.get("root")), 0);
      assert.equal(S.starRoot(hub, hub.branches.get("root"), 0, 0), null);
    }
    // fuzz: random keys at the stump's foot never produce NaN and always leave the animal on some branch
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const animal of ["lizard", "snake", "ant"]) {
      const c = S.spawn(w, A(animal), "root", 30, "guided", 0.5);
      for (let i = 0; i < 60 * 40; i++) {
        S.step(w, c, { ...S.NO_INPUT, forward: rnd() < 0.5, back: rnd() < 0.5, left: rnd() < 0.2, right: rnd() < 0.2, climb: rnd() < 0.3 }, DT);
        assert.ok(fin(c.head.s, c.head.th, c.phi) && w.branches.get(c.head.b), `${animal}: finite fuzz state`);
      }
    }
  }

  // 4. the world tree: giant trunk, crown limbs for the places, pads at their tips
  {
    const places = PL.demoPlaces(5);
    assert.equal(places.length, 5);
    assert.equal(PL.placeOf("place:demo2", places)?.title, places[2].title);
    assert.equal(PL.placeOf("door", places), null);
    assert.equal(PL.placeOf("place:nope", places), null);
    const none = L.layoutTree(mk(forest(5)), { mode: "forest" });
    assert.deepEqual(none.places, [], "no places asked for: no limbs");
    const lay = L.layoutTree(mk(forest(7, 8)), { mode: "forest", places: [...places, places[0]] }); // (a duplicate id is ignored)
    const w = lay.world;
    const trunk = w.branches.get("root");
    assert.equal(lay.places.length, 5);
    assert.ok(trunk.total >= L.YGG_LENGTH - 1 && trunk.r >= L.YGG_MIN_R && trunk.r <= L.YGG_MAX_R, `the world tree is giant (${trunk.total.toFixed(0)} x r ${trunk.r.toFixed(0)})`);
    assert.equal(trunk.species, "yggdrasil");
    // it towers over every other tree
    let tallest = 0;
    for (const b of w.branches.values()) if (b.id !== "root" && !b.place) for (const p of b.pts) tallest = Math.max(tallest, p.y);
    assert.ok(tallest < trunk.total * 0.9, `the other trees stay below it (${tallest.toFixed(0)} < ${(trunk.total * 0.9).toFixed(0)})`);
    // the other trees stand clear of it
    for (const id of trunkIdsOf(lay)) {
      const f = w.branches.get(id).pts[0];
      assert.ok(Math.hypot(f.x, f.z) > trunk.r + L.YGG_CLEAR * 0.8, `a tree stands well away from the world tree`);
    }
    for (const pl of lay.places) {
      const b = w.branches.get(pl.branchId);
      assert.ok(b && b.place === pl.id && b.parent === "root" && trunk.side.includes(b.id), "a place limb is a side branch of the trunk");
      assert.ok(b.attachS > trunk.total * 0.45 && b.attachS < trunk.total * 0.95, "in the crown (upper half)");
      assert.ok(fin(b.r, b.rEnd, b.total) && b.total > 300 && b.pts.every((p) => fin(p.x, p.y, p.z) && p.y > 0), "a sound limb");
      assert.equal(lay.parentOf.get(pl.branchId), "root");
      assert.ok(!lay.info.has(pl.branchId), "not an editable folder");
    }
    assert.equal(new Set(lay.places.map((p) => w.branches.get(p.branchId).attachS.toFixed(0))).size, 5, "the limbs leave at different heights");
    const sh = SH.shrineOf(w, "root", new Map(lay.places.map((p) => [p.branchId, p.title])));
    assert.equal(sh.pads.filter((p) => p.id.startsWith("place:")).length, 5);
    assert.ok(sh.k > 3 && sh.k <= 4.5, `the foot is scaled up (${sh.k.toFixed(2)})`);
    assert.ok(sh.pads.find((p) => p.id === "place:demo1").label === places[1].title, "a crown pad carries its title");
    // a creature at a limb's tip is at that pad, and only there
    for (const pl of lay.places) {
      const b = w.branches.get(pl.branchId);
      const top = Math.atan2(W.frameAt(b, b.total * 0.9).b.y, W.frameAt(b, b.total * 0.9).u.y);
      const hp = W.surfacePoint(b, b.total * 0.9, top).p;
      assert.equal(SH.padNear(sh, hp)?.id, "place:" + pl.id, `at the tip of ${pl.id}`);
    }
    // it can be climbed to: the autopilot walks from the shrine's door up the trunk and out each limb
    for (const animal of ["lizard"]) {
      for (const pl of lay.places.slice(0, 3)) {
        const a = SH.arrival(sh);
        const c = S.spawn(w, A(animal), a.branch, a.s, "guided", a.th);
        c.gripOn = false;
        const b = w.branches.get(pl.branchId);
        const pil = new AP.Autopilot({ b: b.id, s: b.total * 0.9, th: Math.atan2(W.frameAt(b, b.total * 0.9).b.y, W.frameAt(b, b.total * 0.9).u.y) });
        for (let i = 0; i < 60 * 400 && pil.status === "walking"; i++) { const inp = pil.step(w, c, DT); if (pil.status !== "walking") break; S.step(w, c, inp, DT); }
        assert.equal(pil.status, "arrived", `${animal}: walks from the door to the ${pl.title} limb (${pil.reason}, on ${c.head.b} at ${c.head.s.toFixed(0)})`);
        const hp = W.surfacePoint(w.branches.get(c.head.b), c.head.s, c.head.th).p;
        assert.ok(SH.padNear(sh, hp)?.id === "place:" + pl.id, "and is at its pad when it arrives");
      }
    }
    // hub mode ignores places and keeps the short stump
    const hub = L.layoutTree(mk(forest(4)), { mode: "hub", places });
    assert.deepEqual(hub.places, []);
    assert.ok(hub.world.branches.get("root").total < 1000, "hub mode: the old short stump");
    const hubShrine = SH.shrineOf(hub.world, "root");
    assert.ok(hubShrine && hubShrine.k <= 2, "hub mode: a small foot");
  }
};
