/**
 * ui/PerfOverlay.tsx — the performance panel of the tree view (key I): FPS, where the time goes, what is drawn, and quick
 * switches for what costs the most. Shown on top of the 3D view; the numbers come from TreeScene.stats (tree/perf.ts explains
 * how to read them: a long frame with little JS time means the GPU is the limit).
 */

import { PERF_PROFILES, PROFILE } from "../tree/perf";
import type { HudInfo, PerfProfile, PerfStats, TreeScene } from "../tree/TreeScene";

const fmt = (n: number, d = 1): string => (Number.isFinite(n) ? n.toFixed(d) : "-");
const kilo = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));

const DIAG: Record<PerfStats["diagnosis"], string> = {
  "no data": "collecting…",
  ok: "frames are on time",
  "gpu-bound": "the GPU is the limit (frames are long, our JS is short): fewer pixels, shadows off, low-poly look",
  "cpu-bound": "JavaScript is the limit (our own frame work is most of the frame time)",
};

const PROFILE_HELP: Record<PerfProfile, string> = {
  quality: "full device resolution up to 2x, MSAA, no frame cap",
  auto: "up to 1.5x, 60 fps cap, MSAA on normal screens, resolution drops by itself when slow",
  fast: "1x, no MSAA, 60 fps cap, may go down to half resolution",
};

export function PerfOverlay(props: { hud: HudInfo; scene: TreeScene | null; onClose: () => void }): React.JSX.Element | null {
  const p = props.hud.perf;
  const scene = props.scene;
  if (!p || !scene) return null;
  const cap = PROFILE[p.profile].maxFps;
  return (
    <div className="perf-overlay" onMouseDown={(e) => e.preventDefault()} data-testid="perf-overlay">
      <div className="perf-head">
        <b>performance</b>
        <button onClick={props.onClose} title="Close (I)">✕</button>
      </div>
      <div className="perf-fps">
        <b>{fmt(p.fps, 0)}</b> fps{cap > 0 ? ` (cap ${cap})` : ""} · frame {fmt(p.avgFrameMs)} ms · p95 {fmt(p.p95FrameMs)} ms
      </div>
      <div>JS {fmt(p.avgCpuMs)} ms per frame (render submit {fmt(p.avgRenderMs)} ms)</div>
      <div className={`perf-diag ${p.diagnosis}`}>{DIAG[p.diagnosis]}</div>
      <div>
        {p.calls} draw calls · {kilo(p.triangles)} triangles · {p.geometries} geometries · {p.textures} textures
      </div>
      <div>
        {p.width}×{p.height} px · ratio {fmt(p.dpr, 2)} (adaptive ×{fmt(p.scale, 2)}) · MSAA {p.msaa ? "on" : "off"}
      </div>
      {p.atFloor && (
        <div className="perf-warn">Still slow at the lowest resolution: try shadows off (K), foliage off (F) or the low-poly look (L).</div>
      )}
      <div className="perf-row">
        <span title={PROFILE_HELP[p.profile]}>profile</span>
        {PERF_PROFILES.map((k) => (
          <button key={k} className={p.profile === k ? "active" : ""} onClick={() => scene.setPerfProfile(k)} title={PROFILE_HELP[k]}>
            {k}
          </button>
        ))}
      </div>
      <div className="perf-row">
        <button onClick={() => scene.cycleShadows()} title="Sun shadows (K)">shadows: {props.hud.shadows}</button>
        <button onClick={() => scene.toggleFoliage()} title="Canopy foliage (F)">foliage: {props.hud.foliage ? "on" : "off"}</button>
        <button onClick={() => scene.toggleLook()} title="Voxel / low-poly look (L)">look: {props.hud.look === "voxel" ? "voxel" : "low-poly"}</button>
      </div>
      <div className="dim-line small">{PROFILE_HELP[p.profile]}. MSAA changes apply the next time this view opens.</div>
    </div>
  );
}
