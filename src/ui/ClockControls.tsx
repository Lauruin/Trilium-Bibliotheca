/**
 * ui/ClockControls.tsx — the world's clock (real time / fixed hour / fast, night brightness): shown at the altar AND in the pause menu.
 * The state lives in the scene (tree/clock.ts); this only draws and sets it.
 */

import { CLOCK_MODES, FAST_MINUTES, hhmm, type ClockMode } from "../tree/clock";
import type { HudInfo, TreeScene } from "../tree/TreeScene";

export function ClockControls(props: { hud: HudInfo | null; scene: TreeScene | null }): React.JSX.Element {
  const { hud } = props;
  const sceneRef = { current: props.scene };
  return (
    <>
      <div className="shrine-row">
        {CLOCK_MODES.map((m: ClockMode) => (
          <button
            key={m}
            data-testid={`clock-${m}`}
            className={hud?.clock.mode === m ? "active" : ""}
            onClick={() => hud && sceneRef.current?.setClock({ ...hud.clock, mode: m })}
          >
            {m === "real" ? "real time" : m === "fixed" ? "fixed hour" : "fast"}
          </button>
        ))}
        <span data-testid="clock-time">{hud ? hhmm(hud.hour) : ""}</span>
      </div>
      {hud?.clock.mode === "fixed" && (
        <label className="shrine-row">
          hour{" "}
          <input
            type="range"
            data-testid="clock-hour"
            min={0}
            max={24}
            step={0.25}
            value={hud.clock.hour}
            onChange={(e) => sceneRef.current?.setClock({ ...hud.clock, hour: Number(e.target.value) })}
          />{" "}
          {hhmm(hud.clock.hour)}
        </label>
      )}
      {hud?.clock.mode === "fast" && (
        <div className="shrine-row">
          a day lasts{" "}
          {FAST_MINUTES.map((m) => (
            <button key={m} className={hud.clock.fastMinutes === m ? "active" : ""} onClick={() => sceneRef.current?.setClock({ ...hud.clock, fastMinutes: m })}>
              {m} min
            </button>
          ))}
        </div>
      )}
      <label className="shrine-row">
        night brightness{" "}
        <input
          type="range"
          data-testid="clock-night"
          min={0}
          max={1}
          step={0.05}
          value={hud?.clock.night ?? 0.5}
          onChange={(e) => hud && sceneRef.current?.setClock({ ...hud.clock, night: Number(e.target.value) })}
        />
      </label>
    </>

  );
}
