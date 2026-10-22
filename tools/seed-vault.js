/**
 * tools/seed-vault.js — fill the disposable Trilium mock with a generated, deterministic vault.
 *
 *   node tools/seed-vault.js [profile]            build "Mock Vault (<profile>)" under root (default: medium)
 *   node tools/seed-vault.js --clean [profile]    delete it (no profile = every "Mock Vault (...)")
 *   node tools/seed-vault.js --list               profiles and their numbers (no network)
 *   options: --seed N (default 1)   --markdown-type (send type "markdown": only the fake accepts it)
 *            --url U --token T      ONLY for tools/etapi-fake.mjs (checked: app-info must say so)
 *
 * Idempotent: it deletes and rebuilds its own top-level note, nothing else. Safe by construction: it only talks to
 * the URL in .bootstrap.env (the mock tools/trilium-bootstrap.sh stood up) or to an etapi-fake. Details: AGENTS.md "Trilium mock".
 */
import { readFileSync } from "node:fs";
import { generateVault, PROFILES, vaultStats } from "./lib/vault-gen.mjs";
import { applyVault, pool } from "./lib/vault-apply.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const valueOpts = new Set(["--seed", "--url", "--token"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !valueOpts.has(args[i - 1]));
const profile = positional[0];
const seed = Number(opt("seed") ?? 1);

if (flag("list")) {
  console.log("profile     notes folders depth width  description   (depth: top note = 0; the app walks 400 notes / depth 8 from root)");
  for (const [name, def] of Object.entries(PROFILES)) {
    const s = vaultStats(generateVault(name, { seed }));
    console.log(`${name.padEnd(11)} ${String(s.notes).padStart(5)} ${String(s.folders).padStart(7)} ${String(s.maxDepth).padStart(5)} ${String(s.maxWidth).padStart(5)}  ${def.desc}`);
  }
  process.exit(0);
}

// --- which server may be written to ---------------------------------------------------------
function envCreds() {
  try {
    const raw = readFileSync(new URL("../.bootstrap.env", import.meta.url), "utf8");
    return { url: raw.match(/^TRILIUM_URL=(.*)$/m)?.[1], token: raw.match(/^TRILIUM_TOKEN=(.*)$/m)?.[1] };
  } catch { return {}; }
}
const env = envCreds();
let url = opt("url") ?? env.url;
// the .bootstrap.env token only ever goes to the .bootstrap.env URL (never to a --url the script has not vetted yet)
let token = opt("token") ?? (url?.replace(/\/+$/, "") === env.url?.replace(/\/+$/, "") ? env.token : undefined);
if (!url || !token) { console.error("seed-vault: no credentials - run tools/trilium-bootstrap.sh (writes .bootstrap.env) or pass --url/--token for an etapi-fake"); process.exit(1); }
url = url.replace(/\/+$/, "");

async function api(method, path, body, raw) {
  const headers = { Authorization: token };
  let payload;
  if (raw) { headers["Content-Type"] = raw.contentType; payload = raw.body; }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`${url}/etapi${path}`, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const info = await api("GET", "/app-info").catch((e) => { console.error(`seed-vault: cannot reach ${url}: ${e.message}`); process.exit(1); });
const isFake = info.buildRevision === "etapi-fake";
if (url !== env.url?.replace(/\/+$/, "") && !isFake) {
  console.error(`seed-vault: refusing ${url}: it is neither the mock in .bootstrap.env (${env.url}) nor an etapi-fake. This script deletes and creates notes.`);
  process.exit(1);
}

// --- clean ----------------------------------------------------------------------------------
async function clean(title) {
  const root = await api("GET", "/notes/root");
  const gone = [];
  for (const id of root.childNoteIds) {
    if (id.startsWith("_")) continue; // Trilium's own subtrees
    const n = await api("GET", `/notes/${id}`);
    if (title ? n.title === title : /^Mock Vault \(.+\)$/.test(n.title)) { await api("DELETE", `/notes/${id}`); gone.push(n.title); }
  }
  return gone;
}

if (flag("clean")) {
  if (profile && !PROFILES[profile]) { console.error(`seed-vault: unknown profile "${profile}"`); process.exit(1); }
  const gone = await clean(profile ? `Mock Vault (${profile})` : undefined);
  console.log(gone.length ? `removed: ${gone.join(", ")}` : "nothing to remove");
  process.exit(0);
}

// --- seed -----------------------------------------------------------------------------------
const name = profile ?? "medium";
if (!PROFILES[name]) { console.error(`seed-vault: unknown profile "${name}" (known: ${Object.keys(PROFILES).join(", ")})`); process.exit(1); }
const vault = generateVault(name, { seed });
const stats = vaultStats(vault);
const gone = await clean(vault.rootTitle);
if (gone.length) console.log(`replaced ${gone.length} old "${vault.rootTitle}"`);

const t0 = Date.now();
let lastLine = 0;
const { topNoteId } = await applyVault(vault, {
  api, poolSize: 8, markdownType: flag("markdown-type"),
  onProgress: ({ phase, done, total }) => {
    if (process.stdout.isTTY && (done === total || Date.now() - lastLine > 120)) { lastLine = Date.now(); process.stdout.write(`\r  ${phase.padEnd(10)} ${done}/${total}   `); }
    else if (!process.stdout.isTTY && done === total) console.log(`  ${phase}: ${done}/${total}`);
  },
});
if (process.stdout.isTTY) process.stdout.write("\n");

// verify by walking what the server now holds (same BFS the app does, minus the caps)
let found = 0;
const queue = [topNoteId], seen = new Set();
while (queue.length) {
  const batch = queue.splice(0, 8).filter((id) => !seen.has(id));
  await pool(batch, 8, async (id) => {
    seen.add(id);
    const n = await api("GET", `/notes/${id}`);
    found++;
    queue.push(...n.childNoteIds.filter((c) => !seen.has(c)));
  });
}
console.log(`seeded "${vault.rootTitle}" (${topNoteId}) in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${stats.notes} notes generated, ${found} reachable, ` +
  `${stats.folders} folders, depth ${stats.maxDepth}, widest ${stats.maxWidth}, ${stats.labels} labels, ${stats.relations} relations, ${stats.clones} clones, ${stats.binary} binary`);
if (found !== stats.notes) { console.error(`seed-vault: MISMATCH - generated ${stats.notes} but ${found} reachable`); process.exit(1); }
