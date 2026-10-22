#!/usr/bin/env node
/**
 * tools/mock-test.mjs — tests for the Trilium mock tooling (docs: AGENTS.md "Trilium mock").
 *
 *   node tools/mock-test.mjs [--no-real] [--real-login]      (npm run test:mock)
 *
 * 1. CONFORMANCE: one suite of ETAPI assertions runs against the FAKE (tools/etapi-fake.mjs, spawned as a child
 *    process on a free port) and against the REAL mock (.bootstrap.env), recording response shapes / error
 *    bodies / defaults per target; at the end both recordings must be identical. The real mock is only touched
 *    inside its own scratch subtree ("zz mock-test <stamp>") which is deleted afterwards; no logout, no root
 *    attributes, no cycles. Real login is opt-in (--real-login): the real server rate-limits logins.
 *    The real part is skipped (not failed) when .bootstrap.env is missing or the mock is down; --no-real skips it.
 * 2. VAULT GENERATOR (fake only): profile counts, determinism, tree depth/width, label coverage, content hygiene,
 *    the HTTP apply path == the in-memory load, the app's own walkLibraryTree/captureNote on the fake,
 *    the walk caps on large/deepchain, the CLIs (etapi-fake, seed-vault incl. its refusals).
 * Never runs `npm test` things; never wipes anything.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateVault, vaultStats, PROFILES, LONGTAIL_SIZES, makePng, makePdf } from "./lib/vault-gen.mjs";
import { applyVault } from "./lib/vault-apply.mjs";
import { startFake, createStore, loadVault } from "./etapi-fake.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const args = process.argv.slice(2);
const NO_REAL = args.includes("--no-real");
const REAL_LOGIN = args.includes("--real-login");

let pass = 0, fail = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fail++; failures.push(name); console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n").join("\n        ")}`); }
}
const section = (s) => console.log(`\n== ${s} ==`);

// ---------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------

function target(name, base, token) {
  const call = async (method, path, { body, raw, headers = {}, auth = token } = {}) => {
    const h = { ...headers };
    if (auth !== null) h.Authorization = auth;
    let payload;
    if (raw) { h["Content-Type"] = raw.contentType; payload = raw.body; }
    else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = typeof body === "string" ? body : JSON.stringify(body); }
    const res = await fetch(`${base}/etapi${path}`, { method, headers: h, body: payload });
    const buf = Buffer.from(await res.arrayBuffer());
    let json;
    try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, buf, text: buf.toString("utf8"), json };
  };
  return { name, base, token, call, rec: {} };
}

/** Structural shape: keys + value kinds (arrays by the set of their element shapes; [] is a wildcard). */
function shapeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? [...new Set(v.map((x) => JSON.stringify(shapeOf(x))))].sort().map((s) => JSON.parse(s)) : [];
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shapeOf(v[k])]));
  return typeof v;
}
const errBody = (r) => ({ status: r.status, body: r.json ?? r.text });
const titles = (r) => r.json.results.map((n) => n.title).sort();

// ---------------------------------------------------------------------------------------------
// The conformance suite (runs per target)
// ---------------------------------------------------------------------------------------------

const STAMP = Date.now().toString(36); // shared by both targets so that recorded titles are comparable
async function conformance(T) {
  const { call, rec } = T;
  const stamp = STAMP;
  const word = `zzmk${stamp}`; // letters+digits only: usable as a label name AND as a search word
  const created = [];
  let scratch;
  const mk = async (parent, title, extra = {}) => {
    const r = await call("POST", "/create-note", { body: { parentNoteId: parent, title, type: "text", content: `<p>${title}</p>`, ...extra } });
    assert.equal(r.status, 201, `create-note ${title}: ${r.status} ${r.text}`);
    return r.json;
  };
  try {
    section(`conformance: ${T.name}`);

    await check("auth: missing / wrong token -> 401 NOT_AUTHENTICATED envelope; bare, Bearer and Basic tokens work", async () => {
      const none = await call("GET", "/app-info", { auth: null });
      const wrong = await call("GET", "/app-info", { auth: "definitely-not-a-token" });
      assert.equal(none.status, 401); assert.equal(wrong.status, 401);
      assert.deepEqual(none.json, { status: 401, code: "NOT_AUTHENTICATED", message: "Not authenticated" });
      rec.authErr = errBody(none);
      assert.equal((await call("GET", "/app-info", { auth: `Bearer ${T.token}` })).status, 200);
      assert.equal((await call("GET", "/app-info", { auth: `Basic ${Buffer.from(`etapi:${T.token}`).toString("base64")}` })).status, 200);
      const ok = await call("GET", "/app-info");
      assert.equal(ok.status, 200);
      assert.equal(ok.json.appVersion, "0.106.0");
      rec.appInfoKeys = Object.keys(ok.json).sort();
    });

    await check("CORS: preflight is answered without auth; every response carries Allow-Origin *", async () => {
      const pre = await call("OPTIONS", "/notes/root", { auth: null, headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "authorization,content-type" } });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get("access-control-allow-origin"), "*");
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) assert.ok(pre.headers.get("access-control-allow-methods").includes(m), `methods lack ${m}`);
      assert.ok(/authorization/i.test(pre.headers.get("access-control-allow-headers")));
      assert.ok(/content-type/i.test(pre.headers.get("access-control-allow-headers")));
      rec.cors = { methods: pre.headers.get("access-control-allow-methods"), headers: pre.headers.get("access-control-allow-headers") };
      assert.equal((await call("GET", "/notes/root", { headers: { Origin: "http://x" } })).headers.get("access-control-allow-origin"), "*");
      assert.equal((await call("GET", "/app-info", { auth: null })).headers.get("access-control-allow-origin"), "*", "even 401s carry CORS");
    });

    const root = await call("GET", "/notes/root");
    scratch = (await mk("root", `zz mock-test ${T.name} ${stamp}`, { content: "" })).note.noteId;
    created.push(scratch);

    await check("create-note: 201 {note, branch}; shapes and date formats", async () => {
      const r = await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "first", type: "text", content: "<p>alpha</p>" } });
      assert.equal(r.status, 201);
      rec.createShape = shapeOf(r.json);
      rec.noteShape = shapeOf(r.json.note);
      rec.branchShape = shapeOf(r.json.branch);
      assert.match(r.json.note.dateCreated, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}\+0000$/);
      assert.match(r.json.note.utcDateCreated, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.match(r.json.note.noteId, /^[A-Za-z0-9_]{4,32}$/);
      assert.equal(r.json.branch.branchId, `${scratch}_${r.json.note.noteId}`);
      assert.equal(r.json.branch.parentNoteId, scratch);
      assert.deepEqual(r.json.note.parentNoteIds, [scratch]);
      assert.equal(r.json.note.mime, "text/html");
      assert.equal(root.status, 200);
      rec.rootShape = shapeOf(root.json);
    });

    await check("create-note: default mime per type; custom mime kept; text + mime allowed", async () => {
      const mimes = {};
      for (const type of ["text", "code", "mermaid", "canvas", "file", "image", "search", "book", "relationMap", "mindMap", "render", "webView"]) {
        const r = await call("POST", "/create-note", { body: { parentNoteId: scratch, title: `t-${type}`, type, content: "" } });
        assert.equal(r.status, 201, `${type}: ${r.text}`);
        mimes[type] = r.json.note.mime;
      }
      rec.defaultMimes = mimes;
      const c = await mk(scratch, "py", { type: "code", mime: "text/x-python", content: "print(1)" });
      assert.equal(c.note.mime, "text/x-python");
      const md = await mk(scratch, "md", { type: "code", mime: "text/x-markdown", content: "# h" });
      assert.equal(md.note.type, "code"); assert.equal(md.note.mime, "text/x-markdown");
    });

    await check("create-note: notePosition drives childNoteIds order; default position = last + 10", async () => {
      const p = (await mk(scratch, "ordered")).note.noteId;
      const a = (await mk(p, "a", { notePosition: 30 })).note.noteId;
      const b = (await mk(p, "b", { notePosition: 10 })).note.noteId;
      const c = (await mk(p, "c", { notePosition: 20 })).note.noteId;
      const d = await mk(p, "d");
      assert.deepEqual((await call("GET", `/notes/${p}`)).json.childNoteIds, [b, c, a, d.note.noteId]);
      assert.equal(d.branch.notePosition, 40);
      const first = await mk((await mk(scratch, "emptyparent")).note.noteId, "x");
      rec.firstChildPosition = first.branch.notePosition;
      assert.equal(first.branch.notePosition, 10);
    });

    await check("content: GET headers + round trip; PUT text/plain & octet-stream only; blobId follows content", async () => {
      const n = (await mk(scratch, "content note", { content: "<p>one</p>" })).note;
      const g = await call("GET", `/notes/${n.noteId}/content`);
      assert.equal(g.status, 200); assert.equal(g.text, "<p>one</p>");
      rec.contentTypeText = g.headers.get("content-type");
      assert.match(g.headers.get("content-type"), /^text\/html/);
      const put = await call("PUT", `/notes/${n.noteId}/content`, { raw: { body: Buffer.from("<p>two</p>"), contentType: "text/plain" } });
      assert.equal(put.status, 204);
      assert.equal((await call("GET", `/notes/${n.noteId}/content`)).text, "<p>two</p>");
      const after = (await call("GET", `/notes/${n.noteId}`)).json;
      assert.notEqual(after.blobId, n.blobId);
      const twin = (await mk(scratch, "twin", { content: "<p>two</p>" })).note;
      rec.sameContentSameBlob = twin.blobId === after.blobId;
      assert.equal(twin.blobId, after.blobId, "same content, same blobId");
      assert.equal(after.type, "text");
      const html = await call("PUT", `/notes/${n.noteId}/content`, { raw: { body: Buffer.from("x"), contentType: "text/html" } });
      rec.putHtml = errBody({ ...html, json: { ...html.json, message: html.json.message.replace(n.noteId, "<id>") } });
      assert.equal(html.status, 500);
      const jsonPut = await call("PUT", `/notes/${n.noteId}/content`, { body: { a: 1 } });
      rec.putJson = errBody(jsonPut);
      assert.equal(jsonPut.status, 500);
      rec.putMissing = errBody(await call("PUT", "/notes/nonexist/content", { raw: { body: Buffer.from("x"), contentType: "text/plain" } }));
      const code = (await mk(scratch, "code note", { type: "code", mime: "text/x-python", content: "x = 1" })).note;
      rec.contentTypeCode = (await call("GET", `/notes/${code.noteId}/content`)).headers.get("content-type");
      assert.match(rec.contentTypeCode, /^text\/x-python/);
    });

    await check("binary notes: PNG bytes survive PUT -> GET with the image content-type", async () => {
      const png = makePng(8, 6, (x, y) => [x * 30, y * 40, 128]);
      const n = (await mk(scratch, "pic", { type: "image", mime: "image/png", content: "" })).note;
      assert.equal((await call("PUT", `/notes/${n.noteId}/content`, { raw: { body: png, contentType: "application/octet-stream" } })).status, 204);
      const g = await call("GET", `/notes/${n.noteId}/content`);
      assert.ok(g.buf.equals(png), "bytes differ");
      assert.equal(g.headers.get("content-type"), "image/png");
      const pdf = makePdf("A line (with) odd \\ chars");
      const f = (await mk(scratch, "doc", { type: "file", mime: "application/pdf", content: "" })).note;
      await call("PUT", `/notes/${f.noteId}/content`, { raw: { body: pdf, contentType: "application/octet-stream" } });
      assert.ok((await call("GET", `/notes/${f.noteId}/content`)).buf.equals(pdf));
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    });

    await check("attributes: POST/GET/PATCH/DELETE; name normalised, case kept; positions step by 10; validation", async () => {
      const n = (await mk(scratch, "attr note")).note.noteId;
      const a1 = await call("POST", "/attributes", { body: { noteId: n, type: "label", name: "Mixed.Case-Name:x y", value: "v1" } });
      assert.equal(a1.status, 201);
      assert.equal(a1.json.name, "Mixed_Case_Name:x_y");
      rec.attrShape = shapeOf(a1.json);
      const a2 = await call("POST", "/attributes", { body: { noteId: n, type: "label", name: "plain" } });
      assert.equal(a2.json.value, ""); assert.equal(a2.json.isInheritable, false);
      const a3 = await call("POST", "/attributes", { body: { noteId: n, type: "label", name: "日本語", value: "✓", isInheritable: false } });
      rec.attrPositions = [a1.json.position, a2.json.position, a3.json.position];
      assert.deepEqual(rec.attrPositions, [10, 20, 30]);
      assert.equal(a3.json.name, "日本語");
      const patched = await call("PATCH", `/attributes/${a1.json.attributeId}`, { body: { value: "v2", position: 99 } });
      assert.equal(patched.status, 200); assert.equal(patched.json.value, "v2"); assert.equal(patched.json.position, 99);
      assert.equal((await call("GET", `/attributes/${a1.json.attributeId}`)).json.value, "v2");
      const note = (await call("GET", `/notes/${n}`)).json;
      assert.deepEqual(note.attributes.map((a) => a.name), ["Mixed_Case_Name:x_y", "plain", "日本語"], "listed in creation order (a PATCH of position does not reorder)");
      rec.attrErrors = {
        patchName: errBody(await call("PATCH", `/attributes/${a1.json.attributeId}`, { body: { name: "zzz" } })),
        patchMissing: errBody(await call("PATCH", "/attributes/nonexist", { body: { value: "x" } })),
        getMissing: errBody(await call("GET", "/attributes/nonexist")),
        badType: errBody(await call("POST", "/attributes", { body: { noteId: n, type: "bogus", name: "a", value: "" } })),
        badNote: errBody(await call("POST", "/attributes", { body: { noteId: "nonexist", type: "label", name: "a", value: "" } })),
        badValue: errBody(await call("POST", "/attributes", { body: { noteId: n, type: "label", name: "a", value: 5 } })),
        badInheritable: errBody(await call("POST", "/attributes", { body: { noteId: n, type: "label", name: "a", value: "", isInheritable: "yes" } })),
        emptyName: errBody(await call("POST", "/attributes", { body: { noteId: n, type: "label", name: "", value: "" } }).then((r) => ({ ...r, json: r.json && { ...r.json, message: r.json.message.replace(n, "<note>") } }))),
        relationToMissing: errBody(await call("POST", "/attributes", { body: { noteId: n, type: "relation", name: "r", value: "nonexistent" } })),
      };
      assert.equal(rec.attrErrors.patchName.body.code, "PROPERTY_NOT_ALLOWED");
      assert.equal(rec.attrErrors.badType.status, 400);
      assert.equal(rec.attrErrors.relationToMissing.status, 404);
      const target = (await mk(scratch, "relation target")).note.noteId;
      const rel = await call("POST", "/attributes", { body: { noteId: n, type: "relation", name: "relatedTo", value: target } });
      assert.equal(rel.status, 201); assert.equal(rel.json.type, "relation"); assert.equal(rel.json.value, target);
      assert.equal((await call("DELETE", `/attributes/${a1.json.attributeId}`)).status, 204);
      assert.equal((await call("DELETE", `/attributes/${a1.json.attributeId}`)).status, 204, "deleting twice is fine");
      assert.ok(!(await call("GET", `/notes/${n}`)).json.attributes.some((a) => a.attributeId === a1.json.attributeId));
    });

    await check("inheritable labels: listed on every descendant with the OWNER's noteId, after the note's own", async () => {
      const p = (await mk(scratch, "inherit parent")).note.noteId;
      const c = (await mk(p, "inherit child")).note.noteId;
      const gc = (await mk(c, "inherit grandchild")).note.noteId;
      const inh = (await call("POST", "/attributes", { body: { noteId: p, type: "label", name: "Inherited-Thing", value: "yes", isInheritable: true } })).json;
      await call("POST", "/attributes", { body: { noteId: p, type: "label", name: "ownerOnly", value: "" } });
      await call("POST", "/attributes", { body: { noteId: c, type: "label", name: "childOwn", value: "" } });
      for (const id of [c, gc]) {
        const attrs = (await call("GET", `/notes/${id}`)).json.attributes;
        const got = attrs.find((a) => a.attributeId === inh.attributeId);
        assert.ok(got, `inherited label missing on ${id}`);
        assert.equal(got.noteId, p, "owner noteId");
        assert.equal(got.name, "Inherited_Thing");
        assert.ok(!attrs.some((a) => a.name === "ownerOnly"), "non-inheritable must not be listed");
      }
      const childAttrs = (await call("GET", `/notes/${c}`)).json.attributes.map((a) => a.name);
      assert.deepEqual(childAttrs, ["childOwn", "Inherited_Thing"], "own first");
      rec.inheritOrder = childAttrs;
    });

    await check("clones: POST /branches (201, then 200 for the same pair), several parents, DELETE branch keeps the note", async () => {
      const a = (await mk(scratch, "clone home A")).note.noteId;
      const b = (await mk(scratch, "clone home B")).note.noteId;
      const n = (await mk(a, "cloned note")).note.noteId;
      const first = await call("POST", "/branches", { body: { noteId: n, parentNoteId: b, prefix: "x" } });
      assert.equal(first.status, 201);
      rec.branchPostShape = shapeOf(first.json);
      assert.equal(first.json.branchId, `${b}_${n}`);
      const again = await call("POST", "/branches", { body: { noteId: n, parentNoteId: b, prefix: "y" } });
      assert.equal(again.status, 200); assert.equal(again.json.prefix, "y");
      const note = (await call("GET", `/notes/${n}`)).json;
      assert.deepEqual(note.parentNoteIds, [a, b]);
      assert.deepEqual(note.parentBranchIds, [`${a}_${n}`, `${b}_${n}`]);
      assert.ok((await call("GET", `/notes/${b}`)).json.childNoteIds.includes(n));
      const got = await call("GET", `/branches/${b}_${n}`);
      assert.deepEqual(shapeOf(got.json), rec.branchPostShape);
      const patch = await call("PATCH", `/branches/${b}_${n}`, { body: { prefix: "z", notePosition: 5 } });
      assert.equal(patch.status, 200); assert.equal(patch.json.prefix, "z"); assert.equal(patch.json.notePosition, 5);
      rec.branchErrors = {
        getMissing: errBody(await call("GET", "/branches/nonexist")),
        patchMissing: errBody(await call("PATCH", "/branches/nonexist", { body: { prefix: "x" } })),
        badNote: errBody(await call("POST", "/branches", { body: { noteId: "nonexist", parentNoteId: "root" } })),
      };
      assert.equal((await call("DELETE", `/branches/${b}_${n}`)).status, 204);
      const after = (await call("GET", `/notes/${n}`)).json;
      assert.deepEqual(after.parentNoteIds, [a]);
      assert.equal((await call("DELETE", `/branches/${b}_${n}`)).status, 204, "idempotent");
    });

    await check("search: words, #label, #label=value, note.title, and/or, archived, ancestorNoteId, limit, fastSearch, errors", async () => {
      const home = (await mk(scratch, `${word} home`)).note.noteId;
      const x1 = (await mk(home, `${word} apple pie`, { content: "<p>fresh <b>cinnamon</b> sugar</p>" })).note.noteId;
      const x2 = (await mk(home, `${word} banana`, { content: "<p>yellow</p>" })).note.noteId;
      const x3 = (await mk(home, `${word} cherry`, { content: "<p>red</p>" })).note.noteId;
      const lab = (id, name, value = "", inheritable = false) => call("POST", "/attributes", { body: { noteId: id, type: "label", name, value, isInheritable: inheritable } });
      await lab(x1, `${word}tag`, "Sweet Pie"); await lab(x2, `${word}tag`, "soft"); await lab(x3, "archived");
      await lab(home, `${word}inh`, "", true);
      const s = async (q, extra = "") => (await call("GET", `/notes?search=${encodeURIComponent(q)}${extra}`));
      const T = {};
      T.word = titles(await s(`${word} banana`));
      T.fullText = titles(await s(`${word} cinnamon sugar`));
      T.accent = titles(await s(`${word} BANÀNA`));
      T.label = titles(await s(`#${word}tag`));
      T.labelEq = titles(await s(`#${word}tag = "sweet pie"`));
      T.labelContains = titles(await s(`#${word}tag *=* oft`));
      T.labelNone = titles(await s(`#${word}tag = soft2`));
      T.negLabel = titles(await s(`${word} #!${word}tag`));
      T.inherited = titles(await s(`#${word}inh`));
      T.titleOp = titles(await s(`note.title *=* "apple" and #${word}tag`));
      T.titleStart = titles(await s(`note.title =* ${word}`));
      T.orOp = titles(await s(`note.title *=* apple or note.title *=* banana and #${word}tag`));
      T.archivedHidden = titles(await s(`${word} cherry`));
      T.archivedShown = titles(await s(`${word} cherry`, "&includeArchivedNotes=true"));
      T.ancestor = titles(await s(`${word}`, `&ancestorNoteId=${x1}`));
      T.ancestorHome = titles(await s(`${word}`, `&ancestorNoteId=${home}`));
      T.limit = (await s(`${word}`, "&limit=1")).json.results.length;
      T.badParent = (await s(`${word}`, "&ancestorNoteId=nonexist")).json.results.length;
      T.fastNoContent = titles(await s(`cinnamon ${word}`, "&fastSearch=true"));
      T.fastLabelStillWorks = titles(await s(`#${word}tag`, "&fastSearch=true"));
      T.propType = titles(await s(`note.type = text and #${word}tag`));
      T.relation = titles(await s(`~relatedTo`)).includes("attr note");
      rec.search = T;
      assert.deepEqual(T.word, [`${word} banana`]);
      assert.deepEqual(T.fullText, [`${word} apple pie`]);
      assert.deepEqual(T.accent, [`${word} banana`]);
      assert.deepEqual(T.label, [`${word} apple pie`, `${word} banana`]);
      assert.deepEqual(T.labelEq, [`${word} apple pie`]);
      assert.deepEqual(T.labelContains, [`${word} banana`]);
      assert.deepEqual(T.labelNone, []);
      assert.ok(T.inherited.includes(`${word} apple pie`) && T.inherited.includes(`${word} home`), "inheritable label matches descendants");
      assert.deepEqual(T.titleOp, [`${word} apple pie`]);
      assert.deepEqual(T.orOp, [`${word} apple pie`, `${word} banana`]);
      assert.deepEqual(T.archivedHidden, []);
      assert.deepEqual(T.archivedShown, [`${word} cherry`]);
      assert.deepEqual(T.ancestor, [`${word} apple pie`], "the ancestor itself is in scope");
      assert.equal(T.ancestorHome.length, 3, "home + its two non-archived children");
      assert.equal(titles(await s(`${word}`, `&ancestorNoteId=${home}&includeArchivedNotes=true`)).length, 4);
      assert.equal(T.limit, 1);
      assert.deepEqual(T.fastNoContent, []);
      const miss = await call("GET", "/notes?search=");
      const none = await call("GET", "/notes");
      const badLimit = await call("GET", `/notes?search=x&limit=abc`);
      rec.searchErrors = { empty: errBody(miss), missing: errBody(none), badLimit: errBody(badLimit) };
      assert.equal(miss.json.code, "SEARCH_QUERY_PARAM_MANDATORY");
      rec.searchShape = shapeOf((await s(`${word} banana`)).json);
      const full = (await s(`${word} banana`)).json.results[0];
      assert.deepEqual(Object.keys(full).sort(), Object.keys(rec.noteShape), "search results are full notes");
    });

    await check("errors: unknown note/route/property, bad types, bad JSON, missing params (status + code + message identical)", async () => {
      const E = {
        noteMissing: errBody(await call("GET", "/notes/nonexist")),
        contentMissing: errBody(await call("GET", "/notes/nonexist/content")),
        patchMissing: errBody(await call("PATCH", "/notes/nonexist", { body: { title: "x" } })),
        patchBadProp: errBody(await call("PATCH", "/notes/root", { body: { foo: "x" } })),
        patchBadTitle: errBody(await call("PATCH", `/notes/${scratch}`, { body: { title: 5 } })),
        createBadParent: errBody(await call("POST", "/create-note", { body: { parentNoteId: "nonexist", title: "x", type: "text", content: "" } })),
        createBadType: errBody(await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "x", type: "bogus", content: "" } })),
        createNoContent: errBody(await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "x", type: "text" } })),
        createNoType: errBody(await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "x", content: "" } })),
        createExtra: errBody(await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "x", type: "text", content: "", extra: 1 } })),
        createBadContent: errBody(await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "x", type: "text", content: 5 } })),
        createBadPosition: errBody(await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "x", type: "text", content: "", notePosition: "a" } })),
        createBadJson: errBody(await call("POST", "/create-note", { body: "{bad json" })),
        route: errBody(await call("GET", "/nothing")),
      };
      // V8 words the JSON syntax error per Node version: compare shape only
      E.createBadJson = { status: E.createBadJson.status, keys: Object.keys(E.createBadJson.body) };
      rec.errors = E;
      assert.equal(E.noteMissing.status, 404);
      assert.equal(E.noteMissing.body.code, "NOTE_NOT_FOUND");
      assert.equal(E.createBadType.body.code, "PROPERTY_VALIDATION_ERROR");
      assert.equal(E.createExtra.body.code, "PROPERTY_NOT_ALLOWED");
      assert.equal(E.route.status, 404);
      // untitled -> "New note", empty title kept
      const untitled = await call("POST", "/create-note", { body: { parentNoteId: scratch, type: "text", content: "" } });
      assert.equal(untitled.json.note.title, "New note");
      assert.equal((await call("POST", "/create-note", { body: { parentNoteId: scratch, title: "", type: "text", content: "" } })).json.note.title, "");
      assert.equal((await call("DELETE", "/notes/nonexist")).status, 204, "deleting a missing note is fine");
    });

    await check("PATCH /notes/:id: title, type, mime update; response is the full note", async () => {
      const n = (await mk(scratch, "to rename")).note.noteId;
      const r = await call("PATCH", `/notes/${n}`, { body: { title: "renamed", type: "code", mime: "text/x-sh" } });
      assert.equal(r.status, 200);
      assert.equal(r.json.title, "renamed"); assert.equal(r.json.type, "code"); assert.equal(r.json.mime, "text/x-sh");
      assert.deepEqual(shapeOf(r.json), rec.noteShape);
    });

    await check("DELETE /notes/:id: 204, takes children and clones with it; refresh-note-ordering is accepted", async () => {
      const p = (await mk(scratch, "doomed")).note.noteId;
      const k = (await mk(p, "doomed child")).note.noteId;
      const other = (await mk(scratch, "other home")).note.noteId;
      await call("POST", "/branches", { body: { noteId: k, parentNoteId: other } });
      assert.equal((await call("DELETE", `/notes/${p}`)).status, 204);
      assert.equal((await call("GET", `/notes/${p}`)).status, 404);
      // the child still has another parent, so (like Trilium) it survives under it
      const survivor = await call("GET", `/notes/${k}`);
      rec.cloneSurvivesParentDelete = survivor.status;
      assert.equal(survivor.status, 200);
      assert.deepEqual(survivor.json.parentNoteIds, [other]);
      assert.equal((await call("DELETE", `/notes/${other}`)).status, 204);
      assert.equal((await call("GET", `/notes/${k}`)).status, 404, "last parent gone -> child gone");
      const sib = (await mk(scratch, "ordering")).note.noteId;
      assert.equal((await call("POST", `/refresh-note-ordering/${sib}`)).status, 204);
    });

    if (T.isFake || REAL_LOGIN) {
      await check("auth/login: wrong password 401 WRONG_PASSWORD; right password 201 {authToken} that works", async () => {
        const wrong = await call("POST", "/auth/login", { auth: null, body: { password: "nope" } });
        assert.equal(wrong.status, 401);
        rec.loginWrong = errBody(wrong);
        const ok = await call("POST", "/auth/login", { auth: null, body: { password: T.password } });
        assert.equal(ok.status, 201);
        rec.loginShape = shapeOf(ok.json);
        assert.equal((await call("GET", "/app-info", { auth: ok.json.authToken })).status, 200);
        const noPw = await call("POST", "/auth/login", { auth: null, body: {} });
        rec.loginNoPassword = noPw.status;
        assert.equal(noPw.status, 500);
      });
    }
  } finally {
    // our own subtree only; one retry because the real server answered a first DELETE with a transient 500 once
    for (const id of created) {
      let r = await call("DELETE", `/notes/${id}`).catch(() => ({ status: 0 }));
      if (r.status !== 204) r = await call("DELETE", `/notes/${id}`).catch(() => ({ status: 0 }));
      if (r.status !== 204) { fail++; console.log(`  FAIL  cleanup of ${id} on ${T.name}: ${r.status} (delete it by hand)`); }
    }
  }
}

function compare(a, b) {
  section(`conformance: ${a.name} vs ${b.name}`);
  const keys = [...new Set([...Object.keys(a.rec), ...Object.keys(b.rec)])].sort();
  const skip = new Set(["loginWrong", "loginShape", "loginNoPassword"]); // only run on both with --real-login
  return Promise.all(keys.map((k) => check(`same ${k}`, () => {
    if (skip.has(k) && !(k in a.rec && k in b.rec)) return;
    assert.ok(k in a.rec && k in b.rec, `recorded only on ${k in a.rec ? a.name : b.name}`);
    assert.deepEqual(b.rec[k], a.rec[k], `${b.name} differs from ${a.name}`);
  })));
}

// ---------------------------------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------------------------------

function spawnFake(extra = []) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [join(ROOT, "tools/etapi-fake.mjs"), "--port", "0", ...extra], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const url = /^TRILIUM_URL=(.*)$/m.exec(out)?.[1], token = /^TRILIUM_TOKEN=(.*)$/m.exec(out)?.[1];
      if (url && token) res({ child, url, token, out });
    });
    child.on("exit", (c) => rej(new Error(`etapi-fake exited ${c}: ${out}`)));
  });
}
/** Run a tool as a child process (async: the in-process fake must keep answering). */
const run = (file, a) => new Promise((resolve) => {
  const c = spawn(process.execPath, [join(ROOT, file), ...a], { cwd: ROOT });
  let stdout = "", stderr = "";
  c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
  c.on("exit", (status) => resolve({ status, stdout, stderr }));
});

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

const children = [];
const cleanup = () => { for (const c of children) try { c.kill(); } catch { /* gone */ } };
process.on("exit", cleanup);

let real = null;
if (!NO_REAL) {
  try {
    const raw = readFileSync(join(ROOT, ".bootstrap.env"), "utf8");
    const url = raw.match(/^TRILIUM_URL=(.*)$/m)?.[1], token = raw.match(/^TRILIUM_TOKEN=(.*)$/m)?.[1];
    const t = target("real", url, token);
    const r = await t.call("GET", "/app-info").catch(() => null);
    if (r?.status === 200 && r.json.buildRevision !== "etapi-fake") { t.password = process.env.BIBLIOTHECA_TEST_PASSWORD ?? "biblio-test-pw"; real = t; }
    else console.log(`real mock: SKIPPED (${r ? `app-info answered ${r.status}` : `unreachable at ${url}`}; start it with tools/trilium-bootstrap.sh)`);
  } catch { console.log("real mock: SKIPPED (no .bootstrap.env)"); }
}

const fakeProc = await spawnFake();
children.push(fakeProc.child);
const fake = target("fake", fakeProc.url, fakeProc.token);
fake.isFake = true; fake.password = "biblio-test-pw";

await conformance(fake);
if (real) { await conformance(real); await compare(real, fake); }

// ---------------------------------------------------------------------------------------------
// Generator + fake-only
// ---------------------------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), "biblio-mocktest-"));
async function bundle(code, name) {
  const entry = join(tmp, `${name}.entry.ts`);
  writeFileSync(entry, code);
  const outfile = join(tmp, `${name}.mjs`);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
}
const src = (p) => JSON.stringify(join(ROOT, p));

section("vault generator: profiles");
const BALANCED = { small: 40, medium: 160, large: 600, huge: 1500 };
const gen = {};
for (const name of Object.keys(PROFILES)) gen[name] = generateVault(name);
for (const [name, size] of Object.entries(BALANCED)) {
  await check(`${name}: exactly ${size} notes, one top note "Mock Vault (${name})", parents before children`, () => {
    const v = gen[name];
    assert.equal(v.notes.length, size);
    assert.equal(v.rootTitle, `Mock Vault (${name})`);
    assert.equal(v.notes[0].parent, "@root");
    assert.equal(v.notes.filter((n) => n.parent === "@root").length, 1);
    const seen = new Set();
    for (const n of v.notes) { if (n.parent !== "@root") assert.ok(seen.has(n.parent), `${n.key} before its parent ${n.parent}`); seen.add(n.key); }
    assert.equal(seen.size, size, "unique keys");
  });
}
await check("determinism: the same (profile, seed) gives byte-identical specs; another seed differs; no Math.random/Date in the generator", () => {
  for (const name of Object.keys(PROFILES)) {
    const a = JSON.stringify(generateVault(name, { seed: 1 })), b = JSON.stringify(generateVault(name, { seed: 1 }));
    assert.equal(a, b, `${name} not deterministic`);
  }
  assert.notEqual(JSON.stringify(generateVault("small", { seed: 2 })), JSON.stringify(generateVault("small", { seed: 1 })));
  assert.equal(JSON.stringify(generateVault("small", { rootTitle: "X" })).includes('"title":"X"'), true);
  const text = readFileSync(join(ROOT, "tools/lib/vault-gen.mjs"), "utf8");
  assert.ok(!/Math\.random|Date\.now|new Date\(\)/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "generator must be deterministic");
});
await check("tree stats: depth/width per profile (stress shapes do what they say)", () => {
  const S = Object.fromEntries(Object.keys(gen).map((n) => [n, vaultStats(gen[n])]));
  assert.ok(S.small.maxDepth >= 3 && S.medium.maxDepth >= 4, "balanced vaults nest");
  assert.ok(S.huge.maxDepth > 8 && S.large.maxDepth >= 8, "large/huge reach the app's depth cap (8) below the top note");
  assert.ok(S.huge.maxWidth >= 20);
  assert.equal(S.deepchain.maxDepth, 26, "25 nested folders + the note under the last one");
  assert.equal(S.deepchain.folders, 1 + 25);
  assert.equal(S.widefan.maxWidth, 150);
  const fan = gen.widefan.notes.find((n) => n.title === "The Wide Fan");
  assert.equal(gen.widefan.notes.filter((n) => n.parent === fan.key).length, 150);
  assert.ok(S.longtail.maxChars >= 190000 && S.longtail.maxChars <= 210000, `longtail max ${S.longtail.maxChars}`);
  const lens = gen.longtail.notes.filter((n) => n.labels.some((l) => l.name === "len")).map((n) => Number(n.labels.find((l) => l.name === "len").value));
  for (const n of LONGTAIL_SIZES) assert.ok(lens.includes(n), `longtail lacks ${n}`);
  assert.ok(LONGTAIL_SIZES.includes(1) && LONGTAIL_SIZES.includes(200000));
  // text notes: visible characters (tags stripped) == the label
  for (const n of gen.longtail.notes.filter((x) => x.type === "text" && x.labels.some((l) => l.name === "len"))) {
    assert.equal(n.content.replace(/<[^>]*>/g, "").length, Number(n.labels.find((l) => l.name === "len").value), n.title);
  }
});
await check("label coverage: colour, topic tags, archived, inheritable, biblio_* layout labels, relations, clones, odd names", () => {
  const S = vaultStats(gen.medium);
  for (const name of ["color", "archived", "iconClass", "workspace", "Priority", "book", "recipe", "dateNote", "biblio_wing", "biblio_theme", "biblio_wall", "biblio_furniture", "biblio_rug", "biblio_case", "biblio_span", "biblio_x", "biblio_y", "biblio_leaf", "lang"]) {
    assert.ok(S.labelNames[name] > 0, `medium lacks #${name}`);
  }
  assert.ok(S.withColor >= 5 && S.archived >= 2 && S.inheritable >= 5 && S.relations >= 5 && S.clones >= 2 && S.binary >= 2, JSON.stringify({ c: S.withColor, a: S.archived, i: S.inheritable, r: S.relations, cl: S.clones, b: S.binary }));
  const zoo = gen.medium.notes.find((n) => n.title === "Attribute zoo");
  assert.ok(zoo, "attribute zoo present");
  assert.ok(zoo.labels.some((l) => l.name === "Mixed.Case-Name") && zoo.labels.some((l) => l.name === "TODO" && l.value === "") && zoo.labels.some((l) => l.value.length >= 500));
  for (const t of ["text", "code", "canvas", "mermaid", "image", "file", "search", "mindMap"]) assert.ok(S.byType[t] > 0, `medium lacks type ${t}`);
  assert.ok(gen.medium.notes.some((n) => n.mime === "text/x-markdown"), "a markdown note");
  assert.ok(S.labelNames.archived >= 2);
  // every note with an image/file type carries bytes or text content with a mime
  for (const n of gen.large.notes.filter((x) => x.type === "image")) { assert.ok(n.bytes?.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "valid PNG signature"); }
});
await check("biblio_* values are values the app understands (themes.ts / decor.ts)", async () => {
  const m = await bundle(`export { THEMES } from ${src("src/game/themes.ts")}; export * from ${src("src/game/decor.ts")};`, "decor");
  const themes = m.THEMES.map((t) => t.id);
  for (const name of Object.keys(PROFILES)) for (const n of gen[name].notes) for (const l of n.labels) {
    if (l.name === "biblio_theme" || l.name === "biblio_wing") assert.ok(themes.includes(l.value), `${l.name}=${l.value}`);
    if (l.name === "biblio_rug") assert.ok(m.RUG_STYLES.includes(l.value));
    if (l.name === "biblio_case") assert.ok(m.CASE_STYLES.includes(l.value));
    if (l.name === "biblio_span") assert.ok(Number(l.value) >= 0 && Number(l.value) <= m.MAX_SPAN);
    if (l.name === "biblio_wall") for (const e of l.value.split(",")) assert.ok(e === m.AUTO || e === m.EMPTY || m.WALL_KINDS.includes(e), `wall ${e}`);
    if (l.name === "biblio_furniture") for (const e of l.value.split(",")) assert.ok(e === m.AUTO || e === m.EMPTY || m.FLOOR_KINDS.includes(e), `furniture ${e}`);
    if (l.name === "biblio_leaf") assert.ok(["broad", "needle", "maple", "blossom", "fruit"].includes(l.value));
    if (l.name === "biblio_x" || l.name === "biblio_y") assert.ok(/^\d+$/.test(l.value));
  }
});
await check("hygiene: no 'hello' (browser-test searches for it), no biblio_inbox, clean titles, links/relations/clones resolve", () => {
  for (const name of Object.keys(PROFILES)) {
    const v = gen[name], keys = new Set(v.notes.map((n) => n.key));
    const hasKids = new Set(v.notes.map((n) => n.parent));
    for (const n of v.notes) {
      assert.ok(!/hello/i.test(n.title + (n.bytes ? "" : n.content) + n.labels.map((l) => l.name + l.value).join(" ")), `"hello" in ${name}/${n.title}`);
      assert.ok(!n.labels.some((l) => l.name.toLowerCase() === "biblio_inbox"), "biblio_inbox is the capture inbox marker");
      assert.equal(n.title, n.title.trim()); assert.ok(!/[\n\r]/.test(n.title), n.title);
      assert.ok(n.title.length > 0 && n.title.length < 120);
      for (const m of n.content.matchAll(/\{\{ref:(k\d+)\}\}/g)) assert.ok(keys.has(m[1]), `dangling ref ${m[1]}`);
      for (const r of n.relations) assert.ok(keys.has(r.target) && r.target !== n.key);
      for (const c of n.clones) { assert.ok(keys.has(c) && c !== n.parent, "clone parent"); assert.ok(!hasKids.has(n.key), "only leaf notes are cloned (no cycles)"); }
      assert.ok(n.bytes ? n.content === "" : true);
    }
  }
});

section("vault -> fake: load, HTTP apply, walks");
const dump = (store) => {
  const out = [];
  const walk = (id, depth) => {
    const n = store.notes.get(id);
    // ids differ between stores: internal links are compared by the title they point at
    const body = n.content.toString("utf8").replace(/#root\/([A-Za-z0-9]{12})/g, (_, i) => `#root/<${store.notes.get(i)?.title}>`);
    out.push([depth, n.title, n.type, n.mime, n.type === "image" || n.mime === "application/pdf" ? n.content.toString("base64") : body, store.allAttrs(id).filter((a) => a.noteId === id).map((a) => [a.type, a.name, a.type === "relation" ? store.notes.get(a.value).title : a.value, a.isInheritable, a.position]), (store.parentBr.get(id) ?? []).map((b) => store.notes.get(b.parentNoteId)?.title)]);
    for (const b of store.sortedChildren(id)) if (!(id !== "root" && store.parentBr.get(b.noteId)[0].parentNoteId !== id)) walk(b.noteId, depth + 1);
  };
  for (const b of store.sortedChildren("root")) if (!b.noteId.startsWith("_")) walk(b.noteId, 0);
  return JSON.stringify(out);
};
for (const name of ["small", "medium"]) {
  await check(`${name}: HTTP apply (seed-vault path) builds the same tree as the in-memory load`, async () => {
    const a = createStore({ idSeed: 5 });
    loadVault(a, gen[name]);
    const f = await startFake({ idSeed: 9 });
    try {
      const T = target("apply", f.url, f.token);
      const api = async (method, path, body, raw) => { const r = await T.call(method, path, { body, raw }); if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text}`); return r.json ?? null; };
      await applyVault(gen[name], { api });
      assert.equal(dump(f.store), dump(a));
      assert.equal(f.store.notes.size, a.notes.size);
      assert.equal(f.store.notes.size, 2 + gen[name].notes.length, "root + _hidden + the vault");
    } finally { await f.close(); }
  });
}
await check("fake guards: a clone cycle and a parent-less branch are refused (the real mock would corrupt itself until restarted: never try either there)", async () => {
  const f = await startFake();
  try {
    const T = target("guards", f.url, f.token);
    const a = (await T.call("POST", "/create-note", { body: { parentNoteId: "root", title: "a", type: "text", content: "" } })).json.note.noteId;
    const b = (await T.call("POST", "/create-note", { body: { parentNoteId: a, title: "b", type: "text", content: "" } })).json.note.noteId;
    assert.equal((await T.call("POST", "/branches", { body: { noteId: a, parentNoteId: b } })).status, 400);
    assert.equal((await T.call("POST", "/branches", { body: { noteId: a, parentNoteId: a } })).status, 400);
    assert.equal((await T.call("POST", "/branches", { body: { noteId: a } })).status, 400);
    assert.equal((await T.call("DELETE", "/notes/root")).status, 400);
    assert.deepEqual((await T.call("GET", `/notes/${a}`)).json.parentNoteIds, ["root"]);
  } finally { await f.close(); }
});
await check("a seeded fake serves the whole medium vault over HTTP: counts, depth and width match the generator", async () => {
  const f = await startFake({ seed: "medium" });
  try {
    const T = target("medium", f.url, f.token);
    const S = vaultStats(gen.medium);
    const top = f.seeded.topNoteId;
    let count = 0, maxDepth = 0, maxWidth = 0;
    const seen = new Set();
    const walk = async (id, d) => {
      if (seen.has(id)) return;
      seen.add(id);
      const n = (await T.call("GET", `/notes/${id}`)).json;
      count++; maxDepth = Math.max(maxDepth, d); maxWidth = Math.max(maxWidth, n.childNoteIds.length);
      for (const c of n.childNoteIds) await walk(c, d + 1);
    };
    await walk(top, 0);
    assert.deepEqual([count, maxDepth, maxWidth], [S.notes, S.maxDepth, S.maxWidth]);
    const rootNote = (await T.call("GET", "/notes/root")).json;
    assert.deepEqual(rootNote.childNoteIds, [top, "_hidden"]);
    // internal links resolved to real ids
    const readme = (await T.call("GET", `/notes?search=${encodeURIComponent("note.title = README")}`)).json.results[0];
    const html = (await T.call("GET", `/notes/${readme.noteId}/content`)).text;
    const ids = [...html.matchAll(/href="#root\/([A-Za-z0-9]{12})"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 8 && ids.every((id) => f.store.notes.has(id)), "README links to real notes");
    assert.ok(!html.includes("{{ref:"));
    // clones: some note has two parents
    assert.ok([...f.store.parentBr.values()].some((b) => b.length >= 2), "a clone exists");
    // inheritable labels land on descendants with the owner's id
    const lang = (await T.call("GET", `/notes?search=${encodeURIComponent("#lang")}`)).json.results;
    assert.ok(lang.length > 1);
    const child = lang.find((n) => n.attributes.some((a) => a.name === "lang" && a.noteId !== n.noteId));
    assert.ok(child, "a code note inherits #lang from its folder");
    // the quick-capture marker is NOT in the vault
    assert.deepEqual((await T.call("GET", `/notes?search=${encodeURIComponent("#biblio_inbox")}`)).json.results, []);
  } finally { await f.close(); }
});
await check("the app's own walkLibraryTree + captureNote work against the fake (medium: complete walk; large: node cap; deepchain: depth cap)", async () => {
  const m = await bundle(`export { walkLibraryTree } from ${src("src/lib/library.ts")}; export { TriliumClient } from ${src("src/lib/trilium/client.ts")}; export { captureNote } from ${src("src/lib/capture.ts")}; export { TREE_WALK } from ${src("src/config.ts")};`, "app");
  const walk = async (profile) => {
    const f = await startFake({ seed: profile });
    try { const c = new m.TriliumClient({ baseUrl: f.url, token: f.token }); return { tree: await m.walkLibraryTree(c, "root"), f, c }; }
    finally { /* closed by caller */ }
  };
  let r = await walk("medium");
  try {
    assert.equal(r.tree.truncated, false);
    assert.equal(Object.keys(r.tree.notes).length, 161, "root + the 160 vault notes (_hidden is skipped)");
    assert.ok(!r.tree.notes._hidden);
    const dupes = r.tree.edges.filter((e) => e.noteId === Object.values(r.tree.notes).find((n) => n.title === "Weekly review ritual")?.noteId);
    assert.ok(dupes.length >= 2, "a clone keeps every parent edge");
    const colored = Object.values(r.tree.notes).filter((n) => n.labels.color);
    assert.ok(colored.length >= 5, "#color is read");
    // inherited labels are not misread as the child's own
    const snip = Object.values(r.tree.notes).find((n) => n.type === "code" && /\.(py|js|sh|sql|css|go|yml|ts)$/.test(n.title));
    assert.ok(snip && !("lang" in snip.labels) && !("iconclass" in snip.labels), "inherited labels are not own labels");
    assert.ok(Object.values(r.tree.notes).some((n) => n.type === "image" && n.blobId), "blobId reaches NoteInfo");
    const id = await m.captureNote(r.c, "root", "captured by mock-test\nsecond line");
    assert.ok(id && r.f.store.notes.get(id).title === "captured by mock-test");
    const inbox = [...r.f.store.notes.values()].find((n) => n.title === "Inbox");
    assert.ok(inbox && r.f.store.attrs.size > 0 && [...r.f.store.attrs.values()].some((a) => a.noteId === inbox.noteId && a.name === "biblio_inbox"), "inbox created and marked");
  } finally { await r.f.close(); }
  r = await walk("large");
  try { assert.equal(r.tree.truncated, true); const got = Object.keys(r.tree.notes).length; assert.ok(got >= m.TREE_WALK.maxNodes && got < m.TREE_WALK.maxNodes + 8, `BFS stops at maxNodes (pool batches of 8 may overshoot): ${got}`); } finally { await r.f.close(); }
  r = await walk("deepchain");
  try {
    assert.equal(r.tree.truncated, true);
    const deepest = Math.max(...Object.values(r.tree.notes).map((n) => { let d = 0, id = n.noteId; const parent = new Map(r.tree.edges.map((e) => [e.noteId, e.parentNoteId])); while (parent.has(id)) { id = parent.get(id); d++; } return d; }));
    assert.equal(deepest, m.TREE_WALK.maxDepth, "nothing is fetched below maxDepth");
  } finally { await r.f.close(); }
  r = await walk("widefan");
  try { assert.equal(r.tree.truncated, false); assert.equal(Object.keys(r.tree.notes).length, 183); } finally { await r.f.close(); }
});
await check("huge loads into the store quickly; longtail content sizes survive HTTP", async () => {
  const t0 = Date.now();
  const s = createStore();
  loadVault(s, gen.huge);
  assert.equal(s.notes.size, 2 + 1500);
  assert.ok(Date.now() - t0 < 5000, `load took ${Date.now() - t0} ms`);
  const f = await startFake({ seed: "longtail" });
  try {
    const T = target("lt", f.url, f.token);
    const big = [...f.store.notes.values()].find((n) => n.title === "200 K chars (text)");
    const g = await T.call("GET", `/notes/${big.noteId}/content`);
    assert.equal(g.text.replace(/<[^>]*>/g, "").length, 200000);
  } finally { await f.close(); }
});

section("CLIs");
await check("etapi-fake CLI: prints URL + token, serves the seeded profile, --markdown-type switches the type; stops on SIGTERM", async () => {
  const p = await spawnFake(["--seed", "medium", "--markdown-type"]);
  children.push(p.child);
  const T = target("cli", p.url, p.token);
  assert.equal((await T.call("GET", "/app-info")).json.buildRevision, "etapi-fake");
  const md = (await T.call("GET", `/notes?search=${encodeURIComponent("note.type = markdown")}`)).json.results;
  const plain = await spawnFake(["--seed", "medium"]);
  children.push(plain.child);
  const T2 = target("cli2", plain.url, plain.token);
  assert.equal((await T2.call("GET", `/notes?search=${encodeURIComponent("note.type = markdown")}`)).json.results.length, 0);
  assert.equal((await T2.call("POST", "/create-note", { body: { parentNoteId: "root", title: "x", type: "markdown", content: "" } })).status, 400, "real Trilium has no markdown type");
  assert.ok(md.length > 0, "--markdown-type makes the profile's markdown notes real markdown");
  p.child.kill("SIGTERM"); plain.child.kill("SIGTERM");
  assert.equal((await run("tools/etapi-fake.mjs", ["--seed", "nope"])).status, 1);
});
await check("seed-vault.js: --list works offline; seeds a fake over HTTP (--url/--token), is idempotent, --clean removes it", async () => {
  const list = await run("tools/seed-vault.js", ["--list"]);
  assert.equal(list.status, 0);
  for (const name of Object.keys(PROFILES)) assert.ok(list.stdout.includes(name));
  const f = await startFake();
  try {
    const T = target("sv", f.url, f.token);
    const seed = (extra = []) => run("tools/seed-vault.js", ["small", "--url", f.url, "--token", f.token, ...extra]);
    let r = await seed();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /40 notes generated, 40 reachable/);
    r = await seed();
    assert.equal(r.status, 0); assert.match(r.stdout, /replaced 1 old "Mock Vault \(small\)"/);
    assert.equal((await T.call("GET", "/notes/root")).json.childNoteIds.length, 2, "idempotent: still one vault (+ _hidden)");
    assert.equal(f.store.notes.size, 2 + 40);
    r = await run("tools/seed-vault.js", ["--clean", "--url", f.url, "--token", f.token]);
    assert.equal(r.status, 0); assert.match(r.stdout, /removed: Mock Vault \(small\)/);
    assert.equal(f.store.notes.size, 2);
  } finally { await f.close(); }
});
await check("seed-vault.js refuses anything that is neither the .bootstrap.env mock nor an etapi-fake", async () => {
  const srv = createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ appVersion: "0.106.0", buildRevision: "c0fdceba" })); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const r = await new Promise((resolve) => { const c = spawn(process.execPath, [join(ROOT, "tools/seed-vault.js"), "small", "--url", url, "--token", "x"], { cwd: ROOT }); let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d)); c.on("exit", (code) => resolve({ code, out })); });
    assert.equal(r.code, 1); assert.match(r.out, /refusing/);
  } finally { srv.close(); }
});

cleanup();
console.log(`\n${fail === 0 ? "mock-test: all green" : "mock-test: FAILURES"} (${pass} passed, ${fail} failed${real ? "" : "; real mock not exercised"})`);
if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
process.exit(fail === 0 ? 0 : 1);
