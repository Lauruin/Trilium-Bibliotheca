/**
 * ui/BranchPanel.tsx — edit one branch's PROPERTIES in the tree view (key B).
 *
 * Every folder branch has calculated values (length, thickness, taper, rotation around the parent (`spin`), pitch, attach, bend,
 * species and the wave: amplitude / frequency / shape).
 * Here each can be overridden: the edit previews live (the tree is re-laid out with the pending values),
 * "Save" writes one `biblio_b*` label per changed value on the folder's note (undoable), and the ↺ buttons
 * return a value to its CALCULATED one (the label is removed). "Recalculate all" removes every override.
 * The pure parts (what counts as changed) live in lib/treeedit.ts.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { SPECIES, SPECIES_KEYS } from "../tree/species";
import { PROP_RANGES, type BranchInfo, type NumPropKey, type PropKey } from "../tree/layout";
import { WAVE_FNS, WAVE_LABELS, effectiveAmp, effectiveFreq, waveShape, type WaveFn } from "../tree/wave";
import type { Pending } from "../lib/treeedit";

const NUMERIC: NumPropKey[] = ["length", "thickness", "taper", "spin", "pitch", "attach", "bend", "wave", "waveFreq"];
const WAVE_KEYS: PropKey[] = ["wave", "waveFreq", "waveFn"];
const NAMES: Record<PropKey, string> = {
  length: "Length", thickness: "Thickness", taper: "Taper (end/start)", spin: "Rotation on parent", pitch: "Angle off parent",
  attach: "Position on parent", bend: "Droop / lift", species: "Kind of tree",
  wave: "Wave amplitude", waveFreq: "Wave frequency", waveFn: "Wave shape",
};
/** One line of help per row (also its tooltip). `spin` was called "spiral" / azimuth: it is WHERE on the parent's circumference the branch leaves. */
const HELP: Record<PropKey, string> = {
  length: "How long it grows, in px along its centreline.",
  thickness: "Its radius where it leaves the parent, in px.",
  taper: "Tip radius / start radius (tips of branches with no sub-folder end in a point).",
  spin: "Where on the parent's circumference it leaves: 0° = on top, 90° = a side, 180° = underneath.",
  pitch: "How far it swings away from the parent's direction: 0° = straight on, 90° = sideways.",
  attach: "Where along the parent it grows out: 0 = the base, 1 = the tip.",
  bend: "-1 droops towards the tip, +1 lifts it.",
  species: "Which kind of tree it is (inherits to the sub-folders).",
  wave: "How far the branch swings sideways, as a % of its length (0 = ruler straight).",
  waveFreq: "How many wave cycles fit along the branch.",
  waveFn: "The curve the centreline follows (see the preview).",
};

const fmt = (key: NumPropKey, v: number): string => {
  if (key === "wave") return `${(v * 100).toFixed(1)}%`;
  const step = PROP_RANGES[key].step;
  return step >= 1 ? String(Math.round(v)) : v.toFixed(step < 0.1 ? 2 : 1);
};

/** A tiny sketch of the wave on a branch of true proportions (amplitude is a fraction of the length): the main swing, and the second axis dashed. */
function WavePreview(props: { fn: WaveFn; amp: number; freq: number; length: number }): React.JSX.Element {
  const W = 440;
  const H = 56;
  const f = effectiveFreq(props.freq, props.length);
  const a = effectiveAmp(props.fn, props.amp, f) * W;
  const line = (axis: 0 | 1): string => {
    const pts: string[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      pts.push(`${(t * W).toFixed(1)},${(H / 2 - waveShape(props.fn, t, f, 0.37)[axis] * a).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const second = props.fn === "helix" || props.fn === "noise";
  return (
    <svg className="bp-wave" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Wave preview">
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#6a5a3a" strokeDasharray="2 3" />
      {second && <polyline points={line(1)} fill="none" stroke="#a89a7a" strokeDasharray="3 3" strokeWidth="1" />}
      <polyline points={line(0)} fill="none" stroke="#e8c868" strokeWidth="1.6" />
    </svg>
  );
}

/** The wave-shape dropdown (+ the sketch), rendered inside the wave-frequency row's grid so the three wave rows stay together. */
function WaveShapeRow(props: {
  fn: WaveFn; wave: number; freq: number; length: number; info: BranchInfo; pending: Pending; saved: boolean;
  onChange: (key: PropKey, value: number | string | null | undefined) => void;
}): React.JSX.Element {
  const edited = "waveFn" in props.pending;
  const limit = effectiveAmp(props.fn, props.wave, effectiveFreq(props.freq, props.length));
  return (
    <div className="bp-row" title={HELP.waveFn}>
      <span className="bp-name">
        {NAMES.waveFn}
        {props.saved && !edited && <i className="bp-badge" title="Saved on the note">saved</i>}
        {edited && <i className="bp-badge edit">{props.pending.waveFn === null ? "recalc" : "edited"}</i>}
      </span>
      <select
        value={props.fn}
        onChange={(e) => {
          props.onChange("waveFn", e.target.value === props.info.calc.waveFn ? null : e.target.value);
          e.currentTarget.blur(); // a focused dropdown would swallow the game keys
        }}
      >
        {WAVE_FNS.map((k) => (
          <option key={k} value={k}>
            {WAVE_LABELS[k]}{k === props.info.calc.waveFn ? " (calculated)" : ""}
          </option>
        ))}
      </select>
      <button className="bp-reset" disabled={!props.saved && !edited} onClick={() => props.onChange("waveFn", props.saved ? null : undefined)} title="Back to the calculated shape">↺</button>
      <span className="bp-help">{HELP.waveFn}</span>
      <div className="bp-wave-box">
        <WavePreview fn={props.fn} amp={props.wave} freq={props.freq} length={props.length} />
      </div>
      {props.fn !== "none" && limit < props.wave * 0.98 && (
        <span className="bp-help">Steepness limit: with this shape and frequency the branch swings at most {(limit * 100).toFixed(1)}% of its length (so it never kinks).</span>
      )}
    </div>
  );
}

export function BranchPanel(props: {
  title: string;
  info: BranchInfo;
  pending: Pending;
  /** The hub (root) has no parent: no rotation/pitch/attach/bend and no wave. A trunk has no attach position. */
  kind: "hub" | "trunk" | "branch";
  busy: boolean;
  canUndo: boolean;
  onChange: (key: PropKey, value: number | string | null | undefined) => void;
  onSave: () => void;
  onRecalcAll: () => void;
  onUndo: () => void;
  onClose: () => void;
  /** Canopy foliage (a scene setting, not a branch property: persisted in localStorage, never written to the vault). */
  foliage?: { on: boolean; density: number };
  onFoliage?: (on: boolean, density?: number) => void;
}): React.JSX.Element {
  const { info, pending } = props;
  const hub = props.kind === "hub";
  const rows = NUMERIC.filter((k) => !(hub && (k === "spin" || k === "pitch" || k === "attach" || k === "bend" || WAVE_KEYS.includes(k))) && !(props.kind === "trunk" && k === "attach"));
  const nameOf = (k: PropKey): string => (props.kind === "trunk" && k === "spin" ? "Lean direction" : NAMES[k]);
  const helpOf = (k: PropKey): string => (props.kind === "trunk" && k === "spin" ? "Which way the trunk leans: 0° = +z, 90° = +x (looking down: a compass)." : HELP[k]);
  const pw = pending.wave;
  const pf = pending.waveFreq;
  const pfn = pending.waveFn;
  const effWave = typeof pw === "number" ? pw : pw === null ? info.calc.wave : info.eff.wave;
  const effFreq = typeof pf === "number" ? pf : pf === null ? info.calc.waveFreq : info.eff.waveFreq;
  const effFn = (typeof pfn === "string" ? pfn : pfn === null ? info.calc.waveFn : info.eff.waveFn) as WaveFn;
  const dirty = Object.keys(pending).length > 0;
  const saved = (k: PropKey): boolean => info.overridden.has(k);
  return (
    <div className="branch-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="bp-head">
        <b>{props.title}</b>
        <button onClick={props.onClose} title="Close (B)">✕</button>
      </div>
      <div className="bp-sub">
        Values are calculated from the folder; change one to save it on the note as a label (<code>biblio_b…</code>). ↺ = back to the calculated value.
      </div>
      <label className="bp-row" title={HELP.species}>
        <span className="bp-name">{NAMES.species}{saved("species") && <i className="bp-badge" title="Saved on the note">saved</i>}{"species" in pending && <i className="bp-badge edit">edited</i>}</span>
        <select
          value={String(pending.species ?? info.eff.species)}
          onChange={(e) => {
            props.onChange("species", e.target.value === info.calc.species ? null : e.target.value);
            e.currentTarget.blur(); // a focused dropdown would swallow the game keys (W/S/letters change its option)
          }}
        >
          {SPECIES_KEYS.map((k) => (
            <option key={k} value={k}>
              {SPECIES[k].label}{k === info.calc.species ? " (calculated)" : ""}
            </option>
          ))}
        </select>
        <button className="bp-reset" disabled={!saved("species") && !("species" in pending)} onClick={() => props.onChange("species", saved("species") ? null : undefined)} title="Back to the calculated kind">↺</button>
      </label>
      {rows.map((k) => {
        const r = PROP_RANGES[k];
        const pv = pending[k];
        const value = typeof pv === "number" ? pv : pv === null ? info.calc[k] : info.eff[k];
        const edited = k in pending;
        return (
          <Fragment key={k}>
          <div className="bp-row" title={helpOf(k)}>
            <span className="bp-name">
              {nameOf(k)}
              {saved(k) && !edited && <i className="bp-badge" title="Saved on the note">saved</i>}
              {edited && <i className="bp-badge edit">{pv === null ? "recalc" : "edited"}</i>}
            </span>
            <input type="range" min={r.min} max={r.max} step={r.step} value={Math.min(r.max, Math.max(r.min, value))} onChange={(e) => props.onChange(k, Number(e.target.value))} />
            <span className="bp-val">{fmt(k, value)}{r.unit}</span>
            <span className="bp-calc" title="The calculated value">calc {fmt(k, info.calc[k])}</span>
            <button className="bp-reset" disabled={!saved(k) && !edited} onClick={() => props.onChange(k, saved(k) ? null : undefined)} title="Back to the calculated value">↺</button>
            <span className="bp-help">{helpOf(k)}</span>
          </div>
          {k === "waveFreq" && <WaveShapeRow fn={effFn} wave={effWave} freq={effFreq} length={info.eff.length} info={info} pending={pending} saved={saved("waveFn")} onChange={props.onChange} />}
          </Fragment>
        );
      })}
      <div className="bp-foot">
        <button disabled={!dirty || props.busy} onClick={props.onSave}>Save</button>
        <button disabled={props.busy} onClick={props.onRecalcAll} title="Remove every saved override of this branch">Recalculate all</button>
        <button disabled={!props.canUndo || props.busy} onClick={props.onUndo} title="Undo the last saved edit">Undo</button>
      </div>
      {props.foliage && props.onFoliage && <FoliageBlock on={props.foliage.on} density={props.foliage.density} onChange={props.onFoliage} />}
    </div>
  );
}

/** The foliage toggle + density slider (bottom of the panel; also key F). The slider rebuilds the canopy, so it is debounced. */
function FoliageBlock(props: { on: boolean; density: number; onChange: (on: boolean, density?: number) => void }): React.JSX.Element {
  const [density, setDensity] = useState(props.density);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <div className="bp-foliage" title="Translucent canopy that hides the branches from afar and thins out near the animal and the camera. A view setting: nothing is saved on notes.">
      <label>
        <input type="checkbox" checked={props.on} onChange={(e) => props.onChange(e.target.checked)} /> Foliage <span className="bp-calc">(F)</span>
      </label>
      <input
        type="range"
        min={0.25}
        max={1.5}
        step={0.25}
        value={density}
        disabled={!props.on}
        onChange={(e) => {
          const d = Number(e.target.value);
          setDensity(d);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => props.onChange(true, d), 200);
        }}
      />
      <span className="bp-val">{Math.round(density * 100)}%</span>
    </div>
  );
}
