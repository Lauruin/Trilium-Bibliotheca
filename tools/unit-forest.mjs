// Unit checks for round 5, stream 1 ("forest"): the forest layout mode + ground roots, the wave properties and pointed tips.
// Run by tools/unit-test.mjs (it loads every tools/unit-<name>.mjs): `export default async ({ bundle, assert }) => { ... }`.

export default async ({ bundle, assert }) => {
  const L = await bundle("src/tree/layout.ts", "layout-forest.mjs");
  const W = await bundle("src/tree/world3.ts", "w-forest.mjs");
  const S = await bundle("src/tree/sim3.ts", "s-forest.mjs");
  const WV = await bundle("src/tree/wave.ts", "wave-forest.mjs");
  const F = await bundle("src/tree/forest.ts", "forest-forest.mjs");
  const SP = await bundle("src/tree/species.ts", "species-forest.mjs");
  const TE = await bundle("src/lib/treeedit.ts", "treeedit-forest.mjs");
  const cfg = await bundle("src/config.ts", "cfg-forest.mjs");
  const lib = await bundle("src/lib/library.ts", "lib-forest.mjs");
  const fin = (...xs) => xs.every(Number.isFinite);
  const A = (id) => S.ANIMALS.find((a) => a.id === id);

  // spec nodes: { id, kids, labels }; folders = nodes with kids
  const mk = (spec, rootLabels = {}) => {
    const notes = {}, edges = [];
    const add = (n, parent) => {
      notes[n.id] = { noteId: n.id, title: n.id, type: "text", labels: { ...(n.labels ?? {}) }, hasChildren: !!(n.kids && n.kids.length) };
      if (parent) edges.push({ parentNoteId: parent, noteId: n.id, notePosition: 0 });
      (n.kids ?? []).forEach((k) => add(k, n.id));
    };
    add({ id: "root", kids: spec, labels: rootLabels }, null);
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const notesN = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: `${tag}n${i}` }));
  const forest = (n, notes = 6, extra = []) => Array.from({ length: n }, (_, i) => ({ id: "F" + i, kids: [...notesN("x" + i, notes), ...extra.map((e) => ({ ...e, id: e.id + i }))] }));
  const trunkIdsOf = (lay) => lay.world.branches.get("root").side.map((id) => lay.world.branches.get(id).next[0]);
  const treeOf = (lay, id) => { // the trunk id a branch belongs to (walks the parent chain; roots belong to their tree)
    let b = lay.world.branches.get(id);
    while (b && b.parent && b.parent !== "root") b = lay.world.branches.get(b.parent);
    return b ? (b.root ? b.next[0] : b.id) : null;
  };
  const noNaN = (lay, what) => {
    for (const b of lay.world.branches.values()) {
      assert.ok(fin(b.r, b.rEnd, b.total) && b.pts.every((p) => fin(p.x, p.y, p.z)) && b.T.every((p) => fin(p.x, p.y, p.z)) && b.U.every((p) => fin(p.x, p.y, p.z)), `${what}/${b.id}: finite geometry`);
      assert.ok(b.r > 0 && b.rEnd > 0 && b.total > 0, `${what}/${b.id}: positive size`);
    }
    for (const l of lay.leaves) assert.ok(fin(l.s, l.th), `${what}: finite leaf`);
  };

  // ================= 1. forest mode: structure =================
  {
    const tr = mk(forest(5, 6, [{ id: "G", kids: notesN("g", 3) }]).concat([{ id: "r1" }, { id: "r2" }]));
    const lay = L.layoutTree(tr, { mode: "forest" });
    assert.equal(lay.mode, "forest");
    assert.equal(L.layoutTree(tr).mode, "hub", "layoutTree defaults to hub (old callers unchanged)");
    assert.equal(L.DEFAULT_LAYOUT_MODE, "forest", "the app default is the forest");
    assert.equal(L.parseLayoutMode("forest"), "forest");
    assert.equal(L.parseLayoutMode("hub"), "hub");
    assert.equal(L.parseLayoutMode("Forest"), null);
    assert.equal(L.parseLayoutMode(null), null);
    const w = lay.world;
    assert.equal(w.groundY, 0);
    const stump = w.branches.get("root");
    assert.equal(stump.parent, null);
    assert.ok(stump.pts.every((p) => p.x === 0 && p.z === 0), "the stump stands at the origin");
    assert.equal(lay.parentOf.get("root"), null);
    assert.deepEqual(lay.leaves.filter((l) => l.branchId === "root").map((l) => l.id).sort(), ["r1", "r2"], "the root's own notes are leaves on the central stump");
    assert.equal(stump.next.length, 0, "no trunk leaves the stump's end (the hub mechanism is not used)");
    assert.equal(stump.side.length, 5, "one ground root per tree on the stump");
    for (let i = 0; i < 5; i++) {
      const tid = "F" + i;
      const rb = w.branches.get("root:" + tid);
      const tb = w.branches.get(tid);
      assert.ok(rb && rb.root === true, `${tid}: has a ground root`);
      assert.equal(rb.parent, "root");
      assert.ok(rb.attachS > 0 && rb.attachS < stump.total, "the root leaves the stump near its base");
      assert.ok(W.dist(rb.pts[0], W.frameAt(stump, rb.attachS).p) < 1e-6, "the root starts on the stump's axis");
      assert.deepEqual(rb.next, [tid], "the trunk continues from the root's END");
      assert.deepEqual(rb.side, []);
      assert.equal(tb.parent, rb.id);
      assert.equal(tb.attachS, undefined);
      assert.ok(W.dist(tb.pts[0], rb.pts.at(-1)) < 1e-6, "the trunk starts where its root ends");
      assert.ok(W.dot(rb.T.at(-1), tb.T[0]) > 0.97, `${tid}: root and trunk meet without a kink (${W.dot(rb.T.at(-1), tb.T[0]).toFixed(3)})`);
      assert.ok(Math.abs(rb.rEnd - tb.r) < 1e-9 && rb.r < rb.rEnd, "the root widens to the trunk's radius");
      assert.equal(lay.parentOf.get(tid), "root", "breadcrumb: a trunk's parent is still the root note");
      assert.equal(lay.parentOf.get(rb.id), "root");
      assert.deepEqual(L.pathToRoot(lay, tid), ["root", tid]);
      assert.equal(lay.info.has(rb.id), false, "ground roots are not editable folders");
      assert.ok(!lay.leaves.some((l) => l.branchId === rb.id), "roots carry no leaves");
      assert.equal(rb.species, tb.species);
      assert.ok(rb.pts.every((p) => p.y >= 0), "a root never sinks below the ground");
      assert.ok(Math.min(...rb.pts.slice(0, -5).map((p) => p.y)) < rb.r * 1.2, "a root runs along the ground");
      assert.ok(tb.pts[0].y > 0 && tb.pts[0].y < 2.4 * tb.r + 8, "the trunk's first point is just above the ground (the root sweeps up into it)");
      assert.ok(tb.T[0].y > 0.9, "a trunk rises nearly vertically");
    }
    assert.deepEqual(L.pathToRoot(lay, "G0"), ["root", "F0", "G0"]);
    assert.equal(lay.info.size, w.branches.size - 5, "info for every folder branch (stump included), not for the roots");
    noNaN(lay, "forest5");
    // mode only matters for structure: the same folders are branches in both
    const hubLay = L.layoutTree(tr, { mode: "hub" });
    for (const id of ["root", "F0", "F4", "G0", "G3"]) assert.ok(hubLay.world.branches.has(id) && w.branches.has(id), `${id} in both modes`);
    assert.ok(![...hubLay.world.branches.values()].some((b) => b.root), "hub mode has no roots");
    assert.deepEqual(hubLay.world.branches.get("root").next.slice().sort(), ["F0", "F1", "F2", "F3", "F4"], "hub mode unchanged: trunks are 'next' children of the hub");
    // determinism
    assert.equal(JSON.stringify([...L.layoutTree(tr, { mode: "forest" }).world.branches.values()].map((b) => [b.id, b.pts, b.r, b.rEnd, b.parent, b.attachS, b.next, b.side])),
      JSON.stringify([...w.branches.values()].map((b) => [b.id, b.pts, b.r, b.rEnd, b.parent, b.attachS, b.next, b.side])), "forest layout is deterministic");
  }

  // ================= 2. placement: N = 0 / 1 / 2 / 30 / 133, no overlaps =================
  {
    const l0 = L.layoutTree(mk([{ id: "a" }, { id: "b" }]), { mode: "forest" });
    assert.deepEqual([...l0.world.branches.keys()], ["root"], "N = 0: just the stump");
    assert.equal(l0.leaves.length, 2);
    assert.equal(L.layoutTree(mk([]), { mode: "forest" }).world.branches.get("root").total, L.YGG_LENGTH, "the world tree stands tall");
    const l1 = L.layoutTree(mk(forest(1, 8)), { mode: "forest" });
    assert.equal(l1.world.branches.size, 3, "N = 1: stump + root + trunk");
    noNaN(l1, "N=1");
    const sizeVar = (i) => 1 + ((i * 7) % 5) * 9; // trees of very different size
    for (const n of [2, 3, 6, 7, 12, 30, 133]) {
      const t0 = performance.now();
      const tree = mk(Array.from({ length: n }, (_, i) => ({ id: "F" + i, kids: [...notesN("x" + i, sizeVar(i)), ...(i % 3 === 0 ? [{ id: "G" + i, kids: notesN("g" + i, 5) }] : [])] })));
      const lay = L.layoutTree(tree, { mode: "forest" });
      const ms = performance.now() - t0;
      assert.ok(ms < 1500, `N=${n}: lays out in ${ms.toFixed(0)} ms (< 1.5 s)`);
      noNaN(lay, `N=${n}`);
      const ids = trunkIdsOf(lay);
      assert.equal(ids.length, n);
      const feet = ids.map((id) => lay.world.branches.get(id).pts[0]);
      const rad = ids.map((id) => lay.world.branches.get(id).r);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        assert.ok(Math.hypot(feet[i].x - feet[j].x, feet[i].z - feet[j].z) >= 3 * (rad[i] + rad[j]), `N=${n}: trunks ${i}/${j} at least 3 diameters apart`);
      }
      // crowns (footprint of every branch of a tree, no margin) never overlap
      const crowns = ids.map((id) => F.crownOf([...lay.world.branches.values()].filter((b) => treeOf(lay, b.id) === id && !b.root), 0));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const gap = Math.hypot(feet[i].x - feet[j].x, feet[i].z - feet[j].z) - crowns[i].bound - crowns[j].bound;
        if (gap >= 0) continue; // bounding circles apart: fine
        let m = Infinity;
        for (const a of crowns[i].discs) for (const b of crowns[j].discs) m = Math.min(m, Math.hypot(feet[i].x + a.x - feet[j].x - b.x, feet[i].z + a.z - feet[j].z - b.z) - a.r - b.r);
        assert.ok(m >= 0, `N=${n}: crowns ${i}/${j} do not overlap (clearance ${m.toFixed(0)})`);
      }
      // nobody stands on the stump, and the forest stays a sane size
      const stumpR = lay.world.branches.get("root").r;
      let far = 0;
      for (const f of feet) { assert.ok(Math.hypot(f.x, f.z) > stumpR + 3 * 14, "trees stand clear of the stump"); far = Math.max(far, Math.hypot(f.x, f.z)); }
      assert.ok(far < 12000, `N=${n}: forest radius ${far.toFixed(0)} px`);
    }
    // roots of different trees do not pass through each other's trunk feet
    {
      const lay = L.layoutTree(mk(forest(30, 20)), { mode: "forest" });
      for (const a of lay.world.branches.values()) {
        if (!a.root) continue;
        for (const b of lay.world.branches.values()) {
          if (!b.root || a === b) continue;
          const foot = b.pts.at(-1);
          const d = Math.min(...a.pts.map((p) => Math.hypot(p.x - foot.x, p.z - foot.z)));
          assert.ok(d > lay.world.branches.get(b.next[0]).r, `root ${a.id} stays clear of the trunk of ${b.id} (${d.toFixed(0)})`);
        }
      }
    }
    // species vary the crown width: a wide oak forest and a narrow cypress forest are placed differently but both valid
    const overridden = (key, n) => { const t = mk(forest(n, 25)); return L.layoutTree(t, { mode: "forest", overrides: new Map(Object.keys(t.notes).filter((id) => t.notes[id].hasChildren && id !== "root").map((id) => [id, { species: key }])) }); };
    for (const key of SP.SPECIES_KEYS) noNaN(overridden(key, 4), `forest/${key}`);
  }

  // ================= 3. walking: tree -> root -> stump -> root -> tree, both ways =================
  {
    const lay = L.layoutTree(mk(forest(6, 10)), { mode: "forest" });
    const w = lay.world;
    const stump = w.branches.get("root");
    const toStump = (tid, s) => { const tb = w.branches.get(tid); const F0 = tb.pts[0]; const h = Math.hypot(F0.x, F0.z); return W.thetaOf(W.frameAt(tb, s), W.v3(-F0.x / h, 0, -F0.z / h)); };
    const down = (tid, animal) => { // from 60 px up the trunk, facing down, on the side that faces the stump
      const c = S.spawn(w, A(animal), tid, 60);
      c.phi = Math.PI;
      c.head.th = toStump(tid, 60);
      const seen = [];
      let minGrip = 1;
      for (let i = 0; i < 60 * 40 && c.head.b !== "root"; i++) {
        S.step(w, c, { ...S.NO_INPUT, forward: true }, 1 / 60);
        if (seen[seen.length - 1] !== c.head.b) seen.push(c.head.b);
        minGrip = Math.min(minGrip, c.grip);
        assert.ok(!c.air, `${animal}: never falls while walking down ${tid} onto its root`);
      }
      return { c, seen, minGrip };
    };
    for (const animal of ["lizard", "cat", "snake", "ant", "spider"]) {
      for (const tid of ["F0", "F3", "F5"]) {
        const r = down(tid, animal);
        assert.deepEqual(r.seen, [tid, "root:" + tid, "root"], `${animal}: down ${tid} -> its root -> the stump`);
        assert.ok(r.minGrip > 0.9, `${animal}: walking a root's top does not drain grip (${r.minGrip.toFixed(2)})`);
      }
    }
    // from the stump into another root (walking DOWN into its base zone: the star junction, no Shift), then up that trunk
    const up = (tid, animal) => {
      const rb = w.branches.get("root:" + tid);
      const c = S.spawn(w, A(animal), "root", rb.attachS + 40, "guided");
      c.head.th = W.entryTheta(w.branches.get("root"), rb, rb.attachS); // the side of the stump the root leaves from
      c.phi = Math.PI;
      assert.equal(S.climbTarget(w, { ...c, head: { ...c.head, s: rb.attachS + 2 } })?.id, "root:" + tid, `${animal}: the stump's base offers the root of ${tid}`);
      const seen = [];
      for (let i = 0; i < 60 * 60 && c.head.b !== tid; i++) {
        // S walks down the stump into the root (the star junction); once on the root W walks along it to the trunk
        const onRoot = c.head.b.startsWith("root:");
        S.step(w, c, onRoot ? { ...S.NO_INPUT, forward: true } : { ...S.NO_INPUT, back: true }, 1 / 60);
        if (seen[seen.length - 1] !== c.head.b) seen.push(c.head.b);
      }
      return { c, seen };
    };
    for (const animal of ["lizard", "snake"]) { // (the cat clings only to the top half of a branch: on the stump it can't stand on every side)
      for (const tid of ["F1", "F2", "F4"]) {
        const r = up(tid, animal);
        assert.deepEqual(r.seen.filter((b) => b !== "root"), ["root:" + tid, tid], `${animal}: stump -> root -> up ${tid}`);
      }
    }
    // tree A -> stump (arrives on the stump), then out through tree B and back to A (the full trip, both ways)
    for (const [a, b] of [["F0", "F1"], ["F1", "F0"], ["F2", "F5"]]) {
      const r1 = down(a, "lizard");
      assert.equal(r1.c.head.b, "root");
      const r2 = up(b, "lizard");
      assert.equal(r2.c.head.b, b);
      const r3 = down(b, "lizard");
      assert.equal(r3.c.head.b, "root", `back down ${b} to the stump`);
      const r4 = up(a, "lizard");
      assert.equal(r4.c.head.b, a, `and up ${a} again`);
    }
    // an ordinary creature standing on a root top with no input stays there (no ground recovery, no slipping)
    for (const animal of ["lizard", "cat", "snake", "ant", "squirrel"]) {
      const rb = w.branches.get("root:F2");
      const c = S.spawn(w, A(animal), rb.id, rb.total * 0.4);
      for (let i = 0; i < 60 * 5; i++) S.step(w, c, S.NO_INPUT, 1 / 60);
      assert.equal(c.head.b, rb.id, `${animal} stays on the root`);
      assert.ok(!c.air && c.grip > 0.99, `${animal}: grip on the root's top never drains`);
    }
    // random-input fuzz along the roots and trunks: finite, always back on some branch
    let seed = 5;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const animal of ["lizard", "snake", "bee", "blue jay"]) {
      const an = S.ANIMALS.find((x) => x.id === animal || x.name.toLowerCase() === animal) ?? A("lizard");
      const c = S.spawn(w, an, "root:F4", 100);
      for (let i = 0; i < 60 * 30; i++) {
        const input = { ...S.NO_INPUT, forward: rnd() < 0.7, back: rnd() < 0.1, left: rnd() < 0.2, right: rnd() < 0.2, climb: rnd() < 0.3, leap: rnd() < 0.01 };
        S.step(w, c, input, 1 / 60);
        const p = S.bodyPoint ? S.bodyPoint(c, 0).p : null;
        if (p) assert.ok(fin(p.x, p.y, p.z), "finite position");
      }
    }
  }

  // ================= 4. wave helper =================
  {
    const FNS = WV.WAVE_FNS;
    assert.deepEqual([...FNS], ["none", "sine", "zigzag", "sawtooth", "helix", "sbend", "noise"]);
    for (const fn of FNS) assert.equal(typeof WV.WAVE_LABELS[fn], "string");
    assert.equal(WV.parseWaveFn(" Sine "), "sine");
    assert.equal(WV.parseWaveFn("S-bend"), null);
    assert.equal(WV.parseWaveFn(5), null);
    for (const fn of FNS) {
      for (const freq of [0.25, 1, 2.5, 7, 12]) {
        for (const seed of [0, 0.31, 0.99]) {
          const [a0, b0] = WV.waveShape(fn, 0, freq, seed);
          assert.ok(Math.abs(a0) < 1e-12 && Math.abs(b0) < 1e-12, `${fn}: 0 at the base`);
          let prev = [0, 0];
          let maxStep = 0;
          for (let i = 0; i <= 2000; i++) {
            const t = i / 2000;
            const v = WV.waveShape(fn, t, freq, seed);
            assert.ok(fin(v[0], v[1]), `${fn}: finite`);
            assert.ok(Math.hypot(v[0], v[1]) <= 1 + 1e-9, `${fn}: bounded by the amplitude (${Math.hypot(v[0], v[1]).toFixed(3)})`);
            maxStep = Math.max(maxStep, Math.hypot(v[0] - prev[0], v[1] - prev[1]));
            prev = v;
            assert.deepEqual(WV.waveShape(fn, t, freq, seed), v, `${fn}: deterministic`);
          }
          // continuity: no jump between neighbouring samples (the slope bound x the step, with slack)
          assert.ok(maxStep <= WV.waveSlope(fn, freq) / 2000 * 1.01 + 1e-9, `${fn} f=${freq}: continuous (max step ${maxStep.toExponential(2)} vs ${(WV.waveSlope(fn, freq) / 2000).toExponential(2)})`);
        }
      }
      // garbage input never throws and gives a finite answer
      for (const bad of [NaN, Infinity, -Infinity, 1e300, -5]) {
        assert.deepEqual(WV.waveShape(fn, bad, 2, 0.1).map(Number.isFinite), [true, true]);
        assert.deepEqual(WV.waveShape(fn, 0.5, bad, 0.1).map(Number.isFinite), [true, true]);
        assert.deepEqual(WV.waveShape(fn, 0.5, 2, bad).map(Number.isFinite), [true, true]);
      }
    }
    assert.deepEqual(WV.waveShape("none", 0.7, 3, 0.2), [0, 0]);
    assert.ok(Math.abs(WV.waveShape("sbend", 1, 3)[0] - 1) < 1e-12, "the S-bend ends one amplitude to the side");
    assert.deepEqual(WV.waveShape("sbend", 0.6, 1), WV.waveShape("sbend", 0.6, 9), "the S-bend ignores the frequency");
    assert.ok(WV.waveShape("helix", 0.5, 1).every(Number.isFinite) && Math.hypot(...WV.waveShape("helix", 0.5, 1)) > 0.9, "the corkscrew circles (a full 2nd axis)");
    assert.notDeepEqual(WV.waveShape("noise", 0.5, 3, 0.1), WV.waveShape("noise", 0.5, 3, 0.7), "noise differs per seed");
    // the displacement of a polyline: first point stays, bounded by the amplitude, perpendicular, input untouched
    const line = Array.from({ length: 101 }, (_, i) => W.v3(i * 10, 0, 0));
    const copy = JSON.stringify(line);
    for (const fn of FNS) {
      const out = WV.applyWave(line, fn, 0.04, 2, 0.4, 0.7);
      assert.equal(JSON.stringify(line), copy, "input not mutated");
      assert.equal(out.length, line.length);
      assert.deepEqual(out[0], line[0], `${fn}: the base point never moves`);
      let maxD = 0;
      for (let i = 0; i < out.length; i++) {
        assert.ok(fin(out[i].x, out[i].y, out[i].z));
        maxD = Math.max(maxD, Math.hypot(out[i].y, out[i].z));
        if (fn !== "sbend" && fn !== "none") assert.ok(Math.abs(out[i].x - line[i].x) < 1000 * 0.04 + 1e-6, "mostly perpendicular");
      }
      assert.ok(maxD <= 0.04 * 1000 + 1e-6, `${fn}: displacement <= amplitude x length (${maxD.toFixed(1)} of 40)`);
      if (fn !== "none") assert.ok(maxD > 3, `${fn}: actually displaces`);
    }
    // the steepness limit: a violent wave is reduced so the branch never kinks past ~35 degrees from its line
    const violent = WV.applyWave(line, "zigzag", 0.3, 12, 0.1, 0);
    let worst = 0;
    for (let i = 1; i < violent.length; i++) worst = Math.max(worst, Math.hypot(violent[i].y - violent[i - 1].y, violent[i].z - violent[i - 1].z) / Math.max(1e-9, violent[i].x - violent[i - 1].x));
    assert.ok(worst <= WV.WAVE_MAX_SLOPE * 1.5, `slope limited (${worst.toFixed(2)})`);
    assert.ok(WV.effectiveFreq(12, 100) <= 100 / WV.WAVE_MIN_LENGTH + 1e-9, "a short branch can't hold 12 cycles");
    assert.equal(WV.effectiveAmp("none", 0.2, 3), 0);
    assert.equal(WV.applyWave([W.v3(0, 0, 0)], "sine", 0.1, 1, 0, 0).length, 1, "tiny inputs survive");
  }

  // ================= 5. wave properties on branches =================
  {
    const spec = () => [
      { id: "A", kids: [...notesN("a", 4), { id: "B", kids: [...notesN("b", 4), { id: "D", kids: notesN("d", 3) }] }, { id: "C", kids: notesN("c", 3) }] },
      ...forest(2).map((f, i) => ({ ...f, id: "O" + i })),
    ];
    const withLabels = (labelsById, mode = "hub") => L.layoutTree(mk(spec().map(function relabel(n) { return { ...n, labels: { ...(n.labels ?? {}), ...(labelsById[n.id] ?? {}) }, kids: n.kids?.map(relabel) }; })), { mode });
    assert.equal(L.PROP_LABELS.wave, "biblio_bwave");
    assert.equal(L.PROP_LABELS.waveFreq, "biblio_bwfreq");
    assert.equal(L.PROP_LABELS.waveFn, "biblio_bwfn");
    assert.equal(cfg.LABELS.branchWave, "biblio_bwave");
    for (const name of [cfg.LABELS.branchWave, cfg.LABELS.branchWaveFreq, cfg.LABELS.branchWaveFn]) {
      assert.equal(name, name.toLowerCase());
      assert.ok(lib.NOISE_LABELS.has(name), `${name} never becomes a shelf`);
    }
    assert.equal(cfg.LABELS.branchSpin, "biblio_bspin", "the stored label keeps its name (back-compat)");
    for (const mode of ["hub", "forest"]) {
      const ref = withLabels({}, mode);
      for (const [id, x] of ref.info) {
        assert.deepEqual(x.eff, x.calc, `${mode}/${id}: no override -> eff == calc`);
        assert.ok(fin(x.calc.wave, x.calc.waveFreq) && WV.WAVE_FNS.includes(x.calc.waveFn));
        if (id !== "root") {
          assert.ok(x.calc.wave >= 0 && x.calc.wave <= 0.05 && x.calc.wave > 0, `${mode}/${id}: a small natural wobble by default (${x.calc.wave})`);
          assert.ok(x.calc.waveFreq >= 0.5 && x.calc.waveFreq <= 6);
        }
      }
      const calcB = JSON.stringify(ref.info.get("B").calc);
      const sw = SP.SPECIES[ref.info.get("B").calc.species].sway;
      assert.equal(ref.info.get("B").calc.wave, Math.round(0.012 * sw * 1000) / 1000, "the calculated amplitude follows the species' sway");
      assert.ok(ref.info.get("A").calc.wave <= 0.6 * 0.012 * 1.6 + 1e-9, "trunks are calmer");
      const withB = (labels) => withLabels({ B: labels }, mode);
      for (const [label, key, val, expect] of [
        ["biblio_bwave", "wave", "0.1", 0.1], ["biblio_bwfreq", "waveFreq", "3", 3], ["biblio_bwfn", "waveFn", "SiNe", "sine"],
        ["biblio_bwave", "wave", "9", 0.3], ["biblio_bwave", "wave", "-1", 0], ["biblio_bwfreq", "waveFreq", "100", 12], ["biblio_bwfreq", "waveFreq", "0", 0.25],
        ["biblio_bwave", "wave", "0,05", 0.05], ["biblio_bwfn", "waveFn", " none ", "none"],
      ]) {
        const ly = withB({ [label]: val });
        const x = ly.info.get("B");
        assert.equal(x.eff[key], expect, `${mode}: ${label}=${val} -> ${expect}`);
        assert.ok(x.overridden.has(key) && x.overridden.size === 1, `${key}: marked overridden`);
        assert.equal(JSON.stringify(x.calc), calcB, `${mode}/${key}: calc unchanged by its own override`);
        assert.equal(JSON.stringify(ly.info.get("A").calc), JSON.stringify(ref.info.get("A").calc), "other branches' calc untouched");
        noNaN(ly, `${mode}/${label}=${val}`);
      }
      // garbage is ignored
      for (const [label, val] of [["biblio_bwave", "abc"], ["biblio_bwave", ""], ["biblio_bwave", "1e999"], ["biblio_bwave", "NaN"], ["biblio_bwfreq", "--1"], ["biblio_bwfreq", "0x10"], ["biblio_bwfn", "banana"], ["biblio_bwfn", ""], ["biblio_bwfn", "__proto__"], ["biblio_bwfn", "constructor"], ["biblio_bwfn", "5"], ["biblio_bwave", "🙂"]]) {
        const ly = withB({ [label]: val });
        assert.deepEqual(ly.info.get("B").eff, ref.info.get("B").calc, `${mode}: ${label}=${JSON.stringify(val)} ignored`);
        assert.equal(ly.info.get("B").overridden.size, 0);
      }
      // explicit overrides: a value, null = force calculated (label ignored), absent = the label
      const tree = mk(spec().map(function relabel(n) { return { ...n, labels: { ...(n.labels ?? {}), ...(n.id === "B" ? { biblio_bwave: "0.2", biblio_bwfn: "helix" } : {}) }, kids: n.kids?.map(relabel) }; }));
      const labelled = L.layoutTree(tree, { mode });
      assert.equal(labelled.info.get("B").eff.wave, 0.2);
      assert.equal(labelled.info.get("B").eff.waveFn, "helix");
      const nulled = L.layoutTree(tree, { mode, overrides: new Map([["B", { wave: null, waveFn: null }]]) });
      assert.equal(nulled.info.get("B").eff.wave, nulled.info.get("B").calc.wave);
      assert.equal(nulled.info.get("B").eff.waveFn, nulled.info.get("B").calc.waveFn);
      assert.equal(JSON.stringify(nulled.world.branches.get("B").pts), JSON.stringify(ref.world.branches.get("B").pts), "null resets the geometry exactly");
      const explicit = L.layoutTree(tree, { mode, overrides: new Map([["B", { wave: 0.05, waveFreq: 4, waveFn: "zigzag" }]]) });
      assert.equal(explicit.info.get("B").eff.wave, 0.05);
      assert.equal(explicit.info.get("B").eff.waveFn, "zigzag");
      assert.equal(JSON.stringify(explicit.info.get("B").calc), calcB);
      // geometry: a bigger amplitude displaces the centreline, the base stays, children follow the EFFECTIVE (displaced) centreline
      const straight = withB({ biblio_bwave: "0" });
      const wavy = withB({ biblio_bwave: "0.15", biblio_bwfn: "sine", biblio_bwfreq: "3" });
      const bs = straight.world.branches.get("B");
      const bw = wavy.world.branches.get("B");
      assert.ok(W.dist(bs.pts[0], bw.pts[0]) < 1e-9, "the wave leaves the base point where it was");
      let maxOff = 0;
      for (let i = 0; i < bw.pts.length; i++) {
        const t = bw.cum[i] / bw.total;
        const j = Math.min(bs.pts.length - 1, Math.round(t * (bs.pts.length - 1)));
        maxOff = Math.max(maxOff, W.dist(bw.pts[i], bs.pts[j]));
      }
      assert.ok(maxOff > 0.02 * bw.total, `${mode}: the wavy branch really deviates (${maxOff.toFixed(0)} px of ${bw.total.toFixed(0)})`);
      assert.ok(maxOff < 0.3 * bw.total, "...but never absurdly");
      const kid = wavy.world.branches.get("D");
      assert.equal(kid.parent, "B");
      assert.ok(W.dist(kid.pts[0], W.frameAt(bw, kid.attachS).p) < 1.5, `${mode}: a child grows out of the displaced centreline`);
      assert.ok(W.dist(kid.pts[0], straight.world.branches.get("D").pts[0]) > 1, "...so it moved with the wave");
      for (const l of wavy.leaves) {
        const br = wavy.world.branches.get(l.branchId);
        assert.ok(br && l.s >= 0 && l.s <= br.total + 1e-6, "leaves stay on their branch");
      }
      // rails stay smooth enough for the sim: no sharp turn between neighbouring points
      for (const key of ["sine", "zigzag", "sawtooth", "helix", "sbend", "noise"]) {
        const ly = withB({ biblio_bwave: "0.3", biblio_bwfn: key, biblio_bwfreq: "12" });
        for (const b of ly.world.branches.values()) {
          for (let i = 1; i < b.T.length; i++) assert.ok(W.dot(b.T[i - 1], b.T[i]) > 0.35, `${mode}/${key}/${b.id}: smooth rail at ${i} (${W.dot(b.T[i - 1], b.T[i]).toFixed(2)})`);
        }
        noNaN(ly, `${mode}/wave ${key}`);
      }
      // the sim copes with a violently wavy branch: walk it end to end with auto-align (finite, stays on the tree, a walker makes progress), then fuzz
      for (const key of ["sine", "zigzag", "helix", "noise"]) {
        const ly = withB({ biblio_bwave: "0.2", biblio_bwfn: key, biblio_bwfreq: "6", biblio_blen: "900" });
        const bb = ly.world.branches.get("B");
        const c = S.spawn(ly.world, A("lizard"), "B", 20);
        let s0 = 0;
        for (let i = 0; i < 60 * 20 && c.head.b === "B"; i++) { S.step(ly.world, c, { ...S.NO_INPUT, forward: true }, 1 / 60); s0 = Math.max(s0, c.head.s); }
        assert.ok(s0 > Math.min(bb.total * 0.5, 600), `${mode}/${key}: a lizard walks along the wavy branch (reached ${s0.toFixed(0)} of ${bb.total.toFixed(0)})`);
        let seed2 = 11;
        const r2 = () => ((seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (const an of ["snake", "cat", "ant"]) {
          const c2 = S.spawn(ly.world, A(an), "B", bb.total * 0.3);
          for (let i = 0; i < 60 * 10; i++) {
            S.step(ly.world, c2, { ...S.NO_INPUT, forward: r2() < 0.8, back: r2() < 0.05, left: r2() < 0.25, right: r2() < 0.25, climb: r2() < 0.2 }, 1 / 60);
            assert.ok(fin(c2.head.s, c2.head.th) && ly.world.branches.has(c2.head.b), `${an}: finite state on a wavy branch`);
          }
        }
      }
      // calc never depends on the branch's own wave override (every key in one go)
      const everything = withB({ biblio_bwave: "0.3", biblio_bwfreq: "12", biblio_bwfn: "helix", biblio_blen: "900", biblio_bthick: "40" });
      assert.equal(JSON.stringify(everything.info.get("B").calc), calcB);
    }
    // sanitizeProp / parseOverrides
    assert.equal(L.sanitizeProp("wave", "0.5"), 0.3);
    assert.equal(L.sanitizeProp("waveFreq", "x"), null);
    assert.equal(L.sanitizeProp("waveFn", "ZIGZAG"), "zigzag");
    assert.equal(L.sanitizeProp("waveFn", {}), null);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const junk = () => ["", "x", "1e999", "-0", "1,5", String(rnd() * 1000), "sine", "SAWTOOTH", "\u0000", "null", "😀".repeat(3), String(rnd() - 0.5)][Math.floor(rnd() * 12)];
    for (let i = 0; i < 300; i++) {
      const note = { noteId: "n", title: "n", type: "text", hasChildren: true, labels: { biblio_bwave: junk(), biblio_bwfreq: junk(), biblio_bwfn: junk(), biblio_bspin: junk() } };
      const ov = L.parseOverrides(note);
      for (const [k, v] of Object.entries(ov)) assert.ok(k === "waveFn" ? WV.WAVE_FNS.includes(v) : fin(v), `parse fuzz ${k}`);
    }
    assert.deepEqual(L.parseOverrides(null), {});
    // the editor's planning code: numbers rounded to the step, the calculated value writes nothing, the shape is text
    const lay = withLabels({});
    const note = { noteId: "B", title: "B", type: "text", hasChildren: true, labels: {} };
    const info = lay.info.get("B");
    assert.deepEqual(TE.planChanges(note, info, { wave: info.calc.wave }), [], "the calculated amplitude needs no label");
    assert.deepEqual(TE.planChanges(note, info, { waveFn: info.calc.waveFn }), []);
    assert.deepEqual(TE.planChanges(note, info, { waveFn: info.calc.waveFn === "sine" ? "zigzag" : "sine" }).map((c) => c.name), ["biblio_bwfn"]);
    assert.equal(TE.planChanges(note, info, { wave: 0.1234 })[0].value, "0.123");
    assert.equal(TE.planChanges(note, info, { waveFreq: 3.3 })[0].value, "3.3");
    assert.equal(TE.isEnumKey("waveFn"), true);
    assert.equal(TE.isEnumKey("wave"), false);
    assert.equal(TE.recalcAll({ ...note, labels: { biblio_bwave: "0.1", biblio_bwfn: "sine", other: "x" } }).length, 2);
    assert.ok(L.PROP_RANGES.taper.min <= 0.1, "the taper slider reaches pointed tips");
  }

  // ================= 6. pointed tips =================
  {
    const spec = [
      { id: "A", kids: [...notesN("a", 12), { id: "B", kids: [...notesN("b", 6), { id: "D", kids: notesN("d", 3) }, { id: "E", kids: notesN("e", 4) }] }, { id: "C", kids: notesN("c", 5) }] },
      ...forest(3, 15),
    ];
    const tree = mk(spec);
    for (const mode of ["hub", "forest"]) {
      for (const key of SP.SPECIES_KEYS) {
        const lay = L.layoutTree(tree, { mode, overrides: new Map(Object.keys(tree.notes).filter((id) => tree.notes[id].hasChildren && id !== "root").map((id) => [id, { species: key }])) });
        for (const b of lay.world.branches.values()) {
          if (b.id === "root" || b.root) continue;
          const terminal = W.isTerminal(lay.world, b);
          assert.equal(terminal, b.next.length === 0 && b.side.length === 0, "isTerminal = nothing attached");
          assert.ok(b.rEnd >= 1.2 - 1e-9 && b.rEnd < b.r, `${mode}/${key}/${b.id}: tip ${b.rEnd.toFixed(2)} < start ${b.r.toFixed(2)}, >= 1.2`);
          if (terminal) {
            assert.ok(b.rEnd <= Math.max(1.2, 0.15 * b.r) + 1e-9, `${mode}/${key}/${b.id}: a terminal branch ends in a point (${(b.rEnd / b.r).toFixed(3)} x r)`);
            assert.equal(lay.info.get(b.id).calc.taper, b.rEnd / b.r, "the calculated taper is the pointed one");
          } else {
            assert.ok(b.rEnd >= Math.min(0.9 * b.r, 4) - 1e-9, `${mode}/${key}/${b.id}: a branch carrying sub-folders keeps a thicker end (${b.rEnd.toFixed(1)})`);
          }
        }
      }
    }
    // species-aware: pines / cypresses are sharper than baobabs and oaks on the same twig
    const fat = mk([{ id: "Z", kids: notesN("z", 150) }]);
    const ratio = (key) => { const lay = L.layoutTree(fat, { overrides: new Map([["Z", { species: key }]]) }); const b = lay.world.branches.get("Z"); return b.rEnd / b.r; };
    assert.ok(ratio("pine") < ratio("oak") && ratio("redwood") <= ratio("maple") && ratio("baobab") >= ratio("pine"), "pine/redwood sharper than oak/baobab");
    for (const key of SP.SPECIES_KEYS) assert.ok(ratio(key) >= 0.07 - 1e-9 && ratio(key) <= 0.15 + 1e-9, `${key}: tip ratio ${ratio(key).toFixed(3)} in 0.07..0.15`);
    // a user taper / thickness override still wins (and keeps the 1.2 floor)
    const lay = L.layoutTree(tree, { overrides: new Map([["D", { taper: 0.8 }], ["E", { thickness: 3, taper: 0.05 }]]) });
    assert.ok(Math.abs(lay.world.branches.get("D").rEnd - 0.8 * lay.world.branches.get("D").r) < 1e-9, "explicit taper is honoured");
    assert.equal(lay.world.branches.get("E").rEnd, 1.2, "the floor is 1.2 px");
    // the sim copes with needle-thin tips: every animal near the tip of a twig, random inputs, nothing non-finite, always on something
    const world = L.layoutTree(tree, { mode: "forest" }).world;
    const tip = [...world.branches.values()].filter((b) => b.next.length === 0 && b.side.length === 0 && !b.root && b.id !== "root")[0];
    assert.ok(tip.rEnd < 2.5, `test twig is pointed (${tip.rEnd.toFixed(2)})`);
    let seed = 3;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const an of S.ANIMALS) {
      const c = S.spawn(world, an, tip.id, tip.total - 6);
      for (let i = 0; i < 60 * 12; i++) {
        S.step(world, c, { ...S.NO_INPUT, forward: rnd() < 0.8, left: rnd() < 0.3, right: rnd() < 0.3, back: rnd() < 0.05, leap: rnd() < 0.01, reach: rnd() < 0.05 }, 1 / 60);
        const h = c.head;
        assert.ok(fin(h.s, h.th) && world.branches.has(h.b) || c.air || c.flight, `${an.id}: finite state near the tip`);
        for (const n of c.trail.slice(-3)) assert.ok(fin(n.p.x, n.p.y, n.p.z), `${an.id}: finite trail`);
      }
    }
  }

  // ================= 7. hub mode is unchanged; perf =================
  {
    const tree = mk(forest(5, 6));
    const hubDefault = L.layoutTree(tree);
    const hubExplicit = L.layoutTree(tree, { mode: "hub" });
    assert.equal(JSON.stringify([...hubDefault.world.branches.values()].map((b) => [b.id, b.pts])), JSON.stringify([...hubExplicit.world.branches.values()].map((b) => [b.id, b.pts])));
    const hub = hubDefault.world.branches.get("root");
    assert.equal(hub.next.length, 5);
    assert.equal(hub.side.length, 0);
    for (const id of hub.next) {
      const t = hubDefault.world.branches.get(id);
      assert.equal(t.parent, "root");
      assert.ok(W.dist(t.pts[0], hub.pts.at(-1)) < 1e-9, "hub trunks start at the hub's END");
      assert.ok(t.T.at(-1).y > 0.9, "and arch up");
    }
    const big = (n) => mk(Array.from({ length: Math.ceil(n / 12) }, (_, i) => ({ id: "t" + i, kids: [...notesN("n" + i + "_", 6), { id: "u" + i, kids: notesN("m" + i + "_", 5) }] })));
    for (const [n, budget] of [[400, 1000], [1500, 2500]]) {
      for (const mode of ["hub", "forest"]) {
        const t0 = performance.now();
        const lay = L.layoutTree(big(n), { mode });
        const ms = performance.now() - t0;
        assert.ok(ms < budget, `${mode}: ${n} notes lay out in ${ms.toFixed(0)} ms (< ${budget})`);
        noNaN(lay, `${mode}/${n}`);
      }
    }
  }
};
