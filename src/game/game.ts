/**
 * game/game.ts — Phaser.Game factory.
 *
 * The game owns the canvas only. React mounts it once (App useEffect) and
 * destroys it on unmount. Everything crossing the boundary goes through the
 * EventBus (events.ts), never through direct references.
 *
 * Scale: fixed retro resolution (480×270), scaled to fit the host element —
 * crisp pixels via pixelArt (nearest-neighbour upscaling), letterboxed when
 * the window aspect doesn't match.
 */

import Phaser from "phaser";
import { BibliothecaScene } from "./BibliothecaScene";

/** Internal resolution — same constants as the scene's room rectangle. */
const GAME_W = 480;
const GAME_H = 270;

export function startGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_W,
    height: GAME_H,
    backgroundColor: "#0e0d16",
    pixelArt: true, // nearest-neighbour scaling; no texture smoothing
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: 700 },
        debug: false,
      },
    },
    scene: [BibliothecaScene],
  });
}