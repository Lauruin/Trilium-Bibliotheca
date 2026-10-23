/**
 * tree/places.ts — the PLACES in the world tree's crown: game modes and tools that live up in Yggdrasil.
 *
 * The root note's trunk is the world tree (layout.ts, forest mode): its trunk foot has the library door, the altar and the wisp's
 * lantern post (shrine.ts); its CROWN carries one limb per place, each with a lantern-fruit at the tip (E there opens the place).
 * A feature registers itself here when it is built (the clock, the mite's leaf reader, the gardener's glade, the editor ...) and
 * only places that are unlocked get a limb, so the crown grows as the player does (lib/unlocks.ts will filter `PLACES`).
 * Nothing in the vault is written for a place: they are code, not notes.
 */

export interface Place {
  /** Stable id (also the limb's branch id suffix: `place:<id>`). */
  id: string;
  title: string;
  /** One line shown in the HUD hint / panel. */
  help: string;
}

/** Every place the app has (registered by the steps that build them). */
export const PLACES: readonly Place[] = [];

/** `n` stand-in places for the demo page and the tests. */
export function demoPlaces(n: number): Place[] {
  const names = ["Clock", "Mite grove", "Gardener's glade", "Editor", "Observatory", "Archive", "Workshop", "Garden"];
  return Array.from({ length: Math.max(0, Math.min(names.length, n)) }, (_, i) => ({ id: `demo${i}`, title: names[i], help: `${names[i]} (a stand-in)` }));
}

/** A crown pad id -> its place (null for the foot's pads / unknown ids). */
export function placeOf(padId: string, places: readonly Place[] = PLACES): Place | null {
  return padId.startsWith("place:") ? places.find((p) => `place:${p.id}` === padId) ?? null : null;
}
