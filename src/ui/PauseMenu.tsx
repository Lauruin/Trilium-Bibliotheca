/**
 * ui/PauseMenu.tsx — Esc in the tree view: the game stands still and the menu has what used to be scattered:
 *   Game      resume, the world's clock, restart the tutorial, unlock everything, movement, layout, the library
 *   Graphics  look, shadows, foliage, the performance profile, pixel mode, camera, branch names, the stats panel
 *   Controls  the cheat sheet and the key bindings (ControlsTab)
 * The scene is paused (TreeScene.paused) while it is open; Esc closes it (unless a key is being rebound: then Esc cancels that).
 */

import { useEffect, useState } from "react";
import type { Bindings } from "../tree/keymap";
import type { HudInfo, TreeScene } from "../tree/TreeScene";
import type { LayoutMode } from "../tree/layout";
import { replayTutorial, setUnlockAll, subscribe, progressVersion, unlockAll, getTutorial } from "../state/progress";
import { finished } from "../lib/tutorial";
import { useSyncExternalStore } from "react";
import { ClockControls } from "./ClockControls";
import { ControlsTab } from "./ControlsTab";

type Tab = "game" | "graphics" | "controls";
const TABS: ReadonlyArray<[Tab, string]> = [["game", "Game"], ["graphics", "Graphics"], ["controls", "Controls"]];

function Choice<T extends string | number>(props: { label: string; help?: string; value: T; options: ReadonlyArray<[T, string]>; onPick: (v: T) => void; testid?: string }): React.JSX.Element {
  return (
    <div className="pause-row" title={props.help}>
      <span className="pause-label">{props.label}</span>
      {props.options.map(([v, text]) => (
        <button key={String(v)} className={props.value === v ? "active" : ""} data-testid={props.testid ? `${props.testid}-${v}` : undefined} onClick={() => props.onPick(v)}>
          {text}
        </button>
      ))}
      {props.help && <span className="pause-help-inline">{props.help}</span>}
    </div>
  );
}

export function PauseMenu(props: {
  scene: TreeScene;
  hud: HudInfo | null;
  bindings: Bindings;
  onBindings: (b: Bindings) => void;
  layoutMode: LayoutMode;
  onToggleLayout: () => void;
  onEnterLibrary: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { scene, hud } = props;
  const [tab, setTab] = useState<Tab>("game");
  useSyncExternalStore(subscribe, progressVersion);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose(); // (a key being rebound handles Esc itself first, in the capture phase)
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <section className="modal pause-modal" role="dialog" aria-label="Pause menu" data-testid="pause-menu" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Paused</h2>
          <nav className="pause-tabs">
            {TABS.map(([id, text]) => (
              <button key={id} className={tab === id ? "active" : ""} data-testid={`pause-tab-${id}`} onClick={() => setTab(id)}>
                {text}
              </button>
            ))}
          </nav>
          <button data-testid="pause-resume" onClick={props.onClose}>
            resume ✕
          </button>
        </header>
        <div className="pause-body">
          {tab === "game" && (
            <>
              <section className="shrine-sec">
                <h3>Time of day</h3>
                <ClockControls hud={hud} scene={scene} />
              </section>
              <section className="shrine-sec">
                <h3>Tutorial and progress</h3>
                <div className="shrine-row">
                  <button data-testid="pause-restart-tutorial" onClick={() => { replayTutorial(); props.onClose(); }}>
                    {finished(getTutorial()) ? "restart the tutorial" : "restart the tutorial from the beginning"}
                  </button>
                </div>
                <label className="shrine-row">
                  <input type="checkbox" data-testid="pause-unlock-all" checked={unlockAll()} onChange={(e) => setUnlockAll(e.target.checked)} /> unlock everything (skip the progression; the altar lists what is open)
                </label>
              </section>
              <section className="shrine-sec">
                <h3>Moving around</h3>
                <Choice label="Movement" value={hud?.moveMode ?? "guided"} options={[["guided", "guided"], ["free", "free"]]} onPick={(v) => scene.setMoveMode(v)} help="guided: W up the branch, S down; free: W along your heading" />
                <Choice label="Layout" value={props.layoutMode} options={[["forest", "forest"], ["hub", "hub"]]} onPick={() => props.onToggleLayout()} help="forest: every top-level folder its own tree" />
                <Choice label="Wisp" value={hud?.wispMode ?? "perch"} options={[["perch", "stays at its branch"], ["follow", "follows me"]]} onPick={(v) => scene.setWispMode(v)} />
                <div className="shrine-row">
                  <button onClick={() => { props.onClose(); props.onEnterLibrary(); }}>enter the library</button>
                </div>
              </section>
            </>
          )}
          {tab === "graphics" && (
            <>
              <section className="shrine-sec">
                <h3>Look</h3>
                <Choice label="Look" value={hud?.look ?? "voxel"} options={[["voxel", "voxel"], ["lowpoly", "low-poly"]]} onPick={(v) => scene.setLook(v)} testid="gfx-look" />
                <Choice label="Branch names" value={hud?.labels ?? "signs"} options={[["signs", "signs"], ["bubbles", "bubbles"], ["off", "off"]]} onPick={(v) => scene.setLabels(v)} />
                <Choice label="Camera" value={hud?.camera ?? "chase"} options={[["chase", "chase"], ["level", "level"], ["fixed", "fixed"], ["mouse", "mouse"]]} onPick={(v) => scene.setCamera(v)} help="mouse: drag to orbit; the look direction steers reach, jumps and flight" />
                <Choice label="Pixel mode" value={scene.pixelated ? "on" : "off"} options={[["off", "off"], ["on", "on"]]} onPick={(v) => scene.setPixelated(v === "on")} />
              </section>
              <section className="shrine-sec">
                <h3>Performance</h3>
                <Choice label="Shadows" value={hud?.shadows ?? "medium"} options={[["off", "off"], ["low", "low"], ["medium", "medium"], ["high", "high"]]} onPick={(v) => scene.setShadows(v)} testid="gfx-shadows" help="the sun's shadows; off is the cheapest" />
                <Choice label="Foliage" value={hud?.foliage ? "on" : "off"} options={[["on", "on"], ["off", "off"]]} onPick={(v) => scene.setFoliage(v === "on")} help="the translucent canopy" />
                <Choice
                  label="Foliage density"
                  value={hud?.foliageDensity ?? 1}
                  options={[[0.25, "0.25"], [0.5, "0.5"], [0.75, "0.75"], [1, "1"], [1.25, "1.25"], [1.5, "1.5"]]}
                  onPick={(v) => scene.setFoliage(true, v)}
                />
                <Choice
                  label="Profile"
                  value={hud?.perfProfile ?? "auto"}
                  options={[["quality", "quality"], ["auto", "auto"], ["fast", "fast"]]}
                  onPick={(v) => scene.setPerfProfile(v)}
                  testid="gfx-profile"
                  help="auto: resolution adapts to the frame rate; fast: lowest cost; quality: full resolution"
                />
                <div className="shrine-row">
                  <button className={hud?.perf ? "active" : ""} onClick={() => scene.togglePerfOverlay()}>
                    {hud?.perf ? "hide the stats panel" : "show the stats panel (frame rate, draw calls)"}
                  </button>
                </div>
              </section>
            </>
          )}
          {tab === "controls" && <ControlsTab bindings={props.bindings} onBindings={props.onBindings} />}
        </div>
      </section>
    </div>
  );
}
