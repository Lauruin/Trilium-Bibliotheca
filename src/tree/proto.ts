/**
 * tree/proto.ts — standalone feel-test page for the Yggdrasil view (lizard3d.html):
 * demo tree, no Trilium (`?vault` = a synthetic vault through the real layout, `&layout=hub|forest` (default forest), `&trees=N` top-level folders, `&depth=D` levels, `&wave=fn:amp:freq` a wave on every branch). Keys: W up the branch / S down / A/D turn on it (M = free mode: W forward, A/D steer) · Space HOLD = aim a jump, release = leap
 * (snake / ant: hold to reach; bee / dragonfly / jay: take off) · X spider silk · 1/2/3 animal categories (again = next) · G grip · H auto-align (free mode) · N branch names · V camera (chase/level/fixed) · L look (voxel/low-poly) · wheel/+/− zoom · P pixel mode · R respawn.
 */

import { TreeScene, type Leaf } from "./TreeScene";
import { DEFAULT_LAYOUT_MODE, layoutTree, parseLayoutMode } from "./layout";
import { makeDemoWorld } from "./world3";
import type { LibraryTree, NoteInfo, TreeEdge } from "../types";

/** `&depth=D` = folder levels below the root (default 3; a light vault for screenshots uses 1-2). */
const DEPTH = Math.min(4, Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("depth")) || 3)));
/** `&trees=N` = N top-level folders (default 2-4). */
const TREES = Math.min(150, Math.max(0, Math.floor(Number(new URLSearchParams(location.search).get("trees")) || 0)));
/** `?vault` — a synthetic vault laid out by the real layoutTree (folders → branches, notes of every type → leaves, random lengths). */
function demoVault(): LibraryTree {
  const notes: Record<string, NoteInfo> = {};
  const edges: TreeEdge[] = [];
  const types = ["text", "text", "text", "code", "markdown", "canvas", "image", "text"];
  let n = 0;
  const rnd = (): number => {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    return n / 0x7fffffff;
  };
  n = 7;
  const add = (id: string, parent: string | null, folder: boolean, tag?: string): void => {
    notes[id] = { noteId: id, title: id, type: folder ? "text" : types[Math.floor(rnd() * types.length)], labels: tag ? { [tag]: "" } : {}, hasChildren: folder };
    if (parent) edges.push({ parentNoteId: parent, noteId: id, notePosition: 0 });
  };
  add("root", null, true);
  const grow = (parent: string, depth: number): void => {
    const folders = depth >= DEPTH ? 0 : parent === "root" && TREES > 0 ? TREES : 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < folders; i++) {
      const id = `${parent}.f${i}`;
      add(id, parent, true);
      grow(id, depth + 1);
    }
    const notesHere = 2 + Math.floor(rnd() * 9);
    for (let i = 0; i < notesHere; i++) add(`${parent}.n${i}`, parent, false, ["idea", "todo", "ref", "log"][Math.floor(rnd() * 4)]);
  };
  grow("root", 0);
  return { rootNoteId: "root", notes, edges, truncated: false };
}
const params = new URLSearchParams(location.search);
const useVault = params.has("vault");
/** `&layout=hub|forest` (default forest, not the stored preference: screenshots stay reproducible). */
/** `&wave=fn:amp:freq` (e.g. `helix:0.08:3`) forces that wave on every folder, to look at the shapes. */
const waveSpec = (params.get("wave") ?? "").split(":");
const vaultTree = useVault ? demoVault() : null;
const waveOv = waveSpec.length === 3 && vaultTree
  ? new Map(Object.keys(vaultTree.notes).map((id) => [id, { waveFn: waveSpec[0], wave: Number(waveSpec[1]), waveFreq: Number(waveSpec[2]) }]))
  : undefined;
const vault = vaultTree ? layoutTree(vaultTree, { mode: parseLayoutMode(params.get("layout")) ?? DEFAULT_LAYOUT_MODE, overrides: waveOv }) : null;
const startBranch = vault ? vault.rootBranchId : "trunk";
const startS = vault ? 120 : 220;

const hud = document.getElementById("hud") as HTMLDivElement;
const gripBox = document.getElementById("grip") as HTMLDivElement;
const gripFill = gripBox.firstElementChild as HTMLElement;
const world = vault ? vault.world : makeDemoWorld();

// a few demo "notes" (leaves) scattered along the branches
const leaves: Leaf[] = vault ? vault.leaves : [];
const KINDS = ["broad", "needle", "maple", "blossom", "fruit"] as const;
const TYPES = ["text", "code", "markdown", "canvas", "image"] as const;
for (const b of vault ? [] : world.branches.values()) {
  for (let s = 120; s < b.total - 60; s += 160) {
    const side = Math.sin(s * 0.37) > 0 ? 1 : -1;
    const k = leaves.length % KINDS.length;
    const size = [0.6, 0.9, 1.25, 1.6, 2][(s / 160 + leaves.length) % 5 | 0];
    leaves.push({
      id: `${b.id}:${s}`, branchId: b.id, s, th: side * (1.1 + ((s * 13) % 7) / 10),
      color: ["#4f9a3c", "#7fae3a", "#c2a838", "#b8602e", "#3f8f7a"][s % 5], title: `Demo note ${leaves.length + 1}`,
      kind: KINDS[k], size, type: TYPES[k],
    });
  }
}

let scene: TreeScene;
try {
  scene = new TreeScene(document.getElementById("view") as HTMLElement, world, startBranch, startS);
} catch (e) {
  hud.textContent = "WebGL unavailable in this browser — the 3D tree needs it.";
  throw e;
}
scene.setWorld(world, leaves, startBranch, startS, new Map([...world.branches.keys()].map((id) => [id, id === 'root' ? 'Library' : id])));
if (vault) {
  // pretend the content lengths were measured: log-uniform 20 .. 40000 characters
  const lens = new Map<string, number>();
  leaves.forEach((l, i) => lens.set(l.id, Math.round(20 * Math.pow(2000, (Math.sin(i * 12.9898) * 43758.5453) % 1 * 0.5 + 0.5))));
  scene.setLeafLengths(lens);
}
(window as unknown as { __treeScene: TreeScene }).__treeScene = scene;
scene.onInteract = (leaf) => (hud.dataset.last = `opened ${leaf.title}`);
scene.onHud = (h) => {
  gripBox.style.display = h.gripOn && h.grip < 0.999 ? "block" : "none";
  gripFill.style.width = `${h.grip * 100}%`;
  gripFill.style.background = h.grip > 0.5 ? "#ffe080" : h.grip > 0.25 ? "#ff9a40" : "#ff4a38";
  hud.innerHTML =
    `<b>${h.animal}</b> on ${h.branch} · θ=${((h.th * 180) / Math.PI).toFixed(0)}° φ=${((h.phi * 180) / Math.PI).toFixed(0)}°${h.airborne ? " · AIRBORNE" : ""}${h.reaching ? " · REACHING" : ""} · camera: ${h.camera} · look: ${h.look}` +
    `${h.climb ? ` · <b>Shift</b> climb into ${h.climb}` : ""}${h.nearLeaf ? ` · <b>E</b> read “${h.nearLeaf.title}”` : ""}${hud.dataset.last ? ` · ${hud.dataset.last}` : ""}<br>` +
    `${h.moveMode === 'guided' ? 'W up the branch · S down · A/D turn on it' : 'W forward · A/D steer'} · M move: ${h.moveMode} · hold Space = aim a jump (arc preview, auto-target, A/D W/S), release = leap · snake: hold = reach, steer it with WASD · squirrel glide: W dive / S flare · bee/dragonfly/jay: Space = take off · 1/2/3 animal category (again = next) · G grip ${h.gripOn ? "ON" : "off"} · H auto-align ${h.moveMode === 'free' ? (h.autoAlign ? 'on' : 'off') : 'n/a'} · N names · F foliage · K shadows · V camera · L look · wheel/+/− zoom · P pixel mode · R respawn`;
  (window as unknown as { __tree: unknown }).__tree = { head: scene.creature.head, air: !!scene.creature.air, reach: !!scene.creature.reach, animal: scene.creature.animal.id, zoom: scene.zoomMul, chase: scene.chase, camera: scene.camMode, look: scene.look, grip: scene.creature.grip };
};
addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r" && !e.repeat) scene.respawn(startBranch, startS);
});
scene.start();
