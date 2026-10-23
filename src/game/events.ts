/**
 * game/events.ts — the Phaser ↔ React bridge.
 *
 * The standard "game canvas + HTML overlay" split (game-ui.md): Phaser owns
 * the canvas, React owns DOM (HUD, popups, settings). Neither imports the
 * other directly; they exchange typed events through this bus. Keeping the
 * event names in one file makes the contract greppable.
 *
 * Naming convention: `scene:*` flows React → Phaser, `layout:*` and the
 * interaction events (book/search/socrates/notice/hud) flow Phaser → React.
 */

import type { LibraryTree, RoomPlacement } from "../types";

/** Payload for hud:state — everything the HUD needs about the current room. */
export interface HudState {
  /** noteIds from the library root down to the current room (inclusive). */
  path: string[];
  /** Room count visible in the world (for the HUD's overview hint). */
  roomCount: number;
  /** Whether overview (edit) mode is currently on. */
  overview: boolean;
}

/** Payload of scene:load-world — the scene's entire world input. */
export interface LoadWorldPayload {
  tree: LibraryTree;
  placements: Map<string, RoomPlacement>;
  rootNoteId: string;
}

export interface GameEvents {
  // Phaser → React
  "hud:state": HudState;
  "book:open": { noteId: string };
  "search:open": undefined;
  "socrates:open": undefined;
  /** Sent after every room draw: how many wall slots exist and how the floor pieces fit. */
  "build:slots": { roomId: string; wallSlots: number; floorFit: number; floorHidden: number };
  /** The folder (door) the player is standing at, or null — drives the description plaque. */
  "focus:note": { noteId: string | null };
  "notice": { level: "info" | "warn" | "error"; text: string };
  /** The library scene finished creating itself (it is started lazily, the first time the library is needed): hand it the world. */
  "scene:ready": undefined;
  /**
   * Overview-mode drag result. React persists it (biblio_x/biblio_y labels);
   * the scene has already applied the move to its own placement map, so no
   * rebuild is needed — a failed persist only means the change is lost on
   * the next full reload, and React surfaces that as a notice.
   */
  "layout:move": { noteId: string; x: number; y: number };

  // React → Phaser
  /**
   * Build mode: draw the current room as if these labels were set (null value =
   * label absent; null payload = clear the preview) WITHOUT saving anything.
   */
  "build:preview": { labels: Record<string, string | null> | null };
  /** Re-draw the current room from the (already patched) tree — after an applied or undone edit. */
  "scene:redraw": undefined;
  /** On-screen touch control pressed/released (phones have no keyboard). */
  "input:touch": { action: "left" | "right" | "jump" | "interact" | "up"; down: boolean };
  /** Hand the scene its world (initial load and after settings/refresh). */
  "scene:load-world": LoadWorldPayload;
  /** Navigate to a room (breadcrumb click, overview click). */
  "scene:enter-room": { noteId: string };
  /** Toggle overview mode (drag rooms to re-arrange). */
  "scene:overview": { on: boolean };
  /** React pauses the scene while any modal is open (keys must not leak). */
  "scene:paused": { on: boolean };
}

type Handler<T> = (payload: T) => void;

/**
 * Minimal typed emitter. Deliberately dependency-free (a third of `mitt`'s
 * job, the half we need). `off` returns the handler for easy cleanup.
 */
export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof E>(event: K, handler: Handler<E[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<E[K]>)(payload);
  }
}

/** The app-wide singleton bus instance. */
export const bus = new EventBus<GameEvents>();