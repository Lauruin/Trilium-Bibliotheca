/**
 * tree/places.ts — the PLACES on limbs of the world tree: points of interest, game modes and tools.
 *
 * Yggdrasil's trunk (layout.ts, forest mode) carries one limb per place. LOW places hang near the foot (a few steps up the trunk): the
 * PORCH (your nest, where you start, with the altar) and the wisp's branch; later the other characters (Socrates ...) get a low branch too.
 * CROWN places sit high up: game modes and tools (the clock's observatory, the gardener, the editor ...). Each limb ends in a pad (shrine.ts);
 * `E` there opens the place. Only places that are unlocked get a limb, so the tree grows with the player (lib/unlocks.ts will filter PLACES).
 * Nothing in the vault is written for a place by merely existing: a place may keep its own settings in a note inside the Yggdrasil data folder
 * (lib/yggdrasil.ts `readPlaceProps` / `writePlaceProps`), created only when the user saves something for it.
 */

export type PlaceSlot = "low" | "crown";

export interface Place {
  /** Stable id (also the limb's branch id suffix: `place:<id>`). */
  id: string;
  title: string;
  /** One line shown in the HUD hint / panel. */
  help: string;
  slot: PlaceSlot;
  /** Unlock id (lib/unlocks.ts) the place needs before it gets a limb; absent = always there. */
  unlock?: string;
  /** The shrine pad this limb's tip carries: the altar, or the wisp's perch; absent = a plain place pad (`place:<id>`). */
  pad?: "altar" | "wisp";
}

/** Every place the app has (registered by the steps that build them). The first low place is the spawn. */
export const PLACES: readonly Place[] = [
  { id: "porch", title: "Porch", help: "your nest: the altar of the shrine", slot: "low", pad: "altar" },
  { id: "wisp", title: "Wisp", help: "the search wisp's branch", slot: "low", pad: "wisp" },
];

/** `n` stand-in crown places for the demo page and the tests. */
export function demoPlaces(n: number): Place[] {
  const names = ["Clock", "Reading grove", "Gardener's glade", "Editor", "Observatory", "Archive", "Workshop", "Garden"];
  return Array.from({ length: Math.max(0, Math.min(names.length, n)) }, (_, i) => ({ id: `demo${i}`, title: names[i], help: `${names[i]} (a stand-in)`, slot: "crown" as const }));
}

/** A pad id -> its place (null for the foot's door / unknown ids). */
export function placeOf(padId: string, places: readonly Place[] = PLACES): Place | null {
  if (padId.startsWith("place:")) return places.find((p) => `place:${p.id}` === padId) ?? null;
  return places.find((p) => p.pad === padId) ?? null;
}

/** The places that are available now (`can` = the unlock system's question; places without an `unlock` always are). */
export function visiblePlaces(places: readonly Place[], can: (unlockId: string) => boolean): Place[] {
  return places.filter((p) => !p.unlock || can(p.unlock));
}
