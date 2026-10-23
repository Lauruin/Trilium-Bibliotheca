/**
 * tree/shrinemodel.ts — what the shrine looks like (three.js; the geometry comes from shrine.ts).
 *
 * One flat-shaded, vertex-coloured mesh for the stones, the door arch (stone frame, wooden door, a lit lintel) and the lantern post:
 * the same chunky shapes in both looks, so there is nothing look-specific to keep in sync. ~600 triangles, built once per world.
 */

import * as THREE from "three";
import { hash, shade, Soup, srgb } from "./lpkit";
import type { Shrine } from "./shrine";

const STONE = srgb(0.54, 0.55, 0.57);
const STONE_DARK = srgb(0.36, 0.37, 0.4);
const MOSS = srgb(0.32, 0.45, 0.26);
const WOOD = srgb(0.43, 0.29, 0.17);
const WOOD_DARK = srgb(0.3, 0.2, 0.12);
const IRON = srgb(0.17, 0.17, 0.2);
const GLOW = srgb(1, 0.82, 0.45);

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** An axis-aligned box turned about y around (cx, cz): centre (cx, cy, cz), half sizes, `rot` radians. */
function box(s: Soup, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rot: number, color: THREE.Color): void {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const P = (x: number, y: number, z: number): THREE.Vector3 => v(cx + x * c - z * sn, cy + y, cz + x * sn + z * c);
  const pts = [
    P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz),
    P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz),
  ];
  const top = shade(color, 1.12), side = color, low = shade(color, 0.78);
  s.quad(pts[4], pts[5], pts[6], pts[7], top);
  s.quad(pts[0], pts[3], pts[2], pts[1], low);
  s.quad(pts[0], pts[1], pts[5], pts[4], side);
  s.quad(pts[1], pts[2], pts[6], pts[5], shade(color, 0.92));
  s.quad(pts[2], pts[3], pts[7], pts[6], side);
  s.quad(pts[3], pts[0], pts[4], pts[7], shade(color, 0.92));
}

/** A tapered prism standing on y: `sides` faces, base radius rb, top radius rt, height h, lightly jittered per corner. */
function prism(s: Soup, cx: number, y0: number, cz: number, rb: number, rt: number, h: number, sides: number, rot: number, color: THREE.Color, seed: number): void {
  const ring = (r: number, y: number, k: number): THREE.Vector3[] =>
    Array.from({ length: sides }, (_, i) => {
      const a = rot + (i / sides) * Math.PI * 2;
      const j = 1 + (hash(seed + i * 3.7 + k) - 0.5) * 0.22;
      return v(cx + Math.cos(a) * r * j, y, cz + Math.sin(a) * r * j);
    });
  const b = ring(rb, y0, 0), t = ring(rt, y0 + h, 9);
  const top = v(cx, y0 + h, cz);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    s.quad(b[i], b[j], t[j], t[i], shade(color, 0.85 + 0.3 * hash(seed + i)));
    s.tri(t[i], t[j], top, shade(color, 1.15));
  }
}

export function buildShrine(shrine: Shrine): THREE.Group {
  const g = new THREE.Group();
  g.name = "SHRINE";
  const soup = new Soup();
  const gy = shrine.groundY;

  // standing stones (a little moss on the top ones)
  shrine.stones.forEach((st, i) => {
    prism(soup, st.x, gy - 3, st.z, st.w, st.w * 0.62, st.h + 3, 5 + (i % 2), st.rot, i % 3 === 0 ? MOSS : STONE, 11 + i * 5);
  });

  const kd = Math.sqrt(shrine.k); // the foot of the world tree is much bigger than the old stump: the door, altar and post grow with it

  // the door: a stone frame + a wooden door standing against the trunk's foot at the door azimuth
  {
    const az = shrine.doorAz;
    const rad = { x: Math.cos(az), z: Math.sin(az) };
    const tan = { x: -Math.sin(az), z: Math.cos(az) };
    const R = shrine.stumpR + 9 * kd;
    const hw = Math.min(34 * kd, Math.max(20, shrine.stumpR * 0.9));
    const H = 78 * kd;
    const at = (r: number, t: number): { x: number; z: number } => ({ x: shrine.centre.x + rad.x * r + tan.x * t, z: shrine.centre.z + rad.z * r + tan.z * t });
    // box rotation: local +x of `box` must run along the tangent
    const rot = Math.atan2(tan.z, tan.x);
    for (const sgn of [-1, 1]) {
      const p = at(R, sgn * (hw + 5 * kd));
      box(soup, p.x, gy + H / 2 - 2, p.z, 6 * kd, H / 2 + 2, 8 * kd, rot, STONE);
    }
    const lintel = at(R, 0);
    box(soup, lintel.x, gy + H + 4 * kd, lintel.z, hw + 12 * kd, 6 * kd, 9 * kd, rot, STONE_DARK);
    box(soup, lintel.x, gy + H + 12 * kd, lintel.z, hw + 4 * kd, 3 * kd, 7 * kd, rot, MOSS);
    // the door leaf with planks, and a warm glow slit above it
    const d = at(R - 3 * kd, 0);
    box(soup, d.x, gy + (H - 4) / 2, d.z, hw, (H - 4) / 2, 3 * kd, rot, WOOD);
    for (let i = -2; i <= 2; i++) {
      const pl = at(R + 0.5 * kd, (i * hw) / 2.6);
      box(soup, pl.x, gy + (H - 4) / 2, pl.z, 1.1 * kd, (H - 6) / 2, 3.2 * kd, rot, WOOD_DARK);
    }
    const hd = at(R + 2 * kd, hw * 0.62);
    box(soup, hd.x, gy + 34 * kd, hd.z, 2.5 * kd, 2.5 * kd, 2 * kd, rot, IRON);
    const slit = at(R - 1 * kd, 0);
    box(soup, slit.x, gy + H - 1, slit.z, hw * 0.7, 1.6 * kd, 4 * kd, rot, GLOW);
  }

  // the altar: a flat stone slab on a short block against the trunk's foot
  {
    const az = shrine.altarAz;
    const rad = { x: Math.cos(az), z: Math.sin(az) };
    const R = shrine.stumpR + 16 * kd;
    const x = shrine.centre.x + rad.x * R, z = shrine.centre.z + rad.z * R;
    const rot = Math.atan2(rad.z, rad.x);
    box(soup, x, gy + 9 * kd, z, 9 * kd, 9 * kd, 15 * kd, rot, STONE_DARK);
    box(soup, x, gy + 20 * kd, z, 12 * kd, 2.5 * kd, 19 * kd, rot, STONE);
    box(soup, x, gy + 24 * kd, z, 3 * kd, 2 * kd, 3 * kd, rot, GLOW);
  }

  // the lantern post that carries the wisp
  {
    const { base, top } = shrine.post;
    prism(soup, base.x, gy - 3, base.z, 7 * kd, 4.5 * kd, top.y - gy + 3, 6, 0.4, STONE_DARK, 77);
    // an iron cradle: four stakes round the perch and a ring
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      box(soup, top.x + Math.cos(a) * 7 * kd, top.y + 6 * kd, top.z + Math.sin(a) * 7 * kd, 1.1 * kd, 6 * kd, 1.1 * kd, 0, IRON);
    }
    box(soup, top.x, top.y + 1.5 * kd, top.z, 8.5 * kd, 1.2 * kd, 8.5 * kd, 0, IRON);
  }

  // the crown: a lantern-fruit hanging at the tip of every place limb (a glowing seed in an iron cage), so the limb ends are easy to find
  for (const pad of shrine.pads) {
    if (!pad.id.startsWith("place:")) continue;
    const { x, y, z } = pad.pos;
    box(soup, x, y + 14, z, 11, 11, 11, 0.4, GLOW);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      box(soup, x + Math.cos(a) * 13, y + 14, z + Math.sin(a) * 13, 1.6, 13, 1.6, 0, IRON);
    }
    box(soup, x, y + 29, z, 14, 2, 14, 0, IRON);
    box(soup, x, y - 1, z, 14, 2, 14, 0, IRON);
  }

  const mesh = soup.mesh();
  mesh.name = "SHRINE_MESH";
  g.add(mesh);
  return g;
}
