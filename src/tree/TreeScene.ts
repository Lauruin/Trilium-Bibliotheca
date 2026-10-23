/**
 * tree/TreeScene.ts — three.js renderer for the Yggdrasil view, driven by the pure
 * simulation in sim3.ts/world3.ts. Two LOOKS (voxel / low-poly, see look.ts), a sky,
 * ground and horizon, and three cameras.
 *
 * Used by the standalone prototype page (lizard3d.html) and by the app's tree view.
 * It owns the render loop, the creature, the camera and keyboard input (when `enabled`):
 *   chase — behind the animal, up = the surface normal, so the view rolls around the branch;
 *   level — follows the animal but the horizon stays level (up = world up);
 *   fixed — a still camera that only tracks the animal.
 * Leaves (notes) have a kind (shape) and a size (from the note's length) and can be walked to.
 */

import * as THREE from "three";
import {
  animalForKey, bodyPoint, leapPreview, silkPoints, climbTarget, flightBasis, headNormal, headingVector, spawn, step, ANIMALS, ANIMAL_CATEGORIES, DEFAULT_MOVE_MODE, MOVE_MODES, NO_INPUT,
  type Animal, type Creature, type Input, type MoveMode,
} from "./sim3";
import { BranchLabels, LABEL_MODES, type LabelMode } from "./labels";
import { applySilks, silkVersion } from "./silk";
import { leafScale } from "./leafkind";
import { buildLeafIndex, nearestLeafTo, type LeafIndex } from "./leafindex";
import {
  AdaptiveScale, DEFAULT_PERF_PROFILE, diagnose, effectivePixelRatio, FrameClock, nextPerfProfile, PERF_KEY, PERF_PROFILES, PROFILE,
  FrameLimiter, useMsaa, type FrameSummary, type PerfProfile,
} from "./perf";
import type { Leaf } from "./layout";
import { surfacePoint, type World } from "./world3";
import { clampDensity, FoliageLayer } from "./foliage";
import { CreatureRig } from "./creatures";
import { CLOUDS, createVignette, environmentKey } from "./scenery";
import { ContactShadow, foliageDepthMaterial, loadShadowQuality, nextShadowQuality, SHADOW_KEY, SunShadows, tagShadows, type ShadowQuality } from "./shadows";
import {
  buildBark, buildEnvironment, buildLeaves, buildLights, buildSky, disposeGroup, SKY, SUN_DIR, T3, VOX, WIND, type Look,
} from "./look";

export type { Leaf } from "./layout";
export { ANIMALS, ANIMAL_CATEGORIES };
export type { LabelMode };
export type { PerfProfile };
export { VOX, branchVoxels, LOOKS, type Look } from "./look";

export type CamMode = "chase" | "level" | "fixed";
export const CAM_MODES: readonly CamMode[] = ["chase", "level", "fixed"];

const LOOK_KEY = "biblio.v1.treeLook";
const CAM_KEY = "biblio.v1.treeCam";
const LABEL_KEY = "biblio.v1.treeLabels";
const FOLIAGE_KEY = "biblio.v1.treeFoliage";
const FOLIAGE_DENSITY_KEY = "biblio.v1.treeFoliageDensity";
/** Movement mode: guided (W up / S down the branch, A/D turn) | free (the old steered heading). */
const MOVE_KEY = "biblio.v1.treeMove";
/** Fastest the camera follows a guided heading change (rad/s). */
const CAM_TURN = 1.7;

export interface HudInfo {
  animal: string;
  animalId: string;
  flying: boolean;
  aiming: boolean;
  dangling: boolean;
  canSilk: boolean;
  autoAlign: boolean;
  /** Movement mode (key M): guided | free. Auto-align (H) only does something in free mode. */
  moveMode: MoveMode;
  labels: LabelMode;
  /** Canopy foliage on/off (key F) and its density multiplier. */
  foliage: boolean;
  foliageDensity: number;
  /** Shadow quality (key K): off | low | medium | high. */
  shadows: ShadowQuality;
  branch: string;
  th: number;
  phi: number;
  grip: number;
  gripOn: boolean;
  airborne: boolean;
  reaching: boolean;
  /** Back-compat: true for the chase camera. */
  chase: boolean;
  camera: CamMode;
  look: Look;
  nearLeaf: Leaf | null;
  /** The side branch Shift would climb into right now. */
  climb: string | null;
  /** Performance profile (quality | auto | fast) and, while the overlay (key I) is on, the live numbers. */
  perfProfile: PerfProfile;
  perf: PerfStats | null;
}

/** What the stats overlay shows (see tree/perf.ts for how to read it). */
export interface PerfStats extends FrameSummary {
  /** Draw calls and triangles of the last frame (incl. the shadow pass), and what is alive on the GPU. */
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** Pixel ratio actually used, the adaptive scale, and the drawing buffer size in pixels. */
  dpr: number;
  scale: number;
  width: number;
  height: number;
  profile: PerfProfile;
  maxFps: number;
  /** MSAA was requested when the renderer was created (a profile change applies it the next time the tree view opens). */
  msaa: boolean;
  /** The adaptive resolution is at its lowest allowed step and the frames are still slow. */
  atFloor: boolean;
  diagnosis: ReturnType<typeof diagnose>;
}

const load = <T extends string>(key: string, allowed: readonly T[], d: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : d;
  } catch {
    return d;
  }
};
const save = (key: string, v: string): void => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* a preference, never an error */
  }
};

export class TreeScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  world: World;
  creature: Creature;
  leaves: Leaf[] = [];
  /** Keyboard input is only read while enabled (the app disables it behind dialogs). */
  enabled = true;
  camMode: CamMode;
  /** Movement mode (key M, remembered): every creature this scene spawns gets it. */
  moveMode: MoveMode;
  look: Look;
  labelMode: LabelMode;
  /** Canopy foliage (src/tree/foliage.ts): on/off + density, persisted. */
  foliageOn: boolean;
  foliageDensity: number;
  /** Folder titles by branch id (set with setWorld) — for the sign / bubble labels. */
  titles: ReadonlyMap<string, string> = new Map();
  zoomMul = 1.5;
  pixelated = false;
  /** Performance profile (key via the overlay): pixel-ratio cap, fps cap, adaptive resolution; remembered. */
  perfProfile: PerfProfile;
  /** Stats overlay (key I): fills `HudInfo.perf` while on. */
  perfOverlay = false;
  onHud: ((h: HudInfo) => void) | null = null;
  /** E pressed near a leaf. */
  onInteract: ((leaf: Leaf) => void) | null = null;

  private worldGroup = new THREE.Group();
  private barkGroup = new THREE.Group();
  private leafGroup = new THREE.Group();
  private envGroup = new THREE.Group();
  private foliage = new FoliageLayer();
  private labels = new BranchLabels();
  /** Jump-aim preview: dotted arc + a reticle where it lands (or the jay's landing target). */
  private previewDots: THREE.InstancedMesh;
  private reticle: THREE.Sprite;
  /** Spider silk: the frozen threads (branches flagged silk) + the rope you are dangling on. */
  private silkLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf2f2ff, transparent: true, opacity: 0.85 }));
  private silkQueued = false;
  /** The animal's meshes and their per-frame pose (src/tree/creatures.ts). */
  private rig = new CreatureRig();
  private creatureGroup = this.rig.group;
  private get camScale(): number {
    return this.rig.camScale;
  }
  private keys = new Set<string>();
  private leapQueued = false;
  private raf = 0;
  private last = 0;
  private disposed = false;
  private camPos = new THREE.Vector3(0, 0, 500);
  private camUp = new THREE.Vector3(0, 1, 0);
  private camLook = new THREE.Vector3();
  /** Level camera: horizontal direction it looks along (radians around the y axis). */
  private levelYaw = 0;
  /** Guided movement: the heading the chase / level camera follows (eased, see `travel`). */
  private camFwd = new THREE.Vector3(1, 0, 0);
  private wisp: THREE.Sprite;
  private wispTarget = new THREE.Vector3();
  private sky: ReturnType<typeof buildSky>;
  private sunLight: THREE.DirectionalLight;
  /** Sun shadow map that follows the animal + the blob fallback under it (src/tree/shadows.ts). */
  private shadows: SunShadows;
  private contact = new ContactShadow();
  private foliageDepth = foliageDepthMaterial();
  private leafTimer = 0;
  private ground = 0;
  private msaa: boolean;
  private clock = new FrameClock();
  private adaptive: AdaptiveScale;
  private resScale = 1;
  private lastRender = 0;
  private limiter = new FrameLimiter(0);
  private adaptAt = 0;
  private lastInfo = { calls: 0, triangles: 0 };
  /** Leaf positions, computed once per world (nearest-leaf queries are a flat loop). */
  private leafIdx: LeafIndex | null = null;
  /** The HUD's "next to a leaf" / "Shift would climb into" are recomputed at ~10 Hz, not every frame. */
  private hudAt = 0;
  private hudNear: Leaf | null = null;
  private hudClimb: string | null = null;
  private foliageAcc = 0;
  private silkVer = -1;
  private ropeShown = false;
  private lenId = "";
  private lenVal = 0;
  /** Rebuilds of the world's meshes are coalesced (a slider drag replaces the world many times a second). */
  private lastBuild = 0;
  private buildTimer = 0;
  /** The cloud group of the environment: kept centred on the camera and turned slowly. */
  private clouds: THREE.Object3D | null = null;
  private envKey = "";
  /** Soft dark rim of the picture (low-poly look only). */
  private vignette = createVignette();
  private listeners: Array<[string, EventListener]> = [];

  constructor(private container: HTMLElement, world: World, startBranch: string, startS: number, animalIndex = 0) {
    this.world = world;
    this.look = load(LOOK_KEY, ["voxel", "lowpoly"] as const, "voxel");
    this.camMode = load(CAM_KEY, CAM_MODES, "chase");
    this.moveMode = load(MOVE_KEY, MOVE_MODES, DEFAULT_MOVE_MODE);
    this.labelMode = load(LABEL_KEY, LABEL_MODES, "signs");
    this.foliageOn = load(FOLIAGE_KEY, ["on", "off"] as const, "on") === "on";
    this.foliageDensity = clampDensity(Number(load(FOLIAGE_DENSITY_KEY, ["0.25", "0.5", "0.75", "1", "1.25", "1.5"] as const, "1")));
    this.perfProfile = load(PERF_KEY, PERF_PROFILES, DEFAULT_PERF_PROFILE);
    this.msaa = useMsaa(this.perfProfile, window.devicePixelRatio);
    // powerPreference: on laptops with two GPUs this asks for the fast one; MSAA only where it is cheap (see perf.ts); the
    // counters are reset by hand once per frame so the shadow pass is counted too
    this.renderer = new THREE.WebGLRenderer({ antialias: this.msaa, powerPreference: "high-performance", stencil: false });
    this.renderer.info.autoReset = false;
    this.adaptive = new AdaptiveScale(PROFILE[this.perfProfile].minScale);
    this.limiter.setMaxFps(PROFILE[this.perfProfile].maxFps);
    this.applyPixelRatio();
    container.appendChild(this.renderer.domElement);
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(this.vignette);
    this.vignette.style.opacity = this.look === "lowpoly" ? "1" : "0";
    this.camera = new THREE.PerspectiveCamera(42, 1, 3, 60000);
    this.scene.background = new THREE.Color(SKY.horizon);
    this.scene.fog = new THREE.Fog(SKY.horizon, 2200, 13500);
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps the authored colours, only rolls off the brightest sunlit faces
    const lights = buildLights();
    this.scene.add(lights.hemi, lights.fill, lights.rim);
    this.sunLight = lights.sun;
    this.shadows = new SunShadows(this.renderer, this.sunLight, SUN_DIR, loadShadowQuality());
    this.sky = buildSky();
    this.scene.add(this.sunLight, this.sunLight.target, this.contact.mesh, this.sky.dome, this.sky.sun, this.worldGroup, this.creatureGroup);
    this.worldGroup.add(this.envGroup, this.barkGroup, this.leafGroup, this.foliage.group, this.labels.group);
    this.creature = spawn(world, ANIMALS[animalIndex], startBranch, startS, this.moveMode);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const cx = cv.getContext("2d")!;
    const g = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(235,250,255,0.95)");
    g.addColorStop(0.35, "rgba(160,220,255,0.5)");
    g.addColorStop(1, "rgba(120,200,255,0)");
    cx.fillStyle = g;
    cx.fillRect(0, 0, 64, 64);
    const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false });
    this.wisp = new THREE.Sprite(mat);
    this.wisp.scale.set(34, 34, 1);
    this.scene.add(this.wisp);
    this.previewDots = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9, fog: false }), 80);
    this.previewDots.count = 0;
    this.previewDots.frustumCulled = false;
    this.previewDots.renderOrder = 30;
    const rc = document.createElement("canvas");
    rc.width = rc.height = 64;
    const rx = rc.getContext("2d")!;
    rx.strokeStyle = "#fff";
    rx.lineWidth = 6;
    rx.beginPath();
    rx.arc(32, 32, 22, 0, Math.PI * 2);
    rx.stroke();
    rx.beginPath();
    rx.moveTo(32, 4); rx.lineTo(32, 16); rx.moveTo(32, 48); rx.lineTo(32, 60); rx.moveTo(4, 32); rx.lineTo(16, 32); rx.moveTo(48, 32); rx.lineTo(60, 32);
    rx.stroke();
    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(rc), transparent: true, depthTest: false, depthWrite: false, fog: false }));
    this.reticle.renderOrder = 31;
    this.reticle.visible = false;
    this.silkLines.frustumCulled = false;
    this.scene.add(this.previewDots, this.reticle, this.silkLines);
    this.resize();
    const on = (t: string, f: EventListener): void => {
      window.addEventListener(t, f);
      this.listeners.push([t, f]);
    };
    on("resize", () => this.resize());
    on("keydown", ((e: KeyboardEvent) => this.key(e, true)) as EventListener);
    on("keyup", ((e: KeyboardEvent) => this.key(e, false)) as EventListener);
    on("blur", () => this.keys.clear());
    on("wheel", ((e: WheelEvent) => {
      if (!this.enabled) return;
      this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }) as EventListener);
  }

  /** Back-compat for callers that only know "chase or not". */
  get chase(): boolean {
    return this.camMode === "chase";
  }

  // ---- public controls ------------------------------------------------------------

  zoom(factor: number): void {
    this.zoomMul = Math.min(8, Math.max(0.2, this.zoomMul * factor));
  }

  setAnimal(a: Animal): void {
    const h = this.creature.head;
    const { gripOn, autoAlign } = this.creature;
    this.creature = spawn(this.world, a, h.b, h.s, this.moveMode);
    this.creature.gripOn = gripOn;
    this.creature.autoAlign = autoAlign;
  }

  /** Number key n (1-based): pick that category, or cycle within it when it is already the current one. */
  selectCategory(n: number): void {
    const i = animalForKey(n, this.creature.animal.id);
    if (i >= 0) this.setAnimal(ANIMALS[i]);
  }

  setLabels(mode: LabelMode): void {
    this.labelMode = mode;
    save(LABEL_KEY, mode);
    this.labels.rebuild(this.world, this.titles, mode);
  }

  cycleLabels(): void {
    this.setLabels(LABEL_MODES[(LABEL_MODES.indexOf(this.labelMode) + 1) % LABEL_MODES.length]);
  }

  /** Canopy foliage on/off (+ density 0.25..1.5); persisted. Off frees the meshes, on rebuilds them for the current world and look. */
  setFoliage(on: boolean, density?: number): void {
    const d = density === undefined ? this.foliageDensity : clampDensity(density);
    if (on === this.foliageOn && d === this.foliageDensity) return;
    this.foliageOn = on;
    this.foliageDensity = d;
    save(FOLIAGE_KEY, on ? "on" : "off");
    save(FOLIAGE_DENSITY_KEY, String(d));
    this.rebuildFoliage();
  }

  toggleFoliage(): void {
    this.setFoliage(!this.foliageOn);
  }

  /** Foliage cost for tests / the debug handle: clusters, instances, draw calls, triangles. */
  get foliageStats(): FoliageLayer["stats"] {
    return this.foliage.stats;
  }

  /** Shadow quality off | low | medium | high (persisted). Switching on/off recompiles the materials once. */
  setShadows(q: ShadowQuality): void {
    if (q === this.shadows.quality) return;
    const toggled = this.shadows.set(q);
    save(SHADOW_KEY, q);
    if (toggled) this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  }

  cycleShadows(): void {
    this.setShadows(nextShadowQuality(this.shadows.quality));
  }

  get shadowQuality(): ShadowQuality {
    return this.shadows.quality;
  }

  /** Shadow frustum of the last frame (debug handle / tests). */
  get shadowFit(): SunShadows["fit"] {
    return this.shadows.fit;
  }

  toggleAutoAlign(): void {
    this.creature.autoAlign = !this.creature.autoAlign;
  }

  /** guided (W up / S down the branch, A/D turn in a curve) or free (the old steered heading); remembered. The heading state is reset. */
  setMoveMode(mode: MoveMode): void {
    this.moveMode = mode;
    save(MOVE_KEY, mode);
    this.creature.moveMode = mode;
    this.creature.omega = 0;
    this.creature.swing = 0;
  }

  toggleMoveMode(): void {
    this.setMoveMode(this.moveMode === "guided" ? "free" : "guided");
  }

  setPixelated(on: boolean): void {
    this.pixelated = on;
    this.applyPixelRatio();
    this.renderer.domElement.style.imageRendering = on ? "pixelated" : "auto";
    this.resize();
  }

  /** The drawing-buffer ratio: the profile's cap x the adaptive scale (pixel mode overrides it). */
  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(this.pixelated ? 0.4 : effectivePixelRatio(this.perfProfile, window.devicePixelRatio, this.resScale));
  }

  /** quality | auto | fast (remembered). The pixel-ratio cap and the fps cap apply at once; MSAA the next time the tree view opens. */
  setPerfProfile(p: PerfProfile): void {
    if (p === this.perfProfile) return;
    this.perfProfile = p;
    save(PERF_KEY, p);
    this.adaptive.setMinScale(PROFILE[p].minScale);
    this.limiter.setMaxFps(PROFILE[p].maxFps);
    if (!PROFILE[p].adaptive) this.adaptive.reset();
    this.resScale = PROFILE[p].adaptive ? this.adaptive.scale : 1;
    this.applyPixelRatio();
    this.clock.reset();
  }

  cyclePerfProfile(): void {
    this.setPerfProfile(nextPerfProfile(this.perfProfile));
  }

  togglePerfOverlay(): void {
    this.perfOverlay = !this.perfOverlay;
    if (!this.perfOverlay) return;
    this.clock.reset();
  }

  /** The numbers behind the overlay (also reachable as `window.__treeScene.stats`). */
  get stats(): PerfStats {
    const s = this.clock.summary();
    const size = this.renderer.getSize(new THREE.Vector2());
    const dpr = this.renderer.getPixelRatio();
    const maxFps = PROFILE[this.perfProfile].maxFps;
    return {
      ...s,
      calls: this.lastInfo.calls,
      triangles: this.lastInfo.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      dpr,
      scale: this.resScale,
      width: Math.round(size.x * dpr),
      height: Math.round(size.y * dpr),
      profile: this.perfProfile,
      maxFps,
      msaa: this.msaa,
      atFloor: PROFILE[this.perfProfile].adaptive && this.adaptive.atFloor && this.resScale < 1 && s.avgFrameMs > 21,
      diagnosis: diagnose(s, maxFps),
    };
  }

  setLook(look: Look): void {
    if (look === this.look) return;
    this.look = look;
    save(LOOK_KEY, look);
    this.vignette.style.opacity = look === "lowpoly" ? "1" : "0";
    this.buildWorld();
  }

  toggleLook(): void {
    this.setLook(this.look === "voxel" ? "lowpoly" : "voxel");
  }

  setCamera(mode: CamMode): void {
    this.camMode = mode;
    save(CAM_KEY, mode);
  }

  cycleCamera(): void {
    this.setCamera(CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length]);
  }

  respawn(branchId: string, s: number): void {
    this.creature = spawn(this.world, this.creature.animal, branchId, s, this.moveMode);
  }

  /** Replace the world (and its leaves), e.g. after the vault changed. */
  setWorld(world: World, leaves: Leaf[], startBranch: string, startS: number, titles?: ReadonlyMap<string, string>): void {
    this.world = world;
    this.leaves = leaves;
    this.leafIdx = buildLeafIndex(world, leaves, VOX * 3);
    if (titles) this.titles = titles;
    applySilks(world); // threads the spiders spun earlier this session survive a rebuilt world
    const { gripOn, autoAlign } = this.creature;
    this.creature = spawn(world, this.creature.animal, startBranch, startS, this.moveMode);
    this.creature.gripOn = gripOn;
    this.creature.autoAlign = autoAlign;
    this.buildWorld();
  }

  /** Swap in a re-laid-out world (property edits, refreshes) keeping the animal where it is when its branch still exists. */
  replaceWorld(world: World, leaves: Leaf[], titles?: ReadonlyMap<string, string>): void {
    applySilks(world); // before the lookup: the animal may be standing on a thread
    const c = this.creature;
    const b = world.branches.get(c.head.b);
    if (!b) {
      const root = [...world.branches.values()].find((x) => x.parent === null && !x.silk);
      this.setWorld(world, leaves, root ? root.id : [...world.branches.keys()][0], 120, titles);
      return;
    }
    // same animal, same state (airborne, flying, dangling… all keep going); only the world under it changes
    this.world = world;
    this.leaves = leaves;
    this.leafIdx = buildLeafIndex(world, leaves, VOX * 3);
    if (titles) this.titles = titles;
    c.head.s = Math.min(c.head.s, Math.max(0, b.total - 4));
    this.queueBuild();
  }

  /**
   * Rebuild the meshes now if nothing was built for 150 ms, else once 150 ms after the last build: a slider drag in the
   * branch panel replaces the world many times a second, and each rebuild (bark, leaves, foliage, labels) costs ~150 ms.
   * The simulation already runs on the newest world; only the pictures lag by at most one interval.
   */
  private queueBuild(): void {
    if (this.disposed) return;
    const since = performance.now() - this.lastBuild;
    if (this.buildTimer) return; // a trailing build is queued and will see the newest world
    if (since >= 150) {
      this.buildWorld();
      return;
    }
    this.buildTimer = window.setTimeout(() => {
      this.buildTimer = 0;
      if (!this.disposed) this.buildWorld();
    }, 150 - since);
  }

  /** Apply measured note lengths (noteId → characters): leaves get their size and are rebuilt (debounced). */
  setLeafLengths(chars: ReadonlyMap<string, number>): void {
    let changed = false;
    for (const leaf of this.leaves) {
      const n = chars.get(leaf.id);
      if (n === undefined) continue;
      const size = leafScale(n);
      if (Math.abs(size - leaf.size) > 1e-6) {
        leaf.size = size;
        changed = true;
      }
    }
    if (!changed || this.disposed) return;
    window.clearTimeout(this.leafTimer);
    this.leafTimer = window.setTimeout(() => this.rebuildLeaves(), 250);
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      // the profile's frame-rate cap: a 120/144 Hz display would otherwise render twice as many frames as a 60 Hz one
      if (!this.limiter.shouldRender(now)) return;
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.leafTimer);
    window.clearTimeout(this.buildTimer);
    cancelAnimationFrame(this.raf);
    for (const [t, f] of this.listeners) window.removeEventListener(t, f);
    this.labels.clear();
    this.silkLines.geometry.dispose();
    (this.silkLines.material as THREE.Material).dispose();
    this.previewDots.geometry.dispose();
    (this.previewDots.material as THREE.Material).dispose();
    this.previewDots.dispose();
    this.reticle.material.map?.dispose();
    this.reticle.material.dispose();
    this.foliage.dispose();
    this.shadows.dispose();
    this.contact.dispose();
    this.foliageDepth.dispose();
    disposeGroup(this.worldGroup);
    disposeGroup(this.creatureGroup);
    disposeGroup(this.sky.dome);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.vignette.remove();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- input ----------------------------------------------------------------------

  private key(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    if (!down) {
      this.keys.delete(k); // always: a key released over an input must not stay "held"
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts (Ctrl+L, Ctrl+S…) are not game keys
    if (k === " " && this.enabled) e.preventDefault(); // also on auto-repeat, so a focused HUD button is not clicked on release
    if (!this.enabled || e.repeat) return;
    this.keys.add(k);
    if (k === " ") {
      this.leapQueued = true;
      e.preventDefault();
    }
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && n <= ANIMAL_CATEGORIES.length) this.selectCategory(n);
    if (k === "g") this.creature.gripOn = !this.creature.gripOn;
    if (k === "v") this.cycleCamera();
    if (k === "n") this.cycleLabels();
    if (k === "x") this.silkQueued = true;
    if (k === "h") this.toggleAutoAlign();
    if (k === "m") this.toggleMoveMode();
    if (k === "l") this.toggleLook();
    if (k === "f") this.toggleFoliage();
    if (k === "k") this.cycleShadows();
    if (k === "p") this.setPixelated(!this.pixelated);
    if (k === "i") this.togglePerfOverlay();
    if (k === "+" || k === "=") this.zoom(1 / 1.2);
    if (k === "-" || k === "_") this.zoom(1.2);
    if (k === "e") {
      const near = this.nearestLeaf();
      if (near) this.onInteract?.(near);
    }
  }

  // ---- world ----------------------------------------------------------------------

  /** Ground height: the world's own, else well below the lowest branch (the demo log floats). */
  private findGround(): number {
    if (this.world.groundY !== undefined) return this.world.groundY;
    let minY = 0;
    for (const b of this.world.branches.values()) for (const p of b.pts) minY = Math.min(minY, p.y - Math.max(b.r, b.rEnd));
    return minY - 900;
  }

  private buildWorld(): void {
    window.clearTimeout(this.buildTimer);
    this.buildTimer = 0;
    this.lastBuild = performance.now();
    this.ground = this.findGround();
    disposeGroup(this.barkGroup);
    const envKey = environmentKey(this.look, this.ground, this.world); // an edit that leaves the ground contacts alone keeps the old scenery
    if (envKey !== this.envKey) {
      this.envKey = envKey;
      disposeGroup(this.envGroup);
      this.envGroup.add(buildEnvironment(this.look, this.ground, this.world));
      this.clouds = this.envGroup.getObjectByName(CLOUDS) ?? null;
    }
    this.barkGroup.add(buildBark(this.world, this.look, this.ground));
    tagShadows(this.barkGroup, true, true);
    this.rebuildLeaves();
    this.rebuildFoliage();
    this.labels.rebuild(this.world, this.titles, this.labelMode);
  }

  /** Canopy for the current world + look (nothing built while foliage is off). */
  private rebuildFoliage(): void {
    if (this.disposed) return;
    if (!this.foliageOn) {
      this.foliage.clear();
      return;
    }
    this.foliage.build(this.world, this.leaves, this.look, this.foliageDensity);
    this.foliage.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).customDepthMaterial = this.foliageDepth;
    });
    tagShadows(this.foliage.group, true, true, true);
  }

  private rebuildLeaves(): void {
    if (this.disposed) return;
    disposeGroup(this.leafGroup);
    this.leafGroup.add(buildLeaves(this.world, this.leaves, this.look));
    tagShadows(this.leafGroup, true, true);
  }

  nearestLeaf(maxDist = 70): Leaf | null {
    const c = this.creature;
    if (c.air || !this.leafIdx) return null;
    const hb = this.world.branches.get(c.head.b);
    if (!hb) return null;
    const hp = c.flight ? c.flight.p : surfacePoint(hb, c.head.s, c.head.th).p;
    return nearestLeafTo(this.leafIdx, hp.x, hp.y, hp.z, maxDist);
  }

  // ---- loop -----------------------------------------------------------------------

  private input(): Input {
    if (!this.enabled) return NO_INPUT;
    const k = this.keys;
    const input: Input = {
      forward: k.has("w") || k.has("arrowup"),
      back: k.has("s") || k.has("arrowdown"),
      left: k.has("a") || k.has("arrowleft"),
      right: k.has("d") || k.has("arrowright"),
      leap: this.leapQueued,
      reach: k.has(" "),
      climb: k.has("shift"),
      silk: this.silkQueued,
    };
    this.leapQueued = false;
    this.silkQueued = false;
    return input;
  }

  private frame(now: number): void {
    const cpu0 = performance.now();
    const frameMs = this.lastRender > 0 ? now - this.lastRender : 0;
    this.lastRender = now;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    step(this.world, this.creature, this.input(), dt);
    this.rig.update(this.world, this.creature, t, this.look);
    this.updateCamera(dt);
    // the sky and sun follow the camera, so they never come closer
    this.sky.dome.position.copy(this.camera.position);
    this.sky.sun.position.copy(this.camera.position).addScaledVector(SUN_DIR, 22000);
    WIND.value = t % 600; // (a small number keeps the float32 shader clock precise)
    if (this.clouds) {
      this.clouds.position.set(this.camera.position.x, 0, this.camera.position.z);
      this.clouds.rotation.y = t * 0.0035;
    }
    const head = this.creature.flight ? this.creature.flight.p : bodyPoint(this.creature, 0).p;
    const headV = T3(head);
    const cs = Math.max(0.4, this.camScale);
    this.wispTarget.set(headV.x + (-50 + Math.cos(t * 1.7) * 12) * cs, headV.y + (100 + Math.sin(t * 2.3) * 10) * cs, headV.z + 60 * cs);
    this.wisp.position.lerp(this.wispTarget, Math.min(1, dt * 4));
    this.wisp.scale.set(34 * cs, 34 * cs, 1);
    this.labels.update(this.camera);
    // the canopy fade is eased over ~0.2 s anyway: 30 updates a second look the same and cost half
    this.foliageAcc += dt;
    if (this.foliageAcc >= 1 / 30 - 0.001) {
      this.foliage.update(this.foliageAcc, this.camera.position, headV, this.creature.head.b);
      this.foliageAcc = 0;
    }
    this.updateShadows(headV);
    this.updatePreview();
    this.updateSilk();
    this.renderer.info.reset();
    const render0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const cpu1 = performance.now();
    this.lastInfo = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
    this.clock.push(frameMs, cpu1 - cpu0, cpu1 - render0);
    this.adapt(now);
    const c = this.creature;
    // "next to a leaf" / "Shift would climb into" only matter to the HUD hints: ten times a second is plenty
    if (now - this.hudAt >= 100) {
      this.hudAt = now;
      this.hudNear = this.nearestLeaf();
      this.hudClimb = climbTarget(this.world, c)?.id ?? null;
    }
    this.onHud?.({
      animal: c.animal.name, animalId: c.animal.id, flying: !!c.flight, aiming: !!c.aim, dangling: !!c.silk, canSilk: !!c.animal.silk, autoAlign: c.autoAlign, moveMode: c.moveMode, labels: this.labelMode, foliage: this.foliageOn, foliageDensity: this.foliageDensity, shadows: this.shadows.quality, branch: c.head.b, th: c.head.th, phi: c.phi, grip: c.grip, gripOn: c.gripOn,
      airborne: !!c.air, reaching: !!c.reach, chase: this.chase, camera: this.camMode, look: this.look,
      nearLeaf: this.hudNear, climb: this.hudClimb,
      perfProfile: this.perfProfile, perf: this.perfOverlay ? this.stats : null,
    });
  }

  /** Adaptive resolution: a few times a second, lower the pixel ratio while frames are slow, raise it back when they are clean. */
  private adapt(now: number): void {
    if (now - this.adaptAt < 250) return;
    this.adaptAt = now;
    if (!PROFILE[this.perfProfile].adaptive || this.pixelated) return;
    const sm = this.clock.summary();
    if (sm.samples < 30) return;
    const next = this.adaptive.update(sm.avgFrameMs, now);
    if (next !== this.resScale) {
      this.resScale = next;
      this.applyPixelRatio();
      this.clock.reset(); // the old frames were rendered at another resolution
    }
  }

  /** Shadow frustum follows the animal, the animal's meshes cast, the blob stands in while the real shadows are off. */
  private updateShadows(head: THREE.Vector3): void {
    tagShadows(this.creatureGroup, true, true); // the rig may rebuild its meshes at any time; already-tagged ones are skipped
    this.shadows.update(head, this.camera.position.distanceTo(head));
    if (this.lenId !== this.creature.animal.id) {
      this.lenId = this.creature.animal.id;
      this.lenVal = Math.max(...this.creature.animal.nodes.map((n) => n.d));
    }
    this.contact.update(!this.shadows.on, head.x, head.z, this.ground, head.y - this.ground, this.lenVal * 0.8, this.look === "voxel" ? 2 : 4);
  }

  /** Rebuild the thread lines when a thread appeared/changed (a version counter, not a string per frame), and the live rope while dangling. */
  private updateSilk(): void {
    const rope = silkPoints(this.creature);
    const ver = silkVersion();
    if (!rope && !this.ropeShown && ver === this.silkVer) return;
    this.silkVer = ver;
    this.ropeShown = !!rope;
    const pts: number[] = [];
    for (const b of this.world.branches.values()) {
      if (!b.silk) continue;
      for (let i = 1; i < b.pts.length; i++) pts.push(b.pts[i - 1].x, b.pts[i - 1].y, b.pts[i - 1].z, b.pts[i].x, b.pts[i].y, b.pts[i].z);
    }
    if (rope) pts.push(rope.anchor.x, rope.anchor.y, rope.anchor.z, rope.p.x, rope.p.y, rope.p.z);
    this.silkLines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.silkLines.geometry.computeBoundingSphere();
  }

  /** Dotted arc while aiming a jump; a reticle on the jump's landing spot / the jay's landing target. */
  private updatePreview(): void {
    const c = this.creature;
    const pv = c.aim ? leapPreview(this.world, c) : null;
    const tgt = c.flight?.landTarget ?? null;
    const dots = this.previewDots;
    if (!pv && !tgt) {
      dots.count = 0;
      this.reticle.visible = false;
      return;
    }
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const cs = Math.max(0.5, this.camScale);
    if (pv) {
      const n = Math.min(80, pv.points.length);
      const step = pv.points.length / n;
      col.set(pv.hit ? (pv.assisted ? 0x7dff7d : 0xffffff) : 0xff8a6a);
      for (let i = 0; i < n; i++) {
        const p = pv.points[Math.min(pv.points.length - 1, Math.floor(i * step))];
        const sz = (3 + (i % 2 ? 0 : 2)) * cs * Math.max(1, T3(p).distanceTo(this.camera.position) / 600);
        m.compose(T3(p), new THREE.Quaternion(), new THREE.Vector3(sz, sz, sz));
        dots.setMatrixAt(i, m);
        dots.setColorAt(i, col);
      }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
      const end = pv.hit ? pv.hit.p : pv.points[pv.points.length - 1];
      this.reticle.position.copy(T3(end));
      this.reticle.material.color.set(pv.hit ? (pv.assisted ? 0x7dff7d : 0xffffff) : 0xff8a6a);
      this.reticle.visible = true;
    } else if (tgt) {
      dots.count = 0;
      this.reticle.position.copy(T3(tgt.p));
      this.reticle.material.color.set(0x7dff7d);
      this.reticle.visible = true;
    }
    const d = this.reticle.position.distanceTo(this.camera.position);
    const k = Math.max(26 * cs, d * 0.045);
    this.reticle.scale.set(k, k, 1);
  }

  /** Direction the animal is travelling / looking, plus the "up" of its surface (world up when airborne). */
  private travel(dt = 0): { fwd: THREE.Vector3; up: THREE.Vector3 } {
    const c = this.creature;
    if (c.silk) return { fwd: new THREE.Vector3(Math.cos(c.silk.yaw), 0, Math.sin(c.silk.yaw)), up: new THREE.Vector3(0, 1, 0) };
    if (c.flight) return { fwd: T3(flightBasis(c).fwd), up: new THREE.Vector3(0, 1, 0) };
    if (c.air) return { fwd: T3(c.air.v).normalize(), up: new THREE.Vector3(0, 1, 0) };
    if (c.reach) return { fwd: T3(c.reach.dir), up: T3(c.reach.up) };
    const fwd = T3(headingVector(this.world, c));
    const up = T3(headNormal(this.world, c));
    if (c.moveMode !== "guided" || dt <= 0) return { fwd, up };
    // guided turns are quick (a U-turn swings the heading round at up to ~5 rad/s): the camera follows it at <= CAM_TURN rad/s, so the view swings instead of whipping
    const cf = this.camFwd;
    const ang = Math.acos(Math.max(-1, Math.min(1, cf.dot(fwd))));
    if (!(ang > 1e-4)) cf.copy(fwd);
    else {
      const axis = new THREE.Vector3().crossVectors(cf, fwd);
      if (axis.lengthSq() < 1e-8) axis.copy(up); // heading flipped exactly: swing over the surface's top
      axis.normalize();
      cf.applyAxisAngle(axis, Math.min(ang, Math.min(ang * 5, CAM_TURN) * dt)).normalize();
    }
    return { fwd: cf.clone(), up };
  }

  private updateCamera(dt: number): void {
    const c = this.creature;
    const head = c.flight ? T3(c.flight.p) : T3(bodyPoint(c, 0).p);
    const floor = this.ground + 25;
    let up = new THREE.Vector3(0, 1, 0);
    let wantPos: THREE.Vector3;
    if (this.camMode === "chase") {
      const tv = this.travel(dt);
      up = tv.up;
      wantPos = head.clone().addScaledVector(tv.fwd, -210 * this.zoomMul * this.camScale).addScaledVector(up, 160 * this.zoomMul * this.camScale);
    } else if (this.camMode === "level") {
      // behind the animal on the horizontal plane (keeps its last yaw when it points straight up/down), horizon level
      const { fwd } = this.travel(dt);
      if (Math.hypot(fwd.x, fwd.z) > 0.3) {
        const want = Math.atan2(fwd.z, fwd.x);
        let d = want - this.levelYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = d * Math.min(1, dt * 2.6);
        this.levelYaw += c.moveMode === "guided" ? Math.max(-2 * dt, Math.min(2 * dt, turn)) : turn; // (guided: never faster than 2 rad/s)
      }
      const back = new THREE.Vector3(Math.cos(this.levelYaw), 0, Math.sin(this.levelYaw));
      wantPos = head.clone().addScaledVector(back, -250 * this.zoomMul * this.camScale);
      wantPos.y += 130 * this.zoomMul * this.camScale;
    } else {
      wantPos = head.clone().add(new THREE.Vector3(0, -30 * this.zoomMul * this.camScale, 470 * this.zoomMul * this.camScale));
    }
    wantPos.y = Math.max(wantPos.y, floor);
    const k = Math.min(1, dt * 4);
    this.camPos.lerp(wantPos, k);
    this.camUp.lerp(up, k).normalize();
    this.camLook.lerp(head, Math.min(1, dt * 7));
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camLook);
  }
}

// ---- helpers ----------------------------------------------------------------------
