/**
 * tree/scenery.ts — the world around the tree(s): sky dome + sun + clouds, ground, horizon.
 *
 *   voxel   — tiled block ground, cube rocks/bushes/clouds, stepped mountains (unchanged look)
 *   lowpoly — a faceted rolling terrain (flat under the forest, hills beyond), colour patches, forest floor and a dirt patch round the stump,
 *             grass tufts, flowers, mushrooms at the trunk bases, rocks + pebbles, lumpy bushes, far pines + round trees, a pond,
 *             hills, snow-capped mountains and low-poly clouds that drift.
 *
 * Everything is deterministic (hash/noise of positions), instanced where counts are large, and never reads the simulation.
 * Pure three.js builders: no input, no loop, no app state.
 */

import * as THREE from "three";
import { hash, hsl, instanced, shade, Soup, SKY, sstep, SUN_DIR, vnoise, VOX, type Item } from "./lpkit";
import { radiusAt, type World } from "./world3";
import type { Look } from "./look";

// ---- sky ----------------------------------------------------------------------------------------

/** Sky dome (zenith -> horizon gradient with a warm glow round the sun) + the sun sprite. Follows the camera; clouds are part of the environment. */
export function buildSky(): { dome: THREE.Mesh; sun: THREE.Sprite } {
  const R = 26000;
  const geo = new THREE.SphereGeometry(R, 32, 18);
  const pos = geo.getAttribute("position");
  const colors: number[] = [];
  const top = new THREE.Color(SKY.zenith);
  const hor = new THREE.Color(SKY.horizon);
  const glow = new THREE.Color(1, 0.86, 0.62);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / R, y = pos.getY(i) / R, z = pos.getZ(i) / R;
    const t = Math.min(1, Math.max(0, y / 0.65));
    c.copy(hor).lerp(top, Math.pow(t, 0.7));
    // below the horizon the sky keeps the horizon colour (the ground hides it, the fog melts into it)
    const sunDot = Math.max(0, x * SUN_DIR.x + y * SUN_DIR.y + z * SUN_DIR.z);
    c.lerp(glow, Math.pow(sunDot, 9) * 0.42 + Math.pow(sunDot, 60) * 0.35);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  dome.renderOrder = -2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const cx = cv.getContext("2d")!;
  const gr = cx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, "rgba(255,250,225,1)");
  gr.addColorStop(0.25, "rgba(255,240,190,0.65)");
  gr.addColorStop(1, "rgba(255,230,170,0)");
  cx.fillStyle = gr;
  cx.fillRect(0, 0, 128, 128);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  sun.scale.set(5200, 5200, 1);
  sun.renderOrder = -1;
  return { dome, sun };
}

/** A soft dark rim round the picture (a DOM overlay: free, no extra render pass). Shown in the low-poly look only. */
export function createVignette(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "tree-vignette";
  d.style.cssText = "position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 46%, rgba(10,14,30,0) 58%, rgba(10,14,30,0.30) 100%);transition:opacity .3s";
  return d;
}

/** Name of the cloud group inside the environment group (the scene keeps it centred on the camera and turns it slowly). */
export const CLOUDS = "clouds";

/** Flat-bottomed clouds: a few squashed puffs each (icosahedra in the low-poly look, cubes in the voxel one), lifted by emissive so undersides stay light. */
function buildClouds(look: Look, groundY: number): THREE.Group {
  const g = new THREE.Group();
  g.name = CLOUDS;
  const voxel = look === "voxel";
  const puffs: Item[] = [];
  const COUNT = 34;
  for (let i = 0; i < COUNT; i++) {
    const a = i * 2.399 + hash(i * 1.9) * 0.8;
    const d = 2600 + hash(i * 5.3 + 2) * 9400;
    const alt = groundY + 3800 + hash(i * 3.1) * 3600 + d * 0.12;
    const w = 520 + hash(i * 7.7) * 900;
    const n = 4 + Math.floor(hash(i * 2.2) * 4);
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5;
      const s = w * (0.32 + 0.26 * (1 - Math.abs(u) * 1.6) + hash(i * 9 + k) * 0.12);
      const lx = u * w * 1.15, lz = (hash(i * 4.4 + k * 7) - 0.5) * w * 0.35;
      const ca = Math.cos(a), sa = Math.sin(a);
      puffs.push({
        p: new THREE.Vector3(Math.cos(a) * d + lx * -sa + lz * ca, alt + (hash(i + k * 3) - 0.3) * w * 0.1 + (1 - Math.abs(u) * 1.7) * w * 0.07, Math.sin(a) * d + lx * ca + lz * sa),
        s: new THREE.Vector3(s, s * (voxel ? 0.34 : 0.5), s * 0.85),
        rotY: hash(i * 3 + k) * 3,
        color: new THREE.Color(1, 1, 1).multiplyScalar(0.94 + hash(i + k * 11) * 0.08),
      });
    }
  }
  const geo = voxel ? new THREE.BoxGeometry(1, 1, 1) : new THREE.IcosahedronGeometry(0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: !voxel, emissive: 0x6d7f9c, emissiveIntensity: 0.55 });
  const m = instanced(geo, puffs, mat);
  if (m) {
    m.frustumCulled = false;
    g.add(m);
  }
  return g;
}

// ---- footprints: where the trunks / roots meet the ground (the terrain stays flat there, nothing is scattered on them) ----

export interface Footprint {
  x: number;
  z: number;
  r: number;
}

/** Ground contact points of the world: every branch point within reach of the ground (roots, trunk bases, the stump), thinned to a 70 px grid. */
export function footprintsOf(world: World, groundY: number): Footprint[] {
  const cell = new Map<string, Footprint>();
  for (const b of world.branches.values()) {
    if (b.silk) continue;
    for (let i = 0; i < b.pts.length; i++) {
      const p = b.pts[i];
      const r = radiusAt(b, b.cum[i] ?? 0);
      if (p.y - r > groundY + 260) continue;
      const key = `${Math.round(p.x / 70)},${Math.round(p.z / 70)}`;
      const old = cell.get(key);
      if (!old || old.r < r) cell.set(key, { x: p.x, z: p.z, r });
    }
  }
  return [...cell.values()];
}

/** Centre and radius of the ground footprints (0 when there are none): sizes the scattered scenery and places the pond. */
export function forestExtent(feet: readonly Footprint[]): { cx: number; cz: number; Rw: number } {
  if (feet.length === 0) return { cx: 0, cz: 0, Rw: 0 };
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  for (const f of feet) { mnx = Math.min(mnx, f.x); mxx = Math.max(mxx, f.x); mnz = Math.min(mnz, f.z); mxz = Math.max(mxz, f.z); }
  const cx = (mnx + mxx) / 2, cz = (mnz + mxz) / 2;
  return { cx, cz, Rw: Math.hypot(mxx - mnx, mxz - mnz) / 2 + 200 };
}

/**
 * Cache key of an environment: everything `buildEnvironment` reads (look, ground height, the footprints and the stump). Editing a high branch
 * leaves it unchanged, so the scene can keep the old environment instead of rebuilding ~5k instances on every slider tick.
 */
export function environmentKey(look: Look, groundY: number, world?: World): string {
  if (look === "voxel" || !world) return `${look}|${groundY}`;
  const feet = footprintsOf(world, groundY);
  let sum = 0;
  for (const f of feet) sum = (sum * 31 + Math.round(f.x) * 7 + Math.round(f.z) * 13 + Math.round(f.r * 4)) % 1000003;
  const stump = [...world.branches.values()].find((b) => b.parent === null && !b.silk);
  return `${look}|${groundY}|${feet.length}|${sum}|${stump ? `${Math.round(stump.pts[0].x)},${Math.round(stump.pts[0].z)}` : ""}`;
}

/** Spatial lookup over footprints. */
export class Foot {
  private grid = new Map<string, Footprint[]>();
  private static CELL = 160;

  constructor(readonly pts: readonly Footprint[]) {
    for (const f of pts) {
      const key = `${Math.floor(f.x / Foot.CELL)},${Math.floor(f.z / Foot.CELL)}`;
      const l = this.grid.get(key);
      if (l) l.push(f);
      else this.grid.set(key, [f]);
    }
  }

  /** Distance from (x, z) to the nearest trunk / root edge, capped at `cap` (0 = on a footprint). */
  dist(x: number, z: number, cap: number): number {
    if (this.pts.length === 0) return cap;
    const C = Foot.CELL;
    const n = Math.ceil(cap / C);
    const cx = Math.floor(x / C), cz = Math.floor(z / C);
    let best = cap;
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const l = this.grid.get(`${cx + i},${cz + j}`);
        if (!l) continue;
        for (const f of l) best = Math.min(best, Math.max(0, Math.hypot(f.x - x, f.z - z) - f.r));
      }
    }
    return best;
  }
}

// ---- the environment ------------------------------------------------------------------------------

/** Ground + horizon of a look. `world` (optional) lets the low-poly scenery keep the ground flat under the forest and put the flowers / mushrooms where they belong. */
export function buildEnvironment(look: Look, groundY: number, world?: World): THREE.Group {
  const g = new THREE.Group();
  if (look === "voxel") voxelEnvironment(g, groundY);
  else lowpolyEnvironment(g, groundY, world);
  g.add(buildClouds(look, groundY));
  return g;
}

const GRASS = hsl(0.27, 0.42, 0.3);

/** The block world: tiled blocks, cube rocks / bushes / pines, stepped mountains. */
function voxelEnvironment(g: THREE.Group, groundY: number): void {
  // far ground (beyond the detailed patch), always flat; sits below the patch
  const far = new THREE.Mesh(new THREE.CircleGeometry(40000, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: GRASS.clone().multiplyScalar(0.92) }));
  far.position.y = groundY - 2.5 * VOX;
  g.add(far);

  const TILE = 100, R = 3000, H = 70;
  const n = Math.ceil(R / TILE);
  const items: Item[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = i * TILE, z = j * TILE;
      const d = Math.hypot(x, z);
      if (d > R) continue;
      const h = hash(i * 12.9898 + j * 78.233);
      const drop = h < 0.3 ? VOX : h > 0.88 ? 2 * VOX : 0;
      const dirt = d < 190 + hash(i + j * 3.7) * 90;
      const c = dirt
        ? hsl(0.08, 0.34, 0.2 + hash(i * 3.1 + j) * 0.06)
        : GRASS.clone().offsetHSL((hash(i * 5.7 + j * 2.3) - 0.5) * 0.03, 0, (h - 0.5) * 0.1);
      items.push({ p: new THREE.Vector3(x, groundY - drop - H / 2, z), s: new THREE.Vector3(TILE, H, TILE), color: c });
    }
  }
  const tiles = instanced(new THREE.BoxGeometry(1, 1, 1), items);
  if (tiles) {
    tiles.receiveShadow = true;
    g.add(tiles);
  }

  // rocks and bushes scattered around the trunk
  const rockC = new THREE.Color(0x7d7f86);
  const rocks: Item[] = [];
  const bushes: Item[] = [];
  for (let i = 0; i < 90; i++) {
    const a = hash(i * 1.7) * Math.PI * 2;
    const d = 320 + hash(i * 3.3) * 2900;
    const sz = 14 + hash(i * 5.1) * 46;
    rocks.push({ p: new THREE.Vector3(Math.cos(a) * d, groundY + sz * 0.25, Math.sin(a) * d), s: new THREE.Vector3(sz * 1.2, sz * 0.7, sz), rotY: hash(i * 9.9) * 3, color: shade(rockC, 0.8 + hash(i * 2.1) * 0.4) });
  }
  for (let i = 0; i < 160; i++) {
    const a = hash(i * 2.9 + 40) * Math.PI * 2;
    const d = 280 + hash(i * 4.7 + 3) * 3200;
    const sz = 18 + hash(i * 6.3) * 30;
    bushes.push({ p: new THREE.Vector3(Math.cos(a) * d, groundY + sz * 0.4, Math.sin(a) * d), s: new THREE.Vector3(sz, sz * 0.8, sz), rotY: hash(i * 7.3) * 3, color: hsl(0.3 + hash(i) * 0.06, 0.5, 0.2 + hash(i * 1.3) * 0.1) });
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const m of [instanced(box, rocks), instanced(box, bushes)]) if (m) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  // far pines: little trees that make the Tree look as big as it is
  const trunks: Item[] = [];
  const crowns: Item[] = [];
  for (let i = 0; i < 40; i++) {
    const a = hash(i * 8.1 + 11) * Math.PI * 2;
    const d = 1500 + hash(i * 2.2 + 5) * 4200;
    const h = 260 + hash(i * 6.9) * 360;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    trunks.push({ p: new THREE.Vector3(x, groundY + h * 0.15, z), s: new THREE.Vector3(h * 0.07, h * 0.3, h * 0.07), color: new THREE.Color(0x4d3a26) });
    for (let k = 0; k < 3; k++) {
      const w = h * (0.34 - k * 0.07);
      crowns.push({ p: new THREE.Vector3(x, groundY + h * (0.36 + k * 0.24), z), s: new THREE.Vector3(w, h * 0.34, w), rotY: hash(i + k), color: hsl(0.36, 0.4, 0.16 + hash(i * 3 + k) * 0.06) });
    }
  }
  for (const m of [instanced(box, trunks), instanced(new THREE.ConeGeometry(0.5, 1, 4), crowns)]) if (m) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  // mountains on the horizon (faded by the fog): stepped pyramids
  const peaks: Item[] = [];
  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + hash(i * 3.7) * 0.15;
    const d = 11000 + hash(i * 5.3) * 1200;
    const hgt = 900 + hash(i * 1.9) * 1700;
    const wid = 1500 + hash(i * 7.9) * 1700;
    const c = new THREE.Color(0x5e7390).multiplyScalar(0.85 + hash(i * 4.4) * 0.3);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const L = 7;
    for (let l = 0; l < L; l++) {
      const w = wid * (1 - l / L);
      peaks.push({ p: new THREE.Vector3(x, groundY + (l + 0.5) * (hgt / L), z), s: new THREE.Vector3(w, hgt / L, w), rotY: a, color: l === L - 1 ? new THREE.Color(0xe8eef4) : shade(c, 1 - l * 0.02) });
    }
  }
  const pm = instanced(box, peaks);
  if (pm) g.add(pm);
}

// ---- low-poly world -------------------------------------------------------------------------------

const TERRAIN_STEP = 150;
const TERRAIN_R = 6400;
/** How far below `groundY` the far ground plane lies (the terrain never dips below -50 except at its rim, which meets the plane). */
const RIM_DROP = 60;

/** Small reusable shapes (vertex-coloured, so one instanced mesh per kind; instance colour tints them). */
function tuftGeometry(): THREE.BufferGeometry {
  const s = new Soup();
  const dark = new THREE.Color(0.62, 0.62, 0.62), light = new THREE.Color(1.12, 1.12, 1.12);
  const blades = 5;
  for (let q = 0; q < blades; q++) {
    const a = (q / blades) * Math.PI * 2 + 0.4;
    const ca = Math.cos(a), sa = Math.sin(a);
    const h = 11 + (q % 3) * 4.5;
    const base = new THREE.Vector3(ca * 1.8, 0, sa * 1.8);
    const w = new THREE.Vector3(-sa * 1.9, 0, ca * 1.9);
    s.tri(base.clone().sub(w), base.clone().add(w), new THREE.Vector3(ca * 6.5, h, sa * 6.5), dark, dark, light);
  }
  return s.geometry();
}
function flowerGeometries(): { stem: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const stem = new Soup();
  const g0 = new THREE.Color(0.5, 0.75, 0.4), g1 = new THREE.Color(0.8, 1, 0.6);
  const h = 15;
  stem.tri(new THREE.Vector3(-0.9, 0, 0), new THREE.Vector3(0.9, 0, 0), new THREE.Vector3(0, h, 0), g0, g0, g1);
  stem.tri(new THREE.Vector3(0, 0, -0.9), new THREE.Vector3(0, 0, 0.9), new THREE.Vector3(0, h, 0), g0, g0, g1);
  const head = new THREE.OctahedronGeometry(4.3, 0).scale(1, 0.55, 1).translate(0, h + 1, 0);
  return { stem: stem.geometry(), head };
}
function mushroomGeometry(): THREE.BufferGeometry {
  const s = new Soup();
  const stemC = new THREE.Color(0.9, 0.84, 0.7), capC = new THREE.Color(0.78, 0.16, 0.12), capTop = new THREE.Color(0.95, 0.3, 0.2), under = new THREE.Color(0.8, 0.72, 0.58);
  const ring = (y: number, r: number, n: number, off = 0): THREE.Vector3[] => Array.from({ length: n }, (_, i) => new THREE.Vector3(Math.cos((i / n) * Math.PI * 2 + off) * r, y, Math.sin((i / n) * Math.PI * 2 + off) * r));
  const a = ring(0, 1.7, 5), b = ring(6, 1.4, 5);
  for (let i = 0; i < 5; i++) s.quad(a[i], a[(i + 1) % 5], b[(i + 1) % 5], b[i], stemC);
  const rim = ring(5.6, 5.4, 7), mid = ring(8.2, 3.6, 7, 0.2), top = new THREE.Vector3(0, 9.6, 0);
  const centre = new THREE.Vector3(0, 5.6, 0);
  for (let i = 0; i < 7; i++) {
    const j = (i + 1) % 7;
    s.quad(rim[i], rim[j], mid[j], mid[i], capC);
    s.tri(mid[i], mid[j], top, capC, capC, capTop);
    s.tri(rim[j], rim[i], centre, under);
  }
  return s.geometry();
}

/** Footprint-aware faceted ground + everything that grows or lies on it. */
function lowpolyEnvironment(g: THREE.Group, groundY: number, world?: World): void {
  const foot = new Foot(world ? footprintsOf(world, groundY) : []);
  // extent of the forest + the stump (the world's root branch starts at the middle of everything)
  const { cx, cz, Rw } = forestExtent(foot.pts);
  const stump = world ? [...world.branches.values()].find((b) => b.parent === null && !b.silk) : undefined;
  const sx = stump ? stump.pts[0].x : 0, sz = stump ? stump.pts[0].z : 0;
  // a pond beyond the forest
  const pa = hash(77.7) * Math.PI * 2;
  const pd = Math.min(5200, Rw + 1500);
  const pond = { x: cx + Math.cos(pa) * pd, z: cz + Math.sin(pa) * pd, r: 360 + hash(78.1) * 140 };

  const rawHeight = (x: number, z: number): number => {
    const edge = sstep(TERRAIN_R, TERRAIN_R * 0.86, Math.hypot(x, z));
    const mask = sstep(150, 950, foot.dist(x, z, 950));
    const hills = (vnoise(x / 1300, z / 1300, 1) - 0.5) * 110 + (vnoise(x / 380, z / 380, 2) - 0.5) * 30 + (vnoise(x / 120, z / 120, 3) - 0.5) * 7;
    const micro = (vnoise(x / 90, z / 90, 4) - 0.5) * 3.2;
    const pr = Math.hypot(x - pond.x, z - pond.z) / pond.r;
    return (hills * mask + micro - 24 * sstep(1.2, 0.25, pr)) * edge - RIM_DROP * (1 - edge); // the rim sinks to the far ground's level: no lip
  };
  // height grid: the terrain is a triangle mesh over it, so everything that sits on the ground reads the SAME surface
  const n = Math.ceil(TERRAIN_R / TERRAIN_STEP);
  const W = 2 * n + 1;
  const hgrid = new Float32Array(W * W);
  for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) hgrid[i * W + j] = rawHeight((i - n) * TERRAIN_STEP, (j - n) * TERRAIN_STEP);
  const hAt = (i: number, j: number): number => hgrid[(i + n) * W + (j + n)];
  const flipOf = (i: number, j: number): boolean => hash(i * 3.3 + j * 9.1) > 0.5;
  /** Exact height of the terrain surface at (x, z) (the plane of the triangle it lies in). */
  const surfaceH = (x: number, z: number): number => {
    const fi = x / TERRAIN_STEP, fj = z / TERRAIN_STEP;
    const i = Math.max(-n, Math.min(n - 1, Math.floor(fi))), j = Math.max(-n, Math.min(n - 1, Math.floor(fj)));
    const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j));
    const h00 = hAt(i, j), h10 = hAt(i + 1, j), h11 = hAt(i + 1, j + 1), h01 = hAt(i, j + 1);
    // flip: diagonal (i,j)-(i+1,j+1); else (i+1,j)-(i,j+1)
    if (flipOf(i, j)) return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  };

  // colour of the ground at a point: patches of lush / olive / deep / dry grass, forest floor under the trees, the dirt patch round the stump, a pond shore
  const PAL = [hsl(0.27, 0.46, 0.31), hsl(0.21, 0.42, 0.32), hsl(0.34, 0.4, 0.25), hsl(0.18, 0.34, 0.33)];
  const FAR_GROUND = PAL[0].clone().lerp(PAL[1], 0.4).multiplyScalar(0.92);
  const LITTER = hsl(0.09, 0.3, 0.2), DIRT = hsl(0.08, 0.32, 0.22), SAND = hsl(0.12, 0.34, 0.46), MUD = hsl(0.1, 0.25, 0.17);
  const groundColor = (x: number, z: number, k: number): THREE.Color => {
    const c = PAL[0].clone();
    c.lerp(PAL[1], sstep(0.35, 0.65, vnoise(x / 900, z / 900, 5)));
    c.lerp(PAL[2], sstep(0.55, 0.8, vnoise(x / 300, z / 300, 6)));
    c.lerp(PAL[3], sstep(0.68, 0.9, vnoise(x / 700, z / 700, 7)) * 0.8);
    c.offsetHSL((hash(x * 0.37 + z * 0.91 + k) - 0.5) * 0.03, 0, (hash(x * 1.3 + z * 0.17 + k * 3) - 0.5) * 0.1);
    const f = 1 - sstep(10, 120, foot.dist(x, z, 120));
    if (f > 0) c.lerp(LITTER, f * 0.6);
    const ds = Math.hypot(x - sx, z - sz);
    if (ds < 250 + vnoise(x / 70, z / 70, 8) * 90) c.lerp(DIRT, 0.9);
    const pr = Math.hypot(x - pond.x, z - pond.z) / pond.r;
    if (pr < 1.5) c.lerp(pr < 0.85 ? MUD : SAND, sstep(1.5, 1.05, pr) * (pr < 0.85 ? 1 : 0.8));
    c.lerp(FAR_GROUND, sstep(TERRAIN_R * 0.74, TERRAIN_R, Math.hypot(x, z))); // melts into the far ground plane: no visible rim from above
    return c;
  };

  // far ground (beyond the terrain patch), flat, under the patch's edge
  const far = new THREE.Mesh(new THREE.CircleGeometry(40000, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: FAR_GROUND }));
  far.position.set(0, groundY - RIM_DROP - 2, 0);
  g.add(far);

  // terrain
  const soup = new Soup();
  const V = (i: number, j: number): THREE.Vector3 => new THREE.Vector3(i * TERRAIN_STEP, groundY + hAt(i, j), j * TERRAIN_STEP);
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      if (Math.hypot((i + 0.5) * TERRAIN_STEP, (j + 0.5) * TERRAIN_STEP) > TERRAIN_R) continue;
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, k: number): void => {
        soup.tri(p, q, r, groundColor((p.x + q.x + r.x) / 3, (p.z + q.z + r.z) / 3, k));
      };
      if (flipOf(i, j)) {
        tri(a, b, c, 1);
        tri(a, c, d, 2);
      } else {
        tri(a, b, d, 3);
        tri(b, c, d, 4);
      }
    }
  }
  const terrain = soup.mesh();
  terrain.receiveShadow = true;
  g.add(terrain);

  // pond: a flat, slightly bluish disc just below the ground level
  const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r * 1.12, 14).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4a93b8, emissive: 0x16384c, flatShading: true }));
  water.position.set(pond.x, groundY - 9, pond.z);
  water.receiveShadow = true;
  g.add(water);

  // ---- things that grow on it ------------------------------------------------------------------
  const RS = Math.max(2800, Rw + 1500);
  const inPond = (x: number, z: number, m = 1.25): boolean => Math.hypot(x - pond.x, z - pond.z) < pond.r * m;
  const place = (n0: number, seed: number, clearance: (i: number) => number, accept?: (x: number, z: number, i: number) => boolean, rMin = 0): Array<{ x: number; z: number; y: number; i: number }> => {
    const out: Array<{ x: number; z: number; y: number; i: number }> = [];
    for (let t = 0; t < n0 * 2.2 && out.length < n0; t++) {
      const a = hash(t * 1.37 + seed) * Math.PI * 2;
      const d = rMin + Math.sqrt(hash(t * 2.71 + seed * 3)) * (RS - rMin);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (inPond(x, z)) continue;
      if (foot.dist(x, z, 400) < clearance(t)) continue;
      if (accept && !accept(x, z, t)) continue;
      out.push({ x, z, y: groundY + surfaceH(x, z), i: t });
    }
    return out;
  };
  const tint = (c: THREE.Color, h: number, l: number): THREE.Color => c.clone().offsetHSL(h, 0, l);
  const vcol = (): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const add = (m: THREE.InstancedMesh | null, cast = false): void => {
    if (!m) return;
    m.castShadow = cast;
    m.receiveShadow = true;
    g.add(m);
  };

  // grass tufts
  const tuftN = Math.round(Math.min(6500, Math.max(2600, (Math.PI * RS * RS) / 26000)));
  add(instanced(tuftGeometry(), place(tuftN, 3.1, () => 14, (x, z) => foot.dist(x, z, 90) > 8 && Math.hypot(x - sx, z - sz) > 200).map((p) => ({
    p: new THREE.Vector3(p.x, p.y, p.z), rotY: hash(p.i * 5.1) * 6.28, s: new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + hash(p.i * 7.7) * 0.9),
    color: tint(groundColor(p.x, p.z, 9), 0, 0.05 + hash(p.i * 3.3) * 0.06).multiplyScalar(1.15),
  })), vcol()));

  // flowers in patches
  const FL = [hsl(0.0, 0, 0.95), hsl(0.14, 0.9, 0.58), hsl(0.92, 0.7, 0.68), hsl(0.76, 0.55, 0.62), hsl(0.06, 0.85, 0.58), hsl(0.58, 0.7, 0.66)];
  const flowers = place(560, 5.5, () => 20, (x, z) => vnoise(x / 260, z / 260, 11) > 0.6 && foot.dist(x, z, 90) > 18);
  const fg = flowerGeometries();
  const fItems = flowers.map((p) => ({ p: new THREE.Vector3(p.x, p.y, p.z), rotY: hash(p.i * 2.3) * 6.28, s: new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + hash(p.i * 6.1) * 0.7), color: FL[Math.floor(vnoise(p.x / 260, p.z / 260, 12) * 5.99) % FL.length].clone() }));
  add(instanced(fg.head, fItems, new THREE.MeshLambertMaterial({ flatShading: true })));
  add(instanced(fg.stem, fItems.map((f) => ({ ...f, color: new THREE.Color(1, 1, 1) })), vcol()));

  // mushrooms round the trunk bases + here and there
  const ms: Item[] = [];
  const big = foot.pts.filter((f) => f.r >= 11);
  big.slice(0, 40).forEach((f, q) => {
    const cnt = 2 + Math.floor(hash(q * 3.3) * 3);
    for (let k = 0; k < cnt; k++) {
      const a = hash(q * 7.1 + k * 2.9) * Math.PI * 2, d = f.r + 6 + hash(q * 1.7 + k) * 26;
      const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
      if (foot.dist(x, z, 20) < 4) continue;
      ms.push({ p: new THREE.Vector3(x, groundY + surfaceH(x, z), z), rotY: hash(q * k + 1) * 6, s: new THREE.Vector3(1, 1, 1).multiplyScalar(0.9 + hash(q * 5.5 + k) * 1.1), color: new THREE.Color(1, 1, 1) });
    }
  });
  place(30, 8.8, () => 30).forEach((p) => ms.push({ p: new THREE.Vector3(p.x, p.y, p.z), rotY: hash(p.i) * 6, s: new THREE.Vector3(1, 1, 1).multiplyScalar(1 + hash(p.i * 4.4)), color: new THREE.Color(1, 1, 1) }));
  add(instanced(mushroomGeometry(), ms, vcol()), true);

  // rocks, pebbles
  const rockC = new THREE.Color(0x7d7f86);
  const rocks = place(110, 12.2, (t) => 30 + hash(t * 9) * 30).map((p) => {
    const sz = 14 + hash(p.i * 5.1) * 46;
    return { p: new THREE.Vector3(p.x, p.y + sz * 0.16, p.z), s: new THREE.Vector3(sz * (1 + hash(p.i) * 0.4), sz * (0.55 + hash(p.i * 2) * 0.3), sz), rotY: hash(p.i * 9.9) * 6, tilt: [hash(p.i * 3.1) * 0.35 - 0.17, hash(p.i * 4.1) * 0.35 - 0.17] as [number, number], color: shade(rockC, 0.75 + hash(p.i * 2.1) * 0.45).offsetHSL((hash(p.i * 8) - 0.5) * 0.04, 0, 0) };
  });
  add(instanced(new THREE.IcosahedronGeometry(0.62, 0), rocks), true);
  const pebbles = place(520, 14.4, () => 12).map((p) => {
    const sz = 3 + hash(p.i * 5.7) * 7;
    return { p: new THREE.Vector3(p.x, p.y + sz * 0.1, p.z), s: new THREE.Vector3(sz * 1.2, sz * 0.7, sz), rotY: hash(p.i * 2.2) * 6, color: shade(rockC, 0.8 + hash(p.i * 3.3) * 0.4) };
  });
  add(instanced(new THREE.IcosahedronGeometry(0.62, 0), pebbles));

  // bushes: three lumpy blobs each
  const bushItems: Item[] = [];
  place(150, 17.1, (t) => 40 + hash(t * 4) * 40).forEach((p) => {
    const base = hsl(0.28 + hash(p.i) * 0.07, 0.5, 0.2 + hash(p.i * 1.3) * 0.1);
    const sz = 22 + hash(p.i * 6.3) * 34;
    for (let k = 0; k < 3; k++) {
      const a = hash(p.i * 3 + k) * 6.28, d = k === 0 ? 0 : sz * 0.4;
      const s = sz * (k === 0 ? 1 : 0.62 + hash(p.i + k) * 0.2);
      bushItems.push({ p: new THREE.Vector3(p.x + Math.cos(a) * d, p.y + s * 0.34, p.z + Math.sin(a) * d), s: new THREE.Vector3(s, s * 0.78, s), rotY: hash(p.i + k * 5) * 6, color: tint(base, (hash(p.i * k + 2) - 0.5) * 0.02, (hash(p.i + k * 3) - 0.5) * 0.06) });
    }
  });
  add(instanced(new THREE.IcosahedronGeometry(0.62, 0), bushItems), true);

  // far pines + round trees: little trees that make the Tree look as big as it is
  const trunks: Item[] = [];
  const crowns: Item[] = [];
  const blobs: Item[] = [];
  place(70, 21.3, () => 120, undefined, Math.max(900, Rw * 0.8)).forEach((p, q) => {
    const h = 260 + hash(q * 6.9) * 360;
    const round = hash(q * 1.1 + 4) < 0.35;
    trunks.push({ p: new THREE.Vector3(p.x, p.y + h * 0.15, p.z), s: new THREE.Vector3(h * 0.07, h * 0.3, h * 0.07), color: new THREE.Color(0x4d3a26) });
    if (round) {
      const hue = hash(q * 2.3) < 0.3 ? 0.14 + hash(q) * 0.04 : 0.26 + hash(q * 3.1) * 0.06;
      blobs.push({ p: new THREE.Vector3(p.x, p.y + h * 0.48, p.z), s: new THREE.Vector3(h * 0.42, h * 0.38, h * 0.42), rotY: hash(q) * 3, color: hsl(hue, 0.5, 0.26 + hash(q * 4.4) * 0.1) });
    } else {
      for (let k = 0; k < 3; k++) {
        const w = h * (0.34 - k * 0.07);
        crowns.push({ p: new THREE.Vector3(p.x, p.y + h * (0.36 + k * 0.24), p.z), s: new THREE.Vector3(w, h * 0.34, w), rotY: hash(q + k), color: hsl(0.36, 0.4, 0.16 + hash(q * 3 + k) * 0.06) });
      }
    }
  });
  add(instanced(new THREE.BoxGeometry(1, 1, 1), trunks), true);
  add(instanced(new THREE.ConeGeometry(0.5, 1, 7), crowns), true);
  add(instanced(new THREE.IcosahedronGeometry(0.62, 0), blobs), true);

  // rolling hills + mountains on the horizon (the fog fades them)
  const hills: Item[] = [];
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + hash(i * 4.9) * 0.2;
    const d = 6900 + hash(i * 6.1) * 4200;
    const w = 1500 + hash(i * 3.7) * 2200, h = 160 + hash(i * 8.3) * 260;
    hills.push({ p: new THREE.Vector3(cx + Math.cos(a) * d, groundY + h * 0.08, cz + Math.sin(a) * d), s: new THREE.Vector3(w, h, w * (0.7 + hash(i) * 0.5)), rotY: hash(i * 2.1) * 3, color: hsl(0.28 + hash(i * 1.7) * 0.06, 0.32, 0.3 + hash(i * 2.9) * 0.08) });
  }
  add(instanced(new THREE.IcosahedronGeometry(0.5, 1), hills));
  const peaks: Item[] = [];
  const caps: Item[] = [];
  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + hash(i * 3.7) * 0.15;
    const d = 11000 + hash(i * 5.3) * 1200;
    const hgt = 900 + hash(i * 1.9) * 1700;
    const wid = 1500 + hash(i * 7.9) * 1700;
    const c = new THREE.Color(0x5e7390).multiplyScalar(0.85 + hash(i * 4.4) * 0.3);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, ry = hash(i) * 3;
    peaks.push({ p: new THREE.Vector3(x, groundY + hgt / 2, z), s: new THREE.Vector3(wid, hgt, wid), rotY: ry, color: c });
    if (hgt > 1500) caps.push({ p: new THREE.Vector3(x, groundY + hgt * 0.8, z), s: new THREE.Vector3(wid * 0.4, hgt * 0.4, wid * 0.4), rotY: ry, color: new THREE.Color(0xe8eef6) });
  }
  const pm = instanced(new THREE.ConeGeometry(0.5, 1, 6), peaks);
  if (pm) g.add(pm);
  const cm = instanced(new THREE.ConeGeometry(0.5, 1, 6), caps);
  if (cm) g.add(cm);
}
