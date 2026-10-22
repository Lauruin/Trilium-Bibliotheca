// Unit checks for src/tree/foliage.ts (canopy foliage): styles, placement, expansion, fade rule, the three.js layer.
// Run through tools/unit-test.mjs (it imports every tools/unit-*.mjs).
export default async ({ bundle, assert }) => {
  const F = await bundle("src/tree/foliage.ts", "foliage-unit.mjs");
  const L = await bundle("src/tree/layout.ts", "layout-foliage-unit.mjs");
  const S = await bundle("src/tree/species.ts", "species-foliage-unit.mjs");
  const W = await bundle("src/tree/world3.ts", "world3-foliage-unit.mjs");

  // a vault of `folders` top-level folders with sub-folders and about `notes` notes
  const vault = (folders, notes, seed = 1) => {
    let n = seed;
    const rnd = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ns = { root: { noteId: "root", title: "root", type: "text", labels: {}, hasChildren: true } };
    const edges = [];
    const add = (id, parent, folder) => {
      ns[id] = { noteId: id, title: id, type: "text", labels: {}, hasChildren: folder };
      edges.push({ parentNoteId: parent, noteId: id, notePosition: 0 });
    };
    let made = 0;
    const per = Math.max(2, Math.ceil(notes / folders));
    const grow = (parent, depth, budget) => {
      const sub = depth >= 3 || budget < 12 ? 0 : 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < sub; i++) {
        add(`${parent}.f${i}`, parent, true);
        grow(`${parent}.f${i}`, depth + 1, budget / (sub + 1));
      }
      const here = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < here && made < notes; i++, made++) add(`${parent}.n${i}`, parent, false);
    };
    for (let t = 0; t < folders; t++) {
      add(`t${t}`, "root", true);
      grow(`t${t}`, 1, per);
    }
    return { rootNoteId: "root", notes: ns, edges, truncated: false };
  };

  // 1. the style table covers every species, values sane
  for (const k of S.SPECIES_KEYS) {
    const st = F.FOLIAGE[k];
    assert.ok(st, `foliage style for ${k}`);
    assert.ok(st.alpha > 0 && st.alpha <= 1 && st.size > 0 && st.rate >= 0 && st.puffs >= 1 && st.shade > 0, `${k} style numbers`);
    assert.ok(["puff", "leafy", "tier", "curtain", "blossom", "umbrella", "tuft", "wisp"].includes(st.shape), `${k} shape`);
  }
  assert.deepEqual(Object.keys(F.FOLIAGE).sort(), [...S.SPECIES_KEYS].sort(), "no extra / missing styles");
  assert.equal(F.styleOf("nonsense"), F.FOLIAGE.maple);
  assert.equal(F.styleOf(undefined), F.FOLIAGE.maple);
  // the distinct looks the brief asks for
  assert.equal(F.FOLIAGE.pine.shape, "tier");
  assert.equal(F.FOLIAGE.willow.shape, "curtain");
  assert.equal(F.FOLIAGE.acacia.shape, "umbrella");
  assert.equal(F.FOLIAGE.cherry.shape, "blossom");
  assert.ok(F.FOLIAGE.ghost.alpha < 0.5, "ghost foliage is wispy");
  assert.equal(F.FOLIAGE.baobab.rate, 0, "baobab: tufts at the branch ends only");

  // 2. placement: deterministic, finite, bounded, a cluster at every branch end, none on silk / roots / the ground
  const lay = L.layoutTree(vault(8, 400));
  const world = lay.world;
  const c1 = F.placeFoliage(world, lay.leaves);
  const c2 = F.placeFoliage(world, lay.leaves);
  assert.equal(JSON.stringify(c1), JSON.stringify(c2), "placement is deterministic");
  assert.ok(c1.length > 20 && c1.length <= F.MAX_CLUSTERS, `a 400-note vault gets a bounded canopy (${c1.length} clusters, ${world.branches.size} branches)`);
  for (const c of c1) {
    for (const v of [c.x, c.y, c.z, c.r, c.ax, c.az, c.leafK, ...c.color]) assert.ok(Number.isFinite(v), "finite cluster field");
    assert.ok(c.r >= 30 && c.r <= 220, "cluster radius in range");
    assert.ok(c.leafK >= 0.25 && c.leafK <= 1);
    assert.ok(c.color.every((x) => x >= 0 && x <= 1), "colour in sRGB range");
    assert.ok(c.y >= (world.groundY ?? 0), "no cluster centre below the ground");
  }
  const ends = [...world.branches.values()].filter((b) => !b.silk && b.next.length === 0 && b.rEnd < 40 && !b.root && Math.max(...b.pts.map((p) => p.y)) > (world.groundY ?? 0) + 60);
  assert.ok(ends.length > 10);
  for (const b of ends) assert.ok(c1.some((c) => c.branch === b.id && c.tip), `branch end ${b.id} has a tip cluster`);
  // only the thin parts: along-branch clusters sit on branches whose local radius is below the cut-off (+ the jitter slack)
  for (const c of c1.filter((x) => !x.tip)) {
    const b = world.branches.get(c.branch);
    assert.ok(Math.min(b.r, b.rEnd) < 44, `along-branch cluster on a thick branch ${b.id}`);
  }
  // the thick limbs / trunk base stay clear: a stout branch with something on its end gets no cluster at all
  {
    const w = { branches: new Map(), groundY: 0 };
    const fat = W.makeBranch("fat", [W.v3(0, 0, 0), W.v3(0, 400, 0), W.v3(0, 800, 0)], 70, null, undefined, 60);
    const kid = W.makeBranch("kid", [W.v3(0, 800, 0), W.v3(50, 1000, 0), W.v3(100, 1200, 0)], 8, "fat", undefined, 3);
    kid.species = fat.species = "oak";
    W.addBranch(w, fat);
    W.addBranch(w, kid);
    const cl = F.placeFoliage(w, []);
    assert.ok(cl.length > 0 && cl.every((c) => c.branch === "kid"), "only the thin twig carries foliage, not the fat trunk");
    // roots (flag), silk threads, ground-hugging branches: nothing
    const w2 = { branches: new Map(), groundY: 0 };
    const root = W.makeBranch("rt", [W.v3(0, 30, 0), W.v3(300, 30, 0), W.v3(600, 20, 0)], 9, null, undefined, 4);
    root.root = true;
    root.species = "oak";
    const silk = W.makeBranch("silk:1", [W.v3(0, 500, 0), W.v3(0, 400, 0)], 2.5, null, undefined, 2.5);
    silk.silk = true;
    const low = W.makeBranch("low", [W.v3(0, 5, 0), W.v3(200, 8, 0), W.v3(400, 6, 0)], 9, null, undefined, 4);
    low.species = "oak";
    for (const b of [root, silk, low]) W.addBranch(w2, b);
    assert.equal(F.placeFoliage(w2, []).length, 0, "no foliage on roots, silk or branches lying on the ground");
  }
  // unknown species falls back, a world without a ground works, an empty world is fine
  {
    const w = { branches: new Map() };
    const b = W.makeBranch("x", [W.v3(0, 0, 0), W.v3(0, 300, 0)], 6, null, undefined, 3);
    b.species = "not-a-species";
    W.addBranch(w, b);
    const cl = F.placeFoliage(w, []);
    assert.ok(cl.length >= 1 && cl[0].species === "maple");
    assert.equal(F.placeFoliage({ branches: new Map() }, []).length, 0);
  }
  // species show: every species' trees get their own shape family
  {
    const shapes = new Set();
    for (const k of S.SPECIES_KEYS) {
      const w = { branches: new Map(), groundY: 0 };
      const b = W.makeBranch("b", [W.v3(0, 100, 0), W.v3(100, 250, 0), W.v3(250, 400, 0)], 8, null, undefined, 3);
      b.species = k;
      W.addBranch(w, b);
      const cl = F.placeFoliage(w, []);
      assert.ok(cl.length >= 1, `${k} has foliage`);
      const sh = F.clusterShapes(cl[0], 0);
      assert.ok(sh.length >= 1);
      shapes.add(`${F.FOLIAGE[k].shape}:${[...new Set(sh.map((p) => p.shape))].join("+")}`);
      assert.ok(cl.every((c) => c.species === k));
    }
    assert.ok(shapes.size >= 8, `distinct shape families: ${[...shapes].join(", ")}`);
  }

  // 3. density: more clusters with a higher value, clamped, garbage ignored
  {
    const lo = F.placeFoliage(world, lay.leaves, { density: 0.25 }).length;
    const hi = F.placeFoliage(world, lay.leaves, { density: 1.5 }).length;
    assert.ok(lo < c1.length && c1.length < hi, `density scales the count: ${lo} < ${c1.length} < ${hi}`);
    assert.equal(F.placeFoliage(world, lay.leaves, { density: NaN }).length, c1.length, "NaN density = default");
    assert.equal(F.placeFoliage(world, lay.leaves, { density: 1e9 }).length, F.placeFoliage(world, lay.leaves, { density: 1.5 }).length, "clamped");
    assert.equal(F.clampDensity("x"), 1);
    assert.equal(F.clampDensity(-3), 0.25);
  }

  // 4. note leaves stay readable: clusters around a leaf are thinner than the same cluster without it
  {
    const none = F.placeFoliage(world, []);
    const some = F.placeFoliage(world, lay.leaves);
    assert.equal(none.length, some.length, "leaves do not change what is placed");
    assert.ok(none.every((c) => c.leafK === 1));
    const thinned = some.filter((c) => c.leafK < 0.99).length;
    assert.ok(thinned > some.length * 0.2, `clusters near leaves are thinned (${thinned}/${some.length})`);
    assert.ok(some.every((c) => c.leafK >= 0.25));
    // garbage leaves do not throw
    F.placeFoliage(world, [{ branchId: "nope", s: 1, th: 1 }, { branchId: lay.rootBranchId, s: NaN, th: Infinity }]);
  }

  // 5. expansion in both looks: bounded, finite, whole-cluster cap, deterministic
  for (const look of ["lowpoly", "voxel"]) {
    const p = F.buildPuffs(c1, look);
    assert.ok(p.length > 0 && p.length <= F.MAX_PUFFS, `${look}: ${p.length} instances for ${c1.length} clusters (cap ${F.MAX_PUFFS})`);
    assert.equal(JSON.stringify(p), JSON.stringify(F.buildPuffs(c1, look)), `${look}: deterministic`);
    for (const q of p) {
      for (const v of [q.x, q.y, q.z, q.sx, q.sy, q.sz, q.ry, q.a, ...q.color]) assert.ok(Number.isFinite(v), `${look}: finite piece`);
      assert.ok(q.sx > 0 && q.sy > 0 && q.sz > 0 && q.a > 0 && q.a <= 1);
      assert.ok(q.cluster >= 0 && q.cluster < c1.length);
      assert.equal(q.shape === "cube", look === "voxel", "voxel = cubes only, low-poly = blobs / cones only");
    }
    if (look === "voxel") {
      assert.ok(p.every((q) => [28, 42, 56].includes(q.sx) && q.x % q.sx === 0 && q.y % q.sx === 0 && q.z % q.sx === 0), "voxel cubes sit on the grid");
      const keys = new Set(p.map((q) => `${q.sx}:${q.x},${q.y},${q.z}`));
      assert.equal(keys.size, p.length, "voxel cubes are deduplicated");
    }
  }
  // the cap drops whole clusters (a world far bigger than the cap): every kept cluster is complete
  {
    const big = L.layoutTree(vault(40, 1500, 3));
    const cl = F.placeFoliage(big.world, big.leaves);
    assert.ok(cl.length <= F.MAX_CLUSTERS);
    const pv = F.buildPuffs(cl, "voxel");
    assert.ok(pv.length <= F.MAX_PUFFS, `voxel cap held on a 1500-note vault (${cl.length} clusters -> ${pv.length} cubes)`);
    const pl = F.buildPuffs(cl, "lowpoly");
    assert.ok(pl.length <= F.MAX_PUFFS);
    const tips = cl.filter((c) => c.tip).length;
    const keptTips = new Set(pv.map((q) => q.cluster));
    assert.ok([...keptTips].filter((i) => cl[i].tip).length >= Math.min(tips, keptTips.size) * 0.8, "tips are kept first when the cap bites");
  }

  // 6. the 133-tree forest case: a world of many small trees
  {
    const forest = L.layoutTree(vault(133, 400, 5));
    const cl = F.placeFoliage(forest.world, forest.leaves);
    assert.ok(cl.length > 100 && cl.length <= F.MAX_CLUSTERS, `133 trees: ${cl.length} clusters`);
    for (const look of ["lowpoly", "voxel"]) {
      const p = F.buildPuffs(cl, look);
      assert.ok(p.length > 0 && p.length <= F.MAX_PUFFS, `133 trees ${look}: ${p.length} instances`);
    }
    assert.ok(cl.every((c) => [c.x, c.y, c.z, c.r].every(Number.isFinite)));
  }

  // 7. the fade rule: 0..1, monotonic per distance, smooth (no jumps), clamps and garbage
  {
    const v = F.visibility;
    assert.equal(v(0, 1e6, 1e6), 0, "at the animal: gone");
    assert.equal(v(1e6, 0, 1e6), 0, "at the camera: gone");
    assert.equal(v(1e6, 1e6, 0), 0, "on the line camera -> animal: gone");
    assert.equal(v(1e6, 1e6, 1e6), 1, "far from everything: fully there");
    for (const k of [0.7, 1, 1.15]) {
      for (const which of [0, 1, 2]) {
        let prev = -1;
        for (let d = 0; d <= 1500; d += 5) {
          const a = [1e6, 1e6, 1e6];
          a[which] = d;
          const x = v(a[0], a[1], a[2], k);
          assert.ok(x >= 0 && x <= 1 && x >= prev - 1e-12, `monotonic ${which} at ${d}`);
          assert.ok(x - Math.max(prev, 0) < 0.06, `smooth ${which} at ${d} (step ${x - prev})`);
          prev = x;
        }
        assert.equal(prev, 1, `reaches 1 for distance ${which}`);
      }
    }
    for (const bad of [NaN, Infinity, -5]) {
      const x = v(bad, bad, bad, bad);
      assert.ok(Number.isFinite(x) && x >= 0 && x <= 1, "no NaN escape");
    }
    assert.ok(F.visibility(200, 1e6, 1e6, 2) < F.visibility(200, 1e6, 1e6, 1), "a bigger view scale clears a wider ring");
    assert.equal(F.viewScale(0), 0.7);
    assert.equal(F.viewScale(1e9), 1.15);
    assert.equal(F.smoothstep(0, 1, -1), 0);
    assert.equal(F.smoothstep(0, 1, 2), 1);
    assert.ok(Math.abs(F.distToSegment(0, 5, 0, -10, 0, 0, 10, 0, 0) - 5) < 1e-9);
    assert.ok(Math.abs(F.distToSegment(20, 0, 0, -10, 0, 0, 10, 0, 0) - 10) < 1e-9, "beyond the end: distance to the end point");
    assert.ok(Number.isFinite(F.distToSegment(1, 1, 1, 2, 2, 2, 2, 2, 2)), "degenerate segment");
  }

  // 8. the three.js layer: builds both looks, bounded draw calls, fades near the animal, disposes, survives rebuilds
  {
    const layer = new F.FoliageLayer();
    for (const look of ["voxel", "lowpoly"]) {
      layer.build(world, lay.leaves, look, 1);
      assert.ok(layer.stats.clusters === c1.length && layer.stats.instances > 0, `${look} stats`);
      assert.ok(layer.stats.drawCalls >= 1 && layer.stats.drawCalls <= 3, `${look}: ${layer.stats.drawCalls} draw calls`);
      assert.equal(layer.group.children.length, layer.stats.drawCalls);
      // a camera + animal beside a cluster: it fades out; the far ones stay
      const c = c1[Math.floor(c1.length / 2)];
      const animal = { x: c.x, y: c.y, z: c.z };
      const cam = { x: c.x + 3000, y: c.y + 300, z: c.z };
      layer.update(0.016, cam, animal, c.branch);
      assert.ok(layer.visibilityOf(Math.floor(c1.length / 2)) < 0.02, "cluster at the animal is invisible");
      let far = 0;
      layer.clusterCount && c1.forEach((q, i) => { if (Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z) > 1500 && layer.visibilityOf(i) > 0.99) far++; });
      assert.ok(far > 0, "clusters far from the animal are fully there");
      for (const part of layer.group.children) {
        const a = part.geometry.getAttribute("aFade").array;
        assert.ok(a.every((x) => Number.isFinite(x) && x >= 0 && x <= 1), "per-instance fade is a finite 0..1 value");
      }
      // eased in time: the animal moves away, the cluster comes back over a few frames, not in one
      const away = { x: c.x + 5000, y: c.y, z: c.z };
      layer.update(0.016, { x: away.x + 3000, y: away.y, z: away.z }, away, c.branch);
      const v1 = layer.visibilityOf(Math.floor(c1.length / 2));
      assert.ok(v1 > 0 && v1 < 0.5, `eases back in (${v1.toFixed(3)} after one frame)`);
      for (let i = 0; i < 120; i++) layer.update(0.016, { x: away.x + 3000, y: away.y, z: away.z }, away, c.branch);
      assert.ok(layer.visibilityOf(Math.floor(c1.length / 2)) > 0.95, "fully back after a couple of seconds");
      // garbage input does not poison the buffers
      layer.update(NaN, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, "nope");
    }
    // dispose frees the meshes; a layer can be rebuilt after clear and after a differently shaped world
    layer.clear();
    assert.equal(layer.group.children.length, 0);
    assert.equal(layer.stats.instances, 0);
    layer.update(0.016, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); // empty: a no-op
    layer.build({ branches: new Map() }, [], "lowpoly");
    assert.equal(layer.group.children.length, 0, "empty world: no meshes");
    layer.build(L.layoutTree(vault(133, 400, 5)).world, [], "voxel");
    assert.ok(layer.stats.instances > 0);
    layer.dispose();
    assert.equal(layer.group.children.length, 0);
  }
};
