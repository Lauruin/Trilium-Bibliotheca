/**
 * tree/sky.ts — the sky of the tree view (three.js): the dome, the sun, the moon and the stars, driven by a `Daylight` (daylight.ts).
 *
 * The dome is ONE shader (zenith / horizon / sun-glow colours as uniforms), so the colours of the whole sky change for the price of
 * a few uniform writes per update. The sun disc, the moon and the stars follow the camera (they are at infinity) and fade with the
 * time of day. Nothing here is lit or fogged.
 */

import * as THREE from "three";
import type { Daylight, RGB } from "./daylight";
import { hash } from "./lpkit";

const R = 26000;

const lin = (c: THREE.Color, rgb: RGB): void => {
  c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
};

const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSun;
uniform float uGlowAmt;
varying vec3 vDir;
void main() {
  float t = clamp(vDir.y / 0.65, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(t, 0.7));
  float sd = max(0.0, dot(vDir, uSun));
  c = mix(c, uGlow, (pow(sd, 9.0) * 0.42 + pow(sd, 60.0) * 0.35) * uGlowAmt);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** A soft round sprite texture: `inner` colour fading to transparent. */
function glowTexture(inner: string, mid: string, size = 128): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const cx = cv.getContext("2d")!;
  const h = size / 2;
  const gr = cx.createRadialGradient(h, h, size * 0.03, h, h, h - 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, mid);
  gr.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = gr;
  cx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

/** The moon: a pale disc with a few darker seas and a soft halo. */
function moonTexture(): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const cx = cv.getContext("2d")!;
  const h = size / 2;
  const halo = cx.createRadialGradient(h, h, size * 0.2, h, h, h);
  halo.addColorStop(0, "rgba(200,215,255,0.35)");
  halo.addColorStop(1, "rgba(200,215,255,0)");
  cx.fillStyle = halo;
  cx.fillRect(0, 0, size, size);
  cx.save();
  cx.beginPath();
  cx.arc(h, h, size * 0.2, 0, Math.PI * 2);
  cx.clip();
  cx.fillStyle = "#e9eefc";
  cx.fillRect(0, 0, size, size);
  cx.fillStyle = "rgba(150,165,200,0.5)";
  for (const [x, y, r] of [[0.46, 0.44, 0.07], [0.56, 0.52, 0.05], [0.5, 0.6, 0.06], [0.42, 0.55, 0.035]] as const) {
    cx.beginPath();
    cx.arc(size * x, size * y, size * r, 0, Math.PI * 2);
    cx.fill();
  }
  cx.restore();
  return new THREE.CanvasTexture(cv);
}

export class SkyRig {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private sun: THREE.Sprite;
  private moon: THREE.Sprite;
  private stars: THREE.Points;
  private tmp = new THREE.Color();

  constructor() {
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uGlowAmt: { value: 0.5 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 18), this.domeMat);
    this.dome.renderOrder = -4;
    this.dome.frustumCulled = false;

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,250,225,1)", "rgba(255,240,190,0.65)"), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.sun.scale.set(5200, 5200, 1);
    this.sun.renderOrder = -1;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.moon.scale.set(4200, 4200, 1);
    this.moon.renderOrder = -1;

    // ~900 stars on the upper sphere (deterministic), a few warm, a few cool, three sizes of brightness
    const N = 900;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = hash(i * 1.7 + 3), v = hash(i * 2.9 + 11);
      const y = 0.02 + 0.98 * u; // keep them above the horizon
      const a = v * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * R * 0.95, y * R * 0.95, Math.sin(a) * r * R * 0.95], i * 3);
      const b = 0.55 + 0.45 * hash(i * 5.3 + 1);
      const tint = hash(i * 7.1 + 2);
      col.set([b * (tint > 0.8 ? 1 : 0.85), b * 0.9, b * (tint < 0.2 ? 1 : 0.95)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.stars.renderOrder = -3;
    this.stars.frustumCulled = false;
    this.group.add(this.dome, this.stars, this.sun, this.moon);
  }

  /** Apply a Daylight and keep the sky centred on the camera. */
  update(d: Daylight, cam: THREE.Vector3): void {
    const u = this.domeMat.uniforms;
    lin(u.uZenith.value as THREE.Color, d.skyZenith);
    lin(u.uHorizon.value as THREE.Color, d.skyHorizon);
    lin(u.uGlow.value as THREE.Color, d.glowColor);
    (u.uSun.value as THREE.Vector3).set(d.sunDir.x, d.sunDir.y, d.sunDir.z);
    u.uGlowAmt.value = d.glowStrength;
    this.group.position.copy(cam);
    this.sun.position.set(d.sunDir.x * 22000, d.sunDir.y * 22000, d.sunDir.z * 22000);
    const sm = this.sun.material;
    sm.opacity = d.sunDisc;
    lin(this.tmp, d.glowColor);
    sm.color.copy(this.tmp).lerp(new THREE.Color(1, 1, 1), 0.4);
    this.sun.visible = d.sunDisc > 0.01;
    this.moon.position.set(d.moonDir.x * 21500, d.moonDir.y * 21500, d.moonDir.z * 21500);
    this.moon.material.opacity = d.moon;
    this.moon.visible = d.moon > 0.01;
    (this.stars.material as THREE.PointsMaterial).opacity = d.stars;
    this.stars.visible = d.stars > 0.01;
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    for (const s of [this.sun, this.moon]) {
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
  }
}
