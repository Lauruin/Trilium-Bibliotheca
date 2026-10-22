/**
 * tools/lib/vault-gen.mjs — deterministic vault generator for the Trilium mock.
 *
 * Pure (no network, no Math.random, no Date.now): `generateVault(profile, {seed})` returns the same
 * spec every time. Used by tools/seed-vault.js (applies it to the real mock through ETAPI) and by
 * tools/etapi-fake.mjs (loads it straight into memory). Docs: AGENTS.md "Trilium mock".
 *
 * A vault = { profile, seed, rootTitle, notes: Spec[] }, parents always before children:
 *   Spec = { key, parent, title, type, mime, content, bytes?, labels, relations, clones, position, refs }
 *   - parent: key of the parent spec; the top note has parent "@root" (= Trilium's `root`).
 *   - bytes: Buffer for binary notes (image/file); content is "" then.
 *   - labels: [{name, value, inheritable}] — names are RAW (the server normalises: `a.b` -> `a_b`).
 *   - relations: [{name, target: key}]; clones: [parentKey, ...] extra parents of a NOTE (never a folder).
 *   - content may hold "{{ref:key}}" placeholders (internal links); `resolveRefs(content, idOf)` turns them into
 *     "#root/<noteId>" and `refs` says whether a spec has any (they need every note to exist first).
 *
 * Adding a profile: add an entry to PROFILES (balanced = a size, stress = a build function) — see AGENTS.md.
 */
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------------------------
// PRNG + helpers
// ---------------------------------------------------------------------------------------------

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  return h;
}
/** mulberry32: tiny, fast, good enough, fully deterministic. */
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seedStr) {
  const f = mulberry32(hash32(seedStr));
  const r = {
    f,
    int: (a, b) => a + Math.floor(f() * (b - a + 1)), // inclusive
    chance: (p) => f() < p,
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    /** n distinct items (or fewer if the list is shorter), order random. */
    sample: (arr, n) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(f() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, n);
    },
  };
  return r;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad2 = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// Word lists and prose (lorem-free; note: never the word "hello" — tools/browser-test.js searches for it)
// ---------------------------------------------------------------------------------------------

const ADJ = ["quiet", "narrow", "bright", "ancient", "tidy", "restless", "hollow", "gentle", "rough", "patient", "curious", "brittle", "warm", "distant", "careful", "crooked", "faded", "sturdy", "hidden", "plain", "golden", "weathered", "nimble", "steady", "tangled", "modest", "vivid", "calm", "bitter", "tender"];
const NOUN = ["lantern", "orchard", "ledger", "harbor", "compass", "window", "garden", "bridge", "kettle", "mirror", "river", "ladder", "meadow", "engine", "archive", "signal", "lattice", "pigeon", "workshop", "blanket", "harvest", "theory", "margin", "sketch", "pattern", "quarry", "voyage", "chimney", "cabinet", "summit", "thread", "bell", "cellar", "fence", "atlas", "tunnel", "ribbon", "market", "pocket", "sparrow", "candle", "greenhouse", "telescope", "orchestra", "lighthouse", "recipe", "map", "puzzle"];
const VERB = ["gather", "mend", "sort", "measure", "borrow", "polish", "trace", "sketch", "weigh", "rewrite", "collect", "inspect", "assemble", "repair", "label", "schedule", "compare", "plant", "carry", "bundle"];
const TIME = ["morning", "evening", "weekend", "afternoon", "autumn", "spring", "winter", "summer", "week"];
const FIRST = ["Ada", "Bram", "Cleo", "Dara", "Emil", "Farah", "Gus", "Hana", "Ivo", "Jun", "Kira", "Leo", "Mara", "Nils", "Odile", "Pavel", "Quinn", "Rosa", "Søren", "Tess", "Zoë"];
const LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Haddad", "Brandt", "Castillo", "Novak", "Ibarra", "Fischer", "Adeyemi", "Kowalski", "Marsh", "Petrov", "Quispe", "Rasmussen", "Sato", "Varga", "Whitlock", "Yilmaz"];
const PLACE = ["Lisbon", "Tromsø", "Kyoto", "Valparaíso", "Bergen", "Marrakesh", "Ghent", "Hobart", "Tbilisi", "Cusco", "Split", "Tallinn"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function plural(n) {
  if (/(s|x|ch|sh)$/.test(n)) return n + "es";
  if (/[^aeiou]y$/.test(n)) return n.slice(0, -1) + "ies";
  return n + "s";
}
function third(v) {
  return /(s|x|ch|sh)$/.test(v) ? v + "es" : /[^aeiou]y$/.test(v) ? v.slice(0, -1) + "ies" : v + "s";
}
function past(v) {
  return /e$/.test(v) ? v + "d" : /[^aeiou]y$/.test(v) ? v.slice(0, -1) + "ied" : v + "ed";
}

/** One sentence from templates and the word lists. */
function sentence(r) {
  const adj = () => r.pick(ADJ), noun = () => r.pick(NOUN), verb = () => r.pick(VERB);
  const t = r.int(0, 15);
  switch (t) {
    case 0: return `The ${adj()} ${noun()} ${third(verb())} beside the ${noun()}.`;
    case 1: return `We ${past(verb())} the ${noun()} before ${r.pick(TIME)}, which left ${r.int(2, 9)} ${plural(noun())} to sort out.`;
    case 2: return `${r.pick(FIRST)} ${past(verb())} the ${noun()} and found it ${adj()} but usable.`;
    case 3: return `Next, ${verb()} the ${noun()} and note what changes.`;
    case 4: return `It rained all ${r.pick(TIME)}, so the ${noun()} stayed ${adj()}.`;
    case 5: return `A ${adj()} ${noun()} is easier to ${verb()} than a ${adj()} ${noun()}.`;
    case 6: return `${r.pick(FIRST)} says the ${plural(noun())} in ${r.pick(PLACE)} are ${adj()} this year.`;
    case 7: return `Remember to ${verb()} the ${plural(noun())} before the ${noun()} arrives.`;
    case 8: return `Nothing about the ${noun()} was ${adj()}, which is why it worked.`;
    case 9: return `After the ${r.pick(TIME)} the ${noun()} looked ${adj()} again.`;
    case 10: return `There are ${r.int(3, 40)} ${plural(noun())} left and only ${r.int(1, 5)} ${plural(noun())} that matter.`;
    case 11: return `${r.pick(FIRST)} and ${r.pick(FIRST)} agreed to ${verb()} the ${noun()} by ${r.pick(TIME)}.`;
    case 12: return `The trick is to ${verb()} first and ${verb()} later.`;
    case 13: return `I keep coming back to the ${adj()} ${noun()} we saw in ${r.pick(PLACE)}.`;
    case 14: return `Every ${noun()} has a ${adj()} side; this one has ${r.int(2, 4)}.`;
    default: return `Still unsure whether the ${noun()} or the ${noun()} should ${verb()} first.`;
  }
}
const paragraph = (r, n = r.int(2, 4)) => Array.from({ length: n }, () => sentence(r)).join(" ");
const P = (s) => `<p>${esc(s)}</p>`;
const htmlParas = (r, n = r.int(1, 3)) => Array.from({ length: n }, () => P(paragraph(r))).join("");
const ul = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
const ol = (items) => `<ol>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
const todoList = (items, doneP, r) => `<ul class="todo-list">${items.map((i) => `<li><label class="todo-list__label"><input type="checkbox"${r.chance(doneP) ? " checked" : ""} disabled><span class="todo-list__label__description">${esc(i)}</span></label></li>`).join("")}</ul>`;
const table = (head, rows) => `<figure class="table"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></figure>`;

const nameOf = (r) => `${r.pick(FIRST)} ${r.pick(LAST)}`;
const phrase = (r) => `${r.pick(ADJ)} ${r.pick(NOUN)}`;
const Title = (s) => s.split(" ").map(cap).join(" ");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Plain prose of exactly `n` characters (used by the longtail profile). */
function proseChars(r, n) {
  let s = "";
  while (s.length < n) s += sentence(r) + " ";
  return s.slice(0, n).replace(/ $/, "x");
}
/** Code-ish text of exactly `n` characters. */
function codeChars(r, n) {
  let s = "";
  while (s.length < n) s += `const ${r.pick(NOUN)}_${r.int(1, 99)} = ${r.pick(VERB)}(${r.int(0, 999)}, "${r.pick(ADJ)}"); // ${r.pick(NOUN)}\n`;
  return s.slice(0, n);
}

// ---------------------------------------------------------------------------------------------
// Binary fixtures: PNG, PDF
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A valid RGB PNG, `pixel(x, y) -> [r,g,b]`. */
export function makePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [R, G, B] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bit, truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
/** A tiny valid one-page PDF with a line of text. */
export function makePdf(text) {
  const t = String(text).replace(/[()\\]/g, "").replace(/[^\x20-\x7e]/g, "?");
  const stream = `BT /F1 14 Tf 40 100 Td (${t}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------------------------------------
// Snippets per language (code notes)
// ---------------------------------------------------------------------------------------------

const LANGS = {
  javascript: { mime: "application/javascript;env=frontend", ext: "js" },
  python: { mime: "text/x-python", ext: "py" },
  shell: { mime: "text/x-sh", ext: "sh" },
  sql: { mime: "text/x-sql", ext: "sql" },
  css: { mime: "text/css", ext: "css" },
  go: { mime: "text/x-go", ext: "go" },
  yaml: { mime: "text/x-yaml", ext: "yml" },
  typescript: { mime: "application/typescript", ext: "ts" },
};
function snippet(r, lang) {
  const n = r.pick(NOUN), v = r.pick(VERB), a = r.pick(ADJ), n2 = r.pick(NOUN), k = r.int(2, 9);
  const fn = `${v}${cap(n)}`;
  const pick = (...opts) => r.pick(opts);
  switch (lang) {
    case "javascript":
      return pick(
        `// ${v} the ${plural(n)} that are ${a}\nexport function ${fn}(${plural(n)}) {\n  return ${plural(n)}.filter((x) => x.${a} !== false).map((x) => ({ ...x, ${n2}: ${k} }));\n}\n`,
        `const ${n}Cache = new Map();\nexport async function load${cap(n)}(id) {\n  if (!${n}Cache.has(id)) ${n}Cache.set(id, fetch("/api/${plural(n)}/" + id).then((r) => r.json()));\n  return ${n}Cache.get(id);\n}\n`,
        `// debounce: wait ${k * 50} ms of quiet before calling fn\nexport const debounce = (fn, ms = ${k * 50}) => {\n  let t;\n  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };\n};\n`,
      );
    case "python":
      return pick(
        `def ${v}_${n}(items, limit=${k}):\n    """${cap(v)} the first ${k} ${plural(n)} that look ${a}."""\n    return [i for i in items if i.get("${a}")][:limit]\n`,
        `from collections import Counter\n\ndef count_${plural(n)}(words):\n    return Counter(w for w in words if w.endswith("${n.slice(-2)}")).most_common(${k})\n`,
        `import json, sys\n\nfor line in sys.stdin:\n    row = json.loads(line)\n    print(row["${n}"], row.get("${n2}", "-"))\n`,
      );
    case "shell":
      return pick(
        `#!/usr/bin/env bash\nset -euo pipefail\n# ${v} every ${n} older than ${k} days\nfind ./${plural(n)} -type f -mtime +${k} -print0 | xargs -0 -r ls -l\n`,
        `# tail the ${n} log and keep only the ${a} lines\ntail -f /var/log/${n}.log | grep --line-buffered -i "${a}"\n`,
        `for f in *.${r.pick(["md", "txt", "log"])}; do\n  printf '%s: %s lines\\n' "$f" "$(wc -l < "$f")"\ndone\n`,
      );
    case "sql":
      return pick(
        `SELECT ${n}.id, ${n}.name, COUNT(${n2}.id) AS ${plural(n2)}\nFROM ${plural(n)} ${n}\nLEFT JOIN ${plural(n2)} ${n2} ON ${n2}.${n}_id = ${n}.id\nGROUP BY ${n}.id\nHAVING COUNT(${n2}.id) > ${k}\nORDER BY ${plural(n2)} DESC;\n`,
        `CREATE TABLE ${plural(n)} (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  ${a} BOOLEAN DEFAULT 0,\n  created_at TEXT DEFAULT CURRENT_TIMESTAMP\n);\nCREATE INDEX idx_${plural(n)}_name ON ${plural(n)}(name);\n`,
      );
    case "css":
      return pick(
        `.${n}-${a} {\n  display: grid;\n  gap: ${k * 4}px;\n  grid-template-columns: repeat(auto-fill, minmax(${k * 30}px, 1fr));\n}\n`,
        `:root { --${n}: #${(hash32(n) & 0xffffff).toString(16).padStart(6, "0")}; }\n.${n2} { color: var(--${n}); transition: opacity .${k}s ease; }\n.${n2}:hover { opacity: .${10 - k}; }\n`,
      );
    case "go":
      return `package main\n\nimport "fmt"\n\n// ${cap(v)}${cap(n)} returns the ${a} ${plural(n)}.\nfunc ${cap(v)}${cap(n)}(in []string) []string {\n\tout := make([]string, 0, ${k})\n\tfor _, s := range in {\n\t\tif len(s) > ${k} {\n\t\t\tout = append(out, s)\n\t\t}\n\t}\n\treturn out\n}\n\nfunc main() { fmt.Println(${cap(v)}${cap(n)}([]string{"${a}", "${n}-${n2}"})) }\n`;
    case "yaml":
      return `services:\n  ${n}:\n    image: ${n}:${k}.${r.int(0, 9)}\n    restart: unless-stopped\n    ports:\n      - "${8000 + k * 11}:80"\n    environment:\n      - ${n.toUpperCase()}_MODE=${a}\n`;
    default: // typescript
      return `export interface ${cap(n)} {\n  id: string;\n  ${a}: boolean;\n  ${plural(n2)}: number[];\n}\n\nexport const ${fn} = (x: ${cap(n)}[]): ${cap(n)}[] => x.filter((i) => i.${a});\n`;
  }
}
const markdownDoc = (r) => {
  const h = Title(phrase(r));
  return `# ${h}\n\n${paragraph(r, 2)}\n\n## ${cap(r.pick(ADJ))} parts\n\n${Array.from({ length: r.int(3, 5) }, () => `- ${cap(phrase(r))}: ${sentence(r)}`).join("\n")}\n\n> ${sentence(r)}\n\n\`\`\`sh\n${r.pick(VERB)} --${r.pick(ADJ)} ./${r.pick(NOUN)}\n\`\`\`\n`;
};
const mermaidDoc = (r) => {
  const a = Title(r.pick(NOUN)), b = Title(r.pick(NOUN)), c = Title(r.pick(NOUN)), d = Title(r.pick(NOUN));
  return r.chance(0.5)
    ? `graph TD\n  ${a}[${a}] -->|${r.pick(VERB)}| ${b}\n  ${b} --> ${c}\n  ${a} --> ${d}\n  ${d} -.-> ${c}\n`
    : `sequenceDiagram\n  participant ${a}\n  participant ${b}\n  ${a}->>${b}: ${r.pick(VERB)} ${r.pick(NOUN)}\n  ${b}-->>${a}: ${r.pick(ADJ)}\n`;
};
const canvasDoc = (r) => {
  const els = [];
  const n = r.int(2, 5);
  for (let i = 0; i < n; i++) {
    els.push({ id: `e${i}`, type: r.pick(["rectangle", "ellipse", "diamond"]), x: i * 150, y: r.int(0, 120), width: 120, height: 70, angle: 0, strokeColor: "#1e1e1e", backgroundColor: r.pick(["#a5d8ff", "#ffec99", "#b2f2bb", "#ffc9c9"]), fillStyle: "solid", strokeWidth: 1, roughness: 1, opacity: 100, groupIds: [], isDeleted: false, version: 1, versionNonce: i + 1, link: null, locked: false, boundElements: null });
  }
  return JSON.stringify({ type: "excalidraw", version: 2, source: "etapi-mock", elements: els, appState: {}, files: {} });
};
const mindMapDoc = (r) => JSON.stringify({ nodeData: { id: "root", topic: Title(phrase(r)), children: Array.from({ length: r.int(3, 5) }, (_, i) => ({ id: `n${i}`, topic: Title(phrase(r)) })) }, linkData: {} });

// ---------------------------------------------------------------------------------------------
// Builder context
// ---------------------------------------------------------------------------------------------

const TOP = "@root";
const L = (name, value = "", inheritable = false) => ({ name, value: String(value), inheritable });
const COLORS = ["red", "#c0392b", "goldenrod", "teal", "#2e86c1", "rebeccapurple", "seagreen", "darkorange", "#8e44ad", "slategray", "crimson", "#16a085"];

class Budget {
  constructor(n) { this.left = n; }
  /** Carve `n` (at most what is left) out of this budget into a child budget. */
  slice(n) { const s = new Budget(Math.min(Math.max(0, n), this.left)); this.left -= s.left; return s; }
  /** Return the unused rest of a slice. */
  give(s) { this.left += s.left; s.left = 0; }
}

function makeCtx(r, rootTitle) {
  const notes = [];
  const ctx = {
    r, notes,
    byKey: new Map(),
    reg: {}, // named keys other themes link to
    /** Create a note, charging budget `b`; null when `b` is empty or the parent is missing. */
    mk(b, parent, o) {
      if (!parent || b.left <= 0) return null;
      b.left--;
      const key = "k" + String(notes.length + 1).padStart(4, "0");
      const spec = { key, parent, title: "", type: "text", mime: "", content: "", labels: [], relations: [], clones: [], position: null, refs: false, ...o };
      notes.push(spec);
      ctx.byKey.set(key, spec);
      return key;
    },
    /** Fill what is left of `b` with leaves produced by `fn()` (which must charge `b`). */
    fill(b, fn) { while (b.left > 0) if (fn() === null) break; },
    /** Split `b` so that `n` stays in it: spend the returned pool first, then the rest on closing items. */
    reserve: (b, n) => b.slice(Math.max(0, b.left - n)),
    color: (p = 0.15) => (r.chance(p) ? [L("color", r.pick(COLORS))] : []),
    text(b, parent, title, html, labels = []) { return ctx.mk(b, parent, { title, type: "text", mime: "text/html", content: html, labels }); },
    code(b, parent, title, lang, src, labels = []) { return ctx.mk(b, parent, { title, type: "code", mime: LANGS[lang]?.mime ?? "text/plain", content: src, labels }); },
    md(b, parent, title, src, labels = []) { return ctx.mk(b, parent, { title, type: "code", mime: "text/x-markdown", content: src, labels, markdown: true }); },
    folder(b, parent, title, labels = [], html) { return ctx.mk(b, parent, { title, type: "text", mime: "text/html", content: html ?? htmlParas(r, 1), labels }); },
  };
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Themes (each builder fills its budget exactly and registers keys other themes use)
// ---------------------------------------------------------------------------------------------

function projectName(r) { return Title(`${r.pick(ADJ)} ${r.pick(NOUN)} ${r.pick(["migration", "redesign", "rollout", "audit", "rebuild", "pilot", "survey", "launch"])}`); }
function bookTitle(r) {
  switch (r.int(0, 4)) {
    case 0: return `The ${cap(r.pick(ADJ))} ${cap(r.pick(NOUN))}`;
    case 1: return `${cap(r.pick(NOUN))} of ${r.pick(PLACE)}`;
    case 2: return `A ${cap(r.pick(NOUN))} in ${cap(r.pick(TIME))}`;
    case 3: return `${cap(r.pick(ADJ))} ${cap(plural(r.pick(NOUN)))}`;
    default: return `What the ${cap(r.pick(NOUN))} Knew`;
  }
}

function buildProjects(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Projects", content: htmlParas(r, 1), labels: [L("iconClass", "bx bx-briefcase", true), L("workspace", "main", true)] });
  if (!root) return;
  ctx.reg.projects = root;
  ctx.reg.projectList = [];
  const nProj = clamp(Math.round(b.left / (b.left > 80 ? 11 : 6)), 1, 60);
  for (let i = 0; i < nProj && b.left > 0; i++) {
    const pb = b.slice(Math.ceil(b.left / (nProj - i)));
    const name = projectName(r);
    const proj = ctx.mk(pb, root, { title: name, content: `<p>${esc(paragraph(r, 2))}</p>`, labels: [L("project", slug(name)), L("status", r.pick(["active", "active", "paused", "done"])), ...(r.chance(0.3) ? [L("Priority", r.pick(["High", "Low", "Medium"]))] : []), ...ctx.color(0.3)] });
    if (!proj) { b.give(pb); break; }
    ctx.reg.projectList.push(proj);
    ctx.text(pb, proj, "Brief", `<h2>Goal</h2>${htmlParas(r, 2)}<h2>Non-goals</h2>${ul([sentence(r), sentence(r)])}`, [L("brief")]);
    if (pb.left > 3) ctx.text(pb, proj, "Milestones", table(["When", "What", "Owner"], Array.from({ length: r.int(3, 5) }, (_, k) => [`${r.pick(MONTHS)} ${r.int(1, 28)}`, cap(`${r.pick(VERB)} the ${r.pick(NOUN)}`), r.pick(FIRST)])));
    if (pb.left > 4) {
      const tasks = ctx.folder(pb, proj, "Tasks", [], todoList(Array.from({ length: 4 }, () => cap(`${r.pick(VERB)} the ${phrase(r)}`)), 0.4, r));
      const nT = Math.min(pb.left - (pb.left > 8 ? 4 : 0), r.int(2, 8));
      for (let k = 0; k < nT; k++) {
        ctx.text(pb, tasks, cap(`${r.pick(VERB)} the ${phrase(r)}`), htmlParas(r, 1), [L(r.pick(["todo", "todo", "done", "blocked"])), ...ctx.color(0.1)]);
      }
    }
    if (pb.left > 3) {
      const log = ctx.folder(pb, proj, "Log", [], "<p>Weekly notes.</p>");
      for (let w = 1; pb.left > (pb.left > 7 ? 3 : 0) && w < 6; w++) ctx.text(pb, log, `Week ${w}`, htmlParas(r), [L("log")]);
    }
    if (pb.left > 4) {
      const plan = ctx.folder(pb, proj, "Planning", [], "<p>Plans and diagrams.</p>");
      ctx.mk(pb, plan, { title: "Architecture", type: "mermaid", mime: "text/vnd.mermaid", content: mermaidDoc(r), labels: [] });
      if (pb.left > 0) ctx.mk(pb, plan, { title: "Whiteboard", type: "canvas", mime: "application/json", content: canvasDoc(r) });
    }
    if (!ctx.reg.weekly) ctx.reg.weekly = ctx.text(pb, proj, "Weekly review ritual", `<p>Every Friday: ${esc(sentence(r))}</p>${ol(["Close open loops", "Look at next week", "Tidy the inbox"])}`, [L("ritual")]);
    ctx.fill(pb, () => ctx.text(pb, proj, cap(`${r.pick(VERB)} the ${phrase(r)}`), htmlParas(r, 1), [L(r.pick(["todo", "done"]))]));
    b.give(pb);
  }
  // relations between projects
  const pl = ctx.reg.projectList;
  for (let i = 1; i < pl.length; i++) if (r.chance(0.25)) ctx.byKey.get(pl[i]).relations.push({ name: "blockedBy", target: pl[r.int(0, i - 1)] });
  ctx.fill(b, () => ctx.text(b, root, cap(`${r.pick(VERB)} the ${phrase(r)}`), htmlParas(r, 1), [L("todo")]));
}

function buildReading(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Reading list", content: P("Books read, being read, and wanted."), labels: [L("iconClass", "bx bx-book", true)] });
  if (!root) return;
  ctx.reg.reading = root;
  const pool = ctx.reserve(b, 3);
  const genres = r.sample(["Fiction", "Science fiction", "History", "Poetry", "Essays", "Technical", "Biography", "Travel"], clamp(Math.round(pool.left / 9), 1, 8));
  const books = [];
  const mkBook = (bud, parent) => {
    const author = nameOf(r), year = r.int(1890, 2025);
    const status = r.pick(["finished", "finished", "reading", "toread"]);
    const key = ctx.text(bud, parent, bookTitle(r), `<p>${esc(paragraph(r, 2))}</p><blockquote><p>${esc(sentence(r))}</p></blockquote>`, [L("book"), L("author", author), L("year", year), L(status), ...(status === "finished" ? [L("rating", r.int(1, 5))] : []), ...ctx.color(0.2)]);
    if (key) books.push(key);
    return key;
  };
  genres.forEach((g, gi) => {
    const gb = pool.slice(Math.ceil(pool.left / (genres.length - gi)));
    const gf = ctx.folder(gb, root, g);
    if (gf) ctx.fill(gb, () => mkBook(gb, gf));
    pool.give(gb);
  });
  b.give(pool);
  const fav = ctx.folder(b, root, "Favourites", [], "<p>Clones of the books I keep rereading.</p>");
  if (fav) for (const k of r.sample(books, Math.min(books.length, Math.max(1, Math.round(books.length / 8))))) ctx.byKey.get(k).clones.push(fav);
  for (let i = 1; i < books.length; i++) if (r.chance(0.2)) ctx.byKey.get(books[i]).relations.push({ name: "relatedTo", target: books[r.int(0, i - 1)] });
  ctx.text(b, root, "Wishlist", ul(Array.from({ length: 6 }, () => `${bookTitle(r)} (${nameOf(r)})`)), [L("wishlist")]);
  ctx.fill(b, () => mkBook(b, root));
}

function buildRecipes(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Recipes", content: P("Things that worked."), labels: [L("iconClass", "bx bx-restaurant", true)] });
  if (!root) return;
  const ING = ["red lentils", "fennel", "lemon", "chickpeas", "smoked paprika", "leeks", "barley", "ricotta", "basil", "walnuts", "pumpkin", "rye flour", "miso", "pears", "oats", "buttermilk", "cardamom", "spinach", "tahini", "mushrooms"];
  const DISH = ["stew", "risotto", "salad", "soup", "flatbread", "tart", "porridge", "curry", "gratin", "pancakes", "dumplings", "loaf"];
  const mkRecipe = (bud, parent, cuisine) => {
    const main = r.pick(ING), side = r.pick(ING);
    const title = Title(`${r.pick(ADJ)} ${main} ${r.pick(DISH)}`);
    const ings = r.sample(ING, r.int(4, 8)).map((i) => `${r.int(1, 4) * 50} g ${i}`);
    const steps = Array.from({ length: r.int(3, 6) }, () => cap(`${r.pick(VERB)} the ${side} and ${r.pick(VERB)} the ${r.pick(NOUN)}.`));
    const labels = [L("recipe"), L("cuisine", cuisine), L("servings", r.int(2, 8)), ...(r.chance(0.4) ? [L("vegetarian")] : []), ...(r.chance(0.3) ? [L("time", `${r.int(10, 90)} min`)] : []), ...ctx.color(0.1)];
    if (r.chance(0.2)) return ctx.md(bud, parent, title, `# ${title}\n\n## Ingredients\n\n${ings.map((i) => `- ${i}`).join("\n")}\n\n## Method\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`, labels);
    return ctx.text(bud, parent, title, `<h2>Ingredients</h2>${ul(ings)}<h2>Method</h2>${ol(steps)}${r.chance(0.5) ? P(`Tip: ${sentence(r)}`) : ""}`, labels);
  };
  const pool = ctx.reserve(b, 2);
  const cats = r.sample(["Breakfast", "Soups & stews", "Pasta", "Baking", "Salads", "Desserts", "Drinks"], clamp(Math.round(pool.left / 8), 1, 7));
  cats.forEach((c, ci) => {
    const cb = pool.slice(Math.ceil(pool.left / (cats.length - ci)));
    const f = ctx.folder(cb, root, c);
    const cuisine = r.pick(["Nordic", "Levantine", "Italian", "Georgian", "Japanese", "Peruvian"]);
    if (f) ctx.fill(cb, () => mkRecipe(cb, f, cuisine));
    pool.give(cb);
  });
  b.give(pool);
  ctx.text(b, root, "Shopping list", todoList(r.sample(ING, 7), 0.3, r), [L("list")]);
  ctx.fill(b, () => mkRecipe(b, root, "Nordic"));
}

function buildJournal(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Journal", content: P("One note per day, grouped by year and month."), labels: [L("iconClass", "bx bx-calendar", true)] });
  if (!root) return;
  ctx.reg.journal = root;
  const nYears = clamp(Math.round(b.left / 90), 1, 5);
  const years = Array.from({ length: nYears }, (_, i) => 2026 - nYears + 1 + i);
  years.forEach((y, yi) => {
    if (b.left <= 0) return;
    const yb = b.slice(Math.ceil(b.left / (nYears - yi)));
    const yn = ctx.mk(yb, root, { title: String(y), content: P(`Notes from ${y}.`), labels: [L("yearNote", y)] });
    if (!yn) { b.give(yb); return; }
    if (ctx.reg.weekly && yi === nYears - 1) ctx.byKey.get(ctx.reg.weekly).clones.push(yn);
    const nM = clamp(Math.floor(yb.left / 5), 1, 12);
    const months = Array.from({ length: nM }, (_, i) => Math.floor((i * 12) / nM));
    months.forEach((m, mi) => {
      if (yb.left <= 0) return;
      const mb = yb.slice(Math.ceil(yb.left / (nM - mi)));
      const mn = ctx.mk(mb, yn, { title: `${pad2(m + 1)} - ${MONTHS[m]}`, content: P(`${MONTHS[m]} ${y}.`), labels: [L("monthNote", `${y}-${pad2(m + 1)}`)] });
      if (mn) {
        const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const days = r.sample(Array.from({ length: dim }, (_, i) => i + 1), mb.left).sort((a, c) => a - c);
        for (const d of days) {
          const wd = WEEKDAYS[new Date(Date.UTC(y, m, d)).getUTCDay()];
          const mood = r.pick(["good", "tired", "calm", "busy", "restless"]);
          ctx.mk(mb, mn, { title: `${pad2(d)} - ${wd}`, content: htmlParas(r, r.int(1, 3)), labels: [L("dateNote", `${y}-${pad2(m + 1)}-${pad2(d)}`), ...(r.chance(0.4) ? [L("mood", mood)] : []), ...ctx.color(0.05)] });
        }
      }
      yb.give(mb);
    });
    b.give(yb);
  });
  ctx.fill(b, () => ctx.text(b, root, `Loose entry - ${r.pick(MONTHS)}`, htmlParas(r), []));
}

function buildResearch(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Research", content: P("Papers, notes and figures, by topic."), labels: [L("iconClass", "bx bx-test-tube", true)] });
  if (!root) return;
  const papers = [];
  const mkPaper = (bud, parent) => {
    const au = r.pick(LAST), year = r.int(1998, 2025);
    const title = `${au} et al. ${year} - ${r.pick(["On the", "Towards a", "Revisiting the", "Measuring the", "A note on the"])} ${r.pick(ADJ)} ${r.pick(NOUN)} of ${plural(r.pick(NOUN))}`;
    const key = ctx.text(bud, parent, title, `<h2>Abstract</h2>${htmlParas(r, 1)}<h2>Notes</h2>${ul([sentence(r), sentence(r), sentence(r)])}`, [L("paper"), L("authors", `${au}, ${r.pick(LAST)}, ${r.pick(LAST)}`), L("year", year), ...(r.chance(0.4) ? [L("doi", `10.${r.int(1000, 9999)}/${slug(r.pick(NOUN))}.${r.int(100, 999)}`)] : []), ...ctx.color(0.08)]);
    if (key) papers.push(key);
    return key;
  };
  const pool = ctx.reserve(b, 2);
  const topics = r.sample(["Soil biology", "Urban acoustics", "Typography", "Pollinators", "Graph theory", "Tide models", "Sleep and memory", "Paper chemistry"], clamp(Math.round(pool.left / 10), 1, 8));
  topics.forEach((t, ti) => {
    const tb = pool.slice(Math.ceil(pool.left / (topics.length - ti)));
    const tf = ctx.folder(tb, root, t, [L("topic", slug(t))]);
    if (tf) {
      if (tb.left > 4) ctx.mk(tb, tf, { title: `Concept map - ${t}`, type: "mindMap", mime: "application/json", content: mindMapDoc(r) });
      if (tb.left > 6) ctx.mk(tb, tf, { title: `Method - ${t}`, type: "mermaid", mime: "text/vnd.mermaid", content: mermaidDoc(r) });
      ctx.fill(tb, () => mkPaper(tb, tf));
    }
    pool.give(tb);
  });
  b.give(pool);
  for (let i = 1; i < papers.length; i++) {
    const n = r.int(0, 2);
    for (let k = 0; k < n; k++) ctx.byKey.get(papers[i]).relations.push({ name: "cites", target: papers[r.int(0, i - 1)] });
  }
  ctx.mk(b, root, { title: "Unread papers (saved search)", type: "search", mime: "application/json", content: "#paper and not(#read)" });
  ctx.fill(b, () => mkPaper(b, root));
}

function buildCode(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Code snippets", content: P("Small things worth keeping."), labels: [L("iconClass", "bx bx-code-alt", true)] });
  if (!root) return;
  const langs = r.sample(Object.keys(LANGS), clamp(Math.round(b.left / 7), 1, 8));
  langs.forEach((lang, li) => {
    if (b.left <= 0) return;
    const lb = b.slice(Math.ceil(b.left / (langs.length - li)));
    const lf = ctx.folder(lb, root, Title(lang), [L("lang", lang, true)], P(`${Title(lang)} snippets.`));
    if (lf) {
      if (lb.left > 5) ctx.md(lb, lf, `${Title(lang)} cheatsheet`, markdownDoc(r), [L("cheatsheet")]);
      ctx.fill(lb, () => { const t = `${r.pick(VERB)}-${r.pick(NOUN)}.${LANGS[lang].ext}`; return ctx.code(lb, lf, t, lang, snippet(r, lang), ctx.color(0.05)); });
    }
    b.give(lb);
  });
  ctx.fill(b, () => ctx.code(b, root, `scratch-${r.pick(NOUN)}.js`, "javascript", snippet(r, "javascript")));
}

function buildMeetings(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Meeting notes", content: P("Agendas, decisions and actions."), labels: [L("iconClass", "bx bx-group", true)] });
  if (!root) return;
  const mk = (bud, parent) => {
    const who = r.sample(FIRST, r.int(2, 4));
    const proj = ctx.reg.projectList?.length ? r.pick(ctx.reg.projectList) : null;
    const title = r.pick([`Team sync - ${r.pick(MONTHS)} ${r.int(1, 28)}`, `Retro: ${Title(phrase(r))}`, `1:1 with ${r.pick(FIRST)}`, `Planning - ${Title(phrase(r))}`]);
    const key = ctx.text(bud, parent, title, `<p><strong>Attendees:</strong> ${esc(who.join(", "))}</p><h2>Agenda</h2>${ol([sentence(r), sentence(r)])}<h2>Decisions</h2>${ul([sentence(r)])}<h2>Actions</h2>${todoList([cap(`${r.pick(VERB)} the ${r.pick(NOUN)}`), cap(`${r.pick(VERB)} the ${r.pick(NOUN)}`)], 0.3, r)}`, [L("meeting"), L("attendees", who.join(", "))]);
    if (key && proj) ctx.byKey.get(key).relations.push({ name: "project", target: proj });
    return key;
  };
  const quarters = ["2026 Q1", "2026 Q2", "2026 Q3"].slice(0, clamp(Math.round(b.left / 8), 1, 3));
  quarters.forEach((q, qi) => {
    const qb = b.slice(Math.ceil(b.left / (quarters.length - qi)));
    const qf = ctx.folder(qb, root, q);
    if (qf) ctx.fill(qb, () => mk(qb, qf));
    b.give(qb);
  });
  ctx.fill(b, () => mk(b, root));
}

function buildIdeas(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Ideas", content: P("Cheap to write down, free to ignore."), labels: [L("iconClass", "bx bx-bulb", true)] });
  if (!root) return;
  const idea = (bud, parent) => {
    const t = r.pick([`An app that ${third(r.pick(VERB))} your ${plural(r.pick(NOUN))}`, `What if every ${r.pick(NOUN)} had a ${r.pick(ADJ)} ${r.pick(NOUN)}?`, `${Title(phrase(r))} as a board game`, `Write about the ${r.pick(ADJ)} ${r.pick(NOUN)} in ${r.pick(PLACE)}`, `${cap(r.pick(VERB))} ${plural(r.pick(NOUN))} by hand, once`]);
    if (r.chance(0.08)) return ctx.mk(bud, parent, { title: t, type: "canvas", mime: "application/json", content: canvasDoc(r), labels: [L("idea")] });
    return ctx.text(bud, parent, t, htmlParas(r, r.int(1, 2)), [L("idea"), ...(r.chance(0.5) ? [L(r.pick(["garden", "writing", "tools", "games", "home"]))] : []), ...ctx.color(0.2)]);
  };
  if (b.left > 2) {
    // The attribute zoo: odd names, odd values (all must survive the round trip).
    ctx.text(b, root, "Attribute zoo", P("Labels of every shape."), [
      L("Priority", "High"), L("TODO"), L("Mixed.Case-Name", "normalised to Mixed_Case_Name"), L("dueDate", "2026-12-24"), L("ratio", "0.5"), L("empty", ""),
      L("quotes", `He said "hi" & left <b>fast</b>`), L("unicode", "日本語 ✓ ñ"), L("csv", "a,b,c"), L("url", "https://example.org/a?b=1&c=2"), L("long", "x".repeat(600)), L("inherited_here", "visible on children", true),
    ]);
  }
  if (b.left > 3) ctx.mk(b, root, { title: "Mind map - side projects", type: "mindMap", mime: "application/json", content: mindMapDoc(r) });
  if (b.left > 3) ctx.mk(b, root, { title: "Wiring sketch", type: "canvas", mime: "application/json", content: canvasDoc(r) });
  const subs = ["Product", "Side projects", "Writing prompts", "Someday"].slice(0, clamp(Math.round(b.left / 6), 0, 4));
  subs.forEach((s, si) => {
    if (b.left <= 0) return;
    const sb = b.slice(Math.ceil(b.left / (subs.length - si + 1)));
    const f = ctx.folder(sb, root, s);
    if (f) ctx.fill(sb, () => idea(sb, f));
    b.give(sb);
  });
  ctx.fill(b, () => idea(b, root));
}

function buildArchive(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Archive", content: P("Done, dormant or superseded."), labels: [L("archived"), L("iconClass", "bx bx-archive", true)] });
  if (!root) return;
  // A chain of year folders, each holding a few old notes: also the deepest part of the balanced vaults.
  let parent = root;
  for (let year = 2024; b.left > 0; year--) {
    const f = ctx.folder(b, parent, `Filed in ${year}`, [...(r.chance(0.3) ? [L("archived")] : [])], P(`Kept for ${year}.`));
    if (!f) break;
    const n = Math.min(b.left, r.int(2, 5));
    for (let i = 0; i < n; i++) ctx.text(b, f, `${year} - ${projectName(r)}`, htmlParas(r, 1), [...(r.chance(0.4) ? [L("archived")] : []), ...(r.chance(0.3) ? [L(r.pick(["project", "reading", "idea"]))] : [])]);
    if (b.left > 0 && !r.chance(0.12)) parent = f; // mostly keep nesting, sometimes branch off the same level
  }
}

function buildMedia(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Media & files", content: P("Images and documents."), labels: [L("iconClass", "bx bx-image", true)] });
  if (!root) return;
  const photos = ctx.folder(b, root, "Photos", [], "<p>Tiny generated PNGs.</p>");
  const docs = ctx.folder(b, root, "Documents", [], "<p>CSV, text, JSON and PDF files.</p>");
  const mkImg = () => {
    const base = r.pick([[200, 80, 60], [60, 120, 200], [80, 170, 90], [200, 170, 60], [140, 80, 170]]);
    const w = r.pick([16, 24, 32]), h = r.pick([16, 24]);
    const png = makePng(w, h, (x, y) => [clamp(base[0] + x * 3 - y * 2, 0, 255), clamp(base[1] + y * 4 - x, 0, 255), clamp(base[2] + ((x ^ y) & 7) * 6, 0, 255)]);
    const name = `${slug(phrase(r))}.png`;
    return ctx.mk(b, photos, { title: name, type: "image", mime: "image/png", bytes: png, labels: [L("originalFileName", name), ...ctx.color(0.1)] });
  };
  const mkFile = () => {
    const kind = r.pick(["csv", "txt", "json", "pdf"]);
    const base = slug(phrase(r));
    if (kind === "csv") return ctx.mk(b, docs, { title: `${base}.csv`, type: "file", mime: "text/csv", content: `title,author,year\n${Array.from({ length: r.int(3, 8) }, () => `${bookTitle(r).replace(/,/g, "")},${nameOf(r)},${r.int(1900, 2025)}`).join("\n")}\n`, labels: [L("originalFileName", `${base}.csv`)] });
    if (kind === "txt") return ctx.mk(b, docs, { title: `${base}.txt`, type: "file", mime: "text/plain", content: paragraph(r, 4) + "\n", labels: [L("originalFileName", `${base}.txt`)] });
    if (kind === "json") return ctx.mk(b, docs, { title: `${base}.json`, type: "file", mime: "application/json", content: JSON.stringify({ name: base, items: r.sample(NOUN, 4), ok: true }, null, 2) + "\n", labels: [L("originalFileName", `${base}.json`)] });
    return ctx.mk(b, docs, { title: `${base}.pdf`, type: "file", mime: "application/pdf", bytes: makePdf(sentence(r)), labels: [L("originalFileName", `${base}.pdf`)] });
  };
  let i = 0;
  ctx.fill(b, () => (i++ % 2 === 0 ? mkImg() : mkFile()));
}

function buildWiki(ctx, vr, b) {
  const { r } = ctx;
  const root = ctx.mk(b, vr, { title: "Wiki", content: P("Reference articles; they link to each other."), labels: [L("iconClass", "bx bx-library", true)] });
  if (!root) return;
  const arts = [];
  const mk = (bud, parent) => {
    const t = `How ${plural(r.pick(NOUN))} ${third(r.pick(VERB))}`;
    const links = arts.length ? r.sample(arts, Math.min(arts.length, 2)).map((k) => `<a class="reference-link" href="{{ref:${k}}}">${esc(ctx.byKey.get(k).title)}</a>`) : [];
    const html = `<h2>${esc(Title(phrase(r)))}</h2>${htmlParas(r, 2)}${links.length ? `<p>See also: ${links.join(" and ")}.</p>` : ""}<h2>Details</h2>${table(["Part", "Note"], Array.from({ length: 3 }, () => [cap(r.pick(NOUN)), sentence(r)]))}<pre><code>${esc(`${r.pick(VERB)}(${r.pick(NOUN)}, ${r.int(1, 9)})`)}</code></pre><p>&lt;b&gt;escaped&lt;/b&gt; &amp; "quotes" - ${esc(r.pick(PLACE))} \u2713</p>`;
    if (r.chance(0.08)) return ctx.mk(bud, parent, { title: t, type: "mermaid", mime: "text/vnd.mermaid", content: mermaidDoc(r), labels: [L("article")] });
    const key = ctx.mk(bud, parent, { title: t, type: "text", mime: "text/html", content: html, labels: [L("article"), ...ctx.color(0.05)], refs: links.length > 0 });
    if (key) arts.push(key);
    return key;
  };
  const topics = r.sample(["Gardening", "Astronomy", "Bread", "Knots", "Weather", "Bicycles"], clamp(Math.round(b.left / 10), 1, 6));
  topics.forEach((t, ti) => {
    const tb = b.slice(Math.ceil(b.left / (topics.length - ti)));
    const f = ctx.folder(tb, root, t);
    if (f) ctx.fill(tb, () => mk(tb, f));
    b.give(tb);
  });
  ctx.fill(b, () => mk(b, root));
}

const THEMES = [
  ["projects", buildProjects, 0.15],
  ["reading", buildReading, 0.11],
  ["recipes", buildRecipes, 0.09],
  ["journal", buildJournal, 0.17],
  ["research", buildResearch, 0.11],
  ["code", buildCode, 0.09],
  ["meetings", buildMeetings, 0.07],
  ["ideas", buildIdeas, 0.06],
  ["archive", buildArchive, 0.05],
  ["media", buildMedia, 0.04],
  ["wiki", buildWiki, 0.06],
];

// ---------------------------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------------------------

/**
 * `size` = target note count of a balanced vault (the top note and README included); `stress` profiles have their
 * own build function. Keep the descriptions honest: `tools/seed-vault.js --list` prints them.
 */
export const PROFILES = {
  small: { size: 40, desc: "~40 notes: every theme in miniature" },
  medium: { size: 160, desc: "~160 notes: a believable personal vault, fits the app's walk caps" },
  large: { size: 600, desc: "~600 notes: exceeds TREE_WALK.maxNodes (400): the app's walk stops at ~400 notes and warns" },
  huge: { size: 1500, desc: "~1500 notes: well past both walk caps (400 notes / depth 8), on purpose" },
  deepchain: { stress: "deepchain", desc: "25 nested folders (+2 notes each): depth far past TREE_WALK.maxDepth (8)" },
  widefan: { stress: "widefan", desc: "one folder with 150 children (notes + small folders)" },
  longtail: { stress: "longtail", desc: "notes from 1 character to ~200 KB (text/code/markdown): leaf sizes" },
};

function buildDeepchain(ctx, vr, b) {
  const { r } = ctx;
  let parent = vr;
  for (let i = 1; i <= 25; i++) {
    parent = ctx.folder(b, parent, `Level ${pad2(i)}`, i % 5 === 0 ? [L("color", r.pick(COLORS))] : [], P(`Level ${i} of 25.`));
    ctx.text(b, parent, `Note at level ${pad2(i)}`, htmlParas(r, 1), [L(r.pick(["alpha", "beta", "gamma"]))]);
    if (i < 25) ctx.text(b, parent, `Second note at level ${pad2(i)}`, htmlParas(r, 1));
  }
  ctx.text(b, parent, "The bottom", P("Nothing deeper than this."), [L("bottom")]);
}
function buildWidefan(ctx, vr, b) {
  const { r } = ctx;
  const fan = ctx.folder(b, vr, "The Wide Fan", [L("iconClass", "bx bx-git-branch", true)], P("One folder, 150 direct children."));
  for (let i = 1; i <= 150; i++) {
    if (i % 15 === 0) {
      const f = ctx.folder(b, fan, `Sub-folder ${i / 15}`, [], P("A small branch off the fan."));
      for (let k = 0; k < 3; k++) ctx.text(b, f, cap(`${r.pick(VERB)} the ${phrase(r)}`), htmlParas(r, 1));
    } else {
      const kind = r.int(0, 9);
      const title = `${pad2(i)} ${cap(phrase(r))}`;
      if (kind < 6) ctx.text(b, fan, title, htmlParas(r, 1), [...(r.chance(0.5) ? [L(r.pick(["alpha", "beta", "gamma", "delta"]))] : []), ...ctx.color(0.12)]);
      else if (kind < 8) ctx.code(b, fan, title + ".py", "python", snippet(r, "python"));
      else if (kind < 9) ctx.mk(b, fan, { title, type: "mermaid", mime: "text/vnd.mermaid", content: mermaidDoc(r) });
      else ctx.mk(b, fan, { title, type: "canvas", mime: "application/json", content: canvasDoc(r) });
    }
  }
}
export const LONGTAIL_SIZES = [0, 1, 2, 5, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 200000];
function buildLongtail(ctx, vr, b) {
  const { r } = ctx;
  const sizeName = (n) => (n >= 1000 ? `${n / 1000} K` : String(n));
  for (const [kind, folderTitle] of [["text", "Text by length"], ["code", "Code by length"], ["markdown", "Markdown by length"]]) {
    const f = ctx.folder(b, vr, folderTitle, [], P("Same shape, growing length."));
    for (const n of LONGTAIL_SIZES) {
      const title = `${sizeName(n)} chars (${kind})`;
      const labels = [L("len", n)];
      if (kind === "text") {
        // paragraphs of <= 600 chars: the visible length (tags stripped) is exactly n
        const html = (proseChars(r, n).match(/[\s\S]{1,600}/g) ?? []).map((c) => `<p>${c}</p>`).join("");
        ctx.mk(b, f, { title, type: "text", mime: "text/html", content: html, labels, visibleLen: n });
      } else if (kind === "code") {
        ctx.mk(b, f, { title, type: "code", mime: "application/javascript;env=frontend", content: codeChars(r, n), labels });
      } else {
        ctx.mk(b, f, { title, type: "code", mime: "text/x-markdown", content: "# " + proseChars(r, Math.max(0, n - 2)), labels, markdown: true });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Layout labels (the app's own biblio_* labels) and clones, applied after the structure exists
// ---------------------------------------------------------------------------------------------

function decorate(ctx) {
  const { r, notes } = ctx;
  const children = new Map();
  for (const n of notes) children.set(n.parent, (children.get(n.parent) ?? 0) + 1);
  const rooms = notes.filter((n) => children.has(n.key) && n.parent !== TOP);
  const leaves = notes.filter((n) => !children.has(n.key) && n.type !== "image" && n.type !== "file");
  const topFolders = new Map(notes.filter((n) => n.parent === notes[0].key).map((n) => [n.title, n]));
  const wings = { Reading: "rosewood", Recipes: "greenhouse", Research: "crypt", Journal: "midnight", "Meeting notes": "slate", Projects: "ember" };
  for (const [t, w] of Object.entries(wings)) topFolders.get(t)?.labels.push(L("biblio_wing", w));
  for (const room of r.sample(rooms, Math.min(rooms.length, 4))) {
    room.labels.push(L("biblio_theme", r.pick(["oak", "midnight", "ember", "crypt", "greenhouse", "rosewood", "slate"])));
  }
  const dressed = r.sample(rooms, Math.min(rooms.length, 3));
  dressed.forEach((room, i) => {
    room.labels.push(L("biblio_wall", ["window,painting,-,auto,banner", "clock,window,window", "-,banner,painting,clock"][i]));
    room.labels.push(L("biblio_furniture", ["plant,armchair,globe", "lamp,bust,telescope,fireplace", "-,plant"][i]));
    room.labels.push(L("biblio_rug", ["moss", "navy", "none"][i]));
    room.labels.push(L("biblio_case", ["walnut", "ebony", "whitewash"][i]));
    room.labels.push(L("biblio_span", String(i + 1)));
  });
  for (const room of r.sample(rooms, Math.min(rooms.length, 2))) {
    room.labels.push(L("biblio_x", String(r.int(1, 6))), L("biblio_y", String(r.int(1, 4))));
  }
  const kinds = ["broad", "needle", "maple", "blossom", "fruit"];
  r.sample(leaves, Math.min(leaves.length, 5)).forEach((n, i) => n.labels.push(L("biblio_leaf", kinds[i % kinds.length])));
}

function finalize(ctx, vr) {
  const sib = new Map();
  for (const n of ctx.notes) {
    const i = sib.get(n.parent) ?? 0;
    sib.set(n.parent, i + 1);
    if (n.position === null) n.position = (i + 1) * 10;
    if (!n.refs) n.refs = /\{\{ref:/.test(n.content);
  }
  return vr;
}

/** Build the vault for `profile`. Same (profile, seed) -> identical result. */
export function generateVault(profile, { seed = 1, rootTitle } = {}) {
  const def = PROFILES[profile];
  if (!def) throw new Error(`unknown profile "${profile}" (known: ${Object.keys(PROFILES).join(", ")})`);
  const r = makeRng(`${profile}:${seed}`);
  const title = rootTitle ?? `Mock Vault (${profile})`;
  const ctx = makeCtx(r, title);
  const all = new Budget(1e9);
  const vr = ctx.mk(all, TOP, { title, content: `<p>Generated by tools/lib/vault-gen.mjs, profile ${profile}, seed ${seed}. Safe to delete; seed-vault.js rebuilds it.</p>`, labels: [L("mockVault", profile)], position: 5000 }); // last under root
  if (def.stress) {
    ({ deepchain: buildDeepchain, widefan: buildWidefan, longtail: buildLongtail })[def.stress](ctx, vr, all);
  } else {
    const total = def.size - 2; // top note + README
    const weights = THEMES.map((t) => t[2]);
    const raw = weights.map((w) => w * total);
    const alloc = raw.map(Math.floor);
    let rest = total - alloc.reduce((a, c) => a + c, 0);
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, c) => c[0] - a[0]).forEach(([, i]) => { if (rest-- > 0) alloc[i]++; });
    THEMES.forEach(([, build], i) => build(ctx, vr, new Budget(alloc[i])));
    // README first in the tree, linking to the theme folders
    const themeKeys = ctx.notes.filter((n) => n.parent === vr);
    const readme = ctx.mk(all, vr, { title: "README", type: "text", mime: "text/html", content: `<h2>Mock vault</h2><p>${esc(def.desc)}.</p><ul>${themeKeys.map((n) => `<li><a class="reference-link" href="{{ref:${n.key}}}">${esc(n.title)}</a></li>`).join("")}</ul>`, labels: [L("readme")], position: 5 });
    void readme;
    decorate(ctx);
  }
  finalize(ctx, vr);
  return { profile, seed, rootTitle: title, notes: ctx.notes };
}

/** Replace {{ref:key}} placeholders: `idOf(key)` -> noteId. */
export function resolveRefs(content, idOf) {
  return content.replace(/\{\{ref:(k\d+)\}\}/g, (_, k) => `#root/${idOf(k)}`);
}

/** Library-style numbers for a vault (used by --list and tools/mock-test.mjs). */
export function vaultStats(vault) {
  const byKey = new Map(vault.notes.map((n) => [n.key, n]));
  const kids = new Map();
  for (const n of vault.notes) if (n.parent !== TOP) kids.set(n.parent, (kids.get(n.parent) ?? 0) + 1);
  const depthOf = (n) => { let d = 0; while (n.parent !== TOP) { n = byKey.get(n.parent); d++; } return d; };
  const byType = {}, labelNames = {};
  let maxDepth = 0, withColor = 0, archived = 0, inheritable = 0, relations = 0, clones = 0, labels = 0, binary = 0, maxChars = 0;
  for (const n of vault.notes) {
    byType[n.type] = (byType[n.type] ?? 0) + 1;
    maxDepth = Math.max(maxDepth, depthOf(n));
    for (const l of n.labels) {
      labels++;
      const name = l.name.replace(/[^\p{L}\p{N}_:]/gu, "_");
      labelNames[name] = (labelNames[name] ?? 0) + 1;
      if (name === "color") withColor++;
      if (name === "archived") archived++;
      if (l.inheritable) inheritable++;
    }
    relations += n.relations.length;
    clones += n.clones.length;
    if (n.bytes) binary++;
    maxChars = Math.max(maxChars, n.bytes ? 0 : n.content.length);
  }
  return {
    notes: vault.notes.length,
    folders: kids.size,
    leaves: vault.notes.length - kids.size,
    maxDepth, // top note = 0
    maxWidth: Math.max(0, ...kids.values()),
    byType, labelNames, labels, withColor, archived, inheritable, relations, clones, binary, maxChars,
  };
}
