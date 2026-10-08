/**
 * game/textures.ts — the built-in texture pack, drawn in code.
 *
 * The texture-pack contract (game-ui.md): every asset is referenced by a
 * stable key ("tile.floor", "npc.wisp"), never a file path; a pack maps keys
 * to files via a manifest. We ship exactly one hardcoded pack (persona
 * debate, recommendation #4: no manifest-swapping until the static world has
 * been lived in) — and to stay dependency-free it is *procedural*: each
 * sprite is pixel-painted onto a canvas at boot and registered under its
 * stable key. A future real pack (PNG folder + manifest.json) replaces these
 * registrations without any other file changing.
 *
 * All art is generated, so the project ships zero binary assets and carries
 * no third-party license obligations.
 */

/** Stable asset keys. The pack contract — never reference paths in game code. */
export const ASSET_KEYS = {
  tileFloor: "tile.floor",
  tileWall: "tile.wall",
  shelf: "furniture.shelf",
  desk: "furniture.desk",
  door: "furniture.door",
  exitDoor: "furniture.door.exit",
  player: "player.scholar",
  wisp: "npc.wisp",
  socrates: "npc.socrates",
  carpet: "decor.carpet",
} as const;

type Ctx = CanvasRenderingContext2D;

/** Create a w×h canvas + 2d context pair. */
function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  return [c, ctx];
}

/** Paint a rectangle of logical pixels (the art is drawn at 1px = 1px). */
function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Register a canvas as a Phaser texture under a stable key. */
function register(scene: Phaser.Scene, key: string, c: HTMLCanvasElement): void {
  // Remove first so re-registration (scene restart) doesn't warn.
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
}

/**
 * Register every texture of the built-in pack on the given scene.
 * Called once from BibliothecaScene.create() before any sprite is made.
 */
export function registerBuiltInPack(scene: Phaser.Scene): void {
  registerFloor(scene);
  registerWall(scene);
  registerShelf(scene);
  registerDesk(scene);
  registerDoor(scene);
  registerPlayer(scene);
  registerWisp(scene);
  registerSocrates(scene);
  registerCarpet(scene);
}

// ---------------------------------------------------------------------------
// Tiles — 16×16, dark library stone/wood
// ---------------------------------------------------------------------------

function registerFloor(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(16, 16);
  px(ctx, 0, 0, 16, 16, "#2b2436"); // base
  px(ctx, 0, 0, 16, 1, "#352c42"); // top sheen
  px(ctx, 0, 15, 16, 1, "#221c2c"); // bottom shadow
  px(ctx, 7, 2, 1, 12, "#241e30"); // grout vertical
  px(ctx, 2, 8, 1, 1, "#332a40"); // speckle
  px(ctx, 12, 5, 1, 1, "#332a40");
  px(ctx, 4, 12, 1, 1, "#332a40");
  register(scene, ASSET_KEYS.tileFloor, c);
}

function registerWall(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(16, 16);
  px(ctx, 0, 0, 16, 16, "#1c1726"); // base
  px(ctx, 0, 0, 16, 1, "#2a2338"); // top edge
  px(ctx, 0, 7, 16, 1, "#16121f"); // mortar line
  px(ctx, 5, 0, 1, 7, "#16121f"); // staggered joints
  px(ctx, 11, 8, 1, 8, "#16121f");
  px(ctx, 2, 3, 1, 1, "#2f2840"); // stone highlights
  px(ctx, 13, 11, 1, 1, "#2f2840");
  register(scene, ASSET_KEYS.tileWall, c);
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * Shelf: 48×16. Drawn neutral grey-brown; the scene tints it per shelf
 * colour and paints book spines on top as rectangles at runtime.
 */
function registerShelf(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(48, 16);
  // Two planks with side posts; books (runtime rects) sit on each plank.
  px(ctx, 0, 0, 48, 3, "#6b4a32"); // upper plank
  px(ctx, 0, 3, 2, 13, "#543a28"); // left post
  px(ctx, 46, 3, 2, 13, "#543a28"); // right post
  px(ctx, 0, 9, 48, 3, "#6b4a32"); // lower plank
  px(ctx, 0, 12, 48, 4, "#3a2a1c"); // lower shadow area
  px(ctx, 0, 2, 48, 1, "#7d5a3e"); // plank highlight
  px(ctx, 0, 8, 48, 1, "#7d5a3e");
  register(scene, ASSET_KEYS.shelf, c);
}

/** Desk: 40×20 — a reading desk where unlabelled notes pile up as scrolls. */
function registerDesk(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(40, 20);
  px(ctx, 4, 6, 32, 4, "#7a5a3a"); // tabletop
  px(ctx, 4, 5, 32, 1, "#8d6c46"); // top highlight
  px(ctx, 6, 10, 4, 10, "#5a4028"); // legs
  px(ctx, 30, 10, 4, 10, "#5a4028");
  px(ctx, 10, 2, 8, 3, "#d8c8a0"); // a scroll lying on top
  px(ctx, 10, 2, 8, 1, "#efe2c0");
  px(ctx, 18, 3, 2, 2, "#b8a078"); // scroll end
  px(ctx, 22, 1, 4, 4, "#c8b488"); // second scroll
  register(scene, ASSET_KEYS.desk, c);
}

/** Door: 16×24 dark arch. The exit door gets a golden trim tint at runtime. */
function registerDoor(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(16, 24);
  px(ctx, 1, 0, 14, 24, "#4a3524"); // frame
  px(ctx, 3, 4, 10, 20, "#191420"); // opening (void)
  px(ctx, 3, 2, 10, 2, "#5a4430"); // arch top
  px(ctx, 2, 0, 12, 1, "#5a4430");
  px(ctx, 12, 12, 1, 3, "#8a6a40"); // handle
  register(scene, ASSET_KEYS.door, c);

  // Exit variant: lighter frame, warm glow at the threshold.
  const [c2, ctx2] = canvas(16, 24);
  px(ctx2, 1, 0, 14, 24, "#6a5434");
  px(ctx2, 3, 4, 10, 20, "#2a2018");
  px(ctx2, 3, 2, 10, 2, "#7a6440");
  px(ctx2, 2, 0, 12, 1, "#7a6440");
  px(ctx2, 4, 18, 8, 6, "#c8a858"); // glow near floor
  px(ctx2, 5, 17, 6, 1, "#e8cc88");
  px(ctx2, 12, 12, 1, 3, "#e8cc88");
  register(scene, ASSET_KEYS.exitDoor, c2);
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** The scholar player: 12×18, robe + book in hand. Facing right by default. */
function registerPlayer(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(12, 18);
  // Robe
  px(ctx, 3, 8, 6, 9, "#4a5a7a");
  px(ctx, 2, 10, 1, 7, "#3a4a66");
  px(ctx, 9, 10, 1, 7, "#3a4a66");
  px(ctx, 3, 16, 2, 2, "#2a3650"); // hem shadow
  px(ctx, 7, 16, 2, 2, "#2a3650");
  // Head
  px(ctx, 3, 2, 6, 6, "#e8c8a0"); // skin
  px(ctx, 3, 1, 6, 2, "#5a4a38"); // hair
  px(ctx, 8, 4, 1, 1, "#2a2a3a"); // eye (facing right)
  // Little book in hand
  px(ctx, 10, 9, 2, 3, "#a04a3a");
  px(ctx, 10, 9, 2, 1, "#c06a5a");
  register(scene, ASSET_KEYS.player, c);
}

/** The wisp: 10×10 floating orb — the keyword-search amenity. */
function registerWisp(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(10, 10);
  px(ctx, 3, 2, 4, 6, "#bfe8ff"); // core
  px(ctx, 2, 3, 6, 4, "#bfe8ff");
  px(ctx, 4, 3, 2, 4, "#eafaff"); // inner glow
  px(ctx, 4, 0, 2, 1, "#7ab8d8"); // top spark
  px(ctx, 0, 4, 1, 2, "#7ab8d8"); // side sparks
  px(ctx, 9, 4, 1, 2, "#7ab8d8");
  px(ctx, 4, 9, 2, 1, "#7ab8d8");
  register(scene, ASSET_KEYS.wisp, c);
}

/** Socrates: 12×20 marble statue — placeholder for the intelligence service. */
function registerSocrates(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(12, 20);
  px(ctx, 4, 1, 5, 5, "#cdd3da"); // head (marble)
  px(ctx, 4, 5, 5, 2, "#aeb6c0"); // beard
  px(ctx, 3, 6, 7, 7, "#dde2e8"); // torso (toga)
  px(ctx, 2, 8, 1, 5, "#c5ccd4"); // arm
  px(ctx, 9, 8, 1, 5, "#c5ccd4");
  px(ctx, 3, 13, 2, 6, "#c5ccd4"); // legs
  px(ctx, 7, 13, 2, 6, "#c5ccd4");
  px(ctx, 3, 19, 6, 1, "#aab2bc"); // feet shadow
  px(ctx, 4, 2, 1, 1, "#5a6470"); // eye
  register(scene, ASSET_KEYS.socrates, c);
}

/** Carpet: 32×12 warm rug, for the room entrance — tints by depth parity. */
function registerCarpet(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(32, 12);
  px(ctx, 0, 0, 32, 12, "#6a3a44");
  px(ctx, 2, 2, 28, 8, "#7a4a54");
  px(ctx, 4, 4, 24, 4, "#8a5a64");
  px(ctx, 15, 1, 2, 10, "#5a2a34"); // centre stripe
  register(scene, ASSET_KEYS.carpet, c);
}