/**
 * tools/seed-docs.mjs — builds the "Bibliotheca Docs" note tree in a Trilium instance from this repo.
 * No model involved: it converts files that already exist, so re-running it after a code change refreshes the docs.
 *
 *   Bibliotheca Docs
 *   ├─ About            README.md
 *   ├─ Guides/          wiki/*.md (links between pages and to source files become Trilium links)
 *   ├─ Internals        AGENTS.md (the agent-oriented reference)
 *   ├─ Tools            tools/README.md
 *   └─ Code reference/  one note per src/**\/*.ts(x): its header comment + the exported names
 *
 * Usage:   DOCS_TRILIUM_URL=https://docs.example.org DOCS_TRILIUM_TOKEN=... node tools/seed-docs.mjs [--dry-run]
 *          node tools/seed-docs.mjs --mock      (uses .bootstrap.env: the disposable mock; for trying it out)
 * It deletes and rebuilds ONLY the top-level note titled "Bibliotheca Docs". It never reads .bootstrap.env unless
 * --mock is given, so a real docs instance can't be hit by accident from the mock's credentials.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, basename, resolve } from "node:path";
import { marked } from "marked";

const ROOT_TITLE = "Bibliotheca Docs";
const REPO_URL = "https://github.com/Lauruin/Trilium-Bibliotheca/blob/devbranch";
const repo = resolve(dirname(new URL(import.meta.url).pathname), "..");
const dry = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------------------------
// Target instance
// ---------------------------------------------------------------------------------------------
let URL_ = process.env.DOCS_TRILIUM_URL;
let TOKEN = process.env.DOCS_TRILIUM_TOKEN;
if (process.argv.includes("--mock")) {
  const raw = readFileSync(join(repo, ".bootstrap.env"), "utf8");
  URL_ = raw.match(/TRILIUM_URL=(.*)/m)?.[1];
  TOKEN = raw.match(/TRILIUM_TOKEN=(.*)/m)?.[1];
}
if (!dry && (!URL_ || !TOKEN)) {
  console.error("Set DOCS_TRILIUM_URL and DOCS_TRILIUM_TOKEN (or use --mock / --dry-run).");
  process.exit(2);
}
URL_ = URL_?.replace(/\/+$/, "");

async function api(path, init = {}, text = false) {
  const r = await fetch(`${URL_}/etapi${path}`, {
    ...init,
    headers: { Authorization: TOKEN, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${r.status} ${await r.text()}`);
  if (r.status === 204) return null;
  return text ? r.text() : r.json();
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------
const read = (p) => readFileSync(join(repo, p), "utf8");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function walk(dir, out = []) {
  for (const f of readdirSync(join(repo, dir)).sort()) {
    const p = join(dir, f);
    if (statSync(join(repo, p)).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** Header comment of a source file: the first block comment, or the leading // lines. */
export function headerOf(src) {
  const block = src.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  if (block) return block[1].split("\n").map((l) => l.replace(/^\s*\*? ?/, "")).join("\n").trim();
  const lines = [];
  for (const l of src.split("\n")) {
    if (/^\s*\/\//.test(l)) lines.push(l.replace(/^\s*\/\/ ?/, ""));
    else if (lines.length || l.trim() !== "") break;
  }
  return lines.join("\n").trim();
}

/** Exported names with the first line of the JSDoc right above them (if any). */
export function exportsOf(src) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|class|const|let|type|interface|enum)\s+(\w+)/);
    if (!m) continue;
    let doc = "";
    let j = i - 1;
    if (j >= 0 && /\*\/\s*$/.test(lines[j])) {
      let k = j;
      while (k > 0 && !/\/\*\*/.test(lines[k])) k--;
      doc = lines.slice(k, j + 1).join(" ").replace(/\/\*\*|\*\/|^\s*\*/g, "").replace(/\s*\*\s*/g, " ").trim();
      if (doc.length > 220) doc = `${doc.slice(0, 219)}…`;
    } else if (j >= 0 && /^\s*\/\//.test(lines[j])) {
      doc = lines[j].replace(/^\s*\/\/ ?/, "").trim();
    }
    out.push({ kind: m[1].replace("*", ""), name: m[2], doc });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Note plan: { key, parent, title, html | md, path? }  (links are resolved after every note exists)
// ---------------------------------------------------------------------------------------------
const plan = [];
const add = (n) => plan.push(n);

add({ key: "root", parent: null, title: ROOT_TITLE, html: marked.parse(
  "# Bibliotheca Docs\n\nDocumentation for **Bibliotheca**, a walkable library and a climbable tree built from a Trilium vault. " +
  "This vault is generated from the project's own files by `tools/seed-docs.mjs`: edit the repository, not these notes.\n\n" +
  "- **About**: what it is and how to run it.\n- **Guides**: how to use each part.\n- **Internals**: the architecture reference.\n" +
  "- **Tools**: the scripts.\n- **Code reference**: every source file, with its header comment and exported names.\n") });
add({ key: "about", parent: "root", title: "About", md: read("README.md"), path: "README.md" });

add({ key: "guides", parent: "root", title: "Guides", html: "<p>One note per wiki page.</p>" });
const wiki = readdirSync(join(repo, "wiki")).filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort();
wiki.sort((a, b) => (a === "Home.md" ? -1 : b === "Home.md" ? 1 : 0));
for (const f of wiki) add({ key: `wiki:${f}`, parent: "guides", title: basename(f, ".md").replace(/-/g, " "), md: read(`wiki/${f}`), path: `wiki/${f}` });

add({ key: "internals", parent: "root", title: "Internals", md: read("AGENTS.md"), path: "AGENTS.md" });
add({ key: "testing", parent: "root", title: "Local testing", md: read("LOCAL-TESTING.md"), path: "LOCAL-TESTING.md" });
add({ key: "tools", parent: "root", title: "Tools", md: read("tools/README.md"), path: "tools/README.md" });

add({ key: "code", parent: "root", title: "Code reference", html: "<p>Generated from the source: the header comment and the exported names of each file. The code itself is the final word.</p>" });
const dirKey = (d) => `dir:${d}`;
for (const file of walk("src")) {
  const dir = dirname(file);
  const parts = dir.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const d = parts.slice(0, i).join("/");
    if (!plan.some((n) => n.key === dirKey(d))) {
      add({ key: dirKey(d), parent: i === 1 ? "code" : dirKey(parts.slice(0, i - 1).join("/")), title: d, html: `<p>Source files in <code>${esc(d)}/</code>.</p>` });
    }
  }
  const src = read(file);
  const ex = exportsOf(src);
  const head = headerOf(src);
  let html = `<p><code>${esc(file)}</code> · ${src.split("\n").length} lines</p>`;
  html += head ? `<h2>Purpose</h2><pre>${esc(head)}</pre>` : "<p><em>No header comment.</em></p>";
  if (ex.length) {
    html += "<h2>Exports</h2><ul>" + ex.map((e) => `<li><code>${esc(e.kind)} ${esc(e.name)}</code>${e.doc ? ` · ${esc(e.doc)}` : ""}</li>`).join("") + "</ul>";
  }
  add({ key: `src:${file}`, parent: dirKey(dir), title: basename(file), html, path: file });
}

// ---------------------------------------------------------------------------------------------
// Link resolution: relative links to other docs / source files become Trilium links
// ---------------------------------------------------------------------------------------------
const keyOfPath = new Map();
for (const n of plan) if (n.path) keyOfPath.set(n.path, n.key);
const dirKeys = new Set(plan.map((n) => n.key));

function linkTarget(fromPath, href) {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return null;
  const [p] = href.split("#");
  if (!p) return null;
  const base = fromPath ? dirname(fromPath) : ".";
  const rel = relative(".", join(base, p)).replace(/\\/g, "/");
  for (const cand of [rel, `${rel}.md`, `wiki/${p}.md`, `wiki/${basename(p)}`]) {
    if (keyOfPath.has(cand)) return keyOfPath.get(cand);
  }
  if (dirKeys.has(dirKey(rel.replace(/\/$/, "")))) return dirKey(rel.replace(/\/$/, ""));
  return null;
}

function render(n, idOf) {
  let html = n.html ?? marked.parse(n.md, { gfm: true });
  html = html.replace(/href="([^"]*)"/g, (all, href) => {
    const k = linkTarget(n.path, href.replace(/&amp;/g, "&"));
    const plain = href.replace(/&amp;/g, "&");
    if (k && idOf.has(k)) return `href="#root/${idOf.get(k)}"`;
    // a repo file that has no note: point at the repository instead of leaving a dead relative link
    if (n.path && !/^[a-z]+:/i.test(plain) && !plain.startsWith("#") && plain !== "") {
      return `href="${REPO_URL}/${relative(".", join(dirname(n.path), plain.split("#")[0])).replace(/\\/g, "/")}"`;
    }
    return all;
  });
  return html;
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------
console.log(`${plan.length} notes planned (${plan.filter((n) => n.key.startsWith("src:")).length} source files, ${wiki.length} guides).`);
if (dry) {
  const broken = [];
  for (const n of plan) if (n.md) for (const m of marked.parse(n.md).matchAll(/href="([^"]*)"/g)) {
    const h = m[1].replace(/&amp;/g, "&");
    if (!/^[a-z]+:/i.test(h) && !h.startsWith("#") && !linkTarget(n.path, h)) broken.push(`${n.path}: ${h}`);
  }
  console.log(`relative links that stay plain text (no matching doc note): ${broken.length}`);
  for (const b of broken.slice(0, 25)) console.log("  " + b);
  process.exit(0);
}

const found = await api(`/notes?search=${encodeURIComponent(`note.title = "${ROOT_TITLE}"`)}&ancestorNoteId=root`);
for (const old of found.results.filter((r) => r.title === ROOT_TITLE && r.parentNoteIds?.includes("root"))) {
  await api(`/notes/${old.noteId}`, { method: "DELETE" });
  console.log(`removed old ${ROOT_TITLE} (${old.noteId})`);
}

const idOf = new Map();
for (const n of plan) {
  const parent = n.parent ? idOf.get(n.parent) : "root";
  const r = await api("/create-note", {
    method: "POST",
    body: JSON.stringify({ parentNoteId: parent, title: n.title, type: "text", content: "<p></p>" }),
  });
  idOf.set(n.key, r.note.noteId);
}
let done = 0;
for (const n of plan) {
  await api(`/notes/${idOf.get(n.key)}/content`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: render(n, idOf) }, true);
  if (++done % 25 === 0) console.log(`  content ${done}/${plan.length}`);
}
console.log(`done: ${ROOT_TITLE} = ${idOf.get("root")}`);
