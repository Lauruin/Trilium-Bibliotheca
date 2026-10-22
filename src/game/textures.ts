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
  tileWainscot: "tile.wainscot",
  bookcase: "furniture.bookcase",
  bookcaseWalnut: "furniture.bookcase.walnut",
  bookcaseEbony: "furniture.bookcase.ebony",
  bookcaseWhitewash: "furniture.bookcase.whitewash",
  door: "furniture.door",
  exitDoor: "furniture.door.exit",
  player: "player.scholar",
  wisp: "npc.wisp",
  socrates: "npc.socrates",
  rug: "decor.rug",
  rugMoss: "decor.rug.moss",
  rugNavy: "decor.rug.navy",
  clock: "decor.clock",
  banner: "decor.banner",
  lamp: "decor.lamp",
  bust: "decor.bust",
  telescope: "decor.telescope",
  fireplace: "decor.fireplace",
  window: "decor.window",
  painting: "decor.painting",
  sconce: "decor.sconce",
  flame: "fx.flame",
  glow: "fx.glow",
  lightShaft: "fx.lightshaft",
  mote: "fx.mote",
  vignette: "fx.vignette",
  plant: "decor.plant",
  globe: "decor.globe",
  armchair: "decor.armchair",
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
  registerBookcase(scene);
  registerDoor(scene);
  registerPlayer(scene);
  registerWisp(scene);
  registerSocrates(scene);
  registerRug(scene);
  registerDecor(scene);
  registerEffects(scene);
}

// ---------------------------------------------------------------------------
// Tiles — 16×16, dark library stone/wood
// ---------------------------------------------------------------------------

function registerFloor(scene: Phaser.Scene): void {
  // Warm oak planks, two rows per tile with staggered end joints.
  const [c, ctx] = canvas(16, 16);
  px(ctx, 0, 0, 16, 8, "#5a3d27");
  px(ctx, 0, 8, 16, 8, "#4f3522");
  px(ctx, 0, 0, 16, 1, "#6a4a31"); // plank highlight
  px(ctx, 0, 8, 16, 1, "#5f4129");
  px(ctx, 0, 7, 16, 1, "#2e1f14"); // seams
  px(ctx, 0, 15, 16, 1, "#2e1f14");
  px(ctx, 5, 0, 1, 7, "#2e1f14"); // end joints
  px(ctx, 12, 8, 1, 7, "#2e1f14");
  px(ctx, 9, 3, 3, 1, "#64452c"); // grain
  px(ctx, 2, 11, 4, 1, "#583b26");
  px(ctx, 13, 12, 2, 1, "#443020");
  register(scene, ASSET_KEYS.tileFloor, c);
}

function registerWall(scene: Phaser.Scene): void {
  // Aged plaster in a warm umber with a faint vertical damask stripe.
  const [c, ctx] = canvas(16, 16);
  px(ctx, 0, 0, 16, 16, "#3b2c26");
  px(ctx, 0, 0, 2, 16, "#35271f"); // stripe
  px(ctx, 8, 0, 2, 16, "#35271f");
  px(ctx, 3, 4, 2, 2, "#46352c"); // damask diamond
  px(ctx, 4, 3, 1, 4, "#46352c");
  px(ctx, 11, 10, 2, 2, "#46352c");
  px(ctx, 12, 9, 1, 4, "#46352c");
  px(ctx, 6, 13, 1, 1, "#2f221b"); // stains
  px(ctx, 14, 2, 1, 1, "#2f221b");
  register(scene, ASSET_KEYS.tileWall, c);

  // Wainscot: carved wooden panelling along the bottom of the wall (16×32).
  const [w, wx] = canvas(16, 32);
  px(wx, 0, 0, 16, 32, "#4a3224");
  px(wx, 0, 0, 16, 3, "#5d4130"); // cap rail
  px(wx, 0, 3, 16, 1, "#2a1b12");
  px(wx, 2, 7, 12, 20, "#3e2a1e"); // recessed panel
  px(wx, 2, 7, 12, 1, "#2a1b12");
  px(wx, 2, 7, 1, 20, "#2a1b12");
  px(wx, 13, 7, 1, 20, "#58402e");
  px(wx, 2, 26, 12, 1, "#58402e");
  px(wx, 0, 29, 16, 3, "#2f2016"); // skirting
  register(scene, ASSET_KEYS.tileWainscot, w);
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * Bookcase: 56×64, three tiers. Untinted wood — the shelf's tag colour lives on
 * the nameplate and the spines, not the frame. Book spines (runtime rects)
 * stand on the plank tops at y = 22, 42, 62 of this texture.
 */
function registerBookcase(scene: Phaser.Scene): void {
  // [back panel, cornice, cornice light, cornice shadow, left side, right side, plank, plank light, plank shadow]
  const finishes: Array<[string, string[]]> = [
    [ASSET_KEYS.bookcase, ["#2a1c12", "#6e4c32", "#86613f", "#3a2616", "#5a3d28", "#4c3322", "#6a4930", "#86613f", "#1c130c"]], // oak
    [ASSET_KEYS.bookcaseWalnut, ["#1e1410", "#4e3424", "#664630", "#2a1a10", "#3e281c", "#34221a", "#4a3220", "#64442e", "#140c08"]],
    [ASSET_KEYS.bookcaseEbony, ["#120e14", "#2c2a34", "#403e4c", "#1a181e", "#262430", "#201e28", "#2e2c38", "#46444e", "#0a080c"]],
    [ASSET_KEYS.bookcaseWhitewash, ["#4a4440", "#b8b0a0", "#d8d0c0", "#7a7266", "#a89f90", "#948b7c", "#b0a898", "#d0c8b8", "#3a352f"]],
  ];
  for (const [key, [back, cor, corLight, corShadow, left, right, plank, plankLight, plankShadow]] of finishes) {
    const [c, ctx] = canvas(56, 64);
    px(ctx, 0, 0, 56, 64, back);
    px(ctx, 0, 0, 56, 4, cor); // cornice
    px(ctx, 0, 0, 56, 1, corLight);
    px(ctx, 0, 4, 56, 1, corShadow);
    px(ctx, 0, 4, 3, 60, left); // sides
    px(ctx, 53, 4, 3, 60, right);
    px(ctx, 0, 4, 1, 60, cor);
    for (const y of [22, 42, 61]) {
      px(ctx, 3, y, 50, 3, plank);
      px(ctx, 3, y, 50, 1, plankLight);
      px(ctx, 3, y + 3, 50, 1, plankShadow);
    }
    px(ctx, 6, 8, 44, 1, plankShadow); // inner shadows under cornice / planks
    px(ctx, 6, 28, 44, 1, plankShadow);
    px(ctx, 6, 48, 44, 1, plankShadow);
    register(scene, key, c);
  }
}

/** Door: 20×30 plank door in a stone-and-oak arch. The exit door glows gold. */
function registerDoor(scene: Phaser.Scene): void {
  const paint = (frame: string, planks: string, plankDark: string, iron: string, glow: boolean): HTMLCanvasElement => {
    const [c, ctx] = canvas(20, 30);
    px(ctx, 0, 4, 20, 26, frame); // jamb
    px(ctx, 2, 2, 16, 2, frame); // arch
    px(ctx, 5, 0, 10, 2, frame);
    px(ctx, 3, 6, 14, 24, planks); // door leaf
    for (const x of [6, 9, 12, 15]) px(ctx, x, 6, 1, 24, plankDark); // plank seams
    px(ctx, 3, 11, 14, 2, iron); // iron bands
    px(ctx, 3, 22, 14, 2, iron);
    px(ctx, 14, 16, 2, 3, iron); // handle
    px(ctx, 14, 16, 1, 1, "#e8cc88");
    if (glow) {
      px(ctx, 3, 28, 14, 2, "#e8cc88"); // warm light under the door
      px(ctx, 5, 27, 10, 1, "#c8a858");
    }
    return c;
  };
  register(scene, ASSET_KEYS.door, paint("#6a5a4c", "#5a3c26", "#3a2616", "#2a2420", false));
  register(scene, ASSET_KEYS.exitDoor, paint("#8a7050", "#7a5a34", "#4a3420", "#8a6a30", true));
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

/** Rug: 96×14 woven runner with a border and diamond motif, in three colourways. */
function registerRug(scene: Phaser.Scene): void {
  const palettes: Array<[string, [string, string, string, string]]> = [
    [ASSET_KEYS.rug, ["#5a2630", "#7a3a40", "#8a4a48", "#d8b868"]], // crimson
    [ASSET_KEYS.rugMoss, ["#2a4a30", "#3a6040", "#4a7448", "#d8c880"]],
    [ASSET_KEYS.rugNavy, ["#1e2a50", "#2c3c6a", "#3a4c7c", "#c8c8e0"]],
  ];
  for (const [key, [base, field, inner, motif]] of palettes) {
    const [c, ctx] = canvas(96, 14);
    px(ctx, 0, 0, 96, 14, base);
    px(ctx, 1, 1, 94, 12, field);
    px(ctx, 3, 3, 90, 8, inner);
    px(ctx, 1, 1, 94, 1, "#c8a050"); // gold border
    px(ctx, 1, 12, 94, 1, "#c8a050");
    for (let x = 8; x < 90; x += 16) {
      px(ctx, x, 6, 4, 2, motif); // diamond motif
      px(ctx, x + 1, 5, 2, 4, motif);
    }
    for (let y = 0; y < 14; y += 2) { // fringe
      px(ctx, 0, y, 1, 1, "#d8c8a0");
      px(ctx, 95, y, 1, 1, "#d8c8a0");
    }
    register(scene, key, c);
  }
}

/** Wall and floor decoration: window, painting, sconce, plant, globe, armchair. */
function registerDecor(scene: Phaser.Scene): void {
  // Arched window with dusk glass (30×44).
  let [c, ctx] = canvas(30, 44);
  px(ctx, 0, 6, 30, 38, "#4a3224"); // frame
  px(ctx, 4, 0, 22, 8, "#4a3224");
  px(ctx, 3, 4, 24, 36, "#6a9ac0"); // glass
  px(ctx, 6, 2, 18, 4, "#6a9ac0");
  px(ctx, 3, 4, 24, 3, "#8ab8d8");
  px(ctx, 14, 2, 2, 38, "#4a3224"); // mullion
  px(ctx, 3, 20, 24, 2, "#4a3224"); // transom
  px(ctx, 5, 8, 3, 10, "#9ccae4"); // glints
  px(ctx, 18, 24, 3, 12, "#7aa8cc");
  px(ctx, 0, 40, 30, 4, "#5d4130"); // sill
  px(ctx, 0, 40, 30, 1, "#7a5a3e");
  register(scene, ASSET_KEYS.window, c);

  // Framed painting (22×16): a little landscape.
  [c, ctx] = canvas(22, 16);
  px(ctx, 0, 0, 22, 16, "#7a5a2c");
  px(ctx, 2, 2, 18, 12, "#7aa0b8"); // sky
  px(ctx, 2, 9, 18, 5, "#5a7a42"); // hills
  px(ctx, 6, 7, 6, 3, "#486a38");
  px(ctx, 14, 4, 3, 3, "#e8d888"); // sun
  px(ctx, 0, 0, 22, 1, "#a07c3c");
  register(scene, ASSET_KEYS.painting, c);

  // Wall sconce bracket (8×12); the flame is a separate animated sprite.
  [c, ctx] = canvas(8, 12);
  px(ctx, 3, 4, 2, 8, "#3a3028");
  px(ctx, 1, 4, 6, 2, "#5a4a38"); // cup
  px(ctx, 2, 3, 4, 1, "#d8c8a0"); // candle
  px(ctx, 3, 0, 2, 3, "#e8d8b0");
  register(scene, ASSET_KEYS.sconce, c);

  // Potted plant (14×22).
  [c, ctx] = canvas(14, 22);
  px(ctx, 3, 14, 8, 8, "#8a4a30"); // pot
  px(ctx, 2, 14, 10, 2, "#a05a3a");
  px(ctx, 6, 6, 2, 8, "#3a6a3a"); // stem
  px(ctx, 1, 4, 5, 4, "#4a8a44"); // leaves
  px(ctx, 8, 2, 5, 5, "#58a050");
  px(ctx, 4, 0, 5, 4, "#4a8a44");
  px(ctx, 2, 8, 4, 3, "#3a7038");
  register(scene, ASSET_KEYS.plant, c);

  // Globe on a stand (16×22).
  [c, ctx] = canvas(16, 22);
  px(ctx, 6, 14, 4, 6, "#5a3d28"); // stem
  px(ctx, 3, 20, 10, 2, "#4a3224"); // foot
  px(ctx, 3, 2, 10, 10, "#5a86a8"); // sphere
  px(ctx, 2, 4, 12, 6, "#5a86a8");
  px(ctx, 5, 4, 3, 3, "#6a9a5a"); // continents
  px(ctx, 9, 7, 3, 3, "#6a9a5a");
  px(ctx, 4, 3, 2, 1, "#9ccae4"); // shine
  px(ctx, 1, 2, 1, 10, "#c8a050"); // brass meridian
  px(ctx, 14, 2, 1, 10, "#c8a050");
  register(scene, ASSET_KEYS.globe, c);

  // Reading armchair (26×20).
  [c, ctx] = canvas(26, 20);
  px(ctx, 3, 0, 20, 12, "#7a3a3a"); // back
  px(ctx, 3, 0, 20, 2, "#8e4a48");
  px(ctx, 0, 8, 6, 10, "#6a2e30"); // arms
  px(ctx, 20, 8, 6, 10, "#6a2e30");
  px(ctx, 5, 12, 16, 6, "#8a4444"); // seat
  px(ctx, 5, 12, 16, 1, "#a05a54");
  px(ctx, 2, 18, 3, 2, "#3a2616"); // feet
  px(ctx, 21, 18, 3, 2, "#3a2616");
  register(scene, ASSET_KEYS.armchair, c);

  // Wall clock (16×18): round face, brass rim, pendulum glint.
  [c, ctx] = canvas(16, 18);
  px(ctx, 4, 0, 8, 1, "#c8a050");
  px(ctx, 2, 1, 12, 12, "#c8a050");
  px(ctx, 3, 2, 10, 10, "#efe4c8"); // face
  px(ctx, 4, 1, 8, 12, "#c8a050");
  px(ctx, 4, 2, 8, 10, "#efe4c8");
  px(ctx, 7, 4, 1, 4, "#2a1c12"); // hands
  px(ctx, 8, 7, 3, 1, "#2a1c12");
  px(ctx, 7, 7, 2, 2, "#8a3a30");
  px(ctx, 7, 13, 2, 4, "#8a6a30"); // pendulum
  px(ctx, 6, 16, 4, 2, "#c8a050");
  register(scene, ASSET_KEYS.clock, c);

  // Hanging banner (14×30): maroon cloth, gold trim and emblem.
  [c, ctx] = canvas(14, 30);
  px(ctx, 0, 0, 14, 2, "#8a6a30"); // rod
  px(ctx, 1, 2, 12, 22, "#7a2a34");
  px(ctx, 1, 24, 4, 4, "#7a2a34"); // swallowtail
  px(ctx, 9, 24, 4, 4, "#7a2a34");
  px(ctx, 5, 24, 4, 2, "#7a2a34");
  px(ctx, 1, 2, 1, 22, "#c8a050");
  px(ctx, 12, 2, 1, 22, "#c8a050");
  px(ctx, 5, 8, 4, 6, "#d8b868"); // emblem
  px(ctx, 6, 7, 2, 8, "#d8b868");
  px(ctx, 6, 9, 2, 3, "#7a2a34");
  register(scene, ASSET_KEYS.banner, c);

  // Standing lamp (12×34): pole, warm shade (the scene adds a glow).
  [c, ctx] = canvas(12, 34);
  px(ctx, 2, 0, 8, 8, "#e8c878"); // shade
  px(ctx, 3, 0, 6, 2, "#f4e0a0");
  px(ctx, 1, 6, 10, 2, "#c8a050");
  px(ctx, 5, 8, 2, 22, "#3a3028"); // pole
  px(ctx, 2, 30, 8, 4, "#3a3028"); // foot
  px(ctx, 3, 30, 6, 1, "#5a4a38");
  register(scene, ASSET_KEYS.lamp, c);

  // Marble bust on a pedestal (16×26).
  [c, ctx] = canvas(16, 26);
  px(ctx, 4, 14, 8, 12, "#6a6258"); // pedestal
  px(ctx, 3, 24, 10, 2, "#5a5248");
  px(ctx, 3, 14, 10, 2, "#8a8276");
  px(ctx, 5, 2, 6, 7, "#d8dce0"); // head
  px(ctx, 4, 8, 8, 6, "#c8ccd2"); // shoulders
  px(ctx, 6, 4, 1, 1, "#5a6470"); // eyes
  px(ctx, 9, 4, 1, 1, "#5a6470");
  px(ctx, 6, 7, 4, 2, "#b8bcc2"); // beard
  register(scene, ASSET_KEYS.bust, c);

  // Telescope on a tripod (26×30): brass tube pointing up-right.
  [c, ctx] = canvas(26, 30);
  px(ctx, 12, 14, 2, 14, "#4a3224"); // tripod
  px(ctx, 6, 26, 5, 2, "#4a3224");
  px(ctx, 15, 26, 5, 2, "#4a3224");
  px(ctx, 8, 12, 4, 3, "#8a6a30");
  px(ctx, 10, 9, 4, 3, "#c8a050");
  px(ctx, 13, 6, 4, 3, "#c8a050");
  px(ctx, 16, 3, 5, 3, "#d8b868");
  px(ctx, 20, 1, 4, 3, "#8a6a30"); // lens end
  px(ctx, 21, 2, 2, 1, "#9ccae4");
  register(scene, ASSET_KEYS.telescope, c);

  // Fireplace (40×36): stone hearth, mantel, glowing embers.
  [c, ctx] = canvas(40, 36);
  px(ctx, 0, 6, 40, 30, "#6a6460"); // stone surround
  px(ctx, 0, 0, 40, 6, "#8a6a48"); // mantel
  px(ctx, 0, 0, 40, 1, "#a88860");
  px(ctx, 6, 12, 28, 24, "#16100c"); // firebox
  px(ctx, 8, 28, 24, 8, "#e8903c"); // embers
  px(ctx, 12, 24, 16, 6, "#ffc060");
  px(ctx, 16, 20, 8, 6, "#fff0a0");
  px(ctx, 4, 34, 32, 2, "#4a443e");
  register(scene, ASSET_KEYS.fireplace, c);
}

/** Lighting effects: flame, soft glow, light shaft, dust mote, vignette. */
function registerEffects(scene: Phaser.Scene): void {
  let [c, ctx] = canvas(6, 9);
  px(ctx, 2, 0, 2, 2, "#ffe8a0");
  px(ctx, 1, 2, 4, 4, "#ffc060");
  px(ctx, 2, 6, 2, 3, "#ff9040");
  px(ctx, 2, 3, 2, 3, "#fff4c8");
  register(scene, ASSET_KEYS.flame, c);

  // Radial glow (additive): warm light around candles.
  [c, ctx] = canvas(64, 64);
  let g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, "rgba(255,200,110,0.55)");
  g.addColorStop(0.5, "rgba(255,160,60,0.16)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  register(scene, ASSET_KEYS.glow, c);

  // Slanted shaft of window light (additive): a soft trapezoid.
  [c, ctx] = canvas(56, 150);
  g = ctx.createLinearGradient(0, 0, 0, 150);
  g.addColorStop(0, "rgba(190,215,255,0.28)");
  g.addColorStop(1, "rgba(190,215,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(30, 0);
  ctx.lineTo(56, 150);
  ctx.lineTo(24, 150);
  ctx.closePath();
  ctx.fill();
  register(scene, ASSET_KEYS.lightShaft, c);

  [c, ctx] = canvas(2, 2);
  px(ctx, 0, 0, 2, 2, "rgba(255,240,200,0.9)");
  register(scene, ASSET_KEYS.mote, c);

  // Vignette: dark edges over the whole screen (480×270, camera-fixed).
  [c, ctx] = canvas(480, 270);
  g = ctx.createRadialGradient(240, 135, 90, 240, 135, 300);
  g.addColorStop(0, "rgba(10,6,12,0)");
  g.addColorStop(1, "rgba(10,6,12,0.7)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 480, 270);
  register(scene, ASSET_KEYS.vignette, c);
}
