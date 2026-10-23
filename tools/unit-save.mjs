// Unit checks for the save (lib/save.ts, pure), the Yggdrasil data folder (lib/yggdrasil.ts) and the sync manager (state/savestore.ts)
// against the in-process fake ETAPI. Run through tools/unit-test.mjs.
import { startFake } from "./etapi-fake.mjs";

export default async ({ bundle, assert }) => {
  const SV = await bundle("src/lib/save.ts", "save-unit.mjs");
  const YG = await bundle("src/lib/yggdrasil.ts", "ygg-unit.mjs");
  const CL = await bundle("src/lib/trilium/client.ts", "client-save-unit.mjs");
  const LIB = await bundle("src/lib/library.ts", "library-save-unit.mjs");
  const CFG = await bundle("src/config.ts", "config-save-unit.mjs");

  // 1. pure: sanitize / parse / serialize
  assert.deepEqual(SV.parseSave(""), SV.emptySave());
  assert.deepEqual(SV.parseSave("not json"), SV.emptySave());
  assert.deepEqual(SV.parseSave("[1,2]"), SV.emptySave());
  assert.deepEqual(SV.sanitizeSave(null), SV.emptySave());
  {
    const hostile = {
      v: 99, updatedAt: "now",
      settings: { "biblio.v1.treeLook": "lowpoly", "biblio.v1.settings": '{"token":"SECRET"}', "evil": "x", "biblio.v1.treeCam": 5, "biblio.v1.reader": "y".repeat(5000) },
      progress: { counters: { leaves: 12.9, "bad key!": 1, neg: -4, huge: 1e30, nan: NaN, str: "7" }, unlocked: ["cat", "cat", "bad id!", 5, "x".repeat(100), "ant"], tutorial: { step: "walk", done: 1, skipped: true } },
      __proto__x: 1,
    };
    const s = SV.sanitizeSave(hostile);
    assert.equal(s.updatedAt, 0, "a non-number timestamp is 0");
    assert.deepEqual(s.settings, { "biblio.v1.treeLook": "lowpoly" }, "only allowlisted string settings of sane length (NOT the connection settings / token)");
    assert.deepEqual(s.progress.counters, { leaves: 12, neg: 0, huge: 1e9 }, "counters: integers, >= 0, bounded, sane keys");
    assert.deepEqual(s.progress.unlocked, ["cat", "ant"]);
    assert.deepEqual(s.progress.tutorial, { step: "walk", done: false, skipped: true });
    assert.ok(!JSON.stringify(s).includes("SECRET"));
    const many = SV.sanitizeSave({ progress: { counters: Object.fromEntries(Array.from({ length: 500 }, (_, i) => ["c" + i, i])), unlocked: Array.from({ length: 900 }, (_, i) => "u" + i) } });
    assert.equal(Object.keys(many.progress.counters).length, 100);
    assert.equal(many.progress.unlocked.length, 200);
  }
  {
    const a = { v: 1, updatedAt: 5, settings: { "biblio.v1.treeLook": "voxel" }, progress: { counters: { b: 2, a: 1 }, unlocked: ["z", "a"], tutorial: { step: "", done: true, skipped: false } } };
    const text = SV.serializeSave(a);
    assert.ok(text.endsWith("\n") && text.includes('"a": 1'));
    assert.deepEqual(SV.parseSave(text), SV.sanitizeSave({ ...a, progress: { ...a.progress, unlocked: ["a", "z"] } }), "round trip (the unlocked list is written sorted)");
    assert.equal(SV.serializeSave(SV.parseSave(text)), text, "serialisation is stable");
    assert.ok(text.indexOf('"a"') < text.indexOf('"b"'), "counters sorted");
  }

  // 2. merge: newer settings/tutorial win, counters max, unlocked union
  {
    const A = { v: 1, updatedAt: 100, settings: { "biblio.v1.treeLook": "voxel", "biblio.v1.treeCam": "chase" }, progress: { counters: { read: 10, walked: 3 }, unlocked: ["cat"], tutorial: { step: "walk", done: false, skipped: false } } };
    const B = { v: 1, updatedAt: 200, settings: { "biblio.v1.treeLook": "lowpoly" }, progress: { counters: { read: 4, climbed: 9 }, unlocked: ["ant"], tutorial: { step: "", done: true, skipped: false } } };
    const m = SV.mergeSave(A, B);
    assert.equal(m.updatedAt, 200);
    assert.deepEqual(m.settings, { "biblio.v1.treeLook": "lowpoly", "biblio.v1.treeCam": "chase" }, "the newer wins a conflict, the rest is kept");
    assert.deepEqual(m.progress.counters, { read: 10, walked: 3, climbed: 9 }, "counters: the larger value (progress is never lost)");
    assert.deepEqual(m.progress.unlocked.sort(), ["ant", "cat"]);
    assert.deepEqual(m.progress.tutorial, B.progress.tutorial);
    assert.deepEqual(SV.mergeSave(B, A), m, "commutative");
    assert.deepEqual(SV.mergeSave(A, A), A, "idempotent");
    assert.ok(SV.sameSave(A, { ...A, updatedAt: 999 }) && !SV.sameSave(A, B));
  }
  assert.deepEqual(SV.collectSettings((k) => ({ "biblio.v1.treeLook": "voxel", "biblio.v1.settings": "SECRET", "biblio.v1.treeCam": null }[k] ?? null)), { "biblio.v1.treeLook": "voxel" });

  // 3. the data folder + save note against the fake ETAPI
  const f = await startFake({ seed: "small" });
  try {
    const client = new CL.TriliumClient({ baseUrl: f.url, token: f.token });
    assert.equal(await YG.findYggdrasil(client), null);
    assert.equal(await YG.loadSave(client), null, "no save yet");
    const before = await LIB.walkLibraryTree(client, "root");
    const local = SV.sanitizeSave({ updatedAt: 50, settings: { "biblio.v1.treeLook": "lowpoly" }, progress: { counters: { read: 3 }, unlocked: ["cat"], tutorial: { step: "", done: false, skipped: false } } });
    const merged = await YG.storeSave(client, "root", local);
    assert.deepEqual(merged, local, "the first save is just the local save");
    const folder = await YG.findYggdrasil(client);
    const saveId = await YG.findSaveNote(client);
    assert.ok(folder && saveId);
    const fnote = await client.getNote(folder);
    assert.equal(fnote.title, "Yggdrasil");
    assert.ok(fnote.attributes.some((a) => a.name === CFG.LABELS.yggdrasil), "the folder carries the label");
    const snote = await client.getNote(saveId);
    assert.equal(snote.type, "code");
    assert.match(snote.mime, /json/);
    assert.ok(snote.attributes.some((a) => a.name === CFG.LABELS.save));
    assert.deepEqual(snote.parentNoteIds, [folder], "the save lives in the folder");
    assert.deepEqual(await YG.loadSave(client), local, "read back");
    // the walk keeps the folder (and so the save) out of the library
    const after = await LIB.walkLibraryTree(client, "root");
    assert.ok(!after.notes[folder] && !after.notes[saveId], "the walk skips the Yggdrasil folder");
    assert.equal(Object.keys(after.notes).length, Object.keys(before.notes).length, "the library is exactly what it was");
    assert.ok(!after.notes.root.labels[CFG.LABELS.yggdrasil], "(and the label is not on a library note)");
    // a second device: merging, never overwriting
    const other = SV.sanitizeSave({ updatedAt: 90, settings: { "biblio.v1.treeCam": "level" }, progress: { counters: { read: 1, walked: 8 }, unlocked: ["ant"], tutorial: { step: "", done: true, skipped: false } } });
    const m2 = await YG.storeSave(client, "root", other);
    assert.deepEqual(m2.settings, { "biblio.v1.treeLook": "lowpoly", "biblio.v1.treeCam": "level" });
    assert.deepEqual(m2.progress.counters, { read: 3, walked: 8 });
    assert.deepEqual(m2.progress.unlocked.sort(), ["ant", "cat"]);
    assert.deepEqual(await YG.loadSave(client), m2);
    assert.equal(await YG.findYggdrasil(client), folder, "the folder is reused, not duplicated");
    // a damaged save note is an empty save, not an error; renamed / moved notes are still found by label
    await client.putNoteContent(saveId, "{{{ not json");
    assert.deepEqual(await YG.loadSave(client), SV.emptySave());
    await client.patchNote?.(saveId, { title: "renamed" });
    assert.equal(await YG.findSaveNote(client), saveId);
    // a read-only client writes nothing
    const ro = new CL.TriliumClient({ baseUrl: f.url, token: f.token, readOnly: true });
    let err = null;
    try { await YG.storeSave(ro, "root", local); } catch (e) { err = e; }
    assert.ok(err && err.status === 403, "read-only: refused before any request");
    assert.deepEqual(await YG.loadSave(ro), SV.emptySave(), "(reading is fine)");
  } finally {
    await f.close();
  }

  // 4. the sync manager (localStorage shim)
  {
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k) };
    const SS = await bundle("src/state/savestore.ts", "savestore-unit.mjs");
    assert.equal(SS.syncOn(), false, "off by default");
    const f2 = await startFake({ seed: "small" });
    try {
      const client = new CL.TriliumClient({ baseUrl: f2.url, token: f2.token });
      mem.set("biblio.v1.treeLook", "lowpoly");
      mem.set("biblio.v1.settings", '{"serverUrl":"x","token":"SECRET"}');
      assert.equal(SS.dirty(), true, "never synced: dirty");
      const nothing = await SS.loadNow(client);
      assert.ok(nothing.ok && nothing.what === "nothing", "loading with nothing saved is not an error and writes nothing");
      assert.equal(await YG.findYggdrasil(client), null, "loadNow wrote nothing");
      const r = await SS.saveNow(client, "root");
      assert.ok(r.ok && r.what === "saved");
      assert.equal(SS.dirty(), false, "just synced");
      const stored = await client.getNoteContent(await YG.findSaveNote(client));
      assert.ok(stored.includes("lowpoly") && !stored.includes("SECRET") && !stored.includes("serverUrl"), "only the allowlisted settings reach the note");
      mem.set("biblio.v1.treeCam", "level");
      assert.equal(SS.dirty(), true, "a changed setting is dirty again");
      // another device changed the look in the note: loading merges it into this device's localStorage keys
      const sid = await YG.findSaveNote(client);
      await client.putNoteContent(sid, SV.serializeSave(SV.sanitizeSave({ updatedAt: Date.now() + 10000, settings: { "biblio.v1.treeLook": "voxel", "biblio.v1.settings": "SECRET" }, progress: { counters: { read: 5 }, unlocked: ["cat"], tutorial: { step: "", done: false, skipped: false } } })));
      const l = await SS.loadNow(client);
      assert.ok(l.ok && l.what === "loaded");
      assert.equal(mem.get("biblio.v1.treeLook"), "voxel", "the newer remote setting was adopted");
      assert.equal(mem.get("biblio.v1.treeCam"), "level", "a local-only setting is kept");
      assert.equal(mem.get("biblio.v1.settings"), '{"serverUrl":"x","token":"SECRET"}', "the connection settings are never touched");
      assert.equal(SS.localSave().progress.counters.read, 5, "progress came with it");
      SS.setSyncOn(true);
      assert.equal(SS.syncOn(), true);
      SS.setSyncOn(false);
      assert.equal(SS.syncOn(), false);
      const bad = await SS.saveNow(new CL.TriliumClient({ baseUrl: "http://127.0.0.1:9", token: "x" }), "root");
      assert.ok(!bad.ok && bad.message.length > 0, "an unreachable server is a result, not an exception");
    } finally {
      await f2.close();
    }
    delete globalThis.localStorage;
  }
};
