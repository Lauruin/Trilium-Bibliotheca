// Unit checks for round 5, stream 3 ("lowpoly"): shadow quality table + frustum maths (src/tree/shadows.ts), the three.js shadow rig,
// bark tip caps in both looks (src/tree/look.ts), the scenery builders (src/tree/scenery.ts).
// Run by tools/unit-test.mjs (it loads every tools/unit-<name>.mjs): `export default async ({ bundle, assert }) => { ... }`.

export default async ({ bundle, assert }) => {
  const SH = await bundle("src/tree/shadows.ts", "shadows-lowpoly.mjs");
  const LK = await bundle("src/tree/look.ts", "look-lowpoly.mjs");
  const SC = await bundle("src/tree/scenery.ts", "scenery-lowpoly.mjs");
  const W = await bundle("src/tree/world3.ts", "world3-lowpoly.mjs");
  const L = await bundle("src/tree/layout.ts", "layout-lowpoly.mjs");
  const THREE = await import("three");
  const fin = (...xs) => xs.every(Number.isFinite);

  // ---- quality table ----
  assert.deepEqual([...SH.SHADOW_QUALITIES], ["off", "low", "medium", "high"]);
  assert.equal(SH.DEFAULT_SHADOW_QUALITY, "medium");
  assert.equal(SH.SHADOW_KEY, "biblio.v1.treeShadows");
  assert.deepEqual([1024, 2048, 4096], ["low", "medium", "high"].map((q) => SH.SHADOW_TABLE[q].size));
  assert.equal(SH.SHADOW_TABLE.off.size, 0);
  assert.equal(SH.parseShadowQuality("high"), "high");
  assert.equal(SH.parseShadowQuality("ultra"), null);
  assert.equal(SH.parseShadowQuality(null), null);
  assert.equal(SH.parseShadowQuality(42), null);
  let q = "off";
  const seen = [];
  for (let i = 0; i < 4; i++) { q = SH.nextShadowQuality(q); seen.push(q); }
  assert.deepEqual(seen, ["low", "medium", "high", "off"], "cycle wraps");
  // localStorage-backed load: bad / missing values fall back to the default, never throw
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  assert.equal(SH.loadShadowQuality(), "medium");
  store.set("biblio.v1.treeShadows", "high");
  assert.equal(SH.loadShadowQuality(), "high");
  store.set("biblio.v1.treeShadows", "garbage");
  assert.equal(SH.loadShadowQuality(), "medium");
  globalThis.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(SH.loadShadowQuality(), "medium", "storage errors are swallowed");
  delete globalThis.localStorage;

  // ---- frustum maths ----
  assert.equal(SH.shadowExtent(0), SH.EXTENT_MIN);
  assert.equal(SH.shadowExtent(-50), SH.EXTENT_MIN);
  assert.equal(SH.shadowExtent(NaN), SH.EXTENT_MIN);
  assert.equal(SH.shadowExtent(Infinity), SH.EXTENT_MIN);
  assert.equal(SH.shadowExtent(1e9), SH.EXTENT_MAX);
  let prev = 0;
  const steps = new Set();
  for (let d = 0; d <= 9000; d += 7) {
    const e = SH.shadowExtent(d);
    assert.ok(e >= SH.EXTENT_MIN && e <= SH.EXTENT_MAX && fin(e));
    assert.ok(e >= prev, "extent never shrinks as the camera moves away");
    prev = e;
    steps.add(e);
  }
  assert.ok(steps.size >= 6 && steps.size <= 20, `the extent is quantised (${steps.size} steps)`);

  const sun = { x: -0.37, y: 0.83, z: 0.65 };
  const basis = SH.lightBasis(sun);
  const dotv = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  assert.ok(Math.abs(dotv(basis.right, basis.up)) < 1e-9 && Math.abs(dotv(basis.right, basis.dir)) < 1e-9 && Math.abs(dotv(basis.up, basis.dir)) < 1e-9, "orthogonal light basis");
  for (const v of [basis.right, basis.up, basis.dir]) assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9);
  const overhead = SH.lightBasis({ x: 0, y: 1, z: 0 });
  assert.ok(fin(overhead.right.x, overhead.up.z), "a sun straight overhead still has a basis");
  assert.ok(fin(...Object.values(SH.lightBasis({ x: 0, y: 0, z: 0 }).dir)), "a zero sun vector does not produce NaN");

  const ext = SH.shadowExtent(600);
  const size = 2048;
  const fit0 = SH.fitShadow({ x: 100, y: 300, z: -40 }, ext, size, sun);
  assert.ok(fin(fit0.texel, fit0.back, fit0.far, fit0.centre.x, fit0.centre.y, fit0.centre.z));
  assert.ok(Math.abs(fit0.texel - (2 * ext) / size) < 1e-12);
  assert.ok(fit0.far > fit0.back, "the far plane lies behind the focus");
  // snapping: moving the focus by less than half a texel in the light plane changes nothing; by a texel it jumps exactly one texel
  const dev = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const nudge = (f, k) => ({ x: f.x + basis.right.x * k, y: f.y + basis.right.y * k, z: f.z + basis.right.z * k });
  const f0 = { x: 100, y: 300, z: -40 };
  const a = SH.fitShadow(f0, ext, size, sun);
  const eps = a.texel * 0.01;
  const centres = new Set();
  for (let k = -0.3; k <= 0.3; k += 0.05) { const c = SH.fitShadow(nudge(f0, k * a.texel), ext, size, sun).centre; centres.add(`${c.x.toFixed(6)},${c.y.toFixed(6)},${c.z.toFixed(6)}`); }
  assert.ok(centres.size <= 2, `sub-texel movement does not shimmer (${centres.size} distinct centres over +-0.3 texel)`);
  const moved = SH.fitShadow(nudge(f0, a.texel * 1.0), ext, size, sun).centre;
  const step = dev(moved, a.centre);
  assert.ok(Math.abs(step - a.texel) < eps * 2 || Math.abs(step) < eps * 2 || Math.abs(step - 2 * a.texel) < eps * 2, `a texel-sized move jumps whole texels (${step} vs ${a.texel})`);
  // the snapped centre is whole texels in the light plane
  for (const f of [{ x: 0, y: 0, z: 0 }, { x: 1234.5, y: -80, z: 999 }, { x: -3e4, y: 2e3, z: 5e3 }]) {
    const fit = SH.fitShadow(f, ext, size, sun);
    const ca = dotv(fit.centre, basis.right) / fit.texel, cb = dotv(fit.centre, basis.up) / fit.texel;
    assert.ok(Math.abs(ca - Math.round(ca)) < 1e-6 && Math.abs(cb - Math.round(cb)) < 1e-6, "centre sits on the texel grid");
    assert.ok(dev(fit.centre, f) < fit.texel * 2.5 + 1e-6 + Math.abs(dotv(f, basis.dir) - dotv(fit.centre, basis.dir)), "snapping never moves the centre more than ~1 texel");
  }
  // bias: negative depth bias, positive normal bias, finite for every extent and map size
  for (const d of [0, 300, 900, 3000, 20000]) {
    for (const s of [1024, 2048, 4096]) {
      const fit = SH.fitShadow({ x: 0, y: 100, z: 0 }, SH.shadowExtent(d), s, sun);
      const b = SH.shadowBias(fit);
      assert.ok(b.bias < 0 && b.bias > -0.01 && b.normalBias > 0 && b.normalBias < 12 && fin(b.bias, b.normalBias), `bias sane at d=${d} size=${s}: ${JSON.stringify(b)}`);
    }
  }
  // a finer map has a smaller texel
  assert.ok(SH.fitShadow({ x: 0, y: 0, z: 0 }, ext, 4096, sun).texel < SH.fitShadow({ x: 0, y: 0, z: 0 }, ext, 1024, sun).texel);

  // ---- edge fade patch (three's PCF chunk) ----
  assert.equal(SH.patchShadowChunk(), true, "the PCF chunk of this three version is patchable");
  assert.ok(SH.shadowChunkText().includes("shEdge"));
  assert.equal(SH.patchShadowChunk(), true, "idempotent");
  assert.equal(SH.shadowChunkText().split("shEdge = min").length, 2, "patched exactly once");

  // ---- the three.js rig: SunShadows follows the focus, cycles quality, disposes ----
  const calls = { enabled: false, type: null };
  const renderer = { shadowMap: { set enabled(v) { calls.enabled = v; }, get enabled() { return calls.enabled; }, type: 0 } };
  const light = new THREE.DirectionalLight(0xffffff, 1);
  const sdir = new THREE.Vector3(sun.x, sun.y, sun.z).normalize();
  const rig = new SH.SunShadows(renderer, light, sdir, "medium");
  assert.equal(rig.on, true);
  assert.equal(light.castShadow, true);
  assert.equal(light.shadow.mapSize.x, 2048);
  assert.equal(renderer.shadowMap.type, THREE.PCFShadowMap);
  rig.update({ x: 50, y: 400, z: 20 }, 500);
  assert.ok(rig.fit && light.shadow.camera.right === rig.fit.extent && light.shadow.camera.far === rig.fit.far);
  assert.ok(Math.abs(light.position.clone().sub(light.target.position).normalize().dot(sdir) - 1) < 1e-9, "the light sits along the sun direction from its target");
  const e1 = rig.fit.extent;
  rig.update({ x: 50, y: 400, z: 20 }, 4000);
  assert.ok(rig.fit.extent > e1, "zooming out widens the frustum");
  assert.equal(rig.set("high"), false, "high -> medium/high keeps the pass on");
  assert.equal(light.shadow.mapSize.x, 4096);
  assert.equal(rig.set("off"), true, "turning off reports a pass switch (materials need a refresh)");
  assert.equal(light.castShadow, false);
  assert.equal(calls.enabled, false);
  rig.update({ x: 0, y: 0, z: 0 }, 100); // no-op while off
  assert.equal(rig.set("low"), true);
  assert.equal(light.shadow.mapSize.x, 1024);
  rig.dispose();
  assert.equal(light.castShadow, false);
  rig.update({ x: 0, y: 0, z: 0 }, 100); // still safe after dispose
  rig.set("high");

  // ---- tagShadows: only once per mesh, transparent things do not cast unless asked ----
  const grp = new THREE.Group();
  const solid = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5 }));
  grp.add(solid, glass);
  SH.tagShadows(grp, true, true);
  assert.equal(solid.castShadow, true);
  assert.equal(glass.castShadow, false, "transparent meshes do not cast by default");
  assert.equal(glass.receiveShadow, true);
  solid.castShadow = false;
  SH.tagShadows(grp, true, true);
  assert.equal(solid.castShadow, false, "already tagged meshes are left alone");
  SH.untagShadows(grp);
  SH.tagShadows(grp, true, true, true);
  assert.equal(glass.castShadow, true, "transparentCasts = true");
  assert.ok(SH.foliageDepthMaterial().isMeshDepthMaterial);

  // ---- bark tip caps ----
  const vault = (trees, notes) => {
    const ns = { root: { noteId: "root", title: "root", type: "text", labels: {}, hasChildren: true } };
    const edges = [];
    for (let i = 0; i < trees; i++) {
      ns[`t${i}`] = { noteId: `t${i}`, title: `t${i}`, type: "text", labels: {}, hasChildren: true };
      edges.push({ parentNoteId: "root", noteId: `t${i}`, notePosition: 0 });
      for (let k = 0; k < 2; k++) {
        ns[`t${i}.s${k}`] = { noteId: `t${i}.s${k}`, title: "s", type: "text", labels: {}, hasChildren: true };
        edges.push({ parentNoteId: `t${i}`, noteId: `t${i}.s${k}`, notePosition: 0 });
        for (let n = 0; n < notes; n++) {
          ns[`t${i}.s${k}.n${n}`] = { noteId: `t${i}.s${k}.n${n}`, title: "n", type: "text", labels: {}, hasChildren: false };
          edges.push({ parentNoteId: `t${i}.s${k}`, noteId: `t${i}.s${k}.n${n}`, notePosition: 0 });
        }
      }
    }
    return { rootNoteId: "root", notes: ns, edges, truncated: false };
  };
  const lay = L.layoutTree(vault(3, 4), { mode: "forest" });
  const world = lay.world;
  const terminals = [...world.branches.values()].filter((b) => W.isTerminal(world, b));
  assert.ok(terminals.length >= 3, "the test vault has terminal twigs");
  // low-poly: one mesh per branch; a terminal twig has sides*2*rings tube triangles + `sides` cap triangles (plus a few knots) and its cap apex lies PAST the last point
  const bark = LK.buildBark(world, "lowpoly", 0);
  const meshes = bark.children;
  assert.equal(meshes.length, [...world.branches.values()].filter((b) => !b.silk).length, "one mesh per branch");
  const byId = new Map([...world.branches.values()].filter((b) => !b.silk).map((b, i) => [b.id, meshes[i]]));
  for (const b of terminals) {
    const geo = byId.get(b.id).geometry;
    const pos = geo.getAttribute("position");
    assert.ok(pos.count % 3 === 0 && pos.count > 0);
    // the farthest vertex along the end tangent is beyond the last centreline point: a closed cap, not a flat stump
    const end = b.pts[b.pts.length - 1];
    const t = b.T[b.T.length - 1];
    let maxAlong = -1e9;
    for (let i = 0; i < pos.count; i++) maxAlong = Math.max(maxAlong, (pos.getX(i) - end.x) * t.x + (pos.getY(i) - end.y) * t.y + (pos.getZ(i) - end.z) * t.z);
    assert.ok(maxAlong > 0.5, `terminal ${b.id}: the cap apex is ${maxAlong.toFixed(2)} px past the end`);
    // all vertex colours finite and not negative
    const col = geo.getAttribute("color");
    for (let i = 0; i < col.count; i++) assert.ok(fin(col.getX(i), col.getY(i), col.getZ(i)) && col.getX(i) >= 0, "finite colours");
  }
  // every vertex finite, for the whole world (garbage-proof)
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) assert.ok(fin(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  // triangle budget (reported by the harness through the assertion message)
  const tris = meshes.reduce((n, m) => n + m.geometry.getAttribute("position").count / 3, 0);
  assert.ok(tris < 120000, `low-poly bark triangles for ${meshes.length} branches: ${tris}`);
  // voxel: the end of a terminal twig is capped: some voxel lies beyond the last centreline point along the tangent
  for (const b of terminals.slice(0, 6)) {
    const vox = LK.branchVoxels(b);
    const end = b.pts[b.pts.length - 1];
    const t = b.T[b.T.length - 1];
    let maxAlong = -1e9;
    for (const v of vox) maxAlong = Math.max(maxAlong, (v.x - end.x) * t.x + (v.y - end.y) * t.y + (v.z - end.z) * t.z);
    assert.ok(maxAlong > 1, `voxel terminal ${b.id}: cap voxels extend ${maxAlong.toFixed(1)} px past the end`);
    assert.ok(vox.every((v) => fin(v.x, v.y, v.z, v.r, v.g, v.b)));
  }
  // voxel bark: cubes receive only; a thin shadow-only proxy per branch (layer 1, never drawn by the main camera) casts instead
  {
    const vb = LK.buildBark(world, "voxel", 0);
    const nb = [...world.branches.values()].filter((b) => !b.silk).length;
    assert.equal(vb.children.length, nb * 2, "cubes + proxy per branch");
    const proxies = vb.children.filter((m) => m.userData.shadowOnly);
    assert.equal(proxies.length, nb);
    for (const p of proxies) {
      assert.equal(p.layers.mask, 1 << LK.SHADOW_LAYER, "proxies live on the shadow layer only (the main camera uses layer 0)");
      assert.ok(p.geometry.getAttribute("position").count / 3 <= 6 * 6 * 80, "a proxy is a few hundred triangles at most");
    }
    SH.tagShadows(vb, true, true);
    for (const m of vb.children) {
      if (m.userData.shadowOnly) assert.ok(m.castShadow && !m.receiveShadow, "proxy casts, never receives");
      else assert.ok(!m.castShadow && m.receiveShadow, "cubes receive, never cast");
    }
    let cubes = 0, proxyTris = 0;
    for (const m of vb.children) { if (m.userData.shadowOnly) proxyTris += m.geometry.getAttribute("position").count / 3; else cubes += m.count; }
    assert.ok(proxyTris * 3 < cubes * 12, `the shadow casters are far cheaper than the cubes (${proxyTris} vs ${cubes * 12} triangles)`);
    const rigLight = new THREE.DirectionalLight(0xffffff, 1);
    new SH.SunShadows({ shadowMap: { enabled: false, type: 0 } }, rigLight, new THREE.Vector3(0, 1, 0.3).normalize(), "medium");
    assert.ok(rigLight.shadow.camera.layers.test({ mask: 1 << LK.SHADOW_LAYER }) && rigLight.shadow.camera.layers.test({ mask: 1 }), "the sun's shadow camera sees layers 0 and 1");
  }
  // a branch with a child continuing from its end has no cap: every vertex stays within the last ring's radius of the centreline (no point beyond)
  const cont = [...world.branches.values()].find((b) => b.next.length > 0 && !b.silk && !b.root);
  if (cont) {
    const geo = byId.get(cont.id).geometry;
    const pos = geo.getAttribute("position");
    const end = cont.pts[cont.pts.length - 1];
    const t = cont.T[cont.T.length - 1];
    let maxAlong = -1e9;
    for (let i = 0; i < pos.count; i++) maxAlong = Math.max(maxAlong, (pos.getX(i) - end.x) * t.x + (pos.getY(i) - end.y) * t.y + (pos.getZ(i) - end.z) * t.z);
    assert.ok(maxAlong < cont.rEnd * 0.5 + 2, `a continuing branch (${cont.id}) is not capped (${maxAlong.toFixed(2)})`);
  }

  // ---- scenery: footprints + lookup ----
  const feet = SC.footprintsOf(world, world.groundY ?? 0);
  assert.ok(feet.length > 10 && feet.every((f) => fin(f.x, f.z, f.r) && f.r > 0), "footprints found at the ground");
  const foot = new SC.Foot(feet);
  assert.equal(foot.dist(feet[0].x, feet[0].z, 500), 0, "on a footprint = distance 0");
  assert.equal(foot.dist(1e7, 1e7, 500), 500, "far away = the cap");
  assert.equal(new SC.Foot([]).dist(0, 0, 123), 123, "no footprints = the cap");
  // brute-force agreement
  for (let q = 0; q < 40; q++) {
    const x = (q * 137.7) % 2500 - 1200, z = (q * 71.3) % 2500 - 1200;
    let best = 400;
    for (const f of feet) best = Math.min(best, Math.max(0, Math.hypot(f.x - x, f.z - z) - f.r));
    assert.ok(Math.abs(foot.dist(x, z, 400) - best) < 1e-9, "grid lookup == brute force");
  }
  assert.equal(SC.CLOUDS, "clouds");
  // environment cache key: stable for the same world / look, different per look, unchanged by an edit high in a tree, changed when a trunk base moves
  const gy = world.groundY ?? 0;
  assert.equal(SC.environmentKey("lowpoly", gy, world), SC.environmentKey("lowpoly", gy, world));
  assert.notEqual(SC.environmentKey("lowpoly", gy, world), SC.environmentKey("voxel", gy, world));
  assert.notEqual(SC.environmentKey("lowpoly", gy, world), SC.environmentKey("lowpoly", gy + 5, world));
  const tree0 = vault(3, 4);
  const lay2 = L.layoutTree(tree0, { mode: "forest", overrides: new Map([["t0.s0", { length: 900 }]]) });
  assert.equal(SC.environmentKey("lowpoly", gy, lay2.world), SC.environmentKey("lowpoly", gy, world), "editing a branch high in a tree keeps the scenery");
  const lay3 = L.layoutTree(tree0, { mode: "forest", overrides: new Map([["t0", { thickness: 90 }]]) });
  assert.notEqual(SC.environmentKey("lowpoly", gy, lay3.world), SC.environmentKey("lowpoly", gy, world), "a fatter trunk base changes the ground contacts");
  assert.equal(SC.environmentKey("lowpoly", 0), "lowpoly|0");
  const ex = SC.forestExtent(feet);
  assert.ok(fin(ex.cx, ex.cz, ex.Rw) && ex.Rw > 200);
  assert.deepEqual(SC.forestExtent([]), { cx: 0, cz: 0, Rw: 0 });

  // both environments build without a DOM (the sky needs a canvas, the environment does not) and are bounded
  const t0 = performance.now();
  const env = SC.buildEnvironment("lowpoly", world.groundY ?? 0, world);
  const ms = performance.now() - t0;
  let envTris = 0, inst = 0, calls2 = 0;
  env.traverse((o) => {
    if (!o.isMesh) return;
    calls2++;
    const g = o.geometry;
    const per = g.index ? g.index.count / 3 : g.getAttribute("position").count / 3;
    envTris += per * (o.isInstancedMesh ? o.count : 1);
    if (o.isInstancedMesh) inst += o.count;
  });
  assert.ok(env.getObjectByName("clouds"), "the environment contains the cloud group");
  assert.ok(calls2 < 40, `environment draw calls: ${calls2}`);
  assert.ok(envTris < 450000, `environment triangles: ${envTris}`);
  assert.ok(ms < 6000, `environment build ${ms.toFixed(0)} ms`);
  const env2 = SC.buildEnvironment("lowpoly", world.groundY ?? 0, world);
  const sig = (e) => { let h = 0; e.traverse((o) => { if (o.isMesh) h += o.geometry.getAttribute("position").count + (o.isInstancedMesh ? o.count : 0); }); return h; };
  assert.equal(sig(env), sig(env2), "deterministic");
  const envNoWorld = SC.buildEnvironment("lowpoly", 0);
  assert.ok(envNoWorld.children.length > 5, "builds without a world too");
  const vox = SC.buildEnvironment("voxel", 0, world);
  assert.ok(vox.getObjectByName("clouds"));
  console.log(`    lowpoly: bark ${tris} tris / ${meshes.length} meshes; environment ${envTris} tris, ${inst} instances, ${calls2} meshes, ${ms.toFixed(0)} ms`);
};
