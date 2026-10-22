/**
 * tree/lpkit.ts — shared building blocks of the looks and the scenery (look.ts, scenery.ts): constants (VOX, SKY, SUN_DIR),
 * colour helpers, deterministic noise, the triangle-soup mesh builder and the instancing helper. Pure three.js, no app state.
 */

import * as THREE from "three";
import type { V3 } from "./world3";

/** Voxel edge length in world units. */
export const VOX = 7;

/** Sky colours; the fog uses the horizon colour so the far ground melts into the sky. */
export const SKY = { zenith: 0x3d74b8, horizon: 0xc2d9e8 };

/** Direction (unit) of the sun in the sky; the directional light uses it too. */
export const SUN_DIR = new THREE.Vector3(-400, 900, 700).normalize();

export const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Colours are authored in sRGB (as they look on screen); three works in linear space. */
export const srgb = (r: number, g: number, b: number): THREE.Color => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
export const hsl = (h: number, sat: number, l: number): THREE.Color => new THREE.Color().setHSL(h, sat, l, THREE.SRGBColorSpace);
export const T3 = (v: V3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);
export const toV = (v: THREE.Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });

// ---- small deterministic noise (bark furrows, moss patches, ground colour) ----------------------

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
/** Value noise on a plane (0..1), smooth in both axes. */
export function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const h = (a: number, b: number): number => hash(a * 57.13 + b * 131.7 + seed * 17.3);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
/** Value noise that wraps in y with the given integer period (facet columns around a tube). */
export function pnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const h = (a: number, b: number): number => hash(a * 57.13 + (((b % period) + period) % period) * 131.7 + seed * 17.3);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Dispose geometries/materials of everything under `o` and empty it. */
export function disposeGroup(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
    (c as THREE.InstancedMesh).dispose?.();
  });
  o.clear();
}

// ---- triangle soup helper (low-poly meshes are one non-indexed, vertex-coloured geometry) --------

export class Soup {
  private pos: number[] = [];
  private col: number[] = [];
  /** Optional per-vertex sway weight (0 = fixed, 1 = full wind swing), see `mesh(wind)`. */
  private sway: number[] | null = null;

  /** One triangle; `cb`/`cc` (default = `color`) give a colour per vertex (baked ambient occlusion gradients); `sw` = per-vertex wind sway weights. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, cb: THREE.Color = color, cc: THREE.Color = color, sw?: readonly [number, number, number]): void {
    const n = this.pos.length / 3;
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.col.push(color.r, color.g, color.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    if (sw) {
      if (!this.sway) this.sway = new Array<number>(n).fill(0);
      this.sway.push(sw[0], sw[1], sw[2]);
    } else if (this.sway) this.sway.push(0, 0, 0);
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** The geometry (non-indexed, one normal per face = facets, vertex colours, `aSway` when any triangle had sway weights). */
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (this.sway) g.setAttribute("aSway", new THREE.Float32BufferAttribute(this.sway, 1));
    g.computeVertexNormals();
    return g;
  }

  /** A flat-shaded vertex-coloured mesh; with a `wind` uniform ({ value: seconds }) and sway weights the vertices swing gently in the vertex shader. */
  mesh(wind?: { value: number }): THREE.Mesh {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const geo = this.geometry();
    if (wind && geo.getAttribute("aSway")) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWind = wind;
        sh.vertexShader = sh.vertexShader
          .replace("void main() {", "attribute float aSway;\nuniform float uWind;\nvoid main() {")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float swPh = position.x * 0.021 + position.z * 0.017 + position.y * 0.013;
            transformed += aSway * 4.5 * vec3( sin( uWind * 1.9 + swPh * 6.0 ), 0.4 * sin( uWind * 2.7 + swPh * 4.0 ), cos( uWind * 1.5 + swPh * 5.0 ) );`,
          );
      };
      mat.customProgramCacheKey = () => "soup-sway";
    }
    return new THREE.Mesh(geo, mat);
  }
}

export const shade = (c: THREE.Color, k: number): THREE.Color => c.clone().multiplyScalar(k);

export interface Item {
  p: THREE.Vector3;
  /** Non-uniform scale (default 1). */
  s?: THREE.Vector3;
  rotY?: number;
  /** Extra tilt about x / z (radians), applied after the y rotation. */
  tilt?: [number, number];
  color: THREE.Color;
}

export function instanced(geo: THREE.BufferGeometry, items: Item[], material?: THREE.Material): THREE.InstancedMesh | null {
  if (items.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, material ?? new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: geo.type !== "BoxGeometry" }), items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  items.forEach((it, i) => {
    q.setFromEuler(e.set(it.tilt?.[0] ?? 0, it.rotY ?? 0, it.tilt?.[1] ?? 0, "YXZ"));
    m.compose(it.p, q, it.s ?? new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, it.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ---- bark -------------------------------------------------------------------------------------

