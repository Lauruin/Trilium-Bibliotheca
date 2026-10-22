/**
 * game/decor.ts — slot-based decoration (world building, phase 2).
 *
 * A room has wall SLOTS (one per 96px along the back wall) and floor SLOTS
 * (left→right in the free space after the last bookcase). Each slot holds a
 * decor kind. Choices are stored as one CSV label per area on the room note:
 *   biblio_wall       window,painting,-,auto,banner
 *   biblio_furniture  plant,armchair,lamp
 * `-` = deliberately empty, `auto` (or a missing entry) = the deterministic
 * default, so editing ONE slot is one label write and a room with no labels
 * looks exactly like before. Unknown entries are kept verbatim when a CSV is
 * rewritten (a newer app version may know them) and are drawn as the default.
 */

export const WALL_KINDS = ["window", "painting", "clock", "banner"] as const;
export const FLOOR_KINDS = ["plant", "armchair", "globe", "lamp", "bust", "telescope", "fireplace"] as const;
export const CASE_STYLES = ["oak", "walnut", "ebony", "whitewash"] as const;
export const MAX_SPAN = 4;
export const RUG_STYLES = ["crimson", "moss", "navy", "none"] as const;

/** Width (px) each floor piece occupies, including breathing room. */
export const FLOOR_WIDTH: Record<(typeof FLOOR_KINDS)[number], number> = {
  plant: 18,
  armchair: 30,
  globe: 20,
  lamp: 14,
  bust: 18,
  telescope: 26,
  fireplace: 40,
};

export const WALL_SLOT_X0 = 130;
export const WALL_SLOT_STRIDE = 96;
export const MAX_ENTRIES = 24;
export const MAX_CSV_LEN = 200;

export const EMPTY = "-";
export const AUTO = "auto";

/** Number of wall slots that fit a room of this width. */
export function wallSlotCount(roomW: number): number {
  let n = 0;
  for (let x = WALL_SLOT_X0; x < roomW - 40; x += WALL_SLOT_STRIDE) n++;
  return n;
}

/** CSV label value → entries (lowercased, trimmed, capped). Missing/garbled → []. */
export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "")
    .slice(0, MAX_ENTRIES);
}

/** Entries padded with `auto` to at least `n` slots (extra/unknown entries kept). */
export function slotsOf(value: string | undefined, n: number): string[] {
  const entries = parseCsv(value);
  while (entries.length < n) entries.push(AUTO);
  return entries;
}

/**
 * Entries → label value; null (= remove the label) when nothing is customised.
 * Trailing `auto`s are dropped; the result is capped to MAX_CSV_LEN.
 */
export function toCsv(entries: string[]): string | null {
  const e = [...entries];
  while (e.length > 0 && e[e.length - 1] === AUTO) e.pop();
  if (e.length === 0) return null;
  let out = e.join(",");
  while (out.length > MAX_CSV_LEN && e.length > 0) {
    e.pop();
    out = e.join(",");
  }
  return out === "" ? null : out;
}

export function isWallKind(k: string): boolean {
  return (WALL_KINDS as readonly string[]).includes(k);
}
export function isFloorKind(k: string): k is (typeof FLOOR_KINDS)[number] {
  return (FLOOR_KINDS as readonly string[]).includes(k);
}
export function parseRug(value: string | undefined): (typeof RUG_STYLES)[number] {
  const v = (value ?? "").trim().toLowerCase();
  return (RUG_STYLES as readonly string[]).includes(v) ? (v as (typeof RUG_STYLES)[number]) : "crimson";
}

/** Next/previous option in a cycle list (wraps). */
export function cycle<T>(options: readonly T[], current: T, dir: 1 | -1): T {
  const i = options.indexOf(current);
  return options[(i + dir + options.length * 2) % options.length];
}

/** Options a wall slot can cycle through, in order. */
export const WALL_OPTIONS: readonly string[] = [AUTO, ...WALL_KINDS, EMPTY];
/** Options a floor slot can cycle through, in order. */
export const FLOOR_OPTIONS: readonly string[] = [AUTO, ...FLOOR_KINDS, EMPTY];

export function parseCase(value: string | undefined): (typeof CASE_STYLES)[number] {
  const v = (value ?? "").trim().toLowerCase();
  return (CASE_STYLES as readonly string[]).includes(v) ? (v as (typeof CASE_STYLES)[number]) : "oak";
}

/** `biblio_span`: integer 0..MAX_SPAN; anything else counts as 0. */
export function parseSpan(value: string | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) ? Math.min(MAX_SPAN, Math.max(0, n)) : 0;
}
