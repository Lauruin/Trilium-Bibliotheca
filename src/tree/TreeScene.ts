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
  animalForKey, bodyPoint, cutThread, leapPreview, silkPoints, climbTarget, flightBasis, headNormal, headingVector, spawn, step, ANIMALS, ANIMAL_CATEGORIES, DEFAULT_MOVE_MODE, MOVE_MODES, NO_INPUT,
  type Animal, type Creature, type Input, type MoveMode,
} from "./sim3";
import type { GameEvent } from "../lib/tutorial";
import { BranchLabels, LABEL_MODES, type LabelMode } from "./labels";
import { applySilks, parseSilks, restoreSilks, serializeSilks, SILKS, silkVersion } from "./silk";
import { leafScale } from "./leafkind";
import { buildLeafIndex, nearestLeafTo, type LeafIndex } from "./leafindex";
import { Autopilot, type Goal, type PilotStatus } from "./autopilot";
import { pickAt, type Pick } from "./pick";
import {
  AdaptiveScale, DEFAULT_PERF_PROFILE, diagnose, effectivePixelRatio, FrameClock, nextPerfProfile, PERF_KEY, PERF_PROFILES, PROFILE,
  FrameLimiter, useMsaa, type FrameSummary, type PerfProfile,
} from "./perf";
import type { Leaf } from "./layout";
import { frameAt, nearestOnBranch, radiusAt, surfacePoint, type World } from "./world3";
import { clampDensity, FoliageLayer } from "./foliage";
import { arrival, padNear, padStand, shrineOf, type Pad, type PadId, type Shrine } from "./shrine";
import { daylight, type Daylight } from "./daylight";
import { CLOCK_KEY, parseClock, serializeClock, WorldClock, type ClockState } from "./clock";
import { SkyRig } from "./sky";
import { buildShrine } from "./shrinemodel";
import { parseWispMode, wispHit, wispStep, wispTarget, type WispMode } from "./wisp";
import { CreatureRig } from "./creatures";
import { CLOUDS, createVignette, environmentKey } from "./scenery";
import { ContactShadow, foliageDepthMaterial, loadShadowQuality, nextShadowQuality, SHADOW_KEY, SunShadows, tagShadows, type ShadowQuality } from "./shadows";
import {
  buildBark, buildEnvironment, buildLeaves, buildLights, disposeGroup, SUN_DIR, T3, toV, VOX, WIND, type Look,
} from "./look";

export type { Leaf } from "./layout";
export { ANIMALS, ANIMAL_CATEGORIES };
export type { LabelMode };
export type { PerfProfile };
export { VOX, branchVoxels, LOOKS, type Look } from "./look";

export type CamMode = "chase" | "level" | "fixed" | "mouse";
export const CAM_MODES: readonly CamMode[] = ["chase", "level", "fixed", "mouse"];

const LOOK_KEY = "biblio.v1.treeLook";
const CAM_KEY = "biblio.v1.treeCam";
const LABEL_KEY = "biblio.v1.treeLabels";
const FOLIAGE_KEY = "biblio.v1.treeFoliage";
const FOLIAGE_DENSITY_KEY = "biblio.v1.treeFoliageDensity";
/** Movement mode: guided (W up / S down the branch, A/D turn) | free (the old steered heading). */
const MOVE_KEY = "biblio.v1.treeMove";
/** Fastest the camera follows a guided heading change (rad/s). */
const CAM_TURN = 3.8;

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
  /** The side branch you would climb into right now (standing in its base zone). */
  climb: string | null;
  /** True for an ordinary side branch (entered automatically when you walk tip-ward; Shift stays); false for a ground root / silk thread (Shift climbs in). */
  climbAuto: boolean;
  /** ... entered walking DOWN (a ground root at the stump's foot), not up. */
  climbDown: boolean;
  /** Performance profile (quality | auto | fast) and, while the overlay (key I) is on, the live numbers. */
  perfProfile: PerfProfile;
  perf: PerfStats | null;
  /** Click-to-walk is under way (any key stops it). */
  walking: boolean;
  /** The shrine pad you are standing at (E uses it), or null. */
  pad: { id: PadId; label: string } | null;
  /** The hour in the world and the clock the player chose (the shrine's clock). */
  hour: number;
  clock: ClockState;
  /** Where the wisp is: perched on the shrine, following you; and whether it is lighting the way to a leaf. */
  wispMode: WispMode;
  wispGuiding: boolean;
  /** The pointer is over the wisp (a click opens the search). */
  hoverWisp: boolean;
  /** What is under the pointer (a leaf's or a branch's title) and where, in pixels inside the view; null when nothing / not hovering. */
  hover: { title: string; leaf: boolean; id?: string; x: number; y: number } | null;
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
  /** Mouse camera: the camera orbits the animal at these angles (yaw round the y axis, pitch above the horizon), set by dragging. */
  orbitYaw = 0;
  orbitPitch = 0.4;
  /** Click-to-walk: the running autopilot (or null), and the move mode to give back when it ends. */
  pilot: Autopilot | null = null;
  /** Called when a walk ends: arrived / failed (with a reason) / cancelled by a key press or a click on nothing. */
  onWalkEnd: ((status: PilotStatus | "cancelled", reason: string) => void) | null = null;
  /** What the pointer is over (updated ~10 times a second while it moves). */
  hover: { x: number; y: number; pick: Pick; title: string } | null = null;
  pixelated = false;
  /** Performance profile (key via the overlay): pixel-ratio cap, fps cap, adaptive resolution; remembered. */
  perfProfile: PerfProfile;
  /** Stats overlay (key I): fills `HudInfo.perf` while on. */
  perfOverlay = false;
  onHud: ((h: HudInfo) => void) | null = null;
  /** E pressed near a leaf. */
  onInteract: ((leaf: Leaf) => void) | null = null;
  /** An animal was chosen (the tree view opens the leaf view when it is the ant and a leaf is near). */
  onAnimal: ((a: Animal) => void) | null = null;
  /** The unlock system: which animals may be chosen (default: all); a refused choice calls `onLocked` instead. */
  animalAllowed: (id: string) => boolean = () => true;
  onLocked: ((a: Animal) => void) | null = null;
  /** What the player does (walked, entered a branch, leapt, zoomed, changed animal, clicked to walk): feeds the tutorial and the unlock counters. */
  onGame: ((e: GameEvent) => void) | null = null;
  private gameBranch = "";
  private gameD = 0;
  private gameAcc = 0;
  private gameAir = false;
  /** E pressed at a shrine pad (door / altar / wisp), or the wisp was clicked. */
  onPad: ((id: PadId) => void) | null = null;
  /** The shrine (the stump's door, altar and the wisp's lantern post) exists only in the app (TreeView turns it on), not on the demo page. */
  shrineOn = false;
  shrine: Shrine | null = null;
  private shrineGroup = new THREE.Group();
  private hudPad: Pad | null = null;
  /** The search wisp: perched over the shrine's lantern post or following the animal (key via the HUD / shrine panel), remembered. */
  wispMode: WispMode;
  private wispPos = { x: 0, y: 0, z: 0 };
  /** A leaf the wisp was asked to light the way to (it hovers beside it with a beam of light until the animal has stood there a while). */
  private wispGuide: { leafId: string; p: { x: number; y: number; z: number } } | null = null;
  private guideNear = 0;
  private wispBeam: THREE.Mesh;
  private hoverWisp = false;

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
  private lookDir = new THREE.Vector3();
  private sunDirV = new THREE.Vector3(0, 1, 0);
  /** Frames drawn so far (the tests wait for a few more of them: software GL takes seconds per frame). */
  frameCount = 0;
  /** Threads are remembered between sessions: the storage key, the version last written, and the pending write. */
  private silkKey = "biblio.v1.silk";
  private silkSaved = 0;
  private silkTimer = 0;
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
  private sky: SkyRig;
  private lights: ReturnType<typeof buildLights>;
  /** The time of day (daylight.ts / clock.ts): the player's choice, the current light, and when it was last applied. */
  private worldClock: WorldClock;
  private day: Daylight;
  private dayAt = -1e9;
  private dayDirty = true;
  private wispLamp: THREE.PointLight;
  private cloudMat: THREE.MeshLambertMaterial | null = null;
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
  private hudClimbAuto = false;
  private hudClimbDown = false;
  private foliageAcc = 0;
  private raycaster = new THREE.Raycaster();
  private hoverMarker: THREE.Sprite;
  private goalMarker: THREE.Sprite;
  private pilotRead = false;
  private pilotRestore: MoveMode | null = null;
  private hoverAt = 0;
  private pointer = { down: false, button: 0, x: 0, y: 0, sx: 0, sy: 0, moved: false };
  private elListeners: Array<[string, EventListener]> = [];
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
    this.silkKey = typeof location !== "undefined" && location.pathname.includes("lizard3d") ? "biblio.v1.silkDemo" : "biblio.v1.silk";
    if (SILKS.length === 0) {
      try {
        restoreSilks(parseSilks(localStorage.getItem(this.silkKey))); // threads spun in earlier sessions
      } catch {
        /* storage unavailable: no old threads */
      }
    }
    this.silkSaved = silkVersion();
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
    this.worldClock = new WorldClock(parseClock((() => { try { return localStorage.getItem(CLOCK_KEY); } catch { return null; } })()));
    this.day = daylight(this.worldClock.hours(), this.worldClock.doy(), this.worldClock.state.night);
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.Fog(0xc2d9e8, 2200, 13500);
    this.renderer.toneMapping = THREE.NeutralToneMapping; // keeps the authored colours, only rolls off the brightest sunlit faces
    const lights = buildLights();
    this.lights = lights;
    this.scene.add(lights.hemi, lights.fill, lights.rim);
    this.sunLight = lights.sun;
    this.sunDirV.copy(SUN_DIR); // (own copy: the time of day moves it; SUN_DIR is a shared constant)
    this.shadows = new SunShadows(this.renderer, this.sunLight, this.sunDirV, loadShadowQuality());
    this.sky = new SkyRig();
    this.wispLamp = new THREE.PointLight(0xffd9a0, 0, 1300, 1); // the wisp's lantern: only on in the dark (added to the scene while it is needed)
    this.scene.add(this.sunLight, this.sunLight.target, this.contact.mesh, this.sky.group, this.worldGroup, this.creatureGroup);
    this.worldGroup.add(this.envGroup, this.barkGroup, this.leafGroup, this.foliage.group, this.labels.group, this.shrineGroup);
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
    this.wisp.renderOrder = 28;
    this.scene.add(this.wisp);
    // the beam of light that marks a leaf the wisp was sent to (a soft vertical gradient, turned towards the camera every frame)
    const bc = document.createElement("canvas");
    bc.width = 16;
    bc.height = 128;
    const bx = bc.getContext("2d")!;
    const bg = bx.createLinearGradient(0, 0, 0, 128);
    bg.addColorStop(0, "rgba(255,240,190,0)");
    bg.addColorStop(0.75, "rgba(255,236,170,0.55)");
    bg.addColorStop(1, "rgba(255,250,220,0.95)");
    bx.fillStyle = bg;
    bx.fillRect(0, 0, 16, 128);
    const bh = bx.createLinearGradient(0, 0, 16, 0);
    bh.addColorStop(0, "rgba(0,0,0,1)");
    bh.addColorStop(0.5, "rgba(0,0,0,0)");
    bh.addColorStop(1, "rgba(0,0,0,1)");
    bx.globalCompositeOperation = "destination-out";
    bx.fillStyle = bh;
    bx.fillRect(0, 0, 16, 128);
    this.wispBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    );
    this.wispBeam.visible = false;
    this.wispBeam.renderOrder = 27;
    this.scene.add(this.wispBeam);
    this.wispMode = parseWispMode(load("biblio.v1.treeWisp", ["perch", "follow"] as const, "perch"));
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
    const ring = (color: number): THREE.Sprite => {
      const cvs = document.createElement("canvas");
      cvs.width = cvs.height = 64;
      const cx2 = cvs.getContext("2d")!;
      cx2.strokeStyle = "#fff";
      cx2.lineWidth = 5;
      cx2.beginPath();
      cx2.arc(32, 32, 22, 0, Math.PI * 2);
      cx2.stroke();
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), color, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0.9 }));
      sp.renderOrder = 29;
      sp.visible = false;
      return sp;
    };
    this.hoverMarker = ring(0xfff2b0);
    this.goalMarker = ring(0x7dff7d);
    this.scene.add(this.previewDots, this.reticle, this.silkLines, this.hoverMarker, this.goalMarker);
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
    // the mouse: hover, click to walk, drag to orbit (mouse camera)
    const el = this.renderer.domElement;
    const onEl = (t: string, f: (e: PointerEvent) => void): void => {
      el.addEventListener(t, f as EventListener);
      this.elListeners.push([t, f as EventListener]);
    };
    onEl("pointerdown", (e) => this.pointerDown(e));
    onEl("pointermove", (e) => this.pointerMove(e));
    onEl("pointerup", (e) => this.pointerUp(e));
    onEl("pointerleave", () => (this.hover = null));
    onEl("contextmenu", (e) => e.preventDefault()); // right-drag orbits the mouse camera
    onEl("dblclick", () => {
      if (this.pilot?.goal.leafId) this.pilotRead = true; // double-click a leaf: walk there and read it
    });
  }

  /** Back-compat for callers that only know "chase or not". */
  get chase(): boolean {
    return this.camMode === "chase";
  }

  // ---- public controls ------------------------------------------------------------

  zoom(factor: number): void {
    this.zoomMul = Math.min(8, Math.max(0.2, this.zoomMul * factor));
    this.onGame?.({ kind: "zoom" });
  }

  setAnimal(a: Animal): void {
    if (!this.animalAllowed(a.id)) {
      this.onLocked?.(a);
      return;
    }
    const h = this.creature.head;
    const { gripOn, autoAlign } = this.creature;
    this.creature = spawn(this.world, a, h.b, h.s, this.moveMode);
    this.creature.gripOn = gripOn;
    this.creature.autoAlign = autoAlign;
    this.onAnimal?.(a);
    this.onGame?.({ kind: "animal" });
  }

  /** Choose an animal by id (tests, the HUD); false for an unknown id. */
  chooseAnimal(id: string): boolean {
    const a = ANIMALS.find((x) => x.id === id);
    if (!a || !this.animalAllowed(a.id)) {
      if (a) this.onLocked?.(a);
      return false;
    }
    this.setAnimal(a);
    return true;
  }

  /** Number key n (1-based): pick that category, or cycle within it when it is already the current one. */
  selectCategory(n: number): void {
    const i = animalForKey(n, this.creature.animal.id, this.animalAllowed);
    if (i >= 0) this.setAnimal(ANIMALS[i]);
    else {
      const first = ANIMALS.find((a) => a.id === ANIMAL_CATEGORIES[n - 1]?.ids[0]);
      if (first) this.onLocked?.(first); // the whole category is locked
    }
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
    if (mode === "mouse" && this.camMode !== "mouse") {
      // start the mouse camera where the camera is now
      const head = this.creature.flight ? T3(this.creature.flight.p) : T3(bodyPoint(this.creature, 0).p);
      const rel = this.camera.position.clone().sub(head);
      if (rel.length() > 1) {
        this.orbitYaw = Math.atan2(rel.z, rel.x);
        this.orbitPitch = Math.max(-1.3, Math.min(1.3, Math.asin(rel.y / rel.length())));
      }
    }
    this.camMode = mode;
    save(CAM_KEY, mode);
  }

  cycleCamera(): void {
    this.setCamera(CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length]);
  }

  respawn(branchId: string, s: number): void {
    this.creature = spawn(this.world, this.creature.animal, branchId, s, this.moveMode);
  }

  /** The stump: the one non-silk branch without a parent (forest and hub layouts alike). */
  private stumpId(): string | null {
    for (const b of this.world.branches.values()) if (b.parent === null && !b.silk) return b.id;
    return null;
  }

  private refreshShrine(): void {
    const id = this.shrineOn ? this.stumpId() : null;
    this.shrine = id ? shrineOf(this.world, id) : null;
  }

  /** Turn the shrine (door, altar, lantern post with the wisp) on or off: the app turns it on, the demo page never does. */
  setShrine(on: boolean): void {
    this.shrineOn = on;
    this.refreshShrine();
    this.rebuildShrine();
  }

  private rebuildShrine(): void {
    disposeGroup(this.shrineGroup);
    if (this.shrine) {
      this.shrineGroup.add(buildShrine(this.shrine));
      tagShadows(this.shrineGroup, true, true);
    }
  }

  /** Put the animal at the shrine's door (when the app opens, and when you come back out of the library). */
  moveToShrine(): void {
    if (!this.shrine) return;
    const a = arrival(this.shrine);
    const { gripOn, autoAlign } = this.creature;
    this.creature = spawn(this.world, this.creature.animal, a.branch, a.s, this.moveMode, a.th);
    this.creature.gripOn = gripOn;
    this.creature.autoAlign = autoAlign;
  }

  /** Put the animal at a pad (door at the foot, the altar in the porch's nest, the wisp at its branch's tip, a place's lantern). For tests and tools. */
  moveToPad(id: PadId): void {
    const sh = this.shrine;
    if (!sh) return;
    const st = padStand(this.world, sh, id);
    if (!this.world.branches.has(st.branch)) return;
    const { gripOn, autoAlign } = this.creature;
    this.creature = spawn(this.world, this.creature.animal, st.branch, st.s, this.moveMode, st.th);
    this.creature.gripOn = gripOn;
    this.creature.autoAlign = autoAlign;
  }

  /** Where the wisp is right now (world coordinates). */
  get wispPoint(): { x: number; y: number; z: number } {
    return { ...this.wispPos };
  }

  /** The pad the animal's head is at right now (null while airborne / flying). */
  nearestPad(): { pad: Pad; k: number } | null {
    const c = this.creature;
    if (!this.shrine || c.air) return null;
    const hb = this.world.branches.get(c.head.b);
    if (!hb) return null;
    const hp = c.flight ? c.flight.p : surfacePoint(hb, c.head.s, c.head.th).p;
    const pad = padNear(this.shrine, hp);
    if (!pad) return null;
    return { pad, k: Math.hypot(hp.x - pad.pos.x, hp.y - pad.pos.y, hp.z - pad.pos.z) / pad.radius };
  }

  // ---- the wisp ---------------------------------------------------------------------

  // ---- time of day ---------------------------------------------------------------------------------

  /** The clock the player chose (real / fixed / fast) and the hour in the world now. */
  get dayClock(): ClockState {
    return { ...this.worldClock.state };
  }

  get hours(): number {
    return this.worldClock.hours();
  }

  /** Intensity of the sun light right now (tests). */
  get sunLightIntensity(): number {
    return this.sunLight.intensity;
  }

  /** The wisp's lantern (a point light) is in the scene: it is dark enough. */
  get lanternOn(): boolean {
    return this.wispLamp.parent !== null;
  }

  /** The light of the moment (a debug handle for the tests and the HUD). */
  get daylight(): Daylight {
    return this.day;
  }

  setClock(state: ClockState): void {
    this.worldClock.set(parseClock(serializeClock(state)));
    try {
      localStorage.setItem(CLOCK_KEY, serializeClock(this.worldClock.state));
    } catch {
      /* a preference, never an error */
    }
    this.dayDirty = true;
  }

  /**
   * Apply the time of day to the lights, the sky, the fog, the clouds, the shadows and the wisp's lantern. The clock is read ten times a
   * second (a real-time day changes by almost nothing in that time; the fastest clock, 2 minutes a day, by a fifth of an hour a second).
   */
  private updateDay(now: number): void {
    if (this.dayDirty || now - this.dayAt >= 100) {
      this.dayAt = now;
      this.dayDirty = false;
      const wc = this.worldClock;
      const d = daylight(wc.hours(), wc.doy(), wc.state.night);
      this.day = d;
      const L = this.lights;
      const set = (c: THREE.Color, rgb: readonly number[]): void => void c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      set(L.hemi.color, d.hemiSky);
      set(L.hemi.groundColor, d.hemiGround);
      L.hemi.intensity = d.hemiIntensity;
      set(L.fill.color, d.fillColor);
      L.fill.intensity = d.fillIntensity;
      set(L.sun.color, d.lightColor);
      L.sun.intensity = d.lightIntensity;
      set(L.rim.color, d.rimColor);
      L.rim.intensity = d.rimIntensity;
      L.rim.position.set(d.rimDir.x * 1000, d.rimDir.y * 1000, d.rimDir.z * 1000);
      this.sunDirV.set(d.sunDir.x, d.sunDir.y, d.sunDir.z);
      this.shadows.setSunDir(this.sunDirV);
      this.shadows.setStrength(d.shadowStrength);
      const bg = this.scene.background as THREE.Color;
      set(bg, d.fogColor);
      const fog = this.scene.fog as THREE.Fog;
      set(fog.color, d.fogColor);
      fog.near = d.fogNear;
      fog.far = d.fogFar;
      if (this.cloudMat) {
        set(this.cloudMat.color, d.cloudTint);
        this.cloudMat.emissiveIntensity = 0.55 * d.dayK + 0.06;
      }
      // the wisp is a lantern in the dark: a real point light (added to the scene only while it is needed: a light costs every pixel)
      this.wispLamp.intensity = 520 * d.wispLight; // (candela: with decay 1 that is ~1.7 at 300 px, ~0.4 at 1300)
      const lit = d.wispLight > 0.02;
      if (lit !== (this.wispLamp.parent !== null)) {
        if (lit) this.scene.add(this.wispLamp);
        else this.scene.remove(this.wispLamp);
      }
    }
    this.sky.update(this.day, this.camera.position);
    if (this.wispLamp.parent) this.wispLamp.position.copy(this.wisp.position);
  }

  /** Write the threads to localStorage (they survive reloads; a cut thread is removed from it). */
  private saveSilks(): void {
    window.clearTimeout(this.silkTimer);
    this.silkTimer = 0;
    this.silkSaved = silkVersion();
    try {
      localStorage.setItem(this.silkKey, serializeSilks());
    } catch {
      /* storage full / disabled: threads last for this session */
    }
  }

  /** Re-read every remembered view setting from localStorage and apply it (after a save was loaded from Trilium). */
  reloadPrefs(): void {
    this.setLook(load(LOOK_KEY, ["voxel", "lowpoly"] as const, "voxel"));
    this.setCamera(load(CAM_KEY, CAM_MODES, "chase"));
    this.setMoveMode(load(MOVE_KEY, MOVE_MODES, DEFAULT_MOVE_MODE));
    this.setLabels(load(LABEL_KEY, LABEL_MODES, "signs"));
    this.setFoliage(load(FOLIAGE_KEY, ["on", "off"] as const, "on") === "on", clampDensity(Number(load(FOLIAGE_DENSITY_KEY, ["0.25", "0.5", "0.75", "1", "1.25", "1.5"] as const, "1"))));
    this.setShadows(loadShadowQuality());
    this.setPerfProfile(load(PERF_KEY, PERF_PROFILES, DEFAULT_PERF_PROFILE));
    this.wispMode = parseWispMode(load("biblio.v1.treeWisp", ["perch", "follow"] as const, "perch"));
    try {
      this.worldClock.set(parseClock(localStorage.getItem(CLOCK_KEY)));
    } catch {
      /* keep the current clock */
    }
    this.dayDirty = true;
  }

  setWispMode(m: WispMode): void {
    this.wispMode = m;
    save("biblio.v1.treeWisp", m);
    this.wispGuide = null; // a mode switch calls it back
  }

  toggleWispMode(): void {
    this.setWispMode(this.wispMode === "perch" ? "follow" : "perch");
  }

  /** Where a note is in this world: its leaf (or the base of its folder's branch), as a surface point; null when it is not here. */
  locate(noteId: string): { b: string; s: number; th: number; leafId?: string; p: { x: number; y: number; z: number } } | null {
    const leaf = this.leaves.find((l) => l.id === noteId);
    if (leaf) {
      const b = this.world.branches.get(leaf.branchId);
      if (!b) return null;
      return { b: leaf.branchId, s: leaf.s, th: leaf.th, leafId: leaf.id, p: surfacePoint(b, leaf.s, leaf.th, 6).p };
    }
    const b = this.world.branches.get(noteId);
    if (b && !b.silk && !b.root) {
      const s = Math.min(b.total * 0.5, 40 + b.r);
      return { b: b.id, s, th: 0, p: surfacePoint(b, s, 0, 6).p };
    }
    return null;
  }

  /** Walk to a note by itself (leaf: stops beside it; the reader is not opened). False when the note is not in the tree. */
  walkToNote(noteId: string): boolean {
    const at = this.locate(noteId);
    if (!at) return false;
    this.startPilot({ b: at.b, s: at.s, th: at.th, leafId: at.leafId });
    return true;
  }

  /** The wisp flies to the note and hovers beside it with a beam of light. False when the note is not in the tree. */
  lightNote(noteId: string): boolean {
    const at = this.locate(noteId);
    if (!at) return false;
    this.wispGuide = { leafId: noteId, p: at.p };
    this.guideNear = 0;
    return true;
  }

  get wispGuiding(): boolean {
    return this.wispGuide !== null;
  }

  /** Replace the world (and its leaves), e.g. after the vault changed. */
  setWorld(world: World, leaves: Leaf[], startBranch: string, startS: number, titles?: ReadonlyMap<string, string>): void {
    this.world = world;
    this.leaves = leaves;
    this.leafIdx = buildLeafIndex(world, leaves, VOX * 3);
    if (titles) this.titles = titles;
    this.refreshShrine();
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
    this.refreshShrine();
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
    window.clearTimeout(this.silkTimer);
    this.saveSilks();
    cancelAnimationFrame(this.raf);
    for (const [t, f] of this.listeners) window.removeEventListener(t, f);
    for (const [t, f] of this.elListeners) this.renderer.domElement.removeEventListener(t, f);
    for (const m of [this.hoverMarker, this.goalMarker]) {
      m.material.map?.dispose();
      m.material.dispose();
    }
    this.labels.clear();
    this.silkLines.geometry.dispose();
    (this.silkLines.material as THREE.Material).dispose();
    this.previewDots.geometry.dispose();
    (this.previewDots.material as THREE.Material).dispose();
    this.previewDots.dispose();
    this.reticle.material.map?.dispose();
    this.reticle.material.dispose();
    this.wisp.material.map?.dispose();
    this.wisp.material.dispose();
    this.wispBeam.geometry.dispose();
    (this.wispBeam.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.wispBeam.material as THREE.Material).dispose();
    this.foliage.dispose();
    this.shadows.dispose();
    this.contact.dispose();
    this.foliageDepth.dispose();
    disposeGroup(this.worldGroup);
    disposeGroup(this.creatureGroup);
    this.sky.dispose();
    this.wispLamp.dispose();
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

  // ---- mouse: hover, click to walk, drag to orbit --------------------------------------

  /** Pixel position inside the view -> what is under it (a leaf or a branch surface), or null. */
  pickAtPixel(x: number, y: number): Pick | null {
    const el = this.renderer.domElement;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
    return pickAt(this.world, this.leafIdx, toV(this.raycaster.ray.origin), toV(this.raycaster.ray.direction));
  }

  /** Is the pixel on the wisp's glow? */
  overWisp(x: number, y: number): boolean {
    const w = this.screenOf(this.wispPos);
    const cs = Math.max(0.4, this.camScale);
    const d = this.camera.position.distanceTo(this.wisp.position);
    const r = Math.max(16, (34 * cs * 0.6 * (this.renderer.domElement.clientHeight || 1)) / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * Math.max(1, d)));
    return wispHit(x, y, w, r);
  }

  /** A world point -> pixel position inside the view (null when it is behind the camera). For the tests and the HUD. */
  screenOf(p: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const v = T3(p).project(this.camera);
    if (v.z < -1 || v.z > 1) return null;
    const el = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * (el.clientWidth || 1), y: ((1 - v.y) / 2) * (el.clientHeight || 1) };
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    const { x, y } = this.local(e);
    this.pointer = { down: true, button: e.button, x, y, sx: x, sy: y, moved: false };
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* (synthetic events have no active pointer) */
    }
  }

  private pointerMove(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const p = this.pointer;
    if (p.down) {
      if (Math.hypot(x - p.sx, y - p.sy) > 5) p.moved = true;
      // mouse camera: right-drag, or a left-drag that is more than a click, orbits the animal
      if (this.camMode === "mouse" && this.enabled && (p.button === 2 || (p.button === 0 && p.moved))) this.orbit(x - p.x, y - p.y);
      p.x = x;
      p.y = y;
      this.hover = null;
      return;
    }
    p.x = x;
    p.y = y;
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.hoverAt < 100) return;
    this.hoverAt = now;
    this.hoverWisp = this.overWisp(x, y);
    if (this.hoverWisp) {
      this.hover = null;
      return;
    }
    const hit = this.pickAtPixel(x, y);
    if (!hit) {
      this.hover = null;
      return;
    }
    const title = (hit.kind === "leaf" ? hit.leaf.title : this.titles.get(hit.b)) ?? "";
    this.hover = { x, y, pick: hit, title };
  }

  private pointerUp(e: PointerEvent): void {
    const p = this.pointer;
    p.down = false;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!this.enabled || e.button !== 0 || p.moved) return;
    const { x, y } = this.local(e);
    if (this.overWisp(x, y)) {
      this.onPad?.("wisp"); // a click on the wisp is the search
      return;
    }
    const hit = this.pickAtPixel(x, y);
    if (!hit) {
      this.cancelPilot();
      return;
    }
    if (hit.kind === "leaf") this.startPilot({ b: hit.leaf.branchId, s: hit.leaf.s, th: hit.leaf.th, leafId: hit.leaf.id });
    else this.startPilot({ b: hit.b, s: hit.s, th: hit.th });
  }

  /**
   * Run the simulation (and a click-to-walk pilot) for `seconds` WITHOUT rendering: the same `input()` + `step()` the frame loop uses, in
   * 1/60 s steps. For tests and tools: in software GL a frame takes seconds, so waiting for a walk to finish in real time is hopeless.
   */
  advance(seconds: number): void {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      step(this.world, this.creature, this.input(dt), dt);
      if (!this.pilot && t > 0.5 && !this.creature.air) break; // (a finished walk: the rest would only idle)
    }
  }

  /** Drag the mouse camera round the animal (pixels moved). */
  orbit(dx: number, dy: number): void {
    this.orbitYaw -= dx * 0.006;
    this.orbitPitch = Math.max(-1.35, Math.min(1.4, this.orbitPitch + dy * 0.006));
  }

  /** Walk to a spot on a branch by itself (same keys a player would press; any key press stops it). Works in guided movement: the animal is switched to it for the walk. */
  startPilot(goal: Goal): void {
    const c = this.creature;
    if (this.pilot) this.endPilot("cancelled", "new goal");
    if (c.flight) {
      this.onWalkEnd?.("failed", "fliers cannot be walked: land first");
      return;
    }
    this.pilot = new Autopilot(goal);
    this.onGame?.({ kind: "walkTo" });
    this.pilotRead = false;
    if (c.moveMode !== "guided") {
      this.pilotRestore = c.moveMode;
      c.moveMode = "guided";
      c.omega = 0;
      c.swing = 0;
    }
    const b = this.world.branches.get(goal.b);
    if (b) {
      this.goalMarker.position.copy(T3(surfacePoint(b, goal.s, goal.th, 8).p));
      this.goalMarker.visible = true;
    }
  }

  cancelPilot(): void {
    if (this.pilot) this.endPilot("cancelled", "stopped");
  }

  private endPilot(status: PilotStatus | "cancelled", reason: string): void {
    const pil = this.pilot;
    this.pilot = null;
    this.goalMarker.visible = false;
    if (this.pilotRestore) {
      this.creature.moveMode = this.pilotRestore;
      this.creature.omega = 0;
      this.creature.swing = 0;
      this.pilotRestore = null;
    }
    if (status === "arrived" && pil?.goal.leafId && this.pilotRead) {
      const leaf = this.leaves.find((l) => l.id === pil.goal.leafId);
      if (leaf) this.onInteract?.(leaf);
    }
    this.pilotRead = false;
    this.onWalkEnd?.(status, reason);
  }

  /** Keep a camera position out of the wood of the branch the animal is on and its neighbours (the mouse camera can go anywhere). */
  private pushOutOfBark(pos: THREE.Vector3): void {
    const b = this.world.branches.get(this.creature.head.b);
    if (!b) return;
    const near = [b, b.parent ? this.world.branches.get(b.parent) : undefined, ...b.next.map((id) => this.world.branches.get(id)), ...b.side.map((id) => this.world.branches.get(id))];
    for (const br of near) {
      if (!br || br.silk) continue;
      const n = nearestOnBranch(br, toV(pos));
      const f = frameAt(br, n.s);
      const r = radiusAt(br, n.s) + 14;
      if (n.dist < r) {
        const away = pos.clone().sub(T3(f.p));
        if (away.lengthSq() < 1e-6) away.set(0, 1, 0);
        pos.copy(T3(f.p)).addScaledVector(away.normalize(), r);
      }
    }
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
    if (k === "c") cutThread(this.world, this.creature); // snip the thread you stand on / the rope you hang from
    if (k === "h") this.toggleAutoAlign();
    if (k === "m") this.toggleMoveMode();
    if (k === "l") this.toggleLook();
    if (k === "f") this.toggleFoliage();
    if (k === "k") this.cycleShadows();
    if (k === "p") this.setPixelated(!this.pixelated);
    if (k === "i") this.togglePerfOverlay();
    if (k === "escape") this.cancelPilot();
    if (k === "+" || k === "=") this.zoom(1 / 1.2);
    if (k === "-" || k === "_") this.zoom(1.2);
    if (k === "e") {
      const near = this.nearestLeaf();
      const pad = this.nearestPad();
      // standing right at a pad means the pad; otherwise a leaf within reach wins, then any pad in range
      if (pad && (pad.k <= 0.6 || !near)) this.onPad?.(pad.pad.id);
      else if (near) this.onInteract?.(near);
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
      this.cloudMat = null;
      this.clouds?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
        if (m && m.isMeshLambertMaterial) this.cloudMat = m;
      });
      this.dayDirty = true;
    }
    this.barkGroup.add(buildBark(this.world, this.look, this.ground));
    tagShadows(this.barkGroup, true, true);
    this.rebuildLeaves();
    this.rebuildFoliage();
    this.rebuildShrine();
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

  private input(dt: number): Input {
    if (!this.enabled) return NO_INPUT;
    const k = this.keys;
    if (this.pilot) {
      // any movement / action key takes over at once; otherwise the pilot presses the keys
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "x"].some((x) => k.has(x))) this.endPilot("cancelled", "keys");
      else {
        const piloted = this.pilot.step(this.world, this.creature, dt);
        if (this.pilot.status !== "walking") this.endPilot(this.pilot.status, this.pilot.reason);
        this.leapQueued = false;
        this.silkQueued = false;
        return piloted;
      }
    }
    const input: Input = {
      forward: k.has("w") || k.has("arrowup"),
      back: k.has("s") || k.has("arrowdown"),
      left: k.has("a") || k.has("arrowleft"),
      right: k.has("d") || k.has("arrowright"),
      leap: this.leapQueued,
      reach: k.has(" "),
      climb: k.has("shift"),
      silk: this.silkQueued,
      drop: k.has("x"),
    };
    if (this.camMode === "mouse") {
      // the free camera steers reach, jump aim, flight and the swing: hand the sim the direction it looks along
      const d = this.camera.getWorldDirection(this.lookDir);
      input.aimDir = { x: d.x, y: d.y, z: d.z };
    }
    this.leapQueued = false;
    this.silkQueued = false;
    return input;
  }

  /** Report what the player did this frame (distance in metres, entering a branch, a leap or take-off). Silent while a panel has the scene disabled. */
  private trackGame(): void {
    const c = this.creature;
    const dD = c.D - this.gameD;
    this.gameD = c.D;
    const b = c.head.b;
    const airborne = !!(c.flight || (c.air && !c.air.slip));
    const sink = this.onGame;
    if (!sink || !this.enabled || dD < 0) {
      // (a new creature starts its trail at D = 0: a respawn / moveToPad / animal change is a teleport, not walking, and enters nothing)
      this.gameBranch = b;
      this.gameAir = airborne;
      return;
    }
    if (dD > 0 && dD < 400) {
      this.gameAcc += dD / 20; // 20 world units = 1 m
      if (this.gameAcc >= 1) {
        const m = Math.floor(this.gameAcc);
        this.gameAcc -= m;
        sink({ kind: "distance", m });
      }
    }
    if (b !== this.gameBranch) {
      const from = this.gameBranch;
      this.gameBranch = b;
      if (from) {
        const to = this.world.branches.get(b);
        sink({ kind: "enter", up: !!to && to.parent === from && !to.silk });
      }
    }
    if (airborne && !this.gameAir) sink({ kind: "leap" });
    this.gameAir = airborne;
  }

  private frame(now: number): void {
    this.frameCount++;
    const cpu0 = performance.now();
    const frameMs = this.lastRender > 0 ? now - this.lastRender : 0;
    this.lastRender = now;
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); // (never negative: the first frame's rAF timestamp can predate `last`, and a negative step drained the grip)
    this.last = now;
    const t = now / 1000;
    step(this.world, this.creature, this.input(dt), dt);
    this.trackGame();
    this.rig.update(this.world, this.creature, t, this.look);
    this.updateCamera(dt);
    this.updateDay(now);
    WIND.value = t % 600; // (a small number keeps the float32 shader clock precise)
    if (this.clouds) this.clouds.rotation.y = t * 0.0012; // (the clouds stand in the world and drift slowly round it: flying up among them has parallax)
    const head = this.creature.flight ? this.creature.flight.p : bodyPoint(this.creature, 0).p;
    const headV = T3(head);
    const cs = Math.max(0.4, this.camScale);
    this.wispPos = wispStep(this.wispPos, wispTarget({ mode: this.wispMode, perch: this.shrine?.perch ?? null, head, camScale: this.camScale, t, guide: this.wispGuide?.p ?? null }), dt);
    this.wisp.position.set(this.wispPos.x, this.wispPos.y, this.wispPos.z);
    this.wisp.scale.set(34 * cs, 34 * cs, 1);
    this.updateGuide(dt);
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
    if (silkVersion() !== this.silkSaved && !this.silkTimer) this.silkTimer = window.setTimeout(() => this.saveSilks(), 1500);
    this.updateMarkers();
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
      const ct = climbTarget(this.world, c);
      this.hudClimb = ct?.id ?? null;
      this.hudClimbDown = !!ct && ct.root === true && ct.parent === c.head.b; // a ground root at the stump's foot: entered walking DOWN (the star junction)
      this.hudClimbAuto = !!ct && !ct.silk && (!ct.root || this.hudClimbDown);
      this.hudPad = this.nearestPad()?.pad ?? null;
      if (this.hoverWisp && !this.overWisp(this.pointer.x, this.pointer.y)) this.hoverWisp = false; // the wisp flew away from under a pointer that did not move
    }
    this.onHud?.({
      animal: c.animal.name, animalId: c.animal.id, flying: !!c.flight, aiming: !!c.aim, dangling: !!c.silk, canSilk: !!c.animal.silk, autoAlign: c.autoAlign, moveMode: c.moveMode, labels: this.labelMode, foliage: this.foliageOn, foliageDensity: this.foliageDensity, shadows: this.shadows.quality, branch: c.head.b, th: c.head.th, phi: c.phi, grip: c.grip, gripOn: c.gripOn,
      airborne: !!c.air, reaching: !!c.reach, chase: this.chase, camera: this.camMode, look: this.look,
      nearLeaf: this.hudNear, climb: this.hudClimb, climbAuto: this.hudClimbAuto, climbDown: this.hudClimbDown,
      perfProfile: this.perfProfile, perf: this.perfOverlay ? this.stats : null,
      walking: !!this.pilot,
      pad: this.hudPad ? { id: this.hudPad.id, label: this.hudPad.label } : null,
      wispMode: this.wispMode, wispGuiding: this.wispGuide !== null, hoverWisp: this.hoverWisp, hour: this.day.hours, clock: this.worldClock.state,
      hover: this.hover && this.hover.title ? { title: this.hover.title, leaf: this.hover.pick.kind === "leaf", id: this.hover.pick.kind === "leaf" ? this.hover.pick.leaf.id : undefined, x: this.hover.x, y: this.hover.y } : null,
    });
  }

  /** The beam over the leaf the wisp was sent to, and letting it go once the animal has stood there a while. */
  private updateGuide(dt: number): void {
    const g = this.wispGuide;
    this.wispBeam.visible = !!g;
    if (!g) return;
    const cs = Math.max(0.4, this.camScale);
    this.wispBeam.position.set(g.p.x, g.p.y + 330 * cs, g.p.z);
    this.wispBeam.scale.set(26 * cs, 660 * cs, 1);
    this.wispBeam.rotation.y = Math.atan2(this.camera.position.x - g.p.x, this.camera.position.z - g.p.z);
    const h = this.creature.flight?.p ?? bodyPoint(this.creature, 0).p;
    if (Math.hypot(h.x - g.p.x, h.y - g.p.y, h.z - g.p.z) < 130) this.guideNear += dt;
    else this.guideNear = Math.max(0, this.guideNear - dt);
    if (this.guideNear > 6) this.wispGuide = null; // you found it: the wisp goes home (or back to following)
  }

  /** The ring under the pointer (what a click would walk to) and the ring on the goal of a walk, kept a readable size on screen. */
  private updateMarkers(): void {
    const h = this.hover;
    this.hoverMarker.visible = !!h && !this.pointer.down;
    if (h && this.hoverMarker.visible) {
      this.hoverMarker.position.copy(T3(h.pick.p));
      const k = Math.max(18, this.camera.position.distanceTo(this.hoverMarker.position) * 0.035);
      this.hoverMarker.scale.set(k, k, 1);
    }
    if (this.goalMarker.visible) {
      const k = Math.max(20, this.camera.position.distanceTo(this.goalMarker.position) * 0.04) * (1 + 0.12 * Math.sin(performance.now() / 180));
      this.goalMarker.scale.set(k, k, 1);
    }
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
    this.contact.update(!this.shadows.active, head.x, head.z, this.ground, head.y - this.ground, this.lenVal * 0.8, this.look === "voxel" ? 2 : 4);
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
        this.levelYaw += c.moveMode === "guided" ? Math.max(-3.4 * dt, Math.min(3.4 * dt, turn)) : turn; // (guided: never faster than 3.4 rad/s)
      }
      const back = new THREE.Vector3(Math.cos(this.levelYaw), 0, Math.sin(this.levelYaw));
      wantPos = head.clone().addScaledVector(back, -250 * this.zoomMul * this.camScale);
      wantPos.y += 130 * this.zoomMul * this.camScale;
    } else if (this.camMode === "mouse") {
      // orbit: the camera sits at (yaw, pitch) round the animal, world up stays up; dragging the mouse changes the angles
      const cp = Math.cos(this.orbitPitch);
      const dist = 330 * this.zoomMul * this.camScale;
      wantPos = head.clone().add(new THREE.Vector3(Math.cos(this.orbitYaw) * cp, Math.sin(this.orbitPitch), Math.sin(this.orbitYaw) * cp).multiplyScalar(dist));
      this.pushOutOfBark(wantPos);
    } else {
      wantPos = head.clone().add(new THREE.Vector3(0, -30 * this.zoomMul * this.camScale, 470 * this.zoomMul * this.camScale));
    }
    wantPos.y = Math.max(wantPos.y, floor);
    const k = Math.min(1, dt * (this.camMode === "mouse" ? 12 : 4));
    this.camPos.lerp(wantPos, k);
    this.camUp.lerp(up, k).normalize();
    this.camLook.lerp(head, Math.min(1, dt * 7));
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camLook);
  }
}

// ---- helpers ----------------------------------------------------------------------
