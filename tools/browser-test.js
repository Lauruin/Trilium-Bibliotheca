/**
 * tools/browser-test.js — real headless browser pass.
 *
 * Proves the whole stack in a real Chromium (odd-arcade's check.sh pattern):
 *   1. starts the vite dev server on 5173,
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

const APP_PORT = 5173;
// APP_URL (optional): test an already-hosted instance instead of spawning
// the dev server. Example:
//   APP_URL=http://dind:8081 node tools/browser-test.js   # hosted container
const APP_URL = process.env.APP_URL ?? `http://localhost:${APP_PORT}`;

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

// Start from a clean root even if an earlier aborted run left a world-building
// label behind (must happen BEFORE the app loads its tree).
async function cleanRootLabels() {
  const note = await (await fetch(`${TRILIUM_URL}/etapi/notes/root`, { headers: { Authorization: TRILIUM_TOKEN } })).json();
  for (const a of note.attributes ?? []) {
    if (a.name.startsWith("biblio_") && !["biblio_x", "biblio_y", "biblio_inbox"].includes(a.name)) {
      await fetch(`${TRILIUM_URL}/etapi/attributes/${a.attributeId}`, { method: "DELETE", headers: { Authorization: TRILIUM_TOKEN } });
    }
  }
}

// --- main --------------------------------------------------------------------
let vite;
try {
  if (process.env.APP_URL) {
    ok(`testing hosted instance at ${APP_URL}`);
  } else {
    vite = spawn("npx", ["vite", "--port", String(APP_PORT), "--strictPort"], {
      stdio: "ignore",
      detached: true,
    });
    await waitFor(async () => (await fetch(APP_URL).catch(() => null))?.ok, "vite dev server");
    ok(`dev server up on ${APP_URL}`);
  }

  await seedVault();
  await cleanRootLabels();

  // CHROME_PATH overrides. Otherwise the newest headless shell, looked up in
  // the project-local .playwright-browsers/ (new layout, downloaded on the host)
  // and then ~/.cache/ms-playwright (shared with odd-arcade, old layout).
  const { execSync } = await import("node:child_process");
  const browserPath =
    process.env.CHROME_PATH ||
    execSync(
      "ls -d .playwright-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell " +
        "$HOME/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -1",
    ).toString().trim() ||
    undefined;
  if (!browserPath) throw new Error("no chromium headless shell found (set CHROME_PATH)");
  // Extra shared libraries extracted from .deb files (see .playwright-libs/) for
  // images that lack Chromium's system dependencies. Harmless when absent.
  const libRoot = `${process.cwd()}/.playwright-libs/root`;
  const libPath = [`${libRoot}/usr/lib/x86_64-linux-gnu`, `${libRoot}/lib/x86_64-linux-gnu`, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":");
  // WebGL (the tree view) needs the FULL chrome with SwiftShader and WAYLAND_DISPLAY/DISPLAY unset
  // (VS Code's Wayland socket makes ANGLE demand an extension SwiftShader lacks). Fall back to the
  // headless shell (no WebGL → the tree steps are skipped).
  const env = { ...process.env, LD_LIBRARY_PATH: libPath };
  delete env.WAYLAND_DISPLAY;
  delete env.DISPLAY;
  const fullChrome = execSync("ls -d .playwright-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1").toString().trim();
  let browser;
  if (!process.env.CHROME_PATH && fullChrome) {
    try {
      browser = await chromium.launch({
        executablePath: fullChrome,
        args: ["--no-sandbox", "--headless=new", "--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
        env,
        timeout: 20000,
      });
    } catch {
      browser = undefined; // missing system libs for the full build → headless shell below
    }
  }
  browser ??= await chromium.launch({
    executablePath: browserPath,
    args: ["--no-sandbox"], // required inside this container
    env,
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

  // 2b. Reader: internal links navigate in-reader (+ back), text size / paper prefs apply.
  const H = { Authorization: TRILIUM_TOKEN, "Content-Type": "application/json" };
  const mkNote = async (title, content) =>
    (await (await fetch(`${TRILIUM_URL}/etapi/create-note`, { method: "POST", headers: H, body: JSON.stringify({ parentNoteId: "root", title, type: "text", content }) })).json()).note.noteId;
  const tag = Date.now();
  const bId = await mkNote(`linktargetB${tag}`, "<p>You reached B.</p>");
  const aId = await mkNote(`linksourceA${tag}`, `<p>See <a class="reference-link" href="#root/${bId}">the B note</a> and <a href="https://example.org/x">outside</a>.</p>`);
  try {
    await page.getByRole("button", { name: "search" }).click();
    await page.fill(".search-form input", `linksourceA${tag}`);
    await page.locator(".search-form button[type=submit]").click();
    await page.waitForSelector(".search-results li button", { timeout: 10000 });
    await page.locator(".search-results li button").first().click();
    await page.waitForSelector("iframe.book-frame", { timeout: 10000 });
    const frame = page.frameLocator("iframe.book-frame");
    await frame.getByText("the B note").click();
    await page.getByRole("heading", { name: `linktargetB${tag}` }).waitFor({ timeout: 10000 });
    ok("reader: internal link navigated inside the reader");
    await page.getByRole("button", { name: "◀" }).click();
    await page.getByRole("heading", { name: `linksourceA${tag}` }).waitFor({ timeout: 10000 });
    ok("reader: back button returns to the previous note");
    await page.getByRole("button", { name: "A+" }).click();
    await page.getByRole("button", { name: "Aa" }).click();
    await page.getByRole("button", { name: "Night" }).click();
    await page.waitForFunction(() => document.querySelector("iframe.book-frame")?.getAttribute("srcdoc")?.includes("#1c1a24"), { timeout: 10000 }).catch(() => {});
    const styled = await page.locator("iframe.book-frame").getAttribute("srcdoc");
    if (styled?.includes("font-size: 21px") && styled.includes("#1c1a24")) ok("reader: text size + paper preferences applied");
    else fail("reader prefs not reflected in the document");
    // a script injected into a note must not run (CSP): the frame has no way to alter the parent
    const csp = styled?.includes("script-src 'nonce-");
    if (csp) ok("reader: CSP restricts scripts to our nonce");
    else fail("reader CSP missing");
    await page.getByRole("button", { name: "✕" }).click();
  } finally {
    for (const id of [aId, bId]) await fetch(`${TRILIUM_URL}/etapi/notes/${id}`, { method: "DELETE", headers: { Authorization: TRILIUM_TOKEN } });
  }

  // 2c. Yggdrasil (tree) view: needs WebGL — skipped (with a note) where the browser has none.
  await page.getByRole("button", { name: "tree", exact: true }).click();
  await page.waitForTimeout(2500);
  const rootAttrs = async () =>
    (await (await fetch(`${TRILIUM_URL}/etapi/notes/root`, { headers: { Authorization: TRILIUM_TOKEN } })).json()).attributes ?? [];
  const noGl = await page.locator(".tree-error").count();
  if (noGl > 0) {
    ok("tree view: no WebGL in this browser — steps skipped (shows its error message)");
  } else {
    await page.waitForFunction(() => window.__treeScene && window.__treeScene.leaves.length > 0, { timeout: 15000 });
    const stats = await page.evaluate(() => ({ b: window.__treeScene.world.branches.size, l: window.__treeScene.leaves.length }));
    if (stats.b > 0 && stats.l > 0) ok(`tree view: vault laid out as ${stats.b} branches / ${stats.l} leaves`);
    else fail("tree view built no branches/leaves");
    // walk up to the first leaf and read it with E (teleport next to it: the walking itself is unit-tested)
    const leaf = await page.evaluate(() => {
      const sc = window.__treeScene;
      const lf = sc.leaves.find((x) => /Hello|Project|Archive|Dune|Volume/i.test(x.title ?? "")) ?? sc.leaves[0];
      sc.respawn(lf.branchId, lf.s);
      sc.creature.head.th = lf.th;
      return { title: lf.title, id: lf.id };
    });
    await page.waitForTimeout(600);
    await page.keyboard.press("e");
    await page.waitForSelector("iframe.book-frame", { timeout: 10000 });
    const head = await page.locator(".book-title").innerText();
    if (head === leaf.title) ok("tree view: E next to a leaf opens that note in the reader");
    else fail(`reader opened "${head}" but the leaf was "${leaf.title}"`);
    await page.getByRole("button", { name: "✕" }).click();
    // keys: V toggles camera, '-' zooms out (wheel/+/- zoom works), then back to the library
    const z0 = await page.evaluate(() => window.__treeScene.zoomMul);
    await page.keyboard.press("-");
    const z1 = await page.evaluate(() => window.__treeScene.zoomMul);
    if (z1 > z0) ok("tree view: zoom works");
    else fail(`zoom did not change (${z0} → ${z1})`);
    // L switches voxel ↔ low-poly, V cycles the camera, leaf sizes follow the (measured) note length, a ground exists
    const look0 = await page.evaluate(() => window.__treeScene.look);
    await page.keyboard.press("l");
    const look1 = await page.evaluate(() => window.__treeScene.look);
    await page.waitForTimeout(400);
    if (look0 !== look1) ok(`tree view: L switched the look (${look0} → ${look1})`);
    else fail("L did not switch the look");
    await page.keyboard.press("v");
    const cam1 = await page.evaluate(() => window.__treeScene.camMode);
    await page.waitForTimeout(300);
    if (["chase", "level", "fixed"].includes(cam1)) ok(`tree view: V cycled the camera (now ${cam1})`);
    else fail(`unknown camera mode ${cam1}`);
    await page.waitForFunction(() => window.__treeScene.leaves.some((l) => l.size !== 1), { timeout: 15000 }).then(
      () => ok("tree view: leaf sizes follow the measured note length"),
      () => fail("no leaf size was ever measured"),
    );
    const ground = await page.evaluate(() => window.__treeScene.world.groundY);
    if (typeof ground === "number") ok(`tree view: ground at y=${ground}`);
    else fail("layout world has no groundY");
    // N cycles the branch names, 1/2/3 pick animal categories (again = next), H toggles auto-align, branches taper
    const lab0 = await page.evaluate(() => window.__treeScene.labelMode);
    await page.keyboard.press("n");
    const lab1 = await page.evaluate(() => window.__treeScene.labelMode);
    if (lab0 !== lab1) ok(`tree view: N cycled the branch names (${lab0} → ${lab1})`);
    else fail("N did not change the label mode");
    const ids = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("3");
      ids.push(await page.evaluate(() => window.__treeScene.creature.animal.id));
    }
    if (new Set(ids).size === 4 && ids.every((x) => ["squirrel", "bee", "dragonfly", "bluejay"].includes(x))) ok(`tree view: key 3 cycles the fliers (${ids.join(" → ")})`);
    else fail(`key 3 did not cycle through the fliers: ${ids}`);
    const aa0 = await page.evaluate(() => window.__treeScene.creature.autoAlign);
    await page.keyboard.press("h");
    const aa1 = await page.evaluate(() => window.__treeScene.creature.autoAlign);
    if (aa0 !== aa1) ok(`tree view: H toggled auto-align (${aa0} → ${aa1})`);
    else fail("H did not toggle auto-align");
    const tapered = await page.evaluate(() => [...window.__treeScene.world.branches.values()].filter((b) => !b.root).every((b) => b.rEnd < b.r));
    if (tapered) ok("tree view: every branch thins out along its length (ground roots excepted: they widen towards their tree)");
    else fail("some branch does not taper");
    // B: branch properties — edit the hub's length, save it as a label, then recalculate (label removed)
    await page.evaluate(() => {
      const sc = window.__treeScene;
      const hub = [...sc.world.branches.values()].find((b) => b.parent === null && !b.silk);
      sc.respawn(hub.id, 120);
    });
    await page.waitForFunction(() => !(document.querySelector(".tree-crumbs")?.textContent ?? "").includes("›"), { timeout: 30000 }); // the HUD has caught up (software GL is slow)
    await page.keyboard.press("b");
    await page.waitForSelector(".branch-panel", { timeout: 10000 });
    await page.locator('.branch-panel input[type="range"]').first().fill("420");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const blen = await (async () => {
      for (let i = 0; i < 40; i++) {
        const v = (await rootAttrs()).find((a) => a.name === "biblio_blen");
        if (v) return v;
        await page.waitForTimeout(250);
      }
      return null;
    })();
    if (blen && Number(blen.value) === 420) ok("tree view: B saved the hub length as biblio_blen=420");
    else fail(`biblio_blen label missing/wrong: ${JSON.stringify(blen)}`);
    await page.getByRole("button", { name: "Recalculate all" }).click();
    for (let i = 0; i < 40 && (await rootAttrs()).some((a) => a.name === "biblio_blen"); i++) await page.waitForTimeout(250);
    if (!(await rootAttrs()).some((a) => a.name === "biblio_blen")) ok("tree view: Recalculate all removed the override");
    else fail("biblio_blen still present after Recalculate all");
    await page.keyboard.press("Escape");
    await page.locator(".branch-panel button", { hasText: "✕" }).click();
    await page.keyboard.press("l"); // back to the saved look
    await page.keyboard.press("t");
  }
  if (noGl > 0) await page.getByRole("button", { name: "library", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#game-host")?.style.display !== "none", { timeout: 10000 });
  ok("tree view: back to the library rooms");

  // 3. Overview toggle via HUD.
  await page.getByRole("button", { name: "overview", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".hud-right button.active")?.textContent === "exit overview",
    { timeout: 10000 },
  );
  ok("overview mode toggles from the HUD");
  await page.getByRole("button", { name: "exit overview" }).click();

  // 4. Quick capture: "c" opens it, Ctrl+Enter files a note under the Inbox.
  const stamp = `captured-by-browser-test-${Date.now()}`;
  await page.locator("#game-host").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("c");
  await page.getByRole("dialog", { name: "Quick capture" }).waitFor({ timeout: 10000 });
  // Regression: the game's movement keys (a d e w o, space) must be typeable here.
  await page.locator(".capture-area").pressSequentially("adewo s");
  const typed = await page.locator(".capture-area").inputValue();
  if (typed === "adewo s") ok("movement-key letters can be typed in capture");
  else fail(`typing swallowed by the game: got ${JSON.stringify(typed)}`);
  await page.locator(".capture-area").fill(`${stamp}\nsecond line`);
  await page.keyboard.press("Control+Enter");
  await page.getByText("1 saved to Inbox").waitFor({ timeout: 10000 });
  const found = await (await fetch(`${TRILIUM_URL}/etapi/notes?search=${stamp}`, {
    headers: { Authorization: TRILIUM_TOKEN },
  })).json();
  const hit = found.results?.find((n) => n.title === stamp);
  if (!hit) fail("captured note not found in Trilium");
  else {
    const parent = await (await fetch(`${TRILIUM_URL}/etapi/notes/${hit.parentNoteIds[0]}`, {
      headers: { Authorization: TRILIUM_TOKEN },
    })).json();
    if (parent.title === "Inbox" && parent.attributes.some((a) => a.name === "biblio_inbox")) {
      ok("quick capture filed the note under the labelled Inbox");
    } else fail(`captured note has wrong parent: ${parent.title}`);
    // Leave no clutter behind in a vault someone may actually be using.
    await fetch(`${TRILIUM_URL}/etapi/notes/${hit.noteId}`, { method: "DELETE", headers: { Authorization: TRILIUM_TOKEN } });
  }
  await page.keyboard.press("Escape");

  // 5. World building: B → pick theme 2 → Enter writes ONE label; Z undoes it.
  await page.locator("body").click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press("b");
  await page.getByRole("dialog", { name: "Build mode" }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(250); // let the panel's key listener attach
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await page.getByText("1 change saved").waitFor({ timeout: 10000 });
  const themed = (await rootAttrs()).find((a) => a.name === "biblio_theme");
  if (themed?.value === "midnight") ok("build mode applied a theme as one biblio_theme label");
  else fail(`theme label missing/wrong: ${JSON.stringify(themed)}`);
  await page.keyboard.press("z");
  await page.getByText("Undid: Theme").waitFor({ timeout: 10000 });
  if (!(await rootAttrs()).some((a) => a.name === "biblio_theme")) ok("Z undid the theme (label removed)");
  else fail("theme label still present after undo");

  // Wall slot edit: B → Tab (wall) → ] (slot 1: auto→window) → Enter writes biblio_wall; Z removes it.
  await page.keyboard.press("b");
  await page.getByRole("dialog", { name: "Build mode" }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(250); // let the panel's key listener attach
  await page.keyboard.press("Tab");
  await page.keyboard.press("]");
  await page.keyboard.press("Enter");
  await page.getByText("1 change saved").waitFor({ timeout: 10000 });
  const walled = (await rootAttrs()).find((a) => a.name === "biblio_wall");
  if (walled?.value === "window") ok("wall slot edit wrote biblio_wall=window");
  else fail(`wall label missing/wrong: ${JSON.stringify(walled)}`);
  await page.keyboard.press("z");
  await page.getByText("Undid: Wall decor").waitFor({ timeout: 10000 });
  if (!(await rootAttrs()).some((a) => a.name === "biblio_wall")) ok("Z undid the wall edit");
  else fail("wall label still present after undo");

  // 6. PWA share target: the OS opens /?title&text&url → capture prefilled, URL cleaned.
  await page.goto(`${APP_URL}/?title=Shared%20page&text=read%20later&url=https%3A%2F%2Fexample.org%2Fa`);
  await page.getByRole("dialog", { name: "Quick capture" }).waitFor({ timeout: 15000 });
  const prefill = await page.locator(".capture-area").inputValue();
  if (prefill === "Shared page\nread later\nhttps://example.org/a" && !page.url().includes("?")) {
    ok("share target prefills quick capture and clears the query");
  } else fail(`share prefill wrong: ${JSON.stringify(prefill)} @ ${page.url()}`);
  await page.keyboard.press("Escape");

  // 7. Console must be clean.
  if (consoleErrors.length > 0) {
    fail(`${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors) console.error(`    ${e}`);
  } else {
    ok("zero console errors");
  }

  await browser.close();
} finally {
  try { if (vite?.pid) process.kill(-vite.pid, "SIGTERM"); } catch { /* vite already gone (port was taken by another dev server) */ }
}

process.exit(process.exitCode ?? 0);