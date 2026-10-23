// Unit checks for the mouse camera steering reach, jump aim, flight and the spider's swing through `Input.aimDir` (the camera's look direction).
// Run by tools/unit-test.mjs.
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async ({ bundle, assert }) => {
  // sim3 + silk in ONE bundle: the thread store SILKS is module state, so the sim and the test must see the same instance
  const entry = join(mkdtempSync(join(tmpdir(), "biblio-look-")), "entry.ts");
  writeFileSync(entry, `export * from ${JSON.stringify(join(process.cwd(), "src/tree/sim3.ts"))};\nexport * from ${JSON.stringify(join(process.cwd(), "src/tree/silk.ts"))};\n`);
  const S = await bundle(entry, "sim-look.mjs");
  const W = await bundle("src/tree/world3.ts", "world-look.mjs");
  const DT = 1 / 60;
  const A = (id) => S.ANIMALS.find((a) => a.id === id);
  const idle = S.NO_INPUT;
  const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const run = (w, c, input, secs) => { for (let t = 0; t < secs - 1e-9; t += DT) S.step(w, c, input, DT); };
  const world = () => {
    const w = { branches: new Map(), groundY: -4000 };
    W.addBranch(w, W.makeBranch("a", W.smoothPath([W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)]), 40));
    return w;
  };
  const onTop = (w, id) => { const c = S.spawn(w, A(id), "a", 1000, "guided"); c.head.th = 0; c.phi = 0; c.gripOn = false; return c; };

  // 1. jump aim: yaw (+ = right = +z for a walker facing +x on top) and pitch follow the look direction
  for (const id of ["lizard", "cat", "squirrel", "jumper"]) {
    const w = world();
    const c = onTop(w, id);
    run(w, c, { ...idle, leap: true, reach: true }, 0.1);
    assert.ok(c.aim, `${id}: aiming`);
    const look = norm({ x: 0.4, y: 0.8, z: 0.45 });
    run(w, c, { ...idle, reach: true, aimDir: look }, 1.5);
    assert.ok(c.aim && c.aim.yaw > 0.4 && c.aim.yaw < 1.1, `${id}: looking right turns the aim right (${c.aim?.yaw.toFixed(2)})`);
    assert.ok(c.aim.pitch > 0.05, `${id}: looking up raises it (${c.aim.pitch.toFixed(2)})`);
    const left = norm({ x: 0.7, y: -0.2, z: -0.6 });
    run(w, c, { ...idle, reach: true, aimDir: left }, 1.5);
    assert.ok(c.aim.yaw < -0.4, `${id}: and looking left turns it left (${c.aim.yaw.toFixed(2)})`);
    assert.ok(c.aim.pitch < 0.05, `${id}: looking down lowers it (${c.aim.pitch.toFixed(2)})`);
    // a manual A on top of it wins that axis for the frame
    const y0 = c.aim.yaw;
    run(w, c, { ...idle, reach: true, aimDir: left, right: true }, 0.2);
    assert.ok(c.aim.yaw > y0, `${id}: D beats the camera`);
    // without aimDir nothing changes: the old keys only
    const w2 = world();
    const d = onTop(w2, id);
    run(w2, d, { ...idle, leap: true, reach: true }, 0.1);
    run(w2, d, { ...idle, reach: true }, 1);
    assert.ok(Math.abs(d.aim.yaw) < 1e-9 && Math.abs(d.aim.pitch) < 1e-9, `${id}: no camera, no drift`);
    // the leap goes where the camera looked: release and compare the launch direction's side
    const w3 = world();
    const e = onTop(w3, id);
    run(w3, e, { ...idle, leap: true, reach: true }, 0.1);
    run(w3, e, { ...idle, reach: true, aimDir: norm({ x: 0.5, y: 0.2, z: 0.85 }) }, 1.6);
    run(w3, e, idle, 0.1);
    assert.ok(e.air && e.air.v.z > 50, `${id}: the leap heads to the right (vz ${e.air?.v.z.toFixed(0)})`);
  }

  // 2. reach (snake, ant): the stretching head turns towards the look direction
  for (const id of ["snake", "ant"]) {
    const w = world();
    const c = onTop(w, id);
    run(w, c, { ...idle, reach: true }, 0.3);
    assert.ok(c.reach, `${id}: reaching`);
    run(w, c, { ...idle, reach: true, aimDir: norm({ x: 0.2, y: 0.2, z: 1 }) }, 1.2);
    assert.ok(c.reach && c.reach.dir.z > 0.55, `${id}: the head turns to the right (dir z ${c.reach.dir.z.toFixed(2)})`);
    run(w, c, { ...idle, reach: true, aimDir: norm({ x: 0.2, y: 0.2, z: -1 }) }, 2.2);
    assert.ok(c.reach.dir.z < -0.4, `${id}: and back to the left (${c.reach.dir.z.toFixed(2)})`);
    run(w, c, { ...idle, reach: true, aimDir: norm({ x: 1, y: 0.7, z: 0 }) }, 2);
    assert.ok(c.reach.dir.y > 0.2, `${id}: looking up lifts it (${c.reach.dir.y.toFixed(2)})`);
  }

  // 3. flight: the heading turns towards the camera; hover fliers fly where they look
  for (const id of ["bee", "dragonfly", "bluejay"]) {
    const w = world();
    const c = onTop(w, id);
    run(w, c, { ...idle, leap: true, reach: true }, 0.1);
    for (let i = 0; i < 20 && !c.flight; i++) run(w, c, { ...idle, reach: true }, 0.1);
    assert.ok(c.flight, `${id}: airborne`);
    const yaw0 = c.flight.yaw;
    const look = norm({ x: Math.cos(yaw0 + 1.2), y: 0, z: Math.sin(yaw0 + 1.2) });
    run(w, c, { ...idle, forward: id !== "bluejay", reach: true, aimDir: look }, 3);
    const dy = Math.abs(W.wrapAngle(c.flight.yaw - (yaw0 + 1.2)));
    assert.ok(dy < 0.35, `${id}: turned to face where the camera looks (off by ${dy.toFixed(2)})`);
  }
  {
    const w = world();
    const c = onTop(w, "blue jay" in {} ? "bluejay" : "bluejay");
    run(w, c, { ...idle, leap: true, reach: true }, 0.1);
    for (let i = 0; i < 20 && !c.flight; i++) run(w, c, { ...idle, reach: true }, 0.1);
    const p0 = c.flight.pitch;
    run(w, c, { ...idle, reach: true, aimDir: norm({ x: Math.cos(c.flight.yaw), y: 0.6, z: Math.sin(c.flight.yaw) }) }, 1.5);
    assert.ok(c.flight.pitch > p0 + 0.1, `the jay climbs when the camera looks up (${p0.toFixed(2)} -> ${c.flight.pitch.toFixed(2)})`);
  }
  {
    const w = world();
    const c = onTop(w, "bee");
    run(w, c, { ...idle, leap: true, reach: true }, 0.1);
    for (let i = 0; i < 20 && !c.flight; i++) run(w, c, { ...idle, reach: true }, 0.1);
    const y0 = c.flight.p.y;
    run(w, c, { ...idle, forward: true, aimDir: norm({ x: Math.cos(c.flight.yaw), y: 0.6, z: Math.sin(c.flight.yaw) }) }, 1.5);
    assert.ok(c.flight.p.y > y0 + 40, `a hover flier flies up when W is pressed while looking up (${(c.flight.p.y - y0).toFixed(0)} px)`);
  }

  // 4. walking is NOT affected by the camera (guided keys read against the branch)
  {
    const w = world();
    const a = onTop(w, "lizard"), b = onTop(w, "lizard");
    run(w, a, { ...idle, forward: true }, 2);
    run(w, b, { ...idle, forward: true, aimDir: norm({ x: 0, y: 0, z: 1 }) }, 2);
    assert.ok(Math.abs(a.head.s - b.head.s) < 1e-6 && Math.abs(a.head.th - b.head.th) < 1e-9, "walking ignores aimDir");
  }
  // 5. A/D alone turn round the bark quicker than before (creep 0.95 x speed, up to 2 x on a thick trunk)
  {
    const thick = { branches: new Map(), groundY: -4000 };
    W.addBranch(thick, W.makeBranch("a", W.smoothPath([W.v3(0, 0, 0), W.v3(0, 1500, 0), W.v3(0, 3000, 0)]), 190));
    const c = S.spawn(thick, A("lizard"), "a", 1000, "guided");
    c.gripOn = false;
    let t = 0;
    for (; t < 60 * 30 && Math.abs(c.head.th) < 1.5; t++) S.step(thick, c, { ...idle, left: true }, DT);
    assert.ok(t * DT < 6, `a quarter way round a 190 px trunk with A alone takes ${(t * DT).toFixed(1)} s (< 6 s)`);
  }

  // 6. threads persist (sanitised) and can be cut
  {
    S.clearSilks();
    const w = world();
    const t = S.addSilk(w, { id: S.newSilkId(), ref: { b: "a", s: 500, th: 3 }, end: { kind: "free", dx: 0, dy: -200, dz: 0 } });
    const t2 = S.addSilk(w, { id: S.newSilkId(), ref: { b: "a", s: 900, th: 3 }, end: { kind: "surface", ref: { b: "a", s: 1400, th: 3 } } });
    assert.ok(t && t2);
    const text = S.serializeSilks();
    const back = S.parseSilks(text);
    assert.deepEqual(back, S.SILKS, "round trip");
    S.clearSilks();
    S.restoreSilks(back);
    assert.equal(S.SILKS.length, 2);
    assert.equal(S.newSilkId(), "silk:3", "numbering continues after the highest stored id");
    const w2 = world();
    assert.equal(S.applySilks(w2), 2, "restored threads are rebuilt in a new world");
    assert.ok(w2.branches.get("silk:1")?.silk && w2.branches.get("a").side.includes("silk:2"));
    // damaged / hostile storage never throws and drops what is wrong
    for (const bad of [null, "", "nope", "{}", "[1,2,{}]", '[{"id":"x"}]']) assert.deepEqual(S.parseSilks(bad), [], String(bad));
    const mixed = S.parseSilks(JSON.stringify([
      { id: "silk:7", ref: { b: "a", s: 1, th: 0 }, end: { kind: "free", dx: 1, dy: 2, dz: 3 } },
      { id: "silk:7", ref: { b: "a", s: 2, th: 0 }, end: { kind: "free", dx: 1, dy: 2, dz: 3 } },
      { id: "silk:8", ref: { b: "a", s: -4, th: 0 }, end: { kind: "free", dx: 0, dy: 0, dz: 0 } },
      { id: "silk:9", ref: { b: "a", s: 1, th: 0 }, end: { kind: "free", dx: 1e12, dy: 0, dz: 0 } },
      { id: "../etc", ref: { b: "a", s: 1, th: 0 }, end: { kind: "free", dx: 1, dy: 1, dz: 1 } },
      { id: "silk:10", ref: { b: "x".repeat(200), s: 1, th: 0 }, end: { kind: "free", dx: 1, dy: 1, dz: 1 } },
      { id: "silk:11", ref: { b: "a", s: 1, th: 0 }, end: { kind: "surface", ref: { b: "a", s: NaN, th: 0 } } },
      { id: "silk:12", ref: { b: "a", s: 5, th: 1 }, end: { kind: "surface", ref: { b: "a", s: 9, th: 1 } } },
    ]));
    assert.deepEqual(mixed.map((r) => r.id), ["silk:7", "silk:12"], "only sane, unique records survive");
    assert.equal(S.parseSilks(JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: "silk:" + (i + 1), ref: { b: "a", s: 1, th: 0 }, end: { kind: "free", dx: 1, dy: 1, dz: 1 } })))).length, S.SILK_KEEP);

    // cut a thread you stand on: gone from the world and the store, you fall and land on a branch (never a crash)
    S.clearSilks();
    const cw = { branches: new Map(), groundY: -4000 };
    W.addBranch(cw, W.makeBranch("a", W.smoothPath([W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)]), 40));
    W.addBranch(cw, W.makeBranch("g", W.smoothPath([W.v3(0, -300, 0), W.v3(1500, -300, 0), W.v3(3000, -300, 0)]), 40));
    S.addSilk(cw, { id: S.newSilkId(), ref: { b: "a", s: 1000, th: Math.PI }, end: { kind: "surface", ref: { b: "g", s: 1000, th: 0 } } });
    const c = S.spawn(cw, A("ant"), "silk:1", 100, "guided");
    c.gripOn = false;
    run(cw, c, idle, 0.2);
    assert.equal(S.cutThread(cw, c), "thread");
    assert.ok(!cw.branches.has("silk:1") && S.SILKS.length === 0, "the thread is gone");
    assert.ok(!cw.branches.get("a").side.includes("silk:1") && !cw.branches.get("g").side.includes("silk:1"));
    run(cw, c, idle, 6);
    assert.ok(cw.branches.has(c.head.b) && !c.head.b.startsWith("silk:") && !c.air, `it fell and landed on ${c.head.b}`);
    assert.ok(Number.isFinite(c.head.s) && Number.isFinite(c.head.th));
    assert.equal(S.cutThread(cw, c), null, "nothing to cut on a plain branch");
    // cut the rope you hang from: you fall, no thread is kept
    const hw = world();
    const sp = S.spawn(hw, A("spider"), "a", 1000);
    sp.head.th = Math.PI;
    for (const t of sp.trail) if (t.surf) t.surf.th = Math.PI;
    S.step(hw, sp, { ...idle, silk: true }, DT);
    run(hw, sp, { ...idle, drop: true }, 1);
    assert.ok(sp.silk);
    assert.equal(S.cutThread(hw, sp), "rope");
    assert.ok(sp.silk === null && sp.air, "falling");
    assert.equal(S.SILKS.length, 0, "no thread kept");
    run(hw, sp, idle, 8);
    assert.ok(hw.branches.has(sp.head.b), "recovers onto a branch");
    S.clearSilks();
  }

  // 7. held against a branch's tip the body does not bunch up (the trail only grows by what the head really walked)
  for (const id of ["lizard", "snake", "ant", "cat", "spider"]) {
    const w = world();
    const c = S.spawn(w, A(id), "a", 2900, "guided");
    c.head.th = 0; c.phi = 0; c.gripOn = false;
    run(w, c, { ...idle, forward: true }, 1);
    const len0 = Math.hypot(...["x", "y", "z"].map((k) => S.bodyPoint(c, 0).p[k] - S.bodyPoint(c, Math.max(...A(id).nodes.map((n) => n.d))).p[k]));
    run(w, c, { ...idle, forward: true }, 8);
    assert.ok(Math.abs(c.head.s - 3000) < 1.5, `${id}: stopped at the tip (${c.head.s.toFixed(1)})`);
    const len1 = Math.hypot(...["x", "y", "z"].map((k) => S.bodyPoint(c, 0).p[k] - S.bodyPoint(c, Math.max(...A(id).nodes.map((n) => n.d))).p[k]));
    assert.ok(len1 > 0.85 * Math.max(len0, 1) || len1 > 0.8 * Math.max(...A(id).nodes.map((n) => n.d)), `${id}: still stretched out after 8 s of W at the tip (${len1.toFixed(1)} vs ${len0.toFixed(1)})`);
  }

  // 8. flying with the mouse camera: W throttle, S slow, A/D strafe, skydive when looking steeply down with W (bleeds away when the nose comes up)
  for (const id of ["bluejay", "eagle"]) {
    const w = { branches: new Map(), groundY: -90000 };
    W.addBranch(w, W.makeBranch("a", W.smoothPath([W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)]), 40));
    const c = S.spawn(w, A(id), "a", 1000, "guided");
    c.head.th = 0; c.phi = 0; c.gripOn = false;
    run(w, c, { ...idle, leap: true, reach: true }, 0.1);
    for (let i = 0; i < 20 && !c.flight; i++) run(w, c, { ...idle, reach: true }, 0.1);
    assert.ok(c.flight, `${id}: airborne`);
    const fl = A(id).flight;
    const dir = (pitch) => norm({ x: Math.cos(c.flight.yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.sin(c.flight.yaw) * Math.cos(pitch) });
    const level = { ...idle, aimDir: dir(0) };
    run(w, c, level, 6);
    const cruise = c.flight.speed;
    run(w, c, { ...level, forward: true }, 6);
    const fast = c.flight.speed;
    assert.ok(fast > cruise * 1.2 && fast <= fl.speed + 1, `${id}: W is the throttle (${cruise.toFixed(0)} -> ${fast.toFixed(0)}, top ${fl.speed.toFixed(0)})`);
    run(w, c, { ...level, back: true }, 6);
    assert.ok(c.flight.speed < cruise * 0.9, `${id}: S slows it down (${c.flight.speed.toFixed(0)})`);
    // A / D strafe: the position moves sideways and the heading does not turn
    run(w, c, level, 3);
    const yaw0 = c.flight.yaw, p0 = { ...c.flight.p };
    const rightV = { x: -Math.sin(yaw0), z: Math.cos(yaw0) };
    run(w, c, { ...level, right: true }, 1.2);
    const dx = c.flight.p.x - p0.x, dz = c.flight.p.z - p0.z;
    const side = dx * rightV.x + dz * rightV.z;
    assert.ok(side > 0.2 * fl.speed * 0.45 * 1.2 && Math.abs(W.wrapAngle(c.flight.yaw - yaw0)) < 0.05, `${id}: D strafes right without turning (${side.toFixed(0)} px sideways, yaw change ${(c.flight.yaw - yaw0).toFixed(3)})`);
    run(w, c, { ...level, left: true }, 2.4);
    const side2 = (c.flight.p.x - p0.x) * rightV.x + (c.flight.p.z - p0.z) * rightV.z;
    assert.ok(side2 < side, `${id}: A strafes the other way`);
    // skydive: looking steeply down with W climbs past the normal top speed; looking up bleeds it
    c.flight.p.y = 60000;
    run(w, c, { ...level, forward: true }, 4);
    run(w, c, { ...idle, forward: true, aimDir: dir(-1.2) }, 7);
    const dive = c.flight.speed;
    assert.ok(dive > fl.speed * 1.15 && dive <= fl.speed * S.SKYDIVE + 1, `${id}: a skydive beats the normal top speed (${dive.toFixed(0)} > ${fl.speed.toFixed(0)}, cap ${(fl.speed * S.SKYDIVE).toFixed(0)})`);
    run(w, c, { ...idle, forward: true, aimDir: dir(0.5) }, 5);
    assert.ok(c.flight.speed < dive * 0.75 && c.flight.speed <= fl.speed + 1, `${id}: pitching up bleeds the dive speed away (${c.flight.speed.toFixed(0)})`);
    // without the camera nothing changes: W dives, A/D turn (the old keys)
    const w2 = { branches: new Map(), groundY: -90000 };
    W.addBranch(w2, W.makeBranch("a", W.smoothPath([W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)]), 40));
    const d = S.spawn(w2, A(id), "a", 1000, "guided");
    d.head.th = 0; d.phi = 0; d.gripOn = false;
    run(w2, d, { ...idle, leap: true, reach: true }, 0.1);
    for (let i = 0; i < 20 && !d.flight; i++) run(w2, d, { ...idle, reach: true }, 0.1);
    const yd = d.flight.yaw;
    run(w2, d, { ...idle, right: true }, 1);
    assert.ok(d.flight.yaw !== yd, `${id}: without the mouse camera A/D still turn`);
  }
};
