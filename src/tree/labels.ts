/**
 * tree/labels.ts — names for the branches (the folders), as sprites in the 3D scene.
 *
 *   signs   — a wooden board at the base of each BIG branch (readable from a distance, hidden behind bark)
 *   bubbles — a speech bubble floating over EVERY branch, drawn over everything (a "map" of the tree)
 *   off     — nothing
 *
 * Sprites keep a roughly constant on-screen size: they grow with the distance to the camera
 * (clamped), so far branches stay readable and near ones don't fill the screen.
 */

import * as THREE from "three";
import { frameAt, radiusAt, type World } from "./world3";

export type LabelMode = "signs" | "bubbles" | "off";
export const LABEL_MODES: readonly LabelMode[] = ["signs", "bubbles", "off"];

/** Branches thick enough (start radius) to get a sign at their base. */
const SIGN_MIN_R = 13;

interface Entry {
  sprite: THREE.Sprite;
  at: THREE.Vector3;
  /** World size at scale 1. */
  w: number;
  h: number;
  /** Distance divisor for the size growth. */
  k: number;
  maxScale: number;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number): { text: string; size: number } {
  let s = size;
  ctx.font = `bold ${s}px sans-serif`;
  while (s > 17 && ctx.measureText(text).width > maxW) {
    s -= 2;
    ctx.font = `bold ${s}px sans-serif`;
  }
  let t = text;
  while (t.length > 3 && ctx.measureText(t).width > maxW) t = t.slice(0, -2);
  return { text: t === text ? t : `${t.trimEnd()}…`, size: s };
}

function labelTexture(text: string, mode: "signs" | "bubbles"): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 80;
  const ctx = cv.getContext("2d")!;
  if (mode === "signs") {
    const g = ctx.createLinearGradient(0, 0, 0, 80);
    g.addColorStop(0, "#8a6842");
    g.addColorStop(1, "#6a4a2c");
    ctx.fillStyle = g;
    ctx.fillRect(4, 6, 248, 56);
    ctx.strokeStyle = "#3a2814";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 6, 248, 56);
    ctx.fillStyle = "#3a2814"; // nails
    for (const [x, y] of [[14, 16], [242, 16], [14, 52], [242, 52]]) ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillStyle = "#4a3420"; // post
    ctx.fillRect(120, 62, 16, 18);
  } else {
    ctx.fillStyle = "rgba(255,250,232,0.94)";
    ctx.strokeStyle = "#3a2e1e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 56, 16);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // tail
    ctx.moveTo(112, 60);
    ctx.lineTo(128, 78);
    ctx.lineTo(144, 60);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,250,232,0.94)";
    ctx.fillRect(114, 58, 28, 4);
  }
  const fit = fitText(ctx, text, 224, 30);
  ctx.font = `bold ${fit.size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = mode === "signs" ? "#f4e8c8" : "#2a2014";
  ctx.fillText(fit.text, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BranchLabels {
  readonly group = new THREE.Group();
  private entries: Entry[] = [];

  clear(): void {
    for (const e of this.entries) {
      e.sprite.material.map?.dispose();
      e.sprite.material.dispose();
    }
    this.group.clear();
    this.entries = [];
  }

  rebuild(world: World, titles: ReadonlyMap<string, string>, mode: LabelMode): void {
    this.clear();
    if (mode === "off") return;
    for (const b of world.branches.values()) {
      const title = titles.get(b.id);
      if (!title) continue;
      if (mode === "signs" && b.r < SIGN_MIN_R) continue;
      const sign = mode === "signs";
      const s = sign ? Math.min(b.total * 0.08, 140) : b.total * 0.5;
      const f = frameAt(b, s);
      const lift = radiusAt(b, s) + (sign ? 24 : 34);
      const at = new THREE.Vector3(f.p.x, f.p.y, f.p.z);
      if (sign) at.add(new THREE.Vector3(f.u.x, f.u.y, f.u.z).multiplyScalar(lift));
      else at.y += lift;
      const mat = new THREE.SpriteMaterial({ map: labelTexture(title, mode), transparent: true, depthTest: sign, depthWrite: false, fog: sign });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = sign ? 5 : 20;
      sprite.position.copy(at);
      this.group.add(sprite);
      const h = sign ? 34 : 30;
      this.entries.push({ sprite, at, w: h * 3.2, h, k: sign ? 900 : 520, maxScale: sign ? 6 : 12 });
    }
  }

  /** Keep the on-screen size roughly constant (call every frame). */
  update(camera: THREE.Camera): void {
    for (const e of this.entries) {
      const d = e.at.distanceTo(camera.position);
      const f = Math.min(e.maxScale, Math.max(1, d / e.k));
      e.sprite.scale.set(e.w * f, e.h * f, 1);
    }
  }
}
