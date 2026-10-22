/**
 * ui/RoomPlaque.tsx — the current room's description, shown as a wall plaque.
 *
 * A room is a Trilium note; if that note has text content, it is the room's
 * description. We fetch it when the room changes, flatten it to plain text and
 * show a short excerpt; clicking the plaque opens the full note like a book.
 * Rooms without content (or non-text notes) show nothing.
 */

import { useEffect, useState } from "react";
import { bus } from "../game/events";
import { getClient, useAppStore } from "../state/store";

const EXCERPT_MAX = 240;
const TEXT_TYPES = new Set(["text", "markdown", "code"]);

/** noteId → flattened text ("" = none). Cleared when the tree is re-walked. */
const cache = new Map<string, string>();
let cacheTree: unknown = null;

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("p,br,li,h1,h2,h3,h4,div").forEach((el) => el.append(" "));
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function RoomPlaque(props: { onOpen: (noteId: string) => void }): React.JSX.Element | null {
  const state = useAppStore();
  // The folder whose door the player stands at wins over the room they are in.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => bus.on("focus:note", ({ noteId }) => setFocusId(noteId)), []);
  const currentRoom = state.path[state.path.length - 1];
  const roomId = focusId ?? currentRoom;
  const type = roomId ? state.tree?.notes[roomId]?.type : undefined;
  const heading = focusId !== null ? state.tree?.notes[focusId]?.title : undefined;
  const [text, setText] = useState("");
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  useEffect(() => {
    if (cacheTree !== state.tree) {
      cache.clear();
      cacheTree = state.tree;
    }
    setText("");
    if (!roomId || !type || !TEXT_TYPES.has(type) || state.overview) return;
    const hit = cache.get(roomId);
    if (hit !== undefined) {
      setText(hit);
      return;
    }
    const client = getClient();
    if (!client) return;
    let cancelled = false;
    client
      .getNoteContent(roomId)
      .then((raw) => {
        const flat = type === "text" ? htmlToText(raw) : raw.replace(/\s+/g, " ").trim();
        cache.set(roomId, flat);
        if (!cancelled) setText(flat);
      })
      .catch(() => cache.set(roomId, "")); // no description is not an error worth a toast
    return () => {
      cancelled = true;
    };
  }, [roomId, type, state.tree, state.overview]);

  if (text === "" || hiddenFor === roomId) return null;
  const excerpt = text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text;
  return (
    <aside className="plaque" aria-label="Room description">
      <button className="plaque-close" title="Hide" onClick={() => setHiddenFor(roomId ?? null)}>
        ✕
      </button>
      {heading && <div className="plaque-head">{heading}</div>}
      <button className="plaque-body" title="Read the full note" onClick={() => roomId && props.onOpen(roomId)}>
        {excerpt}
      </button>
    </aside>
  );
}
