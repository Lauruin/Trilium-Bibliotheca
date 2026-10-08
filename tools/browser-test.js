/**
 * tools/browser-test.js — real headless browser pass.
 *
 * Proves the whole stack in a real Chromium (odd-arcade's check.sh pattern):
 *   1. starts the vite dev server on 31085,
 *   2. seeds the mock vault via ETAPI (a room, a tagged book note),
 *   3. loads the app with settings pre-injected into localStorage,
 *   4. drives the UI: world mounts → search → book popup → overview toggle,
 *   5. fails on ANY console error or page error.
 *
 * Credentials come from .bootstrap.env (tools/trilium-bootstrap.sh). The
 * playwright-core + chromium build are shared with odd-arcade via the
 * default browser cache (~/.cache/ms-playwright); version is pinned in
 * package.json to match the installed browser build.
 *
 * Usage: node tools/browser-test.js
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
// playwright-core is a devDependency; odd-arcade's copy is the local fallback
// (shared browser build in ~/.cache/ms-playwright works with either).
let chromium;
try {
  ({ chromium } = require_("playwright-core"));
} catch {
  ({ chromium } = require_("/workspace/projects/odd-arcade/node_modules/playwright-core"));
}

const APP_PORT = 31085;
const APP_URL = `http://localhost:${APP_PORT}`;

// --- credentials ------------------------------------------------------------
function loadCreds() {
  try {
    const raw = readFileSync(".bootstrap.env", "utf8");
    const url = raw.match(/^TRILIUM_URL=(.*)$/m)?.[1];
    const token = raw.match(/^TRILIUM_TOKEN=(.*)$/m)?.[1];
    if (url && token) return { url, token };
  } catch { /* fall through */ }
  console.error("browser-test: no credentials — run tools/trilium-bootstrap.sh first");
  process.exit(1);
}
const { url: TRILIUM_URL, token: TRILIUM_TOKEN } = loadCreds();

// --- helpers ----------------------------------------------------------------
const consoleErrors = [];
function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

async function waitFor(fn, what, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      if (await fn()) return;
    } catch { /* keep waiting */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// --- seed the vault (idempotent: skip when the demo room already exists) ----
async function seedVault() {
  const headers = { Authorization: TRILIUM_TOKEN, "Content-Type": "application/json" };
  const search = await (await fetch(`${TRILIUM_URL}/etapi/notes?search=Bibliotheca%20Demo`, { headers })).json();
  if (search.results?.some((n) => n.title === "Bibliotheca Demo")) {
    ok("vault already seeded");
    return;
  }
  const res = await fetch(`${TRILIUM_URL}/etapi/create-note`, {
    method: "POST", headers,
    body: JSON.stringify({
      parentNoteId: "root",
      title: "Bibliotheca Demo",
      type: "text",
      content: "<p>The demo room.</p>",
    }),
  });
  const created = await res.json();
  await fetch(`${TRILIUM_URL}/etapi/create-note`, {
    method: "POST", headers,
    body: JSON.stringify({
      parentNoteId: created.note.noteId,
      title: "Hello Note",
      type: "text",
      content: "<p>Hello from the demo book.</p>",
      // A label makes it stand on a shelf instead of the desk.
      // (create-note has no attributes field — set it after creation.)
    }),
  }).then(async (r) => {
    const book = await r.json();
    await fetch(`${TRILIUM_URL}/etapi/attributes`, {
      method: "POST", headers,
      body: JSON.stringify({ noteId: book.note.noteId, type: "label", name: "demo", value: "" }),
    });
  });
  ok("vault seeded (room + tagged book)");
}

// --- main --------------------------------------------------------------------
let vite;
try {
  vite = spawn("npx", ["vite", "--port", String(APP_PORT), "--strictPort"], {
    stdio: "ignore",
    detached: true,
  });
  await waitFor(async () => (await fetch(APP_URL).catch(() => null))?.ok, "vite dev server");
  ok(`dev server up on ${APP_URL}`);

  await seedVault();

  // The headless shell binary installed under ~/.cache/ms-playwright (shared
  // with odd-arcade). CHROME_PATH overrides; else resolve the newest build.
  const { execSync } = await import("node:child_process");
  const browserPath =
    process.env.CHROME_PATH ||
    execSync(
      "ls -d $HOME/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | sort | tail -1",
    ).toString().trim() ||
    undefined;
  if (!browserPath) throw new Error("no chromium headless shell found (set CHROME_PATH)");
  const browser = await chromium.launch({
    executablePath: browserPath,
    args: ["--no-sandbox"], // required inside this container
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Settings must exist before app code runs: inject into localStorage.
  // The try/catch matters: Playwright replays init scripts in EVERY frame,
  // including the sandboxed book iframe where localStorage access throws a
  // SecurityError (no allow-same-origin). The main frame is what matters.
  await context.addInitScript(
    ([settings]) => {
      try {
        localStorage.setItem("biblio.v1.settings", JSON.stringify(settings));
      } catch {
        /* sandboxed frame — nothing to do there */
      }
    },
    [{ serverUrl: TRILIUM_URL, token: TRILIUM_TOKEN, rootNoteId: "root" }],
  );

  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  // 1. World mounts: canvas present, connection online, breadcrumb rendered.
  // (Generous timeouts: a cold vite run transforms the multi-MB Phaser module
  // on first load, which can easily eat 10+ seconds.)
  await page.waitForSelector("#game-host canvas", { timeout: 30000 });
  await page.waitForSelector(".conn-online", { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelector(".crumb-btn")?.textContent === "Library",
    { timeout: 30000 },
  );
  ok("world mounted, vault walked, connection online");

  // 2. Search (the wisp): find the seeded note, open it as a book.
  await page.getByRole("button", { name: "search" }).click();
  await page.fill(".search-form input", "Hello");
  await page.locator(".search-form button[type=submit]").click();
  await page.waitForSelector(".search-results li button", { timeout: 10000 });
  await page.locator(".search-results li button").first().click();
  await page.waitForSelector("iframe.book-frame", { timeout: 10000 });
  const srcDoc = await page.locator("iframe.book-frame").first().getAttribute("srcdoc");
  if (!srcDoc?.includes("Hello from the demo book")) fail("book popup lacks seeded content");
  else ok("book popup renders note content (sandboxed iframe)");
  await page.getByRole("button", { name: "✕" }).click();

  // 3. Overview toggle via HUD.
  await page.getByRole("button", { name: "overview", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".hud-right button.active")?.textContent === "exit overview",
    { timeout: 10000 },
  );
  ok("overview mode toggles from the HUD");
  await page.getByRole("button", { name: "exit overview" }).click();

  // 4. Console must be clean.
  if (consoleErrors.length > 0) {
    fail(`${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors) console.error(`    ${e}`);
  } else {
    ok("zero console errors");
  }

  await browser.close();
} finally {
  if (vite?.pid) process.kill(-vite.pid, "SIGTERM");
}

process.exit(process.exitCode ?? 0);