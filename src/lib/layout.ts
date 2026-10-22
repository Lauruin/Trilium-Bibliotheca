/**
 * lib/layout.ts — where rooms sit in the world, and how that survives.
 *
 * "Layout is data, not a hand-authored map" (game-ui.md): each room's grid
 * cell is stored ON the room's own note as two labels (`biblio_x`, `biblio_y`),
 * so it is synced by whatever already syncs Trilium and travels with the note
 * on rename/move. There is no sidecar file to go stale (the debate in
 * persona-debate.md rejected a sidecar for exactly that reason).
 *
 * Rules:
 *   - Manual placements (labels present) are ALWAYS respected. This is the
 *     "pure manual placement" the persona debate asked for.
 *   - Rooms without labels are auto-placed deterministically (spiral fill
 *     from the origin) so a new folder is reachable without any user effort;
 *     auto-placement only fills gaps, never overrides stored coordinates.
 *   - Dragging a room in overview mode writes both labels back to Trilium.
 *
 * Write path: labels are attributes. GET /notes/{id} returns attribute ids,
 * so we can PATCH/POST/DELETE precisely. A note's attribute list can change
 * behind our back (another device), so writes re-fetch the note first.
 */

import { LABELS } from "../config";
import type { LibraryTree, RoomPlacement } from "../types";
import type { TriliumClient } from "./trilium/client";
import { setLabel } from "./labels";

/**
 * Compute the placement map for all rooms in the tree.
 *
 * Deterministic order matters: `roomIds` is the walk order (BFS), so
 * auto-placement is stable across reloads as long as the vault didn't
 * change. Rooms that gained manual labels since keep them.
 */
export function computePlacements(
  tree: LibraryTree,
  roomIds: string[],
): Map<string, RoomPlacement> {
  const placements = new Map<string, RoomPlacement>();
  const occupied = new Set<string>();
  const cell = (x: number, y: number) => `${x},${y}`;

  // Pass 1 — manual placements win their cells.
  for (const id of roomIds) {
    const labels = tree.notes[id]?.labels ?? {};
    const xRaw = labels[LABELS.roomX];
    const yRaw = labels[LABELS.roomY];
    if (xRaw !== undefined && yRaw !== undefined) {
      const x = Number.parseInt(xRaw, 10);
      const y = Number.parseInt(yRaw, 10);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        placements.set(id, { noteId: id, x, y, manual: true });
        occupied.add(cell(x, y));
      }
    }
  }

  // Pass 2 — auto-place the rest in reading order: rightward first (6 per
  // row), then wrap downward. Deterministic, and new rooms grow in the
  // direction a side-scroller world reads naturally.
  for (const id of roomIds) {
    if (placements.has(id)) continue;
    if (id === tree.rootNoteId) {
      // The root room sits at the origin unless the user moved it.
      if (!occupied.has(cell(0, 0))) {
        placements.set(id, { noteId: id, x: 0, y: 0, manual: false });
        occupied.add(cell(0, 0));
      }
      continue;
    }
    // A fresh generator per room: `break` closes a generator, so sharing one
    // across rooms would stop placing anything after the first auto-placed room.
    for (const [x, y] of autoCells()) {
      if (!occupied.has(cell(x, y))) {
        placements.set(id, { noteId: id, x, y, manual: false });
        occupied.add(cell(x, y));
        break;
      }
    }
  }

  return placements;
}

/** Generator of grid cells in reading order: row-major, 6 columns, growing down. */
function* autoCells(): Generator<[number, number]> {
  for (let row = 0; ; row++) {
    for (let col = 0; col < 6; col++) yield [col, row];
  }
}

/**
 * Persist a room position to Trilium as biblio_x / biblio_y labels.
 * Re-fetches the note first: attribute ids are the write handle, and the
 * list we walked may be stale (edits from another device, our own earlier
 * writes in this session).
 *
 * Returns nothing; throws TriliumApiError on failure — the UI surfaces it.
 */
export async function saveRoomPosition(
  client: TriliumClient,
  noteId: string,
  x: number,
  y: number,
): Promise<void> {
  // setLabel edits OWN labels only (an inheritable biblio_x on an ancestor must
  // never be patched through this note), matches names case-insensitively and
  // re-fetches the note first.
  await setLabel(client, noteId, LABELS.roomX, String(x));
  await setLabel(client, noteId, LABELS.roomY, String(y));
}
