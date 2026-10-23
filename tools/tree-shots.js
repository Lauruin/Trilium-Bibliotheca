/**
 * tools/tree-shots.js — headless WebGL screenshots of the 3D tree (the demo page lizard3d.html).
 * Needs a dev server on APP_URL (default http://localhost:5173) and the full chrome (see AGENTS.md,
 * "WebGL in the dev container"). Writes shots/tree-*.png. Usage: node tools/tree-shots.js [scenario...]
 * Scenarios: looks, level, ground (the floating demo log), leaves, squirrel, snake, vault (?vault: a synthetic
 * vault through the real layout — overview, horizon, leaf kinds), kinds (leaf kinds x sizes), animals, daylight (the clock at dawn / noon / dusk / night), shrine (?vault&shrine: the stump's
 * door, altar and the wisp's lantern post; the wisp perched and following)   (default: all)
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const url = (process.env.APP_URL ?? "http://localhost:5173") + "/lizard3d.html";
const want = new Set(process.argv.slice(2));
const run = (n) => want.size === 0 || want.has(n);
const libRoot = `${process.cwd()}/.playwright-libs/root`;
const env = { ...process.env, LD_LIBRARY_PATH: [`${libRoot}/usr/lib/x86_64-linux-gnu`, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") };
delete env.WAYLAND_DISPLAY;
delete env.DISPLAY;
const chrome = execSync("ls -d .playwright-browsers/chromium-*/chrome-linux64/chrome | head -1").toString().trim();
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--headless=new", "--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"], env });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 760) } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__treeScene);
const S = (f, ...a) => page.evaluate(([f, a]) => { const s = window.__treeScene; return new Function("s", "a", f)(s, a); }, [f, a]);
const shot = async (name) => { await page.screenshot({ path: `shots/tree-${name}.png`, timeout: 120000 }); console.log("shot", name); };
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
await page.waitForTimeout(1500);

if (run("looks")) {
  for (const look of ["voxel", "lowpoly"]) {
    await S("s.setLook(a[0]); s.setCamera('chase'); s.zoomMul = 1.5", look);
    await hold("w", 900);
    await page.waitForTimeout(800);
    await shot(`look-${look}`);
  }
}
if (run("level")) {
  await S("s.setLook('lowpoly'); s.setCamera('level'); s.zoomMul = 1.8");
  await hold("w", 500);
  await page.waitForTimeout(900);
  await shot("level");
}
if (run("ground")) {
  await S("s.setLook('lowpoly'); s.setCamera('level'); s.zoomMul = 6");
  await page.waitForTimeout(1500);
  await shot("ground-far");
  await S("s.setLook('voxel')");
  await page.waitForTimeout(1200);
  await shot("ground-far-voxel");
}
if (run("leaves")) {
  for (const look of ["voxel", "lowpoly"]) {
    await S("s.setLook(a[0]); s.setCamera('fixed'); s.zoomMul = 0.45; s.respawn('trunk', 160)", look);
    await hold("w", 700);
    await page.waitForTimeout(900);
    await shot(`leaves-${look}`);
  }
}
if (run("squirrel")) {
  await S("s.setLook('lowpoly'); s.setCamera('level'); s.zoomMul = 1.6; s.respawn('trunk', 500)");
  await page.keyboard.press("4");
  await page.waitForTimeout(400);
  await page.keyboard.press(" ");
  await page.keyboard.down("w");
  await page.waitForTimeout(500);
  await page.keyboard.up("w");
  await page.waitForTimeout(250);
  await shot("squirrel-glide");
}
if (run("snake")) {
  await S("s.setLook('lowpoly'); s.setCamera('chase'); s.zoomMul = 1.8; s.respawn('trunk', 980)");
  // category 1 = ant, spider, jumping spider, snake: press "1" until the snake is the animal (4 presses from a lizard / flier)
  for (let guard = 0; guard < 8 && (await S("return s.creature.animal.id")) !== "snake"; guard++) await page.keyboard.press("2");
  await page.waitForTimeout(500);
  await page.keyboard.down(" ");
  await page.keyboard.down("a");
  await page.waitForTimeout(900);
  await page.keyboard.up("a");
  await page.waitForTimeout(600);
  await shot("snake-reach");
  await page.keyboard.up(" ");
}
if (run("vault")) {
  await page.goto(url + "?vault");
  await page.waitForFunction(() => window.__treeScene);
  await page.waitForTimeout(1200);
  await S("s.setLook('voxel'); s.setCamera('level'); s.zoomMul = 7; s.respawn('root', 300); s.setLabels('signs')");
  await page.waitForTimeout(1800);
  await shot("vault-overview-signs");
  await S("s.setLabels('bubbles')");
  await page.waitForTimeout(1500);
  await shot("vault-overview-bubbles");
  await S("s.setLabels('signs'); s.setLook('lowpoly')");
  await page.waitForTimeout(1500);
  await shot("vault-overview-lowpoly");
  await S("s.setLook('lowpoly'); s.setCamera('level'); s.zoomMul = 1.5; s.respawn('root', 560)");
  await page.waitForTimeout(1500);
  await shot("vault-level-lowpoly");
  for (const look of ["lowpoly", "voxel"]) {
    await S("s.setLook(a[0]); s.setCamera('fixed'); s.zoomMul = 0.5; s.respawn('root', 700)", look);
    await page.waitForTimeout(1500);
    await shot(`vault-leaves-${look}`);
  }
}
if (run("shrine")) {
  // the shrine at the stump's foot (the app's start place): the door, the altar, the lantern post with the wisp, in both looks and from afar
  await page.goto(url + "?vault&shrine&trees=5&depth=1");
  await page.waitForFunction(() => window.__treeScene);
  await page.waitForTimeout(1200);
  for (const look of ["lowpoly", "voxel"]) {
    await S("s.setLook(a[0]); s.setFoliage(false); s.setCamera('level'); s.zoomMul = 0.55; s.moveToPad('door')", look);
    await page.waitForTimeout(2500);
    await shot(`shrine-door-${look}`);
  }
  await S("s.setLook('lowpoly'); s.moveToPad('altar')");
  await page.waitForTimeout(2200);
  await shot("shrine-altar");
  await S("s.moveToPad('wisp'); s.zoomMul = 0.7");
  await page.waitForTimeout(2200);
  await shot("shrine-wisp");
  await S("s.setCamera('fixed'); s.zoomMul = 3.2; s.moveToPad('door'); s.setFoliage(true)");
  await page.waitForTimeout(2200);
  await shot("shrine-overview");
}
if (run("daylight")) {
  // the world tree's foot at different hours (fixed clock): dawn, noon, dusk, night
  await page.goto(url + "?vault&shrine&trees=5&depth=1&places=3");
  await page.waitForFunction(() => window.__treeScene);
  await page.waitForTimeout(1200);
  await S("s.setLook('lowpoly'); s.setFoliage(true); s.setLabels('off'); s.setCamera('level'); s.zoomMul = 1.6; s.moveToPad('door')");
  for (const [name, hour] of [["dawn", 5.9], ["noon", 12.5], ["dusk", 19.2], ["night", 23.5]]) {
    await S("s.setClock({ mode: 'fixed', hour: a[0], fastMinutes: 6, night: 0.5 })", hour);
    await page.waitForTimeout(3500);
    await shot(`daylight-${name}`);
  }
  await S("s.setCamera('fixed'); s.zoomMul = 9");
  for (const [name, hour] of [["noon", 12.5], ["night", 23.5]]) {
    await S("s.setClock({ mode: 'fixed', hour: a[0], fastMinutes: 6, night: 0.5 })", hour);
    await page.waitForTimeout(3500);
    await shot(`daylight-far-${name}`);
  }
  await S("s.setClock({ mode: 'real', hour: 12, fastMinutes: 6, night: 0.5 })");
}
if (run("kinds")) {
  // the demo twig, both looks: the five leaf kinds and sizes side by side
  await page.goto(url);
  await page.waitForFunction(() => window.__treeScene);
  await page.waitForTimeout(1200);
  // 5 kinds × 3 sizes along the demo twig (replaces the demo leaves)
  const SIGN = process.env.SIGN ?? '1';
  await S(`const process_sign = ${SIGN}; const kinds = ['broad','needle','maple','blossom','fruit'], types = ['text','code','markdown','canvas','image'];
    const leaves = []; let i = 0;
    for (const sz of [0.6, 1.2, 2]) kinds.forEach((k, ki) => { leaves.push({ id: 'k' + (i++), branchId: 'twigA', s: 60 + (leaves.length) * 62, th: (process_sign) * 0.9, color: ['#4f9a3c','#c2a838','#b8602e','#d86aa0','#c8402e'][ki], title: k + ' ' + sz, kind: k, size: sz, type: types[ki] }); });
    s.setWorld(s.world, leaves, 'twigA', 120);`);
  for (const look of ["lowpoly", "voxel"]) {
    await S("s.setLook(a[0]); s.setCamera('fixed'); s.zoomMul = 1.0; s.respawn('twigA', 560)", look);
    await page.waitForTimeout(1800);
    await shot(`kinds-${look}`);
  }
}
if (run("animals")) {
  // every animal (ten), perched, close up (level camera, low-poly + voxel); fliers in the air too
  await page.goto(url);
  await page.waitForFunction(() => window.__treeScene);
  await page.waitForTimeout(1000);
  const order = [["1", 1, "ant"], ["2", 1, "beetle"], ["2", 2, "spider"], ["2", 3, "jumper"], ["2", 4, "snake"], ["2", 5, "constrictor"], ["3", 1, "lizard"], ["3", 2, "cat"], ["4", 1, "squirrel"], ["4", 2, "bee"], ["4", 3, "dragonfly"], ["4", 4, "bluejay"], ["4", 5, "eagle"]];
  for (const look of ["voxel", "lowpoly"]) {
    await S("s.setLook(a[0]); s.setCamera('level'); s.zoomMul = 1.0", look);
    for (const [key, , id] of order) {
      await S("s.respawn('trunk', 700)");
      let guard = 0;
      while ((await S("return s.creature.animal.id")) !== id && guard++ < 6) await page.keyboard.press(key);
      await page.waitForTimeout(900);
      await shot(`animal-${look}-${id}`);
      if (["bee", "dragonfly", "bluejay"].includes(id)) {
        await page.keyboard.press(" ");
        await page.keyboard.down(" ");
        await page.keyboard.down("w");
        await page.waitForTimeout(700);
        await page.keyboard.up("w");
        await page.keyboard.up(" ");
        await shot(`animal-${look}-${id}-flying`);
      }
    }
  }
}
console.log("console errors/warnings:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
