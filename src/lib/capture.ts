/**
 * lib/capture.ts — quick capture: get a thought into Trilium in one step.
 *
 * Captured text becomes a text note under the "inbox": the note carrying the
 * `#biblio_inbox` label. If none exists yet, an "Inbox" note is created under
 * the library root and labelled, so the first capture just works and the user
 * can later move/rename the inbox (the label travels with the note).
 */

import { LABELS } from "../config";
import type { TriliumClient } from "./trilium/client";

/** Escape text for embedding in the HTML body of a Trilium text note. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TITLE_MAX = 60;

/**
 * Pure: raw captured text → note title + HTML body. The title is the first
 * non-empty line (shortened); blank-line-separated chunks become paragraphs.
 * Returns null for empty input.
 */
export function noteFromText(text: string): { title: string; content: string } | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const firstLine = trimmed.split(/\r?\n/).find((l) => l.trim() !== "") ?? trimmed;
  const clean = firstLine.trim();
  const title = clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
  const content = trimmed
    .split(/\r?\n\s*\r?\n/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
  return { title, content };
}

/**
 * Share-target query (`?title=&text=&url=`, sent by the OS share sheet) → text
 * to prefill the capture box, or null if nothing was shared. Android often puts
 * the link in `text`, so a url already contained in the text isn't repeated.
 */
export function sharedText(search: string): string | null {
  const q = new URLSearchParams(search);
  const title = (q.get("title") ?? "").trim();
  const text = (q.get("text") ?? "").trim();
  const url = (q.get("url") ?? "").trim();
  const parts = [title, text, url && !text.includes(url) ? url : ""].filter((p, i, a) => p && a.indexOf(p) === i);
  return parts.length > 0 ? parts.join("\n") : null;
}

/** Find the inbox note id, creating (and labelling) an "Inbox" under `rootNoteId` if absent. */
export async function ensureInbox(client: TriliumClient, rootNoteId: string): Promise<string> {
  const found = await client.searchNotes(`#${LABELS.inbox}`);
  const hit = found.results[0];
  if (hit) return hit.noteId;
  const created = await client.createNote({
    parentNoteId: rootNoteId,
    title: "Inbox",
    type: "text",
    content: "",
  });
  await client.createAttribute({ noteId: created.note.noteId, type: "label", name: LABELS.inbox });
  return created.note.noteId;
}

/** Capture `text` as a new note in the inbox. Returns the new note's id, or null if text was empty. */
export async function captureNote(
  client: TriliumClient,
  rootNoteId: string,
  text: string,
): Promise<string | null> {
  const note = noteFromText(text);
  if (!note) return null;
  const inboxId = await ensureInbox(client, rootNoteId);
  const created = await client.createNote({ parentNoteId: inboxId, type: "text", ...note });
  return created.note.noteId;
}
