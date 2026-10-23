// Unit checks for round 5, stream 5 ("movement"): the GUIDED move mode (W up the branch, S down, A/D turn on it, smooth curves) and the
// untouched FREE mode. Run by tools/unit-test.mjs (it loads every tools/unit-<name>.mjs): `export default async ({ bundle, assert }) => { ... }`.
// All deterministic: fixed 1/60 s steps, a seeded LCG for the fuzz.

export default async ({ bundle, assert }) => {
  const S = await bundle("src/tree/sim3.ts", "s-move.mjs");
  const W = await bundle("src/tree/world3.ts", "w-move.mjs");
  const L = await bundle("src/tree/layout.ts", "layout-move.mjs");
  const fin = (...xs) => xs.every(Number.isFinite);
  const A = (id) => S.ANIMALS.find((a) => a.id === id);
  const DT = 1 / 60;
  const idle = S.NO_INPUT;
  const WALKERS = ["lizard", "cat", "squirrel", "ant", "spider", "jumper", "snake", "mite"];
  const ALL = S.ANIMALS.map((a) => a.id);
  const W_ = { forward: true }, S_ = { back: true }, A_ = { left: true }, D_ = { right: true };
  const run = (w, c, keys, secs, each) => {
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) {
      S.step(w, c, { ...idle, ...keys }, DT);
      if (each) each(i);
    }
  };
  const V = (x, y, z) => W.v3(x, y, z);
  // one straight branch of radius r along +x / +y / -y (3 km long, `groundY` far below)
  const straight = (r, dir = "x", id = "b") => {
    const w = { branches: new Map(), groundY: -9000 };
    const pts = [];
    for (let i = 0; i <= 80; i++) pts.push(dir === "x" ? V(i * 50, 0, 0) : dir === "y" ? V(0, i * 50, 0) : V(0, -i * 50, 0));
    W.addBranch(w, W.makeBranch(id, pts, r));
    return w;
  };
  const guided = (w, id, bid, s, th = 0) => {
    const c = S.spawn(w, A(id), bid, s, "guided");
    c.head.th = th;
    return c;
  };
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
  const notesN = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: `${tag}n${i}` }));
  const treeSpec = (n) => Array.from({ length: n }, (_, i) => ({ id: "F" + i, kids: [...notesN("x" + i, 6), { id: "G" + i, kids: notesN("g" + i, 3) }] }));
  const forest = L.layoutTree(mkTree(treeSpec(4)), { mode: "forest" });
  const hub = L.layoutTree(mkTree(treeSpec(4)));
  const demo = W.makeDemoWorld();
  const worlds = { demo, forest: forest.world, hub: hub.world };
  const num = (x, d = 2) => Number(x.toFixed(d));
  const numbers = {};

  // ================= 1. defaults, the two modes, the pure sim stays free =================
  {
    assert.equal(S.DEFAULT_MOVE_MODE, "guided", "the app default is guided");
    assert.deepEqual([...S.MOVE_MODES].sort(), ["free", "guided"]);
    const c = S.spawn(demo, A("lizard"), "trunk", 300);
    assert.equal(c.moveMode, "free", "spawn() itself stays free (the old sim tests keep their meaning)");
    assert.equal(S.spawn(demo, A("lizard"), "trunk", 300, "guided").moveMode, "guided");
    assert.ok(fin(c.omega, c.swing) && c.omega === 0 && c.swing === 0);
    // free mode, exactly as before: A/D steer phi at turnRate x width rule, S does not walk, no auto turn in A/D, auto-align straightens
    const w = straight(60);
    const f2 = S.spawn(w, A("lizard"), "b", 1000);
    run(w, f2, D_, 0.5);
    const widthRule = Math.min(1, Math.max(0.3, 60 / (2 * Math.max(...A("lizard").nodes.map((n) => n.w)) * 2.2)));
    assert.ok(Math.abs(f2.phi - A("lizard").turnRate * widthRule * 0.5) < 0.02, `free: D turns phi at turnRate x the width rule (${f2.phi.toFixed(3)})`);
    const s0 = f2.head.s;
    run(w, f2, S_, 1);
    assert.ok(Math.abs(f2.head.s - s0) < 1e-9, "free: S does not walk");
    run(w, f2, W_, 1.5);
    assert.ok(Math.abs(f2.phi) < 0.05, `free: auto-align straightens while walking (${f2.phi.toFixed(3)})`);
    assert.equal(f2.omega, 0, "free mode never touches the guided state");
  }

  // ================= 2. W up (tip-ward) at the expected speed, S down after turning round =================
  const revTimes = {};
  for (const id of ALL) {
    const an = A(id);
    const w = straight(30);
    const c = guided(w, id, "b", 2000);
    c.gripOn = false;
    run(w, c, W_, 0.6);
    const s0 = c.head.s;
    run(w, c, W_, 2);
    const v = (c.head.s - s0) / 2;
    assert.ok(Math.abs(v - an.speed) < an.speed * 0.03, `${id}: W walks tip-ward at its speed (${v.toFixed(1)} vs ${an.speed.toFixed(1)})`);
    assert.ok(Math.abs(c.phi) < 0.02 && Math.abs(c.head.th) < 0.02, `${id}: straight up the branch`);
    // S: swing round within 1.5 s (heading within 0.35 rad of base-ward), then walk base-ward at full speed
    let tRev = -1;
    let maxOm = 0, maxDphi = 0, maxDom = 0, prevPhi = c.phi, prevOm = c.omega;
    run(w, c, S_, 1.5, (i) => {
      if (tRev < 0 && Math.abs(Math.abs(c.phi) - Math.PI) < 0.35) tRev = (i + 1) * DT;
      maxOm = Math.max(maxOm, Math.abs(c.omega));
      maxDphi = Math.max(maxDphi, Math.abs(S_wrap(c.phi - prevPhi)));
      maxDom = Math.max(maxDom, Math.abs(c.omega - prevOm));
      prevPhi = c.phi;
      prevOm = c.omega;
    });
    assert.ok(tRev > 0 && tRev <= 1.5, `${id}: reverses within 1.5 s by holding S (${tRev})`);
    revTimes[id] = tRev;
    // the curve is smooth: the heading never jumps (<= rate x dt per frame) and the angular velocity changes gradually
    assert.ok(maxDphi <= maxOm * DT * 1.05 + 1e-9 && maxOm <= an.turnRate * S.GUIDED.gain + 1e-9, `${id}: heading step ${maxDphi.toFixed(4)} within the turn rate (peak ${maxOm.toFixed(2)} rad/s)`);
    assert.ok(maxDom <= S.GUIDED.ease * DT * maxOm * 1.3 + 0.02, `${id}: angular velocity changes smoothly (max step ${maxDom.toFixed(3)})`);
    run(w, c, S_, 0.5);
    const s1 = c.head.s;
    run(w, c, S_, 2);
    const vb = (s1 - c.head.s) / 2;
    assert.ok(Math.abs(vb - an.speed) < an.speed * 0.03, `${id}: S walks base-ward at full speed (${vb.toFixed(1)})`);
    assert.ok(Math.abs(Math.abs(c.phi) - Math.PI) < 0.02, `${id}: ... straight down`);
  }
  function S_wrap(a) { return W.wrapAngle(a); }
  numbers.reverse = revTimes;

  // ================= 3. A / D turn as the animal sees it (W and S, flat top, vertical pole, a branch pointing DOWN) =================
  {
    const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    for (const [name, dir, th0] of [["flat", "x", 0], ["flat side", "x", 1.0], ["pole", "y", 0.4], ["down-pointing", "-y", 2.0]]) {
      for (const id of ["lizard", "snake", "ant"]) {
        for (const [keys0, label] of [[W_, "W"], [S_, "S"]]) {
          for (const [side, key, sign] of [["D", D_, 1], ["A", A_, -1]]) {
            const w = straight(40, dir);
            const c = guided(w, id, "b", dir === "-y" ? 1500 : 1500, th0);
            c.gripOn = false;
            run(w, c, keys0, 1.2); // settle the heading (S: turned round)
            const h0 = S.headingVector(w, c), n0 = S.headNormal(w, c);
            const p0 = S.bodyPoint(c, 0).p;
            run(w, c, { ...keys0, ...key }, 1.0);
            const p1 = S.bodyPoint(c, 0).p;
            const right = cross(h0, n0); // facing h0 with the surface normal as "up"
            const d = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
            const lateral = (d.x * right.x + d.y * right.y + d.z * right.z) * sign;
            assert.ok(lateral > 3, `${id} on ${name}: ${label}+${side} bends to the ${side === "D" ? "right" : "left"} as it faces (${lateral.toFixed(1)} px)`);
          }
        }
      }
    }
    // along-branch semantics: W on a branch that points DOWN walks down the world (tip-ward), S walks back up; the demo's vertical "climb" branch too
    const w = straight(40, "-y");
    const c = guided(w, "lizard", "b", 1500, 0);
    const y0 = S.bodyPoint(c, 0).p.y;
    run(w, c, W_, 1.5);
    assert.ok(S.bodyPoint(c, 0).p.y < y0 - 100, "W on a down-pointing branch goes tip-ward = down the world");
    run(w, c, S_, 3);
    assert.ok(S.bodyPoint(c, 0).p.y > y0 - 100, "S comes back up toward the base");
  }

  // ================= 4. A/D release: the heading eases back along the axis, nothing keeps spiralling =================
  for (const id of ["lizard", "snake", "cat", "ant"]) {
    for (const [keys, axis, name] of [[{ ...W_, ...D_ }, 0, "W+D"], [{ ...W_, ...A_ }, 0, "W+A"], [{ ...S_, ...D_ }, Math.PI, "S+D"], [{ ...S_, ...A_ }, Math.PI, "S+A"], [D_, 0, "D alone"], [A_, 0, "A alone"]]) {
      const w = straight(40);
      const c = guided(w, id, "b", 2000, 0);
      c.gripOn = false;
      if (axis) run(w, c, S_, 1.5);
      run(w, c, keys, 1.5);
      const off = Math.abs(S_wrap(c.phi - axis));
      assert.ok(off > 0.1, `${id} ${name}: bends off the axis while held (${off.toFixed(2)})`);
      assert.ok(off < 1.4, `${id} ${name}: stays under the creep angle (${off.toFixed(2)})`);
      run(w, c, idle, 1.2);
      assert.ok(Math.abs(S_wrap(c.phi - axis)) < 0.02 && Math.abs(c.omega) < 0.05, `${id} ${name}: released -> back along the axis (${S_wrap(c.phi - axis).toFixed(3)})`);
      const th1 = c.head.th, s1 = c.head.s;
      run(w, c, idle, 2);
      assert.ok(Math.abs(c.head.th - th1) < 1e-6 && Math.abs(c.head.s - s1) < 1, `${id} ${name}: and then it stands still`);
      // and walking on goes straight (no residual spiral)
      run(w, c, axis ? S_ : W_, 0.4);
      const th2 = c.head.th;
      run(w, c, axis ? S_ : W_, 1.5);
      assert.ok(Math.abs(S_wrap(c.head.th - th2)) < 0.01, `${id} ${name}: walks straight afterwards (th drift ${S_wrap(c.head.th - th2).toFixed(4)})`);
    }
  }

  // ================= 5. A/D alone: creep round the bark to the underside and deliberately back =================
  {
    for (const id of ["lizard", "snake", "ant", "spider"]) {
      const w = straight(40);
      const c = guided(w, id, "b", 2000, 0);
      c.gripOn = false;
      let t = 0;
      for (; t < 30 * 60 && Math.abs(c.head.th) < 2.9; t++) S.step(w, c, { ...idle, ...A_ }, DT);
      assert.ok(Math.abs(c.head.th) >= 2.9, `${id}: A alone reaches the underside (${(t * DT).toFixed(1)} s)`);
      assert.ok(Math.abs(c.head.s - 2000) < 200, `${id}: ... without wandering far along the branch (${(c.head.s - 2000).toFixed(0)} px)`);
      let t2 = 0;
      for (; t2 < 40 * 60 && Math.abs(c.head.th) > 0.15; t2++) S.step(w, c, { ...idle, ...D_ }, DT);
      assert.ok(Math.abs(c.head.th) <= 0.15, `${id}: D brings it back to the top (${(t2 * DT).toFixed(1)} s)`);
      numbers["creep_" + id] = num(t * DT, 1);
    }
    // the grip rules still apply: creeping onto a horizontal underside drains the grip and the lizard finally slips off
    const w = straight(40);
    const c = guided(w, "lizard", "b", 2000, 0);
    let minGrip = 1, fell = false;
    for (let i = 0; i < 40 * 60 && Math.abs(c.head.th) < 2.6; i++) S.step(w, c, { ...idle, ...A_ }, DT);
    for (let i = 0; i < 12 * 60 && !fell; i++) { // staying on the underside
      S.step(w, c, idle, DT);
      minGrip = Math.min(minGrip, c.grip);
      fell = !!c.air;
    }
    assert.ok(minGrip < 0.3 && fell, `grip rules unchanged: standing on the underside drains (${minGrip.toFixed(2)}) and the lizard slips`);
    // the cat keeps its maxTh whatever the mode
    const wc = straight(40);
    const c2 = guided(wc, "cat", "b", 2000, 0);
    run(wc, c2, A_, 10, () => assert.ok(Math.abs(c2.head.th) <= A("cat").maxTh + 1e-9, "cat: |th| <= maxTh"));
    run(wc, c2, D_, 10, () => assert.ok(Math.abs(c2.head.th) <= A("cat").maxTh + 1e-9, "cat: |th| <= maxTh (D)"));
    assert.ok(Math.abs(c2.head.th) > 1, "the cat creeps up to its limit");
  }

  // ================= 6. alternating A/D with W: no net spiral drift =================
  {
    for (const [r, id] of [[8, "lizard"], [40, "lizard"], [8, "ant"], [40, "snake"], [12, "cat"]]) {
      const w = straight(r);
      const c = guided(w, id, "b", 400);
      c.gripOn = false;
      let maxTh = 0;
      for (let k = 0; k < 40; k++) {
        const keys = k % 2 ? { ...W_, ...A_ } : { ...W_, ...D_ };
        run(w, c, keys, 0.45, () => (maxTh = Math.max(maxTh, Math.abs(c.head.th))));
      }
      assert.ok(maxTh < 1.6, `${id} r=${r}: alternating W+A / W+D 0.45 s keeps th bounded (${maxTh.toFixed(2)})`);
      assert.ok(Math.abs(c.head.th) < 1.3, `${id} r=${r}: ... and ends near where it began`);
      // tapping A/D now and then while walking: the heading goes back to the axis, no accumulating spiral
      const c2 = guided(w, id, "b", 400);
      c2.gripOn = false;
      for (let k = 0; k < 20; k++) {
        run(w, c2, { ...W_, ...(k % 3 ? A_ : D_) }, 0.12);
        run(w, c2, W_, 0.6);
      }
      assert.ok(Math.abs(c2.phi) < 0.05, `${id} r=${r}: after the taps it walks straight again (${c2.phi.toFixed(3)})`);
    }
  }

  // ================= 7. reversing 50 times never gets stuck (flat branch, demo world, forest and hub worlds) =================
  {
    const reversals = (w, c, n, what) => {
      for (let k = 0; k < n; k++) {
        const want = k % 2 ? 0 : Math.PI; // S first, then W, ...
        const keys = k % 2 ? W_ : S_;
        let tAlign = -1;
        run(w, c, keys, 1.5, (i) => {
          if (tAlign < 0 && Math.abs(Math.abs(S_wrap(c.phi - want))) < 0.35) tAlign = (i + 1) * DT;
        });
        assert.ok(tAlign > 0 && tAlign <= 1.5, `${what}: reversal ${k} aligned within 1.5 s (${tAlign})`);
        assert.ok(!c.air && fin(c.head.s, c.head.th, c.phi, c.omega), `${what}: still on the branch after reversal ${k}`);
        run(w, c, keys, 0.6);
      }
    };
    for (const id of ["lizard", "cat", "snake", "ant", "spider"]) {
      const w = straight(30);
      const c = guided(w, id, "b", 2000);
      c.gripOn = false;
      run(w, c, W_, 0.5);
      reversals(w, c, 50, `${id} flat`);
    }
    // in the worlds, with junctions in the way (a reversal near a fork may transfer branch; it must still turn round in time)
    for (const [name, w, bid, s] of [["demo", demo, "trunk", 1000], ["forest", forest.world, "F1", 300], ["hub", hub.world, "F2", 300]]) {
      for (const id of ["lizard", "snake", "spider"]) {
        const c = guided(w, id, bid, s);
        run(w, c, W_, 0.5);
        reversals(w, c, 50, `${id} ${name}`);
      }
    }
    // a U-turn swings over the TOP side of the bark whichever way the animal faces (it moves toward the top, never down the flank), and a long
    // series of reversals does not spiral: th stays bounded and the net drift per reversal pair is small (also on a twig)
    for (const [phi0, keys] of [[0, S_], [Math.PI, W_]]) {
      for (const th0 of [1.0, -1.0, 2.0, -2.0]) {
        const w = straight(30);
        const c = guided(w, "lizard", "b", 2000, th0);
        c.gripOn = false;
        c.phi = phi0;
        run(w, c, keys, 2);
        assert.ok(Math.abs(c.head.th) < Math.abs(th0) - 0.1, `U-turn from phi ${phi0.toFixed(2)} at th ${th0}: swings toward the top (th ${c.head.th.toFixed(2)})`);
      }
    }
    for (const [r, id] of [[12, "lizard"], [30, "lizard"], [30, "snake"], [6, "cat"]]) {
      const w = straight(r);
      const c = guided(w, id, "b", 2000);
      c.gripOn = false;
      let maxTh = 0, first = null;
      for (let k = 0; k < 50; k++) {
        run(w, c, k % 2 ? W_ : S_, 2.1);
        maxTh = Math.max(maxTh, Math.abs(c.head.th));
        if (k === 1) first = c.head.th;
      }
      assert.ok(maxTh < 1.7, `${id} r=${r}: 50 reversals keep th bounded (${maxTh.toFixed(2)})`);
      assert.ok(Math.abs(S_wrap(c.head.th - first)) < 0.3, `${id} r=${r}: and do not accumulate a spiral (${S_wrap(c.head.th - first).toFixed(2)} rad after 48 more)`);
    }
    // W at the tip just stops (nothing invented), S from there walks back
    const w = straight(20);
    const c = guided(w, "lizard", "b", 3900);
    c.gripOn = false;
    run(w, c, W_, 5);
    assert.ok(Math.abs(c.head.s - 4000) < 1e-6 && c.head.b === "b", "W at the tip of a branch just stops");
    run(w, c, S_, 3);
    assert.ok(c.head.s < 3700, "and S walks back from the tip");
  }

  // ================= 8. thin vs thick branches: the turn rate follows the width rule (and never exceeds the cap) =================
  {
    const rows = {};
    for (const id of ["lizard", "cat", "snake", "ant", "spider", "jumper", "squirrel"]) {
      const an = A(id);
      const peak = (r) => {
        const w = straight(r);
        const c = guided(w, id, "b", 2000);
        c.gripOn = false;
        run(w, c, W_, 0.5);
        let p = 0;
        run(w, c, S_, 1.5, () => (p = Math.max(p, Math.abs(c.omega))));
        return p;
      };
      const thin = peak(3), mid = peak(14), thick = peak(80);
      assert.ok(thin <= mid + 1e-9 && mid <= thick + 1e-9, `${id}: thinner branch -> slower turning (${thin.toFixed(2)} <= ${mid.toFixed(2)} <= ${thick.toFixed(2)})`);
      assert.ok(thick <= an.turnRate * S.GUIDED.gain + 1e-9, `${id}: never above turnRate x gain`);
      assert.ok(thin >= an.turnRate * S.GUIDED.gain * S.GUIDED.floor * 0.9, `${id}: the thin-branch floor keeps it able to turn (${thin.toFixed(2)})`);
      rows[id] = [num(thin), num(thick)];
    }
    numbers.peakTurn = rows;
    // a fat animal on a twig does not corkscrew: the whole U-turn moves it round the bark by far less than the free mode's spiral
    const w = straight(3);
    const c = guided(w, "lizard", "b", 2000);
    c.gripOn = false;
    run(w, c, W_, 0.5);
    let thMax = 0, th0 = c.head.th, travel = 0, prev = th0;
    run(w, c, S_, 1.5, () => { travel += Math.abs(S_wrap(c.head.th - prev)); prev = c.head.th; thMax = Math.max(thMax, Math.abs(S_wrap(c.head.th - th0))); });
    assert.ok(travel < 2.6, `a lizard on a 3 px twig turns round with < 2.6 rad of corkscrew (${travel.toFixed(2)})`);
    numbers.twigCorkscrew = num(travel);
  }

  // ================= 9. the U-turn path, numerically (the "curve"): sampled th(s) and heading =================
  {
    const w = straight(40);
    const c = guided(w, "lizard", "b", 2000);
    c.gripOn = false;
    run(w, c, W_, 0.6);
    const x0 = S.bodyPoint(c, 0).p.x;
    const path = [];
    run(w, c, S_, 2, (i) => {
      if (i % 6 === 5) {
        const p = S.bodyPoint(c, 0).p;
        path.push({ t: num((i + 1) * DT), x: num(p.x - x0, 1), th: num(c.head.th), phi: num(c.phi), om: num(c.omega), v: num(c.speedNow, 0) });
      }
    });
    // monotone heading from 0 to pi (no flip back and forth), the curve's lateral extent small and one-sided, no instant jump
    for (let i = 1; i < path.length; i++) assert.ok(Math.abs(S_wrap(path[i].phi - path[i - 1].phi)) < 0.7, "phi steps are small");
    const up = path.map((p) => Math.abs(p.phi));
    for (let i = 1; i < up.length; i++) assert.ok(up[i] >= up[i - 1] - 0.02, "the heading turns one way only (no wobble) during the swing");
    const lat = path.map((p) => p.th);
    assert.ok(lat.every((x) => x >= -0.01) || lat.every((x) => x <= 0.01), "the arc bulges to one side only");
    // the lizard travels ahead during the swing no more than ~ one body length (it does not run on)
    const maxX = Math.max(...path.map((p) => p.x));
    assert.ok(maxX < 120, `the U-turn arc is tight (${maxX} px ahead)`);
    numbers.uturnArcAhead = maxX;
    numbers.uturnSwingTh = num(Math.max(...lat.map(Math.abs)));
    numbers.uturnPath = path.filter((_, i) => i % 3 === 0).map((p) => `${p.t}s:th${p.th}/phi${p.phi}/v${p.v}`).join(" ");
  }

  // ================= 10. junction transfers, both directions =================
  {
    // demo: along the log into its two forks and back (W, then S), and into the climb branch with Shift
    for (const id of ["lizard", "snake", "ant", "spider", "squirrel"]) {
      const w = demo;
      const c = guided(w, id, "trunk", 1850);
      run(w, c, W_, 6);
      assert.ok(c.head.b === "up" || c.head.b === "down", `${id}: W past the end of the log continues onto a fork (${c.head.b})`);
      const fork = c.head.b;
      assert.ok(Math.abs(c.phi) < 1.0, `${id}: heading on the fork is tip-ward-ish (${c.phi.toFixed(2)})`);
      run(w, c, S_, 10);
      assert.equal(c.head.b, "trunk", `${id}: S from the fork's base goes back onto the log (${fork} -> ${c.head.b})`);
      assert.ok(Math.abs(Math.abs(c.phi) - Math.PI) < 0.5, `${id}: ... and keeps walking base-ward (${c.phi.toFixed(2)})`);
      // climb: walking tip-ward in the side branch's base zone turns onto it AUTOMATICALLY (Shift = stay); W goes up, S down and off it
      const c2 = guided(w, id, "trunk", 940);
      c2.head.th = W.thetaOf(W.frameAt(w.branches.get("trunk"), 1010), V(0, 1, 0)); // the top of the log's side that faces up
      const stay = guided(w, id, "trunk", 940);
      stay.head.th = c2.head.th;
      let stayed = true;
      for (let i = 0; i < 60 * 8; i++) {
        S.step(w, stay, { ...idle, forward: true, climb: true }, DT);
        if (stay.head.b === "climb") stayed = false;
      }
      assert.ok(stayed, `${id}: holding Shift while walking W you stay on the log and pass the side branch`);
      let on = false;
      for (let i = 0; i < 60 * 8 && !on; i++) {
        S.step(w, c2, { ...idle, forward: true }, DT);
        on = c2.head.b === "climb";
      }
      assert.ok(on, `${id}: W alone climbs into the vertical branch (auto-climb)`);
      run(w, c2, W_, 1.5);
      assert.ok(c2.head.b === "climb" && !c2.air, `${id}: and walks up it`);
      const y0 = S.bodyPoint(c2, 0).p.y;
      run(w, c2, W_, 2);
      assert.ok(S.bodyPoint(c2, 0).p.y > y0 + 20 || c2.head.s > 890, `${id}: W goes up the vertical branch`);
      run(w, c2, S_, 14);
      assert.equal(c2.head.b, "trunk", `${id}: S all the way down the climb branch lands on the log again (${c2.head.b})`);
      assert.ok(!c2.air, `${id}: without falling`);
    }
    // forest: down a trunk (S) -> its ground root -> the stump, then back up the root by W from the root's stump end
    for (const id of ["lizard", "snake", "ant", "spider", "cat"]) {
      for (const tid of ["F0", "F2"]) {
        const w = forest.world;
        const tb = w.branches.get(tid);
        const F0 = tb.pts[0];
        const h = Math.hypot(F0.x, F0.z);
        const c = guided(w, id, tid, 60);
        c.head.th = W.thetaOf(W.frameAt(tb, 60), V(-F0.x / h, 0, -F0.z / h)); // the side facing the stump
        const seen = [];
        let minGrip = 1;
        for (let i = 0; i < 60 * 40 && c.head.b !== "root"; i++) {
          S.step(w, c, { ...idle, back: true }, DT);
          if (seen[seen.length - 1] !== c.head.b) seen.push(c.head.b);
          minGrip = Math.min(minGrip, c.grip);
          assert.ok(!c.air, `${id}: never falls on the way down ${tid}`);
        }
        assert.deepEqual(seen, [tid, "root:" + tid, "root"], `${id}: S down ${tid} -> root:${tid} -> the stump`);
        assert.ok(minGrip > 0.9, `${id}: grip stays up on the roots (${minGrip.toFixed(2)})`);
        // W: from a spot on the root's top, tip-ward = out to the tree and up its trunk
        const rb = w.branches.get("root:" + tid);
        const c2 = guided(w, id, "root:" + tid, rb.total * 0.4);
        c2.gripOn = false;
        const sn = [];
        for (let i = 0; i < 60 * 40 && c2.head.b !== tid; i++) {
          S.step(w, c2, { ...idle, forward: true }, DT);
          if (sn[sn.length - 1] !== c2.head.b) sn.push(c2.head.b);
        }
        assert.deepEqual(sn, ["root:" + tid, tid], `${id}: W along ${rb.id} reaches its trunk`);
        run(w, c2, W_, 3);
        assert.ok(W.dot(S.headingVector(w, c2), V(0, 1, 0)) > 0.2 || Math.abs(c2.phi) < 0.2, `${id}: and walks up the trunk`);
        // the near-horizontal rail itself: W/S go along the ground in the right direction
        const c3 = guided(w, id, "root:" + tid, rb.total * 0.5);
        c3.gripOn = false;
        const q0 = S.bodyPoint(c3, 0).p;
        run(w, c3, W_, 0.8);
        const q1 = S.bodyPoint(c3, 0).p;
        const tan = W.frameAt(rb, rb.total * 0.5).t;
        assert.ok((q1.x - q0.x) * tan.x + (q1.y - q0.y) * tan.y + (q1.z - q0.z) * tan.z > 5, `${id}: W on a ground root walks along it, tip-ward`);
      }
    }
    // hub: S down a trunk into the hub, W on the hub continues onto a trunk
    for (const id of ["lizard", "snake"]) {
      const w = hub.world;
      const c = guided(w, id, "F1", 40);
      c.gripOn = false;
      for (let i = 0; i < 60 * 30 && c.head.b !== "root"; i++) S.step(w, c, { ...idle, back: true }, DT);
      assert.equal(c.head.b, "root", `${id}: S down a trunk reaches the hub`);
      run(w, c, W_, 20);
      // (it may already have turned into a side branch of that trunk: walking tip-ward through a side branch's base zone climbs it, see section 10)
      assert.ok(c.head.b !== "root" && /^[FG]\d/.test(c.head.b), `${id}: W from the hub's end walks up a trunk or one of its side branches (${c.head.b})`);
    }
  }

  // ================= 10b. auto-climb: walk tip-ward in a side branch's zone = climb it; the other side passes; Shift = stay =================
  {
    // a horizontal trunk "b" (r 20, +x) with a side branch "side" leaving UPWARD (+y) at s = 1000
    const mkJunction = () => {
      const w = straight(20);
      W.addBranch(w, W.makeBranch("side", W.smoothPath([V(1000, 0, 0), V(1000, 200, 0), V(1000, 600, 0)]), 12, "b", 1000));
      return w;
    };
    const trunkOf = (w) => w.branches.get("b");
    const thTo = (w, y) => W.thetaOf(W.frameAt(trunkOf(w), 1000), V(0, y, 0));
    for (const id of ALL) {
      for (const mode of ["guided", "free"]) {
        const mk = (th, s = 940) => {
          const w = mkJunction();
          const c = S.spawn(w, A(id), "b", s, mode);
          c.head.th = th;
          c.gripOn = false;
          return { w, c };
        };
        // facing the side branch's side of the bark: climbs by itself
        const up = mk(thTo(mkJunction(), 1));
        let on = false;
        for (let i = 0; i < 60 * 8 && !on; i++) { S.step(up.w, up.c, { ...idle, forward: true }, DT); on = up.c.head.b === "side"; }
        assert.ok(on || up.c.head.b !== "b", `${id}/${mode}: walking tip-ward on the side the branch grows from climbs it (${up.c.head.b})`);
        // the far side of the bark: passes
        const down = mk(thTo(mkJunction(), -1));
        let entered = false;
        for (let i = 0; i < 60 * 6; i++) { S.step(down.w, down.c, { ...idle, forward: true }, DT); if (down.c.head.b === "side") entered = true; }
        assert.ok(!entered && down.c.head.s > 1050, `${id}/${mode}: walking on the other side of the bark passes the junction (s ${down.c.head.s.toFixed(0)})`);
        // Shift = stay, even on the side it grows from
        const stay = mk(thTo(mkJunction(), 1));
        let diverted = false;
        for (let i = 0; i < 60 * 6; i++) { S.step(stay.w, stay.c, { ...idle, forward: true, climb: true }, DT); if (stay.c.head.b === "side") diverted = true; }
        assert.ok(!diverted && stay.c.head.s > 1050, `${id}/${mode}: Shift stays on the branch (s ${stay.c.head.s.toFixed(0)})`);
        // no key = standing in the zone does not pull you in
        const still = mk(thTo(mkJunction(), 1), 1000);
        for (let i = 0; i < 60 * 3; i++) S.step(still.w, still.c, idle, DT);
        assert.equal(still.c.head.b, "b", `${id}/${mode}: standing still in the zone does not climb`);
      }
    }
    // coming back DOWN the branch lands on the parent in the zone; walking on up the parent from there does not pull you straight back in
    for (const id of ["lizard", "cat", "snake", "ant", "spider"]) {
      const w = mkJunction();
      const c = S.spawn(w, A(id), "b", 940, "guided");
      c.head.th = thTo(w, 1);
      c.gripOn = false;
      let on = false;
      for (let i = 0; i < 60 * 8 && !on; i++) { S.step(w, c, { ...idle, forward: true }, DT); on = c.head.b === "side"; }
      assert.ok(on, `${id}: climbed (setup)`);
      run(w, c, W_, 1);
      let back = false;
      for (let i = 0; i < 60 * 20 && !back; i++) { S.step(w, c, { ...idle, back: true }, DT); back = c.head.b === "b"; }
      assert.ok(back, `${id}: S brings you back down onto the trunk`);
      assert.equal(c.noAuto, "side", `${id}: the branch you just came down from is remembered`);
      run(w, c, idle, 0.5);
      assert.equal(c.head.b, "b", `${id}: standing there you stay on the trunk`);
      let again = false;
      for (let i = 0; i < 60 * 8; i++) { S.step(w, c, { ...idle, forward: true }, DT); if (c.head.b === "side") again = true; }
      assert.ok(!again && c.head.b === "b" && c.head.s > 1040, `${id}: W on up the trunk is not pulled back into the branch (${c.head.b}, s ${c.head.s.toFixed(0)})`);
      assert.equal(c.noAuto, undefined, `${id}: once out of the zone auto-climb is armed again`);
    }
    // a ground root / silk thread still needs Shift: standing at the stump's base and walking W does not enter a root
    {
      const w = forest.world;
      const stump = w.branches.get("root");
      const rid = stump.side.find((id) => w.branches.get(id).root);
      assert.ok(rid, "the forest stump has a ground root");
      const c = S.spawn(w, A("lizard"), "root", 8, "guided");
      let enteredRoot = false;
      for (let th = -3; th <= 3 && !enteredRoot; th += 0.5) {
        const d = S.spawn(w, A("lizard"), "root", 8, "guided");
        d.head.th = th;
        d.gripOn = false;
        const near = S.climbTarget(w, d);
        if (!near || !near.root) continue;
        for (let i = 0; i < 90; i++) { S.step(w, d, { ...idle, forward: true }, DT); if (d.head.b.startsWith("root:")) enteredRoot = true; }
      }
      assert.ok(!enteredRoot || c, "W alone never enters a ground root (they keep the Shift rule)");
      assert.ok(!enteredRoot, "W alone at the stump's base does not turn into a ground root");
    }
    numbers.autoClimb = "ok";
  }

  // ================= 11. aiming, reaching, silk, flight: the keys keep their own meanings in guided mode =================
  {
    // identical scripts in free and guided give identical states for everything that is not steering the walk
    const script = (mode, id, plan) => {
      const w = straight(40);
      const c = S.spawn(w, A(id), "b", 2000, mode);
      c.gripOn = false;
      plan(w, c);
      return c;
    };
    // leap aiming: A turns the aim, the animal stands still, phi untouched
    for (const id of ["lizard", "cat", "squirrel", "jumper"]) {
      const c = script("guided", id, (w, cc) => {
        run(w, cc, { reach: true, leap: true }, DT);
        run(w, cc, { reach: true, right: true, forward: true }, 0.5);
      });
      assert.ok(c.aim && c.aim.yaw > 0.3, `${id}: A/D still turn the aim in guided mode`);
      assert.ok(c.aim.pitch > 0.2 && Math.abs(c.phi) < 1e-9 && c.head.s === 2000 && c.speedNow < 1, `${id}: W tilts the aim, the animal stands still (phi untouched)`);
      const f = script("free", id, (w, cc) => {
        run(w, cc, { reach: true, leap: true }, DT);
        run(w, cc, { reach: true, right: true, forward: true }, 0.5);
      });
      assert.deepEqual(JSON.stringify(f.aim), JSON.stringify(c.aim), `${id}: aiming is mode independent`);
    }
    // a leap flies identically
    for (const id of ["lizard", "cat", "squirrel"]) {
      const leap = (w, cc) => {
        run(w, cc, W_, 0.4);
        run(w, cc, { leap: true }, DT);
        run(w, cc, idle, 0.5);
      };
      const g = script("guided", id, leap), f = script("free", id, leap);
      assert.ok(g.air && f.air, `${id}: leaps in both modes`);
      assert.ok(Math.abs(g.air.p.x - f.air.p.x) < 1e-6 && Math.abs(g.air.p.y - f.air.p.y) < 1e-6, `${id}: the leap arc is mode independent`);
    }
    // reach (snake, ant): steering the head with A/D works the same
    for (const id of ["snake", "ant"]) {
      const plan = (w, cc) => run(w, cc, { reach: true, right: true, forward: true }, 1.0);
      const g = script("guided", id, plan), f = script("free", id, plan);
      assert.ok(g.reach && f.reach, `${id}: reaching in both modes`);
      assert.ok(W.dist(g.reach.dir, f.reach.dir) < 1e-9 && Math.abs(g.reach.len - f.reach.len) < 1e-9, `${id}: reach steering is mode independent`);
    }
    // flight: bee / dragonfly / jay
    for (const id of ["bee", "dragonfly", "bluejay"]) {
      const plan = (w, cc) => {
        run(w, cc, { leap: true }, DT);
        run(w, cc, { forward: true, right: true, reach: true }, 1.2);
      };
      const g = script("guided", id, plan), f = script("free", id, plan);
      assert.ok(g.flight && f.flight, `${id}: flies in both modes`);
      assert.ok(W.dist(g.flight.p, f.flight.p) < 1e-6 && Math.abs(g.flight.yaw - f.flight.yaw) < 1e-9, `${id}: flight is mode independent`);
    }
    // silk: X drops, S lets the rope out, W reels it
    for (const id of ["spider", "jumper"]) {
      const plan = (w, cc) => {
        run(w, cc, { silk: true }, DT);
        run(w, cc, { back: true }, 0.8);
      };
      const g = script("guided", id, plan), f = script("free", id, plan);
      assert.ok(g.silk && f.silk, `${id}: hangs on silk in both modes`);
      assert.ok(Math.abs(g.silk.len - f.silk.len) < 1e-9, `${id}: S lets the rope out in both modes (${g.silk.len.toFixed(1)})`);
    }
    // switching mode on the fly (key M) is harmless: the heading just continues
    const w = straight(40);
    const c = guided(w, "lizard", "b", 2000);
    run(w, c, { ...W_, ...D_ }, 0.7);
    c.moveMode = "free";
    c.omega = 0;
    c.swing = 0;
    run(w, c, { ...W_, ...D_ }, 0.3);
    assert.ok(fin(c.phi, c.head.th) && c.head.b === "b", "switching guided -> free mid-walk");
    c.moveMode = "guided";
    run(w, c, idle, 1.5);
    assert.ok(Math.abs(c.phi) < 0.02 || Math.abs(Math.abs(c.phi) - Math.PI) < 0.02, "and back: guided straightens the leftover heading");
  }

  // ================= 12. fuzz: random inputs for 5000 steps, every animal, three worlds =================
  {
    let seed = 20261022;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let stepsRun = 0, maxOmega = 0;
    for (const [name, w] of Object.entries(worlds)) {
      const start = { demo: ["trunk", 900], forest: ["F1", 200], hub: ["F3", 200] }[name];
      for (const id of ALL) {
        for (const mode of ["guided"]) {
          const c = S.spawn(w, A(id), start[0], start[1], mode);
          let keys = {}, hold = 0, calm = 0; // calm = steps since the creature was last airborne / flying / reaching / hanging
          for (let i = 0; i < 5000; i++) {
            if (hold-- <= 0) {
              hold = 4 + Math.floor(rnd() * 40);
              keys = { forward: rnd() < 0.45, back: rnd() < 0.3, left: rnd() < 0.3, right: rnd() < 0.3, climb: rnd() < 0.12, reach: rnd() < 0.05, leap: rnd() < 0.02, silk: rnd() < 0.02 };
            }
            const dt = (1 / 120) * (1 + Math.floor(rnd() * 4));
            S.step(w, c, { ...idle, ...keys, leap: keys.leap && hold % 7 === 0, silk: keys.silk && hold % 11 === 0 }, dt);
            stepsRun++;
            maxOmega = Math.max(maxOmega, Math.abs(c.omega));
            const ok = fin(c.phi, c.omega, c.speedNow, c.grip, c.head.s, c.head.th, c.D) && w.branches.has(c.head.b) && c.head.s >= -1e-6 && c.head.s <= w.branches.get(c.head.b).total + 1e-6;
            assert.ok(ok, `${name}/${id}: finite state on a branch at step ${i}`);
            const mp = S.bodyPoint(c, 0).p;
            assert.ok(fin(mp.x, mp.y, mp.z), `${name}/${id}: finite body at step ${i}`);
            calm = c.air || c.flight || c.silk || c.reach ? 0 : calm + 1;
            if (calm > 120) {
              const br = w.branches.get(c.head.b);
              const sp = W.surfacePoint(br, c.head.s, c.head.th).p;
              assert.ok(W.dist(sp, mp) < 2.5, `${name}/${id}: the head sits on the bark at step ${i}`);
              const near = W.nearestOnBranch(br, mp);
              const rr = W.radiusAt(br, near.s);
              assert.ok(near.dist < rr * 1.6 + 3 && near.dist > rr * 0.3 - 1, `${name}/${id}: on the surface (distance ${near.dist.toFixed(1)}, radius ${rr.toFixed(1)}) at step ${i}`);
              if (A(id).maxTh !== undefined) assert.ok(Math.abs(c.head.th) <= A(id).maxTh + 1e-6, `${name}/${id}: the cat keeps its limit`);
              if (c.moveMode === "guided") assert.ok(Math.abs(c.omega) <= A(id).turnRate * S.GUIDED.gain * 1.001, `${name}/${id}: turn rate bounded`);
            }
          }
        }
      }
    }
    assert.ok(stepsRun >= 3 * ALL.length * 5000);
    numbers.fuzzSteps = stepsRun;
    numbers.fuzzMaxOmega = num(maxOmega);
  }

  console.log("  move numbers:", JSON.stringify(numbers));
};
