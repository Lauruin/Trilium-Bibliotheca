#!/usr/bin/env node
/**
 * tools/proxy-test.mjs — integration test of the HOSTED mode (single origin): builds the real image and runs it against the
 * disposable Trilium mock and a fake AI upstream. Needs Docker (the dind daemon here) and `.bootstrap.env` (the mock's token).
 *
 *   node tools/proxy-test.mjs [--no-build] [--browser]          (npm run test:proxy)
 *   --browser also drives the real app (headless Chromium from .playwright-browsers) against the hosted containers
 *
 * What it proves (docker/30-biblio-config.sh + docker/nginx.conf):
 *   - /config.json carries the server name / root / read-only flag / AI provider + model and NO secret (the token and the AI key
 *     appear nowhere in any response body);
 *   - /etapi/ reaches Trilium with the token injected server-side: it works without an Authorization header, and a browser-sent
 *     header or cookie is REPLACED / dropped (the fake AI upstream shows what actually arrives);
 *   - /etapi/auth/* is refused (nobody behind the front door can mint tokens or log the injected one out);
 *   - a read-only host refuses every write (403) but serves reads, including binary content;
 *   - /ai/ forwards exactly two endpoints, POST only, with the provider's auth headers set by nginx (anthropic: x-api-key +
 *     anthropic-version; openai-compatible: Bearer + the base path), never the browser's cookie, bodies over 1 MB refused;
 *   - with no environment the app is the plain static site (`/config.json` has nulls, /etapi/ is not proxied);
 *   - a bad value (config injection attempt, missing token, bad provider) stops the container with a message.
 * Everything it creates (containers, a scratch note subtree) is removed afterwards.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const NO_BUILD = process.argv.includes("--no-build");
const BROWSER = process.argv.includes("--browser");
const IMAGE = "bibliotheca-web:proxy-test";
const AI_KEY = "sk-test-ai-key-0123456789";
const BROWSER_DUMMY = "dummy-from-the-browser";

let pass = 0, fail = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { fail++; failures.push(name); console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n").join("\n        ")}`); }
}
const section = (s) => console.log(`\n== ${s} ==`);

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const dockerTry = (...args) => { try { return docker(...args); } catch { return null; } };

function readBootstrap() {
  try {
    const env = Object.fromEntries(readFileSync(resolve(ROOT, ".bootstrap.env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    return env.TRILIUM_TOKEN ? env : null;
  } catch { return null; }
}

const boot = readBootstrap();
if (!boot) { console.log("proxy-test: skipped (no .bootstrap.env: start the Trilium mock with tools/trilium-bootstrap.sh)"); process.exit(0); }
if (dockerTry("version", "--format", "{{.Server.Version}}") === null) { console.log("proxy-test: skipped (no docker daemon)"); process.exit(0); }
const MOCK = "bibliotheca-trilium-mock";
const network = dockerTry("inspect", "-f", "{{range $k, $_ := .NetworkSettings.Networks}}{{$k}} {{end}}", MOCK)?.split(" ")[0];
if (!network) { console.log(`proxy-test: skipped (container ${MOCK} not found: start the mock)`); process.exit(0); }
const TOKEN = boot.TRILIUM_TOKEN;
const HOST = "dind"; // the dind sidecar publishes the test containers' ports

const started = [];
let nextPort = 18110;
function run(name, env, extra = []) {
  const port = nextPort++;
  const args = ["run", "-d", "--name", name, "--network", network, "--read-only", "--tmpfs", "/tmp", "--security-opt", "no-new-privileges:true", "-p", `${port}:80`];
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  docker(...args, ...extra, IMAGE);
  started.push(name);
  return { name, base: `http://${HOST}:${port}` };
}
async function waitUp(app, secs = 40) {
  for (let i = 0; i < secs * 4; i++) {
    try { const r = await fetch(`${app.base}/config.json`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${app.name} did not come up: ${spawnSync("docker", ["logs", app.name], { encoding: "utf8" }).output.join("\n")}`);
}
const call = async (app, method, path, { headers = {}, body } = {}) => {
  const res = await fetch(`${app.base}${path}`, { method, headers, body });
  const buf = Buffer.from(await res.arrayBuffer());
  let json;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, buf, text: buf.toString("utf8"), json };
};

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let scratch = null;
const direct = (method, path, body, ct = "application/json") =>
  fetch(`http://${HOST}:8080/etapi${path}`, { method, headers: { Authorization: TOKEN, ...(body !== undefined ? { "Content-Type": ct } : {}) }, body });

try {
  if (!NO_BUILD) {
    section("build the image");
    console.log("  docker build (cached layers make this quick) ...");
    docker("build", "-t", IMAGE, ROOT);
  }

  // a tiny fake AI upstream that echoes what it receives
  docker("run", "-d", "--name", "biblio-pt-ai", "--network", network, "node:22-alpine", "node", "-e",
    "require('http').createServer((q,r)=>{let b='';q.on('data',d=>b+=d);q.on('end',()=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({method:q.method,url:q.url,headers:q.headers,len:b.length}))})}).listen(9000)");
  started.push("biblio-pt-ai");
  await new Promise((r) => setTimeout(r, 1500));

  const mockUrl = `http://${MOCK}:8080`;
  const full = run("biblio-pt-full", { TRILIUM_URL: mockUrl, TRILIUM_TOKEN: TOKEN, TRILIUM_NAME: "Proxy Test", AI_BASE_URL: "http://biblio-pt-ai:9000", AI_KEY });
  const ro = run("biblio-pt-ro", { TRILIUM_URL: mockUrl, TRILIUM_TOKEN: TOKEN, TRILIUM_READONLY: "1", TRILIUM_PUBLIC_URL: "https://trilium.example.com/" });
  const oai = run("biblio-pt-oai", { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://biblio-pt-ai:9000/api/v1", AI_KEY, AI_MODEL: "some/model:free" });
  const plain = run("biblio-pt-plain", {});
  for (const a of [full, ro, oai, plain]) await waitUp(a);

  // scratch subtree on the mock (the full proxy is how we create it: that is part of the test)
  section("hosted mode: /config.json");
  await check("the config carries name, root, read-only flag, AI provider + model, and NO secret anywhere", async () => {
    const r = await call(full, "GET", "/config.json");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /json/);
    assert.match(r.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(r.json, { server: { name: "Proxy Test", rootNoteId: "root", readOnly: false, publicUrl: "" }, ai: { provider: "anthropic", model: "claude-haiku-5-5" } });
    for (const secret of [TOKEN, AI_KEY]) assert.ok(!r.text.includes(secret), "no secret in /config.json");
    // not in the page, the assets or any header either
    const idx = await call(full, "GET", "/");
    assert.ok(!idx.text.includes(TOKEN) && !JSON.stringify([...idx.headers]).includes(TOKEN));
  });
  await check("a read-only host says so and its public URL is normalised", async () => {
    const r = await call(ro, "GET", "/config.json");
    assert.deepEqual(r.json, { server: { name: "Trilium", rootNoteId: "root", readOnly: true, publicUrl: "https://trilium.example.com" }, ai: null });
  });
  await check("the openai-compatible AI host: provider and model, no key", async () => {
    const r = await call(oai, "GET", "/config.json");
    assert.deepEqual(r.json, { server: null, ai: { provider: "openai-compatible", model: "some/model:free" } });
    assert.ok(!r.text.includes(AI_KEY));
  });
  await check("no environment: the plain static app (nulls; /etapi/ is not proxied)", async () => {
    const r = await call(plain, "GET", "/config.json");
    assert.deepEqual(r.json, { server: null, ai: null });
    const e = await call(plain, "GET", "/etapi/app-info");
    assert.ok(!e.json?.appVersion, "nothing answers /etapi/ in a plain deployment");
  });

  section("hosted mode: /etapi/ on the app's own origin");
  await check("works without any Authorization header: nginx injects the token", async () => {
    const r = await call(full, "GET", "/etapi/app-info");
    assert.equal(r.status, 200);
    assert.equal(r.json.appVersion, "0.106.0");
  });
  await check("a header the browser sends is REPLACED (a wrong one does not break it), cookies never reach Trilium", async () => {
    const r = await call(full, "GET", "/etapi/app-info", { headers: { Authorization: "definitely-wrong", Cookie: "sso=abc" } });
    assert.equal(r.status, 200, "the injected token wins over the browser's header");
  });
  await check("reads and writes pass (create a note, read it, delete it)", async () => {
    const c = await call(full, "POST", "/etapi/create-note", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentNoteId: "root", title: "zz proxy-test", type: "text", content: "<p>via the proxy</p>" }) });
    assert.equal(c.status, 201, c.text);
    scratch = c.json.note.noteId;
    const g = await call(full, "GET", `/etapi/notes/${scratch}/content`);
    assert.equal(g.text, "<p>via the proxy</p>");
    const p = await call(full, "PATCH", `/etapi/notes/${scratch}`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "zz proxy-test 2" }) });
    assert.equal(p.status, 200);
  });
  await check("binary content survives the proxy byte for byte (an image note)", async () => {
    const mk = await call(full, "POST", "/etapi/create-note", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentNoteId: scratch, title: "pic", type: "image", mime: "image/png", content: "" }) });
    assert.equal(mk.status, 201);
    const id = mk.json.note.noteId;
    const put = await call(full, "PUT", `/etapi/notes/${id}/content`, { headers: { "Content-Type": "application/octet-stream" }, body: PNG });
    assert.equal(put.status, 204);
    const got = await call(full, "GET", `/etapi/notes/${id}/content`);
    assert.ok(got.buf.equals(PNG), "bytes equal");
    assert.equal(got.headers.get("content-type"), "image/png");
  });
  await check("logging in / out through the proxy is refused (nobody can mint tokens or kill the injected one)", async () => {
    for (const [m, p] of [["POST", "/etapi/auth/login"], ["POST", "/etapi/auth/logout"], ["GET", "/etapi/auth/anything"]]) {
      const r = await call(full, m, p, { headers: { "Content-Type": "application/json" }, body: m === "POST" ? JSON.stringify({ password: "x" }) : undefined });
      assert.equal(r.status, 403, `${m} ${p}`);
    }
    assert.equal((await call(full, "GET", "/etapi/app-info")).status, 200, "the injected token still works");
  });
  await check("a read-only host serves reads and refuses every write", async () => {
    assert.equal((await call(ro, "GET", "/etapi/app-info")).status, 200);
    assert.equal((await call(ro, "GET", `/etapi/notes/${scratch}`)).status, 200);
    for (const [m, p, b] of [["POST", "/etapi/create-note", JSON.stringify({ parentNoteId: "root", title: "no", type: "text", content: "" })], ["PATCH", `/etapi/notes/${scratch}`, JSON.stringify({ title: "no" })], ["PUT", `/etapi/notes/${scratch}/content`, "x"], ["DELETE", `/etapi/notes/${scratch}`, undefined], ["POST", "/etapi/attributes", JSON.stringify({ noteId: scratch, type: "label", name: "no" })]]) {
      const r = await call(ro, m, p, { headers: { "Content-Type": "application/json" }, body: b });
      assert.equal(r.status, 403, `${m} ${p}`);
    }
    const after = await direct("GET", `/notes/${scratch}`);
    assert.equal((await after.json()).title, "zz proxy-test 2", "nothing was changed by the refused writes");
  });

  section("hosted mode: /ai/ (anthropic style)");
  await check("POST /ai/v1/messages reaches the upstream with the key and version set by nginx, no cookie, the browser's dummy key replaced", async () => {
    const r = await call(full, "POST", "/ai/v1/messages", { headers: { "Content-Type": "application/json", "x-api-key": BROWSER_DUMMY, Cookie: "sso=secret", "anthropic-version": "1999-01-01" }, body: JSON.stringify({ model: "m", messages: [] }) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.method, "POST");
    assert.equal(r.json.url, "/v1/messages");
    assert.equal(r.json.headers["x-api-key"], AI_KEY);
    assert.equal(r.json.headers["anthropic-version"], "2023-06-01");
    assert.ok(!("cookie" in r.json.headers), "the user's cookie is not forwarded");
    assert.equal(r.json.headers.host, "biblio-pt-ai:9000");
    assert.ok(!JSON.stringify(r.json.headers).includes(BROWSER_DUMMY));
  });
  await check("only POST on the two endpoints; everything else under /ai/ is refused", async () => {
    assert.equal((await call(full, "GET", "/ai/v1/messages")).status, 403);
    assert.equal((await call(full, "PUT", "/ai/v1/messages", { body: "x" })).status, 403);
    for (const p of ["/ai/v1/models", "/ai/v1/messages/batches", "/ai/", "/ai/../etapi/app-info"]) {
      const r = await call(full, "POST", p, { headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.ok(r.status >= 400 && !r.json?.method, `${p} is not forwarded (${r.status})`);
    }
  });
  await check("a body over 1 MB is refused (413)", async () => {
    const r = await call(full, "POST", "/ai/v1/messages", { headers: { "Content-Type": "application/json" }, body: "x".repeat(1024 * 1024 + 10) });
    assert.equal(r.status, 413);
  });
  await check("the query string is not passed on (only the fixed endpoint)", async () => {
    const r = await call(full, "POST", "/ai/v1/messages?beta=true&x=1", { headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.ok(r.status === 200 ? r.json.url === "/v1/messages" : r.status >= 400);
  });

  section("hosted mode: /ai/ (openai-compatible style)");
  await check("POST /ai/chat/completions goes to <base>/chat/completions with a Bearer key", async () => {
    const r = await call(oai, "POST", "/ai/chat/completions", { headers: { "Content-Type": "application/json", Authorization: "Bearer from-browser", "x-api-key": "nope" }, body: JSON.stringify({ model: "x", messages: [] }) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.url, "/api/v1/chat/completions");
    assert.equal(r.json.headers.authorization, `Bearer ${AI_KEY}`);
    assert.ok(!("x-api-key" in r.json.headers) || r.json.headers["x-api-key"] === "", "no anthropic key header");
  });

  if (BROWSER) {
    section("the real app in a browser, hosted mode");
    const { chromium } = await import("playwright-core");
    const exe = execFileSync("sh", ["-c", `ls -d ${ROOT}/.playwright-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1`], { encoding: "utf8" }).trim();
    if (!exe) throw new Error("no headless chromium in .playwright-browsers (see AGENTS.md)");
    const libRoot = `${ROOT}/.playwright-libs/root`;
    const env = { ...process.env, LD_LIBRARY_PATH: [`${libRoot}/usr/lib/x86_64-linux-gnu`, `${libRoot}/lib/x86_64-linux-gnu`, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") };
    const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], env });
    try {
      await check("no stored settings: the app connects through its own origin, never sends an Authorization header, stores no token", async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        const etapi = [];
        page.on("request", (r) => { if (r.url().includes("/etapi/")) etapi.push({ url: r.url(), method: r.method(), auth: r.headers()["authorization"] }); });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(full.base, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".conn-online", { timeout: 90000 });
        await page.waitForFunction(() => document.querySelector(".crumb-btn")?.textContent === "Library", { timeout: 30000 });
        assert.ok(etapi.length > 5, `the walk went through /etapi/ (${etapi.length} requests)`);
        assert.ok(etapi.every((r) => r.url.startsWith(full.base + "/etapi/")), "every ETAPI request goes to the app's own origin");
        assert.ok(etapi.every((r) => !r.auth), "no request carries an Authorization header: the browser holds no token");
        const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
        assert.ok(!stored.includes(TOKEN), "the token is not in localStorage");
        assert.ok(!stored.includes('"token":"') || stored.includes('"token":""') || !stored.includes("biblio.v1.settings"), "no settings with a token are stored");
        await page.getByRole("button", { name: "settings" }).click();
        await page.waitForSelector('[data-testid="host-server"]', { timeout: 10000 });
        const box = await page.locator('[data-testid="host-server"]').innerText();
        assert.ok(/Proxy Test/.test(box) && /using it now/i.test(box), `the settings dialog names the host's server: ${box.slice(0, 120)}`);
        assert.deepEqual(errors, [], "no page errors");
        await ctx.close();
      });
      await check("a read-only host: the app loads, a capture is refused with a clear message and nothing is written", async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        const writes = [];
        page.on("request", (r) => { if (r.url().includes("/etapi/") && r.method() !== "GET") writes.push(r.method() + " " + r.url()); });
        await page.goto(ro.base, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".conn-online", { timeout: 90000 });
        await page.getByRole("button", { name: "capture" }).click();
        await page.waitForSelector("textarea", { timeout: 10000 });
        await page.fill("textarea", "this must not be saved");
        await page.keyboard.press("Control+Enter");
        await page.waitForFunction(() => /read-only/i.test(document.body.innerText), { timeout: 15000 });
        assert.deepEqual(writes, [], "the read-only client sent no write at all");
        await ctx.close();
      });
    } finally {
      await browser.close();
    }
  }

  section("bad configuration stops the container");
  const bad = (env) => {
    const args = ["run", "--rm", "--network", network, "--read-only", "--tmpfs", "/tmp"];
    for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
    return spawnSync("docker", [...args, IMAGE], { encoding: "utf8", timeout: 60000 });
  };
  for (const [what, env, expect] of [
    ["a config-injection attempt in TRILIUM_URL", { TRILIUM_URL: "http://x;}location /{return 200;}#", TRILIUM_TOKEN: "abcdefghijkl" }, /TRILIUM_URL/],
    ["a missing token", { TRILIUM_URL: "http://trilium:8080" }, /TRILIUM_TOKEN/],
    ["a token with quotes", { TRILIUM_URL: "http://trilium:8080", TRILIUM_TOKEN: 'abc"def;ghi' }, /TRILIUM_TOKEN/],
    ["a bad AI provider", { AI_PROVIDER: "skynet", AI_KEY: "abcdefghijkl" }, /AI_PROVIDER/],
    ["an openai-compatible host without a model", { AI_PROVIDER: "openai-compatible", AI_BASE_URL: "http://x:1/v1" }, /AI_MODEL/],
    ["a bad root note id", { TRILIUM_URL: "http://trilium:8080", TRILIUM_TOKEN: "abcdefghijkl", TRILIUM_ROOT_NOTE_ID: "a b" }, /ROOT_NOTE_ID/],
  ]) {
    await check(`${what}: exit != 0 with a message, nginx never starts`, async () => {
      const r = bad(env);
      assert.notEqual(r.status, 0, "exits with an error");
      assert.match(r.stderr + r.stdout, expect);
      assert.match(r.stderr + r.stdout, /biblio-config: ERROR/);
      assert.ok(!/nginx\/1\.|start worker process/.test(r.stderr + r.stdout), "nginx did not start");
    });
  }
} finally {
  if (scratch) await direct("DELETE", `/notes/${scratch}`).catch(() => undefined);
  for (const n of started) dockerTry("rm", "-f", n);
}

console.log(`\nproxy-test: ${fail ? `FAILURES (${pass} passed, ${fail} failed)` : `all green (${pass} passed, ${fail} failed)`}`);
if (fail) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
