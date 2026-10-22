/**
 * tools/seed-rich.js — fills the disposable Trilium mock with varied content:
 * many note types, labels, relations, clones, attachments, deep nesting, day notes.
 * Idempotent: deletes and rebuilds its own "Rich Mock Library" subtree.
 * Usage: node tools/seed-rich.js   (needs .bootstrap.env; mock only, never a real instance)
 * Hand-made and small; the generated, deterministic, profile-sized vaults are tools/seed-vault.js (AGENTS.md "Trilium mock").
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(".bootstrap.env", "utf8");
const URL = raw.match(/TRILIUM_URL=(.*)/m)?.[1];
const TOKEN = raw.match(/TRILIUM_TOKEN=(.*)/m)?.[1];
const H = { Authorization: TOKEN, "Content-Type": "application/json" };
const ROOT_TITLE = "Rich Mock Library";

async function api(path, init = {}) {
  const r = await fetch(`${URL}/etapi${path}`, { headers: H, ...init });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });

async function note(parent, title, type, content, { mime, labels = {}, relations = {} } = {}) {
  const body = { parentNoteId: parent, title, type, content };
  if (mime) body.mime = mime;
  const r = await post("/create-note", body);
  const id = r.note.noteId;
  for (const [name, value] of Object.entries(labels)) {
    const inheritable = name.startsWith("*");
    await post("/attributes", { noteId: id, type: "label", name: name.replace(/^\*/, ""), value: String(value ?? ""), isInheritable: inheritable });
  }
  for (const [name, target] of Object.entries(relations)) {
    await post("/attributes", { noteId: id, type: "relation", name, value: target });
  }
  return id;
}

// --- reset our own subtree -------------------------------------------------
const old = await api(`/notes?search=${encodeURIComponent(ROOT_TITLE)}&fastSearch=true`);
for (const n of old.results.filter((n) => n.title === ROOT_TITLE)) {
  await api(`/notes/${n.noteId}`, { method: "DELETE" });
}

const top = await note("root", ROOT_TITLE, "text", "<p>Varied mock content: every note type, labels, relations, clones, attachments.</p>", { labels: { biblio_demo: "rich" } });

// --- 1. Text notes with rich HTML -------------------------------------------
const wiki = await note(top, "Wiki", "text", "<p>Text notes with varied formatting.</p>");
await note(wiki, "The Library of Babel", "text",
  `<h2>Borges, 1941</h2><p>The universe (which others call the Library) is composed of an indefinite, perhaps infinite number of <strong>hexagonal galleries</strong>.</p>
<blockquote><p>Everything: the minutely detailed history of the future, the archangels' autobiographies…</p></blockquote>
<ul><li>25 orthographic symbols</li><li>410 pages per book</li><li>40 lines per page</li></ul>`,
  { labels: { book: "", author: "Jorge Luis Borges", year: "1941", reading: "" } });
await note(wiki, "Elevator pitch collection", "text",
  `<ol><li><p>A vault you can <em>walk</em> through.</p></li><li><p>Notes as rooms, links as doors.</p></li></ol>
<table><tbody><tr><td>Metaphor</td><td>Trilium concept</td></tr><tr><td>Room</td><td>Note with children</td></tr><tr><td>Book</td><td>Leaf note</td></tr><tr><td>Door</td><td>Branch</td></tr></tbody></table>`,
  { labels: { project: "" } });
await note(wiki, "Unicode & escaping stress", "text",
  `<p>Ünïcödé: 日本語 • العربية • Ελληνικά • 🏛️📚🗝️</p><p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quotes" 'apostrophes'</p><p><a href="https://example.com/a?b=1&amp;c=2">external link</a></p>`);
await note(wiki, "A very long title that goes on and on to test how the room signage truncates or wraps overly verbose note names in the game UI", "text", "<p>Long title test.</p>");
await note(wiki, "Empty note", "text", "");
await note(wiki, "Big note (≈200 paragraphs)", "text",
  Array.from({ length: 200 }, (_, i) => `<p>Paragraph ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`).join(""),
  { labels: { reading: "" } });

// --- 2. Code notes in several languages --------------------------------------
const code = await note(top, "Code Vault", "text", "<p>Code notes, one per language mime.</p>", { labels: { "*codeFolder": "" } });
await note(code, "fizzbuzz.js", "code", `for (let i = 1; i <= 15; i++) console.log(i % 15 ? i % 5 ? i % 3 ? i : "Fizz" : "Buzz" : "FizzBuzz");\n`, { mime: "application/javascript;env=frontend" });
await note(code, "sieve.py", "code", `def sieve(n):\n    p = [True] * (n + 1)\n    for i in range(2, int(n ** .5) + 1):\n        if p[i]:\n            p[i*i::i] = [False] * len(p[i*i::i])\n    return [i for i in range(2, n + 1) if p[i]]\n`, { mime: "text/x-python" });
await note(code, "backup.sh", "code", `#!/usr/bin/env bash\nset -euo pipefail\ntar czf "backup-$(date +%F).tgz" ~/notes\n`, { mime: "text/x-sh" });
await note(code, "config.json", "code", JSON.stringify({ name: "demo", nested: { list: [1, 2, 3], ok: true } }, null, 2), { mime: "application/json" });
await note(code, "schema.sql", "code", `CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL, year INT);\n`, { mime: "text/x-sql" });
await note(code, "styles.css", "code", `.room { display: grid; gap: 1rem; }\n`, { mime: "text/css" });
await note(code, "Dockerfile", "code", `FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci && npm run build\n`, { mime: "text/x-dockerfile" });
await note(code, "notes.md", "code", `# Markdown code note\n\n- item one\n- item two\n\n\`\`\`ts\nconst x: number = 1;\n\`\`\`\n`, { mime: "text/x-markdown" });
await note(code, "data.xml", "code", `<?xml version="1.0"?>\n<library><book id="1">Babel</book></library>\n`, { mime: "text/xml" });
await note(code, "plain.txt", "code", `Just plain text stored as a code note.\n`, { mime: "text/plain" });

// --- 3. Diagrams & visual types ----------------------------------------------
const viz = await note(top, "Diagrams & Visuals", "text", "<p>Mermaid, canvas, mind map, relation map, SVG image.</p>");
await note(viz, "Architecture (mermaid)", "mermaid", `graph TD\n  Browser -->|ETAPI| Trilium\n  Browser --> Phaser\n  Phaser --> React\n`, { mime: "text/mermaid" });
await note(viz, "Sequence (mermaid)", "mermaid", `sequenceDiagram\n  User->>App: press E\n  App->>Trilium: GET /notes/{id}\n  Trilium-->>App: note\n`, { mime: "text/mermaid" });
await note(viz, "Sketch (canvas)", "canvas", JSON.stringify({
  type: "excalidraw", version: 2, source: "mock",
  elements: [{ id: "r1", type: "rectangle", x: 0, y: 0, width: 160, height: 80, strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid", strokeWidth: 1, roughness: 1, opacity: 100, angle: 0, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: null, link: null, locked: false }],
  appState: {}, files: {},
}), { mime: "application/json" });
await note(viz, "Brainstorm (mind map)", "mindMap", JSON.stringify({
  nodeData: { id: "root", topic: "Bibliotheca", children: [{ id: "a", topic: "Rooms" }, { id: "b", topic: "Books" }, { id: "c", topic: "Doors" }] },
  linkData: {},
}), { mime: "application/json" });
await note(viz, "Relation map", "relationMap", JSON.stringify({ notes: [], transform: { x: 0, y: 0, scale: 1 } }), { mime: "application/json" });
await note(viz, "Floor plan (SVG image)", "image",
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><rect width="240" height="140" fill="#fdf6e3"/><rect x="20" y="20" width="90" height="100" fill="none" stroke="#333" stroke-width="3"/><rect x="130" y="20" width="90" height="100" fill="none" stroke="#333" stroke-width="3"/><rect x="104" y="60" width="32" height="20" fill="#b58900"/></svg>`,
  { mime: "image/svg+xml" });

// --- 4. Files, web view, search, render --------------------------------------
const misc = await note(top, "Other Types", "text", "<p>File, web view, saved search, book (collection).</p>");
await note(misc, "inventory.csv", "file", "title,author,year\nBabel,Borges,1941\nSolaris,Lem,1961\nDune,Herbert,1965\n", { mime: "text/csv" });
await note(misc, "readme.txt", "file", "A plain text file attachment-type note.\n", { mime: "text/plain" });
await note(misc, "Example web view", "webView", "", { labels: { webViewSrc: "https://example.com" } });
await note(misc, "All books (saved search)", "search", "#book", { mime: "application/json" });
await note(misc, "Recently reading (saved search)", "search", "#reading orderBy note.dateModified desc", { mime: "application/json" });
await note(misc, "Shelf (book collection)", "book", "", { labels: { viewType: "grid" } });

// --- 5. Relations, clones, attachments, deep tree ----------------------------
const links = await note(top, "Links & Structure", "text", "<p>Relations, clones, attachments, deep nesting.</p>");
const dune = await note(links, "Dune", "text", "<p>Frank Herbert, 1965. Spice, sandworms, politics.</p>", { labels: { book: "", author: "Frank Herbert", year: "1965", reading: "" } });
const solaris = await note(links, "Solaris", "text", "<p>Stanisław Lem, 1961. The ocean that thinks.</p>", { labels: { book: "", author: "Stanisław Lem", year: "1961" }, relations: { relatedTo: dune } });
await note(links, "Review: Dune vs Solaris", "text", `<p>Comparing two classics.</p>`, { relations: { compares: dune }, labels: { project: "" } });
await post("/attributes", { noteId: dune, type: "relation", name: "relatedTo", value: solaris });
// clone Dune into a second parent
const favs = await note(links, "Favourites", "text", "<p>Clones live here.</p>");
await post("/branches", { noteId: dune, parentNoteId: favs, prefix: "★" });
await post("/branches", { noteId: solaris, parentNoteId: favs });
// attachment on a note
const att = await post("/attachments", { ownerId: dune, role: "file", mime: "text/plain", title: "annotations.txt", content: "p.12 — the spice must flow\n" });
// deep nesting (8 levels)
let parent = await note(links, "Deep nesting", "text", "<p>Level 0</p>");
for (let i = 1; i <= 8; i++) parent = await note(parent, `Level ${i}`, "text", `<p>Depth ${i}</p>`);
// many siblings in one room
const crowd = await note(links, "Crowded room (40 books)", "text", "<p>Stress test for layout.</p>");
for (let i = 1; i <= 40; i++) {
  await note(crowd, `Volume ${String(i).padStart(2, "0")}`, "text", `<p>Volume ${i}.</p>`, { labels: i % 4 === 0 ? { reading: "" } : i % 7 === 0 ? { project: "" } : {} });
}

// --- 6. Position labels used by the app ---------------------------------------
await note(top, "Positioned room", "text", "<p>Has saved overview position.</p>", { labels: { biblio_x: "320", biblio_y: "180" } });

// --- 7. Attribute zoo -----------------------------------------------------------
await note(top, "Attribute zoo", "text", "<p>Many label shapes.</p>", {
  labels: { archived: "", iconClass: "bx bx-star", cssClass: "fancy", todoDate: "2026-12-24", rating: "4.5", tags: "a,b,c", empty: "", "*inheritedLabel": "from zoo" },
});

// --- 8. Day notes (calendar subtree, real Trilium feature) -----------------------
for (const d of ["2026-10-20", "2026-10-21"]) {
  try {
    const day = await api(`/calendar/days/${d}`);
    await api(`/notes/${day.noteId}/content`, { method: "PUT", headers: { ...H, "Content-Type": "text/plain" }, body: `<p>Journal for ${d}: seeded entry.</p>` });
  } catch (e) { console.warn("day note skipped:", e.message); }
}

const count = await api(`/notes?search=${encodeURIComponent("note.ancestors.title = '" + ROOT_TITLE + "'")}&limit=1000`).then((r) => r.results.length).catch(() => "?");
console.log(`seeded "${ROOT_TITLE}" (${top}), ${count} descendant notes; attachment ${att.attachmentId ?? "ok"}`);
