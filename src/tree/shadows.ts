/**
 * tree/shadows.ts — sun shadows for the Yggdrasil view (both looks) + the blob shadow fallback.
 *
 *   Pure half (unit-tested, tools/unit-lowpoly.mjs): the quality table, the shadow-frustum maths
 *   (`shadowExtent`, `fitShadow` = texel-snapped centre so the shadow edges never crawl, `shadowBias`).
 *   Render half: `SunShadows` (owns the directional light's shadow camera: it follows the animal and
 *   zooms with the camera), `ContactShadow` (a soft dark disc on the ground under the animal: the cheap
 *   fallback when the real shadows are off), `tagShadows` (cast / receive flags on a whole group).
 *
 * One orthographic shadow map around the focus (no cascades): the half-size follows the camera distance
 * in quantised steps, so a close-up gets ~4 texels per world px (crisp) and a far overview still shadows the
 * whole forest in front of you. A shadow is faded out over the outer 14 % of the map (global patch of
 * three's PCF chunk below), so there is no hard "shadows end here" line on the ground.
 */

import * as THREE from "three";
import { SHADOW_LAYER } from "./look";

export type ShadowQuality = "off" | "low" | "medium" | "high";
export const SHADOW_QUALITIES: readonly ShadowQuality[] = ["off", "low", "medium", "high"];
export const SHADOW_KEY = "biblio.v1.treeShadows";
export const DEFAULT_SHADOW_QUALITY: ShadowQuality = "medium";

/** Shadow map size (texels per side) and the PCF blur radius (in texels) per quality; `off` = no map at all. */
export const SHADOW_TABLE: Record<ShadowQuality, { size: number; radius: number }> = {
  off: { size: 0, radius: 0 },
  low: { size: 1024, radius: 1.6 },
  medium: { size: 2048, radius: 2.2 },
  high: { size: 4096, radius: 2.8 },
};

export const parseShadowQuality = (v: unknown): ShadowQuality | null =>
  typeof v === "string" && (SHADOW_QUALITIES as readonly string[]).includes(v) ? (v as ShadowQuality) : null;

/** Next quality in the cycle off -> low -> medium -> high -> off. */
export const nextShadowQuality = (q: ShadowQuality): ShadowQuality => SHADOW_QUALITIES[(SHADOW_QUALITIES.indexOf(q) + 1) % SHADOW_QUALITIES.length];

export const loadShadowQuality = (): ShadowQuality => {
  try {
    return parseShadowQuality(localStorage.getItem(SHADOW_KEY)) ?? DEFAULT_SHADOW_QUALITY;
  } catch {
    return DEFAULT_SHADOW_QUALITY;
  }
};

// ---- pure frustum maths -------------------------------------------------------------------------

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Smallest / largest half-size (world px) of the shadow frustum. */
export const EXTENT_MIN = 420;
export const EXTENT_MAX = 6000;
/** Steps per doubling of the (quantised) half-size: the texel size only ever changes in discrete jumps (no shimmer while zooming). */
const EXTENT_STEPS = 3;

/** Half-size of the shadow frustum for a camera `camDist` px from the focus: ~1.1 x that, quantised to 2^(1/3) steps, clamped. Never NaN. */
export function shadowExtent(camDist: number): number {
  const d = Number.isFinite(camDist) ? Math.max(0, camDist) : 0;
  const raw = Math.min(EXTENT_MAX, Math.max(EXTENT_MIN, d * 1.1));
  const step = Math.round(Math.log2(raw / EXTENT_MIN) * EXTENT_STEPS);
  return Math.min(EXTENT_MAX, EXTENT_MIN * Math.pow(2, step / EXTENT_STEPS));
}

const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Light-space axes for a sun direction (unit vector TOWARDS the sun): `right`, `up` span the shadow map plane, `dir` = depth. */
export function lightBasis(dir: V3): { right: V3; up: V3; dir: V3 } {
  const d = norm(dir);
  // world up unless the sun is straight overhead
  const ref: V3 = Math.abs(d.y) > 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const right = norm(cross(ref, d));
  const up = cross(d, right);
  return { right, up, dir: d };
}

export interface ShadowFit {
  /** Frustum centre (the focus, snapped to whole texels in the light's right/up plane). */
  centre: V3;
  /** World size of one shadow texel. */
  texel: number;
  extent: number;
  /** Distance from the centre to the light's position, along the sun direction. */
  back: number;
  /** Far plane of the light's orthographic camera (near is 1). */
  far: number;
}

/**
 * Where the shadow frustum sits for a focus point: the centre is snapped to a whole texel in the light's plane (and in depth), so
 * moving the focus by less than a texel changes nothing and the shadow edges do not crawl. The depth range covers the tallest tree
 * (`HEIGHT`) above the centre and the ground below it.
 */
export function fitShadow(focus: V3, extent: number, mapSize: number, sunDir: V3): ShadowFit {
  const { right, up, dir } = lightBasis(sunDir);
  const size = Math.max(1, mapSize);
  const texel = (2 * extent) / size;
  const snap = (v: number): number => Math.round(v / texel) * texel;
  const a = snap(dot(focus, right));
  const b = snap(dot(focus, up));
  const c = snap(dot(focus, dir));
  const centre: V3 = {
    x: right.x * a + up.x * b + dir.x * c,
    y: right.y * a + up.y * b + dir.y * c,
    z: right.z * a + up.z * b + dir.z * c,
  };
  const back = HEIGHT + extent * 0.9;
  return { centre, texel, extent, back, far: back + HEIGHT * 0.5 + extent * 0.9 + 400 };
}

/** Generous bound of how far casters can be from the focus along the light (tallest tree ~2500 px + the arch). */
const HEIGHT = 3200;

/** Depth bias (negative, in 0..1 depth units of the light camera) and normal bias (world px) for a fit: scale with the texel so acne stays away at every zoom. */
export function shadowBias(fit: ShadowFit): { bias: number; normalBias: number } {
  const range = Math.max(1, fit.far - 1);
  return { bias: -(0.9 + fit.texel * 0.55) / range, normalBias: 0.6 + fit.texel * 0.9 };
}

// ---- soft edge: global patch of three's PCF chunk ----------------------------------------------

let patched = false;
/** Fade the shadow out over the outer 14 % of the map instead of cutting it off. Idempotent; a no-op if three's chunk changes shape. */
export function patchShadowChunk(): boolean {
  if (patched) return true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const start = chunk.indexOf("float getShadow( sampler2DShadow"); // the hardware-PCF variant
  const end = chunk.indexOf("#elif", start);
  const ret = "return mix( 1.0, shadow, shadowIntensity );";
  const at = start < 0 ? -1 : chunk.indexOf(ret, start);
  if (at < 0 || (end >= 0 && at > end)) return false;
  const fade = "vec2 shEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy ); shadowIntensity *= smoothstep( 0.0, 0.14, min( shEdge.x, shEdge.y ) );\n\t\t\t";
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, at) + fade + chunk.slice(at);
  patched = true;
  return true;
}

/** The (possibly patched) PCF shadow chunk text, for tests. */
export const shadowChunkText = (): string => THREE.ShaderChunk.shadowmap_pars_fragment;

// ---- render half --------------------------------------------------------------------------------

const tagged = new WeakSet<THREE.Object3D>();

/** Set cast / receive flags on every mesh under `root` (once per object: later calls skip what was already tagged, so per-frame use is cheap). */
export function tagShadows(root: THREE.Object3D, cast: boolean, receive: boolean, transparentCasts = false): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || tagged.has(o)) return;
    tagged.add(o);
    const mat = m.material as THREE.Material | THREE.Material[];
    const clear = !transparentCasts && (Array.isArray(mat) ? mat.some((x) => x.transparent) : mat.transparent);
    // `userData.noCast` = receives only (the voxel cubes: a shadow-only proxy casts for them), `shadowOnly` = a proxy that casts and never receives
    m.castShadow = (cast && !clear && !m.userData.noCast) || !!m.userData.shadowOnly;
    m.receiveShadow = receive && !m.userData.shadowOnly;
  });
}

/** Drop the "already tagged" memory of a subtree (its meshes are about to be re-tagged, e.g. after a quality change). */
export function untagShadows(root: THREE.Object3D): void {
  root.traverse((o) => tagged.delete(o));
}

/** Foliage casts a shadow only where it is solid enough: depth material that discards by the instance fade (`aFade`, see foliage.ts). */
export function foliageDepthMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("void main() {", "attribute float aFade;\nvarying float vFade;\nvoid main() {\n  vFade = aFade;");
    s.fragmentShader = s.fragmentShader.replace("void main() {", "varying float vFade;\nvoid main() {\n  if ( vFade < 0.42 ) discard;");
  };
  mat.customProgramCacheKey = () => "foliage-depth";
  return mat;
}

export class SunShadows {
  private q: ShadowQuality;
  private disposed = false;
  /** Last fit (debug / tests). */
  fit: ShadowFit | null = null;

  constructor(private renderer: THREE.WebGLRenderer, readonly light: THREE.DirectionalLight, private sunDir: THREE.Vector3, quality: ShadowQuality) {
    patchShadowChunk();
    renderer.shadowMap.type = THREE.PCFShadowMap;
    light.shadow.camera.near = 1;
    light.shadow.camera.layers.enable(SHADOW_LAYER); // shadow-only proxies (voxel bark) live on this layer, the main camera never draws them
    light.shadow.mapSize.set(1, 1);
    this.q = "off";
    this.set(quality);
  }

  get quality(): ShadowQuality {
    return this.q;
  }

  get on(): boolean {
    return this.q !== "off";
  }

  /** Change the quality; returns true when the shadow pass was switched on/off (materials must be refreshed by the caller). */
  set(q: ShadowQuality): boolean {
    if (this.disposed) return false;
    const was = this.q;
    this.q = q;
    const t = SHADOW_TABLE[q];
    const sh = this.light.shadow;
    this.renderer.shadowMap.enabled = q !== "off";
    this.light.castShadow = q !== "off";
    if (q !== "off") {
      if (sh.mapSize.x !== t.size) {
        sh.mapSize.set(t.size, t.size);
        sh.map?.dispose();
        sh.map = null;
      }
      sh.radius = t.radius;
      sh.intensity = 0.92;
    } else {
      sh.map?.dispose();
      sh.map = null;
    }
    return (was === "off") !== (q === "off");
  }

  /** Per frame: point the shadow camera at the focus (snapped), sized for the camera distance. */
  update(focus: V3, camDist: number): void {
    if (this.disposed || this.q === "off") return;
    const sh = this.light.shadow;
    const fit = fitShadow(focus, shadowExtent(camDist), sh.mapSize.x, this.sunDir);
    this.fit = fit;
    const cam = sh.camera as THREE.OrthographicCamera;
    if (cam.right !== fit.extent || cam.far !== fit.far) {
      cam.left = -fit.extent;
      cam.right = fit.extent;
      cam.top = fit.extent;
      cam.bottom = -fit.extent;
      cam.near = 1;
      cam.far = fit.far;
      cam.updateProjectionMatrix();
    }
    const b = shadowBias(fit);
    sh.bias = b.bias;
    sh.normalBias = b.normalBias;
    this.light.target.position.set(fit.centre.x, fit.centre.y, fit.centre.z);
    this.light.position.set(fit.centre.x, fit.centre.y, fit.centre.z).addScaledVector(this.sunDir, fit.back);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
  }

  dispose(): void {
    this.disposed = true;
    this.light.shadow.map?.dispose();
    this.light.shadow.map = null;
    this.light.castShadow = false;
  }
}

/** A soft dark disc on the ground under the animal (fallback when the shadow map is off). Bigger and fainter with height. */
export class ContactShadow {
  readonly mesh: THREE.Mesh;
  private tex: THREE.CanvasTexture;

  constructor() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const cx = cv.getContext("2d")!;
    const g = cx.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.55, "rgba(0,0,0,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = g;
    cx.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** `size` = animal length in px, `height` = how far above the ground it is, `lift` = how far above `groundY` to sit (terrain bumps). */
  update(on: boolean, x: number, z: number, groundY: number, height: number, size: number, lift: number): void {
    this.mesh.visible = on;
    if (!on) return;
    const h = Math.max(0, height);
    const spread = size * (0.9 + Math.min(2.2, h / 380));
    const fade = 1 / (1 + h / 260);
    this.mesh.position.set(x, groundY + lift, z);
    this.mesh.scale.set(spread, 1, spread);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(1, fade));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
