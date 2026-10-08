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
 * biblio.x/biblio.y labels (lib/layout.ts). Clicking a block enters it.
 *
 * The player is keyboard-driven for v1 (←→/AD move, Space/W jump, E interact,
 * O overview). Touch controls are a documented non-goal for this increment.
 */

import Phaser from "phaser";
import { NPC } from "../config";
import { buildRoomContents } from "../lib/library";
import { ASSET_KEYS, registerBuiltInPack } from "./textures";
import { bus } from "./events";
import type { Book, LibraryTree, RoomContents, RoomPlacement } from "../types";

/** Room dimensions in world pixels. 16px tiles, retro 480×270 screen. */
const ROOM_W = 480;
const ROOM_H = 270;
/** Floor top edge — where the player's feet are. */
const FLOOR_Y = ROOM_H - 64;
/** Max doors rendered per room (more get a "+N doors" note). */
const MAX_DOORS = 3;
/** Max scrolls rendered on the desk (more get a "+N more" note). */
const MAX_SCROLLS = 6;
/** Max shelf units rendered per room (more tags fold into nothing visible). */
const MAX_SHELVES = 5;
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
}

/** An interactable world object with what to do when activated. */
interface Interactable {
  /** Rectangle or sprite — anything with x/y that can carry pointer input. */
  obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  kind: "book" | "scroll" | "door" | "exit" | "wisp" | "socrates";
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

    this.staticBodies = this.physics.add.staticGroup();
    this.physics.add.collider(this.player, this.staticBodies);

    // --- keyboard: WASD + arrows both work -----------------------------------
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: [kb.addKey(K.A), kb.addKey(K.LEFT)],
      right: [kb.addKey(K.D), kb.addKey(K.RIGHT)],
      jump: [kb.addKey(K.SPACE), kb.addKey(K.W), kb.addKey(K.UP)],
      interact: [kb.addKey(K.E), kb.addKey(K.ENTER)],
      overview: [kb.addKey(K.O)],
    };
    // Don't capture keys globally — capturing SPACE breaks typing in React
    // inputs. Instead, React pauses the scene whenever a modal is open
    // (`scene:paused`), which is where typing would actually collide.

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
    bus.on("scene:overview", ({ on }) => BibliothecaScene.current?.setOverview(on));
    bus.on("scene:paused", ({ on }) => {
      const scene = BibliothecaScene.current;
      if (!scene) return;
      scene.paused = on;
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
    for (const o of this.roomObjects) o.destroy();
    this.roomObjects = [];
    this.interactables = [];
    this.nearest = null;
    this.hint.setVisible(false);
    // The static group owns its floor body — clearing destroys the child too,
    // so bodies are never double-destroyed with roomObjects.
    this.staticBodies.clear(true, true);
  }

  /** Build and enter a room. */
  private enterRoom(noteId: string): void {
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

    this.drawShell(contents.title);
    this.drawShelves(contents);
    this.drawDesk(contents);
    this.drawDoors(contents);
    this.drawAmenities();
    this.placePlayerAtEntrance();

    this.cameras.main.setBounds(0, 0, ROOM_W, ROOM_H);
    this.cameras.main.setZoom(1);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.fadeIn(220, 14, 13, 22);

    bus.emit("hud:state", {
      path: this.pathFromRoot(noteId),
      roomCount: world.placements.size,
      overview: false,
    });
  }

  /** Back wall + floor (two tile sprites) + floor collider + room title. */
  private drawShell(title: string): void {
    // Back wall behind everything, floor strip below the action line.
    const wall = this.add
      .tileSprite(ROOM_W / 2, FLOOR_Y / 2, ROOM_W, FLOOR_Y, ASSET_KEYS.tileWall)
      .setDepth(0);
    const floor = this.add
      .tileSprite(ROOM_W / 2, (FLOOR_Y + ROOM_H) / 2, ROOM_W, ROOM_H - FLOOR_Y, ASSET_KEYS.tileFloor)
      .setDepth(1);
    const carpet = this.add.image(ROOM_W / 2, FLOOR_Y + 4, ASSET_KEYS.carpet).setDepth(2);
    this.roomObjects.push(wall, floor, carpet);

    // One-way floor collider. Owned by the static group (cleared with it);
    // NOT pushed to roomObjects, or clearRoom would destroy it twice.
    const floorBody = this.add.rectangle(ROOM_W / 2, FLOOR_Y + 8, ROOM_W, 16, 0, 0);
    this.physics.add.existing(floorBody, true);
    this.staticBodies.add(floorBody);

    // Room title plate.
    const plate = this.add
      .text(ROOM_W / 2, 12, title, {
        fontFamily: "ui-monospace, monospace",
        fontSize: "13px",
        color: "#f0e2c0",
        backgroundColor: "#14101ccc",
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5, 0)
      .setDepth(60);
    this.roomObjects.push(plate);
  }

  /** Shelves with book spines, laid left→right along the back wall.
   * Zone plan (ROOM_W 480): x 24 exit door · 46–86 desk · 96–120 Socrates ·
   * 140–296 shelves · right wall 308–456 doors. The wisp floats above. */
  private drawShelves(contents: RoomContents): void {
    let shelfX = 140;

    for (const shelf of contents.shelves.slice(0, MAX_SHELVES)) {
      const shelfColor = Phaser.Display.Color.HexStringToColor(shelf.color).color;
      // Frame spans FLOOR_Y-14 .. FLOOR_Y+2 (bottom 2px sunk into the floor
      // so it reads as standing ON the floor, not floating above it).
      const plankTop1 = FLOOR_Y - 14; // upper plank's top edge
      const plankTop2 = FLOOR_Y - 5;  // lower plank's top edge

      // Tag label above the shelf block.
      const tag = this.add
        .text(shelfX + 24, FLOOR_Y - 48, `#${shelf.tag}`, {
          fontFamily: "ui-monospace, monospace",
          fontSize: "9px",
          color: shelf.color,
          backgroundColor: "#14101caa",
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(60);
      this.roomObjects.push(tag);

      // Shelf frame texture (48×16, tinted with the shelf colour).
      const frame = this.add.image(shelfX + 24, FLOOR_Y - 6, ASSET_KEYS.shelf).setDepth(20);
      frame.setTint(shelfColor);
      this.roomObjects.push(frame);

      // Book spines: tier 1 stands on the upper plank, overflow fills a
      // second (shorter) tier on the lower plank.
      let bx = shelfX + 3;
      const tier2: typeof shelf.books = [];
      for (const book of shelf.books) {
        const w = spineWidth(book.title);
        if (bx + w > shelfX + 46) {
          tier2.push(book);
          continue;
        }
        this.drawSpine(book, bx + w / 2, plankTop1, 14);
        bx += w + 1;
      }
      let bx2 = shelfX + 4;
      for (const book of tier2.slice(0, 6)) {
        const w = spineWidth(book.title);
        this.drawSpine(book, bx2 + w / 2, plankTop2, 8);
        bx2 += w + 1;
      }
      if (shelf.books.length > 14) {
        const more = this.add
          .text(shelfX + 24, FLOOR_Y - 28, `+${shelf.books.length - 14}`, {
            fontFamily: "ui-monospace, monospace",
            fontSize: "8px",
            color: "#b8a878",
          })
          .setOrigin(0.5, 1)
          .setDepth(60);
        this.roomObjects.push(more);
      }

      shelfX += 56;
      if (shelfX > ROOM_W - 200) break; // keep clear of the door wall
    }
  }

  /** One book spine: a coloured rectangle standing on a plank top edge. */
  private drawSpine(book: Book, cx: number, plankTopY: number, maxH: number): void {
    const h = Math.min(8 + (book.title.length % 6), maxH);
    const spine = this.add
      .rectangle(
        cx,
        plankTopY - h / 2,
        spineWidth(book.title),
        h,
        Phaser.Display.Color.HexStringToColor(book.color).color,
      )
      .setStrokeStyle(1, 0x0e0d16, 0.9)
      .setDepth(21)
      .setInteractive({ useHandCursor: true });
    spine.on("pointerup", () => bus.emit("book:open", { noteId: book.noteId }));
    // Hover feedback: nudge the spine up slightly.
    spine.on("pointerover", () => spine.y -= 2);
    spine.on("pointerout", () => spine.y += 2);
    this.roomObjects.push(spine);
    this.interactables.push({
      obj: spine,
      kind: "book",
      payload: { noteId: book.noteId },
      hint: `E · open "${truncate(book.title)}"`,
    });
  }

  /** Desk with loose scrolls (unlabelled notes). */
  private drawDesk(contents: RoomContents): void {
    if (contents.desk.length === 0) return;
    const deskX = 46; // left zone, next to the exit door
    const desk = this.add.image(deskX + 20, FLOOR_Y - 10, ASSET_KEYS.desk).setDepth(20);
    this.roomObjects.push(desk);

    // Scrolls: small parchment rects piled on the desk, one per unfiled note.
    let sx = deskX + 6;
    let sy = FLOOR_Y - 16;
    contents.desk.slice(0, MAX_SCROLLS).forEach((scroll, i) => {
      const w = spineWidth(scroll.title);
      const rect = this.add
        .rectangle(sx + w / 2, sy - 3 + (i % 2) * 2, w, 5, 0xd8c8a0)
        .setStrokeStyle(1, 0x8a7a56, 1)
        .setDepth(21)
        .setInteractive({ useHandCursor: true });
      rect.on("pointerup", () => bus.emit("book:open", { noteId: scroll.noteId }));
      this.roomObjects.push(rect);
      this.interactables.push({
        obj: rect,
        kind: "scroll",
        payload: { noteId: scroll.noteId },
        hint: `E · read scroll "${truncate(scroll.title)}"`,
      });
      sx += w + 2;
      if (sx > deskX + 30) {
        sx = deskX + 6;
        sy -= 5;
      }
    });
    if (contents.desk.length > MAX_SCROLLS) {
      const more = this.add
        .text(deskX + 20, FLOOR_Y - 40, `+${contents.desk.length - MAX_SCROLLS} more`, {
          fontFamily: "ui-monospace, monospace",
          fontSize: "8px",
          color: "#b8a878",
        })
        .setOrigin(0.5)
        .setDepth(60);
      this.roomObjects.push(more);
    }
  }

  /** Doors into child rooms (right side) + exit door to the parent (left). */
  private drawDoors(contents: RoomContents): void {
    const doors = contents.doors.slice(0, MAX_DOORS);
    doors.forEach((door, i) => {
      // Right-wall row; staggered label heights keep the signs readable.
      const dx = ROOM_W - 48 - i * 44;
      const ly = FLOOR_Y - 32 - (i % 2) * 11;
      const sprite = this.add
        .sprite(dx, FLOOR_Y, ASSET_KEYS.door)
        .setOrigin(0.5, 1)
        .setDepth(20)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(dx, ly, truncate(door.title, 10), {
          fontFamily: "ui-monospace, monospace",
          fontSize: "8px",
          color: "#d8c8a0",
          backgroundColor: "#14101caa",
          padding: { x: 2, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(60);
      sprite.on("pointerup", () => this.enterRoom(door.noteId));
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
        .text(ROOM_W - 50, FLOOR_Y - 48, `+${contents.doors.length - MAX_DOORS} doors`, {
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
        .text(28, FLOOR_Y - 30, "⬆ up", {
          fontFamily: "ui-monospace, monospace",
          fontSize: "8px",
          color: "#e8cc88",
          backgroundColor: "#14101caa",
          padding: { x: 2, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(60);
      ex.on("pointerup", () => this.enterRoom(parentId));
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
    const wispX = ROOM_W / 2 - 20;
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
    wisp.on("pointerup", () => bus.emit("search:open", undefined));
    this.roomObjects.push(wisp, wispLabel);
    this.interactables.push({
      obj: wisp,
      kind: "wisp",
      payload: {},
      hint: "E · search the vault",
    });

    // Socrates: marble statue on a plinth, left zone beside the desk. Honest
    // placeholder — the intelligence service (chat/RAG) is a later plane.
    const socX = 108;
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
    soc.on("pointerup", () => bus.emit("socrates:open", undefined));
    this.roomObjects.push(plinth, soc, socLabel);
    this.interactables.push({
      obj: soc,
      kind: "socrates",
      payload: {},
      hint: "E · talk to Socrates",
    });
  }

  /** Player enters through the middle, standing on the carpet. */
  private placePlayerAtEntrance(): void {
    this.player.setPosition(ROOM_W / 2, FLOOR_Y);
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
    const zoom = Phaser.Math.Clamp(
      Math.min(this.scale.width / (wCells * ROOM_W), this.scale.height / (hCells * ROOM_H)) * 0.9,
      0.15,
      1,
    );
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.setZoom(zoom);
    const worldW = wCells * ROOM_W;
    const worldH = hCells * ROOM_H;
    const originX = minX * ROOM_W;
    const originY = minY * ROOM_H;
    cam.setBounds(originX, originY, worldW, worldH);
    cam.centerOn(originX + worldW / 2, originY + worldH / 2);

    for (const p of placements.values()) {
      const rx = p.x * ROOM_W;
      const ry = p.y * ROOM_H;
      const isRoot = p.noteId === tree.rootNoteId;

      const g = this.add.container(rx + ROOM_W / 2, ry + ROOM_H / 2);
      const box = this.add
        .rectangle(0, 0, ROOM_W - 24, ROOM_H - 24, 0x241e30, 0.9)
        .setStrokeStyle(2, isRoot ? 0xd8b868 : 0x4a4a66);
      const title = this.add
        .text(0, -8, truncate(tree.notes[p.noteId]?.title ?? p.noteId, 22), {
          fontFamily: "ui-monospace, monospace",
          fontSize: "12px",
          color: "#f0e2c0",
          align: "center",
          wordWrap: { width: ROOM_W - 60 },
        })
        .setOrigin(0.5);
      const sub = this.add
        .text(0, ROOM_H / 2 - 34, p.manual ? "placed" : "auto", {
          fontFamily: "ui-monospace, monospace",
          fontSize: "9px",
          color: p.manual ? "#8ad88a" : "#6a6a86",
        })
        .setOrigin(0.5);
      g.add([box, title, sub]);
      g.setSize(ROOM_W - 24, ROOM_H - 24);
      g.setInteractive({ draggable: true, useHandCursor: true });
      this.overviewObjects.push(g, box, title, sub);

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

  update(_time: number, _delta: number): void {
    if (this.paused || this.overviewOn || !this.world) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = 110;
    if (anyDown(this.keys.left)) body.setVelocityX(-speed);
    else if (anyDown(this.keys.right)) body.setVelocityX(speed);
    else body.setVelocityX(0);

    const onFloor = body.blocked.down || body.touching.down;
    if (anyDown(this.keys.jump) && onFloor) body.setVelocityY(-240);

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
      if (best) {
        this.hint.setText(best.hint).setPosition(best.obj.x, best.obj.y - 22).setVisible(true);
      } else {
        this.hint.setVisible(false);
      }
    }

    if (anyJustDown(this.keys.interact) && best) {
      switch (best.kind) {
        case "book":
        case "scroll":
          bus.emit("book:open", { noteId: best.payload.noteId! });
          break;
        case "door":
        case "exit":
          this.enterRoom(best.payload.noteId!);
          break;
        case "wisp":
          bus.emit("search:open", undefined);
          break;
        case "socrates":
          bus.emit("socrates:open", undefined);
          break;
      }
    }

    // O toggles overview mode.
    if (anyJustDown(this.keys.overview)) {
      this.setOverview(!this.overviewOn);
    }
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

/** Spine width from title length: 5–12 px, clamped. */
function spineWidth(title: string): number {
  return Phaser.Math.Clamp(4 + Math.floor(title.length / 3), 5, 12);
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