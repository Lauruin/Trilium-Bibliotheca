/**
 * game/BibliothecaScene.ts — the walkable library.
 *
 * One room in the world at a time. A room is built fresh from the domain
 * model (lib/library.ts) on every entry, which means the world can never
 * drift from the vault: destroy + rebuild is cheap (a room is a few dozen
 * static objects) and always correct. Navigation between rooms happens
 * through doors (interact), not through physical adjacency — the "recursive
 * room/door model" of game-ui.md at any tree depth.
 *
 * Overview mode (O key / HUD button): the camera zooms out to show all
 * rooms as labelled blocks on the grid. Rooms can be dragged to new cells —
 * dropping one emits `layout:move`, which the React side persists as
 * biblio_x/biblio_y labels (lib/layout.ts). Clicking a block enters it.
 *
 * The player is keyboard-driven for v1 (←→/AD move, Space/W jump, E interact,
 * O overview). Touch controls are a documented non-goal for this increment.
 */

import Phaser from "phaser";
import { LABELS, NPC } from "../config";
import { buildRoomContents } from "../lib/library";
import { packCases, spineWidth, type PackedCase } from "../lib/shelving";
import { DEFAULT_THEME, resolveTheme, type Theme } from "./themes";
import { AUTO, EMPTY, FLOOR_WIDTH, parseCase, parseSpan, WALL_SLOT_STRIDE, WALL_SLOT_X0, isFloorKind, isWallKind, parseCsv, parseRug, slotsOf, wallSlotCount } from "./decor";
import { ASSET_KEYS, registerBuiltInPack } from "./textures";
import { bus } from "./events";
import type { Book, LibraryTree, RoomContents, RoomPlacement } from "../types";

/** Room dimensions in world pixels. 16px tiles, retro 480×270 screen. */
const ROOM_W = 640;
const ROOM_H = 270;
/** Floor top edge — where the player's feet are. */
const FLOOR_Y = ROOM_H - 64;
/** Max doors rendered per room (more get a "+N doors" note). */
const MAX_DOORS = 10;
/** Horizontal distance between neighbouring doors. */
const DOOR_STRIDE = 44;
/** Max bookcases rendered per room, incl. the "unfiled" case (more tags aren't drawn). */
const MAX_SHELVES = 12;
/** Bookcase geometry (matches the 56×64 texture, see textures.ts). */
const CASE_W = 56;
const CASE_H = 64;
const CASE_STRIDE = 60;
/** Space between a case's outer edge and where spines may stand. */
const CASE_PAD = 5;
const CASE_X0 = 72; // left edge of the first bookcase
/** Y of the plank tops books stand on, per tier (world coords). */
const TIER_Y = [FLOOR_Y - CASE_H + 22, FLOOR_Y - CASE_H + 42, FLOOR_Y - CASE_H + 61];
/** Max book spines per tier (more fall to the next tier, then "+N"). */
const TIER_MAX_H = [16, 16, 14];
/**
 * Overview never zooms out past this: the canvas is only 480×270 logical
 * pixels, so below ~0.3 room names turn to mush. Bigger vaults pan instead.
 */
const OVERVIEW_MIN_ZOOM = 0.3;
/** Interact radius: player centre → object centre. Generous on purpose —
 * the world-bounds wall can stop the player ~40px short of a door. */
const INTERACT_RANGE = 46;

/** Key groups — several physical keys map to one action. */
interface KeyGroups {
  left: Phaser.Input.Keyboard.Key[];
  right: Phaser.Input.Keyboard.Key[];
  jump: Phaser.Input.Keyboard.Key[];
  interact: Phaser.Input.Keyboard.Key[];
  overview: Phaser.Input.Keyboard.Key[];
  up: Phaser.Input.Keyboard.Key[];
}

/** An interactable world object with what to do when activated. */
interface Interactable {
  /** Rectangle or sprite — anything with x/y that can carry pointer input. */
  obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  kind: "book" | "door" | "exit" | "wisp" | "socrates";
  payload: { noteId?: string };
  /** Floating hint text shown when this is the nearest target. */
  hint: string;
}

/**
 * World data handed over from React (`scene:load-world`). The scene treats
 * it as immutable input; all writes (layout moves) go back through events.
 */
export interface WorldData {
  tree: LibraryTree;
  placements: Map<string, RoomPlacement>;
  rootNoteId: string;
}

export class BibliothecaScene extends Phaser.Scene {
  /** The one live scene instance; static bus handlers forward to it. */
  private static current: BibliothecaScene | null = null;

  private world: WorldData | null = null;
  /** React sets this while a modal is open — keys must not act then. */
  private paused = false;

  // --- runtime state -------------------------------------------------------
  private player!: Phaser.Physics.Arcade.Sprite;
  private currentRoomId: string | null = null;
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  private interactables: Interactable[] = [];
  private staticBodies!: Phaser.Physics.Arcade.StaticGroup;
  private hint!: Phaser.GameObjects.Text;
  private nearest: Interactable | null = null;
  private overviewOn = false;
  private overviewObjects: Phaser.GameObjects.GameObject[] = [];
  /** Child room id → x of its door in the current room (for arriving from below). */
  private doorX = new Map<string, number>();
  /**
   * Width of the CURRENT room. Rooms grow with their contents (more bookcases
   * and doors → wider) so nothing is silently dropped; overview cells stay ROOM_W.
   */
  private roomW = ROOM_W;
  /** Theme the current room is drawn with (resolved from labels, or the live preview). */
  private theme: Theme = DEFAULT_THEME;
  /**
   * Build-mode preview: label overrides for the CURRENT room, applied while it
   * is drawn and never written (null value = pretend the label is absent).
   */
  private previewLabels: Record<string, string | null> | null = null;
  private socratesX = ROOM_W - 36 - 3 * DOOR_STRIDE - 14;
  private vignette!: Phaser.GameObjects.Image;
  /** roomId → parent roomId, rebuilt on every world load. */
  private parentOf = new Map<string, string>();

  /** noteIds from root to roomId (inclusive), for the breadcrumb. */
  private pathFromRoot(roomId: string): string[] {
    const path: string[] = [];
    let cur: string | null = roomId;
    const guard = new Set<string>(); // clones could cycle — never loop forever
    while (cur !== null && !guard.has(cur)) {
      guard.add(cur);
      path.unshift(cur);
      cur = this.parentOf.get(cur) ?? null;
    }
    return path;
  }

  private keys!: KeyGroups;
  /** Actions currently held via on-screen touch buttons (see ui/TouchControls). */
  private touch = new Set<string>();
  /** Touch actions pressed since the last frame (edge-triggered like JustDown). */
  private touchPressed = new Set<string>();
  /** Extra keys used only for panning the overview (W/↑ are jump keys in a room). */
  private upKeys: Phaser.Input.Keyboard.Key[] = [];
  private downKeys: Phaser.Input.Keyboard.Key[] = [];

  constructor() {
    super("bibliotheca");
  }

  create(): void {
    registerBuiltInPack(this);

    this.physics.world.setBounds(0, 0, ROOM_W, ROOM_H);
    this.cameras.main.setBounds(0, 0, ROOM_W, ROOM_H);
    this.cameras.main.setBackgroundColor("#0e0d16");

    // Player sprite exists across room rebuilds; only the room changes.
    this.player = this.physics.add.sprite(ROOM_W / 2, FLOOR_Y, ASSET_KEYS.player);
    this.player.setOrigin(0.5, 1);
    this.player.setDepth(50);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(10, 17);
    body.setCollideWorldBounds(true);

    // Floating interaction hint (above the nearest target).
    this.hint = this.add
      .text(0, 0, "", {
        fontFamily: "ui-monospace, monospace",
        fontSize: "9px",
        color: "#f0e2c0",
        backgroundColor: "#14101ccc",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(100)
      .setVisible(false);

    // Camera-fixed dark edges: the cheapest big step towards "lit by candles".
    this.vignette = this.add
      .image(0, 0, ASSET_KEYS.vignette)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(90);

    this.staticBodies = this.physics.add.staticGroup();
    this.physics.add.collider(this.player, this.staticBodies);

    // --- keyboard: WASD + arrows both work -----------------------------------
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    // addKey's 2nd argument is `enableCapture`: it defaults to TRUE, which
    // preventDefault()s the key on the whole page — letters like a/d/e/w/o and
    // space then can't be typed into React inputs (capture, search). So capture
    // is off for every key, and the global capture list is cleared. React also
    // pauses the scene while a modal is open (`scene:paused`).
    const key = (code: number): Phaser.Input.Keyboard.Key => kb.addKey(code, false);
    this.keys = {
      left: [key(K.A), key(K.LEFT)],
      right: [key(K.D), key(K.RIGHT)],
      jump: [key(K.SPACE), key(K.W), key(K.UP)],
      interact: [key(K.E), key(K.ENTER)],
      overview: [key(K.O)],
      up: [key(K.Q), key(K.BACKSPACE)],
    };
    kb.disableGlobalCapture();
    this.upKeys = [key(K.W), key(K.UP)];
    this.downKeys = [key(K.S), key(K.DOWN)];

    // Overview panning: mouse wheel (shift = horizontal); arrows/WASD in update().
    this.input.on("wheel", (_p: Phaser.Input.Pointer, _o: unknown, dx: number, dy: number) => {
      if (!this.overviewOn || this.paused) return;
      const cam = this.cameras.main;
      cam.scrollX += dx / cam.zoom;
      cam.scrollY += dy / cam.zoom;
    });

    // Waiting room: before React hands over world data.
    this.add
      .text(ROOM_W / 2, ROOM_H / 2, "Bibliotheca\nwaiting for the vault…", {
        fontFamily: "ui-monospace, monospace",
        fontSize: "12px",
        color: "#8a8aa0",
        align: "center",
      })
      .setOrigin(0.5)
      .setName("waiting");

    // --- React → scene events ----------------------------------------------
    // Handlers live at MODULE level (registered once, below the class) and
    // forward to whichever scene instance is currently alive. Registering
    // per-create leaks: Phaser's destroy is deferred to its next step, so a
    // destroyed scene's handlers can outlive a replacement scene's
    // registration and then blow up on torn-down internals (seen under
    // React StrictMode).
    BibliothecaScene.current = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (BibliothecaScene.current === this) BibliothecaScene.current = null;
    });
    bus.emit("scene:ready", undefined); // the game starts lazily: React hands over the world when it has one
  }

  /**
   * Register the React → Phaser handlers exactly once (called at module
   * import). Events reach only the live instance — a destroyed scene can
   * never receive them (this was a real crash under StrictMode remounts).
   */
  static wireBus(): void {
    bus.on("scene:load-world", (payload) => {
      const scene = BibliothecaScene.current;
      if (!scene) return;
      scene.world = payload;
      scene.parentOf.clear();
      for (const e of payload.tree.edges) scene.parentOf.set(e.noteId, e.parentNoteId);
      scene.enterRoom(payload.rootNoteId);
    });
    bus.on("scene:enter-room", ({ noteId }) => {
      const scene = BibliothecaScene.current;
      if (scene?.world) scene.enterRoom(noteId);
    });
    bus.on("input:touch", ({ action, down }) => {
      const scene = BibliothecaScene.current;
      if (!scene) return;
      if (down) {
        scene.touch.add(action);
        scene.touchPressed.add(action);
      } else {
        scene.touch.delete(action);
      }
    });
    bus.on("build:preview", ({ labels }) => {
      const scene = BibliothecaScene.current;
      if (!scene) return;
      scene.previewLabels = labels;
      scene.redrawRoom();
    });
    bus.on("scene:redraw", () => BibliothecaScene.current?.redrawRoom());
    bus.on("scene:overview", ({ on }) => BibliothecaScene.current?.setOverview(on));
    bus.on("scene:paused", ({ on }) => {
      const scene = BibliothecaScene.current;
      if (!scene) return;
      scene.paused = on;
      // Keys pressed while paused must not fire as soon as the scene resumes
      // (Phaser's JustDown flags are only consumed in update()).
      scene.input.keyboard?.resetKeys();
      scene.touchPressed.clear();
      if (on) {
        // Halt the player so no key held before the pause carries over.
        const body = scene.player?.body as Phaser.Physics.Arcade.Body | undefined;
        if (body) body.setVelocityX(0);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Room building
  // ---------------------------------------------------------------------------

  /** Destroy the current room's objects (never the player). */
  private clearRoom(): void {
    // Tweens targeting objects that are about to be destroyed must go too, or
    // every redraw (preview keystroke, undo) leaks a set of running tweens.
    if (this.roomObjects.length > 0) this.tweens.killTweensOf(this.roomObjects);
    for (const o of this.roomObjects) o.destroy();
    this.roomObjects = [];
    this.interactables = [];
    this.nearest = null;
    bus.emit("focus:note", { noteId: null });
    this.hint.setVisible(false);
    // The static group owns its floor body — clearing destroys the child too,
    // so bodies are never double-destroyed with roomObjects.
    this.staticBodies.clear(true, true);
  }

  /**
   * Build and enter a room. `cameFrom` is the room we just left (when going
   * through a door): going down we arrive at the exit door, going back up we
   * arrive in front of the door we came through — never teleported to the middle.
   */
  private enterRoom(noteId: string, cameFrom?: string): void {
    const world = this.world;
    if (!world) return;
    if (world.tree.notes[noteId] === undefined) {
      bus.emit("notice", { level: "error", text: `Unknown room ${noteId}` });
      return;
    }
    let contents: RoomContents;
    try {
      contents = buildRoomContents(world.tree, noteId);
    } catch (err) {
      bus.emit("notice", { level: "error", text: `Could not build room: ${String(err)}` });
      return;
    }

    // Leaving overview mode (if on) — this method doubles as its exit path.
    this.overviewObjects.forEach((o) => o.destroy());
    this.overviewObjects = [];
    this.overviewOn = false;

    // First real room replaces the "waiting" placeholder.
    const waiting = this.children.getByName("waiting");
    if (waiting) waiting.destroy();

    this.clearRoom();
    this.currentRoomId = noteId;
    this.previewLabels = null; // a preview never survives leaving its room
    this.drawRoom(contents, noteId);
    this.placePlayerAtEntrance(contents, cameFrom);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.roomW, ROOM_H);
    cam.setZoom(1);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.centerOn(this.player.x, this.player.y); // no slow pan from the old room's spot
    cam.fadeIn(220, 14, 13, 22);
    this.vignette.setVisible(true);

    bus.emit("hud:state", {
      path: this.pathFromRoot(noteId),
      roomCount: world.placements.size,
      overview: false,
    });
  }

  /**
   * Draw everything of a room except the player and camera: sizes the room,
   * resolves the theme, builds shell, bookcases, doors, NPCs and furniture.
   * Shared by enterRoom and redrawRoom (theme preview / undo), so both always
   * agree on how a room looks.
   */
  private drawRoom(contents: RoomContents, noteId: string): void {
    const cases = packCases(contents, { innerW: CASE_W - 2 * CASE_PAD, tiers: TIER_Y.length, maxCases: MAX_SHELVES });
    const nCases = cases.length;
    const nDoors = Math.min(MAX_DOORS, contents.doors.length);
    this.withPreview(noteId, () => {
      // Sizing reads labels (biblio_span), so it lives inside the preview scope too.
      const span = parseSpan(this.roomLabels(noteId)[LABELS.span]);
      this.roomW = Math.max(ROOM_W, CASE_X0 + nCases * CASE_STRIDE + 100 + nDoors * DOOR_STRIDE + 50) + span * WALL_SLOT_STRIDE;
      this.socratesX = this.roomW - 36 - nDoors * DOOR_STRIDE - 14;
      this.physics.world.setBounds(0, 0, this.roomW, ROOM_H);
      this.cameras.main.setBounds(0, 0, this.roomW, ROOM_H);
      this.theme = this.world ? resolveTheme(this.world.tree, noteId) : DEFAULT_THEME;
      this.doorX.clear();
      this.drawShell(contents.title, noteId);
      const casesEnd = this.drawShelves(cases);
      this.drawDoors(contents);
      this.drawAmenities();
      const fit = this.drawFurniture(noteId, casesEnd);
      bus.emit("build:slots", { roomId: noteId, wallSlots: wallSlotCount(this.roomW), floorFit: fit.placed, floorHidden: fit.hidden });
    });
  }

  /** Labels of a room as the drawing code should see them (preview overrides included via withPreview). */
  private roomLabels(noteId: string): Record<string, string> {
    return this.world?.tree.notes[noteId]?.labels ?? {};
  }

  /** Run `draw` with the build-mode preview overrides temporarily applied to the room's labels. */
  private withPreview(noteId: string, draw: () => void): void {
    const labels = this.world?.tree.notes[noteId]?.labels;
    const over = this.previewLabels;
    if (!labels || !over) return draw();
    const saved = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(over)) {
      saved.set(name, labels[name]);
      if (value === null) delete labels[name];
      else labels[name] = value;
    }
    try {
      draw();
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete labels[name];
        else labels[name] = value;
      }
    }
  }

  /**
   * Rebuild the current room in place after its data or look changed (theme
   * preview, undo/redo). Unlike enterRoom it keeps the player, camera and
   * fade — no flash, no teleport.
   */
  private redrawRoom(): void {
    const world = this.world;
    const id = this.currentRoomId;
    if (!world || id === null || this.overviewOn || world.tree.notes[id] === undefined) return;
    let contents: RoomContents;
    try {
      contents = buildRoomContents(world.tree, id);
    } catch {
      return;
    }
    this.clearRoom();
    this.drawRoom(contents, id);
  }

  /** Back wall, wainscot, floor, rug, floor collider, wall decor and the room title. */
  private drawShell(title: string, roomId: string): void {
    const wall = this.add
      .tileSprite(this.roomW / 2, FLOOR_Y / 2, this.roomW, FLOOR_Y, ASSET_KEYS.tileWall)
      .setDepth(0);
    const wainscot = this.add
      .tileSprite(this.roomW / 2, FLOOR_Y - 14, this.roomW, 32, ASSET_KEYS.tileWainscot)
      .setDepth(1);
    const floor = this.add
      .tileSprite(this.roomW / 2, (FLOOR_Y + ROOM_H) / 2, this.roomW, ROOM_H - FLOOR_Y, ASSET_KEYS.tileFloor)
      .setDepth(2);
    const t = this.theme;
    this.roomObjects.push(wall, wainscot, floor);
    const rugStyle = parseRug(this.roomLabels(roomId)[LABELS.rug]);
    if (rugStyle !== "none") {
      const key = rugStyle === "moss" ? ASSET_KEYS.rugMoss : rugStyle === "navy" ? ASSET_KEYS.rugNavy : ASSET_KEYS.rug;
      this.roomObjects.push(this.add.image(this.roomW / 2, FLOOR_Y + 22, key).setDepth(3));
    }
    // Theme tints for the shell are translucent colour washes over each zone,
    // not sprite tints or blend modes: Phaser's Canvas renderer (the fallback
    // without WebGL) ignores setTint and doesn't blend Shapes with MULTIPLY.
    // Wash = the tint scaled down, at partial alpha: shifts hue, never brightens.
    const zone = (tint: number | null, y0: number, y1: number, depth: number): void => {
      if (tint === null) return;
      const dim = ((tint >> 16) & 0xff) * 0.55;
      const color = (Math.round(dim) << 16) | (Math.round(((tint >> 8) & 0xff) * 0.55) << 8) | Math.round((tint & 0xff) * 0.55);
      const r = this.add
        .rectangle(this.roomW / 2, (y0 + y1) / 2, this.roomW, y1 - y0, color, 0.45)
        .setDepth(depth);
      this.roomObjects.push(r);
    };
    zone(t.wall, 0, FLOOR_Y - 30, 1.2);
    zone(t.wainscot, FLOOR_Y - 30, FLOOR_Y, 1.2);
    zone(t.floor, FLOOR_Y, ROOM_H, 2.2);
    if (t.grade !== null) {
      // Colour grade over the whole room; depth 39 keeps the player (50) and the
      // plates/hints (60+) untinted.
      const grade = this.add
        .rectangle(this.roomW / 2, ROOM_H / 2, this.roomW, ROOM_H, t.grade.color, t.grade.alpha)
        .setDepth(39);
      this.roomObjects.push(grade);
    }

    // One-way floor collider. Owned by the static group (cleared with it);
    // NOT pushed to roomObjects, or clearRoom would destroy it twice.
    const floorBody = this.add.rectangle(this.roomW / 2, FLOOR_Y + 8, this.roomW, 16, 0, 0);
    this.physics.add.existing(floorBody, true);
    this.staticBodies.add(floorBody);

    this.drawWallDecor(roomId);

    // Room title plate.
    const plate = this.add
      .text(this.cameras.main.width / 2, 10, title, {
        fontFamily: "ui-monospace, monospace",
        fontSize: "13px",
        color: "#f0e2c0",
        backgroundColor: "#2a1c12dd",
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0) // stays on screen while the camera follows the player in wide rooms
      .setDepth(60);
    this.roomObjects.push(plate);
  }

  /**
   * Windows, paintings and candle sconces on the back wall, in a fixed rhythm
   * every 96px; which one lands where is a stable hash of the room id, so each
   * room has its own look but never changes between visits.
   */
  private drawWallDecor(roomId: string): void {
    const h = hashString(roomId);
    const n = wallSlotCount(this.roomW);
    const slots = slotsOf(this.roomLabels(roomId)[LABELS.wall], n);
    for (let i = 0; i < n; i++) {
      const x = WALL_SLOT_X0 + i * WALL_SLOT_STRIDE;
      let kind = slots[i];
      // `auto`, missing and unknown entries use the deterministic default.
      if (kind === AUTO || (kind !== EMPTY && !isWallKind(kind))) kind = (h + i * 7) % 3 === 1 ? "painting" : "window";
      if (kind === "painting") {
        this.roomObjects.push(this.add.image(x, 52, ASSET_KEYS.painting).setDepth(4));
      } else if (kind === "clock") {
        this.roomObjects.push(this.add.image(x, 54, ASSET_KEYS.clock).setDepth(4));
      } else if (kind === "banner") {
        this.roomObjects.push(this.add.image(x, 64, ASSET_KEYS.banner).setDepth(4));
      } else if (kind === "window") {
        const win = this.add.image(x, 52, ASSET_KEYS.window).setDepth(4);
        if (this.theme.glass !== null) win.setTint(this.theme.glass);
        const shaft = this.add
          .image(x + 12, 74, ASSET_KEYS.lightShaft)
          .setOrigin(0.5, 0)
          .setDepth(5)
          .setBlendMode(Phaser.BlendModes.ADD);
        if (this.theme.shaft !== null) shaft.setTint(this.theme.shaft);
        this.tweens.add({
          targets: shaft,
          alpha: { from: 0.7, to: 1 },
          duration: 2600 + (i % 3) * 500,
          yoyo: true,
          repeat: -1,
          ease: "Sine.InOut",
        });
        this.roomObjects.push(win, shaft);
      }
      // Candle sconce halfway to the next slot (always: it is lighting, not decor).
      this.addSconce(x + 48, 66);
    }
    this.addSconce(34, 60);

    // Slow drifting dust in the light, over the whole room.
    const dust = this.add.particles(0, 0, ASSET_KEYS.mote, {
      x: { min: 0, max: this.roomW },
      y: { min: 20, max: FLOOR_Y },
      lifespan: 6000,
      speedX: { min: -4, max: 4 },
      speedY: { min: -3, max: 2 },
      alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) * 0.55 },
      frequency: 260,
      blendMode: "ADD",
    });
    dust.setDepth(40);
    this.roomObjects.push(dust);
  }

  /** A wall candle: bracket + flickering flame + warm additive glow. */
  private addSconce(x: number, y: number): void {
    const glow = this.add
      .image(x, y - 4, ASSET_KEYS.glow)
      .setDepth(5)
      .setBlendMode(Phaser.BlendModes.ADD);
    const bracket = this.add.image(x, y, ASSET_KEYS.sconce).setDepth(6);
    const flame = this.add.image(x, y - 8, ASSET_KEYS.flame).setDepth(7);
    if (this.theme.flame !== null) {
      flame.setTint(this.theme.flame);
      glow.setTint(this.theme.flame);
    }
    this.tweens.add({
      targets: [flame, glow],
      alpha: { from: 0.8, to: 1 },
      scaleX: { from: 0.92, to: 1.08 },
      duration: 140 + ((x * 13) % 90),
      yoyo: true,
      repeat: -1,
    });
    this.roomObjects.push(glow, bracket, flame);
  }

  /**
   * Bookcases, left→right along the back wall (layout from lib/shelving.ts):
   * loose notes on the first case, "unfiled", then one case per tag, continuing
   * onto further cases when a tag has more books than one case holds. Returns
   * the x where the last case ends (furniture fills the free wall space after it).
   */
  private drawShelves(cases: PackedCase[]): number {
    let left = CASE_X0;
    for (const shelf of cases) {
      const cx = left + CASE_W / 2;
      const cy = FLOOR_Y - CASE_H / 2;
      const finish = parseCase(this.roomLabels(this.currentRoomId ?? "")[LABELS.bookcase]);
      const caseKey =
        finish === "walnut" ? ASSET_KEYS.bookcaseWalnut :
        finish === "ebony" ? ASSET_KEYS.bookcaseEbony :
        finish === "whitewash" ? ASSET_KEYS.bookcaseWhitewash : ASSET_KEYS.bookcase;
      const frame = this.add.image(cx, cy, caseKey).setDepth(20);
      this.roomObjects.push(frame);

      // Nameplate on the cornice: the tag, in the tag's colour.
      const tag = this.add
        .text(cx, FLOOR_Y - CASE_H - 3, shelf.tag, {
          fontFamily: "ui-monospace, monospace",
          fontSize: "9px",
          color: "#14101c",
          backgroundColor: shelf.color,
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(60);
      this.roomObjects.push(tag);

      for (const slot of shelf.slots) {
        const w = spineWidth(slot.book.title);
        this.drawSpine(slot.book, left + CASE_PAD + slot.x + w / 2, TIER_Y[slot.tier], TIER_MAX_H[slot.tier]);
      }
      if (shelf.overflow > 0) {
        const more = this.add
          .text(cx, FLOOR_Y - 2, `+${shelf.overflow} not shown`, {
            fontFamily: "ui-monospace, monospace",
            fontSize: "8px",
            color: "#f0e2c0",
            backgroundColor: "#14101ccc",
            padding: { x: 2, y: 0 },
          })
          .setOrigin(0.5, 1)
          .setDepth(60);
        this.roomObjects.push(more);
      }
      left += CASE_STRIDE;
    }
    return left;
  }

  /** One book spine standing on a plank: body, lit edge, and a title-keyed band. */
  private drawSpine(book: Book, cx: number, plankTopY: number, maxH: number): void {
    const w = spineWidth(book.title);
    const h = Math.min(10 + (book.title.length % 7), maxH);
    const color = Phaser.Display.Color.HexStringToColor(book.color).color;
    const spine = this.add
      .rectangle(cx, plankTopY - h / 2, w, h, color)
      .setStrokeStyle(1, 0x0e0d16, 0.9)
      .setDepth(21)
      .setInteractive({ useHandCursor: true });
    const lit = this.add
      .rectangle(cx - w / 2 + 1, plankTopY - h / 2, 1, h - 2, 0xffffff, 0.22)
      .setDepth(22);
    const band = this.add
      .rectangle(cx, plankTopY - 3 - (hashString(book.title) % 4), w, 1, 0xd8b868, 0.8)
      .setDepth(22);
    const group = [spine, lit, band];
    spine.on("pointerup", () => !this.paused && bus.emit("book:open", { noteId: book.noteId }));
    // Hover feedback: pull the book out a little.
    spine.on("pointerover", () => group.forEach((o) => (o.y -= 2)));
    spine.on("pointerout", () => group.forEach((o) => (o.y += 2)));
    this.roomObjects.push(...group);
    this.interactables.push({
      obj: spine,
      kind: "book",
      payload: { noteId: book.noteId },
      hint: `E · open "${truncate(book.title)}"`,
    });
  }

  /** Floor furniture (plant, globe, armchair) in the free space right of the last case. */
  private drawFurniture(roomId: string, casesEnd: number): { placed: number; hidden: number } {
    const defaults = ["plant", "armchair", "globe"] as const;
    const start = hashString(roomId) % defaults.length;
    const custom = parseCsv(this.roomLabels(roomId)[LABELS.furniture]);
    // No label → the three default pieces (rotating by room hash), as always.
    const entries: string[] = custom.length > 0 ? custom : defaults.map((_, i) => defaults[(start + i) % defaults.length]);
    const textureOf: Record<string, string> = {
      plant: ASSET_KEYS.plant, armchair: ASSET_KEYS.armchair, globe: ASSET_KEYS.globe, lamp: ASSET_KEYS.lamp,
      bust: ASSET_KEYS.bust, telescope: ASSET_KEYS.telescope, fireplace: ASSET_KEYS.fireplace,
    };
    let x = casesEnd + 8;
    let placed = 0;
    let hidden = 0;
    entries.forEach((entry, i) => {
      if (entry === EMPTY) {
        x += 24; // deliberate gap
        return;
      }
      const kind = isFloorKind(entry) ? entry : defaults[(start + i) % defaults.length];
      const w = FLOOR_WIDTH[kind];
      const cx = x + w / 2;
      if (cx + w / 2 > this.socratesX - 20) {
        hidden++; // no room: never dropped silently (the build panel shows a count)
        return;
      }
      const img = this.add.image(cx, FLOOR_Y + 1, textureOf[kind]).setOrigin(0.5, 1).setDepth(19);
      this.roomObjects.push(img);
      if (kind === "lamp" || kind === "fireplace") {
        const gy = kind === "lamp" ? FLOOR_Y - 26 : FLOOR_Y - 12;
        const glow = this.add.image(cx, gy, ASSET_KEYS.glow).setDepth(18).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: glow, alpha: { from: 0.75, to: 1 }, duration: 160 + ((cx * 7) % 90), yoyo: true, repeat: -1 });
        this.roomObjects.push(glow);
      }
      x += w + 10;
      placed++;
    });
    return { placed, hidden };
  }

  /** Doors into child rooms (right side) + exit door to the parent (left). */
  private drawDoors(contents: RoomContents): void {
    const doors = contents.doors.slice(0, MAX_DOORS);
    doors.forEach((door, i) => {
      // Right-wall row; staggered label heights keep the signs readable.
      const dx = this.roomW - 36 - i * DOOR_STRIDE;
      this.doorX.set(door.noteId, dx);
      const ly = FLOOR_Y - 36 - (i % 2) * 20;
      const sprite = this.add
        .sprite(dx, FLOOR_Y, ASSET_KEYS.door)
        .setOrigin(0.5, 1)
        .setDepth(20)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(dx, ly, truncate(door.title, 28), {
          fontFamily: "ui-monospace, monospace",
          fontSize: "8px",
          color: "#d8c8a0",
          backgroundColor: "#14101ccc",
          padding: { x: 2, y: 1 },
          align: "center",
          wordWrap: { width: 54 },
        })
        .setOrigin(0.5, 1)
        .setDepth(60);
      const from = contents.roomId;
      // Lintel pennant in the destination room's theme colours: you can tell
      // the wings apart from the doors before walking through.
      if (this.world) {
        const dest = resolveTheme(this.world.tree, door.noteId);
        if (dest.id !== DEFAULT_THEME.id) {
          const pennant = this.add.rectangle(dx, FLOOR_Y - 33, 14, 3, dim(dest.wall ?? 0x808080, 1.1)).setDepth(21);
          this.roomObjects.push(pennant);
        }
      }
      sprite.on("pointerup", () => !this.paused && this.enterRoom(door.noteId, from));
      this.roomObjects.push(sprite, label);
      this.interactables.push({
        obj: sprite,
        kind: "door",
        payload: { noteId: door.noteId },
        hint: `E · enter "${truncate(door.title, 12)}"`,
      });
    });
    if (contents.doors.length > MAX_DOORS) {
      const more = this.add
        .text(this.roomW - 36 - (MAX_DOORS - 1) * DOOR_STRIDE - 4, FLOOR_Y - 58, `+${contents.doors.length - MAX_DOORS} doors`, {
          fontFamily: "ui-monospace, monospace",
          fontSize: "8px",
          color: "#b8a878",
        })
        .setOrigin(0.5)
        .setDepth(60);
      this.roomObjects.push(more);
    }

    if (contents.parentNoteId !== null) {
      const parentId = contents.parentNoteId;
      const ex = this.add
        .sprite(28, FLOOR_Y, ASSET_KEYS.exitDoor)
        .setOrigin(0.5, 1)
        .setDepth(20)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(28, FLOOR_Y - 34, "⬆ up", {
          fontFamily: "ui-monospace, monospace",
          fontSize: "8px",
          color: "#e8cc88",
          backgroundColor: "#14101caa",
          padding: { x: 2, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(60);
      ex.on("pointerup", () => !this.paused && this.enterRoom(parentId, contents.roomId));
      this.roomObjects.push(ex, label);
      this.interactables.push({
        obj: ex,
        kind: "exit",
        payload: { noteId: parentId },
        hint: "E · back up one level",
      });
    }
  }

  /** Wisp (search) + Socrates (placeholder dialog) — the room's amenities. */
  private drawAmenities(): void {
    // Wisp floats above the shelf zone, bobbing.
    const wispX = this.roomW / 2 + 20;
    const wispY = FLOOR_Y - 100;
    const wisp = this.add
      .sprite(wispX, wispY, ASSET_KEYS.wisp)
      .setDepth(30)
      .setInteractive({ useHandCursor: true });
    const wispLabel = this.add
      .text(wispX, wispY - 14, NPC.wisp, {
        fontFamily: "ui-monospace, monospace",
        fontSize: "8px",
        color: "#bfe8ff",
      })
      .setOrigin(0.5)
      .setDepth(60);
    // Gentle idle bob for both sprite and label (same phase).
    this.tweens.add({
      targets: [wisp, wispLabel],
      y: "-=6",
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: "Sine.InOut",
    });
    wisp.on("pointerup", () => !this.paused && bus.emit("search:open", undefined));
    this.roomObjects.push(wisp, wispLabel);
    this.interactables.push({
      obj: wisp,
      kind: "wisp",
      payload: {},
      hint: "E · search the vault",
    });

    // Socrates: marble statue on a plinth, left zone beside the desk. Honest
    // placeholder — the intelligence service (chat/RAG) is a later plane.
    const socX = this.socratesX;
    const plinth = this.add.rectangle(socX, FLOOR_Y - 4, 24, 8, 0x3a3a4a).setDepth(19);
    const soc = this.add
      .sprite(socX, FLOOR_Y - 8, ASSET_KEYS.socrates)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setInteractive({ useHandCursor: true });
    const socLabel = this.add
      .text(socX, FLOOR_Y - 34, NPC.socrates, {
        fontFamily: "ui-monospace, monospace",
        fontSize: "8px",
        color: "#cdd3da",
      })
      .setOrigin(0.5)
      .setDepth(60);
    soc.on("pointerup", () => !this.paused && bus.emit("socrates:open", undefined));
    this.roomObjects.push(plinth, soc, socLabel);
    this.interactables.push({
      obj: soc,
      kind: "socrates",
      payload: {},
      hint: "E · talk to Socrates",
    });
  }

  /**
   * Where the player appears: in front of the door they just came through (a
   * child room's door when coming back up), beside the exit door when going
   * down or arriving by breadcrumb, or at the room's left edge at the root.
   */
  private placePlayerAtEntrance(contents: RoomContents, cameFrom?: string): void {
    let x = contents.parentNoteId !== null ? 56 : 52;
    const back = cameFrom !== undefined ? this.doorX.get(cameFrom) : undefined;
    if (back !== undefined) x = back - 18; // just left of the door, facing it
    this.player.setPosition(x, FLOOR_Y);
    (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
  }

  // ---------------------------------------------------------------------------
  // Overview (edit) mode
  // ---------------------------------------------------------------------------

  private setOverview(on: boolean): void {
    if (!this.world || on === this.overviewOn) return;
    this.overviewOn = on;

    if (on) {
      // Hide the room entirely: overview shows only the placement blocks.
      // (GameObjects all mix in Visible at runtime; the union type doesn't
      // know that, hence the narrow structural cast.)
      for (const o of this.roomObjects) {
        (o as unknown as { setVisible(v: boolean): void }).setVisible(false);
      }
      this.player.setVisible(false);
      this.vignette.setVisible(false);
      (this.player.body as Phaser.Physics.Arcade.Body).enable = false;
      this.hint.setVisible(false);
      this.buildOverview();
      bus.emit("hud:state", {
        path: this.currentRoomId ? this.pathFromRoot(this.currentRoomId) : [],
        roomCount: this.world.placements.size,
        overview: true,
      });
    } else {
      this.player.setVisible(true);
      (this.player.body as Phaser.Physics.Arcade.Body).enable = true;
      // Re-enter the current room to restore camera bounds, zoom and follow.
      if (this.currentRoomId) this.enterRoom(this.currentRoomId);
    }
  }

  /**
   * Build the overview: one labelled block per room at its grid position.
   * Blocks are draggable; dropping on a free cell moves the room (emitting
   * `layout:move`). A click without drag enters the room.
   */
  private buildOverview(): void {
    const world = this.world!;
    const { placements, tree } = world;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const p of placements.values()) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const wCells = maxX - minX + 1;
    const hCells = maxY - minY + 1;

    // Zoom to fit with margins; clamp so tiny vaults stay readable.
    const cam = this.cameras.main;
    const zoom = Phaser.Math.Clamp(
      Math.min(cam.width / (wCells * ROOM_W), cam.height / (hCells * ROOM_H)) * 0.9,
      OVERVIEW_MIN_ZOOM,
      1,
    );
    cam.stopFollow();
    cam.setZoom(zoom);
    const worldW = wCells * ROOM_W;
    const worldH = hCells * ROOM_H;
    const originX = minX * ROOM_W;
    const originY = minY * ROOM_H;
    cam.setBounds(originX, originY, worldW, worldH);
    // Start on the room we were in (or the library root), not the middle of nowhere.
    const focus = placements.get(this.currentRoomId ?? tree.rootNoteId) ?? placements.get(tree.rootNoteId);
    if (focus && zoom < 1) cam.centerOn(focus.x * ROOM_W + ROOM_W / 2, focus.y * ROOM_H + ROOM_H / 2);
    else cam.centerOn(originX + worldW / 2, originY + worldH / 2);

    for (const p of placements.values()) {
      const rx = p.x * ROOM_W;
      const ry = p.y * ROOM_H;
      const isRoot = p.noteId === tree.rootNoteId;

      // Text is sized in SCREEN pixels (divided by the zoom) so it stays readable
      // however far the overview is zoomed out.
      // Capped so a far-out zoom on a big vault can't make text overflow its box.
      const px = (screen: number, cap: number): string => `${Math.round(Math.min(screen / zoom, cap))}px`;
      let summary = "";
      try {
        const rc = buildRoomContents(tree, p.noteId);
        const books = rc.desk.length + rc.shelves.reduce((n, sh) => n + sh.books.length, 0);
        summary = `${books} note${books === 1 ? "" : "s"} · ${rc.doors.length} room${rc.doors.length === 1 ? "" : "s"}`;
      } catch {
        /* a room that can't be summarised still gets its title */
      }

      // Tile colour follows the room's effective theme, so wings read at a glance.
      const th = resolveTheme(tree, p.noteId);
      const themeFill = th.wall === null ? 0x3a2a1e : dim(th.wall, 0.42);
      const g = this.add.container(rx + ROOM_W / 2, ry + ROOM_H / 2);
      const box = this.add
        .rectangle(0, 0, ROOM_W - 24, ROOM_H - 24, themeFill, 0.96)
        .setStrokeStyle(Math.max(2, 3 / zoom), isRoot ? 0xd8b868 : 0x8a6a48);
      const title = this.add
        .text(0, -34, isRoot ? "Library" : truncate(tree.notes[p.noteId]?.title ?? p.noteId, 22), {
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: px(20, 44),
          color: "#f6e8c8",
          align: "center",
          wordWrap: { width: ROOM_W - 60 },
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(0, 22, summary, {
          fontFamily: "ui-monospace, monospace",
          fontSize: px(12, 34),
          color: "#d8c8a0",
        })
        .setOrigin(0.5);
      const mode = this.add
        .text(0, ROOM_H / 2 - 34, p.manual ? "placed" : "auto", {
          fontFamily: "ui-monospace, monospace",
          fontSize: px(11, 30),
          color: p.manual ? "#9ae89a" : "#a89a7a",
        })
        .setOrigin(0.5);
      g.add([box, title, sub, mode]);
      g.setSize(ROOM_W - 24, ROOM_H - 24);
      g.setInteractive({ draggable: true, useHandCursor: true });
      this.overviewObjects.push(g, box, title, sub, mode);

      // Distinguish click (enter) from drag (move) by pointer travel.
      let downAt: { x: number; y: number } | null = null;
      g.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
        downAt = { x: ptr.x, y: ptr.y };
      });
      g.on("pointerup", (ptr: Phaser.Input.Pointer) => {
        const moved =
          downAt && Phaser.Math.Distance.Between(downAt.x, downAt.y, ptr.x, ptr.y) >= 6;
        downAt = null;
        if (!moved) {
          this.setOverview(false);
          this.enterRoom(p.noteId);
        }
      });
      g.on("drag", (_ptr: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        g.x = dragX;
        g.y = dragY;
      });
      g.on("dragend", () => {
        const cellX = Math.round((g.x - ROOM_W / 2) / ROOM_W);
        const cellY = Math.round((g.y - ROOM_H / 2) / ROOM_H);
        const occupied = [...placements.entries()].some(
          ([id, q]) => id !== p.noteId && q.x === cellX && q.y === cellY,
        );
        if (occupied) {
          bus.emit("notice", {
            level: "warn",
            text: "That cell is occupied — room snapped back.",
          });
          g.setPosition(rx + ROOM_W / 2, ry + ROOM_H / 2);
          return;
        }
        if (p.x === cellX && p.y === cellY) return;
        p.x = cellX;
        p.y = cellY;
        p.manual = true;
        box.setStrokeStyle(2, 0x8ad88a);
        bus.emit("layout:move", { noteId: p.noteId, x: cellX, y: cellY });
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (this.paused || !this.world) return;

    if (this.overviewOn) {
      const cam = this.cameras.main;
      const step = (420 * delta) / 1000 / cam.zoom;
      if (anyDown(this.keys.left)) cam.scrollX -= step;
      if (anyDown(this.keys.right)) cam.scrollX += step;
      if (this.upKeys.some((k) => k.isDown)) cam.scrollY -= step;
      if (this.downKeys.some((k) => k.isDown)) cam.scrollY += step;
      if (anyJustDown(this.keys.overview)) this.setOverview(false);
      this.touchPressed.clear();
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = 110;
    if (anyDown(this.keys.left) || this.touch.has("left")) body.setVelocityX(-speed);
    else if (anyDown(this.keys.right) || this.touch.has("right")) body.setVelocityX(speed);
    else body.setVelocityX(0);

    const onFloor = body.blocked.down || body.touching.down;
    if ((anyDown(this.keys.jump) || this.touch.has("jump")) && onFloor) body.setVelocityY(-240);

    // Interact: pick nearest interactable in range, show its hint.
    let best: Interactable | null = null;
    let bestDist = INTERACT_RANGE;
    const px = this.player.x;
    const py = this.player.y - 8;
    for (const it of this.interactables) {
      const d = Phaser.Math.Distance.Between(px, py, it.obj.x, it.obj.y);
      if (d < bestDist) {
        best = it;
        bestDist = d;
      }
    }
    if (best !== this.nearest) {
      this.nearest = best;
      // Tell React which folder the player stands at, so it can show its description.
      bus.emit("focus:note", { noteId: best?.kind === "door" ? best.payload.noteId ?? null : null });
      if (best) {
        this.hint.setText(best.hint);
        // Keep the label inside the room even for objects at the very edge.
        const half = this.hint.width / 2 + 2;
        const hx = Phaser.Math.Clamp(best.obj.x, half, this.roomW - half);
        this.hint.setPosition(hx, best.obj.y - 22).setVisible(true);
      } else {
        this.hint.setVisible(false);
      }
    }

    if ((anyJustDown(this.keys.interact) || this.touchPressed.has("interact")) && best) {
      switch (best.kind) {
        case "book":
          bus.emit("book:open", { noteId: best.payload.noteId! });
          break;
        case "door":
        case "exit":
          this.enterRoom(best.payload.noteId!, this.currentRoomId ?? undefined);
          break;
        case "wisp":
          bus.emit("search:open", undefined);
          break;
        case "socrates":
          bus.emit("socrates:open", undefined);
          break;
      }
    }

    // Q / Backspace: jump one folder up (same as walking into the exit door).
    if ((anyJustDown(this.keys.up) || this.touchPressed.has("up")) && this.currentRoomId !== null) {
      const parent = this.parentOf.get(this.currentRoomId);
      if (parent !== undefined) this.enterRoom(parent, this.currentRoomId);
    }

    // O toggles overview mode.
    if (anyJustDown(this.keys.overview)) {
      this.setOverview(!this.overviewOn);
    }
    this.touchPressed.clear();
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function anyDown(keys: Phaser.Input.Keyboard.Key[]): boolean {
  return keys.some((k) => k.isDown);
}

function anyJustDown(keys: Phaser.Input.Keyboard.Key[]): boolean {
  return keys.some((k) => Phaser.Input.Keyboard.JustDown(k));
}

/** Small stable non-negative hash (decor variety that never changes between visits). */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Scale an 0xRRGGBB colour's channels by `f` (clamped). */
function dim(color: number, f: number): number {
  const ch = (shift: number): number => Math.min(255, Math.round(((color >> shift) & 0xff) * f));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function truncate(s: string, max = 18): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ---------------------------------------------------------------------------
// Module-level React → Phaser event wiring
// ---------------------------------------------------------------------------

// Registered exactly once at import. Events reach only the live scene
// instance (`current`), so destroying and recreating the game (React
// StrictMode, HMR) can never deliver events to a dead scene.
BibliothecaScene.wireBus();