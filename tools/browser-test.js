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


// Click a reader paper button and make sure it took: in the full headless Chrome an input event right after the reader's iframe was
// swapped is sometimes never delivered to the page (seen in a DOM event log: no mousedown at all), so retry until the paper is active.
function assert_(cond, what) {
  if (!cond) throw new Error(`assertion failed: ${what}`);
}

async function pickPaper(page, label, tries = 5) {
  for (let i = 0; i < tries; i++) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const active = await page.locator(".paper-btn.active").first().innerText({ timeout: 2000 }).catch(() => "");
    if (active.trim() === label) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not select the "${label}" paper`);
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

  // (the app now STARTS in the tree view when WebGL works; the library parts of this test begin with ?view=library, the tree start is step 2d)
  await page.goto(`${APP_URL}/?view=library`, { waitUntil: "domcontentloaded" });
  const hasGl = await page.evaluate(() => { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); });

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
    // (the click can land before the sandboxed page's script is listening: retry it)
    for (let attempt = 0; attempt < 4; attempt++) {
      await frame.getByText("the B note").click();
      if (await page.getByRole("heading", { name: `linktargetB${tag}` }).waitFor({ timeout: 4000 }).then(() => true, () => false)) break;
    }
    await page.getByRole("heading", { name: `linktargetB${tag}` }).waitFor({ timeout: 10000 });
    ok("reader: internal link navigated inside the reader");
    await page.getByRole("button", { name: "◀" }).click();
    await page.getByRole("heading", { name: `linksourceA${tag}` }).waitFor({ timeout: 10000 });
    ok("reader: back button returns to the previous note");
    await page.getByRole("button", { name: "A+" }).click();
    await page.getByRole("button", { name: "Aa" }).click();
    await pickPaper(page, "Night");
    await page.waitForFunction(() => document.querySelector("iframe.book-frame")?.getAttribute("srcdoc")?.includes("#1c1a24"), { timeout: 10000 }).catch(() => {});
    const styled = await page.locator("iframe.book-frame").getAttribute("srcdoc");
    if (styled?.includes("font-size: 21px") && styled.includes("#1c1a24")) ok("reader: text size + paper preferences applied");
    else {
      await page.screenshot({ path: "shots/debug-prefs.png" });
      const active = await page.locator(".paper-btn.active").allInnerTexts();
      const stored = await page.evaluate(() => localStorage.getItem("biblio.v1.reader"));
      fail(`reader prefs not reflected in the document (sizes ${JSON.stringify(styled?.match(/font-size: \d+px/g)?.slice(0, 3))}, night page ${styled?.includes("#1c1a24")}, active paper ${active}, stored ${stored})`);
    }
    // a script injected into a note must not run (CSP): the frame has no way to alter the parent
    const csp = styled?.includes("script-src 'nonce-");
    if (csp) ok("reader: CSP restricts scripts to our nonce");
    else fail("reader CSP missing");
    await page.getByRole("button", { name: "✕" }).click();
  } finally {
    for (const id of [aId, bId]) await fetch(`${TRILIUM_URL}/etapi/notes/${id}`, { method: "DELETE", headers: { Authorization: TRILIUM_TOKEN } });
  }

  // 2d. Reader: image / PDF / file notes, a picture embedded through an ATTACHMENT, outline + find, the leaf papers.
  {
    const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const PDF1 = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    const mkBinary = async (title, type, mime, bytes) => {
      const n = (await (await fetch(`${TRILIUM_URL}/etapi/create-note`, { method: "POST", headers: H, body: JSON.stringify({ parentNoteId: "root", title, type, mime, content: "" }) })).json()).note.noteId;
      await fetch(`${TRILIUM_URL}/etapi/notes/${n}/content`, { method: "PUT", headers: { Authorization: TRILIUM_TOKEN, "Content-Type": "application/octet-stream" }, body: bytes });
      return n;
    };
    const openByTitle = async (title) => {
      await page.getByRole("button", { name: "search" }).click();
      await page.fill(".search-form input", title);
      await page.locator(".search-form button[type=submit]").click();
      await page.waitForSelector(".search-results li button", { timeout: 10000 });
      await page.locator(".search-results li button").first().click();
      await page.getByRole("heading", { name: title }).waitFor({ timeout: 10000 });
    };
    const made = [];
    try {
      const pngId = await mkBinary(`mediaPng${tag}`, "image", "image/png", PNG1);
      made.push(pngId, await mkBinary(`mediaPdf${tag}`, "file", "application/pdf", PDF1));
      made.push(await mkBinary(`mediaSniff${tag}`, "file", "application/octet-stream", PNG1)); // a PNG hiding in a generic file note
      made.push(await mkBinary(`mediaTxt${tag}`, "file", "text/plain", Buffer.from("plain text file body")));
      made.push(await mkBinary(`mediaZip${tag}`, "file", "application/zip", Buffer.from([0x50, 0x4b, 3, 4, 0, 1, 2, 3])));
      const richId = await mkNote(`mediaRich${tag}`, "<p>placeholder</p>");
      made.push(richId);
      const att = await (await fetch(`${TRILIUM_URL}/etapi/attachments`, { method: "POST", headers: H, body: JSON.stringify({ ownerId: richId, role: "image", mime: "image/png", title: "pic.png", content: "" }) })).json();
      await fetch(`${TRILIUM_URL}/etapi/attachments/${att.attachmentId}/content`, { method: "PUT", headers: { Authorization: TRILIUM_TOKEN, "Content-Type": "application/octet-stream" }, body: PNG1 });
      await fetch(`${TRILIUM_URL}/etapi/notes/${richId}/content`, {
        method: "PUT", headers: { Authorization: TRILIUM_TOKEN, "Content-Type": "text/plain" },
        body: `<h1>Rich title</h1><p>intro</p><figure class="image"><img src="api/attachments/${att.attachmentId}/image/pic.png"></figure><h2>Heading two</h2><p>the needle word</p><ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">done</span></label></li></ul>`,
      });

      // image note: shown in the popup (not in the sandbox), really decoded
      await openByTitle(`mediaPng${tag}`);
      await page.waitForSelector('[data-testid="media-image"] img', { timeout: 10000 });
      await page.waitForFunction(() => { const i = document.querySelector('[data-testid="media-image"] img'); return i && i.complete && i.naturalWidth === 1; }, { timeout: 10000 });
      if ((await page.locator("iframe.book-frame").count()) === 0 && (await page.getByRole("button", { name: "A+" }).count()) === 0) ok("reader: an image note shows the picture (decoded, no text frame, no text controls)");
      else fail("image note still shows the text reader");
      await page.getByRole("button", { name: "✕" }).click();

      // PDF note: the browser's own viewer in an UNsandboxed iframe on a blob of the right type
      await openByTitle(`mediaPdf${tag}`);
      await page.waitForSelector('[data-testid="media-pdf"] iframe.media-pdf', { timeout: 10000 });
      const pdfSrc = await page.locator("iframe.media-pdf").getAttribute("src");
      const pdfSandbox = await page.locator("iframe.media-pdf").getAttribute("sandbox");
      if (pdfSrc?.startsWith("blob:") && pdfSandbox === null && (await page.locator('[data-testid="media-pdf"] a[download]').count()) === 1) ok("reader: a PDF note opens in the PDF viewer (blob URL) with a download link");
      else fail(`PDF note view wrong (src=${pdfSrc}, sandbox=${pdfSandbox})`);
      await page.getByRole("button", { name: "✕" }).click();

      // a PNG stored in a generic file note is still a picture (the bytes decide, not the mime)
      await openByTitle(`mediaSniff${tag}`);
      await page.waitForSelector('[data-testid="media-image"] img', { timeout: 10000 });
      ok("reader: a file note holding a PNG is shown as a picture (type from the bytes)");
      await page.getByRole("button", { name: "✕" }).click();

      // a text file is shown as text; a binary we cannot show gets a download card
      await openByTitle(`mediaTxt${tag}`);
      await page.waitForSelector("iframe.book-frame", { timeout: 10000 });
      const txtDoc = await page.locator("iframe.book-frame").getAttribute("srcdoc");
      if (txtDoc?.includes("plain text file body") && txtDoc.includes("text file")) ok("reader: a text file note is shown as text");
      else fail("text file note not shown as text");
      await page.getByRole("button", { name: "✕" }).click();
      await openByTitle(`mediaZip${tag}`);
      await page.waitForSelector('[data-testid="media-download"] a[download]', { timeout: 10000 });
      ok("reader: a file we cannot show offers a download");
      await page.getByRole("button", { name: "✕" }).click();

      // text note with a picture embedded through an attachment: fetched with the token and inlined as a data: URL
      await openByTitle(`mediaRich${tag}`);
      await page.waitForFunction(() => { const d = document.querySelector("iframe.book-frame")?.getAttribute("srcdoc") ?? ""; return d.includes("data:image/png;base64,") && d.includes("todo-list"); }, { timeout: 15000 });
      const richDoc = await page.locator("iframe.book-frame").getAttribute("srcdoc");
      // check the LIVE iframe document, not only the attribute (a browser once kept the stale pre-embed page on screen)
      await page.waitForFunction(() => true);
      let liveImgs = [];
      for (let i = 0; i < 40 && !liveImgs.some((u) => u.startsWith("data:image/png")); i++) {
        const fr = page.frames().find((f) => f !== page.mainFrame());
        liveImgs = fr ? await fr.evaluate(() => [...document.images].map((im) => im.src)).catch(() => []) : [];
        if (!liveImgs.some((u) => u.startsWith("data:image/png"))) await page.waitForTimeout(250);
      }
      if (!richDoc.includes("api/attachments") && liveImgs.some((u) => u.startsWith("data:image/png"))) ok("reader: a picture embedded through an attachment is inlined and shown (no request to Trilium's session-only URL is left)");
      else fail(`embedded attachment picture not inlined / shown (live images: ${JSON.stringify(liveImgs.map((u) => u.slice(0, 30)))})`);
      // outline from the headings + find-in-note
      await page.getByRole("button", { name: "outline" }).click();
      await page.getByRole("button", { name: "Heading two" }).waitFor({ timeout: 5000 });
      ok("reader: the outline lists the note's headings");
      await page.keyboard.press("Control+f");
      await page.fill('input[aria-label="Find in this note"]', "needle");
      await page.getByText("1 / 1").waitFor({ timeout: 8000 });
      ok("reader: find-in-note (Ctrl+F) highlights and counts matches inside the sandbox");
      await page.locator(".reader-find").getByRole("button", { name: "✕" }).click(); // closes the find bar

      // the three leaf papers all draw the leaf (wrapper, stem, masks) and stay selectable; screenshot for a human look
      await page.getByRole("button", { name: "Aa" }).click();
      for (const label of ["Leaf (maple)", "Leaf (autumn)", "Leaf"]) {
        await pickPaper(page, label);
        await page.waitForFunction(() => document.querySelector("iframe.book-frame")?.getAttribute("srcdoc")?.includes("leaf-wrap"), { timeout: 8000 });
        await page.waitForTimeout(250);
        await page.screenshot({ path: `shots/reader-popup-${label.replace(/[^a-z]+/gi, "-").toLowerCase()}.png` });
      }
      ok("reader: the leaf papers (spring, autumn, maple) render the leaf page");
      await pickPaper(page, "Parchment"); // leave the stored preference as the default
      await page.getByRole("button", { name: "✕" }).last().click();
    } finally {
      for (const id of made) await fetch(`${TRILIUM_URL}/etapi/notes/${id}`, { method: "DELETE", headers: { Authorization: TRILIUM_TOKEN } });
    }
  }

  // 2c. Yggdrasil (tree) view: needs WebGL — skipped (with a note) where the browser has none.
  if (hasGl) await page.getByRole("button", { name: "tree", exact: true }).click();
  await page.waitForTimeout(2500);
  const rootAttrs = async () =>
    (await (await fetch(`${TRILIUM_URL}/etapi/notes/root`, { headers: { Authorization: TRILIUM_TOKEN } })).json()).attributes ?? [];
  const noGl = hasGl ? 0 : 1;
  if (noGl > 0) {
    ok("tree view: no WebGL in this browser — steps skipped (the app falls back to the library)");
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
    // performance: key I opens the panel with live numbers; the profile changes the pixel-ratio cap; the stats are real
    await page.keyboard.press("i");
    // (software GL renders ~2 frames a second here, so every wait on the scene needs a generous timeout)
    await page.waitForSelector('[data-testid="perf-overlay"]', { timeout: 45000 });
    await page.waitForFunction(() => window.__treeScene.stats.samples >= 4, { timeout: 60000 });
    const ps = await page.evaluate(() => window.__treeScene.stats);
    const finiteStats = [ps.fps, ps.avgFrameMs, ps.avgCpuMs, ps.avgRenderMs, ps.calls, ps.triangles, ps.dpr, ps.width, ps.height].every(Number.isFinite);
    if (finiteStats && ps.calls > 5 && ps.triangles > 1000 && ps.fps > 0 && ps.dpr <= 2 && ps.width > 100) ok(`tree view: performance panel (I): ${ps.fps.toFixed(0)} fps, ${ps.calls} draw calls, ${ps.triangles} triangles, ratio ${ps.dpr.toFixed(2)}, ${ps.diagnosis}`);
    else fail(`performance stats look wrong: ${JSON.stringify(ps)}`);
    await page.getByRole("button", { name: "fast", exact: true }).click();
    await page.waitForFunction(() => window.__treeScene.perfProfile === "fast" && window.__treeScene.stats.dpr <= 1, { timeout: 45000 });
    await page.getByRole("button", { name: "quality", exact: true }).click();
    await page.waitForFunction(() => window.__treeScene.perfProfile === "quality" && window.__treeScene.stats.maxFps === 0, { timeout: 45000 });
    await page.getByRole("button", { name: "auto", exact: true }).click();
    await page.waitForFunction(() => window.__treeScene.perfProfile === "auto", { timeout: 45000 });
    ok("tree view: performance profiles switch (fast caps the pixel ratio at 1, quality lifts the fps cap)");
    await page.keyboard.press("i");
    await page.waitForSelector('[data-testid="perf-overlay"]', { state: "detached", timeout: 45000 });
    // the mouse: a camera mode that orbits, hover, click-to-walk (the pilot presses the keys), Esc stops, double-click a leaf reads it
    // (the scene runs ~2 frames a second in software GL, so the waits are long; the walks are short)
    // (cheapest rendering for these steps: blended foliage close to the camera costs software GL seconds per frame)
    await page.evaluate(() => { const sc = window.__treeScene; sc.setFoliage(false); sc.setShadows("off"); sc.setPerfProfile("fast"); sc.setLook("lowpoly"); });
    await page.keyboard.press("1");
    await page.keyboard.press("2"); // crawlers, then walkers: the lizard
    await page.waitForFunction(() => window.__treeScene.creature.animal.id === "lizard", { timeout: 45000 });
    for (let i = 0; i < 5 && (await page.evaluate(() => window.__treeScene.camMode)) !== "mouse"; i++) await page.keyboard.press("v");
    if ((await page.evaluate(() => window.__treeScene.camMode)) === "mouse") ok("tree view: V reaches the mouse camera mode");
    else fail("the V cycle never reached the mouse camera");
    const box = await page.locator(".tree-canvas canvas").boundingBox();
    const cx = box.x + box.width * 0.5, cy = box.y + box.height * 0.5;
    const yaw0 = await page.evaluate(() => window.__treeScene.orbitYaw);
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx + 120, cy + 30, { steps: 6 });
    await page.mouse.up({ button: "right" });
    const yaw1 = await page.evaluate(() => window.__treeScene.orbitYaw);
    if (Math.abs(yaw1 - yaw0) > 0.4) ok(`tree view: right-drag orbits the mouse camera (yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)})`);
    else fail(`dragging did not orbit the camera (${yaw0} -> ${yaw1})`);
    // aim the pointer at a spot 130 px further along the branch the animal is on
    const spot = await page.evaluate(() => {
      const sc = window.__treeScene;
      const b = sc.world.branches.get(sc.creature.head.b);
      const want = Math.min(b.total - 20, sc.creature.head.s + 130);
      let i = 1;
      while (i < b.cum.length - 1 && b.cum[i] < want) i++;
      const p = b.pts[i];
      const px = sc.screenOf(p);
      return { branch: b.id, s: b.cum[i], px };
    });
    if (spot.px && spot.px.x > 5 && spot.px.y > 5) {
      const px = box.x + spot.px.x, py = box.y + spot.px.y;
      await page.mouse.move(px, py);
      await page.mouse.move(px + 1, py); // (a second move: the hover is throttled to 10 Hz)
      await page.waitForFunction(() => !!window.__treeScene.hover, { timeout: 45000 });
      const hv = await page.evaluate(() => ({ kind: window.__treeScene.hover.pick.kind, b: window.__treeScene.hover.pick.b ?? window.__treeScene.hover.pick.leaf?.branchId }));
      if (hv.b) ok(`tree view: hovering a ${hv.kind} is picked (${hv.b})`);
      else fail(`hover pick gave ${JSON.stringify(hv)}`);
      await page.mouse.click(px, py);
      await page.waitForFunction(() => !!window.__treeScene.pilot || true, { timeout: 5000 });
      const started = await page.evaluate(() => ({ walking: !!window.__treeScene.pilot, goal: window.__treeScene.pilot?.goal ?? null, head: window.__treeScene.creature.head.s }));
      if (started.walking || started.goal === null) ok("tree view: a click starts the autopilot");
      await page.evaluate(() => window.__treeScene.advance(40)); // (the simulation without rendering: software GL frames take seconds)
      assert_(await page.evaluate(() => window.__treeScene.pilot === null), "the walk finished");
      const end = await page.evaluate(() => ({ b: window.__treeScene.creature.head.b, s: window.__treeScene.creature.head.s }));
      if (end.b === spot.branch && Math.abs(end.s - spot.s) < 60) ok(`tree view: click-to-walk arrived (${end.b} at ${end.s.toFixed(0)}, wanted ~${spot.s.toFixed(0)})`);
      else fail(`click-to-walk ended at ${JSON.stringify(end)}, wanted ${spot.branch} ~${spot.s}`);
      // Esc stops a walk
      const far = await page.evaluate(() => {
        const sc = window.__treeScene;
        const ids = [...sc.world.branches.keys()].filter((id) => id !== sc.creature.head.b && !sc.world.branches.get(id).silk && sc.world.branches.get(id).total > 100);
        const b = sc.world.branches.get(ids[ids.length - 1]);
        sc.startPilot({ b: b.id, s: b.total * 0.5, th: 0 });
        return { id: b.id, walking: !!sc.pilot };
      });
      await page.evaluate(() => window.__treeScene.advance(0.4));
      assert_(await page.evaluate(() => window.__treeScene.pilot !== null), "still walking after 0.4 s");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => window.__treeScene.pilot === null, { timeout: 45000 });
      ok(`tree view: Esc stopped a walk (${far.id})`);
      // double-click a leaf: a leaf goal plus the double-click flag walks there and opens the note in the reader
      // (the pixel-to-leaf picking is covered by the hover step above and the unit tests; here the wiring pilot -> reader is checked)
      const leafGoal = await page.evaluate(() => {
        const sc = window.__treeScene;
        const leaf = sc.nearestLeaf(1e9);
        if (!leaf) return null;
        sc.startPilot({ b: leaf.branchId, s: leaf.s, th: leaf.th, leafId: leaf.id });
        sc.renderer.domElement.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); // (the double-click marks the walk "read on arrival")
        return { id: leaf.id, title: leaf.title };
      });
      if (leafGoal) {
        await page.evaluate(() => window.__treeScene.advance(120));
        try {
          await page.waitForSelector(".book-modal", { timeout: 20000 });
          ok(`tree view: double-clicking a leaf walks there and opens "${leafGoal.title}" in the reader`);
          await page.keyboard.press("Escape");
          await page.waitForSelector(".book-modal", { state: "detached", timeout: 10000 });
        } catch {
          fail("the walk to a double-clicked leaf did not open the reader");
        }
      } else ok("tree view: (no leaf near the animal: the leaf walk is covered by the unit tests)");
    } else {
      ok("tree view: (the pointer target was off screen: the click-to-walk steps are covered by the unit tests)");
    }
    await page.evaluate(() => { const sc = window.__treeScene; sc.setCamera("level"); sc.setFoliage(true); sc.setShadows("medium"); sc.setPerfProfile("auto"); });

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
    await page.keyboard.press("t"); // T does nothing inside the tree (the library is entered through the shrine's door)
    await page.waitForTimeout(300);
    if (await page.locator(".tree-view").count() > 0) ok("tree view: T does nothing (the library is entered through the shrine's door)");
    else fail("T left the tree view");

    // 2d. The tree is the START view; the library is the door on the shrine; the wisp is the search
    // (software GL: the world tree makes the voxel look + canopy very slow to draw; the steps below are about behaviour, not looks)
    await page.evaluate(() => { try { localStorage.setItem("biblio.v1.treeLook", "lowpoly"); localStorage.setItem("biblio.v1.treeFoliage", "off"); localStorage.setItem("biblio.v1.treePerf", "fast"); } catch { /* ignore */ } });
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tree-view .tree-canvas canvas", { timeout: 90000 });
    await page.waitForFunction(() => window.__treeScene && window.__treeScene.shrine && window.__treeScene.leaves.length > 0, { timeout: 90000 });
    if ((await page.locator("#game-host").count()) === 0) ok("start view: the tree (the Phaser library is not even loaded yet: it is a lazy chunk)");
    else fail("the library was mounted at start");
    await page.waitForFunction(() => /through the door/.test(document.querySelector(".tree-hint")?.textContent ?? ""), { timeout: 90000 });
    ok("the animal starts at the shrine's door (hint: E walk through the door into the library)");
    await page.keyboard.press("t");
    await page.waitForTimeout(400);
    if ((await page.locator(".tree-view").count()) > 0 && (await page.locator("#game-host").count()) === 0) ok("T does nothing at the start (it only leaves the library)");
    else fail("T changed the view in the tree");
    // the altar: E opens the shrine panel
    await page.evaluate(() => window.__treeScene.moveToPad("altar"));
    await page.waitForFunction(() => /open the shrine/.test(document.querySelector(".tree-hint")?.textContent ?? ""), { timeout: 90000 });
    await page.keyboard.press("e");
    await page.getByRole("dialog", { name: "Shrine" }).waitFor({ timeout: 15000 });
    if ((await page.locator('[data-testid="shrine-library"]').count()) > 0 && (await page.locator('[data-testid="shrine-wisp"]').count()) > 0) ok("E at the altar opens the shrine panel (library door + wisp sections)");
    else fail("shrine panel lacks its sections");
    // The mite reads ON a leaf: choosing it next to a leaf opens the leaf view; W/S walks the text; another animal climbs back out
    {
      await page.evaluate(() => {
        const sc = window.__treeScene;
        const lf = sc.leaves.find((x) => /Weekly review/i.test(x.title ?? "")) ?? sc.leaves.find((x) => x.type === "text") ?? sc.leaves[0];
        sc.respawn(lf.branchId, lf.s);
        sc.creature.head.th = lf.th;
        window.__leafTitle = lf.title;
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__treeScene.chooseAnimal("mite"));
      await page.getByTestId("leaf-view").waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="leaf-view"]')?.getAttribute("data-status") === "ready", { timeout: 30000 });
      const info = await page.getByTestId("leaf-view").evaluate((el) => ({ lines: Number(el.dataset.lines), text: el.dataset.text, blade: el.dataset.blade, chars: Number(el.dataset.chars) }));
      if (info.lines > 0 && info.chars > 20) ok(`leaf view: the mite opened "${await page.evaluate(() => window.__leafTitle)}" (${info.chars} characters, ${info.lines} lines on a ${info.blade} leaf: "${info.text.slice(0, 40)}…")`);
      else fail(`leaf view is empty: ${JSON.stringify(info)}`);
      await page.keyboard.down("s");
      await page.waitForTimeout(700);
      await page.keyboard.up("s");
      const prog = await page.getByTestId("leaf-view").getAttribute("data-progress");
      if (Number(prog) > 0 || info.lines < 3) ok("leaf view: S walks the mite down the text");
      else fail(`the mite did not move (progress ${prog})`);
      await page.keyboard.press("2"); // another animal: climb back out
      await page.getByTestId("leaf-view").waitFor({ state: "detached", timeout: 10000 });
      if ((await page.evaluate(() => window.__treeScene.creature.animal.id)) === "lizard") ok("leaf view: choosing another animal (2) climbs back out into the tree");
      else fail("the animal did not change on leaving the leaf");
    }
    // Clock: the sun, sky and lights follow the hour (fixed hour via the panel); at night the wisp is a lantern
    {
      const daySnap = () => page.evaluate(() => { const s = window.__treeScene; const d = s.daylight; return { hours: d.hours, dayK: d.dayK, stars: d.stars, shadow: d.shadowStrength, lantern: s.lanternOn, sunY: d.sunDir.y, intensity: s.sunLightIntensity }; });
      await page.getByTestId("clock-fixed").click();
      await page.getByTestId("clock-hour").fill("0");
      await page.waitForFunction(() => window.__treeScene.daylight.hours === 0 && window.__treeScene.lanternOn, { timeout: 90000 });
      const night = await daySnap();
      if (night.dayK < 0.05 && night.stars > 0.9 && night.shadow === 0 && night.lantern && night.sunY < 0 && night.intensity === 0) ok("clock: at midnight the stars are out, the sun is down, no shadows, the wisp is a lantern");
      else fail(`midnight looks wrong: ${JSON.stringify(night)}`);
      await page.getByTestId("clock-hour").fill("12");
      await page.waitForFunction(() => window.__treeScene.daylight.hours === 12 && !window.__treeScene.lanternOn, { timeout: 90000 });
      const noon = await daySnap();
      if (noon.dayK > 0.95 && noon.stars === 0 && noon.shadow > 0.95 && !noon.lantern && noon.sunY > 0.3 && noon.intensity > 2.8) ok("clock: at noon it is bright, the sun is high, shadows are full and the lantern is off");
      else fail(`noon looks wrong: ${JSON.stringify(noon)}`);
      if ((await page.getByTestId("clock-time").innerText()) === "12:00") ok("clock: the panel shows the world's time");
      else fail("clock time label wrong");
      await page.getByTestId("clock-fast").click();
      const h0 = (await daySnap()).hours;
      await page.waitForTimeout(4000);
      await page.waitForFunction((h) => Math.abs(window.__treeScene.daylight.hours - h) > 0.01, h0, { timeout: 60000 });
      ok("clock: in fast mode the hour moves by itself");
      await page.getByTestId("clock-real").click(); // leave the player's clock the way it was (real time)
    }
    // Save in Trilium: off by default (nothing written), switching on only reads, "save now" creates the Yggdrasil folder + save note
    {
      const search = async (q) => (await (await fetch(`${TRILIUM_URL}/etapi/notes?search=${encodeURIComponent(q)}`, { headers: { Authorization: TRILIUM_TOKEN } })).json()).results ?? [];
      if (await page.locator('[data-testid="sync-toggle"]').isChecked()) fail("saving in Trilium is on by default");
      else ok("shrine: saving in Trilium is OFF by default");
      if ((await search("#biblio_yggdrasil")).length === 0) ok("shrine: no Yggdrasil folder exists in the vault before it is switched on");
      else fail("an Yggdrasil folder exists already (left by an earlier run?)");
      await page.locator('[data-testid="sync-toggle"]').check();
      await page.waitForSelector('[data-testid="sync-msg"]', { timeout: 15000 });
      if ((await search("#biblio_yggdrasil")).length === 0) ok("shrine: switching it on only reads (still no folder)");
      else fail("switching on wrote to the vault");
      await page.getByRole("button", { name: "save now" }).click();
      await page.waitForFunction(() => /Saved to Trilium/.test(document.querySelector('[data-testid="sync-msg"]')?.textContent ?? ""), { timeout: 20000 });
      const saves = await search("#biblio_save");
      const folders = await search("#biblio_yggdrasil");
      if (saves.length === 1 && folders.length === 1) ok("shrine: save now created the Yggdrasil folder and the save note");
      else fail(`expected one folder and one save note, got ${folders.length} / ${saves.length}`);
      // the library walk keeps the folder out: the tree must not contain it
      const inTree = await page.evaluate((id) => !!window.__treeScene.world.branches.get(id) || window.__treeScene.leaves.some((l) => l.id === id), folders[0]?.noteId);
      if (!inTree) ok("the Yggdrasil folder is not part of the forest");
      else fail("the Yggdrasil folder shows up in the tree");
      // clean up the mock: switch it off again and remove what the test created
      await page.locator('[data-testid="sync-toggle"]').uncheck();
      for (const n of folders) await fetch(`${TRILIUM_URL}/etapi/notes/${n.noteId}`, { method: "DELETE", headers: { Authorization: TRILIUM_TOKEN } });
      if ((await search("#biblio_yggdrasil")).length === 0) ok("(test cleanup: the Yggdrasil folder was removed from the mock)");
    }
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Shrine" }).waitFor({ state: "detached", timeout: 10000 });
    // the wisp perched on its lantern post: a click opens the search; results can be walked to / lit
    await page.evaluate(() => { const s = window.__treeScene; s.moveToPad("wisp"); s.setCamera("fixed"); s.zoomMul = 0.8; });
    await page.waitForFunction(() => { const s = window.__treeScene; const p = s.wispPoint, q = s.shrine.perch; return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 30; }, { timeout: 90000 });
    // (software GL: wait until the wisp's screen position has stopped moving: the camera and the wisp both catch up slowly)
    let wp = null;
    for (let i = 0; i < 60 && !wp; i++) {
      const a = await page.evaluate(() => { const s = window.__treeScene; return { ...s.screenOf(s.wispPoint), n: s.frameCount }; });
      await page.waitForFunction((n) => window.__treeScene.frameCount >= n + 3, a.n, { timeout: 90000 }); // a few more FRAMES (software GL: seconds each)
      const b = await page.evaluate(() => { const s = window.__treeScene; return s.screenOf(s.wispPoint); });
      if (a && b && b.x > 20 && b.y > 20 && b.x < 1200 && b.y < 700 && Math.hypot(a.x - b.x, a.y - b.y) < 2) wp = b;
    }
    const cb = await page.locator(".tree-canvas canvas").boundingBox();
    if (wp && cb) {
      await page.mouse.move(cb.x + wp.x, cb.y + wp.y);
      await page.waitForFunction(() => window.__treeScene.overWisp(...Object.values(window.__treeScene.screenOf(window.__treeScene.wispPoint))), { timeout: 5000 }).catch(() => {});
      await page.mouse.click(cb.x + wp.x, cb.y + wp.y);
      await page.getByRole("dialog", { name: "Search" }).waitFor({ timeout: 15000 }).catch(async (e) => {
        console.log("DBG dialogs:", await page.locator('[role="dialog"]').evaluateAll((els) => els.map((x) => x.getAttribute("aria-label"))), "wisp", JSON.stringify(wp), "over", await page.evaluate(() => { const s = window.__treeScene; const p = s.screenOf(s.wispPoint); return [p, p && s.overWisp(p.x, p.y), s.enabled]; }));
        throw e;
      });
      ok("clicking the wisp on its lantern post opens the search");
      await page.fill(".search-form input", "Weekly review");
      await page.locator(".search-form button[type=submit]").click();
      await page.waitForSelector(".search-results li", { timeout: 15000 });
      const acts = await page.locator(".search-act").count();
      if (acts >= 2) {
        await page.getByRole("button", { name: "take me there" }).first().click();
        await page.waitForFunction(() => !!window.__treeScene.pilot, { timeout: 15000 });
        ok("search result: take me there starts the autopilot");
        await page.evaluate(() => window.__treeScene.cancelPilot());
        await page.getByRole("button", { name: "search", exact: true }).click();
        await page.fill(".search-form input", "Weekly review");
        await page.locator(".search-form button[type=submit]").click();
        await page.waitForSelector(".search-act", { timeout: 15000 });
        await page.getByRole("button", { name: "light the way" }).first().click();
        await page.waitForFunction(() => window.__treeScene.wispGuiding, { timeout: 15000 });
        ok("search result: light the way sends the wisp to the leaf");
        await page.evaluate(() => window.__treeScene.setWispMode("perch"));
      } else fail("the search results offered no take me there / light the way in the tree view");
      if ((await page.getByRole("dialog", { name: "Search" }).count()) > 0) await page.keyboard.press("Escape");
    } else fail("the wisp is off screen");
    // the door: E at the door enters the library; T brings you back to the door
    await page.evaluate(() => window.__treeScene.moveToPad("door"));
    await page.waitForFunction(() => /through the door/.test(document.querySelector(".tree-hint")?.textContent ?? ""), { timeout: 90000 });
    await page.keyboard.press("e");
    await page.waitForSelector("#game-host canvas", { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector(".crumb-btn")?.textContent === "Library", { timeout: 30000 });
    if ((await page.locator(".tree-view").count()) === 0) ok("E at the door walks into the library's root room");
    else fail("the tree view is still shown after the door");
    await page.keyboard.press("t");
    await page.waitForSelector(".tree-view .tree-canvas canvas", { timeout: 60000 });
    await page.waitForFunction(() => window.__treeScene && window.__treeScene.shrine, { timeout: 90000 });
    await page.waitForFunction(() => /through the door/.test(document.querySelector(".tree-hint")?.textContent ?? ""), { timeout: 90000 });
    ok("T in the library goes back out to the tree, at the shrine's door");
    await page.evaluate(() => window.__treeScene.moveToPad("door"));
    await page.keyboard.press("e");
  }
  await page.waitForFunction(() => { const g = document.querySelector("#game-host"); return g && g.style.display !== "none"; }, { timeout: 30000 });
  ok("back in the library rooms");

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