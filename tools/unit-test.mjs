// Unit checks for src/lib/library.ts — bundled with esbuild, run on a fake client.
import { build } from "esbuild";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "biblio-unit-"));
async function bundle(entry, name) {
  const outfile = join(dir, name);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
}
const { walkLibraryTree, buildRoomContents } = await bundle("src/lib/library.ts", "library.mjs");

const note = (id, children = [], labels = []) => ({
  noteId: id, title: id, type: "text", childNoteIds: children,
  attributes: labels.map((name) => ({ type: "label", name, value: "" })),
});
const fake = (notes) => ({ getNote: async (id) => notes[id] });

// 1. noise labels (camelCase) never become shelves
{
  const c = fake({ root: note("root", ["a"]), a: note("a", [], ["iconClass", "cssClass", "topic"]) });
  const tree = await walkLibraryTree(c, "root");
  const room = buildRoomContents(tree, "root");
  assert.deepEqual(room.shelves.map((s) => s.tag), ["topic"]);
}
// 2. depth cap stops only that branch; truncated is true, siblings still walked
{
  const c = fake({ root: note("root", ["a", "b"]), a: note("a", ["a1"]), a1: note("a1"), b: note("b", [], ["x"]) });
  const tree = await walkLibraryTree(c, "root", { maxNodes: 100, maxDepth: 1 });
  assert.ok(tree.notes.b, "sibling b walked");
  assert.equal(tree.truncated, true);
  const full = await walkLibraryTree(c, "root", { maxNodes: 100, maxDepth: 5 });
  assert.equal(full.truncated, false);
}
// 3. clones keep every parent edge
{
  const c = fake({ root: note("root", ["p", "q"]), p: note("p", ["k"]), q: note("q", ["k"]), k: note("k") });
  const tree = await walkLibraryTree(c, "root");
  assert.equal(tree.edges.filter((e) => e.noteId === "k").length, 2);
}
// 4. quick capture: text → title/body, inbox reuse vs creation
{
  const cap = await bundle("src/lib/capture.ts", "capture.mjs");
  assert.equal(cap.noteFromText("   \n "), null);
  const n = cap.noteFromText("Buy <milk>\nand eggs\n\nsecond para & more");
  assert.equal(n.title, "Buy <milk>");
  assert.equal(n.content, "<p>Buy &lt;milk&gt;<br>and eggs</p><p>second para &amp; more</p>");
  assert.ok(cap.noteFromText("x".repeat(200)).title.length <= 60);

  const calls = [];
  const mk = (existing) => ({
    searchNotes: async (q) => (calls.push(["search", q]), { results: existing }),
    createNote: async (d) => (calls.push(["create", d.parentNoteId, d.title]), { note: { noteId: "n" + calls.length } }),
    createAttribute: async (d) => calls.push(["attr", d.noteId, d.name]),
  });
  await cap.captureNote(mk([{ noteId: "inb" }]), "root", "hello");
  assert.deepEqual(calls.filter((c) => c[0] === "create"), [["create", "inb", "hello"]]);
  calls.length = 0;
  await cap.captureNote(mk([]), "root", "hello");
  assert.deepEqual(calls.filter((c) => c[0] !== "search").map((c) => c.slice(0, 3)), [
    ["create", "root", "Inbox"], ["attr", "n2", "biblio_inbox"], ["create", "n2", "hello"],
  ]);
  assert.equal(await cap.captureNote(mk([]), "root", "  "), null);

  // share target query → prefill text
  assert.equal(cap.sharedText(""), null);
  assert.equal(cap.sharedText("?title=T&text=hello&url=https%3A%2F%2Fx.org"), "T\nhello\nhttps://x.org");
  assert.equal(cap.sharedText("?text=see%20https%3A%2F%2Fx.org&url=https%3A%2F%2Fx.org"), "see https://x.org");
}
// 5. auto-placement gives EVERY room its own cell (shared generator once placed only one)
{
  const { computePlacements } = await bundle("src/lib/layout.ts", "layout.mjs");
  const notes = Object.fromEntries(["root", "a", "b", "c", "d"].map((id) => [id, { noteId: id, labels: {}, hasChildren: true }]));
  const pl = computePlacements({ rootNoteId: "root", notes, edges: [], truncated: false }, ["root", "a", "b", "c", "d"]);
  assert.equal(pl.size, 5);
  assert.equal(new Set([...pl.values()].map((p) => `${p.x},${p.y}`)).size, 5);
}
// 6. shelving: a crowded tag continues on further cases; nothing is lost unless maxCases is hit
{
  const { packCases } = await bundle("src/lib/shelving.ts", "shelving.mjs");
  const books = Array.from({ length: 40 }, (_, i) => ({ noteId: "b" + i, title: "Volume " + i, type: "text", color: "#fff" }));
  const rc = { roomId: "r", title: "r", shelves: [{ tag: "reading", color: "#0f0", books }], desk: [], deskColor: "#888", doors: [], parentNoteId: null };
  const opts = { innerW: 46, tiers: 3, maxCases: 12 };
  const cases = packCases(rc, opts);
  assert.ok(cases.length > 1, "continues on more cases");
  assert.equal(cases.reduce((n, c) => n + c.slots.length, 0), 40);
  assert.deepEqual(cases.slice(0, 2).map((c) => c.tag), ["reading", "reading 2"]);
  const capped = packCases(rc, { ...opts, maxCases: 1 });
  assert.equal(capped.length, 1);
  assert.equal(capped[0].slots.length + capped[0].overflow, 40);
}
// 7. world building: own-label filter, themes, setLabel, undo journal
{
  const lib = await bundle("src/lib/library.ts", "library2.mjs");
  const mkNote = (id, attrs) => ({ noteId: id, title: id, type: "text", childNoteIds: [], attributes: attrs });
  const attr = (noteId, name, value, extra = {}) => ({ attributeId: `${noteId}_${name}`, noteId, type: "label", name, value, ...extra });
  // inherited label (owner = other note) must not count as the child's own
  const t = await lib.walkLibraryTree(
    { getNote: async () => mkNote("c", [attr("c", "biblio_theme", "ember"), attr("parent", "biblio_wing", "crypt")]) },
    "c",
  );
  assert.deepEqual(Object.keys(t.notes.c.labels), ["biblio_theme"]);
  // biblio_* labels never become shelves
  const fakeTree = fake({ root: note("root", ["a"]), a: note("a", [], ["biblio_whatever", "topic"]) });
  const rc = buildRoomContents(await walkLibraryTree(fakeTree, "root"), "root");
  assert.deepEqual(rc.shelves.map((x) => x.tag), ["topic"]);

  const th = await bundle("src/game/themes.ts", "themes.mjs");
  assert.equal(th.parseTheme("MIDNIGHT ").id, "midnight");
  assert.equal(th.parseTheme("nonsense"), undefined);
  const nt = (id, labels = {}) => [id, { noteId: id, title: id, type: "text", labels, hasChildren: true }];
  const tree = { rootNoteId: "root", truncated: false, notes: Object.fromEntries([nt("root", { biblio_wing: "crypt" }), nt("a"), nt("b", { biblio_theme: "ember" }), nt("c", { biblio_wing: "bogus" })]),
    edges: [{ parentNoteId: "root", noteId: "a" }, { parentNoteId: "a", noteId: "b" }, { parentNoteId: "a", noteId: "c" }] };
  assert.equal(th.resolveTheme(tree, "a").id, "crypt", "wing inherited");
  assert.equal(th.resolveTheme(tree, "b").id, "ember", "own beats wing");
  assert.equal(th.resolveTheme(tree, "c").id, "crypt", "garbled wing ignored");
  const empty = { rootNoteId: "root", truncated: false, notes: Object.fromEntries([nt("root")]), edges: [] };
  assert.equal(th.resolveTheme(empty, "root").id, "oak", "no labels = default");
  assert.ok(th.THEMES[0].wall === null && th.THEMES[0].grade === null, "oak has no tints");
  // cycle guard
  const cyc = { rootNoteId: "x", truncated: false, notes: Object.fromEntries([nt("x"), nt("y")]), edges: [{ parentNoteId: "x", noteId: "y" }, { parentNoteId: "y", noteId: "x" }] };
  assert.equal(th.resolveTheme(cyc, "x").id, "oak");
  assert.equal(th.wingRoomCount(tree, "a"), 3);

  const { setLabel, patchTreeLabel, LabelConflictError } = await bundle("src/lib/labels.ts", "labels.mjs");
  const { EditJournal } = await bundle("src/lib/edit.ts", "edit.mjs");
  const calls = [];
  let attrs = [attr("n", "biblio_theme", "ember"), attr("owner", "biblio_theme", "crypt")];
  const client = {
    getNote: async () => ({ noteId: "n", attributes: attrs }),
    createAttribute: async (d) => { calls.push(["create", d.name, d.value]); attrs = [...attrs, attr("n", d.name, d.value)]; },
    patchAttribute: async (id, d) => { calls.push(["patch", id, d.value]); attrs = attrs.map((a) => (a.attributeId === id ? { ...a, value: d.value } : a)); },
    deleteAttribute: async (id) => { calls.push(["delete", id]); attrs = attrs.filter((a) => a.attributeId !== id); },
  };
  assert.deepEqual(await setLabel(client, "n", "biblio_theme", "midnight"), { before: "ember" });
  assert.deepEqual(calls.pop(), ["patch", "n_biblio_theme", "midnight"], "patches OWN attribute, not the inherited one");
  assert.deepEqual(await setLabel(client, "n", "biblio_wing", "slate"), { before: null });
  assert.deepEqual(calls.pop(), ["create", "biblio_wing", "slate"]);
  assert.deepEqual(await setLabel(client, "n", "biblio_theme", null), { before: "midnight" });
  assert.deepEqual(calls.pop(), ["delete", "n_biblio_theme"]);
  await assert.rejects(setLabel(client, "n", "color", "red"), /non-biblio/);
  await assert.rejects(setLabel(client, "n", "biblio_theme", "x", "stale"), (e) => e instanceof LabelConflictError);
  assert.equal(calls.length, 0, "conflict writes nothing");

  attrs = [attr("n", "biblio_theme", "midnight"), attr("owner", "biblio_theme", "crypt")];
  const j = new EditJournal();
  j.push({ noteId: "n", name: "biblio_theme", before: "ember", after: "midnight", label: "x" });
  assert.ok(j.canUndo && !j.canRedo);
  await j.undo(client);
  assert.deepEqual(calls.pop(), ["patch", "n_biblio_theme", "ember"]);
  assert.ok(j.canRedo);
  await j.redo(client);
  assert.deepEqual(calls.pop(), ["patch", "n_biblio_theme", "midnight"]);

  const pt = { notes: { n: { labels: {} } } };
  patchTreeLabel(pt, "n", "biblio_theme", "crypt");
  assert.equal(pt.notes.n.labels.biblio_theme, "crypt");
  patchTreeLabel(pt, "n", "biblio_theme", null);
  assert.deepEqual(pt.notes.n.labels, {});
}
// 8. decor slots: CSV parse/serialise, defaults, unknown entries kept
{
  const d = await bundle("src/game/decor.ts", "decor.mjs");
  assert.deepEqual(d.parseCsv(" Window, ,PAINTING,-,auto "), ["window", "painting", "-", "auto"]);
  assert.deepEqual(d.parseCsv(undefined), []);
  assert.equal(d.parseCsv(Array.from({ length: 40 }, () => "a").join(",")).length, 24, "entries capped");
  assert.deepEqual(d.slotsOf("clock", 3), ["clock", "auto", "auto"]);
  assert.deepEqual(d.slotsOf("a,b,c,d", 2), ["a", "b", "c", "d"], "extra entries kept, not truncated");
  assert.equal(d.toCsv(["auto", "auto"]), null, "all-default removes the label");
  assert.equal(d.toCsv(["clock", "auto", "auto"]), "clock", "trailing autos dropped");
  assert.equal(d.toCsv(["auto", "banner"]), "auto,banner");
  assert.equal(d.toCsv(["future_kind", "window"]), "future_kind,window", "unknown kinds survive a rewrite");
  assert.ok(d.toCsv(Array.from({ length: 24 }, () => "telescope")).length <= 200, "length capped");
  assert.equal(d.parseRug("NAVY"), "navy");
  assert.equal(d.parseRug("tartan"), "crimson");
  assert.equal(d.parseRug(undefined), "crimson");
  assert.equal(d.wallSlotCount(640), 5);
  assert.equal(d.cycle(["a", "b", "c"], "c", 1), "a");
  assert.equal(d.cycle(["a", "b", "c"], "a", -1), "c");
  assert.equal(d.parseCase("Walnut"), "walnut");
  assert.equal(d.parseCase("pink"), "oak");
  assert.equal(d.parseSpan("3"), 3);
  assert.equal(d.parseSpan("99"), 4, "span clamped");
  assert.equal(d.parseSpan("-2"), 0);
  assert.equal(d.parseSpan("abc"), 0);
  assert.equal(d.parseSpan(undefined), 0);
  assert.ok(d.isFloorKind("lamp") && !d.isFloorKind("window") && d.isWallKind("banner"));
}
// 9. review fixes: serialized undo, conflict-safe undo, duplicate labels, layout writes own labels only
{
  const { EditJournal } = await bundle("src/lib/edit.ts", "edit2.mjs");
  const { setLabel, LabelConflictError } = await bundle("src/lib/labels.ts", "labels2.mjs");
  const { saveRoomPosition } = await bundle("src/lib/layout.ts", "layout2.mjs");
  const mkAttr = (noteId, name, value, id) => ({ attributeId: id ?? `${noteId}_${name}`, noteId, type: "label", name, value });

  // two overlapping undos must undo TWO different entries, once each
  let state = { v: "c" };
  const writes = [];
  const slow = {
    getNote: async () => { await new Promise((r) => setTimeout(r, 15)); return { noteId: "n", attributes: [mkAttr("n", "biblio_theme", state.v)] }; },
    patchAttribute: async (id, d) => { writes.push(d.value); state.v = d.value; },
    deleteAttribute: async () => { writes.push(null); },
    createAttribute: async () => {},
  };
  const j = new EditJournal();
  j.push({ noteId: "n", name: "biblio_theme", before: "a", after: "b", label: "1" });
  j.push({ noteId: "n", name: "biblio_theme", before: "b", after: "c", label: "2" });
  const [r1, r2] = await Promise.all([j.undo(slow), j.undo(slow)]);
  assert.deepEqual(writes, ["b", "a"], "each undo applied once, in order");
  assert.equal(r1.label, "2");
  assert.equal(r2.label, "1");
  assert.equal(j.canUndo, false);

  // undo refuses to overwrite a label that changed elsewhere
  state = { v: "zzz" };
  writes.length = 0;
  const j2 = new EditJournal();
  j2.push({ noteId: "n", name: "biblio_theme", before: "a", after: "b", label: "x" });
  await assert.rejects(j2.undo(slow), (e) => e.message.includes("changed elsewhere") && e.actual === "zzz"); // (separate bundles → no instanceof)
  assert.equal(writes.length, 0);
  assert.ok(j2.canUndo, "entry stays on the stack after a conflict");

  // duplicate own labels: the LAST one is "the" label (reader semantics); strays are removed
  const dupCalls = [];
  const dup = {
    getNote: async () => ({ noteId: "n", attributes: [mkAttr("n", "biblio_theme", "first", "A1"), mkAttr("n", "biblio_theme", "second", "A2")] }),
    patchAttribute: async (id, d) => dupCalls.push(["patch", id, d.value]),
    deleteAttribute: async (id) => dupCalls.push(["delete", id]),
    createAttribute: async () => {},
  };
  assert.deepEqual(await setLabel(dup, "n", "biblio_theme", "x"), { before: "second" });
  assert.deepEqual(dupCalls, [["delete", "A1"], ["patch", "A2", "x"]]);

  // saveRoomPosition never patches an inherited biblio_x owned by an ancestor
  const posCalls = [];
  const pos = {
    getNote: async () => ({ noteId: "n", attributes: [mkAttr("anc", "biblio_x", "9", "INH")] }),
    patchAttribute: async (id) => posCalls.push(["patch", id]),
    deleteAttribute: async () => {},
    createAttribute: async (d) => posCalls.push(["create", d.noteId, d.name, d.value]),
  };
  await saveRoomPosition(pos, "n", 3, 4);
  assert.deepEqual(posCalls, [["create", "n", "biblio_x", "3"], ["create", "n", "biblio_y", "4"]]);
}
// 10. reader: link recognition + prefs sanitising
{
  const r = await bundle("src/lib/reader.ts", "reader.mjs");
  assert.equal(r.internalNoteId("#root/abc123/Dd9fKq"), "Dd9fKq");
  assert.equal(r.internalNoteId("/#root/Dd9fKq?viewMode=x"), "Dd9fKq");
  assert.equal(r.internalNoteId("#Dd9fKq"), "Dd9fKq");
  assert.equal(r.internalNoteId("https://trilium.example.com/#root/xyz789"), "xyz789");
  assert.equal(r.internalNoteId("https://example.org/page"), null, "no fragment → external");
  assert.equal(r.internalNoteId("https://example.org/page#section"), null, "plain fragment on a foreign URL is just an anchor");
  assert.equal(r.internalNoteId("javascript:alert(1)#abcd"), null);
  assert.equal(r.internalNoteId("#"), null);
  assert.equal(r.internalNoteId("mailto:a@b.c"), null);
  assert.deepEqual(r.sanitizePrefs(null), r.DEFAULT_PREFS);
  assert.equal(r.sanitizePrefs({ size: 999 }).size, r.FONT_MAX);
  assert.equal(r.sanitizePrefs({ size: 1 }).size, r.FONT_MIN);
  assert.equal(r.sanitizePrefs({ font: "comic", paper: "neon", width: "huge" }).font, "book");
  assert.equal(r.sanitizePrefs({ paper: "night" }).paper, "night");
  const doc = r.readerDocument("<p>x</p>", r.DEFAULT_PREFS, "NONCE123");
  assert.ok(doc.includes("script-src 'nonce-NONCE123'") && doc.includes('<script nonce="NONCE123">'));
  assert.ok(!doc.includes("allow-same-origin"));
}
// 11. Yggdrasil (3D rails): frames, steering, trailing body, procedural feet, grip, leaps, snake reach
{
  const W = await bundle("src/tree/world3.ts", "w3.mjs");
  const S = await bundle("src/tree/sim3.ts", "s3.mjs");
  const world = W.makeDemoWorld();
  const idle = S.NO_INPUT;
  const run = (c, input, secs, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) S.step(world, c, input, dt); };
  const trunk = world.branches.get("trunk");

  // geometry: surface point is r from the centreline, top faces up, frames are orthonormal
  for (const th of [0, 1, 2.5, -1.2, Math.PI]) {
    const sp = W.surfacePoint(trunk, 700, th);
    assert.ok(Math.abs(W.dist(sp.p, sp.f.p) - trunk.r) < 1e-6, "on the surface");
    assert.ok(Math.abs(W.len(sp.n) - 1) < 1e-9 && Math.abs(W.dot(sp.n, sp.f.t)) < 1e-9, "normal ⟂ tangent");
    assert.ok(Math.abs(W.thetaOf(sp.f, W.sub(sp.p, sp.f.p)) - W.wrapAngle(th)) < 1e-9, "thetaOf inverts surfacePoint");
  }
  assert.ok(W.surfacePoint(trunk, 300, 0).n.y > 0.9, "th=0 is the top (world up)");
  const climb = world.branches.get("climb");
  assert.ok(Math.abs(W.dot(W.frameAt(climb, 100).u, W.frameAt(climb, 100).t)) < 1e-9, "vertical branch still gets a valid frame");
  assert.ok(W.nearestOnBranch(trunk, W.surfacePoint(trunk, 640, 1).p).dist < trunk.r + 1e-6);
  assert.equal(W.wrapAngle(3 * Math.PI), Math.PI);

  // W moves forward; straight heading stays on top
  let c = S.spawn(world, S.ANIMALS[0], "trunk", 200);
  run(c, { ...idle, forward: true }, 1);
  assert.ok(c.head.s > 330 && Math.abs(c.head.th) < 1e-6);

  // steering spirals around the branch; with autoAlign off the heading is NOT auto-corrected (autoAlign: see section 15)
  c = S.spawn(world, S.ANIMALS[0], "trunk", 200);
  c.autoAlign = false;
  run(c, { ...idle, right: true }, 0.4);
  const phiHeld = c.phi, th0 = c.head.th;
  run(c, { ...idle, forward: true }, 0.8);
  assert.equal(c.phi, phiHeld, "no auto-correction");
  assert.ok(Math.abs(c.head.th - th0) > 0.3, "steered heading wraps around the branch");

  // body trails the head at fixed distances along the path
  c = S.spawn(world, S.ANIMALS[0], "trunk", 300);
  run(c, { ...idle, forward: true }, 1.5);
  const p0 = S.bodyPoint(c, 0), p1 = S.bodyPoint(c, 30), p2 = S.bodyPoint(c, 60);
  assert.ok(p0.surf.s > p1.surf.s && p1.surf.s > p2.surf.s, "body behind head");
  assert.ok(Math.abs(W.dist(p0.p, p2.p) - 60) < 8, "straight path: distance ≈ node offset");

  // feet: planted when still; diagonal gait; keep up at full speed
  c = S.spawn(world, S.ANIMALS[0], "trunk", 300);
  run(c, idle, 0.5);
  assert.ok(c.feet.every((f) => f.t < 0), "standing: all planted");
  let maxGroups = 0, stepped = false, maxStretch = 0;
  for (let t = 0; t < 3; t += 1 / 60) {
    S.step(world, c, { ...idle, forward: true }, 1 / 60);
    maxGroups = Math.max(maxGroups, new Set(c.animal.legs.filter((l, i) => c.feet[i].t >= 0 && c.feet[i].t < 0.6).map((l) => l.group)).size);
    if (c.feet.some((f) => f.t >= 0)) stepped = true;
    c.animal.legs.forEach((leg, i) => {
      const hip = S.bodyPoint(c, c.animal.nodes[leg.node].d).surf;
      if (hip && hip.b === c.feet[i].at.b) maxStretch = Math.max(maxStretch, S.surfaceDist(world, hip, c.feet[i].at));
    });
  }
  assert.ok(stepped, "walking steps feet");
  assert.ok(maxGroups <= 2, "gait groups");
  assert.ok(maxStretch < c.animal.stride * 3.2, `feet keep up (${maxStretch.toFixed(1)})`);

  // junctions pick a child by heading; dead ends stop
  c = S.spawn(world, S.ANIMALS[0], "trunk", trunk.total - 20);
  run(c, { ...idle, forward: true }, 1);
  assert.ok(["up", "down"].includes(c.head.b), "continued onto a child");
  assert.ok(Number.isFinite(c.phi) && Number.isFinite(c.head.th));
  c = S.spawn(world, S.ANIMALS[0], "up", world.branches.get("up").total - 5);
  run(c, { ...idle, forward: true }, 1);
  assert.ok(Math.abs(c.head.s - world.branches.get("up").total) < 1e-6, "dead end stops");

  // side branch (the vertical "climb" leaves the trunk mid-way): hold Shift in its base to climb; otherwise walk past
  let passedBy = true, climbed = false;
  c = S.spawn(world, S.ANIMALS[0], "trunk", 900);
  for (let t = 0; t < 3; t += 1 / 60) { S.step(world, c, { ...idle, forward: true }, 1 / 60); if (c.head.b !== "trunk") passedBy = false; }
  assert.ok(passedBy, "without Shift you walk past the junction");
  c = S.spawn(world, S.ANIMALS[0], "trunk", 900);
  for (let t = 0; t < 3; t += 1 / 60) { S.step(world, c, { ...idle, forward: true, climb: true }, 1 / 60); if (c.head.b === "climb") climbed = true; }
  assert.ok(climbed, "Shift at the base climbs the side branch");
  // going back down returns to the PARENT at the attach point (not its end)
  c = S.spawn(world, S.ANIMALS[0], "climb", 30);
  c.autoAlign = false; // (with it the transfer lands at phi≈±π/2 and the animal would straighten out along the trunk)
  c.phi = Math.PI; // walk backwards along the branch
  run(c, { ...idle, forward: true }, 1.5);
  assert.equal(c.head.b, "trunk");
  assert.ok(Math.abs(c.head.s - 1010) < 120, `returned near the attach point (s=${c.head.s.toFixed(0)})`);

  // leap is relative to the SURFACE (away along the normal + forward) and always lands
  c = S.spawn(world, S.ANIMALS[0], "trunk", 800);
  const nrm = S.headNormal(world, c);
  S.step(world, c, { ...idle, leap: true }, 1 / 60);
  assert.ok(c.air && W.dot(W.norm(c.air.v), nrm) > 0.3, "leaves the surface along the normal");
  run(c, idle, 4);
  assert.equal(c.air, null, "always lands");
  c = S.spawn(world, S.ANIMALS[0], "trunk", 800);
  c.head.th = Math.PI / 2; // on the side: the jump must go sideways, not world-up
  const sideN = S.headNormal(world, c);
  S.step(world, c, { ...idle, leap: true }, 1 / 60);
  assert.ok(W.dot(W.norm(c.air.v), sideN) > 0.3, "from the side it jumps out sideways");

  // grip: hanging underneath drains it, shake rises, then slip (never fatal); top refills
  c = S.spawn(world, S.ANIMALS[0], "trunk", 300);
  c.head.th = Math.PI * 0.95;
  run(c, idle, 1.3);
  assert.ok(c.grip < 0.45 && c.shake > 0, "shaking before the fall");
  run(c, idle, 1);
  assert.ok(c.air && c.air.slip, "slipped off");
  run(c, idle, 5);
  assert.equal(c.air, null);
  assert.ok(Math.abs(c.head.th) < 1.6 || c.head.b !== "trunk", "ends up held again");
  c = S.spawn(world, S.ANIMALS[0], "trunk", 300);
  c.grip = 0.4;
  run(c, idle, 1);
  assert.ok(c.grip > 0.9 && c.shake === 0, "top refills the grip");
  c = S.spawn(world, S.ANIMALS[0], "trunk", 300);
  c.gripOn = false; c.head.th = Math.PI * 0.95;
  run(c, idle, 6);
  assert.equal(c.air, null, "grip off: no slipping");

  // cat clings mostly to the top; squirrel glides
  const cat = S.spawn(world, S.ANIMALS.find((x) => x.id === "cat"), "trunk", 300);
  run(cat, { ...idle, right: true }, 0.8);
  run(cat, { ...idle, forward: true }, 3);
  assert.ok(Math.abs(cat.head.th) <= 1.2 + 1e-9);
  const sq = S.spawn(world, S.ANIMALS.find((x) => x.id === "squirrel"), "trunk", 300);
  S.step(world, sq, { ...idle, leap: true }, 1 / 60);
  for (let t = 0; t < 1.5; t += 1 / 60) S.step(world, sq, idle, 1 / 60);
  if (sq.air) assert.ok(sq.air.v.y >= -140 - 1e-6, "glider has a slow terminal fall");

  // snake: long, straight, cannot jump; Space reaches: bridges to another branch, retracts, or falls
  const snakeA = S.ANIMALS.find((x) => x.id === "snake");
  assert.equal(snakeA.leap, null);
  assert.ok(Math.max(...snakeA.nodes.map((n) => n.d)) > 800, "snake is long");
  const mini = { branches: new Map() };
  W.addBranch(mini, W.makeBranch("a", W.smoothPath([W.v3(0, 0, 0), W.v3(500, 0, 0), W.v3(1000, 0, 0)]), 40));
  W.addBranch(mini, W.makeBranch("gap", W.smoothPath([W.v3(1180, 0, 0), W.v3(1500, 0, 0), W.v3(1900, 0, 0)]), 40));
  const runM = (c, input, secs) => { for (let t = 0; t < secs; t += 1 / 60) S.step(mini, c, input, 1 / 60); };
  let sn = S.spawn(mini, snakeA, "a", 980);
  S.step(mini, sn, { ...idle, leap: true }, 1 / 60);
  assert.equal(sn.air, null, "snake never jumps");
  runM(sn, { ...idle, reach: true, back: true }, 0.25); // dip the head (S): a level tip would just skim over the gap branch
  runM(sn, { ...idle, reach: true }, 0.25);
  assert.ok(sn.reach && sn.reach.len > 40, "reaching extends the head beyond the branch");
  assert.ok(sn.head.b === "a", "still anchored to its branch");
  for (let t = 0; t < 3 && sn.head.b === "a"; t += 1 / 60) S.step(mini, sn, { ...idle, reach: true }, 1 / 60);
  assert.equal(sn.head.b, "gap", "bridged to the next branch");
  assert.equal(sn.reach, null);
  // retract when released without contact
  sn = S.spawn(mini, snakeA, "a", 700);
  runM(sn, { ...idle, reach: true }, 0.6);
  assert.ok(sn.reach);
  runM(sn, idle, 3);
  assert.equal(sn.reach, null, "released: pulled back in");
  assert.equal(sn.head.b, "a");
  // nothing to hold on to: the head stops at max length and holds there while the body is on top (no fall any more)
  const maxLen = snakeA.reach.max;
  sn = S.spawn(mini, snakeA, "a", 300);
  runM(sn, { ...idle, reach: true }, 6);
  assert.ok(sn.reach && sn.reach.len <= maxLen + 1e-6 && sn.reach.len > maxLen - 5, "stops extending at max");
  assert.equal(sn.air, null, "holds at max (body on top: no fall)");
  assert.equal(sn.grip, 1, "grip untouched while some part is on top");
  assert.ok(S.bodyOnTop(mini, sn));
  assert.equal(S.NO_INPUT.back, false);

  // snake grip: the head may hang under the branch as long as ANY part of the body is on top
  const hangHead = (c, th = Math.PI * 0.95) => { c.head.th = th; c.trail[c.trail.length - 1].surf.th = th; };
  const hangAll = (c, th = Math.PI * 0.95) => { c.head.th = th; for (const t of c.trail) if (t.surf) t.surf.th = th; };
  sn = S.spawn(mini, snakeA, "a", 700);
  hangHead(sn);
  assert.ok(S.bodyOnTop(mini, sn), "tail on top");
  runM(sn, idle, 4);
  assert.equal(sn.grip, 1, "head hanging, tail on top: no drain");
  assert.equal(sn.air, null);
  const lz = S.spawn(mini, S.ANIMALS[0], "a", 700);
  hangHead(lz);
  runM(lz, idle, 1.3);
  assert.ok(lz.grip < 0.45, "head-only animals still drain");
  // whole body underneath: drains and slips
  sn = S.spawn(mini, snakeA, "a", 700);
  hangAll(sn);
  assert.ok(!S.bodyOnTop(mini, sn));
  runM(sn, idle, 1);
  assert.ok(sn.grip < 0.6, "whole body hanging drains");
  runM(sn, idle, 2);
  assert.ok(sn.air && sn.air.slip, "slipped off");
  runM(sn, idle, 6);
  assert.equal(sn.air, null, "recovers, never fatal");
  // reach with nothing on top drains and falls; with gripOn=false it never does
  sn = S.spawn(mini, snakeA, "a", 300);
  hangAll(sn);
  let fell = false;
  for (let t = 0; t < 6; t += 1 / 60) { S.step(mini, sn, { ...idle, reach: true }, 1 / 60); if (sn.air && sn.air.slip) fell = true; }
  assert.ok(fell, "reaching with no part on top: grip runs out, falls");
  runM(sn, idle, 6);
  assert.equal(sn.air, null, "lands again, never fatal");
  sn = S.spawn(mini, snakeA, "a", 300);
  hangAll(sn);
  sn.gripOn = false;
  fell = false;
  for (let t = 0; t < 6; t += 1 / 60) { S.step(mini, sn, { ...idle, reach: true }, 1 / 60); if (sn.air) fell = true; }
  assert.ok(!fell && sn.reach, "grip off: reach never falls");

  // reach steering: D yaws right (same handedness as surface steering), W/S pitch, dir stays unit
  const steered = (input, secs) => { const c = S.spawn(mini, snakeA, "a", 300); runM(c, { ...idle, reach: true, ...input }, secs); return c; };
  const surfRight = S.spawn(mini, snakeA, "a", 300);
  runM(surfRight, { ...idle, right: true }, 0.3);
  const hRight = S.headingVector(mini, surfRight);
  const rr = steered({ right: true }, 0.3);
  assert.ok(W.dot(rr.reach.dir, hRight) > 0.99, "right turns the reach the same way as steering on the surface");
  const rl = steered({ left: true }, 0.3);
  assert.ok(W.dot(rl.reach.dir, hRight) < W.dot(rr.reach.dir, hRight) - 0.3 && Math.sign(rl.reach.dir.z) === -Math.sign(rr.reach.dir.z), "left is the opposite");
  const rf = steered({ forward: true }, 0.5), rb = steered({ back: true }, 0.5), rn = steered({}, 0.5);
  const upDot = (c) => W.dot(c.reach.dir, c.reach.up);
  assert.ok(upDot(rn) > -1e-6 && upDot(rn) < 1e-6 && upDot(rf) > 0.4 && upDot(rb) < -0.3, "W raises, S lowers, neither keeps level");
  assert.ok(upDot(steered({ forward: true }, 4)) <= 0.9 + 1e-9 && upDot(steered({ back: true }, 4)) >= -0.5 - 1e-9, "pitch clamped");
  for (const c of [rr, rl, rf, rb, steered({ right: true, forward: true }, 2)]) assert.ok(Math.abs(W.len(c.reach.dir) - 1) < 1e-9, "dir stays unit");
  // a steered reach can hit a branch a straight one misses
  const side = { branches: new Map() };
  W.addBranch(side, W.makeBranch("a", W.smoothPath([W.v3(0, 0, 0), W.v3(500, 0, 0), W.v3(1000, 0, 0)]), 40));
  W.addBranch(side, W.makeBranch("zp", W.smoothPath([W.v3(400, 40, 200), W.v3(750, 40, 200), W.v3(1100, 40, 200)]), 40));
  W.addBranch(side, W.makeBranch("zn", W.smoothPath([W.v3(400, 40, -200), W.v3(750, 40, -200), W.v3(1100, 40, -200)]), 40));
  const reachSteer = (turn) => {
    const c = S.spawn(side, snakeA, "a", 300);
    for (let t = 0; t < 6 && c.head.b === "a"; t += 1 / 60) S.step(side, c, { ...idle, reach: true, ...(t < 0.35 ? turn : {}) }, 1 / 60);
    return c.head.b;
  };
  assert.equal(reachSteer({}), "a", "straight reach misses both");
  const hitR = reachSteer({ right: true }), hitL = reachSteer({ left: true });
  assert.ok(["zp", "zn"].includes(hitR) && ["zp", "zn"].includes(hitL) && hitR !== hitL, "steering right/left bridges to opposite branches");

  // squirrel glide pitch: W dives (faster, steeper), S flares (slower, floatier), neither = plain glide
  const sqA = S.ANIMALS.find((x) => x.id === "squirrel");
  const glide = (input) => {
    const c = S.spawn(mini, sqA, "a", 100);
    c.air = { p: W.v3(0, 2000, 0), v: W.v3(sqA.leap.speed, 0, 0), t: 0.3, from: { b: "a", s: 100, th: 0 }, ignore: 0.3, slip: false };
    runM(c, input, 1.5);
    return c;
  };
  const gN = glide(idle), gD = glide({ ...idle, forward: true }), gF = glide({ ...idle, back: true });
  assert.ok(gN.air && gD.air && gF.air, "still gliding");
  assert.ok(Math.abs(gN.air.v.y + 140) < 1e-6, "neutral keeps the -140 terminal fall");
  assert.ok(gD.air.p.x > gN.air.p.x && gD.air.p.y < gN.air.p.y - 100 && gD.air.v.y < -300, "dive: further and much faster down");
  assert.ok(gF.air.p.x < gN.air.p.x && gF.air.p.y > gN.air.p.y && gF.air.v.y > -71, "flare: slower and floatier");
  const hv = (c) => Math.hypot(c.air.v.x, c.air.v.z);
  assert.ok(hv(gD) <= sqA.leap.speed * 1.4 + 1e-6 && hv(gF) >= sqA.leap.speed * 0.55 - 1e-6 && Math.abs(gD.air.v.z) < 1e-6, "speed bounded, direction kept");

  // ground: falling below world.groundY takes the never-fatal recovery and doesn't re-trigger
  const gw = { branches: mini.branches, groundY: -300 };
  for (const [z, slip] of [[700, true], [200, true], [700, false]]) {
    const c = S.spawn(gw, S.ANIMALS[0], "a", 500);
    c.air = { p: W.v3(500, -250, z), v: W.v3(0, -400, 0), t: 0.2, from: { b: "a", s: 500, th: 0 }, ignore: 0.9, slip };
    for (let t = 0; t < 2; t += 1 / 60) {
      S.step(gw, c, idle, 1 / 60);
      assert.ok(Number.isFinite(c.head.s) && Number.isFinite(c.head.th) && Number.isFinite(c.phi), "never NaN");
    }
    assert.equal(c.air, null, `ground recovery (z=${z})`);
    assert.ok(["a", "gap"].includes(c.head.b));
  }

  // climbTarget: the side branch Shift would climb into (standing in its base), else null; same rule as moveHead
  c = S.spawn(world, S.ANIMALS[0], "trunk", 300);
  assert.equal(S.climbTarget(world, c), null, "nothing to climb mid-trunk");
  let base = null;
  for (let s = 850; s < 1200 && !base; s += 2) { c.head.s = s; if (S.climbTarget(world, c)) base = s; }
  assert.ok(base !== null && S.climbTarget(world, c).id === "climb", "side branch found at its base");
  c = S.spawn(world, S.ANIMALS[0], "trunk", base);
  S.step(world, c, { ...idle, forward: true, climb: true }, 1 / 60);
  assert.equal(c.head.b, "climb", "hint and behaviour agree");
  c = S.spawn(world, S.ANIMALS[0], "trunk", base);
  S.step(world, c, { ...idle, leap: true }, 1 / 60);
  assert.equal(S.climbTarget(world, c), null, "airborne: none");
}
// 12. tree layout (vault → branches + leaves)
{
  const L = await bundle("src/tree/layout.ts", "layout3.mjs");
  const W = await bundle("src/tree/world3.ts", "w3b.mjs");
  const S = await bundle("src/tree/sim3.ts", "s3b.mjs");
  const mkTree = (spec) => {
    const notes = {}, edges = [];
    const add = (id, parent, kids) => {
      notes[id] = { noteId: id, title: id, type: "text", labels: id.startsWith("n") && id.length > 3 ? { color: "#ff8800" } : {}, hasChildren: !!kids };
      if (parent) edges.push({ parentNoteId: parent, noteId: id, notePosition: 0 });
      (kids ?? []).forEach((k) => add(k.id, id, k.kids));
    };
    add("root", null, spec);
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const spec = [
    { id: "f1", kids: [{ id: "n001" }, { id: "n002" }, { id: "f1a", kids: [{ id: "n003" }] }] },
    { id: "f2", kids: Array.from({ length: 30 }, (_, i) => ({ id: "m" + i })) },
    { id: "n004" },
  ];
  const tree = mkTree(spec);
  const lay = L.layoutTree(tree);
  assert.deepEqual([...lay.world.branches.keys()].sort(), ["f1", "f1a", "f2", "root"], "every folder is a branch");
  assert.deepEqual(lay.leaves.map((l) => l.id).sort(), ["m0","m1","m10","m11","m12","m13","m14","m15","m16","m17","m18","m19","m2","m20","m21","m22","m23","m24","m25","m26","m27","m28","m29","m3","m4","m5","m6","m7","m8","m9","n001","n002","n003","n004"], "every note is a leaf");
  assert.equal(lay.leaves.find((l) => l.id === "n001").color, "#ff8800", "#color label wins");
  // children start on their parent's centreline
  for (const b of lay.world.branches.values()) {
    if (!b.parent) continue;
    const par = lay.world.branches.get(b.parent);
    assert.ok(W.dist(b.pts[0], W.frameAt(par, b.attachS ?? par.total).p) < 1.5, `${b.id} grows out of ${b.parent}`); // a trunk (no attachS) grows from the hub's END
    if (b.attachS !== undefined) assert.ok(b.attachS > 0 && b.attachS < par.total);
  }
  // everything finite, nothing buried underground, leaves on their branches
  for (const b of lay.world.branches.values()) {
    assert.ok(b.pts.every((p) => Number.isFinite(p.x + p.y + p.z)) && b.r >= 4 && b.rEnd >= 1.2 && (b.id === "root" || b.total > 130)); // radii were >= 15 before the notes/depth model (section 16); the hub is a short stump (section 17)
    assert.ok(b.pts.every((p) => p.y > -40), `${b.id} stays above ground`);
  }
  for (const l of lay.leaves) assert.ok(l.s > 0 && l.s < lay.world.branches.get(l.branchId).total);
  // thicker/longer where the subtree is bigger
  assert.ok(lay.world.branches.get("root").r > lay.world.branches.get("f1a").r);
  // deterministic
  assert.equal(JSON.stringify(L.layoutTree(tree).leaves), JSON.stringify(lay.leaves));
  assert.equal(JSON.stringify([...L.layoutTree(tree).world.branches.values()].map((b) => b.pts[3])), JSON.stringify([...lay.world.branches.values()].map((b) => b.pts[3])));
  assert.deepEqual(L.pathToRoot(lay, "f1a"), ["root", "f1", "f1a"]);
  // a creature can be spawned and walk on the generated tree
  const c = S.spawn(lay.world, S.ANIMALS[0], "f1", 100);
  for (let t = 0; t < 3; t += 1 / 60) S.step(lay.world, c, { ...S.NO_INPUT, forward: true }, 1 / 60);
  assert.ok(c.head.s > 100 && Number.isFinite(c.head.th));
  // big vault: 400 notes lays out fast
  const big = mkTree(Array.from({ length: 20 }, (_, i) => ({ id: "F" + i, kids: Array.from({ length: 19 }, (_, j) => ({ id: "x" + i + "_" + j })) })));
  const t0 = performance.now();
  const bl = L.layoutTree(big);
  assert.equal(bl.leaves.length, 380);
  assert.ok(performance.now() - t0 < 1000, "400 notes lay out in < 1s");
  {
    // 1500 notes (past the walk caps, e.g. a hand-built tree): < 2.5 s
    const huge = mkTree(Array.from({ length: 30 }, (_, i) => ({ id: "H" + i, kids: [
      ...Array.from({ length: 30 }, (_, j) => ({ id: "hx" + i + "_" + j })),
      ...Array.from({ length: 4 }, (_, j) => ({ id: "HS" + i + "_" + j, kids: Array.from({ length: 5 }, (_, k) => ({ id: "hy" + i + "_" + j + "_" + k })) })),
    ] })));
    const th0 = performance.now();
    const hl = L.layoutTree(huge);
    assert.ok(hl.leaves.length >= 1500, `1500-note vault: ${hl.leaves.length} leaves`);
    assert.ok(performance.now() - th0 < 2500, `1500 notes lay out in < 2.5s (${(performance.now() - th0).toFixed(0)} ms)`);
  }

  // leaf data: kind by note type / #biblio_leaf override, size starts at 1, world has a ground
  assert.equal(lay.world.groundY, 0);
  assert.ok(lay.leaves.every((l) => l.kind === "broad" && l.size === 1 && l.type === "text"));
  const typed = mkTree([{ id: "f", kids: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] }]);
  typed.notes.c1.type = "code";
  typed.notes.c2.type = "image";
  typed.notes.c3.labels.biblio_leaf = "MAPLE";
  const tl = L.layoutTree(typed).leaves;
  assert.deepEqual(["c1", "c2", "c3"].map((id) => tl.find((l) => l.id === id).kind), ["needle", "fruit", "maple"]);
  assert.equal(tl.find((l) => l.id === "c1").type, "code");

  // spacing: side branches are stretched apart along their parent
  const eight = mkTree([{ id: "P", kids: Array.from({ length: 8 }, (_, i) => ({ id: "S" + i, kids: [{ id: "k" + i }] })) }]);
  const el = L.layoutTree(eight);
  const sibs = [...el.world.branches.values()].filter((b) => b.parent === "P");
  assert.equal(sibs.length, 8);
  const at = sibs.map((b) => b.attachS).sort((a, b) => a - b);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 160, `siblings attach ${(at[i] - at[i - 1]).toFixed(0)} apart`);
  const tips = sibs.map((b) => b.pts[b.pts.length - 1]);
  let spread = 0;
  for (const a of tips) for (const b of tips) spread = Math.max(spread, W.dist(a, b));
  assert.ok(spread > 400, `sibling tips fan out (${spread.toFixed(0)})`);
  assert.ok(el.world.branches.get("P").total <= 2400 * 1.2, "parent length is capped");
  // leaves keep >= ~50 apart along a row (same side, same row) in a 30-note folder
  const rowsOf = new Map();
  for (const l of lay.leaves.filter((l) => l.branchId === "f2")) {
    const key = `${Math.sign(l.th)}/${Math.floor((Math.abs(l.th) - 1.0) / 0.32)}`;
    (rowsOf.get(key) ?? rowsOf.set(key, []).get(key)).push(l.s);
  }
  for (const [key, ss] of rowsOf) {
    ss.sort((a, b) => a - b);
    for (let i = 1; i < ss.length; i++) assert.ok(ss[i] - ss[i - 1] >= 50, `row ${key}: leaves ${(ss[i] - ss[i - 1]).toFixed(0)} apart`);
  }

  // worst cases (the walk caps at 400 notes / depth 8): fast, finite, bounded
  const nest = (depth, folders, notes, tag) => Array.from({ length: folders }, (_, i) => ({ id: `${tag}${depth}_${i}`, kids: [
    ...Array.from({ length: notes }, (_, j) => ({ id: `${tag}n${depth}_${i}_${j}` })),
    ...(depth > 1 ? nest(depth - 1, folders, notes, `${tag}${i}`) : []),
  ] }));
  const worst = {
    "wide star": mkTree(Array.from({ length: 133 }, (_, i) => ({ id: "w" + i, kids: [{ id: "wn" + i + "a" }, { id: "wn" + i + "b" }] }))),
    "one fat folder": mkTree([{ id: "fat", kids: Array.from({ length: 399 }, (_, i) => ({ id: "fn" + i })) }]),
    "deep chain": mkTree((function chain(d) { return d === 0 ? [{ id: "end0" }] : [{ id: "c" + d, kids: [{ id: "cn" + d }, ...chain(d - 1)] }]; })(8)),
    "3-ary, 6 deep": mkTree(nest(6, 3, 0, "t")),
    "mixed": mkTree(nest(3, 4, 4, "m")),
  };
  for (const [name, tr] of Object.entries(worst)) {
    const t1 = performance.now();
    const wl = L.layoutTree(tr);
    assert.ok(performance.now() - t1 < 1000, `${name}: lays out in < 1s`);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const b of wl.world.branches.values()) for (const p of b.pts) {
      assert.ok(Number.isFinite(p.x + p.y + p.z), `${name}: finite`);
      [p.x, p.y, p.z].forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
    }
    for (const l of wl.leaves) assert.ok(Number.isFinite(l.s + l.th));
    hi.forEach((h, k) => assert.ok(h - lo[k] < 30000, `${name}: axis ${k} extent ${(h - lo[k]).toFixed(0)} < 30000`)); // forests are wider than the old single trunk
  }
}
// 13. leaf kinds/sizes, leaf-size loader, "leaf" reader paper, #biblio_leaf label
{
  const K = await bundle("src/tree/leafkind.ts", "leafkind.mjs");
  const LS = await bundle("src/lib/leafsize.ts", "leafsize.mjs");
  const R = await bundle("src/lib/reader.ts", "reader2.mjs");
  const cfg = await bundle("src/config.ts", "config.mjs");
  const lib = await bundle("src/lib/library.ts", "library3.mjs");

  // kinds: every Trilium type maps to a valid kind; the label overrides, garbage is ignored
  const types = ["text", "code", "markdown", "canvas", "relationMap", "mermaid", "render", "book", "search", "webView", "image", "file", "noteMap", "mindMap", "shortcut", "doc", "launcher", "", "nonsense", "constructor", "__proto__"];
  for (const t of types) assert.ok(K.LEAF_KINDS.includes(K.leafKindFor(t)), `kind for ${t}`);
  assert.deepEqual(["text", "code", "markdown", "canvas", "image", "weird"].map((t) => K.leafKindFor(t)), ["broad", "needle", "maple", "blossom", "fruit", "broad"]);
  assert.equal(K.leafKindFor("text", "Blossom"), "blossom");
  assert.equal(K.leafKindFor("code", " FRUIT "), "fruit");
  assert.equal(K.leafKindFor("code", "oak"), "needle", "garbage override ignored");
  assert.equal(K.leafKindFor("image", ""), "fruit");
  assert.equal(K.leafKindFor("text", "constructor"), "broad");

  // scale: log curve, monotonic, finite, clamped
  assert.equal(K.leafScale(undefined), 1);
  for (const bad of [NaN, -5, -Infinity, 0]) assert.equal(K.leafScale(bad), 0.55);
  assert.ok(Math.abs(K.leafScale(100) - 0.85) < 0.01 && Math.abs(K.leafScale(1000) - 1.25) < 0.01 && Math.abs(K.leafScale(10000) - 1.65) < 0.01);
  assert.equal(K.leafScale(100000), 2);
  assert.equal(K.leafScale(1e12), 2);
  assert.equal(K.leafScale(Infinity), 2);
  let prev = -1;
  for (let c = 0; c < 3e5; c = c * 1.3 + 1) {
    const v = K.leafScale(c);
    assert.ok(Number.isFinite(v) && v >= 0.55 && v <= 2 && v >= prev, `scale monotonic at ${c}`);
    prev = v;
  }

  // outlines: plain data, finite, in range, CCW with positive area, simple
  const area = (poly) => poly.reduce((a, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return a + (x * y2 - x2 * y) / 2; }, 0);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const segX = (p1, p2, p3, p4) => cross(p1, p2, p3) * cross(p1, p2, p4) < 0 && cross(p3, p4, p1) * cross(p3, p4, p2) < 0;
  assert.deepEqual(Object.keys(K.LEAF_SHAPES).sort(), [...K.LEAF_KINDS].sort());
  assert.equal(K.LEAF_SHAPES.needle.length, 5);
  assert.equal(K.LEAF_SHAPES.blossom.length, 5);
  assert.equal(K.LEAF_SHAPES.broad.length, 1);
  for (const kind of K.LEAF_KINDS) for (const poly of K.LEAF_SHAPES[kind]) {
    assert.ok(poly.length >= 3, `${kind}: >= 3 points`);
    for (const [u, v] of poly) assert.ok(Number.isFinite(u + v) && Math.abs(u) <= 1 && v >= 0 && v <= 1, `${kind}: ${u},${v} in range`);
    assert.ok(area(poly) > 0.005, `${kind}: CCW with positive area (${area(poly)})`);
    for (let i = 0; i < poly.length; i++) for (let j = i + 2; j < poly.length; j++) {
      if (i === 0 && j === poly.length - 1) continue;
      assert.ok(!segX(poly[i], poly[(i + 1) % poly.length], poly[j], poly[(j + 1) % poly.length]), `${kind}: simple polygon`);
    }
  }
  const broad = K.LEAF_SHAPES.broad[0];
  assert.ok(broad.every(([u, v]) => broad.some(([u2, v2]) => Math.abs(u2 + u) < 1e-9 && Math.abs(v2 - v) < 1e-9)), "broad leaf is mirror-symmetric");
  assert.equal(K.LEAF_ACCENT.blossom, "#f2c744");

  // textLength
  assert.equal(LS.textLength("text", "<p>Hello &amp;   <b>world</b></p>\n<p> !</p>"), "Hello _ world !".length);
  assert.equal(LS.textLength("text", "<style>p{x:y}</style><script>alert(1)</script>ab"), 2);
  assert.equal(LS.textLength("text", ""), 0);
  assert.equal(LS.textLength("code", "  a  b\n"), 7);
  assert.equal(LS.textLength("markdown", "# hi"), 4);
  for (const t of ["image", "file", "canvas", "book", "search"]) assert.equal(LS.textLength(t, "xxxx"), -1);

  // loader on a fake client + a fake localStorage
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const KEY = cfg.STORAGE.leafSizes;
  assert.deepEqual(LS.loadSizeCache(), {});
  store.set(KEY, "{not json");
  assert.deepEqual(LS.loadSizeCache(), {}, "corrupt cache = empty");
  store.set(KEY, JSON.stringify({ a: { blob: "b1", len: 5 }, bad: { blob: 1, len: "x" }, neg: { blob: "z", len: -2 } }));
  assert.deepEqual(LS.loadSizeCache(), { a: { blob: "b1", len: 5 } }, "invalid entries dropped");
  store.clear();
  const SECRET = "SECRET-CONTENT-do-not-keep";
  const mkClient = (opts = {}) => {
    const st = { calls: [], inFlight: 0, peak: 0 };
    return Object.assign(st, {
      getNoteContent: async (id) => {
        st.calls.push(id);
        st.inFlight++; st.peak = Math.max(st.peak, st.inFlight);
        await new Promise((r) => setTimeout(r, opts.delay ?? 2));
        st.inFlight--;
        if (opts.fail?.has(id)) throw new Error("boom");
        return `<p>${SECRET}${"x".repeat(Number(id.slice(1)) || 0)}</p>`;
      },
    });
  };
  const run = async (client, notes, o = {}) => {
    const batches = [];
    const ac = o.ac ?? new AbortController();
    await LS.measureLeaves(client, notes, { signal: ac.signal, onBatch: (m) => batches.push(new Map(m)), ...o.opts });
    const all = new Map();
    for (const b of batches) for (const [k, v] of b) all.set(k, v);
    return { batches, all };
  };
  const N = SECRET.length;
  let c1 = mkClient();
  let res = await run(c1, [{ noteId: "n1", type: "text", blobId: "A" }, { noteId: "n2", type: "text", blobId: "B" }, { noteId: "img", type: "image", blobId: "I" }, { noteId: "f", type: "file" }]);
  assert.deepEqual(c1.calls.sort(), ["n1", "n2"], "non-measurable types are not fetched");
  assert.deepEqual([...res.all].sort(), [["n1", N + 1], ["n2", N + 2]]);
  const saved = JSON.parse(store.get(KEY));
  assert.deepEqual(saved, { n1: { blob: "A", len: N + 1 }, n2: { blob: "B", len: N + 2 } });
  assert.ok(!store.get(KEY).includes("SECRET"), "content is never persisted");
  // cache hit: same blob = no fetch and an immediate first batch; changed blob = refetch; no blobId = never trusted
  c1 = mkClient();
  res = await run(c1, [{ noteId: "n1", type: "text", blobId: "A" }, { noteId: "n2", type: "text", blobId: "B2" }, { noteId: "n3", type: "text" }]);
  assert.deepEqual(c1.calls.sort(), ["n2", "n3"]);
  assert.deepEqual([...res.batches[0]], [["n1", N + 1]], "cache hits are reported first");
  assert.equal(res.all.get("n2"), N + 2);
  assert.equal(JSON.parse(store.get(KEY)).n2.blob, "B2");
  assert.equal(JSON.parse(store.get(KEY)).n3, undefined, "no blobId: not cached");
  // errors are skipped, never fatal
  store.clear();
  c1 = mkClient({ fail: new Set(["n2"]) });
  res = await run(c1, [1, 2, 3].map((i) => ({ noteId: "n" + i, type: "text", blobId: "b" })));
  assert.deepEqual([...res.all.keys()].sort(), ["n1", "n3"]);
  // maxNotes caps FETCHES; concurrency is never exceeded; batches flush every ~8 results
  store.clear();
  const many = Array.from({ length: 40 }, (_, i) => ({ noteId: "n" + i, type: "text", blobId: "b" }));
  c1 = mkClient();
  res = await run(c1, many, { opts: { maxNotes: 20, concurrency: 3 } });
  assert.equal(c1.calls.length, 20);
  assert.ok(c1.peak <= 3 && c1.peak >= 2, `peak concurrency ${c1.peak}`);
  assert.equal(res.all.size, 20);
  assert.ok(res.batches.length >= 2 && res.batches.every((b) => b.size <= 8), "batched, not one per note");
  c1 = mkClient();
  await run(c1, many, { opts: { maxNotes: 5 } });
  assert.equal(c1.calls.length, 5, "the 20 cached are free; the cap applies to the fetches");
  // abort: stops fetching, no later onBatch, resolves quietly
  store.clear();
  c1 = mkClient({ delay: 10 });
  const ac = new AbortController();
  const late = [];
  const p = LS.measureLeaves(c1, many, { signal: ac.signal, concurrency: 2, onBatch: (m) => late.push(m.size) });
  await new Promise((r) => setTimeout(r, 35));
  ac.abort();
  const seen = late.length;
  await p;
  const callsAtAbort = c1.calls.length;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(c1.calls.length, callsAtAbort, "no fetches after abort");
  assert.equal(late.length, seen, "no onBatch after abort");
  assert.ok(callsAtAbort < 40);
  const pre = new AbortController(); pre.abort();
  c1 = mkClient();
  await run(c1, many, { ac: pre });
  assert.equal(c1.calls.length, 0, "already aborted: nothing happens");
  delete globalThis.localStorage;

  // blobId survives toNoteInfo
  const tree = await lib.walkLibraryTree({ getNote: async (id) => ({ noteId: id, title: id, type: "text", blobId: "BLOB1", childNoteIds: [], attributes: [] }) }, "root");
  assert.equal(tree.notes.root.blobId, "BLOB1");
  const tree2 = await lib.walkLibraryTree({ getNote: async (id) => ({ noteId: id, title: id, type: "text", childNoteIds: [], attributes: [] }) }, "root");
  assert.ok(!("blobId" in tree2.notes.root));

  // the "leaf" reader paper: legible (WCAG contrast over every stop of the page gradient), valid, not the default
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const leafPaper = R.PAPERS.leaf;
  assert.equal(leafPaper.label, "Leaf");
  const stops = leafPaper.page.match(/#[0-9a-f]{6}/gi);
  assert.ok(stops.length >= 2);
  for (const st of stops) {
    assert.ok(contrast(leafPaper.ink, st) >= 7, `ink/page ${contrast(leafPaper.ink, st).toFixed(2)} on ${st}`);
    assert.ok(contrast(leafPaper.link, st) >= 4.5, `link/page ${contrast(leafPaper.link, st).toFixed(2)} on ${st}`);
  }
  assert.equal(R.sanitizePrefs({ paper: "leaf" }).paper, "leaf");
  assert.equal(R.DEFAULT_PREFS.paper, "parchment");
  assert.ok(R.readerDocument("<p>x</p>", { ...R.DEFAULT_PREFS, paper: "leaf" }, "N").includes(leafPaper.ink));

  // the label is ours: never a shelf
  assert.equal(cfg.LABELS.leaf, "biblio_leaf");
  assert.ok(lib.NOISE_LABELS.has("biblio_leaf"));
}
// 14. review fixes: reach keeps the tail's history, retract obeys the grip rule, leaf-size guards
{
  const W = await bundle("src/tree/world3.ts", "w3c.mjs");
  const S = await bundle("src/tree/sim3.ts", "s3c.mjs");
  const LS = await bundle("src/lib/leafsize.ts", "ls14.mjs");
  const idle = { forward: false, back: false, left: false, right: false, leap: false, reach: false, climb: false };
  const world = W.makeDemoWorld();
  const snake = S.ANIMALS.find((x) => x.id === "snake");
  // a full reach and back must not pile the tail onto one point
  const sn = S.spawn(world, snake, "trunk", 1000);
  for (let t = 0; t < 2; t += 1 / 60) S.step(world, sn, { ...idle, forward: true }, 1 / 60);
  for (let t = 0; t < 8; t += 1 / 60) S.step(world, sn, { ...idle, reach: true, forward: false, back: true }, 1 / 60);
  for (let t = 0; t < 8 && sn.reach; t += 1 / 60) S.step(world, sn, idle, 1 / 60);
  let piled = 0, prev = S.bodyPoint(sn, 0).p;
  for (let d = 20; d < 600; d += 20) {
    const p = S.bodyPoint(sn, d).p;
    if (W.dist(p, prev) < 1) piled++;
    prev = p;
  }
  assert.ok(piled < 3, `tail piled up after retracting (${piled} coincident samples)`);
  // retracting while hanging underneath must not refill the grip (no infinite hold by cycling Space)
  const hang = S.spawn(world, snake, "trunk", 700);
  hang.head.th = Math.PI;
  for (const t of hang.trail) if (t.surf) t.surf.th = Math.PI;
  hang.grip = 0.6;
  hang.gripOn = true;
  let slipped = false;
  for (let i = 0; i < 60 * 30 && !slipped; i++) {
    const on = (i % 70) < 40; // out 40 frames, back ~29, repeat: no idle frames in between
    S.step(world, hang, { ...idle, reach: on }, 1 / 60);
    if (hang.air) slipped = true;
  }
  assert.ok(slipped, "cycling Space while hanging underneath must still wear the grip out");
  // leaf-size guard: giant notes are not scanned by the tag regexes
  assert.equal(LS.textLength("text", "<".repeat(500000)), 500000);
}
// 16. branch radius model: by notes + folder depth below (not by own depth), tapered, capped by the parent; lengths
//     (every folder is forced to the reference species `maple` via #biblio_species: its multipliers are 1; top-level folders are TREES, the root a hub)
{
  const L = await bundle("src/tree/layout.ts", "layout16.mjs");
  const W = await bundle("src/tree/world3.ts", "w16.mjs");
  const mkTree = (spec) => {
    const notes = {}, edges = [];
    const add = (id, parent, kids) => {
      notes[id] = { noteId: id, title: id, type: "text", labels: kids && kids.length ? { biblio_species: "maple" } : {}, hasChildren: !!(kids && kids.length) };
      if (parent) edges.push({ parentNoteId: parent, noteId: id, notePosition: 0 });
      (kids ?? []).forEach((k) => add(k.id, id, k.kids));
    };
    add("root", null, spec);
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const notesN = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: `${tag}n${i}` }));
  // a folder of `n` notes under `depth` further levels of one-note folders
  const stack = (tag, n, depth) => [{ id: tag, kids: [...notesN(tag, n), ...(depth > 0 ? stack(tag + "d", 1, depth - 1) : [])] }];
  const branchOf = (spec, id) => L.layoutTree(mkTree(spec)).world.branches.get(id);

  // a 2-note folder is a twig, not a stump; it tapers
  const twig = branchOf([{ id: "f", kids: notesN("t", 2) }], "f");
  assert.ok(twig.r <= 12 && twig.rEnd < twig.r, `2-note folder r=${twig.r.toFixed(1)} rEnd=${twig.rEnd.toFixed(1)}`);
  assert.ok(twig.total >= 180, "short twigs are still >= 180 long");

  // targets: ~20-note folder with a sub-level ~20 (alone, so no parent cap), a 400-note vault's trunk 45-60
  const mid = branchOf([{ id: "f", kids: [...notesN("m", 20), { id: "g", kids: notesN("g", 1) }] }], "f");
  assert.ok(mid.r >= 15 && mid.r <= 26, `mid folder r=${mid.r.toFixed(1)}`);
  const big = L.layoutTree(mkTree([{ id: "T", kids: Array.from({ length: 20 }, (_, i) => ({ id: "F" + i, kids: notesN("x" + i, 19) })) }]));
  const trunk = big.world.branches.get("T");
  assert.ok(trunk.r >= 45 && trunk.r <= 60, `400-note trunk r=${trunk.r.toFixed(1)}`);
  for (const b of big.world.branches.values()) if (b.id !== "T" && b.id !== "root") assert.ok(b.r < trunk.r, "the trunk is the thickest");
  assert.ok(Math.abs(big.world.branches.get("root").r - 1.1 * trunk.r) < 1e-9, "the hub is 1.1 x the thickest trunk");

  // monotonic: more notes, or more folder levels below, never make the (trunk) branch thinner
  let prev = 0;
  for (const n of [1, 2, 4, 8, 16, 32, 64, 128, 256, 399]) {
    const r = branchOf([{ id: "f", kids: notesN("a", n) }], "f").r;
    assert.ok(r >= prev - 1e-9, `${n} notes: r ${r.toFixed(2)} >= ${prev.toFixed(2)}`);
    prev = r;
  }
  for (const n of [1, 5, 25, 100]) {
    prev = 0;
    for (let d = 0; d <= 6; d++) {
      const r = branchOf(stack("s", n, d), "s").r;
      assert.ok(r >= prev - 1e-9, `${n} notes, ${d} levels: r ${r.toFixed(2)} >= ${prev.toFixed(2)}`);
      prev = r;
    }
  }
  // every branch of assorted vaults: finite, >= 4, tapered, child <= 0.85 x the parent's radius at the attach point
  const vaults = {
    flat: mkTree(notesN("a", 40)),
    star: mkTree(Array.from({ length: 30 }, (_, i) => ({ id: "w" + i, kids: notesN("w" + i, 2) }))),
    chain: mkTree(stack("c", 2, 8)),
    mixed: mkTree([{ id: "A", kids: [...notesN("A", 12), { id: "B", kids: [...notesN("B", 3), { id: "C", kids: notesN("C", 30) }] }, { id: "D", kids: notesN("D", 1) }] }, ...notesN("r", 5)]),
    big: mkTree(Array.from({ length: 20 }, (_, i) => ({ id: "F" + i, kids: notesN("x" + i, 19) }))),
  };
  for (const [name, tr] of Object.entries(vaults)) {
    const lay = L.layoutTree(tr);
    for (const b of lay.world.branches.values()) {
      assert.ok(Number.isFinite(b.r + b.rEnd) && b.r >= 4 && b.rEnd >= 1.2, `${name}/${b.id}: radii finite, start >= 4, tip >= 1.2`);
      assert.ok(b.rEnd < b.r, `${name}/${b.id}: tapers (${b.r.toFixed(1)} -> ${b.rEnd.toFixed(1)})`);
      if (b.parent) {
        const par = lay.world.branches.get(b.parent);
        assert.ok(b.r <= par.r + 1e-9, `${name}/${b.id}: not thicker than its parent`);
        if (b.attachS === undefined) continue; // a trunk grows from the hub's end, no cap (the hub is 1.1 x the thickest trunk)
        const at = W.radiusAt(par, b.attachS);
        // (the 4.5 minimum may beat the cap only where the parent is < 5.3 thick, the thin tail of a deep chain)
        assert.ok(b.r <= 0.85 * at + 1e-9 || at < 5.3, `${name}/${b.id}: r ${b.r.toFixed(2)} <= 0.85 x ${at.toFixed(2)}`);
      }
    }
    assert.equal(JSON.stringify([...L.layoutTree(tr).world.branches.values()].map((b) => [b.r, b.rEnd, b.total])), JSON.stringify([...lay.world.branches.values()].map((b) => [b.r, b.rEnd, b.total])), `${name}: deterministic`);
    const rt = lay.world.branches.get("root");
    for (const b of lay.world.branches.values()) assert.ok(b.r <= rt.r + 1e-9, `${name}: the trunk is the thickest`);
  }

  // world3 radiusAt: endpoints, linear and monotonic along a tapered branch, constant without a taper
  const pts = [W.v3(0, 0, 0), W.v3(0, 100, 0), W.v3(0, 200, 0)];
  const tb = W.makeBranch("t", pts, 20, null, undefined, 8);
  assert.equal(W.radiusAt(tb, 0), 20);
  assert.ok(Math.abs(W.radiusAt(tb, tb.total) - 8) < 1e-9);
  assert.ok(Math.abs(W.radiusAt(tb, tb.total / 2) - 14) < 1e-9);
  assert.equal(W.radiusAt(tb, -50), 20, "clamped below");
  assert.ok(Math.abs(W.radiusAt(tb, tb.total + 50) - 8) < 1e-9, "clamped above");
  let last = Infinity;
  for (let s = 0; s <= tb.total; s += 10) { const r = W.radiusAt(tb, s); assert.ok(r <= last + 1e-9); last = r; }
  assert.equal(W.radiusAt(W.makeBranch("u", pts, 20), 123), 20, "rEnd defaults to r");
}
// 15. Yggdrasil fliers (take-off, hover, wing + stall, landing/deflection, floor, fuzz), grip by world gravity, spider,
//     auto-align + thin-branch steering, number-key categories
{
  const W = await bundle("src/tree/world3.ts", "w3d.mjs");
  const S = await bundle("src/tree/sim3.ts", "s3d.mjs");
  const L = await bundle("src/tree/layout.ts", "layout3d.mjs");
  const idle = S.NO_INPUT;
  const A = (id) => S.ANIMALS.find((x) => x.id === id);
  const run = (w, c, input, secs, dt = 1 / 60) => { for (let t = 0; t < secs - 1e-9; t += dt) S.step(w, c, input, dt); };
  const straight = (id, pts, r, extra) => W.makeBranch(id, W.smoothPath(pts), r, ...(extra ?? []));
  const margin = (a) => Math.max(3, a.nodes[0].w * 0.8);
  const fin = (...xs) => xs.every(Number.isFinite);
  const finiteFlight = (f) => fin(f.p.x, f.p.y, f.p.z, f.v.x, f.v.y, f.v.z, f.yaw, f.pitch, f.speed, f.bank, f.flap);
  const fliers = ["bee", "dragonfly", "bluejay"];

  // a world with one long branch, a post across the bee's path, and a ground far below
  const sky = { branches: new Map(), groundY: -3000 };
  W.addBranch(sky, straight("a", [W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)], 40));
  W.addBranch(sky, straight("post", [W.v3(900, -200, 0), W.v3(900, 200, 0), W.v3(900, 600, 0)], 30));
  const free = { branches: new Map([["a", sky.branches.get("a")]]), groundY: -3000 };

  // --- take-off: Space on a branch; the head stays at the perch, the trail gets surf:null samples ---
  for (const id of fliers) {
    const c = S.spawn(free, A(id), "a", 500);
    assert.equal(c.flight, null, "spawn: not flying");
    assert.equal(c.autoAlign, true, "autoAlign defaults on");
    run(free, c, { ...idle, forward: true }, 0.5);
    assert.equal(c.flight, null, `${id}: a perched flier walks as normal`);
    assert.ok(c.head.s > 505, `${id} walked`);
    const perch = { ...c.head }, D0 = c.D;
    S.step(free, c, { ...idle, leap: true }, 1 / 60);
    assert.ok(c.flight && finiteFlight(c.flight), `${id}: Space takes off`);
    run(free, c, { ...idle, reach: true, forward: true }, 0.6);
    assert.deepEqual(c.head, perch, `${id}: head stays at the perch`);
    assert.ok(c.trail[c.trail.length - 1].surf === null && c.D > D0 + 20, `${id}: trail samples with surf:null, D grows`);
    const p0 = S.bodyPoint(c, 0).p, p1 = S.bodyPoint(c, 10).p;
    assert.ok(Math.abs(W.dist(p0, p1) - 10) < 2, `${id}: body trails the head (${W.dist(p0, p1).toFixed(1)})`);
    assert.ok(W.dist(S.bodyPoint(c, 0).p, c.flight.p) < 1.5, `${id}: head = flight position`);
    // flightBasis: unit, orthogonal, forward along yaw/pitch, up rolled by the bank
    c.flight.bank = 0;
    let fb = S.flightBasis(c);
    assert.ok(Math.abs(W.len(fb.fwd) - 1) < 1e-9 && Math.abs(W.len(fb.up) - 1) < 1e-9 && Math.abs(W.dot(fb.fwd, fb.up)) < 1e-9, "basis orthonormal");
    assert.ok(fb.up.y > 0.9, "level: up is up");
    c.flight.bank = 1;
    fb = S.flightBasis(c);
    const rightAxis = W.norm(W.cross(fb.fwd, W.v3(0, 1, 0)));
    assert.ok(W.dot(fb.up, rightAxis) > 0.6 && Math.abs(W.dot(fb.fwd, fb.up)) < 1e-9, "bank rolls up toward the turn (right)");
  }
  // a plain walker/jumper is unchanged: leap -> air, never flight
  const lz = S.spawn(free, A("lizard"), "a", 500);
  S.step(free, lz, { ...idle, leap: true }, 1 / 60);
  assert.ok(lz.air && lz.flight === null, "lizard leaps, doesn't fly");
  const sqq = S.spawn(free, A("squirrel"), "a", 500);
  S.step(free, sqq, { ...idle, leap: true }, 1 / 60);
  assert.ok(sqq.air && sqq.flight === null, "squirrel glides, doesn't fly");

  // --- hover (bee, dragonfly) ---
  for (const id of ["bee", "dragonfly"]) {
    const a = A(id), fl = a.flight;
    const c = S.spawn(free, a, "a", 500);
    S.step(free, c, { ...idle, leap: true }, 1 / 60);
    run(free, c, { ...idle, reach: true }, 1); // up, clear of the branch
    assert.ok(c.flight.v.y > fl.climb * 0.9 && c.flight.pitch > 0, `${id}: Space climbs, nose up a little`);
    run(free, c, idle, 1.5);
    assert.ok(W.len(c.flight.v) < 1, `${id}: stops when you let go (${W.len(c.flight.v).toFixed(2)})`);
    const still = { ...c.flight.p };
    run(free, c, idle, 0.5);
    assert.ok(W.dist(still, c.flight.p) < 1, `${id}: hovers in place`);
    const n0 = c.trail.length;
    run(free, c, idle, 5);
    assert.ok(c.trail.length <= n0 + 2, `${id}: hovering doesn't pile up trail samples`);
    // W flies along the heading at flight.speed, S backwards at half
    const yaw0 = c.flight.yaw;
    run(free, c, { ...idle, forward: true }, 1.5);
    assert.ok(Math.abs(c.flight.speed - fl.speed) < fl.speed * 0.05, `${id}: top speed ${c.flight.speed.toFixed(0)}`);
    assert.ok(W.dot(W.norm(c.flight.v), S.flightBasis(c).fwd) > 0.99 && Math.abs(c.flight.v.y) < 1, "flies along the heading, level");
    run(free, c, idle, 1.5);
    run(free, c, { ...idle, back: true }, 1.5);
    assert.ok(Math.abs(c.flight.speed - fl.speed * 0.5) < fl.speed * 0.03 && W.dot(c.flight.v, S.flightBasis(c).fwd) < 0, `${id}: back = half speed, reversed`);
    run(free, c, idle, 1.5);
    // A/D yaw at flight.turnRate (right = +yaw), left the opposite; bank follows
    const y1 = c.flight.yaw;
    run(free, c, { ...idle, right: true }, 0.5);
    const dyR = W.wrapAngle(c.flight.yaw - y1);
    assert.ok(Math.abs(dyR - fl.turnRate * 0.5) < 0.02 && c.flight.bank > 0.2, `${id}: right yaws +${dyR.toFixed(2)}`);
    run(free, c, { ...idle, left: true }, 1);
    assert.ok(W.wrapAngle(c.flight.yaw - y1) < 0 && c.flight.bank < -0.2, `${id}: left yaws back and past`);
    assert.ok(Number.isFinite(yaw0));
    // Shift descends (nothing to touch here: still flying), pitch nose down
    c.flight.p = { x: 8000, y: 500, z: 8000 };
    run(free, c, { ...idle, climb: true }, 0.8);
    assert.ok(c.flight && c.flight.v.y < -fl.climb * 0.9 && c.flight.pitch < 0, `${id}: Shift descends`);
  }

  // --- wing (bluejay): always forward, energy model, stall ---
  {
    const a = A("bluejay"), fl = a.flight;
    const cruise = fl.cruise, stall = fl.stall;
    const mk = () => {
      const c = S.spawn(free, a, "a", 500);
      S.step(free, c, { ...idle, leap: true }, 1 / 60);
      c.flight.p = { x: 4000, y: 2500, z: 4000 }; // up in the open sky, away from everything
      return c;
    };
    let c = mk();
    run(free, c, idle, 2);
    const y2 = c.flight.p.y;
    run(free, c, idle, 3);
    assert.ok(c.flight && c.flight.speed > cruise * 0.7 && c.flight.speed < cruise * 1.3, `glides at about cruise (${c.flight.speed.toFixed(0)} vs ${cruise.toFixed(0)})`);
    assert.ok(Math.abs(c.flight.p.y - y2) < 150 && Math.abs(c.flight.pitch) < 0.1, `no input: level-ish glide (dy=${(c.flight.p.y - y2).toFixed(0)})`);
    assert.ok(c.flight.speed > 100, "always moving forward");
    // dive reaches near top speed within ~2 s
    c = mk();
    run(free, c, idle, 2);
    run(free, c, { ...idle, forward: true }, 2);
    assert.ok(c.flight.speed > fl.speed * 0.9 && c.flight.speed <= fl.speed + 1e-9 && c.flight.pitch < -0.5, `dive: ${c.flight.speed.toFixed(0)} of ${fl.speed.toFixed(0)}`);
    // climb bleeds speed to the stall in ~2 s; below it the nose drops until the speed is back
    c = mk();
    run(free, c, idle, 2);
    let tStall = -1, pitchAtStall = 0, recovered = false, nosedrop = false;
    for (let i = 0; i < 60 * 8; i++) {
      S.step(free, c, { ...idle, back: true }, 1 / 60);
      const t = (i + 1) / 60;
      if (tStall < 0 && c.flight.speed < stall) { tStall = t; pitchAtStall = c.flight.pitch; }
      if (tStall >= 0 && t > tStall + 0.2 && !nosedrop) nosedrop = c.flight.pitch < pitchAtStall - 0.1;
      if (tStall >= 0 && t > tStall + 0.3 && c.flight.speed > stall * 1.05) recovered = true;
    }
    assert.ok(tStall > 1 && tStall < 3.5, `climb stalls after ~2 s (${tStall.toFixed(2)})`);
    assert.ok(nosedrop, "stalled: the nose drops");
    assert.ok(recovered, "speed recovers after the nose drop");
    // Space = flap: more speed, limited to flight.speed; A/D turn slower when fast; bank follows the yaw rate
    c = mk();
    run(free, c, idle, 2);
    const sIdle = c.flight.speed;
    run(free, c, { ...idle, reach: true }, 1);
    assert.ok(c.flight.speed > sIdle + 50 && c.flight.speed <= fl.speed + 1e-9, "flap adds speed (capped)");
    c = mk();
    const yawIn = (speed) => { const d = mk(); d.flight.speed = speed; const y = d.flight.yaw; S.step(free, d, { ...idle, right: true }, 1 / 60); return W.wrapAngle(d.flight.yaw - y); };
    assert.ok(yawIn(stall * 1.3) > yawIn(fl.speed) * 1.2 && yawIn(fl.speed) > 0, "faster = wider turns, right = +yaw");
    run(free, c, { ...idle, left: true }, 0.6);
    assert.ok(c.flight.bank < -0.4, "banks into a left turn");
    run(free, c, idle, 1.2);
    assert.ok(Math.abs(c.flight.bank) < 0.05, "bank levels out");
  }

  // --- landing / collision: autoLand vs Shift, deflection never goes through bark ---
  {
    // bee (autoLand): Shift above the branch lands on it; flying into the post lands on the post
    let c = S.spawn(sky, A("bee"), "a", 500);
    S.step(sky, c, { ...idle, leap: true }, 1 / 60);
    run(sky, c, { ...idle, reach: true }, 0.4);
    run(sky, c, { ...idle, climb: true }, 3);
    assert.equal(c.flight, null, "descending onto the branch lands");
    assert.equal(c.head.b, "a");
    assert.ok(fin(c.head.s, c.head.th, c.phi, c.speedNow));
    c = S.spawn(sky, A("bee"), "a", 500);
    S.step(sky, c, { ...idle, leap: true }, 1 / 60);
    run(sky, c, { ...idle, forward: true }, 4);
    assert.equal(c.flight, null, "autoLand: touching the post lands");
    assert.equal(c.head.b, "post");
    // the same bee without autoLand is deflected (never inside the bark); Shift at the contact lands
    const bee = A("bee");
    const noLand = { ...bee, flight: { ...bee.flight, autoLand: false } };
    c = S.spawn(sky, noLand, "a", 500);
    S.step(sky, c, { ...idle, leap: true }, 1 / 60);
    let minGap = Infinity;
    for (let i = 0; i < 60 * 4; i++) {
      S.step(sky, c, { ...idle, forward: true }, 1 / 60);
      for (const b of sky.branches.values()) { const n = W.nearestOnBranch(b, c.flight.p); minGap = Math.min(minGap, n.dist - W.radiusAt(b, n.s) - margin(noLand)); }
    }
    assert.ok(c.flight, "no autoLand and no Shift: still flying");
    assert.ok(minGap > -1e-6, `deflected, never through bark (gap ${minGap.toFixed(4)})`);
    assert.ok(c.flight.p.x < 900, "blocked by the post");
    run(sky, c, { ...idle, forward: true, climb: true }, 0.5);
    assert.equal(c.flight, null, "Shift at the contact lands even without autoLand");
    assert.equal(c.head.b, "post");
    // bluejay: no autoLand -> deflected by the post; with Shift it lands, with a sensible speedNow
    c = S.spawn(sky, A("bluejay"), "a", 500);
    S.step(sky, c, { ...idle, leap: true }, 1 / 60);
    minGap = Infinity;
    for (let i = 0; i < 60 * 3; i++) {
      S.step(sky, c, idle, 1 / 60);
      if (!c.flight) break;
      for (const b of sky.branches.values()) { const n = W.nearestOnBranch(b, c.flight.p); minGap = Math.min(minGap, n.dist - W.radiusAt(b, n.s) - margin(A("bluejay"))); }
      assert.ok(finiteFlight(c.flight));
    }
    assert.ok(c.flight && minGap > -1e-6, `jay is pushed off the bark (gap ${minGap.toFixed(4)})`);
    c = S.spawn(sky, A("bluejay"), "a", 500);
    S.step(sky, c, { ...idle, leap: true }, 1 / 60);
    run(sky, c, { ...idle, climb: true }, 3);
    assert.equal(c.flight, null, "Shift: jay lands on what it touches");
    assert.ok(fin(c.speedNow, c.head.s, c.head.th, c.phi) && c.speedNow > 0 && c.speedNow <= A("bluejay").speed);
    run(sky, c, { ...idle, forward: true }, 1); // and walks on afterwards
    assert.ok(fin(c.head.s, c.head.th));
  }

  // --- floor: never below groundY + 15 ---
  {
    const fw = { branches: new Map([["hi", straight("hi", [W.v3(0, 1000, 0), W.v3(500, 1000, 0), W.v3(1000, 1000, 0)], 30)]]), groundY: -300 };
    for (const id of fliers) {
      const c = S.spawn(fw, A(id), "hi", 400);
      S.step(fw, c, { ...idle, leap: true }, 1 / 60);
      c.flight.p = { x: 6000, y: 200, z: 6000 };
      const down = id === "bluejay" ? { ...idle, forward: true } : { ...idle, climb: true };
      let lowest = Infinity;
      for (let i = 0; i < 60 * 20; i++) { S.step(fw, c, down, 1 / 60); lowest = Math.min(lowest, c.flight.p.y); assert.ok(finiteFlight(c.flight)); }
      assert.ok(c.flight && Math.abs(lowest - (-300 + 15)) < 1e-6, `${id}: clamped at groundY+15 (${lowest})`);
      assert.ok(c.flight.v.y >= -1e-9, `${id}: no downward velocity at the floor`);
    }
  }

  // --- fuzz: random inputs for thousands of frames on the demo world and a layoutTree world; no NaN, no bark, no underground ---
  {
    const mkTree = (spec) => {
      const notes = {}, edges = [];
      const add = (id, parent, kids) => {
        notes[id] = { noteId: id, title: id, type: "text", labels: {}, hasChildren: !!kids };
        if (parent) edges.push({ parentNoteId: parent, noteId: id, notePosition: 0 });
        (kids ?? []).forEach((k) => add(k.id, id, k.kids));
      };
      add("root", null, spec);
      return { rootNoteId: "root", notes, edges, truncated: false };
    };
    const lay = L.layoutTree(mkTree([
      { id: "f1", kids: [{ id: "n001" }, { id: "n002" }, { id: "f1a", kids: [{ id: "n003" }, { id: "f1b", kids: [{ id: "n005" }] }] }] },
      { id: "f2", kids: Array.from({ length: 20 }, (_, i) => ({ id: "m" + i })) },
      { id: "f3", kids: [{ id: "f3a", kids: [{ id: "n006" }] }, { id: "f3b", kids: [{ id: "n007" }] }] },
    ]));
    const worlds = [[W.makeDemoWorld(), "trunk", 300, "demo"], [lay.world, "root", 100, "layout"]];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const [w, bid, s0, wname] of worlds) {
      for (const id of fliers) {
        const a = A(id);
        const c = S.spawn(w, a, bid, s0);
        let held = { ...idle }, left = 0, flyFrames = 0, landings = 0, wasFlying = false, clean = true;
        for (let i = 0; i < 4000; i++) {
          if (left-- <= 0) {
            left = 8 + Math.floor(rnd() * 50);
            held = { ...idle, forward: rnd() < 0.55, back: rnd() < 0.2, left: rnd() < 0.3, right: rnd() < 0.3, reach: rnd() < 0.35, climb: rnd() < 0.2 };
          }
          if (c.flight && i % 150 === 0) { // keep it among the branches: drop it next to a random one (contacts, landings, deflections)
            const bs = [...w.branches.values()], b = bs[Math.floor(rnd() * bs.length)];
            c.flight.p = W.surfacePoint(b, rnd() * b.total, rnd() * 6.28 - 3.14, 10 + rnd() * 40).p;
            clean = false;
          }
          const dt = rnd() < 0.03 ? 0.05 + rnd() * 0.1 : 1 / 60;
          S.step(w, c, { ...held, leap: !c.flight && rnd() < 0.06 }, dt);
          assert.ok(fin(c.head.s, c.head.th, c.phi, c.speedNow, c.D, c.grip, c.shake), `${wname}/${id} frame ${i}: finite state`);
          if (wasFlying && !c.flight) landings++;
          wasFlying = !!c.flight;
          if (c.flight) {
            flyFrames++;
            assert.ok(finiteFlight(c.flight), `${wname}/${id} frame ${i}: finite flight`);
            assert.ok(c.flight.p.y >= (w.groundY ?? -2500) + 15 - 1e-6, `${wname}/${id}: above the floor`);
            const inside = [...w.branches.values()].filter((b) => { const n = W.nearestOnBranch(b, c.flight.p); return n.dist < W.radiusAt(b, n.s) + margin(a) - 0.05; });
            assert.ok(inside.length === 0 || !clean, `${wname}/${id} frame ${i}: went into branch ${inside[0]?.id}`);
            clean = inside.length === 0; // (a position we dropped it at may start inside; once clear it never re-enters)
          }
        }
        assert.ok(flyFrames > 300, `${wname}/${id} actually flew (${flyFrames} frames, ${landings} landings)`);
      }
    }
  }

  // --- grip by gravity (world y of the surface normal), not by theta ---
  {
    const lean = (deg) => { const t = (deg * Math.PI) / 180; return { branches: new Map([["v", straight("v", [W.v3(0, 0, 0), W.v3(Math.sin(t) * 1700, Math.cos(t) * 1700, 0), W.v3(Math.sin(t) * 3400, Math.cos(t) * 3400, 0)], 40)]]), groundY: -5000 }; };
    // underside th of a lean-ℓ-past-vertical branch: where the normal is (cos, -sin, 0)·(sign)
    const underTh = (w, deg) => {
      const f = W.frameAt(w.branches.get("v"), 500);
      const t = (deg * Math.PI) / 180;
      return W.thetaOf(f, W.v3(Math.cos(t), -Math.sin(t), 0));
    };
    // a vertical trunk never drains, all the way round
    const vw = lean(0);
    for (let k = 0; k < 8; k++) {
      const c = S.spawn(vw, A("lizard"), "v", 200);
      c.head.th = c.trail[c.trail.length - 1].surf.th = W.wrapAngle((k * Math.PI) / 4);
      let min = 1;
      for (let i = 0; i < 60 * 8; i++) { S.step(vw, c, { ...idle, forward: true }, 1 / 60); min = Math.min(min, c.grip); }
      assert.equal(min, 1, `vertical branch, th=${k}π/4: grip never drains`);
      assert.equal(c.air, null);
      assert.ok(c.head.s > 1500, "climbed");
    }
    const sn = S.spawn(vw, A("snake"), "v", 900);
    sn.head.th = sn.trail[sn.trail.length - 1].surf.th = Math.PI / 2;
    for (const t of sn.trail) if (t.surf) t.surf.th = Math.PI / 2;
    run(vw, sn, idle, 4);
    assert.equal(sn.grip, 1, "snake on a vertical branch: no drain");
    assert.ok(S.bodyOnTop(vw, sn));
    // 15° past vertical, lizard on the very underside, walking straight up for 10 s: grip stays > 0.5
    const lw = lean(15);
    let c = S.spawn(lw, A("lizard"), "v", 200);
    c.head.th = c.trail[c.trail.length - 1].surf.th = underTh(lw, 15);
    let min = 1;
    for (let i = 0; i < 60 * 10; i++) { S.step(lw, c, { ...idle, forward: true }, 1 / 60); min = Math.min(min, c.grip); }
    assert.ok(min > 0.5 && min < 1 && c.air === null, `15° overhang, underside, 10 s: grip ${min.toFixed(2)}`);
    assert.ok(c.head.s > 1500, "kept climbing");
    // the steeper the overhang the faster it drains; a full underside slips in 2-4 s
    const gripAfter = (deg, secs) => {
      const w = lean(deg);
      const d = S.spawn(w, A("lizard"), "v", 500);
      d.head.th = d.trail[d.trail.length - 1].surf.th = underTh(w, deg);
      let slippedAt = -1;
      for (let i = 0; i < 60 * secs; i++) { S.step(w, d, idle, 1 / 60); if (d.air && slippedAt < 0) slippedAt = (i + 1) / 60; }
      return { grip: d.grip, slippedAt };
    };
    const g15 = gripAfter(15, 3), g45 = gripAfter(45, 3), g90 = gripAfter(90, 4);
    assert.ok(g15.slippedAt < 0 && g45.slippedAt < 0 && g15.grip > g45.grip && g45.grip > 0, `drain grows with the overhang (${g15.grip.toFixed(2)} > ${g45.grip.toFixed(2)})`);
    assert.ok(g90.slippedAt > 1.5 && g90.slippedAt < 4, `full underside slips in 2-4 s (${g90.slippedAt})`);
    // 'on top' = normal.y above -0.12, whatever the branch's own frame says
    const c2 = S.spawn(vw, A("snake"), "v", 900);
    for (const t of c2.trail) if (t.surf) t.surf.th = W.thetaOf(W.frameAt(vw.branches.get("v"), t.surf.s), W.v3(0, 1, 0));
    assert.ok(S.bodyOnTop(vw, c2), "a vertical branch is 'on top' all round");
    // spider (clings) never drains, even fully underneath; the lizard does
    const hw = { branches: new Map([["h", straight("h", [W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)], 40)]]), groundY: -3000 };
    const sp = S.spawn(hw, A("spider"), "h", 500);
    sp.head.th = sp.trail[sp.trail.length - 1].surf.th = Math.PI;
    for (let i = 0; i < 60 * 10; i++) { S.step(hw, sp, { ...idle, forward: i % 120 < 60 }, 1 / 60); assert.equal(sp.grip, 1); }
    assert.equal(sp.air, null, "spider hangs on");
    const lz2 = S.spawn(hw, A("lizard"), "h", 500);
    lz2.head.th = lz2.trail[lz2.trail.length - 1].surf.th = Math.PI;
    let lzSlipped = false;
    for (let i = 0; i < 60 * 4; i++) { S.step(hw, lz2, idle, 1 / 60); if (lz2.air && lz2.air.slip) lzSlipped = true; }
    assert.ok(lzSlipped, "lizard slips from the underside");
    assert.deepEqual(S.ANIMALS.filter((x) => x.clings).map((x) => x.id).sort(), ["jumper", "spider"], "only the spiders cling");
  }

  // --- auto-align + thin-branch steering ---
  {
    const thin = { branches: new Map([["t", straight("t", [W.v3(0, 0, 0), W.v3(2000, 0, 0), W.v3(4000, 0, 0)], 9)]]), groundY: -3000 };
    const fat = { branches: new Map([["t", straight("t", [W.v3(0, 0, 0), W.v3(2000, 0, 0), W.v3(4000, 0, 0)], 100)]]), groundY: -3000 };
    const tap = (w, autoAlign) => {
      const c = S.spawn(w, A("lizard"), "t", 100);
      c.autoAlign = autoAlign;
      run(w, c, { ...idle, right: true }, 0.25);
      return c;
    };
    // turn damping: wide animal on a twig turns gently (factor 0.3), on a fat branch at full rate
    const ct = tap(thin, true), cf = tap(fat, true);
    assert.ok(Math.abs(ct.phi - 0.25 * A("lizard").turnRate * 0.3) < 1e-9, `twig: ${ct.phi.toFixed(3)}`);
    assert.ok(Math.abs(cf.phi - 0.25 * A("lizard").turnRate) < 1e-9, "fat branch: full rate");
    // tap + walk: straightens (autoAlign on), keeps spiralling (off)
    let on = tap(thin, true), off = tap(thin, false);
    assert.ok(Math.abs(on.phi) > 0.1 && Math.abs(off.phi) > 0.1, "the tap leaves a heading");
    const phi0 = off.phi;
    let prev = Math.abs(on.phi), monotone = true, flipped = false, t100 = -1;
    for (let i = 0; i < 120; i++) {
      S.step(thin, on, { ...idle, forward: true }, 1 / 60);
      S.step(thin, off, { ...idle, forward: true }, 1 / 60);
      if (Math.abs(on.phi) > prev + 1e-12) monotone = false;
      if (on.phi * phi0 < 0) flipped = true;
      prev = Math.abs(on.phi);
      if (t100 < 0 && prev < 0.1) t100 = (i + 1) / 60;
    }
    assert.ok(monotone && !flipped, "phi eases monotonically to 0 without overshoot");
    assert.ok(Math.abs(on.phi) < 0.1 && t100 > 0 && t100 < 2, `autoAlign: straight along the branch (${t100.toFixed(2)} s)`);
    assert.equal(off.phi, phi0, "autoAlign off: the heading stays");
    assert.ok(Math.abs(off.head.th) > 0.5 || Math.abs(off.head.th - on.head.th) > 0.1, "…so it spirals");
    // a larger angle on the demo trunk: monotone, also never when steering, not while backwards
    const w = W.makeDemoWorld();
    let c = S.spawn(w, A("lizard"), "trunk", 200);
    c.phi = 1.2;
    prev = 1.2;
    monotone = true;
    for (let i = 0; i < 180; i++) { S.step(w, c, { ...idle, forward: true }, 1 / 60); if (c.phi > prev + 1e-12 || c.phi < 0) monotone = false; prev = c.phi; }
    assert.ok(monotone && Math.abs(c.phi) < 1e-9, "from 1.2 rad: monotone to 0");
    c = S.spawn(w, A("lizard"), "trunk", 200);
    run(w, c, { ...idle, forward: true, right: true }, 0.5);
    assert.ok(c.phi > 0.8, "never while pressing A/D");
    c = S.spawn(w, A("lizard"), "trunk", 600);
    c.phi = Math.PI - 0.3;
    run(w, c, { ...idle, forward: true }, 1.5);
    assert.ok(Math.abs(c.phi) > 3.1 && c.head.s < 600, "walking backwards stays backwards (aligns to π, not 0)");
    c = S.spawn(w, A("lizard"), "trunk", 200);
    c.phi = 0.5;
    S.step(w, c, { ...idle, leap: true }, 1 / 60);
    const phiAir = c.phi;
    assert.ok(c.air);
    run(w, c, idle, 0.1);
    assert.ok(c.air && c.phi === phiAir, "no auto-align in the air");
    c = S.spawn(w, A("bee"), "trunk", 200);
    c.phi = 0.5;
    S.step(w, c, { ...idle, leap: true }, 1 / 60);
    run(w, c, { ...idle, forward: true }, 0.1);
    assert.equal(c.flight && c.phi, 0.5, "no auto-align while flying");
    // with autoAlign on, junctions and transfers still stay finite
    c = S.spawn(w, A("lizard"), "climb", 30);
    c.phi = Math.PI;
    run(w, c, { ...idle, forward: true }, 3);
    assert.ok(fin(c.phi, c.head.s, c.head.th));
  }

  // --- number-key categories: 1 crawlers (ant, spider, jumper, snake), 2 walkers (lizard, cat), 3 fliers (squirrel, bee, dragonfly, bluejay) ---
  {
    const pick = (n, id) => { const i = S.animalForKey(n, id); return i < 0 ? -1 : S.ANIMALS[i].id; };
    let id = "lizard";
    const seq = (n, ids) => { for (const want of ids) { id = pick(n, id); assert.equal(id, want, `key ${n}`); } };
    seq(1, ["ant", "spider", "jumper", "snake", "ant"]);
    id = "snake"; seq(2, ["lizard", "cat", "lizard"]);
    id = "ant"; seq(3, ["squirrel", "bee", "dragonfly", "bluejay", "squirrel"]);
    for (const n of [0, 4, 9, -1, 1.5, NaN]) assert.equal(S.animalForKey(n, "lizard"), -1, `invalid key ${n}`);
    const ids = S.ANIMALS.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, "animal ids are unique");
    assert.deepEqual(S.ANIMAL_CATEGORIES.flatMap((x) => x.ids).sort(), [...ids].sort(), "every animal is in exactly one category");
  }
}
// 18. Yggdrasil leap aiming (hold Space = aim, release = leap, assist, preview) + blue jay landing mode
{
  const W = await bundle("src/tree/world3.ts", "w3e.mjs");
  const S = await bundle("src/tree/sim3.ts", "s3e.mjs");
  const L = await bundle("src/tree/layout.ts", "layout3e.mjs");
  const idle = S.NO_INPUT;
  const A = (id) => S.ANIMALS.find((x) => x.id === id);
  const run = (w, c, input, secs, dt = 1 / 60) => { for (let t = 0; t < secs - 1e-9; t += dt) S.step(w, c, input, dt); };
  const fin = (...xs) => xs.every(Number.isFinite);
  const straight = (id, pts, r) => W.makeBranch(id, W.smoothPath(pts), r);
  const hold = { ...idle, reach: true };
  const jumpers = ["lizard", "cat", "squirrel", "jumper"]; // exactly the animals with a `leap`
  let seed = 424242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mkTree = (spec) => {
    const notes = {}, edges = [];
    const add = (id, parent, kids) => {
      notes[id] = { noteId: id, title: id, type: "text", labels: {}, hasChildren: !!kids };
      if (parent) edges.push({ parentNoteId: parent, noteId: id, notePosition: 0 });
      (kids ?? []).forEach((k) => add(k.id, id, k.kids));
    };
    add("root", null, spec);
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const lay = L.layoutTree(mkTree([
    { id: "f1", kids: [{ id: "n001" }, { id: "n002" }, { id: "f1a", kids: [{ id: "n003" }, { id: "f1b", kids: [{ id: "n005" }] }] }] },
    { id: "f2", kids: Array.from({ length: 20 }, (_, i) => ({ id: "m" + i })) },
    { id: "f3", kids: [{ id: "f3a", kids: [{ id: "n006" }] }, { id: "f3b", kids: [{ id: "n007" }] }] },
    { id: "f4", kids: [{ id: "f4a", kids: [{ id: "n008" }, { id: "n009" }] }] },
  ]));
  const demo = W.makeDemoWorld();
  // one long branch alone in the sky: nothing to assist toward, so the manual aim is exactly what flies
  const lone = { branches: new Map([["a", straight("a", [W.v3(0, 0, 0), W.v3(2000, 0, 0), W.v3(4000, 0, 0)], 40)]]), groundY: -4000 };
  // a gap: `a` runs along x, `g` a parallel branch 350 px to the side, starting ahead. Straight on you land back on `a`.
  const gap = { branches: new Map(), groundY: -3000 };
  W.addBranch(gap, straight("a", [W.v3(0, 0, 0), W.v3(2000, 0, 0), W.v3(4000, 0, 0)], 40));
  W.addBranch(gap, straight("g", [W.v3(900, 0, 350), W.v3(1800, 0, 350), W.v3(2700, 0, 350)], 40));
  const lizardOn = (w, bid, s) => S.spawn(w, A("lizard"), bid, s);
  const tapFull = (lp, fwd, n) => W.add(W.mul(fwd, lp.speed), W.mul(n, lp.up));

  // --- flow: Space press starts aiming, held = stand still + aim, release = leap ---
  for (const id of jumpers) {
    const c = S.spawn(lone, A(id), "a", 500);
    assert.equal(c.aim, null, "aim is null by default");
    assert.equal(S.leapPreview(lone, c), null, "no preview without an aim");
    S.step(lone, c, { ...hold, leap: true, forward: true }, 1 / 60);
    assert.ok(c.aim && c.aim.yaw === 0 && c.aim.pitch === 0 && c.aim.t === 0 && c.air === null, `${id}: Space starts aiming`);
    const s0 = c.head.s;
    run(lone, c, { ...hold, forward: true }, 0.5);
    assert.ok(c.aim && c.air === null, `${id}: still aiming while held`);
    assert.ok(Math.abs(c.head.s - s0) < 1e-6 && c.speedNow < 1e-6, `${id}: stands still while aiming even with W held`);
    assert.ok(c.aim.pitch > 0.4 && c.aim.pitch < 0.6 + 1e-9 && c.aim.t > 0.49, `${id}: W tilts the aim up (${c.aim.pitch.toFixed(2)})`);
    run(lone, c, hold, 0.1);
    run(lone, c, idle, 1 / 60);
    assert.ok(c.aim === null && c.air && c.flight === null, `${id}: release leaps`);
  }
  // a quick tap (press + release one frame later) is the plain full-power leap, same as before the aiming existed
  for (const id of jumpers) {
    for (const w of [lone, gap]) {
      const c = S.spawn(w, A(id), "a", 500);
      const lp = A(id).leap, fwd = S.headingVector(w, c), n = S.headNormal(w, c);
      S.step(w, c, { ...hold, leap: true }, 1 / 60);
      run(w, c, hold, 0.1);
      S.step(w, c, idle, 1 / 60);
      assert.ok(c.air, `${id}: tap launches`);
      if (w === lone) assert.ok(W.dist(c.air.v, tapFull(lp, fwd, n)) < 1e-6, `${id}: the tap is the full default leap`);
      else assert.ok(c.air.v.x > 0 && W.len(c.air.v) > 0, `${id}: tap launches on the gap world`);
    }
    const t1 = S.spawn(lone, A(id), "a", 500);
    S.step(lone, t1, { ...idle, leap: true }, 1 / 60); // press and release in one frame (old style input)
    assert.ok(t1.air && W.dist(t1.air.v, tapFull(A(id).leap, S.headingVector(lone, t1), S.headNormal(lone, t1))) < 1e-6, `${id}: single-frame leap = tap`);
  }

  // --- aiming: A/D yaw (right = +, relative to the heading), W/S pitch, clamps, charge ---
  {
    const lp = A("lizard").leap;
    const c = lizardOn(lone, "a", 500);
    const fwd = S.headingVector(lone, c), n = S.headNormal(lone, c);
    S.step(lone, c, { ...hold, leap: true }, 1 / 60);
    run(lone, c, { ...hold, right: true }, 0.25);
    assert.ok(Math.abs(c.aim.yaw - 1.6 * 0.25) < 0.03, `D: yaw rate ~1.6 rad/s (${c.aim.yaw.toFixed(3)})`);
    run(lone, c, { ...hold, right: true }, 3);
    assert.ok(Math.abs(c.aim.yaw - (70 * Math.PI) / 180) < 1e-9, "yaw clamps at +70 degrees");
    run(lone, c, { ...hold, left: true }, 4);
    assert.ok(Math.abs(c.aim.yaw + (70 * Math.PI) / 180) < 1e-9, "…and -70 degrees");
    run(lone, c, { ...hold, back: true }, 2);
    assert.ok(Math.abs(c.aim.pitch + 0.35) < 1e-9, "pitch clamps at -0.35");
    run(lone, c, { ...hold, forward: true }, 2);
    assert.ok(Math.abs(c.aim.pitch - 0.6) < 1e-9, "pitch clamps at +0.6");
    assert.ok(c.aim.charge === 1 && c.aim.t > 4, "charge is full after 0.8 s");
    // aim 0.5 rad right, no extra pitch, full charge: launched along heading turned right about the normal, full speed
    c.aim.yaw = 0.5; c.aim.pitch = 0;
    const pv = S.leapPreview(lone, c);
    S.step(lone, c, idle, 1 / 60);
    const v = c.air.v, flat = W.sub(v, W.mul(n, W.dot(v, n)));
    const ang = Math.acos(W.dot(W.norm(flat), fwd));
    assert.ok(Math.abs(ang - 0.5) < 1e-6 && W.dot(W.cross(fwd, flat), n) < 0, `released along the aimed yaw to the RIGHT (${ang.toFixed(3)})`);
    assert.ok(Math.abs(W.len(v) - Math.hypot(lp.speed, lp.up)) < 1e-6 && Math.abs(W.dot(v, n) - lp.up) < 1e-6, "full charge = today's launch speed and elevation");
    assert.ok(pv && !pv.assisted, "nothing to assist toward on a lone branch");
    // pitch raises / lowers the elevation
    const el = (pitch) => { const d = lizardOn(lone, "a", 500); d.aim = { yaw: 0, pitch, charge: 1, t: 1 }; S.step(lone, d, idle, 1 / 60); return W.dot(W.norm(d.air.v), n); };
    assert.ok(el(0.4) > el(0) && el(0) > el(-0.3), "pitch tilts the launch");
    // charge scales the whole launch vector (vertical too)
    const ch = (secs) => { const d = lizardOn(lone, "a", 500); S.step(lone, d, { ...hold, leap: true }, 1 / 60); run(lone, d, hold, secs); const k = d.aim.charge; S.step(lone, d, idle, 1 / 60); return [k, W.len(d.air.v) / Math.hypot(lp.speed, lp.up), W.dot(d.air.v, n) / lp.up]; };
    const [k1, r1, u1] = ch(0.3), [k2, r2] = ch(0.5), [k3, r3] = ch(1);
    assert.ok(k1 > 0.55 && k1 < k2 && k2 < k3 && k3 === 1, "charge builds over the hold");
    assert.ok(Math.abs(r1 - k1) < 1e-9 && Math.abs(u1 - k1) < 1e-9 && Math.abs(r2 - k2) < 1e-9 && Math.abs(r3 - 1) < 1e-9, "launch speed = charge x full, both components");
  }

  // --- Shift cancels; aim ignored while airborne / flying / reaching; changing animal clears it ---
  {
    let c = lizardOn(lone, "a", 500);
    S.step(lone, c, { ...hold, leap: true }, 1 / 60);
    run(lone, c, hold, 0.3);
    S.step(lone, c, { ...hold, climb: true }, 1 / 60);
    assert.equal(c.aim, null, "Shift cancels the aim");
    run(lone, c, hold, 0.3);
    run(lone, c, idle, 0.3);
    assert.equal(c.air, null, "…and releasing afterwards does not leap");
    S.step(lone, c, { ...hold, leap: true, climb: true }, 1 / 60);
    assert.equal(c.aim, null, "Space with Shift held never starts an aim");
    c = lizardOn(lone, "a", 500);
    S.step(lone, c, { ...idle, leap: true }, 1 / 60);
    assert.ok(c.air);
    S.step(lone, c, { ...hold, leap: true, right: true }, 1 / 60);
    assert.equal(c.aim, null, "airborne: Space is ignored");
    run(lone, c, { ...hold, leap: true }, 0.4);
    assert.equal(c.aim, null);
    for (const id of ["bee", "dragonfly", "bluejay", "snake"]) {
      const f = S.spawn(lone, A(id), "a", 500);
      S.step(lone, f, { ...hold, leap: true }, 1 / 60);
      run(lone, f, { ...hold, forward: true }, 0.3);
      assert.equal(f.aim, null, `${id}: never aims`);
      assert.equal(S.leapPreview(lone, f), null);
      assert.ok(id === "snake" ? f.reach && !f.air : f.flight, `${id}: keeps its own Space behaviour (${id === "snake" ? "reach" : "take-off"})`);
    }
    // grip loss while aiming (hanging underneath): slips as usual and the aim is dropped
    c = lizardOn(lone, "a", 500);
    c.head.th = Math.PI;
    for (const t of c.trail) if (t.surf) t.surf.th = Math.PI;
    S.step(lone, c, { ...hold, leap: true }, 1 / 60);
    run(lone, c, hold, 3);
    assert.ok(c.air && c.air.slip && c.aim === null || c.aim === null && c.air === null, "slipping drops the aim");
    c = lizardOn(lone, "a", 500);
    S.step(lone, c, { ...hold, leap: true }, 1 / 60);
    c.animal = A("snake");
    S.step(lone, c, hold, 1 / 60);
    assert.equal(c.aim, null, "an animal without a leap clears the aim");
  }

  // --- assist: a branch the manual aim misses but one nudge reaches; manual input still moves the cone ---
  {
    const c = lizardOn(gap, "a", 500);
    S.step(gap, c, { ...hold, leap: true }, 1 / 60);
    run(gap, c, hold, 1);
    const pre = JSON.stringify(c);
    const pv = S.leapPreview(gap, c);
    assert.ok(pv && pv.assisted && pv.hit && pv.hit.b === "g", `assist bends the straight-on arc onto the gap branch (${pv?.hit?.b}, assisted ${pv?.assisted})`);
    assert.equal(JSON.stringify(c), pre, "preview does not mutate the creature");
    // manual aim straight at g: no assist needed
    c.aim.yaw = Math.atan2(350, 1100);
    const pm = S.leapPreview(gap, c);
    assert.ok(pm.hit && pm.hit.b === "g", "manual aim at the branch hits it");
    const pm2 = S.leapPreview(gap, c);
    assert.deepEqual(pm2, pm, "preview is deterministic");
    // far to the left (outside the +-30 degree window of g): no assist, lands on a (or nothing), never g
    c.aim.yaw = -1.2;
    const pl = S.leapPreview(gap, c);
    assert.ok(!pl.assisted && (!pl.hit || pl.hit.b === "a"), "manual input outside the window is respected");
    // release with the assist on: it really lands on g
    c.aim.yaw = 0;
    S.step(gap, c, idle, 1 / 60);
    assert.ok(c.air);
    run(gap, c, idle, 3);
    assert.equal(c.air, null);
    assert.equal(c.head.b, "g", "the assisted leap lands on the gap branch");
    // the assist never sends you to the branch you stand on, or into the ground: standing on g with a at the other side
    const c2 = lizardOn(gap, "g", 1200);
    c2.phi = Math.PI; // facing -x... a is at -z though: aim straight, assist may find a
    S.step(gap, c2, { ...hold, leap: true }, 1 / 60);
    run(gap, c2, hold, 0.9);
    const p2 = S.leapPreview(gap, c2);
    assert.ok(p2.hit === null || p2.hit.b !== "g" || !p2.assisted, "never assists onto the branch you stand on");
    const sky = lizardOn(lone, "a", 500);
    S.step(lone, sky, { ...hold, leap: true }, 1 / 60);
    run(lone, sky, hold, 0.9);
    const ps = S.leapPreview(lone, sky);
    assert.ok(!ps.assisted && ps.points.length >= 15 && ps.points.length <= 60, `lone: unassisted arc, ${ps.points.length} points`);
    assert.ok(W.dist(ps.points[0], W.surfacePoint(lone.branches.get("a"), 500, 0).p) < 1e-6, "the arc starts at the launch spot");
    assert.ok(ps.hit === null || ps.hit.b === "a");
  }

  // --- preview == actual: released aims (random, assisted or not) land where the preview said, on both worlds ---
  {
    let checked = 0, assisted = 0, hits = 0;
    for (const [w, wname] of [[demo, "demo"], [lay.world, "layout"]]) {
      const ids = [...w.branches.keys()];
      for (const id of jumpers) {
        for (let k = 0; k < 14; k++) {
          const bid = ids[Math.floor(rnd() * ids.length)], b = w.branches.get(bid);
          const c = S.spawn(w, A(id), bid, 30 + rnd() * (b.total - 60));
          c.head.th = (rnd() - 0.5) * 2.4;
          c.phi = (rnd() - 0.5) * 3;
          c.aim = { yaw: (rnd() - 0.5) * 2.4, pitch: -0.3 + rnd() * 0.85, charge: 0.55 + rnd() * 0.45, t: 1 };
          const pv = S.leapPreview(w, c);
          assert.ok(pv && pv.points.length >= 2 && pv.points.every((p) => fin(p.x, p.y, p.z)), `${wname}/${id}: finite preview`);
          assert.ok(pv.points.length <= 60, `${wname}/${id}: at most 60 points (${pv.points.length})`);
          S.step(w, c, idle, 1 / 60);
          assert.ok(c.air && c.aim === null, `${wname}/${id}: released`);
          let t = 0;
          while (c.air && !c.air.slip && t < 8) { S.step(w, c, idle, 1 / 60); t += 1 / 60; if (c.air && c.air.t > 0 && c.air.t > (A(id).leap.steer ? 7 : 2.2) + 0.1) break; }
          checked++;
          if (pv.assisted) assisted++;
          if (pv.hit) {
            hits++;
            assert.equal(c.head.b, pv.hit.b, `${wname}/${id}: lands on the previewed branch (${c.head.b} vs ${pv.hit.b})`);
            assert.ok(Math.abs(c.head.s - pv.hit.s) < 1 && Math.abs(W.wrapAngle(c.head.th - Math.max(-(A(id).maxTh ?? 9), Math.min(A(id).maxTh ?? 9, pv.hit.th)))) < 0.02, `${wname}/${id}: lands on the previewed spot (the cat's cling limit maxTh clamps th)`);
          }
        }
      }
    }
    assert.ok(hits > 25 && assisted > 5, `the matrix exercised hits (${hits}) and the assist (${assisted}) of ${checked}`);
  }

  // --- determinism ---
  {
    const go = () => {
      const w = lay.world, c = S.spawn(w, A("cat"), "root", 300);
      const log = [];
      S.step(w, c, { ...hold, leap: true }, 1 / 60);
      for (let i = 0; i < 400; i++) {
        S.step(w, c, { ...idle, reach: i < 60, right: i < 20 }, 1 / 60);
        const pv = S.leapPreview(w, c);
        log.push([c.head.b, c.head.s, c.aim?.yaw, pv?.hit?.b, pv?.points.length]);
      }
      return JSON.stringify(log);
    };
    assert.equal(go(), go(), "same inputs, same aims, previews and landings");
  }

  // --- blue jay landing mode: hold only Shift from 250-450 px away, up to +-35 degrees off the target ---
  {
    const jay = A("bluejay"), fl = jay.flight, margin = Math.max(3, jay.nodes[0].w * 0.8);
    const touching = (w, p) => [...w.branches.values()].some((b) => { const n = W.nearestOnBranch(b, p); return n.dist < W.radiusAt(b, n.s) + margin + 2; });
    for (const [w, wname] of [[demo, "demo"], [lay.world, "layout"]]) {
      const ids = [...w.branches.keys()], floor = (w.groundY ?? -2500) + 15;
      let landed = 0, trials = 0, targets = 0;
      while (trials < 200) {
        const b = w.branches.get(ids[Math.floor(rnd() * ids.length)]);
        const s = rnd() * b.total, top = W.surfacePoint(b, s, 0).p;
        const bear = rnd() * Math.PI * 2, d = 250 + rnd() * 200;
        const p = { x: top.x + Math.cos(bear) * d, y: top.y + 20 + rnd() * 120, z: top.z + Math.sin(bear) * d };
        if (p.y < floor + 60 || touching(w, p)) continue;
        trials++;
        const c = S.spawn(w, jay, b.id, Math.min(b.total, s));
        S.step(w, c, { ...idle, leap: true }, 1 / 60);
        const toward = Math.atan2(top.z - p.z, top.x - p.x), yaw = toward + (rnd() * 2 - 1) * (35 * Math.PI) / 180;
        c.flight.p = p; c.flight.yaw = yaw; c.flight.pitch = 0; c.flight.speed = fl.cruise * (0.8 + 0.3 * rnd()); c.flight.t = 5;
        c.flight.v = W.mul(W.v3(Math.cos(yaw), 0, Math.sin(yaw)), c.flight.speed);
        for (let i = 0; i < 60 * 6 && c.flight; i++) {
          S.step(w, c, { ...idle, climb: true }, 1 / 60);
          if (c.flight) {
            assert.ok(fin(c.flight.p.x, c.flight.p.y, c.flight.p.z, c.flight.yaw, c.flight.pitch, c.flight.speed), `${wname}: finite landing flight`);
            if (c.flight.landTarget) targets++;
          }
        }
        if (!c.flight) landed++;
      }
      assert.ok(landed >= 180, `${wname}: Shift alone lands the jay in >= 90% of 200 trials (${landed})`);
      assert.ok(targets > 200, `${wname}: the landing target is reported (${targets} frames)`);
    }
    // landTarget is null unless landing mode is on, and when nothing is ahead
    const c = S.spawn(demo, jay, "trunk", 300);
    S.step(demo, c, { ...idle, leap: true }, 1 / 60);
    assert.equal(c.flight.landTarget, null, "null after take-off");
    run(demo, c, idle, 0.3);
    assert.equal(c.flight.landTarget, null, "null without Shift");
    c.flight.p = { x: 8000, y: 3000, z: 8000 };
    run(demo, c, { ...idle, climb: true }, 0.5);
    assert.equal(c.flight.landTarget, null, "null with nothing ahead");
    // landing mode flares: the speed settles at 1.15 x stall, no stall nose-drop
    run(demo, c, { ...idle, climb: true }, 3);
    assert.ok(Math.abs(c.flight.speed - fl.stall * 1.15) < 5 && c.flight.pitch > -0.2, `flare speed ${c.flight.speed.toFixed(0)} vs ${(fl.stall * 1.15).toFixed(0)}`);
    // without Shift it still deflects off bark at cruise speed, never landing or entering it
    let defl = 0;
    for (const [w, bid] of [[demo, "trunk"], [lay.world, "root"]]) {
      for (let k = 0; k < 20; k++) {
        const b = w.branches.get(bid), s = 150 + rnd() * (b.total - 300), top = W.surfacePoint(b, s, 0).p;
        const bear = rnd() * Math.PI * 2, r = W.radiusAt(b, s);
        const d = 200, p = { x: top.x + Math.cos(bear) * d, y: top.y - r + (rnd() - 0.5) * r * 0.8, z: top.z + Math.sin(bear) * d };
        if (touching(w, p) || p.y < (w.groundY ?? -2500) + 80) continue;
        const f = S.spawn(w, jay, b.id, s);
        S.step(w, f, { ...idle, leap: true }, 1 / 60);
        f.flight.p = p; f.flight.t = 5; f.flight.yaw = Math.atan2(-Math.sin(bear), -Math.cos(bear)); f.flight.pitch = 0; f.flight.speed = fl.cruise;
        f.flight.v = W.mul(W.v3(Math.cos(f.flight.yaw), 0, Math.sin(f.flight.yaw)), fl.cruise);
        let landedEarly = false;
        for (let i = 0; i < 60 * 0.8; i++) { S.step(w, f, idle, 1 / 60); if (!f.flight) { landedEarly = true; break; } assert.equal(f.flight.landTarget, null); }
        assert.ok(!landedEarly, "cruising into bark without Shift: deflected, not landed");
        defl++;
      }
    }
    assert.ok(defl >= 10, `deflection trials ran (${defl})`);
    // auto-land: touching a branch slower than 1.4 x stall lands without Shift
    const lw = { branches: new Map([["a", straight("a", [W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)], 40)]]), groundY: -3000 };
    const g = S.spawn(lw, jay, "a", 100);
    S.step(lw, g, { ...idle, leap: true }, 1 / 60);
    // (a cruise-speed jay would be pushed off: covered above) here it is slow: contact lands without Shift
    g.flight.p = { x: 1500, y: 40 + margin - 0.5, z: 0 }; g.flight.t = 5; g.flight.cleared = true; // (the origin only lands a flier that has cleared it: section 19)
     g.flight.speed = fl.stall * 1.2; g.flight.pitch = 0; g.flight.yaw = 0;
    g.flight.v = W.v3(g.flight.speed, 0, 0);
    S.step(lw, g, { ...idle, back: true }, 1 / 60);
    assert.equal(g.flight, null, "slower than 1.4 x stall: touching lands without Shift");
  }

  // --- fuzz: random aiming / landing input on both worlds stays finite ---
  {
    for (const [w, bid, s0, wname] of [[demo, "trunk", 300, "demo"], [lay.world, "root", 100, "layout"]]) {
      for (const id of [...jumpers, "bluejay"]) {
        const c = S.spawn(w, A(id), bid, s0);
        let held = { ...idle }, left = 0;
        for (let i = 0; i < 1500; i++) {
          if (left-- <= 0) {
            left = 5 + Math.floor(rnd() * 40);
            held = { ...idle, forward: rnd() < 0.5, back: rnd() < 0.25, left: rnd() < 0.3, right: rnd() < 0.3, reach: rnd() < 0.6, climb: rnd() < 0.15 };
          }
          S.step(w, c, { ...held, leap: !c.flight && !c.air && !c.aim && rnd() < 0.1 }, rnd() < 0.03 ? 0.08 : 1 / 60);
          assert.ok(fin(c.head.s, c.head.th, c.phi, c.speedNow, c.D, c.grip), `${wname}/${id}: finite`);
          if (c.aim) {
            assert.ok(fin(c.aim.yaw, c.aim.pitch, c.aim.charge, c.aim.t) && Math.abs(c.aim.yaw) <= 1.2218 && c.aim.pitch >= -0.35 - 1e-9 && c.aim.pitch <= 0.6 + 1e-9 && c.aim.charge >= 0.55 && c.aim.charge <= 1, `${wname}/${id}: aim in range`);
            const pv = i % 6 === 0 ? S.leapPreview(w, c) : { points: [] };
            assert.ok(pv && pv.points.every((p) => fin(p.x, p.y, p.z)));
          }
          if (c.flight) assert.ok(fin(c.flight.p.x, c.flight.p.y, c.flight.p.z, c.flight.speed));
        }
      }
    }
  }
}
// 17. forest layout: hub + one tree per top-level folder, species, editable/recalculable branch properties (biblio_b* labels), leaf pins
{
  const L = await bundle("src/tree/layout.ts", "layout17.mjs");
  const SP = await bundle("src/tree/species.ts", "species17.mjs");
  const W = await bundle("src/tree/world3.ts", "w17.mjs");
  const S = await bundle("src/tree/sim3.ts", "s17.mjs");
  const lib = await bundle("src/lib/library.ts", "lib17.mjs");
  const cfg = await bundle("src/config.ts", "cfg17.mjs");
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
  const allIds = (tree) => Object.keys(tree.notes).filter((id) => tree.notes[id].hasChildren && id !== "root");
  const force = (tree, key) => new Map(allIds(tree).map((id) => [id, { species: key }]));
  const fin = (...xs) => xs.every(Number.isFinite);
  const trunksOf = (lay) => lay.world.branches.get("root").next.map((id) => lay.world.branches.get(id));
  const risePt = (b) => { let i = 0; while (i < b.T.length - 1 && b.T[i].y < 0.9) i++; return { p: b.pts[i], r: W.radiusAt(b, b.cum[i]) }; };
  const minGap = (lay) => { // smallest (distance / sum of radii) between the points where the trunks finish their arch; 3 = three trunk diameters apart
    const rs = trunksOf(lay).map(risePt);
    let m = Infinity;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.min(m, W.dist(rs[i].p, rs[j].p) / (rs[i].r + rs[j].r));
    return m;
  };
  const dump = (lay) => JSON.stringify({
    b: [...lay.world.branches.values()].map((b) => [b.id, b.pts, b.r, b.rEnd, b.parent, b.attachS, b.species, b.next, b.side]),
    l: lay.leaves, p: [...lay.parentOf], i: [...lay.info].map(([id, x]) => [id, x.calc, x.eff, [...x.overridden]]),
  });
  const noNaN = (lay, what) => {
    for (const b of lay.world.branches.values()) {
      assert.ok(fin(b.r, b.rEnd, b.total) && b.pts.every((p) => fin(p.x, p.y, p.z)) && b.T.every((p) => fin(p.x, p.y, p.z)) && b.U.every((p) => fin(p.x, p.y, p.z)), `${what}/${b.id}: finite geometry`);
      assert.ok(b.r > 0 && b.rEnd > 0 && b.total > 0, `${what}/${b.id}: positive size`);
    }
    for (const l of lay.leaves) assert.ok(fin(l.s, l.th) && typeof l.color === "string", `${what}: finite leaf`);
    for (const [id, x] of lay.info) for (const set of [x.calc, x.eff]) for (const k of Object.keys(set)) assert.ok(k === "species" ? SP.SPECIES[set[k]] : k === "waveFn" ? typeof set[k] === "string" : fin(set[k]), `${what}/${id}: finite ${k}`);
  };

  // ---- hub + forest connectivity ----
  const base = mk([...forest(5, 6, [{ id: "G", kids: notesN("g", 3) }]), { id: "r1" }, { id: "r2" }, { id: "r3" }]);
  const lay = L.layoutTree(base);
  const hub = lay.world.branches.get("root");
  assert.equal(lay.rootBranchId, "root");
  assert.equal(hub.parent, null);
  assert.equal(lay.parentOf.get("root"), null);
  assert.ok(hub.pts.every((p) => Math.abs(p.x) < 1e-9 && Math.abs(p.z) < 1e-9), "the hub grows straight up");
  assert.ok(Math.abs(hub.pts[0].y) < 1e-9 && Math.abs(hub.total - (90 + 30 * 3)) < 1e-6, `hub length = 90 + 30 per direct note (${hub.total})`);
  assert.ok(hub.r >= 18 && Math.abs(hub.r - Math.max(18, 1.1 * Math.max(...trunksOf(lay).map((b) => b.r)))) < 1e-9, "hub radius = 1.1 x the thickest trunk (min 18)");
  assert.deepEqual(hub.next.slice().sort(), ["F0", "F1", "F2", "F3", "F4"], "every top-level folder is a 'next' child of the hub");
  assert.deepEqual(hub.side, [], "nothing attaches to the side of the hub");
  for (const id of hub.next) {
    const t = lay.world.branches.get(id);
    assert.equal(t.parent, "root");
    assert.equal(t.attachS, undefined);
    assert.ok(W.dist(t.pts[0], hub.pts[hub.pts.length - 1]) < 1e-9, `${id} starts at the hub's end`);
    assert.equal(lay.parentOf.get(id), "root");
    assert.ok(W.frameAt(t, 0).t.y < 0.35, `${id} leaves nearly horizontally (${W.frameAt(t, 0).t.y.toFixed(2)})`);
    assert.ok(t.T[t.T.length - 1].y > 0.9, `${id} arches up to vertical`);
  }
  assert.deepEqual(L.pathToRoot(lay, "G0"), ["root", "F0", "G0"], "breadcrumb unchanged");
  assert.deepEqual(lay.leaves.filter((l) => l.branchId === "root").map((l) => l.id).sort(), ["r1", "r2", "r3"], "the root's notes are leaves on the hub");
  assert.equal(lay.info.size, lay.world.branches.size, "info for every branch, the hub included");
  noNaN(lay, "base");
  // a creature walks down one trunk into the hub, and up another trunk
  {
    const A = (id) => S.ANIMALS.find((a) => a.id === id);
    const w = lay.world;
    const c0 = S.spawn(w, A("lizard"), "F0", 80);
    c0.autoAlign = false;
    c0.phi = Math.PI; // facing the hub
    for (let t = 0; t < 40 && c0.head.b === "F0"; t += 1 / 60) S.step(w, c0, { ...S.NO_INPUT, forward: true }, 1 / 60);
    assert.equal(c0.head.b, "root", "walking down a trunk leads into the hub");
    for (const target of ["F1", "F2", "F3", "F4"]) {
      const tb = w.branches.get(target);
      const c = S.spawn(w, A("lizard"), "root", hub.total - 0.02);
      c.autoAlign = false;
      const f = W.frameAt(hub, hub.total);
      const d = W.frameAt(tb, 0).t;
      const dp = W.sub(d, W.mul(f.t, W.dot(d, f.t)));
      c.head.th = Math.atan2(-W.dot(dp, f.u), W.dot(dp, f.b));
      c.phi = Math.atan2(W.len(dp), W.dot(d, f.t));
      for (let i = 0; i < 240 && c.head.b === "root"; i++) S.step(w, c, { ...S.NO_INPUT, forward: true }, 1 / 60);
      assert.equal(c.head.b, target, `up from the hub onto ${target}`);
      assert.notEqual(c.head.b, "F0");
    }
  }

  // ---- N = 0 / 1 / 2 / 30 / 45 top-level folders ----
  {
    const l0 = L.layoutTree(mk([{ id: "a" }, { id: "b" }]));
    assert.deepEqual([...l0.world.branches.keys()], ["root"], "no folders: just the hub");
    assert.equal(l0.world.branches.get("root").total, 150);
    assert.equal(L.layoutTree(mk([])).world.branches.get("root").total, 90, "empty vault: the minimum stump");
    assert.equal(L.layoutTree(mk(Array.from({ length: 40 }, (_, i) => ({ id: "n" + i })))).world.branches.get("root").total, 700, "hub length is clamped at 700");
    assert.equal(l0.leaves.length, 2);
    const l1 = L.layoutTree(mk(forest(1, 8)));
    const t1 = l1.world.branches.get("F0");
    assert.deepEqual(l1.world.branches.get("root").next, ["F0"]);
    assert.ok(t1.T.every((t) => t.y > 0.85), "one folder: the trunk just continues up");
    assert.ok(W.dist(t1.pts[0], l1.world.branches.get("root").pts.at(-1)) < 1e-9);
    for (const n of [2, 3, 6, 12, 30, 45]) {
      const ln = L.layoutTree(mk(forest(n, 40)));
      assert.equal(trunksOf(ln).length, n);
      assert.ok(minGap(ln) >= 3, `${n} trees: bases ${minGap(ln).toFixed(2)} x (sum of radii) >= 3 diameters apart`);
      noNaN(ln, `N=${n}`);
    }
    // fat trunks (baobab x1.9) still keep the promise; above 30 trees the arch grows with the thickness
    for (const n of [2, 5, 12, 30, 50]) {
      const t = mk(forest(n, 150));
      const ln = L.layoutTree(t, { overrides: force(t, "baobab") });
      assert.ok(minGap(ln) >= 3, `${n} baobabs: ${minGap(ln).toFixed(2)} >= 3`);
    }
    const runOf = (n) => { const t = mk(forest(n, 150)); const ln = L.layoutTree(t, { overrides: force(t, "baobab") }); return W.dist(W.v3(0, 0, 0), W.v3(risePt(trunksOf(ln)[0]).p.x, 0, risePt(trunksOf(ln)[0]).p.z)); };
    assert.ok(runOf(50) > runOf(30), "more fat trees -> a longer root arch");
  }

  // ---- species ----
  const keys = SP.SPECIES_KEYS;
  assert.ok(keys.length >= 10 && new Set(keys).size === keys.length, `${keys.length} species`);
  for (const k of keys) {
    const s = SP.SPECIES[k];
    assert.equal(s.key, k);
    const inR = (v, lo, hi, what) => assert.ok(Number.isFinite(v) && v >= lo && v <= hi, `${k}.${what} = ${v} in [${lo}, ${hi}]`);
    inR(s.trunkLen, 0.3, 2.2, "trunkLen"); inR(s.trunkR, 0.5, 2.2, "trunkR"); inR(s.branchR, 0.4, 1.8, "branchR");
    inR(s.taper, 0.2, 0.9, "taper"); inR(s.pitchMin, 0, 120, "pitchMin"); inR(s.pitchMax, 0, 120, "pitchMax");
    assert.ok(s.pitchMin < s.pitchMax, `${k}: pitch range`);
    inR(s.upBias, 0, 1, "upBias"); inR(s.droop, 0, 1, "droop"); inR(s.lengthDecay, 0.6, 1, "lengthDecay"); inR(s.childLen, 0.3, 2, "childLen");
    assert.ok(["golden", "whorl", "alternate"].includes(s.azimuthRule));
    inR(s.attachFrom, 0, 1, "attachFrom"); inR(s.attachTo, 0, 1, "attachTo");
    assert.ok(s.attachTo - s.attachFrom >= 0.25, `${k}: attach span`);
    inR(s.sway, 0, 2.5, "sway"); inR(s.tropism, 0, 0.3, "tropism");
    s.bark.base.forEach((v) => inR(v, 0, 1, "bark.base")); inR(s.bark.variation, 0, 1, "bark.variation"); inR(s.bark.moss, 0, 1, "bark.moss"); inR(s.bark.streak, 0, 1, "bark.streak");
    if (s.bark.mark) { s.bark.mark.rgb.forEach((v) => inR(v, 0, 1, "mark.rgb")); inR(s.bark.mark.chance, 0, 1, "mark.chance"); }
    assert.match(s.leaf.color, /^#[0-9a-f]{6}$/i);
    assert.ok(typeof s.label === "string" && s.label.length > 0);
  }
  assert.equal(new Set(keys.map((k) => SP.SPECIES[k].leaf.color)).size, keys.length, "every species has its own leaf colour");
  assert.equal(new Set(keys.map((k) => SP.SPECIES[k].bark.base.join())).size, keys.length, "every species has its own bark colour");
  assert.equal(new Set(keys.map((k) => [SP.SPECIES[k].trunkLen, SP.SPECIES[k].trunkR, SP.SPECIES[k].pitchMin, SP.SPECIES[k].childLen].join())).size, keys.length, "every species grows differently");
  for (const k of ["oak", "birch", "maple", "pine", "willow", "cherry", "acacia", "baobab", "redwood", "aspen"]) assert.ok(SP.SPECIES[k], `the ten named kinds: ${k}`);
  assert.ok(SP.SPECIES.baobab.trunkR > 1.5 * SP.SPECIES.birch.trunkR && SP.SPECIES.redwood.trunkLen > 1.5 * SP.SPECIES.baobab.trunkLen, "baobab fat and short, redwood tall");
  assert.equal(SP.SPECIES.pine.azimuthRule, "whorl");
  assert.equal(SP.parseSpeciesKey(" OAK "), "oak");
  for (const bad of ["", "banana", "toString", "__proto__", "constructor", "oak\u0000", null, undefined, 5, {}]) assert.equal(SP.parseSpeciesKey(bad), null, `not a species: ${String(bad)}`);
  assert.equal(SP.speciesFor("abc", 3), SP.speciesFor("abc", 3), "deterministic");
  assert.equal(SP.speciesFor("abc", 3, "Willow"), "willow", "an override wins (case-insensitive)");
  assert.equal(SP.speciesFor("abc", 3, "nonsense"), SP.speciesFor("abc", 3), "an invalid override is ignored");
  assert.ok(keys.includes(SP.speciesFor("x", -5)) && keys.includes(SP.speciesFor("x", NaN)) && keys.includes(SP.speciesFor("", 1e12)));
  {
    // variety: 6 top-level folders -> >= 4 kinds; any 4 neighbours differ; deterministic; same for random ids
    let seed = 99;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let trial = 0; trial < 150; trial++) {
      const ids = Array.from({ length: 6 + (trial % 20) }, () => "n" + Math.floor(rnd() * 1e9).toString(36));
      const a = SP.speciesForest(ids), b = SP.speciesForest(ids);
      assert.deepEqual(a, b, "deterministic");
      assert.ok(new Set(a.eff.slice(0, 6)).size >= 4, `6 trees -> ${new Set(a.eff.slice(0, 6)).size} kinds`);
      for (let i = 0; i + 3 < a.eff.length; i++) assert.equal(new Set(a.eff.slice(i, i + 4)).size, 4, "4 neighbours all differ");
    }
    const lay6 = L.layoutTree(mk(forest(6)));
    assert.ok(new Set(trunksOf(lay6).map((b) => b.species)).size >= 4, "six trees of a layout: >= 4 species");
    assert.ok(lay6.world.branches.get("root").species === "oak", "the hub is oak by default");
  }
  {
    // inheritance, override label (case-insensitive), invalid label ignored, root label = hub only
    const sub = [{ id: "A", kids: [...notesN("a", 3), { id: "B", kids: [...notesN("b", 2), { id: "D", kids: notesN("d", 2) }] }, { id: "C", kids: notesN("c", 2) }] }, ...forest(2).map((f, i) => ({ ...f, id: "O" + i }))];
    const plain = L.layoutTree(mk(sub));
    const sA = plain.world.branches.get("A").species;
    for (const id of ["B", "C", "D"]) assert.equal(plain.world.branches.get(id).species, sA, `${id} inherits its tree's species`);
    assert.equal(plain.info.get("B").calc.species, sA);
    const other = keys.find((k) => k !== sA && k !== "pine");
    const lab = L.layoutTree(mk([{ ...sub[0], kids: sub[0].kids.map((k) => k.id === "B" ? { ...k, labels: { biblio_species: " PINE " } } : k) }, ...sub.slice(1)]));
    assert.equal(lab.world.branches.get("B").species, "pine", "a sub-folder may override (case-insensitive)");
    assert.equal(lab.world.branches.get("D").species, "pine", "and its descendants inherit that");
    assert.equal(lab.world.branches.get("C").species, sA, "siblings keep the tree's species");
    assert.equal(lab.info.get("B").calc.species, sA, "calc.species ignores the folder's own label");
    assert.ok(lab.info.get("B").overridden.has("species") && !lab.info.get("C").overridden.has("species"));
    assert.equal(lab.info.get("D").calc.species, "pine", "a child's calculated species is the inherited one");
    const top = L.layoutTree(mk(sub.map((k) => k.id === "A" ? { ...k, labels: { biblio_species: other.toUpperCase() } } : k)));
    assert.equal(top.world.branches.get("A").species, other);
    for (const id of ["B", "C", "D"]) assert.equal(top.world.branches.get(id).species, other, "a tree's label inherits down");
    assert.equal(top.info.get("A").calc.species, sA, "the automatic pick stays visible as calc");
    const bad = L.layoutTree(mk(sub.map((k) => k.id === "A" ? { ...k, labels: { biblio_species: "banana" } } : k)));
    assert.equal(bad.world.branches.get("A").species, sA, "an invalid species label is ignored");
    assert.ok(!bad.info.get("A").overridden.has("species"));
    const rootLab = L.layoutTree(mk(sub, { biblio_species: "willow" }));
    assert.equal(rootLab.world.branches.get("root").species, "willow", "a label on the root styles the hub");
    assert.equal(rootLab.world.branches.get("A").species, sA, "and does not reach the trees");
    // leaf colour: the species colour only when the note has neither #color nor a tag
    const lc = L.layoutTree(mk([{ id: "T", labels: { biblio_species: "cherry" }, kids: [{ id: "p" }, { id: "c", labels: { color: "#112233" } }, { id: "t", labels: { topic: "" } }] }]));
    const col = (id) => lc.leaves.find((l) => l.id === id).color;
    assert.equal(col("p"), SP.SPECIES.cherry.leaf.color);
    assert.equal(col("c"), "#112233", "#color first");
    assert.equal(col("t"), lib.stableColor("topic"), "a tag next");
  }
  // every species lays out finitely, on a vault with several levels
  {
    const t = mk([
      { id: "A", kids: [...notesN("a", 5), { id: "B", kids: [...notesN("b", 4), { id: "D", kids: [...notesN("d", 3), { id: "E", kids: notesN("e", 2) }] }] }, { id: "C", kids: notesN("c", 9) }] },
      ...forest(3, 12, [{ id: "Q", kids: notesN("q", 3) }]),
    ]);
    for (const k of keys) {
      const ly = L.layoutTree(t, { overrides: force(t, k) });
      noNaN(ly, k);
      for (const b of ly.world.branches.values()) assert.ok(b.pts.every((p) => p.y > -40), `${k}/${b.id}: above ground`);
      for (const b of ly.world.branches.values()) assert.equal(b.species, b.id === "root" ? "oak" : k);
      assert.ok(minGap(ly) >= 3, `${k}: trunks apart`);
    }
  }

  // ---- editable + recalculable properties ----
  assert.deepEqual(L.PROP_KEYS, ["length", "thickness", "taper", "spin", "pitch", "attach", "bend", "species", "wave", "waveFreq", "waveFn"]);
  assert.deepEqual(L.PROP_LABELS, { length: "biblio_blen", thickness: "biblio_bthick", taper: "biblio_btaper", spin: "biblio_bspin", pitch: "biblio_bpitch", attach: "biblio_bat", bend: "biblio_bbend", species: "biblio_species", wave: "biblio_bwave", waveFreq: "biblio_bwfreq", waveFn: "biblio_bwfn" });
  for (const [k, v] of Object.entries(L.PROP_LABELS)) {
    assert.equal(v, v.toLowerCase());
    assert.ok(v.startsWith("biblio_") && !/[.\-]/.test(v), "lower-case biblio_ names without dots/hyphens");
    assert.ok(lib.NOISE_LABELS.has(v), `${k}: ${v} never becomes a shelf`);
  }
  assert.ok(lib.NOISE_LABELS.has(cfg.LABELS.leafAt) && cfg.LABELS.leafAt === "biblio_lat");
  for (const [k, r] of Object.entries(L.PROP_RANGES)) assert.ok(fin(r.min, r.max, r.step) && r.min < r.max && r.step > 0 && typeof r.unit === "string", `PROP_RANGES.${k}`);
  assert.deepEqual(Object.keys(L.PROP_RANGES).sort(), ["attach", "bend", "length", "pitch", "spin", "taper", "thickness", "wave", "waveFreq"]);

  const treeSpec = () => [
    { id: "A", kids: [...notesN("a", 4), { id: "B", kids: [...notesN("b", 4), { id: "D", kids: notesN("d", 3) }] }, { id: "C", kids: notesN("c", 3) }] },
    ...forest(2).map((f, i) => ({ ...f, id: "O" + i })),
  ];
  const withLabels = (labelsById) => mk(treeSpec().map(function relabel(n) { return { ...n, labels: { ...(n.labels ?? {}), ...(labelsById[n.id] ?? {}) }, kids: n.kids?.map(relabel) }; }));
  const ref = L.layoutTree(withLabels({}));
  for (const [id, x] of ref.info) {
    assert.deepEqual(x.eff, x.calc, `${id}: no override -> eff == calc`);
    assert.equal(x.overridden.size, 0);
  }
  const bB = (ly) => ly.world.branches.get("B");
  const calcB = JSON.stringify(ref.info.get("B").calc);
  const withB = (labels) => L.layoutTree(withLabels({ B: labels }));
  for (const [label, key, val] of [
    ["biblio_blen", "length", "700"], ["biblio_bthick", "thickness", "30"], ["biblio_btaper", "taper", "0.8"], ["biblio_bspin", "spin", "200"],
    ["biblio_bpitch", "pitch", "95"], ["biblio_bat", "attach", "0.4"], ["biblio_bbend", "bend", "0.9"], ["biblio_species", "species", ref.info.get("B").calc.species === "pine" ? "oak" : "pine"],
  ]) {
    const ly = withB({ [label]: val });
    const x = ly.info.get("B");
    assert.ok(x.overridden.has(key) && x.overridden.size === 1, `${key}: marked overridden`);
    assert.equal(String(x.eff[key]), key === "species" ? val : String(Number(val)), `${key}: applied`);
    assert.equal(x.calc.species, ref.info.get("B").calc.species);
    if (key !== "species") assert.equal(JSON.stringify(x.calc), calcB, `${key}: calc is not touched by its own override`);
    // the geometry follows eff; "recalculate" (a null) gives back exactly the reference
    const reset = L.layoutTree(withLabels({ B: { [label]: val } }), { overrides: new Map([["B", { [key]: null }]]) });
    assert.equal(dump(reset), dump(ref), `${key}: null forces the calculated value (label ignored)`);
    assert.equal(dump(L.layoutTree(withLabels({}))), dump(ref), `${key}: removing the label restores the layout`);
    noNaN(ly, key);
  }
  { // what each property does
    const lenL = withB({ biblio_blen: "700" });
    assert.ok(bB(lenL).total > 700 * 0.85 && bB(lenL).total < 700 * 1.4, `length applied (${bB(lenL).total.toFixed(0)})`);
    assert.ok(W.dist(lenL.world.branches.get("D").pts[0], ref.world.branches.get("D").pts[0]) > 1, "descendants move when the parent's length changes");
    assert.ok(Math.abs(L.layoutTree(withLabels({ B: { biblio_blen: "1e30" } })).info.get("B").eff.length - 9000) < 1e-9, "huge length is clamped");
    assert.equal(withB({ biblio_blen: "-5" }).info.get("B").eff.length, 20, "tiny/negative length is clamped");
    const th = withB({ biblio_bthick: "40" });
    assert.equal(bB(th).r, 40);
    assert.ok(Math.abs(bB(th).rEnd - 40 * ref.info.get("B").calc.taper) < 1e-9, "taper keeps its ratio on a thicker branch");
    assert.equal(withB({ biblio_bthick: "1000" }).info.get("B").eff.thickness, 150);
    const tp = withB({ biblio_btaper: "0.8" });
    assert.ok(Math.abs(bB(tp).rEnd - 0.8 * bB(tp).r) < 1e-9);
    assert.equal(withB({ biblio_btaper: "5" }).info.get("B").eff.taper, 1);
    assert.equal(withB({ biblio_btaper: "0.01" }).info.get("B").eff.taper, 0.05);
    for (const [v, want] of [["-90", 270], ["450", 90], ["360", 0], ["-0", 0], ["720.5", 0.5]]) assert.equal(withB({ biblio_bspin: v }).info.get("B").eff.spin, want, `spin ${v} wraps to ${want}`);
    assert.ok(Object.is(withB({ biblio_bspin: "-0" }).info.get("B").eff.spin, 0), "-0 becomes 0");
    const startDir = (ly) => { const b = bB(ly); return W.norm(W.sub(b.pts[Math.min(6, b.pts.length - 1)], b.pts[0])); };
    const angTo = (ly) => { const par = ly.world.branches.get("A"); return Math.acos(W.dot(startDir(ly), W.frameAt(par, bB(ly).attachS).t)); };
    assert.ok(angTo(withB({ biblio_bpitch: "10" })) < angTo(withB({ biblio_bpitch: "100" })), "a bigger pitch leaves the parent at a wider angle");
    assert.equal(withB({ biblio_bpitch: "500" }).info.get("B").eff.pitch, 110);
    assert.ok(W.dist(startDir(withB({ biblio_bspin: "0", biblio_bpitch: "80" })), startDir(withB({ biblio_bspin: "180", biblio_bpitch: "80" }))) > 0.8, "spin turns the branch around its parent");
    assert.ok(W.dist(withB({ biblio_bspin: "0" }).world.branches.get("D").pts.at(-1), withB({ biblio_bspin: "180" }).world.branches.get("D").pts.at(-1)) > 50, "descendants follow a spin change");
    assert.ok(W.dist(withB({ biblio_bpitch: "10" }).world.branches.get("D").pts.at(-1), withB({ biblio_bpitch: "100" }).world.branches.get("D").pts.at(-1)) > 50, "descendants follow a pitch change");
    const at = withB({ biblio_bat: "0.3" });
    assert.ok(Math.abs(bB(at).attachS - 0.3 * at.world.branches.get("A").total) < 1e-9, "attach = fraction of the parent");
    assert.ok(W.dist(bB(at).pts[0], W.frameAt(at.world.branches.get("A"), bB(at).attachS).p) < 1.5, "and it grows out of the parent there");
    assert.equal(withB({ biblio_bat: "7" }).info.get("B").eff.attach, 0.97);
    assert.equal(withB({ biblio_bat: "-7" }).info.get("B").eff.attach, 0.03);
    const tipY = (v) => bB(withB({ biblio_bbend: v })).pts.at(-1).y;
    assert.ok(tipY("1") > tipY("0") && tipY("0") > tipY("-1"), "bend lifts / droops the tip");
    assert.equal(withB({ biblio_bbend: "9" }).info.get("B").eff.bend, 1);
    // a trunk ignores attach; trunk spin/pitch steer the arch around the hub; the hub takes length/thickness/taper/species only
    const aTrunk = L.layoutTree(withLabels({ A: { biblio_bat: "0.2", biblio_bspin: "0", biblio_bpitch: "85" } }));
    assert.equal(aTrunk.world.branches.get("A").attachS, undefined);
    assert.ok(!aTrunk.info.get("A").overridden.has("attach") && aTrunk.info.get("A").eff.attach === 1);
    const zOf = (spin) => { const b = L.layoutTree(withLabels({ A: { biblio_bspin: spin, biblio_bpitch: "85" } })).world.branches.get("A"); return b.pts[8].z - b.pts[0].z; };
    assert.ok(zOf("0") > 20 && zOf("180") < -20, "trunk spin 0 leans towards +z, 180 towards -z");
    const hubL = L.layoutTree(mk(treeSpec(), { biblio_blen: "300", biblio_bspin: "90", biblio_bpitch: "40", biblio_bat: "0.5", biblio_bbend: "1", biblio_bthick: "60" }));
    const h2 = hubL.world.branches.get("root");
    assert.ok(Math.abs(h2.total - 300) < 1e-6 && h2.r === 60);
    assert.deepEqual([...hubL.info.get("root").overridden].sort(), ["length", "thickness"], "the hub ignores spin/pitch/attach/bend");
    assert.ok(hubL.world.branches.get("A").pts[0].y === 300, "trunks start at the hub's new end");
    // other trees do not move when one branch is edited
    const edited = withB({ biblio_blen: "900", biblio_bspin: "10" });
    for (const id of ["O0", "O1"]) assert.equal(JSON.stringify(edited.world.branches.get(id).pts), JSON.stringify(ref.world.branches.get(id).pts), `${id} untouched`);
    // explicit entries beat labels; invalid explicit values are ignored (the label stays)
    const ex = L.layoutTree(withLabels({ B: { biblio_blen: "500" } }), { overrides: new Map([["B", { length: 800 }]]) });
    assert.equal(ex.info.get("B").eff.length, 800, "explicit beats the label");
    const exBad = L.layoutTree(withLabels({ B: { biblio_blen: "500" } }), { overrides: new Map([["B", { length: "junk", pitch: NaN, spin: Infinity }]]) });
    assert.equal(exBad.info.get("B").eff.length, 500, "an invalid explicit value falls back to the label");
    assert.ok(!exBad.info.get("B").overridden.has("pitch"));
    const exSp = L.layoutTree(withLabels({}), { overrides: new Map([["B", { species: "BAOBAB" }], ["nope", { length: 5 }]]) });
    assert.equal(exSp.world.branches.get("B").species, "baobab", "explicit species");
    // every numeric property: calc never moves with its own override (all branches, a spread of values)
    for (const id of ["A", "B", "C", "D"]) for (const key of ["length", "thickness", "taper", "spin", "pitch", "attach", "bend"]) {
      for (const v of [L.PROP_RANGES[key].min, (L.PROP_RANGES[key].min + L.PROP_RANGES[key].max) / 2, L.PROP_RANGES[key].max]) {
        const ly = L.layoutTree(withLabels({}), { overrides: new Map([[id, { [key]: v }]]) });
        assert.equal(JSON.stringify(ly.info.get(id).calc), JSON.stringify(ref.info.get(id).calc), `${id}.${key}=${v}: calc unchanged`);
        noNaN(ly, `${id}.${key}=${v}`);
      }
    }
  }

  // ---- parseOverrides: tolerant ----
  {
    const one = (label, v) => L.parseOverrides({ noteId: "x", title: "x", type: "text", labels: { [label]: v }, hasChildren: true });
    assert.deepEqual(one("biblio_blen", "250"), { length: 250 });
    assert.deepEqual(one("biblio_bthick", " 12,5 "), { thickness: 12.5 }, "comma decimal, trimmed");
    assert.deepEqual(one("biblio_blen", "1e2"), { length: 100 });
    assert.deepEqual(one("biblio_blen", "+300"), { length: 300 });
    assert.deepEqual(one("biblio_bbend", ".5"), { bend: 0.5 });
    assert.deepEqual(one("biblio_blen", "1e30"), { length: 9000 }, "huge but finite: clamped");
    assert.deepEqual(one("biblio_species", " Oak "), { species: "oak" });
    for (const [label, v] of [["biblio_blen", "1e999"], ["biblio_blen", "-1e999"], ["biblio_blen", "1e5000"], ["biblio_bspin", "Infinity"], ["biblio_bspin", "NaN"], ["biblio_bbend", "--1"], ["biblio_blen", "9".repeat(1000)], ["biblio_blen", "٣٠٠"], ["biblio_blen", "３００"], ["biblio_blen", "0x10"], ["biblio_blen", "1_000"], ["biblio_blen", "12px"], ["biblio_blen", ""], ["biblio_blen", "   "], ["biblio_blen", "e5"], ["biblio_blen", "1e"], ["biblio_blen", "."], ["biblio_blen", "+"], ["biblio_blen", "1 2"], ["biblio_blen", "1,2,3"], ["biblio_blen", "\u0000"], ["biblio_blen", "🙂"], ["biblio_blen", "null"], ["biblio_species", "banana"], ["biblio_species", "__proto__"], ["biblio_species", "constructor"], ["biblio_species", ""]]) {
      assert.deepEqual(one(label, v), {}, `ignored: ${label}=${JSON.stringify(v).slice(0, 30)}`);
    }
    assert.ok(Object.is(one("biblio_bspin", "-0").spin, 0));
    assert.ok(Object.is(one("biblio_bbend", "-0").bend, 0));
    for (const odd of [null, undefined, {}, { labels: null }, { labels: undefined }, { labels: 5 }, { labels: { biblio_blen: 5 } }, { labels: { biblio_blen: null } }, { labels: { biblio_blen: {} } }, { labels: { biblio_blen: [] } }, { labels: { biblio_species: 7 } }]) {
      assert.doesNotThrow(() => L.parseOverrides(odd));
    }
    // fuzz: whatever the labels hold, the result is finite and in range, and a layout with those labels is clean
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const alphabet = ["0", "1", "2", "5", "9", ".", ",", "e", "E", "+", "-", " ", "\t", "x", "٣", "€", "🙂", "\u0000", "\n", "a"];
    const rstr = () => Array.from({ length: Math.floor(rnd() * 14) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
    for (let n = 0; n < 1500; n++) {
      const labels = {};
      for (const lb of Object.values(L.PROP_LABELS)) labels[lb] = rstr();
      const out = L.parseOverrides({ noteId: "x", title: "x", type: "text", labels, hasChildren: true });
      for (const [k, v] of Object.entries(out)) {
        if (k === "species") assert.ok(SP.SPECIES[v]);
        else assert.ok(fin(v) && v >= L.PROP_RANGES[k].min && (v <= L.PROP_RANGES[k].max) && !(k === "spin" && v >= 360) && !Object.is(v, -0), `${k}=${v} from ${JSON.stringify(labels[L.PROP_LABELS[k]])}`);
      }
    }
    const junk = {};
    for (const id of ["A", "B", "C", "D", "O0", "O1"]) { junk[id] = {}; for (const lb of Object.values(L.PROP_LABELS)) junk[id][lb] = rstr(); }
    for (let n = 0; n < 40; n++) {
      for (const id of Object.keys(junk)) for (const lb of Object.keys(junk[id])) junk[id][lb] = n % 3 === 0 ? ["1e999", "-1e999", "1e30", "-1e30", "0", "-0", "NaN"][Math.floor(rnd() * 7)] : rstr();
      noNaN(L.layoutTree(withLabels(junk)), `junk labels #${n}`);
    }
    // extreme but valid values everywhere
    const ext = {};
    for (const id of ["A", "B", "C", "D", "O0", "O1", "root"]) ext[id] = { biblio_blen: "20", biblio_bthick: "150", biblio_btaper: "0.2", biblio_bspin: "359.99", biblio_bpitch: "110", biblio_bat: "0.03", biblio_bbend: "-1" };
    const ex1 = L.layoutTree(withLabels(ext));
    noNaN(ex1, "extreme low/high");
    for (const id of Object.keys(ext)) for (const k of Object.keys(ext[id])) ext[id][k] = { biblio_blen: "9000", biblio_bthick: "3", biblio_btaper: "1", biblio_bspin: "0", biblio_bpitch: "0", biblio_bat: "0.97", biblio_bbend: "1" }[k];
    noNaN(L.layoutTree(withLabels(ext)), "extreme opposite");
  }

  // ---- leaf placement: biblio_lat ----
  {
    const pins = (labels) => mk([{ id: "T", labels: { biblio_species: "maple" }, kids: [{ id: "p0", labels }, ...notesN("q", 6)] }]);
    const free = L.layoutTree(pins({}));
    const tb = free.world.branches.get("T");
    const get = (ly, id) => ly.leaves.find((l) => l.id === id);
    const pin = L.layoutTree(pins({ biblio_lat: "0.5, 90" }));
    assert.ok(Math.abs(get(pin, "p0").s - 0.5 * tb.total) < 1e-9 && Math.abs(get(pin, "p0").th - Math.PI / 2) < 1e-9, "pinned leaf: s fraction, th degrees (0 = top)");
    const wrap = L.layoutTree(pins({ biblio_lat: "2,-90" }));
    assert.ok(Math.abs(get(wrap, "p0").s - (tb.total - 8)) < 1e-9 && Math.abs(get(wrap, "p0").th + Math.PI / 2) < 1e-9, "s clamps onto the branch, th wraps");
    assert.ok(get(L.layoutTree(pins({ biblio_lat: "-3,0" })), "p0").s > 0, "s never leaves the branch's start");
    for (const bad of ["abc", "0.5", "0.5,", ",1", "0.5,1,2", "NaN,1", "1e999,3", "", "0.5;x"]) {
      assert.deepEqual(get(L.layoutTree(pins({ biblio_lat: bad })), "p0"), get(free, "p0"), `invalid pin ignored: ${JSON.stringify(bad)}`);
    }
    for (const id of ["q0", "q1", "q5"]) assert.deepEqual(get(pin, id), get(free, id), "unpinned leaves keep the usual rows placement");
    assert.deepEqual(L.parseLeafAt({ labels: { biblio_lat: "0.25 ; 45" } }), { s: 0.25, th: 45 });
    assert.equal(L.parseLeafAt({ labels: {} }), null);
    assert.equal(L.parseLeafAt(null), null);
  }

  // ---- determinism, cycles, clones, depth, perf ----
  {
    const t = withLabels({ B: { biblio_blen: "500", biblio_species: "willow" }, O0: { biblio_bspin: "40" } });
    assert.equal(dump(L.layoutTree(t)), dump(L.layoutTree(t)), "layout is deterministic (JSON-equal twice)");
    // clone: folder C also under O0; a cycle: D lists A as a child; the root listed under B
    const cl = withLabels({});
    cl.edges.push({ parentNoteId: "O0", noteId: "C", notePosition: 0 }, { parentNoteId: "D", noteId: "A", notePosition: 0 }, { parentNoteId: "B", noteId: "root", notePosition: 0 }, { parentNoteId: "root", noteId: "root", notePosition: 0 });
    cl.notes.D.hasChildren = true;
    const cly = L.layoutTree(cl);
    assert.equal([...cly.world.branches.keys()].filter((id) => id === "C").length, 1, "a clone is grown once");
    assert.equal(cly.parentOf.get("C"), "A", "under its first parent");
    noNaN(cly, "clone/cycle");
    assert.equal(dump(cly), dump(L.layoutTree(cl)));
    // deep chain: MAX_DEPTH keeps lengths and radii sane
    let chain = [{ id: "leafy", kids: notesN("z", 2) }];
    for (let d = 40; d > 0; d--) chain = [{ id: "c" + d, kids: [...notesN("k" + d, 1), ...chain] }];
    const dl = L.layoutTree(mk(chain));
    noNaN(dl, "chain 40");
    assert.equal(dl.world.branches.size, 42);
    // perf: a very wide fan with some overrides; many trees
    const wide = mk(Array.from({ length: 133 }, (_, i) => ({ id: "w" + i, kids: [{ id: "wn" + i + "a" }, { id: "wn" + i + "b" }, { id: "ws" + i, kids: [{ id: "wm" + i }] }] })));
    const t0 = performance.now();
    const wl = L.layoutTree(wide, { overrides: new Map([["w5", { length: 900, spin: 33 }]]) });
    assert.ok(performance.now() - t0 < 1000, `133 trees lay out in < 1s (${(performance.now() - t0).toFixed(0)} ms)`);
    assert.equal(trunksOf(wl).length, 133);
    noNaN(wl, "133 trees");
    assert.ok(minGap(wl) >= 3, "133 trees: bases apart");
    const tt = performance.now();
    for (let i = 0; i < 20; i++) L.layoutTree(withLabels({}));
    assert.ok(performance.now() - tt < 1000, "a small forest re-lays out fast enough for a live editor (20 layouts < 1s)");
  }
}
// 19. Yggdrasil: the ant REACHES (never jumps), the jumping spider, spider silk (drop / let down / swing / let go, climbable threads that
//     survive world rebuilds until reload), who may use threads, and the review fixes (climbTarget while flying, feet after landing,
//     underside take-off, cat cling limit, take-off from a slip fall)
{
  const W = await bundle("src/tree/world3.ts", "w3g.mjs");
  const L = await bundle("src/tree/layout.ts", "layout3g.mjs");
  // sim3 + silk in ONE bundle: the thread store SILKS is module state, so the sim and the test must see the same instance
  const entry = join(dir, "entry19.ts");
  writeFileSync(entry, `export * from ${JSON.stringify(join(process.cwd(), "src/tree/sim3.ts"))};\nexport * from ${JSON.stringify(join(process.cwd(), "src/tree/silk.ts"))};\n`);
  const S = await bundle(entry, "s3g.mjs");
  const idle = S.NO_INPUT;
  const A = (id) => S.ANIMALS.find((x) => x.id === id);
  const fin = (...xs) => xs.every(Number.isFinite);
  const run = (w, c, input, secs, dt = 1 / 60) => { for (let t = 0; t < secs - 1e-9; t += dt) S.step(w, c, input, dt); };
  const straight = (id, pts, r) => W.makeBranch(id, W.smoothPath(pts), r);
  const bodyLen = (a) => Math.max(...a.nodes.map((n) => n.d));
  const hold = { ...idle, reach: true };
  const underside = (c, th = Math.PI) => { c.head.th = th; for (const t of c.trail) if (t.surf) t.surf.th = th; };
  const sky = (ground = -3000) => { // a long branch alone in the sky
    const w = { branches: new Map(), groundY: ground };
    W.addBranch(w, straight("a", [W.v3(0, 0, 0), W.v3(1500, 0, 0), W.v3(3000, 0, 0)], 40));
    return w;
  };
  const pair = () => { // `a` with a parallel branch `g` 250 px below it
    const w = sky();
    W.addBranch(w, straight("g", [W.v3(0, -250, 0), W.v3(1500, -250, 0), W.v3(3000, -250, 0)], 40));
    return w;
  };
  const mkTree = (spec) => {
    const notes = {}, edges = [];
    const add = (id, parent, kids) => {
      notes[id] = { noteId: id, title: id, type: "text", labels: {}, hasChildren: !!kids };
      if (parent) edges.push({ parentNoteId: parent, noteId: id, notePosition: 0 });
      (kids ?? []).forEach((k) => add(k.id, id, k.kids));
    };
    add("root", null, spec);
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const tree19 = () => mkTree([
    { id: "f1", kids: [{ id: "n001" }, { id: "n002" }, { id: "f1a", kids: [{ id: "n003" }, { id: "f1b", kids: [{ id: "n005" }] }] }] },
    { id: "f2", kids: Array.from({ length: 20 }, (_, i) => ({ id: "m" + i })) },
    { id: "f3", kids: [{ id: "f3a", kids: [{ id: "n006" }] }, { id: "f3b", kids: [{ id: "n007" }] }] },
  ]);
  let seed = 19191919;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  S.clearSilks();

  // --- the animals: ant reaches, spider has silk, jumping spider = small, dark + orange-red, strong leap ---
  {
    const ant = A("ant"), sp = A("spider"), ju = A("jumper"), sn = A("snake");
    assert.equal(S.ANIMALS[0].id, "lizard", "the lizard stays first");
    assert.equal(ant.leap, null);
    assert.ok(ant.reach && Math.abs(ant.reach.max - 130 * 0.55) < 1e-9 && Math.abs(ant.reach.speed - 130 * 0.55) < 1e-9, "ant reach 130 x 0.55");
    assert.ok(bodyLen(ant) < 14 && ant.reach.max / bodyLen(ant) > 5, "a 12 px ant reaches ~6 body lengths");
    assert.equal(sp.leap, null);
    assert.ok(sp.silk && sp.clings && !sp.reach, "spider: silk, clings, no leap, no reach");
    assert.ok(Math.abs(sp.silk.maxLen - 300 * 1.6) < 1e-9 && Math.abs(sp.silk.reel - 60 * 1.6) < 1e-9 && Math.abs(sp.silk.pump - 170 * 1.6) < 1e-9, "scaled() scales the silk spec");
    assert.ok(ju.leap && ju.silk && ju.clings && ju.legs.length === 8 && sp.legs.length === 8 && !ju.reach, "jumper: leap + silk + clings + eight legs");
    assert.equal(ju.name, "Jumping spider");
    assert.ok(ju.body === "#2b2330" && ju.belly === "#c4552a" && ju.colors.length === ju.nodes.length && ju.colors.includes("#c4552a"), "dark body, orange-red abdomen");
    assert.ok(ju.body !== sp.body && ju.belly !== sp.belly, "a different colour scheme from the spider");
    assert.ok(bodyLen(ju) < bodyLen(sp) * 0.75 && bodyLen(ju) > bodyLen(sp) * 0.6, `jumper ~0.7 x spider (${(bodyLen(ju) / bodyLen(sp)).toFixed(2)})`);
    assert.deepEqual(S.ANIMALS.filter((x) => x.silk).map((x) => x.id).sort(), ["jumper", "spider"], "silk = the spiders");
    assert.deepEqual(S.ANIMALS.filter((x) => x.leap).map((x) => x.id).sort(), ["cat", "jumper", "lizard", "squirrel"], "leap = lizard, cat, squirrel, jumper");
    assert.deepEqual(S.ANIMALS.filter((x) => x.reach).map((x) => x.id).sort(), ["ant", "snake"], "reach = ant, snake");
    assert.deepEqual(S.ANIMAL_CATEGORIES.map((x) => x.ids), [["ant", "spider", "jumper", "snake"], ["lizard", "cat"], ["squirrel", "bee", "dragonfly", "bluejay"]]);
    const pick = (n, id) => S.ANIMALS[S.animalForKey(n, id)].id;
    let cur = "lizard";
    assert.deepEqual([1, 2, 3, 4, 5].map(() => (cur = pick(1, cur))), ["ant", "spider", "jumper", "snake", "ant"], "key 1 cycles through the crawlers");
    // who may walk on threads
    const may = Object.fromEntries(S.ANIMALS.map((x) => [x.id, S.canUseThreads(x)]));
    assert.deepEqual(may, { lizard: false, snake: false, ant: true, cat: false, squirrel: false, spider: true, bee: true, dragonfly: true, bluejay: false, jumper: true });
  }

  // --- Space: crawlers never aim; ant / snake reach, spider does nothing; lizard / cat / squirrel / jumper aim ---
  {
    const w = sky();
    for (const id of ["ant", "spider", "snake"]) {
      const c = S.spawn(w, A(id), "a", 500);
      S.step(w, c, { ...hold, leap: true }, 1 / 60);
      run(w, c, hold, 0.4);
      assert.equal(c.aim, null, `${id}: never aims`);
      assert.equal(c.air, null, `${id}: never jumps`);
      assert.equal(S.leapPreview(w, c), null);
      if (id === "spider") assert.ok(c.reach === null && c.head.s === 500 && c.speedNow === 0, "spider: Space does nothing");
      else assert.ok(c.reach && c.reach.len > 5, `${id}: Space reaches`);
      const t = S.spawn(w, A(id), "a", 500); // a one-frame tap
      S.step(w, t, { ...idle, leap: true }, 1 / 60);
      run(w, t, idle, 0.5);
      assert.ok(t.air === null && t.aim === null && t.reach === null, `${id}: a tap does nothing`);
    }
    for (const id of ["lizard", "cat", "squirrel", "jumper"]) {
      const c = S.spawn(w, A(id), "a", 500);
      S.step(w, c, { ...hold, leap: true }, 1 / 60);
      run(w, c, hold, 0.3);
      assert.ok(c.aim && c.air === null && c.reach === null, `${id}: Space aims`);
      assert.ok(S.leapPreview(w, c)?.points.length > 5, `${id}: with a preview`);
    }
  }

  // --- ant reach: extends, steerable, bridges a 50 px gap, retracts, grip rule, never jumps ---
  {
    const ant = A("ant"), max = ant.reach.max;
    const aw = { branches: new Map(), groundY: -3000 };
    W.addBranch(aw, straight("a", [W.v3(0, 0, 0), W.v3(250, 0, 0), W.v3(500, 0, 0)], 10));
    W.addBranch(aw, straight("g", [W.v3(550, 0, 0), W.v3(800, 0, 0), W.v3(1100, 0, 0)], 10)); // starts 50 px beyond a's end
    // extends to `max` and holds there; the trail keeps the history the tail needs
    let c = S.spawn(aw, ant, "a", 200);
    S.step(aw, c, { ...hold, leap: true }, 1 / 60);
    assert.ok(c.reach && c.air === null && c.aim === null, "Space reaches, no jump");
    run(aw, c, hold, 0.4);
    assert.ok(c.reach.len > 20 && c.reach.len < max, `extending (${c.reach.len.toFixed(1)})`);
    run(aw, c, hold, 3);
    assert.ok(Math.abs(c.reach.len - max) < 1e-6 && max < 80, `holds at max (${c.reach.len.toFixed(1)} of ${max.toFixed(1)})`);
    assert.ok(c.air === null && c.grip === 1 && S.bodyOnTop(aw, c), "reaching from the top: the rear holds on, no fall");
    assert.ok(c.trail[0].D <= c.D - (c.reach.len + bodyLen(ant)), "the trail keeps the tail's history for a 12 px animal");
    assert.ok(W.dist(S.bodyPoint(c, 0).p, S.bodyPoint(c, bodyLen(ant)).p) > bodyLen(ant) * 0.7, "the body is stretched along the reach, not piled up");
    // retracts when released, back where it started
    run(aw, c, idle, 3);
    assert.equal(c.reach, null, "released: pulled back in");
    assert.ok(c.head.b === "a" && Math.abs(c.head.s - 200) < 1e-6);
    assert.ok(W.dist(S.bodyPoint(c, 0).p, S.bodyPoint(c, bodyLen(ant)).p) > bodyLen(ant) * 0.7, "tail not piled up after retracting");
    // steerable: D yaws right (+z), A left, W pitches up, S down
    const steer = (input) => { const d = S.spawn(aw, ant, "a", 200); S.step(aw, d, hold, 1 / 60); run(aw, d, { ...hold, ...input }, 0.5); return d.reach.dir; };
    assert.ok(steer({ right: true }).z > 0.3 && steer({ left: true }).z < -0.3, "A/D yaw the reach");
    assert.ok(steer({ forward: true }).y > 0.3 && steer({ back: true }).y < -0.3, "W/S pitch the reach");
    // bridges a 50 px gap
    c = S.spawn(aw, ant, "a", 495);
    for (let t = 0; t < 3 && c.head.b === "a"; t += 1 / 60) S.step(aw, c, hold, 1 / 60);
    assert.equal(c.head.b, "g", "the ant bridged the 50 px gap");
    assert.ok(c.reach === null && c.air === null, "landed on the far branch");
    // a gap wider than its reach: no bridge, it holds at max and falls back in when released
    const far = { branches: new Map([["a", aw.branches.get("a")], ["g", straight("g", [W.v3(700, 0, 0), W.v3(1000, 0, 0), W.v3(1200, 0, 0)], 10)]]), groundY: -3000 };
    c = S.spawn(far, ant, "a", 495);
    run(far, c, hold, 2);
    assert.ok(c.head.b === "a" && c.reach && Math.abs(c.reach.len - max) < 1e-6, "a 200 px gap is out of reach");
    // grip rule: hanging underneath it only holds on while some part is on top; from the underside the reach slips in ~3 s
    const lw = sky();
    c = S.spawn(lw, ant, "a", 500);
    underside(c);
    S.step(lw, c, hold, 1 / 60);
    assert.ok(c.reach && !S.bodyOnTop(lw, c), "reaching from the underside: nothing on top");
    let slipAt = -1;
    for (let i = 0; i < 60 * 8 && slipAt < 0; i++) { S.step(lw, c, hold, 1 / 60); if (c.air) slipAt = i / 60; }
    assert.ok(c.air && c.air.slip && slipAt > 2 && slipAt < 4.5, `the ant slips from the underside (${slipAt.toFixed(1)} s)`);
    c = S.spawn(lw, ant, "a", 500);
    c.gripOn = false;
    underside(c);
    run(lw, c, hold, 6);
    assert.ok(c.air === null && c.reach, "grip off: never falls");
  }

  // --- jumper: a strong leap for its size (>= 12 body lengths on the flat, far more than lizard / cat relative to size), with the aim logic ---
  {
    const w = { branches: new Map([["a", straight("a", [W.v3(0, 0, 0), W.v3(2000, 0, 0), W.v3(4000, 0, 0)], 40)]]), groundY: -4000 };
    const jump = (id) => {
      const c = S.spawn(w, A(id), "a", 500);
      const p0 = W.surfacePoint(w.branches.get("a"), 500, 0).p;
      S.startLeap(w, c);
      assert.ok(c.air, `${id} leaps`);
      run(w, c, idle, 4);
      assert.equal(c.air, null, `${id} landed`);
      const p1 = W.surfacePoint(w.branches.get("a"), c.head.s, c.head.th).p;
      const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      return { d, bl: d / bodyLen(A(id)) };
    };
    const ju = jump("jumper"), lz = jump("lizard"), ct = jump("cat");
    assert.ok(ju.bl >= 12, `jumper covers ${ju.bl.toFixed(1)} body lengths (>= 12)`);
    assert.ok(ju.bl > ct.bl * 1.5 && ju.bl > lz.bl * 3, `relative to size: jumper ${ju.bl.toFixed(1)} vs cat ${ct.bl.toFixed(1)}, lizard ${lz.bl.toFixed(1)}`);
    // the full aim logic: hold to aim, steer, release launches along the aim
    const c = S.spawn(w, A("jumper"), "a", 500);
    S.step(w, c, { ...hold, leap: true }, 1 / 60);
    run(w, c, { ...hold, right: true }, 0.3);
    assert.ok(c.aim.yaw > 0.3, "A/D turn the aim");
    run(w, c, hold, 1);
    const pv = S.leapPreview(w, c);
    assert.ok(pv && pv.points.length > 8 && pv.assisted === false);
    S.step(w, c, idle, 1 / 60);
    assert.ok(c.air && c.air.v.z > 0, "released: leaps to the right of the heading");
    // X is ignored while aiming
    const d = S.spawn(w, A("jumper"), "a", 500);
    S.step(w, d, { ...hold, leap: true }, 1 / 60);
    S.step(w, d, { ...hold, silk: true }, 1 / 60);
    assert.ok(d.aim && d.silk === null, "X does nothing while aiming");
  }

  // --- silk: drop, let down, reel up, swing, let go, land (bridge), climb, persist ---
  for (const id of ["spider", "jumper"]) {
    const sp = A(id), sk = sp.silk;
    S.clearSilks();
    const fw = sky();
    const anchorOf = (w, s = 1000, th = Math.PI) => W.surfacePoint(w.branches.get("a"), s, th).p;
    const drop = (w, s = 1000, th = Math.PI) => { const c = S.spawn(w, sp, "a", s); underside(c, th); S.step(w, c, { ...idle, silk: true }, 1 / 60); return c; };

    // drop from the underside: hangs on the rope under the anchor
    let c = S.spawn(fw, sp, "a", 1000);
    underside(c);
    assert.equal(S.silkPoints(c), null, "no rope while perched");
    S.step(fw, c, { ...idle, silk: true }, 1 / 60);
    assert.ok(c.silk && c.air === null && c.flight === null && c.reach === null && c.aim === null, `${id}: X drops`);
    assert.ok(Math.abs(c.silk.len - 10) < 1e-9 && W.dist(c.silk.anchor, anchorOf(fw)) < 1e-6);
    assert.deepEqual(c.head, { b: "a", s: 1000, th: Math.PI }, "the head keeps the perch it dropped from");
    assert.equal(c.trail[c.trail.length - 1].surf, null, "trail samples leave the surface");
    run(fw, c, idle, 2);
    const rope = S.silkPoints(c);
    assert.ok(rope && W.dist(rope.anchor, anchorOf(fw)) < 1e-6, "silkPoints: anchor on the branch");
    assert.ok(Math.abs(rope.p.x - rope.anchor.x) < 1 && Math.abs(rope.p.y - (rope.anchor.y - 10)) < 1.5, "hangs straight down");
    assert.equal(c.grip, 1);
    const basis = S.dangleBasis(c);
    assert.ok(Math.abs(basis.fwd.y) < 1e-9 && Math.abs(W.len(basis.fwd) - 1) < 1e-9 && basis.up.y === 1, "dangleBasis: horizontal facing, world up");
    // the body trails the head (it hangs along the rope it came down)
    assert.ok(fin(...[0, 5, 20].flatMap((d) => { const p = S.bodyPoint(c, d).p; return [p.x, p.y, p.z]; })));
    // animals without silk ignore X
    const lz = S.spawn(fw, A("lizard"), "a", 1000);
    S.step(fw, lz, { ...idle, silk: true }, 1 / 60);
    assert.ok(lz.silk === null && lz.air === null, "lizard: X does nothing");
    const an = S.spawn(fw, A("ant"), "a", 1000);
    S.step(fw, an, { ...idle, silk: true }, 1 / 60);
    assert.ok(an.silk === null, "ant: X does nothing");

    // S lets the rope out at `reel` px/s, up to maxLen
    c = drop(fw);
    run(fw, c, { ...idle, back: true }, 1);
    assert.ok(Math.abs(c.silk.len - (10 + sk.reel)) < 1.5, `${id}: S lets down ${sk.reel.toFixed(0)} px/s (${c.silk.len.toFixed(1)})`);
    run(fw, c, { ...idle, back: true }, 12);
    assert.ok(Math.abs(c.silk.len - sk.maxLen) < 1e-6, "stops at maxLen");
    assert.ok(Math.abs(c.silk.p.y - (c.silk.anchor.y - sk.maxLen)) < 3, "hangs at the end of the rope");
    // W reels in, 1.3 x as fast; fully reeled = back on the perch, no thread kept
    c.silk.len = 150;
    run(fw, c, { ...idle, forward: true }, 0.5);
    assert.ok(Math.abs(c.silk.len - (150 - 1.3 * sk.reel * 0.5)) < 1.5, `W reels up 1.3 x (${c.silk.len.toFixed(1)})`);
    for (let i = 0; i < 60 * 8 && c.silk; i++) S.step(fw, c, { ...idle, forward: true }, 1 / 60);
    assert.ok(c.silk === null && c.air === null, "reeled all the way up: climbs back");
    assert.deepEqual(c.head, { b: "a", s: 1000, th: Math.PI }, "back on the anchor surface");
    assert.ok(c.trail[c.trail.length - 1].surf !== null && c.feet.every((f) => f.at.b === "a" && S.surfaceDist(fw, f.at, c.head) < 3 * bodyLen(sp)), "feet on the branch again");
    assert.equal(S.SILKS.length, 0, "no thread kept");
    assert.ok([...fw.branches.values()].every((b) => !b.silk));
    run(fw, c, { ...idle, forward: true }, 1);
    assert.ok(c.head.s > 1000 && c.air === null, "walks on");

    // a drop from the TOP slides off the side as the rope is let out (it does not just stand on the branch)
    c = drop(fw, 1000, 0);
    run(fw, c, { ...idle, back: true }, 5);
    assert.ok(c.silk && c.silk.p.y < -45, `top drop hangs below the branch (${c.silk?.p.y.toFixed(0)})`);

    // ground clamp: never within 10 px of the ground, however it swings
    const gw = sky(-100);
    c = drop(gw);
    for (let i = 0; i < 60 * 8; i++) {
      S.step(gw, c, { ...idle, back: true, right: i % 90 < 45, reach: true }, 1 / 60);
      if (c.silk) assert.ok(c.silk.p.y >= -100 + 10 - 1e-6 && c.silk.len <= 50 + 1e-6, `ground clamp (${c.silk.p.y.toFixed(1)}, len ${c.silk.len.toFixed(1)})`);
    }
    assert.ok(c.silk, "still hanging just over the ground");

    // swing: Space pumps along the facing, A/D swing sideways and turn the facing
    c = drop(fw);
    c.silk.len = 200;
    run(fw, c, idle, 3);
    const still = Math.abs(c.silk.p.x - c.silk.anchor.x);
    assert.ok(still < 3, "an idle spider hangs still");
    const fwd0 = S.dangleBasis(c).fwd;
    assert.ok(fwd0.x > 0.99, "facing = the heading (+x)");
    let vMax = 0, xMax = 0, aligned = true;
    for (let i = 0; i < 60 * 1.5; i++) {
      S.step(fw, c, { ...idle, reach: true }, 1 / 60);
      vMax = Math.max(vMax, c.silk.v.x);
      xMax = Math.max(xMax, c.silk.p.x - c.silk.anchor.x);
      if (i > 20 && i < 40 && !(c.silk.v.x > 0.8 * W.len(c.silk.v))) aligned = false;
    }
    assert.ok(vMax > 60 && xMax > 40, `Space pumps the swing forward (v ${vMax.toFixed(0)}, x ${xMax.toFixed(0)})`);
    assert.ok(aligned, "the pump pushes along the facing");
    c = drop(fw);
    c.silk.len = 200;
    run(fw, c, idle, 3);
    run(fw, c, { ...idle, right: true }, 0.5);
    assert.ok(c.silk.yaw > 0.5 && c.silk.v.z > 20, `D turns the facing and swings to the right (yaw ${c.silk.yaw.toFixed(2)}, vz ${c.silk.v.z.toFixed(0)})`);
    c = drop(fw);
    c.silk.len = 200;
    run(fw, c, idle, 3);
    run(fw, c, { ...idle, left: true }, 0.5);
    assert.ok(c.silk.yaw < -0.5 && c.silk.v.z < -20, "A: the other way");

    // let go: leave the rope with the current velocity, the thread freezes as it hangs (free end), the spider doesn't re-land on it
    S.clearSilks();
    c = drop(fw);
    c.silk.len = 100;
    run(fw, c, idle, 2);
    run(fw, c, { ...idle, reach: true }, 0.7);
    const vBefore = { ...c.silk.v }, pBefore = { ...c.silk.p }, anchor = { ...c.silk.anchor };
    S.step(fw, c, { ...idle, silk: true }, 1 / 60);
    assert.ok(c.silk === null && c.air && c.air.slip === false, "X again: let go -> airborne, not a slip");
    assert.ok(W.dist(c.air.v, vBefore) < 1e-9 && W.dist(c.air.p, pBefore) < 1e-9, "with the rope's velocity");
    const th1 = fw.branches.get("silk:1");
    assert.ok(th1 && th1.silk === true && th1.parent === "a" && Math.abs(th1.attachS - 1000) < 1e-9 && th1.endLink === undefined && th1.species === undefined, "a free thread branch");
    assert.ok(fw.branches.get("a").side.includes("silk:1") && th1.r === 2.5 && th1.rEnd === 2.5);
    assert.ok(S.SILKS.length === 1 && S.SILKS[0].id === "silk:1" && S.SILKS[0].end.kind === "free" && S.SILKS[0].ref.b === "a");
    assert.ok(W.dist(th1.pts[0], anchor) < 1e-6 && W.dist(th1.pts[th1.pts.length - 1], pBefore) < 1e-6, "from the anchor to where the rope ended");
    run(fw, c, idle, 0.6);
    assert.ok(c.air && c.head.b === "a" && c.air.p.y < pBefore.y, "falls on, not caught by its own thread");
    // a thread is something a spider can land on, a lizard cannot (a mid-air creature at the thread's middle)
    const mid = th1.pts[1];
    const airAt = (who) => { const d = S.spawn(fw, A(who), "a", 200); d.air = { p: { ...mid }, v: W.v3(0, 0, 0), t: 0.5, from: { b: "a", s: 200, th: 0 }, ignore: 0, slip: false }; S.step(fw, d, idle, 1 / 60); return d; };
    assert.equal(airAt(id).head.b, "silk:1", `${id} lands on a thread`);
    assert.equal(airAt("ant").head.b, "silk:1", "ant too");
    for (const who of ["lizard", "cat", "squirrel"]) { const d = airAt(who); assert.ok(d.air && d.head.b === "a", `${who} ignores the thread`); }
    // the spider hanging at the end of a free thread climbs back up it: stand at its base, Shift
    const base = S.spawn(fw, sp, "a", 1000);
    underside(base);
    assert.equal(S.climbTarget(fw, base)?.id, "silk:1", "climbTarget: the thread you stand under");
    assert.equal(S.climbTarget(fw, S.spawn(fw, A("lizard"), "a", 1000)), null, "lizard: no thread to climb");
    run(fw, base, { ...idle, forward: true, climb: true }, 1 / 60);
    assert.equal(base.head.b, "silk:1");
    run(fw, base, { ...idle, forward: true }, 4);
    assert.ok(base.head.b === "silk:1" && Math.abs(base.head.s - th1.total) < 1e-6, "walks down to the free end and stops there");

    // land on another branch while on the rope: the thread becomes a BRIDGE between the two (climbable both ways)
    S.clearSilks();
    const pw = pair();
    c = drop(pw);
    for (let i = 0; i < 60 * 5 && c.silk; i++) S.step(pw, c, { ...idle, back: true }, 1 / 60);
    assert.ok(c.silk === null && c.air === null && c.head.b === "g", `${id}: lowered itself onto the branch below`);
    const bridge = pw.branches.get("silk:1");
    assert.ok(bridge && bridge.silk && bridge.parent === "a" && bridge.endLink && bridge.endLink.b === "g" && Math.abs(bridge.endLink.s - c.head.s) < 1e-6, "bridge thread with endLink");
    assert.ok(pw.branches.get("a").side.includes("silk:1") && pw.branches.get("g").side.includes("silk:1"), "in both branches' side lists");
    assert.ok(Math.abs(bridge.total - 166) < 8, `thread length ${bridge.total.toFixed(0)}`);
    assert.ok(W.dist(bridge.pts[bridge.pts.length - 1], W.surfacePoint(pw.branches.get("g"), c.head.s, c.head.th).p) < 1e-6, "ends at the landing spot");
    assert.ok(S.SILKS.length === 1 && S.SILKS[0].end.kind === "surface" && S.SILKS[0].end.ref.b === "g");
    // climbTarget while standing at the thread's end; null while flying / hanging
    assert.equal(S.climbTarget(pw, c)?.id, "silk:1");
    // walk up (Shift, then W), down the other side, and back down: both directions
    const stepsOk = (w, cc, input, maxFrames, until) => {
      let prev = S.bodyPoint(cc, 0).p, jump = 0;
      for (let i = 0; i < maxFrames && !until(); i++) {
        S.step(w, cc, input, 1 / 60);
        const p = S.bodyPoint(cc, 0).p;
        jump = Math.max(jump, W.dist(p, prev));
        prev = p;
        assert.ok(fin(cc.head.s, cc.head.th, cc.phi), "finite while crossing");
      }
      return jump;
    };
    let jump = stepsOk(pw, c, { ...idle, forward: true, climb: true }, 6, () => c.head.b === "silk:1");
    assert.ok(c.head.b === "silk:1" && Math.abs(c.head.s - bridge.total) < 1e-6 && Math.abs(Math.abs(c.phi) - Math.PI) < 1e-6, "Shift at the thread's end: onto it, facing up the thread");
    jump = Math.max(jump, stepsOk(pw, c, { ...idle, forward: true }, 60 * 4, () => c.head.b !== "silk:1"));
    assert.ok(c.head.b === "a" && Math.abs(c.head.s - 1000) < 3 && Math.cos(c.head.th) < -0.9, `walked up the thread onto the branch (${c.head.b} s ${c.head.s.toFixed(0)})`);
    assert.ok(c.threadCool > 0, "walking off a thread's end cools down re-entry (Shift held would bounce back)");
    stepsOk(pw, c, idle, 40, () => false);
    assert.equal(c.threadCool, 0);
    c.head.s = 1000; c.speedNow = 0; // back on the anchor spot (the walk glided a little past it)
    jump = Math.max(jump, stepsOk(pw, c, { ...idle, forward: true, climb: true }, 6, () => c.head.b === "silk:1"));
    assert.ok(c.head.b === "silk:1" && c.head.s < 1e-6 && Math.abs(c.phi) < 1e-6, "Shift at the anchor: onto the thread, facing down it");
    jump = Math.max(jump, stepsOk(pw, c, { ...idle, forward: true }, 60 * 4, () => c.head.b !== "silk:1"));
    assert.ok(c.head.b === "g" && Math.abs(c.head.s - bridge.endLink.s) < 1 && Math.abs(c.head.th) < 0.2, "walked down the thread onto the lower branch");
    assert.ok(jump < sp.speed * 0.2, `no teleports while crossing (biggest step ${jump.toFixed(1)} px)`);
    // the ant can use it too (a tiny animal), the lizard / cat / snake / jay cannot
    for (const who of ["ant", "lizard", "cat", "snake", "bluejay"]) {
      const d = S.spawn(pw, A(who), "g", bridge.endLink.s);
      const want = who === "ant" ? "silk:1" : null;
      assert.equal(S.climbTarget(pw, d)?.id ?? null, want, `${who}: climbTarget`);
      run(pw, d, { ...idle, forward: true, climb: true }, 0.2);
      assert.equal(d.head.b === "silk:1" ? "silk:1" : null, want, `${who}: Shift ${want ? "climbs" : "walks past"} the thread`);
    }
    // let go above the other branch: lands there, no second thread
    S.clearSilks();
    const pw2 = pair();
    c = drop(pw2);
    c.silk.len = 100;
    run(pw2, c, idle, 1);
    S.step(pw2, c, { ...idle, silk: true }, 1 / 60);
    run(pw2, c, idle, 2);
    assert.ok(c.air === null && c.silk === null && c.head.b === "g", "let go above a branch: lands on it");
    assert.ok(S.SILKS.length === 1 && S.SILKS[0].end.kind === "free", "still just the free thread");
  }

  // --- threads: survive world rebuilds until reload (applySilks), anchors that are gone are skipped, they follow edits ---
  {
    S.clearSilks();
    const lay1 = L.layoutTree(tree19());
    const w1 = lay1.world;
    const big = [...w1.branches.values()].filter((b) => !b.silk && b.total > 150);
    assert.ok(big.length >= 3, "layout has branches to hang from");
    const [b1, b2, b3] = big;
    const t1 = S.addSilk(w1, { id: S.newSilkId(), ref: { b: b1.id, s: 100, th: 0.4 }, end: { kind: "free", dx: 0, dy: -120, dz: 0 } });
    const t2 = S.addSilk(w1, { id: S.newSilkId(), ref: { b: b2.id, s: 90, th: 1.0 }, end: { kind: "surface", ref: { b: b3.id, s: 80, th: -0.5 } } });
    assert.ok(t1 && t2 && t1.id === "silk:1" && t2.id === "silk:2" && S.SILKS.length === 2, "two threads stored");
    assert.ok(t2.endLink.b === b3.id && b2.side.includes("silk:2") && b3.side.includes("silk:2") && b1.side.includes("silk:1"));
    assert.equal(S.addSilk(w1, { id: "x", ref: { b: "nope", s: 0, th: 0 }, end: { kind: "free", dx: 0, dy: -50, dz: 0 } }), null, "unknown anchor: nothing");
    assert.equal(S.addSilk(w1, { id: "y", ref: { b: b1.id, s: 100, th: 0 }, end: { kind: "free", dx: 1, dy: 0, dz: 0 } }), null, "degenerate (shorter than 8 px): nothing");
    assert.equal(S.SILKS.length, 2);
    const lay2 = L.layoutTree(tree19()); // a rebuilt world: the threads are gone from it
    assert.ok([...lay2.world.branches.values()].every((b) => !b.silk));
    assert.equal(S.applySilks(lay2.world), 2, "applySilks re-creates both");
    for (const id of ["silk:1", "silk:2"]) {
      const a = w1.branches.get(id), b = lay2.world.branches.get(id);
      assert.ok(b && b.silk && b.parent === a.parent && b.attachS === a.attachS && W.dist(b.pts[0], a.pts[0]) < 1e-6 && W.dist(b.pts[b.pts.length - 1], a.pts[a.pts.length - 1]) < 1e-6, `${id} rebuilt identically`);
    }
    assert.equal(S.applySilks(lay2.world), 2, "applySilks is idempotent");
    assert.equal([...lay2.world.branches.values()].filter((b) => b.silk).length, 2);
    assert.equal(lay2.world.branches.get(b1.id).side.filter((x) => x === "silk:1").length, 1, "not listed twice");
    // anchors that no longer exist are skipped (the record stays: it may come back)
    const w3 = { branches: new Map([["other", straight("other", [W.v3(0, 0, 0), W.v3(500, 0, 0), W.v3(900, 0, 0)], 20)]]), groundY: 0 };
    assert.equal(S.applySilks(w3), 0, "anchor branch gone: skipped");
    assert.equal(S.SILKS.length, 2);
    const w4 = { branches: new Map([[b1.id, straight(b1.id, [W.v3(0, 0, 0), W.v3(30, 0, 0), W.v3(50, 0, 0)], 20)], [b2.id, lay2.world.branches.get(b2.id)], [b3.id, lay2.world.branches.get(b3.id)]]), groundY: 0 };
    assert.equal(S.applySilks(w4), 1, "an anchor arc length that no longer exists is skipped (only the second thread is built)");
    assert.ok(w4.branches.has("silk:2") && !w4.branches.has("silk:1"));
    // positions follow edits: the same branch ids, moved
    const moved = { branches: new Map(), groundY: 0 };
    for (const b of [b1, b2, b3]) W.addBranch(moved, W.makeBranch(b.id, b.pts.map((p) => W.add(p, W.v3(500, 40, -70))), b.r, b.parent, b.attachS, b.rEnd));
    assert.equal(S.applySilks(moved), 2);
    const m1 = moved.branches.get("silk:1");
    assert.ok(W.dist(m1.pts[0], W.add(w1.branches.get("silk:1").pts[0], W.v3(500, 40, -70))) < 1e-6, "the thread moved with its branch");
    // a creature still walks a rebuilt bridge
    const wb = lay2.world;
    const walker = S.spawn(wb, A("spider"), b2.id, 90);
    walker.head.th = 1.0;
    assert.equal(S.climbTarget(wb, walker)?.id, "silk:2", "climbable after the rebuild");
    S.clearSilks();
    assert.equal(S.SILKS.length, 0);
    assert.equal(S.applySilks(L.layoutTree(tree19()).world), 0, "clearSilks forgets everything");
  }

  // --- fuzz: random X / W / S / A / D / Space / Shift for thousands of frames: finite, above ground, rope sane, never lost ---
  {
    const worlds = () => [[W.makeDemoWorld(), "trunk", 300, "demo"], [L.layoutTree(tree19()).world, [...L.layoutTree(tree19()).world.branches.keys()][1], 100, "layout"]];
    for (const [w, bid, s0, wname] of worlds()) {
      S.clearSilks();
      for (const id of ["spider", "jumper", "ant", "lizard", "bee"]) {
        const a = A(id);
        const c = S.spawn(w, a, bid, s0);
        let held = { ...idle }, left = 0, drops = 0, landedRope = 0, wasRope = false, threadsMax = 0;
        for (let i = 0; i < 5000; i++) {
          if (left-- <= 0) {
            left = 6 + Math.floor(rnd() * 70);
            held = { ...idle, forward: rnd() < 0.5, back: rnd() < 0.35, left: rnd() < 0.3, right: rnd() < 0.3, reach: rnd() < 0.4, climb: rnd() < 0.2 };
          }
          const dt = rnd() < 0.03 ? 0.05 + rnd() * 0.1 : 1 / 60;
          S.step(w, c, { ...held, silk: rnd() < 0.03, leap: rnd() < 0.04 && !c.flight }, dt);
          assert.ok(fin(c.head.s, c.head.th, c.phi, c.speedNow, c.D, c.grip, c.shake), `${wname}/${id} frame ${i}: finite state`);
          assert.ok(w.branches.has(c.head.b), `${wname}/${id}: head on a real branch`);
          const p = S.bodyPoint(c, 0).p;
          assert.ok(fin(p.x, p.y, p.z), `${wname}/${id} frame ${i}: finite position`);
          if (c.silk) {
            const d = c.silk;
            if (!wasRope) drops++;
            assert.ok(fin(d.p.x, d.p.y, d.p.z, d.v.x, d.v.y, d.v.z, d.len, d.yaw, d.t), `${wname}/${id} frame ${i}: finite rope`);
            assert.ok(d.len > 6 && d.len <= a.silk.maxLen + 1e-6, `${wname}/${id}: rope length ${d.len}`);
            assert.ok(d.p.y >= (w.groundY ?? -2500) + 10 - 1e-6, `${wname}/${id}: above the ground (${d.p.y})`);
            assert.ok(W.dist(d.p, d.anchor) <= d.len + 80, `${wname}/${id}: within the rope (${W.dist(d.p, d.anchor).toFixed(1)} of ${d.len.toFixed(1)})`);
            assert.ok(c.air === null && c.flight === null && c.reach === null && c.aim === null, "dangling excludes the other states");
          }
          if (wasRope && !c.silk && c.air === null && c.head.b.startsWith("silk:") === false) landedRope++;
          wasRope = !!c.silk;
          if (c.air) assert.ok(fin(c.air.p.x, c.air.p.y, c.air.p.z, c.air.v.x, c.air.v.y, c.air.v.z), "finite air");
          threadsMax = Math.max(threadsMax, S.SILKS.length);
          if (id === "lizard" || id === "ant" || id === "bee") assert.ok(c.silk === null, `${id} never dangles`);
        }
        if (a.silk) assert.ok(drops > 5, `${wname}/${id}: the fuzz exercised the rope (${drops} drops)`);
      }
      assert.ok(S.SILKS.length > 0, `${wname}: threads were spun`);
      // everything the fuzz spun is a valid branch
      for (const b of w.branches.values()) if (b.silk) assert.ok(b.pts.every((q) => fin(q.x, q.y, q.z)) && b.total >= 8 && b.r === 2.5);
    }
    S.clearSilks();
  }

  // --- review fixes ---
  {
    // (a) climbTarget is null while flying (the HUD showed 'Shift climb' in the air), and while reaching / airborne
    const dw = W.makeDemoWorld();
    let spot = -1;
    for (let s = 900; s < 1100 && spot < 0; s += 4) if (S.climbTarget(dw, S.spawn(dw, A("lizard"), "trunk", s))) spot = s;
    assert.ok(spot > 0, "found a side-branch base on the demo trunk");
    const bee = S.spawn(dw, A("bee"), "trunk", spot);
    assert.ok(S.climbTarget(dw, bee), "perched at the base: Shift would climb");
    S.step(dw, bee, { ...idle, leap: true }, 1 / 60);
    assert.ok(bee.flight && S.climbTarget(dw, bee) === null, "flying: no climb hint");
    const lizA = S.spawn(dw, A("lizard"), "trunk", spot);
    S.startLeap(dw, lizA);
    assert.equal(S.climbTarget(dw, lizA), null, "airborne: none");

    // (b) land() / the recovery put the feet next to the head (they stayed at the old perch, legs stretched for a few frames)
    const bw = pair();
    const footsOk = (cc, label) => cc.feet.forEach((f, i) => {
      const leg = cc.animal.legs[i];
      assert.ok(f.at.b === cc.head.b && S.surfaceDist(bw, f.at, cc.head) < bodyLen(cc.animal) + 2 * cc.animal.stride + cc.animal.splay, `${label}: foot ${i} ${f.at.b}/${S.surfaceDist(bw, f.at, cc.head).toFixed(0)} from the head, leg node ${leg.node}`);
    });
    for (const id of ["lizard", "cat", "jumper"]) {
      const c = S.spawn(bw, A(id), "a", 600);
      c.air = { p: W.surfacePoint(bw.branches.get("g"), 900, 0.3, 2).p, v: W.v3(60, -300, 0), t: 0.5, from: { b: "a", s: 600, th: 0 }, ignore: 0, slip: false };
      S.step(bw, c, idle, 1 / 60);
      assert.ok(c.air === null && c.head.b === "g", `${id} landed on g`);
      footsOk(c, `${id} after landing`);
    }
    const rc = S.spawn(bw, A("lizard"), "a", 600);
    rc.air = { p: W.v3(0, 9000, 0), v: W.v3(0, 0, 0), t: 3, from: { b: "a", s: 600, th: 0 }, ignore: 0, slip: false };
    S.step(bw, rc, idle, 1 / 60);
    assert.ok(rc.air === null && rc.head.b === "a", "recovery: back on the origin");
    footsOk(rc, "recovery");

    // (c) take-off from the UNDERSIDE of a branch with Space held: no hop down and re-land after 0.35 s
    const uw = sky();
    for (const id of ["bee", "dragonfly"]) {
      const c = S.spawn(uw, A(id), "a", 500);
      underside(c);
      S.step(uw, c, { ...hold, leap: true }, 1 / 60);
      assert.ok(c.flight, `${id}: took off`);
      const r = 40, m = Math.max(3, A(id).nodes[0].w * 0.8);
      for (let i = 0; i < 60 * 2.5; i++) {
        S.step(uw, c, hold, 1 / 60);
        assert.ok(c.flight, `${id}: still flying at ${(i / 60).toFixed(2)} s (no re-landing on the branch it left)`);
        const n = W.nearestOnBranch(uw.branches.get("a"), c.flight.p);
        assert.ok(n.dist >= r + m - 0.05, `${id}: deflected, never inside the bark`);
      }
      run(uw, c, { ...idle, climb: true, reach: false }, 1.2); // Shift = down (and land): moves away from the origin, then it has cleared it
      assert.ok(c.flight.cleared || !c.flight, `${id}: cleared the origin`);
      if (c.flight) {
        run(uw, c, { ...idle, reach: true }, 2); // now up into the branch it left: it lands like on any other
        assert.equal(c.flight, null, `${id}: once clear the origin lands it again`);
      }
    }
    // the jay still takes off from the top and flies off as before
    const jy = S.spawn(uw, A("bluejay"), "a", 500);
    S.step(uw, jy, { ...idle, leap: true }, 1 / 60);
    run(uw, jy, idle, 1);
    assert.ok(jy.flight && jy.flight.cleared, "the jay cleared its perch");

    // (d) the cat's cling limit holds right after a junction transfer / a landing (no sideways snap next frame)
    const cw = { branches: new Map(), groundY: -3000 };
    W.addBranch(cw, straight("t", [W.v3(0, 0, 0), W.v3(500, 0, 0), W.v3(1000, 0, 0)], 20));
    W.addBranch(cw, W.makeBranch("climb", W.smoothPath([W.v3(500, 0, 0), W.v3(500, 200, 0), W.v3(500, 500, 0)]), 30, "t", 500));
    const cat = S.spawn(cw, A("cat"), "t", 499);
    cat.head.th = -1;
    for (const t of cat.trail) if (t.surf) t.surf.th = -1;
    assert.equal(S.climbTarget(cw, cat)?.id, "climb", "the cat stands in the climb's base");
    let before = S.bodyPoint(cat, 0).p;
    S.step(cw, cat, { ...idle, forward: true, climb: true }, 1 / 60);
    assert.equal(cat.head.b, "climb");
    assert.ok(Math.abs(cat.head.th) <= 1.2 + 1e-9 && fin(cat.phi), `right after the transfer: th ${cat.head.th.toFixed(2)} within the limit`);
    const th0 = cat.head.th, p0 = S.bodyPoint(cat, 0).p;
    S.step(cw, cat, idle, 1 / 60);
    assert.ok(Math.abs(cat.head.th - th0) < 0.05 && W.dist(S.bodyPoint(cat, 0).p, p0) < 3, "no sideways snap on the next frame");
    assert.ok(W.dist(p0, before) < 40, "the transfer moved the cat only a little");
    const lw = sky();
    const cat2 = S.spawn(lw, A("cat"), "a", 500);
    cat2.air = { p: W.v3(500, -39, 0), v: W.v3(30, -20, 0), t: 0.5, from: { b: "a", s: 100, th: 0 }, ignore: 0, slip: false };
    S.step(lw, cat2, idle, 1 / 60);
    assert.ok(cat2.air === null && Math.abs(cat2.head.th) <= 1.2 + 1e-9 && fin(cat2.phi), `landing under the branch: th clamped (${cat2.head.th.toFixed(2)})`);

    // (e) a perched flier whose grip ran out can still take off while it falls
    for (const id of ["bee", "dragonfly", "bluejay"]) {
      const c = S.spawn(uw, A(id), "a", 800);
      underside(c);
      let i = 0;
      for (; i < 60 * 6 && !(c.air && c.air.slip); i++) S.step(uw, c, idle, 1 / 60);
      assert.ok(c.air && c.air.slip, `${id}: the grip ran out`);
      run(uw, c, idle, 0.2);
      const p = { ...c.air.p }, v = { ...c.air.v };
      S.step(uw, c, { ...idle, leap: true }, 1 / 60);
      assert.ok(c.flight && c.air === null, `${id}: Space while falling opens the wings`);
      assert.ok(W.dist(c.flight.p, p) < 20 && fin(c.flight.yaw, c.flight.pitch, c.flight.speed), `${id}: from the falling position`);
      if (A(id).flight.kind === "wing") assert.ok(c.flight.speed >= A(id).flight.stall - 1e-6, "wing flier: at least its stall speed");
      else assert.ok(Math.abs(c.flight.v.y - v.y) < 200, "hover flier keeps the falling velocity (it eases to the input)");
      run(uw, c, idle, 1);
      assert.ok(c.flight || c.head.b === "a", `${id}: keeps flying (or lands)`);
    }
    // a non-flier's slip is unchanged, and a slip with Space does nothing for a lizard
    const lz = S.spawn(uw, A("lizard"), "a", 800);
    underside(lz);
    for (let i = 0; i < 60 * 6 && !(lz.air && lz.air.slip); i++) S.step(uw, lz, idle, 1 / 60);
    S.step(uw, lz, { ...idle, leap: true }, 1 / 60);
    assert.ok(lz.air && lz.flight === null, "lizard: still falling");
  }
}
// 20. lib/treeedit: what gets written when a branch property is edited / reset / recalculated
{
  const L = await bundle("src/tree/layout.ts", "layout20.mjs");
  const T = await bundle("src/lib/treeedit.ts", "treeedit20.mjs");
  const notes = { root: { noteId: "root", title: "root", type: "text", labels: {}, hasChildren: true }, f: { noteId: "f", title: "f", type: "text", labels: {}, hasChildren: true }, n: { noteId: "n", title: "n", type: "text", labels: {}, hasChildren: false } };
  const tree = { rootNoteId: "root", notes, edges: [{ parentNoteId: "root", noteId: "f", notePosition: 0 }, { parentNoteId: "f", noteId: "n", notePosition: 0 }], truncated: false };
  const info = L.layoutTree(tree).info.get("f");
  const calcLen = info.calc.length;
  // a different value is written; the calculated one is not
  let ch = T.planChanges(notes.f, info, { length: calcLen + 100 });
  assert.equal(ch.length, 1);
  assert.equal(ch[0].name, L.PROP_LABELS.length);
  assert.equal(ch[0].value, String(Math.round(calcLen + 100)).replace(/(\d+)/, (m) => String(Number(m))), "number stored rounded to its step");
  assert.deepEqual(T.planChanges(notes.f, info, { length: calcLen }), [], "the calculated value needs no label");
  // with a saved label: back to calculated (null) removes it; unchanged writes nothing
  const saved = { ...notes.f, labels: { [L.PROP_LABELS.length]: "500" } };
  const info2 = L.layoutTree({ ...tree, notes: { ...notes, f: saved } }).info.get("f");
  assert.ok(info2.overridden.has("length"));
  assert.deepEqual(T.planChanges(saved, info2, { length: null }).map((c) => c.value), [null]);
  assert.deepEqual(T.planChanges(saved, info2, { length: 500 }), [], "unchanged: nothing to write");
  assert.deepEqual(T.planChanges(notes.f, info, { length: null }), [], "recalculate with no label: nothing to remove");
  assert.deepEqual(T.recalcAll({ ...saved, labels: { ...saved.labels, [L.PROP_LABELS.pitch]: "40", other: "x" } }).map((c) => c.name).sort(), [L.PROP_LABELS.length, L.PROP_LABELS.pitch].sort());
  // species: the calculated kind needs no label, another one does; pending helpers
  assert.deepEqual(T.planChanges(notes.f, info, { species: info.calc.species }), []);
  assert.equal(T.planChanges(notes.f, info, { species: "birch" === info.calc.species ? "oak" : "birch" })[0].name, L.PROP_LABELS.species);
  assert.deepEqual(T.setPending({ length: 1 }, "length", undefined), {});
  assert.equal(T.formatNumber("taper", 0.5499), "0.55");
}
// 21. Trilium v0.106 sends markdown notes as type "code" + a markdown mime
{
  const C = await bundle("src/lib/content.ts", "content21.mjs");
  assert.equal(C.effectiveType("code", "text/x-markdown"), "markdown");
  assert.equal(C.effectiveType("code", "text/plain"), "code");
  assert.equal(C.effectiveType("text", "text/html"), "text");
  assert.ok(C.renderNoteContent("code", "text/x-markdown", "# Hi").html.includes("<h1"), "markdown-as-code renders as markdown");
}
// 22. review fixes: overriding one tree's species never re-skins the next trees
{
  const L = await bundle("src/tree/layout.ts", "layout22.mjs");
  const mk = (over) => {
    const notes = { root: { noteId: "root", title: "root", type: "text", labels: {}, hasChildren: true } };
    const edges = [];
    for (let i = 0; i < 8; i++) {
      notes[`t${i}`] = { noteId: `t${i}`, title: `t${i}`, type: "text", labels: over && over.id === `t${i}` ? { biblio_species: over.sp } : {}, hasChildren: true };
      notes[`n${i}`] = { noteId: `n${i}`, title: `n${i}`, type: "text", labels: {}, hasChildren: false };
      edges.push({ parentNoteId: "root", noteId: `t${i}`, notePosition: 0 }, { parentNoteId: `t${i}`, noteId: `n${i}`, notePosition: 0 });
    }
    return { rootNoteId: "root", notes, edges, truncated: false };
  };
  const base = L.layoutTree(mk(null)).info;
  for (const sp of ["maple", "cherry", "oak"]) {
    const info = L.layoutTree(mk({ id: "t0", sp })).info;
    for (let i = 1; i < 8; i++) assert.equal(info.get(`t${i}`).calc.species, base.get(`t${i}`).calc.species, `t${i} calc species unchanged when t0 is overridden to ${sp}`);
  }
}
// 23+. per-feature test files: tools/unit-<name>.mjs, each `export default async ({ bundle, assert }) => { ... }`
{
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync("tools").filter((n) => /^unit-.+\.mjs$/.test(n) && n !== "unit-test.mjs").sort()) {
    const mod = await import(pathToFileURL(join(process.cwd(), "tools", f)).href);
    await mod.default({ bundle, assert });
    console.log(`  ${f} ok`);
  }
}
console.log("unit ok");
