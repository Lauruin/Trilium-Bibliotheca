/** tools/seed-demo.js — one-off richer seed for screenshots/manual QA. Not part of check. */
import { readFileSync } from "node:fs";

const raw = readFileSync(".bootstrap.env", "utf8");
const URL = raw.match(/TRILIUM_URL=(.*)/m)?.[1];
const TOKEN = raw.match(/TRILIUM_TOKEN=(.*)/m)?.[1];
const H = { Authorization: TOKEN, "Content-Type": "application/json" };

async function api(path, init) {
  const r = await fetch(`${URL}/etapi${path}`, { headers: H, ...init });
  return r.json();
}

async function mk(parent, title, content, label) {
  const r = await api("/create-note", {
    method: "POST",
    body: JSON.stringify({ parentNoteId: parent, title, type: "text", content }),
  });
  if (label) {
    await api("/attributes", {
      method: "POST",
      body: JSON.stringify({ noteId: r.note.noteId, type: "label", name: label, value: "" }),
    });
  }
  return r.note;
}

const s = await api("/notes?search=Bibliotheca%20Demo");
let room = s.results.find((n) => n.title === "Bibliotheca Demo");
if (!room) room = await mk("root", "Bibliotheca Demo", "<p>The demo room.</p>", "");

const kids = await api(`/notes/${room.noteId}`);
if ((kids.childNoteIds ?? []).length < 3) {
  await mk(room.noteId, "Project Atlas", "<p>Maps and plans.</p>", "project");
  await mk(room.noteId, "Weekly review ritual", "<p>Every Friday: review the week…</p>", "project");
  await mk(room.noteId, "Reading list 2026", "<p>Books to read this year…</p>", "reading");
  await mk(room.noteId, "Loose thought: elevators", "<p>Where should the elevator go?</p>", "");
  const archive = await mk(room.noteId, "Archive", "<p>Older stuff.</p>", "");
  await mk(archive.noteId, "Old meeting notes", "<p>…</p>", "project");
  await mk(archive.noteId, "Inbox zero essay", "<p>…</p>", "reading");
  await mk(archive.noteId, "Someday: summer house", "<p>…</p>", "");
  console.log("seeded richer vault");
} else {
  console.log("vault already rich");
}