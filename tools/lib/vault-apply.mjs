/**
 * tools/lib/vault-apply.mjs — write a generated vault (tools/lib/vault-gen.mjs) into a Trilium-compatible server
 * through ETAPI. Works against the real mock and against tools/etapi-fake.mjs (that is how mock-test.mjs proves the
 * two agree). No safety checks here: callers (tools/seed-vault.js) decide which server may be written to.
 *
 * `api(method, path, body?, raw?)` -> parsed JSON (or null for 204/empty). `raw` = {body: Buffer, contentType}
 * sends bytes instead of JSON (binary note content).
 */
import { resolveRefs } from "./vault-gen.mjs";

/** Run `fn(item)` over `items` with at most `n` in flight; first error rejects. */
export async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** The note type to send for a spec: markdown notes are `code` + mime text/x-markdown (ETAPI has no "markdown" type). */
export function wireType(spec, { markdownType = false } = {}) {
  return spec.markdown && markdownType ? "markdown" : spec.type;
}

export async function applyVault(vault, { api, parentNoteId = "root", poolSize = 8, onProgress = () => {}, markdownType = false } = {}) {
  const ids = new Map(); // key -> noteId
  const byKey = new Map(vault.notes.map((n) => [n.key, n]));
  const depth = (n) => { let d = 0; while (byKey.has(n.parent)) { n = byKey.get(n.parent); d++; } return d; };
  const levels = [];
  for (const n of vault.notes) (levels[depth(n)] ??= []).push(n);

  const total = vault.notes.length;
  let done = 0;
  // 1. structure, level by level (a parent must exist first); explicit notePosition keeps sibling order deterministic
  for (const level of levels) {
    await pool(level, poolSize, async (n) => {
      const body = {
        parentNoteId: byKey.has(n.parent) ? ids.get(n.parent) : parentNoteId,
        title: n.title,
        type: wireType(n, { markdownType }),
        content: n.bytes ? "" : n.refs ? resolveRefs(n.content, () => "root") : n.content,
        notePosition: n.position,
      };
      if (n.mime && !(n.type === "text" && n.mime === "text/html")) body.mime = n.mime;
      const res = await api("POST", "/create-note", body);
      ids.set(n.key, res.note.noteId);
      if (n.bytes) await api("PUT", `/notes/${res.note.noteId}/content`, undefined, { body: n.bytes, contentType: "application/octet-stream" });
      onProgress({ phase: "notes", done: ++done, total });
    });
  }
  // 2. labels + relations: sequential per note (attribute positions), parallel across notes
  const withAttrs = vault.notes.filter((n) => n.labels.length || n.relations.length);
  let adone = 0;
  await pool(withAttrs, poolSize, async (n) => {
    const noteId = ids.get(n.key);
    for (const l of n.labels) await api("POST", "/attributes", { noteId, type: "label", name: l.name, value: l.value, isInheritable: l.inheritable });
    for (const rel of n.relations) await api("POST", "/attributes", { noteId, type: "relation", name: rel.name, value: ids.get(rel.target) });
    onProgress({ phase: "attributes", done: ++adone, total: withAttrs.length });
  });
  // 3. internal links need every id: rewrite those notes' content
  const withRefs = vault.notes.filter((n) => n.refs);
  let rdone = 0;
  await pool(withRefs, poolSize, async (n) => {
    await api("PUT", `/notes/${ids.get(n.key)}/content`, undefined, { body: Buffer.from(resolveRefs(n.content, (k) => ids.get(k))), contentType: "text/plain" });
    onProgress({ phase: "links", done: ++rdone, total: withRefs.length });
  });
  // 4. clones
  const clones = vault.notes.flatMap((n) => n.clones.map((p) => [n, p]));
  let cdone = 0;
  await pool(clones, poolSize, async ([n, p]) => {
    await api("POST", "/branches", { noteId: ids.get(n.key), parentNoteId: ids.get(p) });
    onProgress({ phase: "clones", done: ++cdone, total: clones.length });
  });
  return { ids, topNoteId: ids.get(vault.notes[0].key) };
}
