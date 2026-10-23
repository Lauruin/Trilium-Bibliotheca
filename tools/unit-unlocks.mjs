// Unit checks for lib/unlocks.ts (the catalog, counters, what is earned) and lib/tutorial.ts (the first-run state machine),
// plus the animal gate (sim3 animalForKey with `allowed`). Run by tools/unit-test.mjs.
export default async ({ bundle, assert }) => {
  const U = await bundle("src/lib/unlocks.ts", "unlocks-unit.mjs");
  const T = await bundle("src/lib/tutorial.ts", "tutorial-unit.mjs");
  const S = await bundle("src/tree/sim3.ts", "sim3-unlocks-unit.mjs");
  const P = await bundle("src/tree/places.ts", "places-unlocks-unit.mjs");
  const none = { counters: {}, unlocked: new Set(), all: false, tutorialDone: false };

  // 1. the catalog is sane
  const ids = U.CATALOG.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length, "unique ids");
  for (const u of U.CATALOG) {
    assert.ok(/^(animal|tool|place):[A-Za-z0-9_.-]+$/.test(u.id), `id shape ${u.id}`);
    assert.ok(u.name && u.what, `${u.id} has a name and a description`);
    for (const n of u.needs) assert.ok(U.COUNTERS.includes(n.counter) && Number.isInteger(n.n) && n.n > 0, `${u.id}: a real need`);
    assert.ok(u.needs.length > 0 || u.tutorial, `${u.id} needs something (counters or the tutorial)`);
  }
  // every animal of the game is either a start animal or in the catalog (nothing unreachable, nothing silently free)
  const A = S.ANIMALS.map((a) => a.id);
  for (const a of A) assert.ok(U.START.includes(U.animalUnlockId(a)) || ids.includes(U.animalUnlockId(a)), `animal ${a} is a start animal or unlockable`);
  assert.deepEqual(U.START, ["animal:lizard", "animal:ant"], "start with the lizard and the ant (the reader)");
  // the core is never lockable: only animals and tools are in the catalog, no id for reading / search / capture / the library
  assert.ok(U.CATALOG.every((u) => u.kind !== "place" || u.id.startsWith("place:")));
  assert.ok(!ids.some((i) => /read|search|capture|library/.test(i)), "reading, search, capture and the library are never locked");
  // every counter's number is reachable and the last animals take longer than the first
  const needs = (id) => U.CATALOG.find((u) => u.id === id).needs;
  assert.ok(needs("animal:eagle").length > needs("animal:cat").length, "the eagle asks for more than the cat");
  assert.ok(needs("animal:eagle").find((n) => n.counter === "leaps").n > needs("animal:squirrel").find((n) => n.counter === "leaps").n, "the eagle needs more leaps than the squirrel");

  // 2. isUnlocked
  assert.equal(U.isUnlocked("animal:lizard", none), true);
  assert.equal(U.isUnlocked("animal:ant", none), true);
  assert.equal(U.isUnlocked("animal:eagle", none), false);
  assert.equal(U.isUnlocked("tool:edit", none), false);
  assert.equal(U.isUnlocked("animal:eagle", { ...none, all: true }), true, "unlock all");
  assert.equal(U.isUnlocked("animal:eagle", { ...none, unlocked: ["animal:eagle"] }), true, "array form");
  assert.equal(U.isUnlocked("animal:eagle", { ...none, unlocked: new Set(["animal:eagle"]) }), true, "set form");
  assert.equal(U.isUnlocked("something:unknown", none), true, "ids outside the catalog are not lockable");

  // 3. earning
  assert.equal(U.newlyEarned(none).length, 0, "a fresh player has earned nothing");
  const c1 = U.bumpCounter({}, "distance", 150);
  assert.deepEqual(U.newlyEarned({ ...none, counters: c1 }).map((u) => u.id), ["animal:cat"]);
  assert.equal(U.newlyEarned({ ...none, counters: c1, unlocked: new Set(["animal:cat"]) }).length, 0, "already unlocked: not announced again");
  const both = { distance: 1200, branches: 24 };
  assert.ok(!U.newlyEarned({ ...none, counters: both }).some((u) => u.id === "animal:constrictor"), "both needs must be met");
  assert.ok(U.newlyEarned({ ...none, counters: { ...both, branches: 25 } }).some((u) => u.id === "animal:constrictor"));
  assert.ok(!U.newlyEarned({ ...none, counters: {} }).some((u) => u.id === "tool:edit"));
  assert.ok(U.newlyEarned({ ...none, tutorialDone: true }).map((u) => u.id).join().includes("tool:edit"), "tools unlock with the tutorial");
  assert.ok(U.newlyEarned({ ...none, tutorialDone: true }).some((u) => u.id === "tool:build"));

  // 4. counters: garbage never adds, sums are bounded
  assert.equal(U.bumpCounter({}, "read", NaN).read, 0);
  assert.equal(U.bumpCounter({}, "read", -5).read, 0);
  assert.equal(U.bumpCounter({}, "read", Infinity).read, 0);
  assert.equal(U.bumpCounter({ read: 1e9 }, "read", 5).read, 1e9);
  assert.equal(U.bumpCounter({ read: 2 }, "read", 3).read, 5);
  const frozen = Object.freeze({ read: 1 });
  U.bumpCounter(frozen, "read", 1); // must not mutate

  // 5. the progress text
  const spider = U.CATALOG.find((u) => u.id === "animal:spider");
  assert.ok(/2 leaves read \(1\/2\)/.test(U.requirementText(spider, { read: 1 })), U.requirementText(spider, { read: 1 }));
  assert.ok(/finish or skip/.test(U.requirementText(U.CATALOG.find((u) => u.id === "tool:edit"), {})));
  assert.deepEqual(U.progressOf(spider, { read: 5 }).map((p) => p.ok), [true]);

  // 6. the animal gate: number keys skip locked animals
  const only = (set) => (id) => set.includes(id);
  const idAt = (i) => (i < 0 ? null : S.ANIMALS[i].id);
  assert.equal(idAt(S.animalForKey(2, "lizard", only(["spider", "snake"]))), "spider", "first allowed crawler");
  assert.equal(idAt(S.animalForKey(2, "spider", only(["spider", "snake"]))), "snake", "next allowed crawler (skips the locked ones)");
  assert.equal(idAt(S.animalForKey(2, "snake", only(["spider", "snake"]))), "spider", "wraps");
  assert.equal(S.animalForKey(4, "lizard", only([])), -1, "a locked category selects nothing");
  assert.equal(idAt(S.animalForKey(1, "ant", only(["ant"]))), "ant", "the reader category keeps the ant");
  assert.equal(S.animalForKey(5, "lizard"), -1, "unknown key");
  assert.equal(idAt(S.animalForKey(3, "lizard")), "cat", "no gate: the old behaviour");

  // 7. places are filtered by their unlock id
  const places = [{ id: "a", unlock: "tool:x" }, { id: "b" }];
  assert.deepEqual(P.visiblePlaces(places, () => false).map((p) => p.id), ["b"]);
  assert.deepEqual(P.visiblePlaces(places, () => true).map((p) => p.id), ["a", "b"]);
  assert.ok(P.PLACES.every((p) => !p.unlock), "the porch and the wisp are always there");

  // 8. the tutorial: steps in order, each waits for its own action
  const order = T.STEPS.map((s) => s.id);
  assert.deepEqual(order, ["walk", "climb", "leap", "read", "altar", "animal", "zoom"]);
  for (const s of T.STEPS) assert.ok(s.title && s.keys && s.mouse && s.kbd.length > 0, `${s.id} has keyboard + mouse text and keys`);
  let t = T.startTutorial();
  assert.equal(T.currentStep(t.state).id, "walk");
  assert.deepEqual(T.stepNumber(t.state), { n: 1, of: 7 });
  let r = T.feed(t, { kind: "zoom" });
  assert.equal(r.changed, false, "the wrong action does nothing");
  r = T.feed(t, { kind: "distance", m: 2 });
  assert.equal(r.changed, false);
  t = r.tutorial;
  assert.equal(t.walked, 2, "walking accumulates");
  r = T.feed(t, { kind: "distance", m: T.WALK_NEEDED });
  assert.equal(r.changed, true);
  t = r.tutorial;
  assert.equal(T.currentStep(t.state).id, "climb");
  assert.equal(t.walked, 0);
  assert.equal(T.feed(t, { kind: "enter", up: false }).changed, false, "stepping down / sideways is not climbing in");
  t = T.feed(t, { kind: "enter", up: true }).tutorial;
  assert.equal(T.currentStep(t.state).id, "leap");
  t = T.feed(t, { kind: "leap" }).tutorial;
  t = T.feed(t, { kind: "read" }).tutorial;
  t = T.feed(t, { kind: "altar" }).tutorial;
  assert.equal(T.currentStep(t.state).id, "animal");
  t = T.feed(t, { kind: "animal" }).tutorial;
  assert.equal(T.currentStep(t.state).id, "zoom");
  r = T.feed(t, { kind: "zoom" });
  assert.equal(r.changed, true);
  assert.deepEqual(r.tutorial.state, { step: "", done: true, skipped: false });
  assert.equal(T.currentStep(r.tutorial.state), null, "finished: no card");
  assert.equal(T.finished(r.tutorial.state), true);
  assert.equal(T.feed(r.tutorial, { kind: "zoom" }).changed, false, "a finished tutorial ignores events");
  // a mouse player: a click to walk finishes the walk step at once
  assert.equal(T.currentStep(T.feed(T.startTutorial(), { kind: "walkTo" }).tutorial.state).id, "climb");
  // skip / replay / resume / garbage
  const sk = T.skip();
  assert.equal(T.isActive(sk.state), false);
  assert.equal(T.finished(sk.state), true, "a skipped tutorial counts as finished for unlocking");
  assert.equal(T.currentStep(T.replay().state).id, "walk");
  assert.equal(T.currentStep(T.startTutorial({ step: "read", done: false, skipped: false }).state).id, "read", "resumes where it was saved");
  assert.equal(T.currentStep({ step: "", done: false, skipped: false }).id, "walk", "the empty default starts at the first step");
  assert.equal(T.currentStep({ step: "nonsense", done: false, skipped: false }).id, "walk", "an unknown saved step restarts");
  for (const bad of [NaN, -3, Infinity, "x", null]) T.feed(T.startTutorial(), { kind: "distance", m: bad }); // never throws
  assert.equal(T.feed(T.startTutorial(), { kind: "distance", m: NaN }).tutorial.walked, 0);
  assert.equal(T.feed(T.startTutorial(), { kind: "distance", m: -4 }).tutorial.walked, 0);

  // 9. the store (state/progress.ts) on a localStorage shim: persistence, unlock-all default, toasts, the tutorial through game events
  {
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k), get length() { return mem.size; }, key: (i) => [...mem.keys()][i] ?? null };
    const timers = [];
    globalThis.window = { location: { search: "" }, setTimeout: (f) => (timers.push(f), timers.length), clearTimeout: () => undefined };
    const fresh = async () => bundle("src/state/progress.ts", `progress-unit-${Math.random().toString(36).slice(2)}.mjs`);
    // a new browser: locked, the default is stored
    let PG = await fresh();
    PG.ensureLoaded();
    assert.equal(PG.unlockAll(), false, "a new browser starts locked");
    assert.equal(mem.get("biblio.v1.unlockAll"), "off");
    assert.equal(PG.canAnimal("lizard"), true);
    assert.equal(PG.canAnimal("eagle"), false);
    assert.equal(PG.can("tool:edit"), false);
    assert.equal(PG.can("whatever"), true);
    // counters earn animals; a version bump tells the UI
    let v0 = PG.progressVersion();
    PG.game({ kind: "distance", m: 150 });
    assert.equal(PG.canAnimal("cat"), true, "150 m unlock the cat");
    assert.ok(PG.progressVersion() > v0);
    PG.game({ kind: "leap" }); PG.game({ kind: "leap" }); PG.game({ kind: "leap" });
    assert.equal(PG.canAnimal("squirrel"), true);
    // the tutorial runs on the same events, and finishing it unlocks the tools
    assert.equal(PG.getTutorial().step, "climb", "the 150 m walked above finished the walk step; the leaps did not finish 'climb'");
    PG.game({ kind: "enter", up: true });
    assert.equal(PG.getTutorial().step, "leap");
    PG.skipTutorial();
    assert.equal(PG.getTutorial().skipped, true);
    assert.equal(PG.can("tool:edit"), true, "skipping counts: the tools unlock");
    assert.equal(PG.can("tool:build"), true);
    PG.replayTutorial();
    assert.equal(PG.getTutorial().step, "walk");
    assert.equal(PG.can("tool:edit"), true, "replaying does not lock anything again");
    // persisted locally (flush) and reloaded by a fresh module
    PG.flushProgress();
    const saved = JSON.parse(mem.get("biblio.v1.save"));
    assert.ok(saved.progress.counters.distance >= 150 && saved.progress.unlocked.includes("animal:cat"), "progress is stored");
    PG = await fresh();
    PG.ensureLoaded();
    assert.equal(PG.canAnimal("cat"), true, "a reload keeps the unlocks");
    assert.equal(PG.getTutorial().step, "walk", "the replayed tutorial resumes (saved) at its first step");
    // the switch
    PG.setUnlockAll(true);
    assert.equal(PG.canAnimal("eagle"), true);
    assert.equal(mem.get("biblio.v1.unlockAll"), "on");
    PG.setUnlockAll(false);
    assert.equal(PG.canAnimal("eagle"), false);
    // someone who has already used the tree keeps everything (the unlock system must not take animals away)
    mem.clear();
    mem.set("biblio.v1.treeLook", "lowpoly");
    PG = await fresh();
    PG.ensureLoaded();
    assert.equal(PG.unlockAll(), true, "an existing player starts with everything unlocked");
    assert.equal(mem.get("biblio.v1.unlockAll"), "on");
    // the query override is per session and is not stored
    mem.clear();
    globalThis.window.location.search = "?unlock=all";
    PG = await fresh();
    assert.equal(PG.unlockAll(), true);
    assert.notEqual(mem.get("biblio.v1.unlockAll"), "on", "the override is not remembered");
    globalThis.window.location.search = "";
    // a damaged save never breaks it
    mem.clear();
    mem.set("biblio.v1.save", "{not json");
    PG = await fresh();
    PG.ensureLoaded();
    assert.equal(PG.canAnimal("eagle"), false);
    PG.game({ kind: "distance", m: NaN });
    delete globalThis.localStorage;
    delete globalThis.window;
  }
};
