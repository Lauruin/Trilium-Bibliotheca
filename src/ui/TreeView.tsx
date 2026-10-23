/**
 * ui/TreeView.tsx — the vault as a FOREST you climb as an animal (Yggdrasil view), voxel or low-poly.
 *
 * The root is a hub, each top-level folder a tree, other folders are branches, notes are leaves; walk (W, steer A/D),
 * aim and leap (hold/release Space), spin silk (X, spiders), climb into side branches (hold Shift at a branch's base),
 * edit the branch you stand on (B: ui/BranchPanel.tsx, saved as labels via lib/treeedit.ts), and press E next to a leaf
 * to read it in the normal reader. Everything 3D lives in src/tree/ (pure layout + simulation, three.js
 * renderer); this component only mounts it, feeds it the walked LibraryTree and shows
 * the HUD (breadcrumb, hints, grip bar, look/camera buttons). Leaf sizes follow the notes'
 * length: lib/leafsize.ts measures them lazily in the background (cached by blob id).
 */

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { bus } from "../game/events";
import { layoutTree, pathToRoot, type LayoutMode, type TreeLayout } from "../tree/layout";
import { loadLayoutMode, saveLayoutMode } from "../tree/layoutpref";
import { ANIMALS, ANIMAL_CATEGORIES, TreeScene, type HudInfo } from "../tree/TreeScene";
import { measureLeaves } from "../lib/leafsize";
import { LabelConflictError } from "../lib/labels";
import { planChanges, recalcAll, saveChanges, setPending, type Pending } from "../lib/treeedit";
import { journal, undoEdit } from "../lib/worldedit";
import { getClient, getState, notify, useAppStore } from "../state/store";
import type { LibraryTree } from "../types";
import { setTreeBridge } from "../tree/bridge";
import { BranchPanel } from "./BranchPanel";
import { PerfOverlay } from "./PerfOverlay";
import { ShrinePanel, type ShrineSection } from "./ShrinePanel";

/** A branch's display name: the folder's title ("Library" for the root); a ground root (`root:<tree>`) is "<tree> roots". */
function branchTitle(id: string, tree: LibraryTree | null): string {
  if (tree && id === tree.rootNoteId) return "Library";
  if (id.startsWith("root:")) return `${tree?.notes[id.slice(5)]?.title ?? id.slice(5)} roots`;
  return tree?.notes[id]?.title ?? id;
}

/** Folder titles by branch id (the root folder is "Library"; ground roots are left out so they get no name sign). */
function titlesOf(layout: TreeLayout, tree: LibraryTree | null): Map<string, string> {
  const titles = new Map<string, string>();
  for (const [id, b] of layout.world.branches) if (!b.root) titles.set(id, branchTitle(id, tree)); // ground roots get no sign / bubble
  return titles;
}

export function TreeView(props: {
  /** Keyboard input is ignored while a dialog is open. */
  enabled: boolean;
  onOpenNote: (noteId: string) => void;
  /** The shrine's door: walk into the library. */
  onEnterLibrary: () => void;
  /** The wisp: open the search. */
  onOpenSearch: () => void;
}): React.JSX.Element {
  const state = useAppStore();
  const tree = state.tree;
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TreeScene | null>(null);
  const [hud, setHud] = useState<HudInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped when a label write changed the (mutated-in-place) tree. */
  const [version, setVersion] = useState(0);
  /** Branch being edited (key B) and its pending, not yet saved, property edits. */
  const [editId, setEditId] = useState<string | null>(null);
  const [pending, setPendingState] = useState<Pending>({});
  const [busy, setBusy] = useState(false);
  /** The shrine panel (E at the altar). */
  const [shrineOpen, setShrineOpen] = useState(false);
  const deferredPending = useDeferredValue(pending);
  /** forest (every top-level folder its own tree, joined by ground roots) or hub (the original); key Y, remembered. */
  const [mode, setMode] = useState<LayoutMode>(loadLayoutMode);
  const layout = useMemo(
    () => (tree ? layoutTree(tree, { mode, overrides: editId && Object.keys(deferredPending).length > 0 ? new Map([[editId, deferredPending]]) : undefined }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, version, editId, deferredPending, mode],
  );
  const toggleMode = (): void =>
    setMode((m) => {
      const next: LayoutMode = m === "forest" ? "hub" : "forest";
      saveLayoutMode(next);
      return next;
    });
  const openRef = useRef(props.onOpenNote);
  openRef.current = props.onOpenNote;
  const propsRef = useRef(props);
  propsRef.current = props;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const hudRef = useRef(hud);
  hudRef.current = hud;
  const shrineOpenRef = useRef(shrineOpen);
  shrineOpenRef.current = shrineOpen;
  const toggleModeRef = useRef(toggleMode);
  toggleModeRef.current = toggleMode;
  const lengths = useRef(new Map<string, number>());
  const applied = useRef<TreeLayout | null>(null);
  const hasLayout = layout !== null;

  useEffect(() => bus.on("scene:redraw", () => setVersion((v) => v + 1)), []);

  // the scene lives as long as the view: later layouts (edits, refreshes) replace its world in place
  useEffect(() => {
    const first = layoutRef.current;
    if (!first || !hostRef.current) return;
    let scene: TreeScene;
    try {
      scene = new TreeScene(hostRef.current, first.world, first.rootBranchId, 120);
    } catch (e) {
      setError("The tree view needs WebGL, which is not available in this browser.");
      console.warn("[tree] no WebGL", e);
      return;
    }
    setError(null);
    scene.setWorld(first.world, first.leaves, first.rootBranchId, 120, titlesOf(first, getState().tree));
    applied.current = first;
    scene.onInteract = (leaf) => openRef.current(leaf.id);
    scene.setShrine(true);
    scene.moveToShrine(); // you start (and arrive back from the library) at the shrine's door
    scene.onPad = (id) => {
      if (id === "door") propsRef.current.onEnterLibrary();
      else if (id === "wisp") propsRef.current.onOpenSearch();
      else setShrineOpen(true);
    };
    setTreeBridge({ has: (id) => scene.locate(id) !== null, walkTo: (id) => scene.walkToNote(id), lightTo: (id) => scene.lightNote(id) });
    scene.onWalkEnd = (status, reason) => {
      if (status === "failed") notify("warn", `Could not walk there: ${reason}`);
    };
    let last = 0;
    scene.onHud = (h) => {
      const now = performance.now();
      if (now - last > 90) {
        last = now;
        setHud(h);
      }
    };
    sceneRef.current = scene;
    (window as unknown as { __treeScene: TreeScene }).__treeScene = scene;
    scene.start();
    // leaf size = note length: measured lazily (the first batch is the cache), applied as it arrives
    const ctrl = new AbortController();
    const client = getClient();
    const t = getState().tree;
    if (client && t) {
      const notes = first.leaves.flatMap((l) => {
        const n = t.notes[l.id];
        return n ? [{ noteId: n.noteId, type: n.type, blobId: n.blobId }] : [];
      });
      void measureLeaves(client, notes, {
        signal: ctrl.signal,
        onBatch: (m) => {
          for (const [id, n] of m) lengths.current.set(id, n);
          scene.setLeafLengths(lengths.current);
        },
      }).catch((e) => console.warn("[tree] leaf sizes", e));
    }
    return () => {
      ctrl.abort();
      setTreeBridge(null);
      scene.dispose();
      sceneRef.current = null;
      applied.current = null;
    };
  }, [hasLayout]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !layout || applied.current === layout) return;
    const modeChanged = applied.current !== null && applied.current.mode !== layout.mode;
    applied.current = layout;
    if (modeChanged) {
      // another layout moves every tree: keep the animal's branch when it still exists, else it lands on the stump
      const head = scene.creature.head;
      const b = layout.world.branches.get(head.b);
      scene.setWorld(layout.world, layout.leaves, b ? head.b : layout.rootBranchId, b ? Math.min(head.s, Math.max(0, b.total - 4)) : 120, titlesOf(layout, tree));
    } else scene.replaceWorld(layout.world, layout.leaves, titlesOf(layout, tree));
    scene.setLeafLengths(lengths.current);
  }, [layout, tree]);

  // B: edit the properties of the branch you are on (again: close)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !props.enabled || shrineOpenRef.current) return;
      if (e.key.toLowerCase() === "y") {
        toggleModeRef.current(); // layout: forest / hub
        return;
      }
      if (e.key.toLowerCase() !== "b") return;
      setEditId((cur) => {
        if (cur) {
          setPendingState({});
          return null;
        }
        const id = hudRef.current?.branch ?? null;
        return id && layoutRef.current?.info.has(id) ? id : null; // only folders: not silk threads, not ground roots
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.enabled]);

  // the edited folder vanished (refresh) → close the editor instead of leaving it invisibly open
  useEffect(() => {
    if (editId && layout && !layout.info.get(editId)) {
      setEditId(null);
      setPendingState({});
    }
  }, [editId, layout]);

  const closeEditor = (): void => {
    setEditId(null);
    setPendingState({});
  };
  const run = async (plan: (note: LibraryTree["notes"][string]) => ReturnType<typeof recalcAll>): Promise<void> => {
    const client = getClient();
    const live = getState().tree;
    const info = editId ? layout?.info.get(editId) : undefined;
    if (!client || !live || !editId || !info) return;
    const note = live.notes[editId];
    if (!note) return;
    setBusy(true);
    try {
      const changes = plan(note);
      const snapshot = pending;
      const n = await saveChanges(client, live, editId, changes);
      // clear what was saved; edits made while the writes were in flight stay pending
      setPendingState((p) => Object.fromEntries(Object.entries(p).filter(([k, v]) => snapshot[k as keyof Pending] !== v)) as Pending);
      notify("info", n === 0 ? "Nothing changed." : `${n} propert${n === 1 ? "y" : "ies"} saved on “${note.title}”`);
    } catch (err) {
      notify("error", err instanceof LabelConflictError ? "That property was changed elsewhere — reopen the editor." : `Saving failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.enabled = props.enabled && !shrineOpen;
  }, [props.enabled, layout, shrineOpen]);

  const shrineSections: ShrineSection[] = [
    {
      id: "library",
      title: "The library",
      help: "The side-scrolling rooms: every folder a room, every note a book. The door in the stump's foot leads there too; T brings you back out.",
      body: (
        <div className="shrine-row">
          <button
            onClick={() => {
              setShrineOpen(false);
              props.onEnterLibrary();
            }}
          >
            enter the library
          </button>
        </div>
      ),
    },
    {
      id: "wisp",
      title: "The wisp",
      help: "It rests on the lantern post here and answers to a click (or E beside it) with the search. In search results, “take me there” walks you to a note and “light the way” sends the wisp to hover beside it with a beam.",
      body: (
        <div className="shrine-row">
          <button className={hud?.wispMode === "perch" ? "active" : ""} onClick={() => sceneRef.current?.setWispMode("perch")}>
            stays here
          </button>
          <button className={hud?.wispMode === "follow" ? "active" : ""} onClick={() => sceneRef.current?.setWispMode("follow")}>
            follows me
          </button>
          <button
            onClick={() => {
              setShrineOpen(false);
              props.onOpenSearch();
            }}
          >
            search
          </button>
        </div>
      ),
    },
  ];

  const title0 = (id: string): string => tree?.notes[id]?.title ?? id;
  const crumbs = layout && hud ? pathToRoot(layout, hud.branch) : [];
  const title = (id: string): string => branchTitle(id, tree);

  return (
    <div className="tree-view">
      <div ref={hostRef} className="tree-canvas" />
      {editId && layout?.info.get(editId) && (
        <BranchPanel
          title={`${editId === tree?.rootNoteId ? "Library" : tree?.notes[editId]?.title ?? editId} — branch properties`}
          info={layout.info.get(editId)!}
          pending={pending}
          kind={editId === tree?.rootNoteId ? "hub" : layout.parentOf.get(editId) === tree?.rootNoteId ? "trunk" : "branch"}
          busy={busy}
          canUndo={journal.canUndo}
          foliage={{ on: hud?.foliage ?? true, density: hud?.foliageDensity ?? 1 }}
          onFoliage={(on, density) => sceneRef.current?.setFoliage(on, density)}
          onChange={(k, v) => setPendingState((p) => setPending(p, k, v))}
          onSave={() => void run((note) => planChanges(note, layout.info.get(editId)!, pending))}
          onRecalcAll={() => void run((note) => recalcAll(note))}
          onUndo={() => {
            const client = getClient();
            const live = getState().tree;
            if (client && live) void undoEdit(client, live).then((e) => notify("info", e ? `Undid: ${e.label}` : "Nothing to undo."), (err) => notify("error", String(err)));
          }}
          onClose={closeEditor}
        />
      )}
      {shrineOpen && <ShrinePanel sections={shrineSections} onClose={() => setShrineOpen(false)} />}
      {error && <p className="error-line tree-error">{error}</p>}
      {hud && (
        <>
          <div className="tree-crumbs">
            {crumbs.map((id, i) => (
              <span key={id}>
                {i > 0 && " › "}
                {title(id)}
              </span>
            ))}
            <span className="dim-line"> · {hud.animal}{hud.airborne ? " · airborne" : ""}{hud.reaching ? " · reaching" : ""}</span>
          </div>
          {(hud.nearLeaf || hud.climb || hud.aiming || hud.dangling || hud.canSilk || hud.walking || hud.pad || hud.hoverWisp) && (
            <div className="tree-hint">
              {hud.hoverWisp && (
                <span>
                  <b>click</b> the wisp to search{(hud.pad || hud.climb || hud.nearLeaf) && " · "}
                </span>
              )}
              {hud.pad && !hud.hoverWisp && (
                <span className="tree-pad">
                  <b>E</b> {hud.pad.label}
                  {(hud.climb || hud.nearLeaf) && " · "}
                </span>
              )}
              {hud.walking && (
                <span>
                  <b>Walking there</b> · any key or <b>Esc</b> stops{(hud.climb || hud.nearLeaf) && " · "}
                </span>
              )}
              {hud.dangling ? (
                <span>
                  <b>On a thread</b>: S lower · W reel up · A/D swing · hold Space to pump · <b>X</b> let go
                </span>
              ) : (
                hud.canSilk &&
                !hud.aiming && (
                  <span>
                    <b>X</b> drop on a silk thread{(hud.climb || hud.nearLeaf) && " · "}
                  </span>
                )
              )}
              {hud.aiming && (
                <span>
                  <b>Aiming</b>: A/D turn · W/S raise/lower · release <b>Space</b> to jump · <b>Shift</b> cancels{(hud.climb || hud.nearLeaf) && " · "}
                </span>
              )}
              {hud.climb && hud.climbAuto && (
                <span>
                  walking {hud.climbDown ? "down" : "up"} enters “{hud.climb.startsWith("root:") ? branchTitle(hud.climb, tree) : title0(hud.climb)}” · hold <b>Shift</b> to stay on this branch
                </span>
              )}
              {hud.climb && !hud.climbAuto && (
                <span>
                  <b>Shift</b> climb into “{title0(hud.climb)}”
                </span>
              )}
              {hud.climb && hud.nearLeaf && " · "}
              {hud.nearLeaf && (
                <span>
                  <b>E</b> read “{hud.nearLeaf.title}”
                </span>
              )}
            </div>
          )}
          <div className="tree-animals" onMouseDown={(e) => e.preventDefault()}>
            {ANIMAL_CATEGORIES.map((cat, ci) => (
              <div key={cat.label} className="tree-cat">
                <span title={`Key ${ci + 1}: press again to cycle`}>
                  {ci + 1} {cat.label}
                </span>
                {cat.ids.map((id) => (
                  <button
                    key={id}
                    className={hud.animalId === id ? "active" : ""}
                    onClick={() => {
                      const a = ANIMALS.find((x) => x.id === id);
                      if (a) sceneRef.current?.setAnimal(a);
                    }}
                  >
                    {ANIMALS.find((x) => x.id === id)?.name ?? id}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="tree-toggles" onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => sceneRef.current?.toggleLook()} title="Switch between the voxel and the low-poly look (L)">
              look: {hud.look === "voxel" ? "voxel" : "low-poly"}
            </button>
            <button className={mode === "forest" ? "active" : ""} onClick={toggleMode} title="Layout: forest (every top-level folder is its own tree, joined to the central stump by ground roots) or hub (all trunks arch out of one stump) (Y)">
              layout: {mode}
            </button>
            <button onClick={() => { if (editId) closeEditor(); else if (layout?.info.has(hud.branch)) setEditId(hud.branch); }} title="Edit the properties (length, thickness, rotation, wave, species…) of the branch you are on (B)">
              edit branch
            </button>
            <button onClick={() => sceneRef.current?.cycleLabels()} title="Names of the branches: signs at the big ones · bubbles over all of them · off (N)">
              names: {hud.labels}
            </button>
            <button className={hud.foliage ? "active" : ""} onClick={() => sceneRef.current?.toggleFoliage()} title="Canopy foliage: translucent leaves that hide the branches from afar and thin out near you (F; density slider in the branch editor)">
              foliage: {hud.foliage ? "on" : "off"}
            </button>
            <button className={hud.shadows !== "off" ? "active" : ""} onClick={() => sceneRef.current?.cycleShadows()} title="Sun shadows: off · low (1024) · medium (2048) · high (4096 map); off uses a soft blob under the animal (K)">
              shadows: {hud.shadows}
            </button>
            <button className={hud.moveMode === "guided" ? "active" : ""} onClick={() => sceneRef.current?.toggleMoveMode()} title="Movement: guided = W up the branch, S down, A/D turn on it, in smooth curves · free = W walks along your heading, A/D steer it (M)">
              move: {hud.moveMode}
            </button>
            <button className={hud.moveMode === "free" && hud.autoAlign ? "active" : ""} disabled={hud.moveMode !== "free"} onClick={() => sceneRef.current?.toggleAutoAlign()} title={hud.moveMode === "free" ? "Gently straighten your heading along the branch when you are not steering (H)" : "Only used in free movement: guided movement always straightens along the branch (H)"}>
              auto-align: {hud.moveMode !== "free" ? "n/a" : hud.autoAlign ? "on" : "off"}
            </button>
            <button onClick={() => sceneRef.current?.cycleCamera()} title="Camera: chase (rolls with the branch) · level (horizon stays level) · fixed · mouse (drag to orbit round the animal; right-drag works too) (V)">
              camera: {hud.camera}
            </button>
            <button className={hud.wispMode === "follow" ? "active" : ""} onClick={() => sceneRef.current?.toggleWispMode()} title="The search wisp: perched on the shrine's lantern post, or following you like a lantern">
              wisp: {hud.wispGuiding ? "lighting the way" : hud.wispMode === "follow" ? "follows you" : "at the shrine"}
            </button>
            <button className={hud.perf ? "active" : ""} onClick={() => sceneRef.current?.togglePerfOverlay()} title="Performance panel: FPS, where the time goes, quality profile (I)">
              performance: {hud.perfProfile}
            </button>
          </div>
          <PerfOverlay hud={hud} scene={sceneRef.current} onClose={() => sceneRef.current?.togglePerfOverlay()} />
          {hud.hover && (
            <div className="tree-hover" style={{ left: hud.hover.x + 14, top: hud.hover.y + 18 }}>
              {hud.hover.title}
              <span className="dim-line"> · click to walk there{hud.hover.leaf ? ", double-click to read" : ""}</span>
            </div>
          )}
          {hud.gripOn && hud.grip < 0.999 && (
            <div className="tree-grip">
              <i style={{ width: `${hud.grip * 100}%`, background: hud.grip > 0.5 ? "#ffe080" : hud.grip > 0.25 ? "#ff9a40" : "#ff4a38" }} />
            </div>
          )}
          <div className="tree-controls">
            {hud.moveMode === "guided" ? "W up the branch · S down · A/D turn on it (left / right as you face)" : "W forward · A/D steer the heading"} · M move guided/free · hold Space to aim a jump (arc preview, auto-target), release to leap (snake: hold = reach, steer with WASD; squirrel: W dive / S flare; bee, dragonfly, blue jay: Space = take off, then Space up / Shift down or land; jay: W dive, S climb) ·
            X = spider silk (drop, swing, climb the thread again) · walking up past a side branch's base climbs it, hold Shift to stay (roots and threads: Shift climbs in) · B edit this branch · Y layout forest/hub · E read · click = walk there (double-click a leaf = read it; any key stops) · 1/2/3 animal category (again = next) · G grip {hud.gripOn ? "on" : "off"} · H auto-align (free mode) · N names · F foliage · K shadows · V camera (chase / level / fixed / mouse: drag to orbit) · L look · I performance · wheel/+/− zoom · P pixels · E at the shrine: the door (library), the altar (tools), the wisp (search)
          </div>
        </>
      )}
    </div>
  );
}
