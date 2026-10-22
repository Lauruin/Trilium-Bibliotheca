/**
 * tree/look.ts — the two LOOKS of the Yggdrasil view and the world around the tree.
 *
 *   voxel   — everything is made of cubes on a grid (VOX), instanced; chunky and cheap.
 *   lowpoly — smooth-ish shapes made of few flat-shaded triangles, vertex-coloured.
 *
 * Both looks are built from the same data (branches, leaves, animals' specs), so
 * switching is only a rebuild of the meshes — the simulation never notices.
 * Also here: the sky dome, the ground and the horizon (mountains, rocks, far pines),
 * which exist so you can always tell what is up and how high you are.
 * Pure three.js builders: no input, no loop, no app state.
 */

import * as THREE from "three";
import { clamp01, hash, instanced, pnoise, shade, Soup, srgb, sstep, SUN_DIR, T3, VOX, type Item } from "./lpkit";
import { LEAF_ACCENT, LEAF_SHAPES } from "./leafkind";
import { SPECIES, type SpeciesKey } from "./species";
import type { Leaf } from "./layout";
import { frameAt, isTerminal, normalAt, radiusAt, surfacePoint, type Branch, type World } from "./world3";

export type Look = "voxel" | "lowpoly";
export const LOOKS: readonly Look[] = ["voxel", "lowpoly"];

interface Vox {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

/** Shell voxels of one branch, snapped to the global voxel grid (deduplicated), bark-coloured with mossy tops; a branch end gets a tapering cap (a point on a twig). */
export function branchVoxels(b: Branch): Vox[] {
  const out = new Map<string, Vox>();
  const bark = barkOf(b);
  const rings = Math.ceil(b.total / (VOX * 0.7));
  const ringAt = (f: ReturnType<typeof frameAt>, R: number, i: number): void => {
    const around = Math.max(12, Math.ceil((Math.PI * 2 * Math.max(R, b.r * 0.2)) / (VOX * 0.7)));
    for (let k = 0; k < around; k++) {
      const th = (k / around) * Math.PI * 2;
      const n = normalAt(f, th);
      // first shell centre half a voxel inside the true surface, so the blocks' outer faces sit ON it (small creatures walk on top, not inside)
      for (const rr of [R - VOX * 0.55, R - VOX * 1.2, R - VOX * 1.9, R - VOX * 2.6]) {
        const gx = Math.round((f.p.x + n.x * rr) / VOX);
        const gy = Math.round((f.p.y + n.y * rr) / VOX);
        const gz = Math.round((f.p.z + n.z * rr) / VOX);
        const key = `${gx},${gy},${gz}`;
        if (out.has(key)) continue;
        const h = hash(gx * 13.1 + gy * 7.7 + gz * 3.3);
        const [r, g, bl] = barkColor(bark, h, hash(k * 1.91 + b.r), hash(gx * 5.3 + gy * 1.7 + gz * 9.1), hash(gx * 3.7 + gz * 5.1 + Math.floor(i / 6)), n.y, n.y < -0.4);
        out.set(key, { x: gx * VOX, y: gy * VOX, z: gz * VOX, r, g, b: bl });
      }
    }
  };
  for (let i = 0; i <= rings; i++) ringAt(frameAt(b, (i / rings) * b.total), radiusAt(b, (i / rings) * b.total), i);
  if (b.next.length === 0 && !b.silk) {
    // closed end: rings continue past the last point along its tangent while the radius shrinks to nothing (one cube at the very tip)
    const f = frameAt(b, b.total);
    const Re = radiusAt(b, b.total);
    const cap = Math.max(VOX * 1.6, Re * (Re < 6 ? 2.6 : 0.9));
    const steps = Math.ceil(cap / (VOX * 0.6));
    for (let j = 1; j <= steps; j++) {
      const d = (j / steps) * cap;
      const fp = { ...f, p: { x: f.p.x + f.t.x * d, y: f.p.y + f.t.y * d, z: f.p.z + f.t.z * d } };
      ringAt(fp, Re * Math.max(0, 1 - j / steps) * 0.9, rings + j);
    }
  }
  return [...out.values()];
}

type Bark = (typeof SPECIES)["maple"]["bark"];
const DEFAULT_BARK: Bark = { base: [0.47, 0.33, 0.21], variation: 0.14, moss: 0.5, streak: 0.7 };
const barkOf = (b: Branch): Bark => SPECIES[b.species as SpeciesKey]?.bark ?? DEFAULT_BARK;

/** Bark colour (sRGB 0..1) of one block/face of a species: base × variation, furrow streaks, scars, moss on top, dark underside. */
function barkColor(bark: Bark, h: number, streakRoll: number, markRoll: number, mossRoll: number, topness: number, under: boolean): [number, number, number] {
  const v = 1 + (h - 0.5) * bark.variation * 1.6;
  let [r, g, bl] = bark.base.map((c) => c * v) as [number, number, number];
  if (streakRoll < bark.streak * 0.4) { r *= 0.74; g *= 0.74; bl *= 0.74; }
  if (bark.mark && markRoll < bark.mark.chance) [r, g, bl] = bark.mark.rgb;
  if (topness > 0.62 && mossRoll < bark.moss) { r = 0.27 + h * 0.08; g = 0.42 + h * 0.1; bl = 0.18 + h * 0.05; }
  else if (under) { r *= 0.65; g *= 0.65; bl *= 0.65; }
  return [r, g, bl];
}

/** Facets around a branch: thin twigs stay hexagonal-ish, trunks get rounder. */
const sidesFor = (r: number): number => (r < 5 ? 6 : r < 24 ? 8 : r < 48 ? 10 : 12);

/** Local bark colour of one facet (sRGB 0..1): species base, lengthwise furrows, scars, moss PATCHES on the upper side. */
function facetColor(bark: Bark, b: Branch, i: number, k: number, sides: number, tri: number, topness: number, ny: number): [number, number, number] {
  const seed = b.r * 3.7 + b.total * 0.013;
  const h = hash(i * 3.1 + k * 5.3 + tri * 1.7 + seed);
  // furrows run along the branch: smooth in i, a new random value per facet column
  const fur = pnoise(i * 0.3, k, sides, seed);
  const tone = pnoise(i * 0.12 + 40, k * 0.5, sides, seed + 9);
  const v = 1 + (tone - 0.5) * bark.variation * 2.2 + (h - 0.5) * bark.variation * 0.5;
  let [r, g, bl] = bark.base.map((c) => c * v) as [number, number, number];
  if (fur < bark.streak * 0.42) { r *= 0.76; g *= 0.76; bl *= 0.76; }
  // moss: patches (low-frequency noise), only where the surface faces up (in the branch frame and in the world)
  const up = Math.max(topness, ny * 0.9);
  const patch = pnoise(i * 0.16 + 7, k * 0.6, sides, seed + 3) * 0.75 + hash(i * 2.3 + k * 4.1 + seed) * 0.25;
  if (up > 0.5 && patch < bark.moss * 0.85) {
    const m = 0.5 + 0.5 * sstep(0.5, 0.9, up);
    r += (0.27 + h * 0.08 - r) * m; g += (0.42 + h * 0.1 - g) * m; bl += (0.18 + h * 0.05 - bl) * m;
  }
  return [r, g, bl];
}

const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();

/**
 * Low-poly branch: an N-sided tube (N follows the radius) with
 *   - per-VERTEX ambient occlusion baked into the vertex colours: dark undersides, dark near the ground (trunk bases, roots), dark in the
 *     crotch where a side branch leaves and at the foot of every side branch;
 *   - a small collar flare where a side branch leaves its parent (rounded forks);
 *   - bark facets (furrows, scars, moss patches, a few knots);
 *   - a closed end: a sharp cone on a twig tip (terminal branches taper to ~1.2 px), a short dome on a thick end (stump top).
 */
function lowpolyBranch(world: World, b: Branch, groundY: number): THREE.Mesh {
  const soup = new Soup();
  const sides = sidesFor(b.r);
  const rings = Math.max(2, Math.ceil(b.total / Math.max(26, b.r * 0.9)));
  const bk = barkOf(b);
  const bark: Bark = b.root ? { ...bk, moss: Math.min(1, bk.moss * 1.6 + 0.2) } : bk; // roots lie in the damp
  const flare = b.attachS !== undefined && !b.silk ? 0.2 : 0;
  const kids = b.side.flatMap((id) => {
    const k = world.branches.get(id);
    return k && !k.silk && k.attachS !== undefined ? [{ s: k.attachS, r: k.r, dir: T3(frameAt(k, 0).t) }] : [];
  });
  const frames: Array<ReturnType<typeof frameAt>> = [];
  const P: THREE.Vector3[][] = [];
  const N: THREE.Vector3[][] = [];
  const AO: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const s = (i / rings) * b.total;
    const f = frameAt(b, s);
    frames.push(f);
    const R0 = radiusAt(b, s);
    const R = R0 * (1 + flare * Math.exp(-Math.pow(s / (b.r * 1.5 + 6), 2)));
    const row: THREE.Vector3[] = [], nrow: THREE.Vector3[] = [], arow: number[] = [];
    for (let k = 0; k < sides; k++) {
      const n = normalAt(f, (k / sides) * Math.PI * 2);
      const rr = R * (1.03 + (hash(i * 7.3 + k * 1.7 + b.r) - 0.5) * 0.06);
      const p = new THREE.Vector3(f.p.x + n.x * rr, f.p.y + n.y * rr, f.p.z + n.z * rr);
      row.push(p);
      nrow.push(T3(n));
      // ambient occlusion
      let ao = 1 - 0.2 * Math.max(0, -n.y);
      const below = clamp01(0.5 - 0.5 * n.y);
      ao *= 1 - 0.5 * (1 - sstep(0, 200, p.y - groundY)) * (0.3 + 0.7 * below);
      if (b.attachS !== undefined) ao *= 0.58 + 0.42 * sstep(0, b.r * 1.9 + 14, s); // the foot of a side branch sits in shade
      for (const kid of kids) {
        const w = 1 - sstep(0, kid.r * 2.4 + 12, Math.abs(s - kid.s));
        if (w > 0) ao *= 1 - 0.36 * w * clamp01(n.x * kid.dir.x + n.y * kid.dir.y + n.z * kid.dir.z + 0.15);
      }
      arow.push(ao);
    }
    P.push(row);
    N.push(nrow);
    AO.push(arow);
  }
  const out = new THREE.Vector3();
  const face = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, ri: number, ra: number[], k: number, tri: number): void => {
    const f = frames[ri];
    out.copy(a).add(bb).add(c).multiplyScalar(1 / 3).sub(T3(f.p)).normalize();
    const topness = out.x * f.u.x + out.y * f.u.y + out.z * f.u.z;
    const [r, g, bl] = facetColor(bark, b, ri, k, sides, tri, topness, out.y);
    _c1.copy(srgb(r, g, bl));
    soup.tri(a, bb, c, _c1.clone().multiplyScalar(ra[0]), _c1.clone().multiplyScalar(ra[1]), _c1.clone().multiplyScalar(ra[2]));
  };
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      const a = P[i][k], bb = P[i][k1], c = P[i + 1][k1], d = P[i + 1][k];
      const ao = AO[i], ao2 = AO[i + 1];
      if ((i + k) % 2 === 0) {
        face(a, bb, c, i, [ao[k], ao[k1], ao2[k1]], k, 0);
        face(a, c, d, i, [ao[k], ao2[k1], ao2[k]], k, 1);
      } else {
        face(a, bb, d, i, [ao[k], ao[k1], ao2[k]], k, 0);
        face(bb, c, d, i, [ao[k1], ao2[k1], ao2[k]], k, 1);
      }
      // scars / lenticels (birch's dark dashes, cherry's pale ones): a thin diamond lying on the facet
      if (bark.mark && b.r >= 5 && hash(i * 1.3 + k * 6.1 + b.r * 0.7) < Math.min(0.55, bark.mark.chance * 1.7)) {
        const e = bb.clone().sub(a).multiplyScalar(0.5), up = d.clone().add(c).sub(a).sub(bb).multiplyScalar(0.5);
        const q = a.clone().add(bb).multiplyScalar(0.5).addScaledVector(up, 0.3 + 0.4 * hash(i * 5.9 + k * 1.1));
        const lift = N[i][k].clone().add(N[i][k1]).normalize().multiplyScalar(Math.min(0.8, 0.25 + b.r * 0.02));
        const E = e.clone().multiplyScalar(0.85), Lg = up.clone().multiplyScalar(0.05);
        const mc = srgb(bark.mark.rgb[0], bark.mark.rgb[1], bark.mark.rgb[2]).multiplyScalar(0.5 * (ao[k] + ao[k1]));
        const l0 = q.clone().sub(E).add(lift), l1 = q.clone().add(Lg).add(lift), l2 = q.clone().add(E).add(lift), l3 = q.clone().sub(Lg).add(lift);
        soup.tri(l0, l1, l2, mc);
        soup.tri(l0, l2, l3, mc);
      }
      // a knot now and then on a sturdy branch: a small dark pyramid on the facet
      if (b.r >= 9 && hash(i * 12.7 + k * 3.3 + b.r * 0.9) < 0.016 && i > 0) {
        const cen = a.clone().add(bb).add(c).add(d).multiplyScalar(0.25);
        const nn = N[i][k].clone().add(N[i][k1]).normalize();
        const kr = Math.min(b.r, radiusAt(b, (i / rings) * b.total)) * 0.2;
        const tip = cen.clone().addScaledVector(nn, kr * 0.7);
        const t = T3(frames[i].t), sd = new THREE.Vector3().crossVectors(nn, t).normalize();
        const ring = [0, 1, 2, 3, 4].map((q) => cen.clone().addScaledVector(t, Math.cos((q / 5) * Math.PI * 2) * kr).addScaledVector(sd, Math.sin((q / 5) * Math.PI * 2) * kr));
        const kc = srgb(bark.base[0] * 0.4, bark.base[1] * 0.38, bark.base[2] * 0.36).multiplyScalar(ao[k]);
        for (let q = 0; q < 5; q++) soup.tri(ring[q], ring[(q + 1) % 5], tip, kc);
      }
    }
  }
  // the end cap
  if (b.next.length === 0 && !b.silk) {
    const f = frames[rings];
    const Re = radiusAt(b, b.total);
    const pointed = isTerminal(world, b) || Re < 5;
    const len = pointed ? Math.max(3, Re * 3.2) : Re * 0.7;
    const tip = T3(f.p).addScaledVector(T3(f.t), len);
    const last = P[rings];
    const aoL = AO[rings];
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      out.copy(last[k]).add(last[k1]).add(tip).multiplyScalar(1 / 3).sub(T3(f.p)).normalize();
      const [r, g, bl] = facetColor(bark, b, rings, k, sides, 2, out.x * f.u.x + out.y * f.u.y + out.z * f.u.z, out.y);
      _c2.copy(srgb(r, g, bl));
      _c3.copy(_c2).multiplyScalar(pointed ? 0.9 : 1.05);
      soup.tri(last[k], last[k1], tip, _c2.clone().multiplyScalar(aoL[k]), _c2.clone().multiplyScalar(aoL[k1]), _c3.clone().multiplyScalar(0.5 * (aoL[k] + aoL[k1])));
    }
  }
  return soup.mesh();
}

/** Every branch of the world as meshes of the given look. */
export function buildBark(world: World, look: Look, groundY = world.groundY ?? 0): THREE.Group {
  const g = new THREE.Group();
  if (look === "lowpoly") {
    for (const b of world.branches.values()) if (!b.silk) g.add(lowpolyBranch(world, b, groundY));
    return g;
  }
  const box = new THREE.BoxGeometry(VOX, VOX, VOX);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const proxyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const b of world.branches.values()) {
    if (b.silk) continue;
    const vox = branchVoxels(b);
    const mesh = new THREE.InstancedMesh(box, mat, vox.length);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    vox.forEach((v, i) => {
      m4.makeTranslation(v.x, v.y, v.z);
      mesh.setMatrixAt(i, m4);
      col.copy(srgb(v.r, v.g, v.b));
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.noCast = true; // the cubes only receive: a thin tube on the shadow-only layer casts instead (a fraction of the triangles)
    g.add(mesh);
    g.add(shadowProxy(b, proxyMat));
  }
  return g;
}

/** Layer the shadow-only proxies live on: the main camera (layer 0) never draws them, the sun's shadow camera does (`SunShadows`). */
export const SHADOW_LAYER = 1;

/**
 * A thin 6-sided tube along a voxel branch that exists only to cast its shadow: ~60-150 triangles instead of the thousands of cubes
 * (the voxel look redrew every cube into the shadow map: 1.7M triangles for 88 branches). It is a little thinner than the cube shell, so the
 * cubes are never shadowed by their own proxy.
 */
export function shadowProxy(b: Branch, mat: THREE.Material): THREE.Mesh {
  const sides = 6;
  const rings = Math.max(2, Math.ceil(b.total / 45));
  const P: THREE.Vector3[][] = [];
  for (let i = 0; i <= rings; i++) {
    const s = (i / rings) * b.total;
    const f = frameAt(b, s);
    const R = Math.max(2.6, radiusAt(b, s) * 0.72 - 1.5);
    const row: THREE.Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const n = normalAt(f, (k / sides) * Math.PI * 2);
      row.push(new THREE.Vector3(f.p.x + n.x * R, f.p.y + n.y * R, f.p.z + n.z * R));
    }
    P.push(row);
  }
  const pos: number[] = [];
  const push = (...v: THREE.Vector3[]): void => v.forEach((p) => pos.push(p.x, p.y, p.z));
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      push(P[i][k], P[i][k1], P[i + 1][k1], P[i][k], P[i + 1][k1], P[i + 1][k]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(geo, mat);
  m.layers.set(SHADOW_LAYER);
  m.userData.shadowOnly = true;
  return m;
}

// ---- leaves ------------------------------------------------------------------------------------

/** Where a leaf sits: stalk out of the bark, then a blade (width along the branch) drooping away from the top. */
export interface LeafFrame {
  p: THREE.Vector3;
  out: THREE.Vector3;
  side: THREE.Vector3;
  /** Blade direction (from the stalk tip). */
  L: THREE.Vector3;
  /** Blade normal. */
  N: THREE.Vector3;
  tip: THREE.Vector3;
  stalk: number;
  len: number;
  halfW: number;
}

export function leafFrame(world: World, leaf: Leaf): LeafFrame | null {
  const b = world.branches.get(leaf.branchId);
  if (!b) return null;
  const sp = surfacePoint(b, leaf.s, leaf.th, 0);
  const f = sp.f;
  const out = T3(sp.n);
  const side = T3(f.t);
  const around = T3(f.u).multiplyScalar(-Math.sin(leaf.th)).addScaledVector(T3(f.b), Math.cos(leaf.th));
  const sgn = leaf.th < 0 ? -1 : 1;
  const size = Number.isFinite(leaf.size) && leaf.size > 0 ? leaf.size : 1;
  const stalk = VOX * (1.6 + 0.9 * size);
  const len = 44 * size;
  const L = out.clone().multiplyScalar(0.8).addScaledVector(around, 0.55 * sgn).normalize();
  const N0 = new THREE.Vector3().crossVectors(side, L).normalize();
  // roll the blade about its own axis (±40°) so some face the viewer and none are all edge-on
  const roll = (hash(leaf.s * 0.37 + leaf.th * 5.1) - 0.5) * 1.4;
  const w = side.clone().multiplyScalar(Math.cos(roll)).addScaledVector(N0, Math.sin(roll));
  const N = N0.clone().multiplyScalar(Math.cos(roll)).addScaledVector(side, -Math.sin(roll));
  const p = T3(sp.p);
  return { p, out, side: w, L, N, tip: p.clone().addScaledVector(out, stalk), stalk, len, halfW: len * 0.38 };
}

const STALK = new THREE.Color(0x5a4a2a);

function inPoly(u: number, v: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/** Wind clock (seconds) for the leaf sway; the scene writes it every frame. */
export const WIND = { value: 0 };

function lowpolyLeaves(world: World, leaves: Leaf[]): THREE.Mesh | null {
  const soup = new Soup();
  const base = new THREE.Color();
  const tint = new THREE.Color();
  for (const leaf of leaves) {
    const fr = leafFrame(world, leaf);
    if (!fr) continue;
    base.set(0x5f9a4a).set(leaf.color); // unknown CSS names leave the colour unchanged → the default, not the previous leaf's
    // every leaf is a little different: hue, saturation and lightness drift around the note's colour
    const r1 = hash(leaf.s * 0.77 + leaf.th * 3.1 + fr.p.y * 0.013), r2 = hash(leaf.s * 1.91 + leaf.th * 7.3 + fr.p.x * 0.011), r3 = hash(leaf.s * 0.31 + fr.p.z * 0.017 + leaf.th);
    tint.copy(base).offsetHSL((r1 - 0.5) * 0.03, (r2 - 0.5) * 0.14, (r3 - 0.5) * 0.09);
    // stalk: a thin 3-sided spike from the bark to the blade
    const w = VOX * 0.3;
    const sa = fr.p.clone().addScaledVector(fr.side, -w);
    const sb = fr.p.clone().addScaledVector(fr.side, w);
    const sc = fr.p.clone().addScaledVector(fr.N, w);
    const stalk = (c: THREE.Color): [THREE.Color, THREE.Color, THREE.Color] => [c, c, shade(c, 1.25)];
    for (const [p, q, k] of [[sa, sb, 1], [sb, sc, 0.85], [sc, sa, 1.1]] as const) {
      const [c0, c1, c2] = stalk(shade(STALK, k));
      soup.tri(p, q, fr.tip, c0, c1, c2, [0, 0, 0.18]);
    }
    const P = (u: number, v: number, fold: number): THREE.Vector3 =>
      fr.tip.clone().addScaledVector(fr.side, u * fr.halfW).addScaledVector(fr.L, v * fr.len).addScaledVector(fr.N, fold * fr.len);
    if (leaf.kind === "fruit") {
      // a faceted berry (octahedron-ish) hanging at the stalk tip
      const R = fr.len * 0.34;
      const c = fr.tip.clone().addScaledVector(fr.L, R * 0.9);
      const ax = [fr.side, fr.L, fr.N];
      const verts: THREE.Vector3[] = [];
      for (const a of ax) for (const s of [1, -1]) verts.push(c.clone().addScaledVector(a, s * R));
      const faces: Array<[number, number, number]> = [
        [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5],
      ];
      faces.forEach((f, i) => {
        const col = shade(tint, 0.82 + hash(leaf.s * 0.7 + i * 3.1) * 0.36);
        soup.tri(verts[f[0]], verts[f[1]], verts[f[2]], col, col, col, [0.3, 0.3, 0.3]);
      });
      continue;
    }
    // blade: a fan from the middle, darker at the stalk and lighter at the tip, facets alternate a little
    LEAF_SHAPES[leaf.kind].forEach((poly, pi) => {
      let cu = 0, cv = 0;
      for (const [u, v] of poly) { cu += u; cv += v; }
      cu /= poly.length;
      cv /= poly.length;
      const fold = leaf.kind === "broad" || leaf.kind === "maple" ? 0.16 : 0.06;
      const centre = P(cu, cv, fold);
      const grade = (v: number): number => 0.72 + 0.5 * clamp01(v);
      const sway = (v: number): number => 0.12 + 0.88 * Math.pow(clamp01(v), 1.2);
      for (let i = 0; i < poly.length; i++) {
        const [u0, v0] = poly[i];
        const [u1, v1] = poly[(i + 1) % poly.length];
        const f0 = fold * Math.max(0, 1 - Math.abs(u0));
        const f1 = fold * Math.max(0, 1 - Math.abs(u1));
        const k = (i % 2 ? 0.93 : 1.05) * (0.94 + hash(leaf.s * 0.31 + pi * 7.7 + i * 2.9) * 0.12);
        soup.tri(centre, P(u0, v0, f0), P(u1, v1, f1), shade(tint, k * grade(cv)), shade(tint, k * grade(v0)), shade(tint, k * grade(v1)), [sway(cv), sway(v0), sway(v1)]);
      }
    });
    const accent = LEAF_ACCENT[leaf.kind];
    if (accent) {
      const ac = new THREE.Color(accent);
      const c = P(0, 0.5, 0.1);
      const r = 0.16;
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * Math.PI * 2, a1 = ((i + 1) / 5) * Math.PI * 2;
        const col = shade(ac, 0.9 + (i % 2) * 0.15);
        soup.tri(c.clone().addScaledVector(fr.N, fr.len * 0.07), P(Math.cos(a0) * r, 0.5 + Math.sin(a0) * r * 0.9, 0.1), P(Math.cos(a1) * r, 0.5 + Math.sin(a1) * r * 0.9, 0.1), col, col, col, [0.5, 0.5, 0.5]);
      }
    }
  }
  return soup.empty ? null : soup.mesh(WIND);
}

function voxelLeaves(world: World, leaves: Leaf[]): THREE.InstancedMesh | null {
  const cells = new Map<string, { p: THREE.Vector3; c: THREE.Color }>();
  const put = (p: THREE.Vector3, c: THREE.Color, overwrite = false): void => {
    const g = new THREE.Vector3(Math.round(p.x / VOX), Math.round(p.y / VOX), Math.round(p.z / VOX));
    const key = `${g.x},${g.y},${g.z}`;
    if (!overwrite && cells.has(key)) return;
    cells.set(key, { p: g.multiplyScalar(VOX), c });
  };
  const base = new THREE.Color();
  for (const leaf of leaves) {
    const fr = leafFrame(world, leaf);
    if (!fr) continue;
    base.set(0x5f9a4a).set(leaf.color);
    const jit = (x: number, y: number, z: number): THREE.Color => shade(base, 0.85 + hash(x * 7.1 + y * 13.7 + z * 3.9 + leaf.s) * 0.3);
    // stalk
    for (let d = VOX * 0.6; d < fr.stalk; d += VOX * 0.8) put(fr.p.clone().addScaledVector(fr.out, d), STALK);
    if (leaf.kind === "fruit") {
      const rc = Math.max(1, Math.round((fr.len * 0.3) / VOX));
      const c = fr.tip.clone().addScaledVector(fr.L, rc * VOX * 0.8);
      for (let x = -rc; x <= rc; x++) for (let y = -rc; y <= rc; y++) for (let z = -rc; z <= rc; z++) {
        if (x * x + y * y + z * z > rc * rc + 0.6) continue;
        put(c.clone().add(new THREE.Vector3(x * VOX, y * VOX, z * VOX)), jit(x, y, z));
      }
      continue;
    }
    const step = VOX * 0.55;
    const nU = Math.ceil((2 * fr.halfW) / step) + 1;
    const nV = Math.ceil(fr.len / step) + 1;
    const at = (u: number, v: number): THREE.Vector3 => fr.tip.clone().addScaledVector(fr.side, u * fr.halfW).addScaledVector(fr.L, v * fr.len);
    for (const poly of LEAF_SHAPES[leaf.kind]) {
      for (let i = 0; i < nU; i++) {
        for (let j = 0; j < nV; j++) {
          const u = -1 + (2 * i) / (nU - 1 || 1);
          const v = j / (nV - 1 || 1);
          if (inPoly(u, v, poly)) put(at(u, v), jit(i, j, 0));
        }
      }
      // outlines too, so thin shapes (needles, petal tips) survive the coarse grid
      for (let e = 0; e < poly.length; e++) {
        const [u0, v0] = poly[e];
        const [u1, v1] = poly[(e + 1) % poly.length];
        const n = Math.max(2, Math.ceil((Math.hypot((u1 - u0) * fr.halfW, (v1 - v0) * fr.len)) / (VOX * 0.5)));
        for (let k = 0; k <= n; k++) put(at(u0 + ((u1 - u0) * k) / n, v0 + ((v1 - v0) * k) / n), jit(e, k, 1));
      }
    }
    const accent = LEAF_ACCENT[leaf.kind];
    if (accent) put(at(0, 0.5).addScaledVector(fr.N, VOX * 0.6), new THREE.Color(accent), true);
  }
  const items: Item[] = [...cells.values()].map((c) => ({ p: c.p, color: c.c }));
  return instanced(new THREE.BoxGeometry(VOX, VOX, VOX), items, new THREE.MeshLambertMaterial({ color: 0xffffff }));
}

/** All leaves as one mesh (a Group, so callers can swap it wholesale). */
export function buildLeaves(world: World, leaves: Leaf[], look: Look): THREE.Group {
  const g = new THREE.Group();
  const m = look === "lowpoly" ? lowpolyLeaves(world, leaves) : voxelLeaves(world, leaves);
  if (m) g.add(m);
  return g;
}

/**
 * Light rig: a cool sky/warm ground hemisphere + a little flat fill + the warm sun. The sun carries most of the light (so a shadow
 * is clearly darker than a lit face) and the fill keeps shadows blue-ish instead of black. Same rig for both looks.
 */
export function buildLights(): { hemi: THREE.HemisphereLight; fill: THREE.AmbientLight; sun: THREE.DirectionalLight; rim: THREE.DirectionalLight } {
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x77714f, 1.05);
  const fill = new THREE.AmbientLight(0xaebbd8, 0.42);
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  // a weak cool light from the opposite side and low: the shaded flanks keep a bluish edge ("rim"), never casts a shadow
  const rim = new THREE.DirectionalLight(0x9db8ff, 0.55);
  rim.position.set(SUN_DIR.x * -1000, 260, SUN_DIR.z * -1000);
  return { hemi, fill, sun, rim };
}

export { buildEnvironment, buildSky } from "./scenery";
export { disposeGroup, hash, SKY, SUN_DIR, T3, toV, VOX } from "./lpkit";
