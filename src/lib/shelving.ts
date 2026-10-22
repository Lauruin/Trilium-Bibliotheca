/**
 * lib/shelving.ts — which book stands where on which bookcase. Pure layout
 * logic (no Phaser), so it can be unit-tested and the scene can ask "how many
 * bookcases does this room need?" before it builds anything.
 *
 * Books fill a case tier by tier (top first); a book goes on the first tier it
 * still fits on. A shelf (tag) that doesn't fit in one case continues on the
 * next ("reading", "reading 2", …) instead of dropping books out of the world.
 */

import type { Book, RoomContents } from "../types";

/** Spine width from title length: 5–12 px, clamped. */
export function spineWidth(title: string): number {
  return Math.min(12, Math.max(5, 4 + Math.floor(title.length / 3)));
}

export interface Slot {
  book: Book;
  /** 0 = top tier. */
  tier: number;
  /** Left edge of the spine, measured from the case's inner left edge. */
  x: number;
}

export interface PackedCase {
  tag: string;
  color: string;
  slots: Slot[];
  /** Books that could not be shelved anywhere (only set on the last case, when maxCases is hit). */
  overflow: number;
}

export interface PackOptions {
  /** Usable width of one tier, in px. */
  innerW: number;
  tiers: number;
  maxCases: number;
}

export function packCases(contents: RoomContents, opts: PackOptions): PackedCase[] {
  const wanted: Array<{ tag: string; color: string; books: Book[] }> = [];
  if (contents.desk.length > 0) {
    wanted.push({ tag: "unfiled", color: contents.deskColor, books: contents.desk });
  }
  wanted.push(...contents.shelves);

  const cases: PackedCase[] = [];
  let dropped = 0;
  for (const shelf of wanted) {
    let remaining = shelf.books;
    for (let part = 1; remaining.length > 0; part++) {
      if (cases.length >= opts.maxCases) {
        dropped += remaining.length;
        break;
      }
      const tierX = new Array<number>(opts.tiers).fill(0);
      const slots: Slot[] = [];
      const left: Book[] = [];
      for (const book of remaining) {
        const w = spineWidth(book.title);
        const tier = tierX.findIndex((x) => x + w <= opts.innerW);
        if (tier === -1) {
          left.push(book);
          continue;
        }
        slots.push({ book, tier, x: tierX[tier] });
        tierX[tier] += w + 1;
      }
      cases.push({
        tag: part === 1 ? shelf.tag : `${shelf.tag} ${part}`,
        color: shelf.color,
        slots,
        overflow: 0,
      });
      remaining = left;
    }
  }
  if (dropped > 0 && cases.length > 0) cases[cases.length - 1].overflow = dropped;
  return cases;
}
