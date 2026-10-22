// Unit checks for src/tree/animalmodels.ts (the animals' looks as pure data): every sim animal has a model, the models stay inside the
// sim's widths, colour / profile / wing-pose functions are total (finite, valid hex) and part counts stay bounded.
// Run through tools/unit-test.mjs (it imports every tools/unit-*.mjs).
export default async ({ bundle, assert }) => {
  const M = await bundle("src/tree/animalmodels.ts", "animalmodels-unit.mjs");
  const S = await bundle("src/tree/sim3.ts", "sim3-animals-unit.mjs");
  const hex = /^#[0-9a-f]{6}$/i;

  // 1. colour helpers
  assert.deepEqual(M.rgbOf("#ff8000"), [255, 128, 0]);
  assert.deepEqual(M.rgbOf("nonsense"), [128, 128, 128], "garbage colours never throw");
  assert.equal(M.mix("#000000", "#ffffff", 0.5), "#808080");
  assert.ok(hex.test(M.dark("#336699", 0.3)) && hex.test(M.light("#336699", 0.3)));

  // 2. every sim animal has a model (and the generic fallback works for an unknown one)
  for (const a of S.ANIMALS) {
    assert.ok(M.MODELS[a.id], `model for ${a.id}`);
    const g = M.genericModel(a);
    assert.ok(g.tubes.length === 1 && g.atts.length >= 2, "generic model");
  }
  assert.ok(M.genericModel({ nodes: [], legs: [] }), "generic model of an empty animal");

  for (const a of S.ANIMALS) {
    const m = M.MODELS[a.id];
    const k = a.scale || 1;
    let parts = 0, meshes = 0;

    // 3. attachments: valid colours, finite numbers, a known plate shape, mirrored count
    for (const at of m.atts) {
      assert.ok(hex.test(at.col), `${a.id}: att colour ${at.col}`);
      for (const v of [...at.at, ...(at.to ?? []), ...at.size, ...(at.rot ?? [])]) assert.ok(Number.isFinite(v), `${a.id}: finite att numbers`);
      assert.ok(at.size[0] > 0 && at.size[1] > 0 || at.kind === "stick", `${a.id}: positive size`);
      if (at.kind === "plate") assert.ok(M.WING_SHAPES[at.plate], `${a.id}: plate shape ${at.plate}`);
      if (at.kind === "stick") assert.ok(at.to, `${a.id}: a stick needs an end point`);
      assert.ok(at.d >= -2 && at.d <= a.nodes[a.nodes.length - 1].d / k + 8, `${a.id}: att d ${at.d} lies along the body`);
      parts += at.mirror ? 2 : 1;
    }
    meshes += parts + m.tubes.length;

    // 4. tubes: total profile / colour functions along their whole length, and inside the sim's widths
    for (const t of m.tubes) {
      assert.ok(t.d1 > t.d0 && t.step > 0, `${a.id}: tube range`);
      const rings = Math.round((t.d1 - t.d0) / t.step) + 1;
      assert.ok(rings * (t.sides ?? 8) * 6 < 20000, `${a.id}: low-poly tube vertices bounded (${rings} rings)`);
      for (let d = t.d0; d <= t.d1; d += t.step / 2) {
        // the sim's half width at d (unscaled), interpolated along its nodes
        const nodes = a.nodes.map((n) => ({ d: n.d / k, w: n.w / k }));
        let w = nodes[nodes.length - 1].w;
        for (let i = 0; i + 1 < nodes.length; i++) if (d >= nodes[i].d && d <= nodes[i + 1].d) w = nodes[i].w + ((nodes[i + 1].w - nodes[i].w) * (d - nodes[i].d)) / (nodes[i + 1].d - nodes[i].d);
        const [rw, rh] = t.prof(d, w);
        assert.ok(Number.isFinite(rw) && Number.isFinite(rh) && rw >= 0 && rh >= 0, `${a.id}: profile finite at ${d}`);
        // the model never gets wider than the sim's widest body part (the width the sim's steering / contact uses), and a tube
        // follows the local node width to within a bit (dorsal crests and ovoid abdomens may bulge past a thin node)
        const wMax = Math.max(...a.nodes.map((n) => n.w / k));
        assert.ok(rw <= wMax * 1.15, `${a.id}: tube half width ${rw.toFixed(2)} <= widest sim half width ${wMax.toFixed(2)} x1.15 at d=${d}`);
        for (const phi of [0, 1, 2, Math.PI]) for (const side of [-1, 0, 1]) assert.ok(hex.test(t.color({ d, u: (d - t.d0) / (t.d1 - t.d0), i: 3, phi, side })), `${a.id}: tube colour at ${d}`);
        if (t.crest) assert.ok(Number.isFinite(t.crest(d, 2)));
      }
    }

    // 5. legs: one style per sim leg, finite, valid colours
    a.legs.forEach((leg, i) => {
      assert.ok(m.legs, `${a.id}: legs style`);
      const st = m.legs(i, a.legs.length, leg);
      assert.ok(st.len > 1 && st.th.every((x) => x === undefined || x > 0), `${a.id}: leg ${i} style`);
      assert.ok(hex.test(st.col), `${a.id}: leg colour`);
      meshes += (st.ankle ? 3 : 2) + (st.ankle ? 2 : 1) + (st.paw ? 1 + (st.paw.toes?.n ?? 0) : 0);
    });
    assert.ok(m.legs || a.legs.length === 0, `${a.id}: a model for a legged animal has a legs function`);

    // 6. wings: the sim's wings and the model's agree; the pose is total and finite for every state
    assert.equal(!!m.wings, !!a.wings, `${a.id}: wings in model iff in sim`);
    if (m.wings) {
      assert.equal(m.wings.pairs, a.wings.pairs, `${a.id}: wing pairs`);
      meshes += m.wings.pairs * 2 * m.wings.panels.length * (a.wings.flapHz > 20 ? 2 : 1); // fast insect wings get a ghost copy
      for (const p of m.wings.panels) assert.ok(M.WING_SHAPES[p.shape] || M.WING_SHAPES[p.shape.replace(/\d$/, "") + "1"], `${a.id}: wing shape ${p.shape}`);
      for (let pair = 0; pair < m.wings.pairs; pair++) {
        for (const open of [0, 0.5, 1]) for (const amp of [0, 0.5, 1]) for (let ph = 0; ph < 6.3; ph += 0.7) m.wings.panels.forEach((_, pi) => {
          const pose = m.wings.pose({ phase: ph, amp, open, pair, pitch: 0.2 }, pi);
          assert.ok(pose.length === 3 && pose.every(Number.isFinite), `${a.id}: wing pose finite`);
          assert.ok(pose.every((x) => Math.abs(x) < 3.3), `${a.id}: wing pose angle sane`);
        });
      }
    }
    // the squirrel is the only gliding model: it has membranes, and 4 legs for them
    assert.equal(!!m.membrane, a.id === "squirrel", `${a.id}: membrane only on the squirrel`);
    if (m.membrane) assert.ok(a.legs.length >= 4 && hex.test(m.membrane.col) && hex.test(m.membrane.edge));

    // 7. bounded mesh count (one creature at a time, a couple of dozen draw calls per animal)
    assert.ok(meshes <= 90, `${a.id}: ${meshes} meshes <= 90`);
  }

  // 8. the flat shapes: valid polygons with colours
  for (const [name, o] of Object.entries(M.WING_SHAPES)) {
    assert.ok(o.pts.length >= 4, `${name}: polygon`);
    for (const [x, z] of o.pts) assert.ok(Number.isFinite(x) && Number.isFinite(z) && x >= -0.01 && x <= 1.01 && Math.abs(z) <= 1, `${name}: points in unit space`);
    assert.ok(hex.test(o.col(0.5, 0.1)), `${name}: colour`);
  }
};
