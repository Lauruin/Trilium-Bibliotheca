#!/usr/bin/env node
/**
 * tools/etapi-fake.mjs — an in-memory FAKE of Trilium's ETAPI, so the app, the tools and the tests run WITHOUT docker.
 *
 *   node tools/etapi-fake.mjs [--seed <profile>] [--port N] [--host H] [--password P] [--token T]
 *                             [--vault-seed N] [--markdown-type]
 *   -> prints  TRILIUM_URL=...  and  TRILIUM_TOKEN=...  (never touches .bootstrap.env; the real mock stays yours)
 *   in-process: `const f = await startFake({seed: "medium"}); f.url, f.token, f.store, await f.close()`
 *
 * It implements what the app and tools/ use, with the shapes and the error envelope {status, code, message} observed on
 * the real v0.106.0 mock (tools/mock-test.mjs runs one set of assertions against both and compares the shapes):
 *   auth (bare / Bearer / Basic token), app-info, auth/login + logout, notes (GET/PATCH/DELETE, content GET/PUT),
 *   search (subset, below), create-note, attributes (POST/GET/PATCH/DELETE), branches (POST/GET/PATCH/DELETE),
 *   attachments (POST/GET/PATCH/DELETE, content GET/PUT, GET /notes/{id}/attachments), refresh-note-ordering, CORS incl. preflight, inheritable labels listed on descendants with the OWNER's noteId,
 *   attribute-name normalisation (`a.b-c` -> `a_b_c`, case kept), clones (several parents), content-hash blobIds.
 * Search subset: plain words (all must appear in title / label text / content, accent- and case-insensitive; HTML
 *   stripped for text notes), "quoted phrases", #label, #!label, #label op value, ~relation[.title|.noteId] op value,
 *   note.<title|type|mime|noteId|content|isArchived|parents.title|children.title|ancestors.title|...> op value, and/or,
 *   parentheses; ops = != *=* =* *= %= > >= < <=. Params: fastSearch, includeArchivedNotes, ancestorNoteId (the note itself included), ancestorDepth,
 *   limit, orderBy/orderDirection. Archived notes (#archived, own or inherited) and the _hidden subtree are excluded by
 *   default. NOT implemented: not(...), fuzzy ops, ~relation chains, templates, protected notes, revisions,
 *   calendar/day notes, backups, import/export. Unknown routes answer 404 like Express does.
 * Deliberate differences from the real server: POST /branches refuses a cycle (the real one accepts it and corrupts
 * the instance: never try that there); DELETE of root/_hidden is refused; result order = tree order; ids come from a
 * seeded PRNG (so a seeded fake is reproducible); the 429 login blacklist body is a guess (not yet verified live).
 * Docs: AGENTS.md "Trilium mock".
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { generateVault, PROFILES, resolveRefs } from "./lib/vault-gen.mjs";
import { wireType } from "./lib/vault-apply.mjs";

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

class EtapiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (property, msg) => new EtapiError(400, "PROPERTY_VALIDATION_ERROR", `Validation failed on property '${property}': ${msg}`);
const generic = (msg, status = 500) => new EtapiError(status, "GENERIC", msg);
const noteNotFound = (id) => new EtapiError(404, "NOTE_NOT_FOUND", `Note '${id}' not found.`);
const attachmentNotFound = (id) => new EtapiError(404, "ATTACHMENT_NOT_FOUND", `Attachment '${id}' not found.`);

const NOTE_TYPES = ["text", "code", "render", "file", "image", "search", "relationMap", "book", "noteMap", "mermaid", "canvas", "webView", "launcher", "doc", "contentWidget", "mindMap", "spreadsheet", "llmChat"];
const DEFAULT_MIME = { text: "text/html", code: "text/plain", render: "", file: "application/octet-stream", image: "", search: "", relationMap: "application/json", book: "", noteMap: "", mermaid: "text/vnd.mermaid", canvas: "application/json", webView: "", launcher: "", doc: "", contentWidget: "", mindMap: "application/json", spreadsheet: "application/json", llmChat: "application/json" };
const EXT = { "text/html": "html", "text/plain": "txt", "text/x-python": "py", "text/x-sh": "sh", "text/css": "css", "text/csv": "csv", "text/x-markdown": "md", "application/json": "json", "image/png": "png", "application/pdf": "pdf", "text/vnd.mermaid": "mmd", "application/javascript;env=frontend": "js" };

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

const pad = (n, w = 2) => String(n).padStart(w, "0");
function stamp(d = new Date()) {
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  return { local: `${base}+0000`, utc: `${base}Z` };
}
function mulberry(a) {
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const normName = (name) => String(name).replace(/[^\p{L}\p{N}_:]/gu, "_");
const blobIdOf = (buf) => createHash("sha256").update(buf).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function createStore({ idSeed = 1, markdownType = false } = {}) {
  const rnd = mulberry(idSeed * 7919 + 13);
  const notes = new Map(), branches = new Map(), attrs = new Map(), attachments = new Map();
  const childBr = new Map(); // parentNoteId -> Branch[]
  const parentBr = new Map(); // noteId -> Branch[] (creation order)
  const noteTypes = markdownType ? [...NOTE_TYPES, "markdown"] : NOTE_TYPES;
  const store = { notes, branches, attrs, attachments, noteTypes };

  const genId = (taken) => { for (;;) { let s = ""; for (let i = 0; i < 12; i++) s += ID_CHARS[Math.floor(rnd() * ID_CHARS.length)]; if (!taken.has(s)) return s; } };

  function putNote(o) {
    const t = stamp();
    const content = o.content ?? Buffer.alloc(0);
    const n = { noteId: o.noteId, title: o.title, type: o.type, mime: o.mime, content, blobId: blobIdOf(content), dateCreated: t.local, dateModified: t.local, utcDateCreated: t.utc, utcDateModified: t.utc, attrIds: [] };
    notes.set(n.noteId, n);
    return n;
  }
  const sortedChildren = (id) => (childBr.get(id) ?? []).slice().sort((a, b) => a.notePosition - b.notePosition);

  function addBranch(noteId, parentNoteId, { notePosition, prefix = null, isExpanded = false } = {}) {
    const id = `${parentNoteId}_${noteId}`;
    const existing = branches.get(id);
    if (existing) { // like the real server: same (note, parent) pair updates the branch
      if (notePosition !== undefined) existing.notePosition = notePosition;
      if (prefix !== undefined) existing.prefix = prefix;
      if (isExpanded !== undefined) existing.isExpanded = isExpanded;
      existing.utcDateModified = stamp().utc;
      return { branch: existing, created: false };
    }
    const sibs = childBr.get(parentNoteId) ?? [];
    const br = { branchId: id, noteId, parentNoteId, prefix, notePosition: notePosition ?? (sibs.length ? Math.max(...sibs.map((b) => b.notePosition)) + 10 : 10), isExpanded, utcDateModified: stamp().utc };
    branches.set(id, br);
    sibs.push(br); childBr.set(parentNoteId, sibs);
    const pbs = parentBr.get(noteId) ?? [];
    pbs.push(br); parentBr.set(noteId, pbs);
    return { branch: br, created: true };
  }
  function addAttr(o) {
    const own = (notes.get(o.noteId).attrIds).map((i) => attrs.get(i));
    const a = { attributeId: o.attributeId ?? genId(attrs), noteId: o.noteId, type: o.type, name: normName(o.name), value: o.value ?? "", position: o.position ?? (own.length ? Math.max(...own.map((x) => x.position)) + 10 : 10), isInheritable: !!o.isInheritable, utcDateModified: stamp().utc };
    attrs.set(a.attributeId, a);
    notes.get(o.noteId).attrIds.push(a.attributeId);
    return a;
  }
  function removeAttr(id) {
    const a = attrs.get(id);
    if (!a) return;
    attrs.delete(id);
    const n = notes.get(a.noteId);
    if (n) n.attrIds = n.attrIds.filter((x) => x !== id);
  }
  /** Attachment of a note (verified against v0.106.0: any role accepted, position defaults to 10, content may be empty). */
  function putAttachment(o) {
    const t = stamp();
    const content = o.content ?? Buffer.alloc(0);
    const a = { attachmentId: o.attachmentId ?? genId(attachments), ownerId: o.ownerId, role: o.role ?? "", mime: o.mime ?? "", title: o.title ?? "", position: o.position ?? 10, content, blobId: blobIdOf(content), dateModified: t.local, utcDateModified: t.utc };
    attachments.set(a.attachmentId, a);
    return a;
  }
  function removeBranch(br) {
    branches.delete(br.branchId);
    childBr.set(br.parentNoteId, (childBr.get(br.parentNoteId) ?? []).filter((b) => b !== br));
    parentBr.set(br.noteId, (parentBr.get(br.noteId) ?? []).filter((b) => b !== br));
  }
  /** Delete a note: all its branches, its attributes, relations pointing at it, and children left without a parent. */
  function deleteNote(id) {
    const n = notes.get(id);
    if (!n) return;
    const kids = (childBr.get(id) ?? []).slice();
    for (const br of (parentBr.get(id) ?? []).slice()) removeBranch(br);
    for (const br of kids) removeBranch(br);
    for (const aid of n.attrIds.slice()) removeAttr(aid);
    for (const a of [...attachments.values()]) if (a.ownerId === id) attachments.delete(a.attachmentId);
    notes.delete(id);
    childBr.delete(id); parentBr.delete(id);
    for (const a of [...attrs.values()]) if (a.type === "relation" && a.value === id) removeAttr(a.attributeId);
    for (const br of kids) if (notes.has(br.noteId) && (parentBr.get(br.noteId) ?? []).length === 0) deleteNote(br.noteId);
  }

  function isDescendant(candidate, ancestor) { // candidate below (or equal to) ancestor?
    const seen = new Set([ancestor]);
    const stack = [ancestor];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === candidate) return true;
      for (const b of childBr.get(cur) ?? []) if (!seen.has(b.noteId)) { seen.add(b.noteId); stack.push(b.noteId); }
    }
    return false;
  }
  /** Every ancestor with its minimal distance (parent = 1). */
  function ancestors(id) {
    const dist = new Map();
    let frontier = [id], d = 0;
    while (frontier.length) {
      d++;
      const next = [];
      for (const cur of frontier) for (const b of parentBr.get(cur) ?? []) if (!dist.has(b.parentNoteId) && b.parentNoteId !== "none") { dist.set(b.parentNoteId, d); next.push(b.parentNoteId); }
      frontier = next;
    }
    return dist;
  }
  /** Own attributes (creation order) followed by the inheritable ones of every ancestor. */
  function allAttrs(id) {
    const n = notes.get(id);
    const out = n.attrIds.map((i) => attrs.get(i)); // creation order (the real server does not re-sort after a PATCH of `position`)
    for (const anc of ancestors(id).keys()) {
      for (const aid of notes.get(anc)?.attrIds ?? []) { const a = attrs.get(aid); if (a.isInheritable) out.push(a); }
    }
    return out;
  }

  Object.assign(store, { genId, putNote, putAttachment, addBranch, addAttr, removeAttr, removeBranch, deleteNote, isDescendant, ancestors, allAttrs, sortedChildren, parentBr, childBr });

  // the two notes every Trilium has
  putNote({ noteId: "root", title: "root", type: "text", mime: "text/html" });
  branches.set("none_root", { branchId: "none_root", noteId: "root", parentNoteId: "none", prefix: null, notePosition: 10, isExpanded: true, utcDateModified: stamp().utc });
  parentBr.set("root", [branches.get("none_root")]);
  putNote({ noteId: "_hidden", title: "Hidden Notes", type: "text", mime: "text/html" });
  addBranch("_hidden", "root", { notePosition: 999999 });
  return store;
}

/** Load a generated vault into the store (no HTTP; same end state as tools/lib/vault-apply.mjs). */
export function loadVault(store, vault, { markdownType = false } = {}) {
  const ids = new Map();
  for (const n of vault.notes) {
    const id = store.genId(store.notes);
    ids.set(n.key, id);
    const content = n.bytes ?? Buffer.from(n.refs ? resolveRefs(n.content, () => "root") : n.content, "utf8");
    store.putNote({ noteId: id, title: n.title, type: wireType(n, { markdownType }), mime: n.mime || DEFAULT_MIME[n.type] || "", content });
    store.addBranch(id, n.parent === "@root" ? "root" : ids.get(n.parent), { notePosition: n.position });
  }
  for (const n of vault.notes) {
    const id = ids.get(n.key);
    for (const l of n.labels) store.addAttr({ noteId: id, type: "label", name: l.name, value: l.value, isInheritable: l.inheritable });
    for (const r of n.relations) store.addAttr({ noteId: id, type: "relation", name: r.name, value: ids.get(r.target) });
    if (n.refs) setContent(store, id, Buffer.from(resolveRefs(n.content, (k) => ids.get(k)), "utf8"));
    for (const p of n.clones) store.addBranch(id, ids.get(p));
  }
  return { ids, topNoteId: ids.get(vault.notes[0].key) };
}
function setContent(store, id, buf) {
  const n = store.notes.get(id);
  const t = stamp();
  n.content = buf; n.blobId = blobIdOf(buf); n.dateModified = t.local; n.utcDateModified = t.utc;
}

// ---------------------------------------------------------------------------------------------
// JSON shapes (field order as on the real server)
// ---------------------------------------------------------------------------------------------

const attrJson = (a) => ({ attributeId: a.attributeId, noteId: a.noteId, type: a.type, name: a.name, value: a.value, position: a.position, isInheritable: a.isInheritable, utcDateModified: a.utcDateModified });
/** `full` = the GET / PATCH shape (adds utcDateScheduledForErasureSince + contentLength); the POST answer lacks both. */
const attachmentJson = (a, full = true) => ({
  attachmentId: a.attachmentId, ownerId: a.ownerId, role: a.role, mime: a.mime, title: a.title, position: a.position, blobId: a.blobId,
  dateModified: a.dateModified, utcDateModified: a.utcDateModified,
  ...(full ? { utcDateScheduledForErasureSince: null, contentLength: a.content.length } : {}),
});
const branchJson = (b) => ({ branchId: b.branchId, noteId: b.noteId, parentNoteId: b.parentNoteId, prefix: b.prefix, notePosition: b.notePosition, isExpanded: b.isExpanded, utcDateModified: b.utcDateModified });
function noteJson(store, n) {
  const pbs = store.parentBr.get(n.noteId) ?? [];
  const cbs = store.sortedChildren(n.noteId);
  return {
    noteId: n.noteId, isProtected: false, title: n.title, type: n.type, mime: n.mime, blobId: n.blobId,
    dateCreated: n.dateCreated, dateModified: n.dateModified, utcDateCreated: n.utcDateCreated, utcDateModified: n.utcDateModified,
    parentNoteIds: pbs.filter((b) => b.parentNoteId !== "none").map((b) => b.parentNoteId),
    childNoteIds: cbs.map((b) => b.noteId),
    parentBranchIds: pbs.map((b) => b.branchId),
    childBranchIds: cbs.map((b) => b.branchId),
    attributes: store.allAttrs(n.noteId).map(attrJson),
  };
}

// ---------------------------------------------------------------------------------------------
// Search (subset of Trilium's language, see the header)
// ---------------------------------------------------------------------------------------------

const OPS = ["*=*", "!=", "%=", ">=", "<=", "=*", "*=", "=", ">", "<"];
function tokenize(q) {
  const toks = [];
  let i = 0;
  const ws = () => { while (i < q.length && /\s/.test(q[i])) i++; };
  const readValue = () => {
    ws();
    if (q[i] === '"' || q[i] === "'") { const c = q[i++]; const s = i; while (i < q.length && q[i] !== c) i++; const v = q.slice(s, i); i++; return v; }
    const s = i; while (i < q.length && !/[\s()]/.test(q[i])) i++; return q.slice(s, i);
  };
  const readOp = () => { ws(); for (const op of OPS) if (q.startsWith(op, i)) { i += op.length; return op; } return null; };
  while (i < q.length) {
    ws();
    if (i >= q.length) break;
    const c = q[i];
    if (c === "(" || c === ")") { toks.push({ t: c }); i++; continue; }
    if (c === '"' || c === "'") { toks.push({ t: "phrase", v: readValue() }); continue; }
    if (c === "#" || c === "~") {
      i++;
      const neg = c === "#" && q[i] === "!" ? (i++, true) : false;
      const s = i; while (i < q.length && !/[\s=!*%<>()"'.]/.test(q[i])) i++;
      const name = q.slice(s, i);
      let prop = null;
      if (c === "~" && q[i] === ".") { i++; const ps = i; while (i < q.length && !/[\s=!*%<>()"']/.test(q[i])) i++; prop = q.slice(ps, i); }
      const op = readOp();
      toks.push({ t: c === "#" ? "label" : "relation", name, neg, prop, op, v: op ? readValue() : null });
      continue;
    }
    const pm = /^note\.[A-Za-z.]+/.exec(q.slice(i));
    if (pm) {
      i += pm[0].length;
      const op = readOp();
      toks.push({ t: "prop", prop: pm[0].slice(5), op, v: op ? readValue() : null });
      continue;
    }
    const s = i; while (i < q.length && !/[\s()"']/.test(q[i])) i++;
    const w = q.slice(s, i);
    if (/^(and|or)$/i.test(w)) toks.push({ t: w.toLowerCase() }); else toks.push({ t: "word", v: w });
  }
  return toks;
}
function parseQuery(q) {
  const toks = tokenize(q);
  let p = 0;
  const atom = () => {
    const t = toks[p];
    if (!t) return null;
    if (t.t === "(") { p++; const e = orExpr(); if (toks[p]?.t === ")") p++; return e; }
    if (t.t === ")" || t.t === "and" || t.t === "or") { p++; return atom(); }
    p++;
    return t;
  };
  const andExpr = () => {
    const xs = [];
    for (;;) {
      if (toks[p]?.t === "and") p++;
      if (p >= toks.length || toks[p].t === "or" || toks[p].t === ")") break;
      const a = atom();
      if (a) xs.push(a);
    }
    return { t: "and", xs };
  };
  const orExpr = () => {
    const xs = [andExpr()];
    while (toks[p]?.t === "or") { p++; xs.push(andExpr()); }
    return xs.length === 1 ? xs[0] : { t: "or", xs };
  };
  const out = [];
  while (p < toks.length) { out.push(orExpr()); if (toks[p]?.t === ")") p++; }
  return { t: "and", xs: out };
}
function cmp(op, actual, expected) {
  if (actual === undefined || actual === null) return false;
  if (op === ">" || op === ">=" || op === "<" || op === "<=") {
    const a = Number(actual), b = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
  }
  const a = norm(actual), b = norm(expected);
  switch (op) {
    case "=": return a === b;
    case "!=": return a !== b;
    case "*=*": return a.includes(b);
    case "=*": return a.startsWith(b);
    case "*=": return a.endsWith(b);
    case "%=": try { return new RegExp(expected, "i").test(String(actual)); } catch { return false; }
    default: return false;
  }
}
const stripHtml = (h) => h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const isTextual = (n) => n.type === "text" || n.type === "book" || /^text\/|json|xml|javascript/.test(n.mime);
function contentText(n) {
  if (!isTextual(n)) return "";
  const s = n.content.toString("utf8");
  return n.type === "text" ? stripHtml(s) : s;
}

function evalTerm(store, n, t, opts) {
  const attrsOf = store.allAttrs(n.noteId);
  switch (t.t) {
    case "and": return t.xs.every((x) => evalTerm(store, n, x, opts));
    case "or": return t.xs.some((x) => evalTerm(store, n, x, opts));
    case "word": case "phrase": {
      if (t.v === "") return true;
      const hay = norm(`${n.title} ${attrsOf.filter((a) => a.noteId === n.noteId).map((a) => `${a.name} ${a.value}`).join(" ")} ${opts.fast ? "" : contentText(n)}`);
      return hay.includes(norm(t.v));
    }
    case "label": {
      if (t.name === "") return true;
      const hits = attrsOf.filter((a) => a.type === "label" && norm(a.name) === norm(t.name));
      if (t.neg) return hits.length === 0;
      return t.op ? hits.some((a) => cmp(t.op, a.value, t.v)) : hits.length > 0;
    }
    case "relation": {
      const hits = attrsOf.filter((a) => a.type === "relation" && norm(a.name) === norm(t.name));
      if (!t.op) return hits.length > 0;
      return hits.some((a) => { const target = store.notes.get(a.value); return target && cmp(t.op, t.prop === "title" ? target.title : target.noteId, t.v); });
    }
    case "prop": {
      const get = (note) => ({ title: note.title, type: note.type, mime: note.mime, noteid: note.noteId, content: contentText(note), isarchived: store.allAttrs(note.noteId).some((a) => a.type === "label" && a.name.toLowerCase() === "archived") ? "true" : "false", datecreated: note.dateCreated, datemodified: note.dateModified, utcdatecreated: note.utcDateCreated, utcdatemodified: note.utcDateModified });
      const p = t.prop.toLowerCase();
      const test = (val) => (t.op ? cmp(t.op, val, t.v) : val === "true");
      const m = /^(parents|children|ancestors)\.(title|noteid)$/.exec(p);
      if (m) {
        const ids = m[1] === "parents" ? (store.parentBr.get(n.noteId) ?? []).map((b) => b.parentNoteId) : m[1] === "children" ? store.sortedChildren(n.noteId).map((b) => b.noteId) : [...store.ancestors(n.noteId).keys()];
        return ids.some((id) => store.notes.has(id) && test(get(store.notes.get(id))[m[2]]));
      }
      const counts = { labelcount: attrsOf.filter((a) => a.type === "label").length, relationcount: attrsOf.filter((a) => a.type === "relation").length, attributecount: attrsOf.length, childrencount: store.sortedChildren(n.noteId).length, parentcount: (store.parentBr.get(n.noteId) ?? []).length };
      if (p in counts) return test(String(counts[p]));
      const v = get(n)[p];
      return v === undefined ? true : test(v); // an unknown property matches everything (as on the real server)
    }
    default: return true;
  }
}

function search(store, params) {
  const q = params.get("search");
  if (q === null || q === "") throw new EtapiError(400, "SEARCH_QUERY_PARAM_MANDATORY", "'search' query parameter is mandatory.");
  let limit = 0;
  if (params.has("limit")) {
    const raw = params.get("limit");
    if (!/^-?\d+$/.test(raw)) throw new EtapiError(400, "SEARCH_PARAM_VALIDATION_ERROR", `Cannot parse integer 'limit' value '${raw}'.`);
    limit = Number(raw);
  }
  const ast = parseQuery(q);
  const includeArchived = params.get("includeArchivedNotes") === "true";
  const anc = params.get("ancestorNoteId");
  const depthSpec = params.get("ancestorDepth");
  const opts = { fast: params.get("fastSearch") === "true" };
  // tree order (depth-first from root, clones once)
  const order = [], seen = new Set();
  const walk = (id) => { if (seen.has(id)) return; seen.add(id); order.push(id); for (const b of store.sortedChildren(id)) walk(b.noteId); };
  walk("root");
  const hiddenSub = new Set(); // _hidden subtree
  const markHidden = (id) => { if (hiddenSub.has(id)) return; hiddenSub.add(id); for (const b of store.sortedChildren(id)) markHidden(b.noteId); };
  markHidden("_hidden");
  const ancDist = anc ? (store.notes.has(anc) ? null : "none") : null;
  let hits = [];
  for (const id of order) {
    if (hiddenSub.has(id)) continue;
    const n = store.notes.get(id);
    if (anc) {
      if (ancDist === "none") break;
      const d = id === anc ? 0 : store.ancestors(id).get(anc); // the ancestor itself is part of the scope (as on the real server)
      if (d === undefined) continue;
      if (depthSpec) { const m = /^(eq|lt|gt)(\d+)$/.exec(depthSpec); if (m) { const k = Number(m[2]); if (m[1] === "eq" ? d !== k : m[1] === "lt" ? !(d < k) : !(d > k)) continue; } }
    }
    if (!includeArchived && store.allAttrs(id).some((a) => a.type === "label" && a.name.toLowerCase() === "archived")) continue;
    if (evalTerm(store, n, ast, opts)) hits.push(n);
  }
  const ob = params.get("orderBy");
  if (ob) {
    const key = ob.replace(/^note\./, "").toLowerCase();
    const dir = params.get("orderDirection") === "desc" ? -1 : 1;
    const pick = (n) => ({ title: n.title, datemodified: n.utcDateModified, datecreated: n.utcDateCreated, noteid: n.noteId }[key] ?? "");
    hits = hits.slice().sort((a, b) => (norm(pick(a)) < norm(pick(b)) ? -dir : norm(pick(a)) > norm(pick(b)) ? dir : 0));
  }
  if (limit > 0) hits = hits.slice(0, limit);
  return { results: hits.map((n) => noteJson(store, n)) };
}

// ---------------------------------------------------------------------------------------------
// Request validation helpers (messages copied from the real server)
// ---------------------------------------------------------------------------------------------

function checkProps(body, allowed, schema) {
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new EtapiError(400, "PROPERTY_NOT_ALLOWED", `Property '${k}' is not allowed for this method.`);
  for (const [k, kind] of Object.entries(schema)) {
    const v = body[k];
    if (v === undefined) continue;
    if (kind === "string" && typeof v !== "string") throw bad(k, `'${v}' is not a string.`);
    if (kind === "integer" && !Number.isInteger(v)) throw bad(k, `'${v}' is not an integer.`);
    if (kind === "boolean" && typeof v !== "boolean") throw bad(k, `'${v}' is not a boolean.`);
  }
}
const asObject = (b) => (b && typeof b === "object" && !Array.isArray(b) ? b : {});

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

export async function startFake({ port = 0, host = "127.0.0.1", seed, vaultSeed = 1, password = "biblio-test-pw", token, markdownType = false, idSeed = 1 } = {}) {
  const store = createStore({ idSeed, markdownType });
  const tokens = new Set();
  const mint = () => { const t = randomBytes(33).toString("base64"); tokens.add(t); return t; };
  const theToken = token ?? mint();
  tokens.add(theToken);
  let seeded = null;
  if (seed) {
    const vault = generateVault(seed, { seed: vaultSeed });
    seeded = { profile: seed, notes: vault.notes.length, ...loadVault(store, vault, { markdownType }) };
  }
  const login = { count: 0, resetAt: Date.now() + 15 * 60 * 1000 }; // 10 attempts per window, as the real X-RateLimit-* headers say

  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type" };
  const sendJson = (res, status, obj, extra = {}) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8", "Content-Length": b.length, ...extra }); res.end(b); };
  const sendEmpty = (res, status) => { res.writeHead(status, CORS); res.end(); };

  function authed(req) {
    const h = req.headers.authorization;
    if (!h) return false;
    if (tokens.has(h)) return true;
    const bearer = /^Bearer\s+(.+)$/i.exec(h);
    if (bearer && tokens.has(bearer[1])) return true;
    const basic = /^Basic\s+(.+)$/i.exec(h);
    if (basic) { const dec = Buffer.from(basic[1], "base64").toString("utf8"); const i = dec.indexOf(":"); if (i >= 0 && tokens.has(dec.slice(i + 1))) return true; }
    return false;
  }
  const getNote = (id) => { const n = store.notes.get(id); if (!n) throw noteNotFound(id); return n; };

  async function route(req, res, url, body) {
    const m = req.method;
    const p = url.pathname.replace(/^\/etapi/, "") || "/";
    const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
    const json = () => {
      if (!body.length) return {};
      if (!/json/i.test(req.headers["content-type"] ?? "")) return {};
      try { return JSON.parse(body.toString("utf8")); } catch (e) { throw new EtapiError(500, undefined, e.message); }
    };

    if (m === "POST" && p === "/auth/login") {
      const now = Date.now();
      if (now > login.resetAt) { login.count = 0; login.resetAt = now + 15 * 60 * 1000; }
      const rl = (n) => ({ "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": String(Math.max(0, 10 - n)), "X-RateLimit-Reset": String(Math.ceil(login.resetAt / 1000)) });
      if (login.count >= 10) return sendJson(res, 429, { status: 429, code: "TOO_MANY_REQUESTS", message: "Too many requests, please try again later." }, rl(login.count));
      login.count++;
      const b = json();
      if (typeof b.password !== "string") throw generic('The "password" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received undefined');
      if (b.password !== password) return sendJson(res, 401, { status: 401, code: "WRONG_PASSWORD", message: "Wrong password." }, rl(login.count));
      return sendJson(res, 201, { authToken: mint() }, rl(login.count));
    }
    if (!authed(req)) throw new EtapiError(401, "NOT_AUTHENTICATED", "Not authenticated");

    if (m === "POST" && p === "/auth/logout") { tokens.delete(req.headers.authorization.replace(/^Bearer\s+/i, "")); return sendEmpty(res, 204); }
    if (m === "GET" && p === "/app-info") {
      return sendJson(res, 200, { appVersion: "0.106.0", dbVersion: 240, syncVersion: 39, buildDate: "2026-09-25T18:09:29Z", buildRevision: "etapi-fake", clipperProtocolVersion: "1.0", utcDateTime: new Date().toISOString(), nodeVersion: process.version, dataDirectory: "(in-memory etapi-fake)" });
    }

    // --- notes
    if (m === "GET" && p === "/notes") return sendJson(res, 200, search(store, url.searchParams));
    if (seg[0] === "notes" && seg.length === 2) {
      if (m === "GET") return sendJson(res, 200, noteJson(store, getNote(seg[1])));
      if (m === "PATCH") {
        const n = getNote(seg[1]);
        const b = asObject(json());
        checkProps(b, ["title", "type", "mime", "dateCreated", "utcDateCreated"], { title: "string", type: "string", mime: "string", dateCreated: "string", utcDateCreated: "string" });
        if (b.type !== undefined && !store.noteTypes.includes(b.type)) throw bad("type", `'${b.type}' is not a valid note type, allowed types are: ${store.noteTypes.join(", ")}.`);
        for (const k of ["title", "type", "mime"]) if (b[k] !== undefined) n[k] = b[k];
        n.utcDateModified = stamp().utc; n.dateModified = stamp().local;
        return sendJson(res, 200, noteJson(store, n));
      }
      if (m === "DELETE") {
        if (seg[1] === "root" || seg[1].startsWith("_")) throw new EtapiError(400, "CANNOT_DELETE_SYSTEM_NOTE", `Note '${seg[1]}' cannot be deleted.`);
        store.deleteNote(seg[1]);
        return sendEmpty(res, 204);
      }
    }
    if (seg[0] === "notes" && seg[2] === "content" && seg.length === 3) {
      const n = getNote(seg[1]);
      if (m === "GET") {
        const ext = EXT[n.mime] ?? "dat";
        const name = `${n.title.replace(/[^\w.-]+/g, "_") || "note"}.${ext}`;
        const textual = isTextual(n);
        res.writeHead(200, { ...CORS, "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Content-Type": n.mime ? (textual ? `${n.mime}; charset=utf-8` : n.mime) : "application/octet-stream", "Content-Length": n.content.length });
        return res.end(n.content);
      }
      if (m === "PUT") {
        const ct = req.headers["content-type"] ?? "";
        if (/json/i.test(ct) && body.length) throw generic('The "list" argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView.');
        if (!/^(text\/plain|application\/octet-stream)/i.test(ct)) throw generic(`Cannot set null content to noteId '${n.noteId}'`);
        setContent(store, n.noteId, Buffer.from(body));
        return sendEmpty(res, 204);
      }
    }
    if (m === "POST" && p === "/create-note") {
      const b = asObject(json());
      checkProps(b, ["parentNoteId", "title", "type", "mime", "content", "notePosition", "prefix", "isExpanded", "noteId", "branchId", "dateCreated", "utcDateCreated"], { parentNoteId: "string", title: "string", type: "string", mime: "string", content: "string", notePosition: "integer", prefix: "string", isExpanded: "boolean", noteId: "string", branchId: "string", dateCreated: "string", utcDateCreated: "string" });
      if (b.parentNoteId !== undefined && !store.notes.has(b.parentNoteId)) throw bad("parentNoteId", `Note '${b.parentNoteId}' does not exist.`);
      if (b.type !== undefined && !store.noteTypes.includes(b.type)) throw bad("type", `'${b.type}' is not a valid note type, allowed types are: ${store.noteTypes.join(", ")}.`);
      if (b.content === undefined) throw generic("Note content must be set");
      if (b.type === undefined) throw generic("Note type is a required param");
      if (b.parentNoteId === undefined) throw generic("noteId and parentNoteId are mandatory properties for Branch");
      const id = b.noteId && !store.notes.has(b.noteId) ? b.noteId : store.genId(store.notes);
      const n = store.putNote({ noteId: id, title: b.title ?? "New note", type: b.type, mime: b.mime ?? DEFAULT_MIME[b.type] ?? "", content: Buffer.from(b.content, "utf8") });
      const { branch } = store.addBranch(id, b.parentNoteId, { notePosition: b.notePosition, prefix: b.prefix ?? null, isExpanded: b.isExpanded ?? false });
      return sendJson(res, 201, { note: noteJson(store, n), branch: branchJson(branch) });
    }

    // --- attachments (shapes and errors verified against v0.106.0)
    if (m === "GET" && seg[0] === "notes" && seg[2] === "attachments" && seg.length === 3) {
      getNote(seg[1]);
      return sendJson(res, 200, [...store.attachments.values()].filter((a) => a.ownerId === seg[1]).sort((a, b) => a.position - b.position).map((a) => attachmentJson(a)));
    }
    if (m === "POST" && p === "/attachments") {
      const b = asObject(json());
      checkProps(b, ["ownerId", "role", "mime", "title", "content", "position"], { ownerId: "string", role: "string", mime: "string", title: "string", content: "string", position: "integer" });
      if (b.ownerId === undefined) throw generic("Missing owner ID.");
      if (!store.notes.has(b.ownerId)) throw bad("ownerId", `Note '${b.ownerId}' does not exist.`);
      const a = store.putAttachment({ ownerId: b.ownerId, role: b.role, mime: b.mime, title: b.title, position: b.position, content: Buffer.from(b.content ?? "", "utf8") });
      return sendJson(res, 201, attachmentJson(a, false));
    }
    if (seg[0] === "attachments" && seg.length === 2) {
      if (m === "DELETE") { store.attachments.delete(seg[1]); return sendEmpty(res, 204); } // idempotent, like the real server
      const a = store.attachments.get(seg[1]);
      if (!a) throw attachmentNotFound(seg[1]);
      if (m === "GET") return sendJson(res, 200, attachmentJson(a));
      if (m === "PATCH") {
        const b = asObject(json());
        checkProps(b, ["role", "mime", "title", "position"], { role: "string", mime: "string", title: "string", position: "integer" });
        for (const k of ["role", "mime", "title", "position"]) if (b[k] !== undefined) a[k] = b[k];
        const t = stamp(); a.dateModified = t.local; a.utcDateModified = t.utc;
        return sendJson(res, 200, attachmentJson(a));
      }
    }
    if (seg[0] === "attachments" && seg[2] === "content" && seg.length === 3) {
      const a = store.attachments.get(seg[1]);
      if (!a) throw attachmentNotFound(seg[1]);
      if (m === "GET") {
        const name = (a.title || "attachment").replace(/[^\w.-]+/g, "_");
        const textual = /^text\/|json|xml|javascript/.test(a.mime);
        res.writeHead(200, { ...CORS, "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Content-Type": a.mime ? (textual ? `${a.mime}; charset=utf-8` : a.mime) : "application/octet-stream", "Content-Length": a.content.length });
        return res.end(a.content);
      }
      if (m === "PUT") {
        const ct = req.headers["content-type"] ?? "";
        if (/json/i.test(ct) && body.length) throw generic('The "list" argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView.');
        if (!/^(text\/plain|application\/octet-stream)/i.test(ct)) throw generic(`Cannot set null content to attachmentId '${a.attachmentId}'`);
        a.content = Buffer.from(body); a.blobId = blobIdOf(a.content);
        const t = stamp(); a.dateModified = t.local; a.utcDateModified = t.utc;
        return sendEmpty(res, 204);
      }
    }

    // --- attributes
    if (m === "POST" && p === "/attributes") {
      const b = asObject(json());
      checkProps(b, ["attributeId", "noteId", "type", "name", "value", "position", "isInheritable"], { attributeId: "string", noteId: "string", type: "string", name: "string", value: "string", position: "integer", isInheritable: "boolean" });
      if (b.type !== undefined && !["label", "relation"].includes(b.type)) throw bad("type", `'${b.type}' is not a valid attribute type, allowed types are: label, relation.`);
      if (b.noteId !== undefined && !store.notes.has(b.noteId)) throw bad("noteId", `Note '${b.noteId}' does not exist.`);
      if (b.noteId === undefined) throw generic("NOT NULL constraint failed: attributes.noteId");
      if (b.type === undefined) throw generic(`Invalid attribute type 'undefined' in attribute 'undefined' of note '${b.noteId}'`);
      if (b.name === undefined) throw generic("Cannot read properties of undefined (reading 'toLowerCase')");
      if (normName(b.name) === "") throw generic(`Invalid empty name in attribute 'undefined' of note '${b.noteId}'`);
      if (b.type === "relation" && !store.notes.has(b.value ?? "")) throw noteNotFound(b.value);
      return sendJson(res, 201, attrJson(store.addAttr(b)));
    }
    if (seg[0] === "attributes" && seg.length === 2) {
      const a = store.attrs.get(seg[1]);
      if (m === "DELETE") { store.removeAttr(seg[1]); return sendEmpty(res, 204); }
      if (m === "GET" || m === "PATCH") {
        if (!a) throw new EtapiError(404, "ATTRIBUTE_NOT_FOUND", `Attribute '${seg[1]}' not found.`);
        if (m === "PATCH") {
          const b = asObject(json());
          checkProps(b, ["value", "position"], { value: "string", position: "integer" });
          if (b.value !== undefined) a.value = b.value;
          if (b.position !== undefined) a.position = b.position;
          a.utcDateModified = stamp().utc;
        }
        return sendJson(res, 200, attrJson(a));
      }
    }

    // --- branches
    if (m === "POST" && p === "/branches") {
      const b = asObject(json());
      checkProps(b, ["noteId", "parentNoteId", "notePosition", "prefix", "isExpanded"], { noteId: "string", parentNoteId: "string", notePosition: "integer", prefix: "string", isExpanded: "boolean" });
      if (b.noteId !== undefined && !store.notes.has(b.noteId)) throw bad("noteId", `Note '${b.noteId}' does not exist.`);
      if (b.parentNoteId !== undefined && !store.notes.has(b.parentNoteId)) throw bad("parentNoteId", `Note '${b.parentNoteId}' does not exist.`);
      if (b.noteId === undefined || b.parentNoteId === undefined) throw generic("noteId and parentNoteId are mandatory properties for Branch", 400);
      if (store.isDescendant(b.parentNoteId, b.noteId)) throw bad("parentNoteId", "cloning here would create a cycle (the real Trilium accepts this and corrupts itself; the fake refuses).");
      const { branch, created } = store.addBranch(b.noteId, b.parentNoteId, { notePosition: b.notePosition, prefix: b.prefix, isExpanded: b.isExpanded });
      return sendJson(res, created ? 201 : 200, branchJson(branch));
    }
    if (seg[0] === "branches" && seg.length === 2) {
      const br = store.branches.get(seg[1]);
      if (m === "DELETE") {
        if (br && (br.noteId === "root" || br.noteId.startsWith("_"))) throw new EtapiError(400, "CANNOT_DELETE_SYSTEM_NOTE", "Cannot delete system notes");
        if (br) {
          store.removeBranch(br);
          if ((store.parentBr.get(br.noteId) ?? []).length === 0) store.deleteNote(br.noteId); // last branch = the note goes
        }
        return sendEmpty(res, 204);
      }
      if (m === "GET" || m === "PATCH") {
        if (!br) throw new EtapiError(404, "BRANCH_NOT_FOUND", `Branch '${seg[1]}' not found.`);
        if (m === "PATCH") {
          const b = asObject(json());
          checkProps(b, ["notePosition", "prefix", "isExpanded"], { notePosition: "integer", prefix: "string", isExpanded: "boolean" });
          for (const k of ["notePosition", "prefix", "isExpanded"]) if (b[k] !== undefined) br[k] = b[k];
          br.utcDateModified = stamp().utc;
        }
        return sendJson(res, 200, branchJson(br));
      }
    }
    if (m === "POST" && seg[0] === "refresh-note-ordering" && seg.length === 2) { getNote(seg[1]); return sendEmpty(res, 204); }

    return sendJson(res, 404, { message: `Router not found for request ${m} ${url.pathname}` });
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://fake");
      try {
        if (req.method === "OPTIONS") return sendEmpty(res, 204); // CORS preflight: no auth, like the real server
        if (url.pathname.startsWith("/etapi/") || url.pathname === "/etapi") return await route(req, res, url, Buffer.concat(chunks));
        if (url.pathname === "/api/setup/status") return sendJson(res, 200, { isInitialized: true, schemaExists: true, syncVersion: 39 });
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("etapi-fake: an in-memory stand-in for Trilium's ETAPI (tools/etapi-fake.mjs)\n");
      } catch (e) {
        const status = e instanceof EtapiError ? e.status : 500;
        // the real server's last-resort handler answers {message} only; every ETAPI error has the full envelope
        const bodyOut = e instanceof EtapiError && e.code === undefined ? { message: e.message } : { status, code: e.code ?? "GENERIC", message: e.message };
        sendJson(res, status, bodyOut);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const addr = server.address();
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${addr.port}`;
  return {
    url, token: theToken, password, store, seeded,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`usage: node tools/etapi-fake.mjs [--seed <profile>] [--port N] [--host H] [--password P] [--token T] [--vault-seed N] [--markdown-type]\nprofiles: ${Object.keys(PROFILES).join(", ")}`);
    process.exit(0);
  }
  const profile = opt("seed");
  if (profile && !PROFILES[profile]) { console.error(`etapi-fake: unknown profile "${profile}" (known: ${Object.keys(PROFILES).join(", ")})`); process.exit(1); }
  const f = await startFake({ port: Number(opt("port") ?? 0), host: opt("host") ?? "127.0.0.1", seed: profile, vaultSeed: Number(opt("vault-seed") ?? 1), password: opt("password") ?? "biblio-test-pw", token: opt("token"), markdownType: args.includes("--markdown-type") });
  console.log(`etapi-fake listening on ${f.url}${f.seeded ? ` (profile ${f.seeded.profile}: ${f.seeded.notes} notes, top note ${f.seeded.topNoteId})` : " (empty)"}; login password: ${f.password}`);
  console.log(`TRILIUM_URL=${f.url}`);
  console.log(`TRILIUM_TOKEN=${f.token}`);
  const stop = () => f.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
