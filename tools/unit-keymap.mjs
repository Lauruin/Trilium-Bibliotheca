// Unit checks for tree/keymap.ts (actions, default bindings, parsing hostile input, rebinding, labels, key tokens in texts). Run by tools/unit-test.mjs.
export default async ({ bundle, assert }) => {
  const K = await bundle("src/tree/keymap.ts", "keymap-unit.mjs");

  // 1. the defaults are sane and conflict-free
  const d = K.defaultBindings();
  assert.deepEqual(K.conflicts(d), [], "no key is bound twice by default");
  assert.equal(new Set(K.ACTION_IDS).size, K.ACTION_IDS.length);
  for (const a of K.ACTIONS) {
    assert.ok(a.label && a.help && K.GROUPS.includes(a.group), `${a.id} is described and grouped`);
    assert.ok(a.keys.length >= 1 && a.keys.length <= K.MAX_KEYS, `${a.id} has 1..${K.MAX_KEYS} default keys`);
    for (const k of a.keys) assert.ok(K.isBindable(k) && k === k.toLowerCase(), `${a.id}: default key ${JSON.stringify(k)} is bindable and lower-case`);
  }
  // the keys the game has always had
  const has = (id, k) => assert.ok(d[id].includes(k), `${id} has ${k}`);
  has("forward", "w"); has("forward", "arrowup"); has("back", "s"); has("left", "a"); has("right", "d"); has("leap", " "); has("climb", "shift");
  has("silk", "x"); has("cut", "c"); has("interact", "e"); has("cat1", "1"); has("cat4", "4"); has("grip", "g"); has("camera", "v"); has("edit", "b");
  has("zoomIn", "+"); has("zoomIn", "="); has("zoomOut", "-"); has("look", "l"); has("shadows", "k"); has("perf", "i");
  assert.equal(K.actionFor(d, "W"), "forward", "keys are matched case-insensitively");
  assert.equal(K.actionFor(d, " "), "leap");
  assert.equal(K.actionFor(d, "q"), null);
  assert.equal(K.actionFor(d, "Escape"), null, "Escape is never an action (it is always the menu)");

  // 2. parsing never throws and repairs
  assert.deepEqual(K.parseBindings(null), d);
  assert.deepEqual(K.parseBindings("not json"), d);
  assert.deepEqual(K.parseBindings("[1,2]"), d);
  assert.deepEqual(K.parseBindings(42), d);
  assert.deepEqual(K.parseBindings(""), d);
  const hostile = K.parseBindings(JSON.stringify({
    forward: ["Up", "w", "w", "x", "y"], back: 7, left: ["escape", "f12", "tab"], leap: [], bogus: ["q"], grip: ["a"], cut: ["\u0000"], look: ["x".repeat(50)], __proto__: { x: 1 },
  }));
  assert.deepEqual(hostile.forward, ["up", "w"], "at most two keys, lower-cased, deduplicated");
  assert.deepEqual(hostile.back, d.back, "a damaged entry takes the default");
  assert.deepEqual(hostile.left, [], "reserved keys are dropped (the action becomes unbound)");
  assert.deepEqual(hostile.leap, [], "an empty list is a valid choice");
  assert.equal(hostile.cut.length === 0 || hostile.cut[0] !== "\u0000", true);
  assert.deepEqual(hostile.look, [], "an over-long key is dropped (the action then has none)");
  assert.deepEqual(K.conflicts(hostile), [], "a key given twice stays with the first action");
  assert.deepEqual(hostile.grip, ["a"], "'a' is free here (left lost it with its reserved keys), so grip may take it");
  assert.ok(!("bogus" in hostile));
  // round trip
  const mine = K.rebind(d, "grip", 0, "z").bindings;
  assert.deepEqual(K.parseBindings(K.serializeBindings(mine)), mine);

  // 3. rebinding
  let r = K.rebind(d, "grip", 0, "z");
  assert.equal(r.ok, true);
  assert.deepEqual(r.bindings.grip, ["z"]);
  assert.equal(r.stolenFrom, null);
  assert.equal(K.actionFor(r.bindings, "g"), null, "the old key is free");
  assert.equal(K.actionFor(r.bindings, "z"), "grip");
  assert.deepEqual(d.grip, ["g"], "the input is not mutated");
  r = K.rebind(d, "grip", 0, "v"); // v belongs to the camera
  assert.equal(r.stolenFrom, "camera", "taking a key reports who lost it");
  assert.deepEqual(r.bindings.camera, []);
  assert.deepEqual(K.conflicts(r.bindings), []);
  r = K.rebind(d, "forward", 1, "i"); // second slot of forward (was the up arrow), i belonged to perf
  assert.deepEqual(r.bindings.forward, ["w", "i"]);
  assert.deepEqual(r.bindings.perf, []);
  r = K.rebind(d, "grip", 1, "j"); // a second key for an action with one
  assert.deepEqual(r.bindings.grip, ["g", "j"]);
  r = K.rebind(d, "grip", 0, "g");
  assert.deepEqual(r.bindings.grip, ["g"], "rebinding to the same key changes nothing");
  r = K.rebind(d, "forward", 1, "w");
  assert.deepEqual(r.bindings.forward, ["w"], "the same key in both slots is kept once");
  for (const bad of ["escape", "Tab", "F12", "", "x".repeat(40), "Control", "\u0001"]) assert.equal(K.rebind(d, "grip", 0, bad).ok, false, `${JSON.stringify(bad)} cannot be bound`);
  assert.equal(K.rebind(d, "grip", 5, "z").ok, false, "a bad slot");
  assert.equal(K.rebind(d, "nope", 0, "z").ok, false, "an unknown action");
  assert.deepEqual(K.unbind(d, "forward", 0).forward, ["arrowup"]);
  // fuzz: any sequence of rebinds leaves no conflicts and valid keys
  let b = d;
  const keys = ["a", "b", "c", "1", " ", "shift", "arrowup", "+", "z", "q", "Enter"];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 400; i++) {
    const act = K.ACTION_IDS[Math.floor(rnd() * K.ACTION_IDS.length)];
    b = K.rebind(b, act, Math.floor(rnd() * 2), keys[Math.floor(rnd() * keys.length)]).bindings;
    if (rnd() < 0.1) b = K.unbind(b, act, 0);
    assert.deepEqual(K.conflicts(b), [], `no conflicts after step ${i}`);
    for (const id of K.ACTION_IDS) assert.ok(b[id].length <= K.MAX_KEYS && b[id].every((k) => K.isBindable(k)), `${id} stays valid`);
  }

  // 4. labels and key tokens
  assert.equal(K.keyLabel("w"), "W");
  assert.equal(K.keyLabel(" "), "Space");
  assert.equal(K.keyLabel("arrowup"), "↑");
  assert.equal(K.keyLabel("shift"), "Shift");
  assert.equal(K.keyLabel("enter"), "Enter");
  assert.equal(K.firstKey(d, "leap"), "Space");
  assert.equal(K.firstKey(K.unbind(d, "grip", 0), "grip"), "—");
  assert.equal(K.fillKeys("Hold {forward} then {leap}; {nonsense} stays", d), "Hold W then Space; {nonsense} stays");
  assert.equal(K.fillKeys("Hold {forward}", K.rebind(d, "forward", 0, "t").bindings), "Hold T", "the text follows a rebinding");
};
