// Unit checks for the performance work: tree/perf.ts (profiles, frame statistics, the adaptive resolution controller, the fps cap) and
// tree/leafindex.ts (the precomputed nearest-leaf lookup) + the silk change counter. Run by tools/unit-test.mjs (it loads every tools/unit-*.mjs).
export default async ({ bundle, assert }) => {
  const P = await bundle("src/tree/perf.ts", "perf-unit.mjs");
  const LI = await bundle("src/tree/leafindex.ts", "leafindex-unit.mjs");
  const L = await bundle("src/tree/layout.ts", "layout-perf.mjs");
  const W = await bundle("src/tree/world3.ts", "world-perf.mjs");
  const SK = await bundle("src/tree/silk.ts", "silk-perf.mjs");

  // 1. profiles
  assert.equal(P.parsePerfProfile("fast"), "fast");
  assert.equal(P.parsePerfProfile("turbo"), "auto", "garbage -> the default");
  assert.equal(P.parsePerfProfile(null), "auto");
  assert.equal(P.DEFAULT_PERF_PROFILE, "auto");
  assert.equal(P.nextPerfProfile("quality"), "auto");
  assert.equal(P.nextPerfProfile("fast"), "quality", "cycles");
  // MSAA: quality always; auto only when the effective ratio is <= 1.25; fast never
  assert.equal(P.useMsaa("quality", 3), true);
  assert.equal(P.useMsaa("auto", 1), true);
  assert.equal(P.useMsaa("auto", 1.25), true);
  assert.equal(P.useMsaa("auto", 2), false, "a high-DPI screen at ratio 1.5 does without MSAA");
  assert.equal(P.useMsaa("fast", 1), false);
  assert.equal(P.useMsaa("auto", NaN), true, "garbage ratio = 1");
  // pixel ratio
  assert.equal(P.effectivePixelRatio("quality", 3, 1), 2, "quality caps at 2");
  assert.equal(P.effectivePixelRatio("auto", 3, 1), 1.5);
  assert.equal(P.effectivePixelRatio("auto", 1, 1), 1, "a 1x screen is never upscaled");
  assert.equal(P.effectivePixelRatio("fast", 2, 0.5), 0.5);
  assert.ok(P.effectivePixelRatio("fast", 2, 0) >= 0.25 && P.effectivePixelRatio("fast", 2, NaN) === 1 && P.effectivePixelRatio("auto", 0, 1) === 1, "never zero, NaN-safe");
  for (const prof of P.PERF_PROFILES) {
    const s = P.PROFILE[prof];
    assert.ok(s.dprCap >= 1 && s.minScale > 0 && s.minScale <= 1 && s.maxFps >= 0, `${prof}: sane settings`);
  }
  assert.equal(P.PROFILE.quality.adaptive, false, "quality = the old behaviour: nothing automatic");

  // 2. the frame-rate cap (scheduled: the average equals the cap whatever the display's refresh rate)
  {
    const fpsOf = (hz, cap, seconds = 10, jitter = 0) => {
      const lim = new P.FrameLimiter(cap);
      let rendered = 0, seed = 5;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let t = 0; t < seconds * 1000; t += 1000 / hz) if (lim.shouldRender(t + (rnd() - 0.5) * jitter)) rendered++;
      return rendered / seconds;
    };
    assert.equal(fpsOf(144, 0), 144, "no cap renders every frame");
    for (const hz of [60, 75, 90, 120, 144, 165, 240]) {
      const f = fpsOf(hz, 60);
      assert.ok(f >= (hz === 75 ? 59 : 58) && f <= 61, `${hz} Hz under a 60 fps cap renders ${f} fps`);
      if (hz === 60) assert.ok(Math.abs(f - 60) < 0.2, "a 60 Hz screen loses no frames");
    }
    assert.ok(Math.abs(fpsOf(60, 60, 10, 1.2) - 60) <= 1.2, "60 Hz with 1.2 ms of timer jitter still renders ~60 fps");
    for (const hz of [60, 144]) assert.ok(Math.abs(fpsOf(hz, 30) - 30) <= 1, `${hz} Hz under a 30 fps cap`);
    const lim = new P.FrameLimiter(60);
    assert.equal(lim.shouldRender(0), true);
    assert.equal(lim.shouldRender(NaN), true, "garbage renders");
    assert.equal(lim.shouldRender(2), false);
    // after a long stall it restarts the schedule (no burst of catch-up frames)
    assert.equal(lim.shouldRender(60000), true);
    assert.equal(lim.shouldRender(60001), false);
    assert.equal(lim.shouldRender(60017), true);
    lim.setMaxFps(0);
    assert.equal(lim.shouldRender(60018), true);
  }

  // 3. frame statistics
  {
    const c = new P.FrameClock(90);
    assert.deepEqual(c.summary(), { fps: 0, avgFrameMs: 0, p95FrameMs: 0, avgCpuMs: 0, avgRenderMs: 0, samples: 0 }, "empty");
    for (let i = 0; i < 200; i++) c.push(16.67, 4, 2);
    const s = c.summary();
    assert.equal(s.samples, 90, "rolling window");
    assert.ok(Math.abs(s.fps - 60) < 0.1 && Math.abs(s.avgCpuMs - 4) < 1e-9 && Math.abs(s.avgRenderMs - 2) < 1e-9);
    c.push(NaN, 1, 1); c.push(-5, 1, 1); c.push(0, 1, 1); c.push(5000, 1, 1); // garbage / a stalled tab: ignored
    assert.equal(c.summary().samples, 90);
    c.reset();
    for (let i = 0; i < 100; i++) c.push(i < 95 ? 10 : 50, 1, 1); // the last 90: 85 x 10 ms + 5 x 50 ms
    const r = c.summary();
    assert.ok(r.p95FrameMs >= 10 && r.p95FrameMs <= 50 && r.avgFrameMs > 10);
    c.reset();
    c.push(10, NaN, -3);
    assert.equal(c.summary().avgCpuMs, 0, "garbage cpu / render time -> 0");
  }
  // diagnosis
  const sm = (frame, cpu, n = 60) => ({ fps: 1000 / frame, avgFrameMs: frame, p95FrameMs: frame, avgCpuMs: cpu, avgRenderMs: 1, samples: n });
  assert.equal(P.diagnose(sm(16.7, 4, 5), 60), "no data");
  assert.equal(P.diagnose(sm(16.7, 4), 60), "ok");
  assert.equal(P.diagnose(sm(40, 5), 60), "gpu-bound", "long frames, short JS");
  assert.equal(P.diagnose(sm(40, 30), 60), "cpu-bound", "long frames, JS is most of it");
  assert.equal(P.diagnose(sm(33, 4), 30), "ok", "under a 30 fps cap 33 ms is on time");

  // 4. the adaptive resolution controller
  const run = (ctrl, frameMsAt, seconds, startT = 0, stepMs = 250) => {
    let changes = 0, t = startT, prev = ctrl.scale, slowTime = 0;
    for (; t < startT + seconds * 1000; t += stepMs) {
      const ms = frameMsAt(ctrl.scale);
      if (ms > 21) slowTime += stepMs;
      const sc = ctrl.update(ms, t);
      if (sc !== prev) { changes++; prev = sc; }
    }
    return { changes, t, slowTime, scale: ctrl.scale };
  };
  {
    const a = new P.AdaptiveScale(0.6);
    assert.equal(a.scale, 1);
    assert.equal(a.update(NaN, 0), 1); assert.equal(a.update(-1, 10), 1); assert.equal(a.update(0, 20), 1); assert.equal(a.update(30, NaN), 1);
    // a steady 17 ms (a clean 60 fps) at full scale: nothing changes
    assert.equal(run(a, () => 17, 60).changes, 0);
    // constantly slow (60 ms whatever the scale): steps down one at a time, respecting the cooldown, stops at the floor (0.6)
    const b = new P.AdaptiveScale(0.6);
    const times = [];
    let last = 1;
    for (let t = 0; t < 30000; t += 250) { const s = b.update(60, t); if (s !== last) { times.push(t); last = s; } }
    assert.equal(b.scale, 0.6, "stops at the profile's floor");
    assert.equal(b.atFloor, true);
    assert.deepEqual(P.SCALE_STEPS.filter((x) => x >= 0.6), [1, 0.85, 0.72, 0.6]);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1200, "a change at most every 1.2 s");
    assert.ok(times[0] >= 700, "slow for 0.7 s before the first step down");
    assert.equal(times.length, 3);
    // the same with the 'fast' floor 0.5
    const f = new P.AdaptiveScale(0.5);
    run(f, () => 60, 40);
    assert.equal(f.scale, 0.5);
    // a short stutter (0.4 s) does not trigger anything
    const g = new P.AdaptiveScale(0.6);
    for (let t = 0; t < 400; t += 100) g.update(80, t);
    g.update(16, 500);
    assert.equal(g.scale, 1);
    // after going down, clean frames bring it back up, but only after 5 s
    const h = new P.AdaptiveScale(0.6);
    run(h, () => 60, 3);
    const low = h.scale;
    assert.ok(low < 1);
    const up = run(h, () => 15, 4, 3000);
    assert.equal(h.scale, low, "not yet: 4 s of clean frames");
    run(h, () => 15, 30, up.t);
    assert.equal(h.scale, 1, "back at full resolution after a clean stretch");
    // in-between frame times (17.6..21 ms) hold the scale
    const k = new P.AdaptiveScale(0.6);
    run(k, () => 60, 3);
    const held = k.scale;
    run(k, () => 19.5, 60, 3000);
    assert.equal(k.scale, held);
    // minScale can be tightened later: the current step is clamped
    const m = new P.AdaptiveScale(0.5);
    run(m, () => 60, 40);
    assert.equal(m.scale, 0.5);
    m.setMinScale(0.85);
    assert.equal(m.scale, 0.85);
    m.reset();
    assert.equal(m.scale, 1);
  }
  // a system where the frame time depends on the scale (30 ms x scale^2): the controller settles, it does not oscillate forever
  {
    const a = new P.AdaptiveScale(0.5);
    const r = run(a, (s) => 30 * s * s, 240);
    assert.ok(r.changes <= 12, `settles: ${r.changes} changes in 4 minutes`);
    assert.ok(r.slowTime <= 240 * 1000 * 0.12, `rarely slow: ${(r.slowTime / 1000).toFixed(1)} s of 240`);
    assert.ok(a.scale === 0.72 || a.scale === 0.85, `ends where frames are on time: ${a.scale}`);
    // it ends on a scale whose frame time is acceptable
    assert.ok(30 * a.scale * a.scale <= 21 || a.scale === 0.5);
  }
  // a system that is fast at any scale never leaves 1
  {
    const a = new P.AdaptiveScale(0.5);
    assert.equal(run(a, () => 16, 120).changes, 0);
  }

  // 5. leaf index = the old per-leaf scan, precomputed
  const mkTree = (nTrees, notes) => {
    const ns = { root: { noteId: "root", title: "root", type: "text", labels: {}, hasChildren: true } };
    const edges = [];
    for (let t = 0; t < nTrees; t++) {
      const f = { noteId: "F" + t, title: "F" + t, type: "text", labels: {}, hasChildren: true };
      ns[f.noteId] = f; edges.push({ parentNoteId: "root", noteId: f.noteId, notePosition: 0 });
      for (let i = 0; i < notes; i++) {
        const n = { noteId: `n${t}_${i}`, title: `n${t}_${i}`, type: "text", labels: {}, hasChildren: false };
        ns[n.noteId] = n; edges.push({ parentNoteId: f.noteId, noteId: n.noteId, notePosition: 0 });
      }
    }
    return { rootNoteId: "root", notes: ns, edges, truncated: false };
  };
  for (const [nt, nn] of [[0, 0], [1, 3], [4, 12], [9, 30]]) {
    const lay = L.layoutTree(mkTree(nt, nn), { mode: "forest" });
    const OFF = 21;
    const idx = LI.buildLeafIndex(lay.world, lay.leaves, OFF);
    assert.equal(idx.leaves.length, lay.leaves.length, "every leaf with a branch is indexed");
    assert.equal(idx.x.length, idx.leaves.length);
    // brute force = the old nearestLeaf
    const brute = (hx, hy, hz, maxDist) => {
      let best = null, bd = maxDist;
      for (const leaf of lay.leaves) {
        const b = lay.world.branches.get(leaf.branchId);
        if (!b) continue;
        const lp = W.surfacePoint(b, leaf.s, leaf.th, OFF).p;
        const d = Math.hypot(lp.x - hx, lp.y - hy, lp.z - hz);
        if (d < bd) { bd = d; best = leaf; }
      }
      return best;
    };
    let seed = 11 + nt;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pts = lay.leaves.length ? lay.leaves.flatMap((l) => { const b = lay.world.branches.get(l.branchId); const p = W.surfacePoint(b, l.s, l.th, OFF).p; return [[p.x + 3, p.y, p.z], [p.x + 400 * (rnd() - 0.5), p.y + 300 * (rnd() - 0.5), p.z + 400 * (rnd() - 0.5)]]; }) : [[0, 0, 0], [999, 999, 999]];
    for (const [x, y, z] of pts) for (const md of [70, 5, 1000]) {
      const a = LI.nearestLeafTo(idx, x, y, z, md);
      const b = brute(x, y, z, md);
      assert.equal(a?.id ?? null, b?.id ?? null, `nearest leaf at (${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)}) within ${md}`);
    }
    assert.equal(LI.nearestLeafTo(idx, 1e9, 1e9, 1e9, 70), null, "nothing near");
  }
  {
    // leaves of a branch that is gone are skipped; NaN positions are skipped; an empty index is fine
    const lay = L.layoutTree(mkTree(2, 4), { mode: "forest" });
    const ghost = { ...lay.leaves[0], id: "ghost", branchId: "nope" };
    const idx = LI.buildLeafIndex(lay.world, [ghost, ...lay.leaves], 21);
    assert.equal(idx.leaves.length, lay.leaves.length);
    assert.equal(LI.nearestLeafTo(LI.buildLeafIndex(lay.world, [], 21), 0, 0, 0, 100), null);
  }

  // 6. the silk change counter moves exactly when threads change
  {
    SK.clearSilks();
    const v0 = SK.silkVersion();
    SK.clearSilks();
    assert.ok(SK.silkVersion() > v0, "clearing changes it");
    const lay = L.layoutTree(mkTree(1, 2), { mode: "forest" });
    const v1 = SK.silkVersion();
    SK.applySilks(lay.world);
    assert.ok(SK.silkVersion() > v1, "re-applying the threads to a rebuilt world changes it");
    const trunk = [...lay.world.branches.values()].find((b) => b.id === "F0");
    const v2 = SK.silkVersion();
    const br = SK.addSilk(lay.world, { id: SK.newSilkId(), ref: { b: trunk.id, s: trunk.total * 0.5, th: 0 }, end: { kind: "free", dx: 0, dy: -80, dz: 0 } });
    assert.ok(br && SK.silkVersion() > v2, "a new thread changes it");
    const v3 = SK.silkVersion();
    SK.addSilk(lay.world, { id: SK.newSilkId(), ref: { b: "missing", s: 1, th: 0 }, end: { kind: "free", dx: 0, dy: -80, dz: 0 } });
    assert.equal(SK.silkVersion(), v3, "a rejected thread does not");
    SK.clearSilks();
  }
};
