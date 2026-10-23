/**
 * ui/LeafView.tsx — the LEAF VIEW: a note read on a magnified leaf by the ant.
 *
 * Entered with the ant selected next to a leaf (the tree view decides, see TreeView): the tree is left alone and a full-screen canvas shows
 * ONE leaf: a low-poly blade whose size grows with the note's length (lib/leafreader.ts `bladeSize`, capped), the note's text laid out on it
 * as plain text (headings, paragraphs, lists, quotes, code: `blocksFor` + `layoutBlocks`), and the ant walking on the text. Longer notes than the
 * blade scroll past along the midrib as the ant walks (W back, S on, A/D sideways, wheel, PageUp/Down). The full-fidelity reader (images, tables) is one
 * key away (R). Choosing any other animal (1-4) or Esc climbs back out into the tree. Cheap: one 2D canvas, redrawn only while something moves.
 */

import { useEffect, useRef, useState } from "react";
import { blocksFor, bladeSize, layoutBlocks, lineAt, scrollFor, type LaidLine } from "../lib/leafreader";
import { LEAF_SHAPES } from "../tree/leafkind";
import { getClient } from "../state/store";

export interface LeafViewNote {
  id: string;
  title: string;
  /** The effective note type ("text" | "markdown" | "code" | ...). */
  type: string;
  /** The leaf's colour (from the note's #color or its species). */
  color: string;
  learn?: boolean;
  noai?: boolean;
}

const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const BLADE = LEAF_SHAPES.broad[0];
const U_MAX = 0.85; // the broad outline's widest u

const font = (size: number, bold: boolean, mono: boolean): string => `${bold ? "bold " : ""}${size}px ${mono ? MONO : SERIF}`;

/** Mix a CSS colour with a pale leaf green so text always has contrast, whatever colour the note has. */
function paleLeaf(color: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  const base = [0xe3, 0xee, 0xcb];
  if (!m) return `rgb(${base.join(",")})`;
  const v = parseInt(m[1], 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  return `rgb(${base.map((b, i) => Math.round(b * (1 - k) + c[i] * k)).join(",")})`;
}

export function LeafView(props: { note: LeafViewNote; onClose: (animalKey?: number) => void; onOpenReader: () => void }): React.JSX.Element {
  const { note } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [chars, setChars] = useState(0);
  const lay = useRef<{ lines: LaidLine[]; height: number; colW: number; blocksText: number }>({ lines: [], height: 0, colW: 0, blocksText: 0 });
  const blocksRef = useRef<ReturnType<typeof blocksFor>>([]);
  const ant = useRef({ x: 0, y: 0, face: Math.PI / 2, t: 0, moving: 0 });
  const keys = useRef(new Set<string>());
  const dirty = useRef(true);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const onOpen = useRef(props.onOpenReader);
  onOpen.current = props.onOpenReader;

  // load the note's text
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    const textual = note.type === "text" || note.type === "markdown" || note.type === "code";
    const run = async (): Promise<void> => {
      let content = "";
      if (textual) {
        const client = getClient();
        if (!client) throw new Error("not connected");
        content = await client.getNoteContent(note.id);
      }
      if (!alive) return;
      blocksRef.current = blocksFor(note.type, content);
      const n = blocksRef.current.reduce((a, b) => a + b.text.length, 0);
      setChars(n);
      ant.current = { x: 0, y: 0, face: Math.PI / 2, t: 0, moving: 0 };
      lay.current.colW = 0; // force a layout
      setStatus("ready");
      dirty.current = true;
    };
    run().catch(() => {
      if (!alive) return;
      blocksRef.current = [{ kind: "p", text: "This note could not be loaded. Press R to try the normal reader, or Esc to climb back out." }];
      lay.current.colW = 0;
      setStatus("error");
      dirty.current = true;
    });
    return () => {
      alive = false;
    };
  }, [note.id, note.type]);

  // keys
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        e.preventDefault();
        onClose.current();
      } else if (k === "1" || k === "2" || k === "3" || k === "4") {
        e.preventDefault();
        onClose.current(Number(k));
      } else if (k === "r" || k === "enter") {
        e.preventDefault();
        onOpen.current();
      } else if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "pageup", "pagedown", " "].includes(k)) {
        e.preventDefault();
        keys.current.add(k);
        dirty.current = true;
      }
    };
    const up = (e: KeyboardEvent): void => void keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // the loop
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let W = 0;
    let H = 0;
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth;
      H = window.innerHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lay.current.colW = 0;
      dirty.current = true;
    };
    resize();
    window.addEventListener("resize", resize);
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      ant.current.y = Math.max(0, Math.min(lay.current.height, ant.current.y + e.deltaY * 0.8));
      ant.current.moving = 0.3;
      dirty.current = true;
    };
    cv.addEventListener("wheel", onWheel, { passive: false });

    const measureCtx = document.createElement("canvas").getContext("2d")!;
    const metrics = { measure: (t: string, size: number, bold: boolean, mono: boolean): number => ((measureCtx.font = font(size, bold, mono)), measureCtx.measureText(t).width) };

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const m = ant.current;
      const k = keys.current;
      const L = lay.current;
      // walking: S / Down read on (down the text), W / Up back, A / D sideways; PageUp / PageDown / Space jump a screenful
      const vx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      const vy = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
      if (k.has("pagedown") || k.has(" ")) {
        m.y += 560 * dt * 3;
        dirty.current = true;
      }
      if (k.has("pageup")) {
        m.y -= 560 * dt * 3;
        dirty.current = true;
      }
      if (vx !== 0 || vy !== 0) {
        const sp = 150;
        const len = Math.hypot(vx, vy);
        m.x += (vx / len) * sp * dt;
        m.y += (vy / len) * sp * dt;
        m.face = Math.atan2(vy || 0.0001, vx);
        m.moving = 0.25;
        dirty.current = true;
      }
      if (m.moving > 0) {
        m.moving -= dt;
        m.t += dt;
        dirty.current = true;
      }
      if (!dirty.current) return;
      dirty.current = false;

      // size + layout
      const blade = bladeSize(chars, W, H);
      const bw = blade.w;
      const bh = blade.h;
      const colW = Math.max(140, bw * 0.5);
      if (L.colW !== colW) {
        const out = layoutBlocks(blocksRef.current, colW, metrics);
        L.lines = out.lines;
        L.height = out.height;
        L.colW = colW;
        if (rootRef.current) {
          // (for the tests: what the view holds, without reading pixels)
          rootRef.current.dataset.lines = String(L.lines.length);
          rootRef.current.dataset.text = L.lines.slice(0, 3).map((l) => l.text).join(" ").slice(0, 120);
          rootRef.current.dataset.blade = `${Math.round(bw)}x${Math.round(bh)}`;
        }
      }
      if (rootRef.current) rootRef.current.dataset.progress = String(L.height > 0 ? Math.round((m.y / L.height) * 100) : 0);
      m.x = Math.max(-colW / 2 - 14, Math.min(colW / 2 + 14, m.x));
      m.y = Math.max(0, Math.min(Math.max(0, L.height), m.y));

      const cx = W / 2;
      const top = (H - bh) / 2 + 6;
      const bandH = bh * 0.64;
      const bandTop = top + bh * 0.19;
      const scroll = scrollFor(m.y, L.height, bandH - 24);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(9,12,18,0.95)";
      ctx.fillRect(0, 0, W, H);

      // the blade (low-poly broad outline, stalk at the bottom)
      const bladePath = (inset: number): Path2D => {
        const p = new Path2D();
        BLADE.forEach(([u, v], i) => {
          const x = cx + (u / U_MAX) * (bw / 2 - inset);
          const y = top + bh - v * (bh - inset * 2) - inset;
          if (i === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        });
        p.closePath();
        return p;
      };
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 28;
      ctx.fillStyle = paleLeaf(note.color, 0.16);
      ctx.fill(bladePath(0));
      ctx.restore();
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = paleLeaf(note.color, 0.55);
      ctx.stroke(bladePath(0));
      // stalk, midrib and side veins
      ctx.strokeStyle = "rgba(90,120,60,0.45)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, top + bh + 26);
      ctx.lineTo(cx, top + 14);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 9; i++) {
        const y = top + bh - (i / 9.5) * bh;
        const half = (bw / 2) * 0.62 * Math.sin(Math.PI * Math.min(1, (i / 9.5) * 1.05));
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(cx - half, y - half * 0.55);
        ctx.moveTo(cx, y);
        ctx.lineTo(cx + half, y - half * 0.55);
        ctx.stroke();
      }

      // the text, clipped to the blade and to the reading band
      ctx.save();
      ctx.clip(bladePath(10));
      ctx.beginPath();
      ctx.rect(0, bandTop, W, bandH);
      ctx.clip();
      const colX = cx - colW / 2;
      const y0 = bandTop + 12 - scroll;
      const cur = lineAt(L.lines, m.y);
      for (let i = 0; i < L.lines.length; i++) {
        const ln = L.lines[i];
        const y = y0 + ln.y;
        if (y < bandTop - 40 || y > bandTop + bandH + 40) continue;
        if (ln.kind === "hr") {
          ctx.strokeStyle = "rgba(60,80,40,0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(colX, y);
          ctx.lineTo(colX + colW, y);
          ctx.stroke();
          continue;
        }
        if (ln.kind === "code") {
          ctx.fillStyle = "rgba(40,60,30,0.10)";
          ctx.fillRect(colX - 4, y - ln.size * 1.05, colW + 8, ln.size * 1.45);
        }
        if (ln.kind === "quote") {
          ctx.fillStyle = "rgba(90,120,60,0.5)";
          ctx.fillRect(colX + 2, y - ln.size * 1.0, 3, ln.size * 1.4);
        }
        if (i === cur) {
          ctx.fillStyle = "rgba(255,230,120,0.30)";
          ctx.fillRect(colX - 6, y - ln.size * 1.05, colW + 12, ln.size * 1.45);
        }
        ctx.font = font(ln.size, ln.bold, ln.mono);
        ctx.fillStyle = ln.kind === "h1" || ln.kind === "h2" ? "#23361a" : ln.kind === "h3" ? "#2c4220" : "#1c2615";
        if (ln.mark) {
          ctx.fillText(ln.mark, colX + ln.x - 16, y);
        }
        ctx.fillText(ln.text, colX + ln.x, y);
      }
      ctx.restore();

      // the ant
      const mx = cx + m.x;
      const my = Math.max(bandTop + 8, Math.min(bandTop + bandH - 8, bandTop + 12 - scroll + m.y - 4));
      drawAnt(ctx, mx, my, m.face, m.t);

      // frame furniture
      ctx.font = `bold 18px ${SERIF}`;
      ctx.fillStyle = "#e8dcc0";
      ctx.textAlign = "center";
      ctx.fillText(note.title.slice(0, 80), cx, Math.max(26, top - 14));
      ctx.font = `13px ${SERIF}`;
      ctx.fillStyle = "#b9b09a";
      const prog = L.height > 0 ? Math.round((m.y / L.height) * 100) : 0;
      ctx.fillText(`${status === "loading" ? "loading…" : `${prog}%`}  ·  S read on · W back · A/D sideways · wheel scrolls · R open in the reader · Esc or 1-4 (another animal) climb back out`, cx, Math.min(H - 12, top + bh + 44));
      ctx.textAlign = "left";
      if (note.learn) {
        ctx.font = `12px ${SERIF}`;
        ctx.fillStyle = note.noai ? "#d8b868" : "#8fd08a";
        ctx.fillText(note.noai ? "learning leaf · kept away from AI" : "learning leaf", 16, 24);
      }
      // a thin progress mark along the midrib
      if (L.height > bandH) {
        const frac = m.y / L.height;
        ctx.fillStyle = "rgba(60,90,40,0.7)";
        ctx.fillRect(cx - 2, bandTop + (bandH - 20) * frac, 4, 20);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      cv.removeEventListener("wheel", onWheel);
    };
  }, [chars, note.color, note.title, note.learn, note.noai, status]);

  return (
    <div ref={rootRef} className="leaf-view" role="dialog" aria-label="Leaf view" data-testid="leaf-view" data-status={status} data-chars={chars}>
      <canvas ref={ref} data-testid="leaf-canvas" />
      <div className="leaf-actions">
        <button onClick={() => props.onClose()}>back to the tree (Esc)</button>
        <button onClick={props.onOpenReader}>open in the reader (R)</button>
      </div>
    </div>
  );
}

/** A tiny ant: head, thorax, abdomen, six legs that scurry while it moves. */
function drawAnt(ctx: CanvasRenderingContext2D, x: number, y: number, face: number, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(face - Math.PI / 2);
  ctx.strokeStyle = "#2a2018";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const oy = -2 + i * 3.4;
    const s = Math.sin(t * 22 + i * 2.1) * 2.4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 2, oy);
      ctx.lineTo(side * 7, oy - 3 + s);
      ctx.lineTo(side * 10, oy + 2 + s);
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#3a2a1c";
  ctx.beginPath();
  ctx.ellipse(0, 7, 3.6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a3624";
  ctx.beginPath();
  ctx.ellipse(0, 0.5, 2.4, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2a2018";
  ctx.beginPath();
  ctx.ellipse(0, -4.6, 2.8, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2a2018";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-1, -6.5);
  ctx.lineTo(-3.5, -10);
  ctx.moveTo(1, -6.5);
  ctx.lineTo(3.5, -10);
  ctx.stroke();
  ctx.restore();
}
