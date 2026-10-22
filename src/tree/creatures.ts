/**
 * tree/creatures.ts — draws the animal: `CreatureRig` owns the meshes (one `group`) and poses them every frame from the sim's
 * `Creature` (head / trailing body / procedural feet / flight / glide / aim), in either look. What each animal looks like is DATA in
 * animalmodels.ts; this file is the engine:
 *   - the body path (a frame at any distance behind the head, from the trail's surface points or, flying, rigid behind the head),
 *     with cosmetic deformation on top (slither, tail sway / raise, hover droop, breathing, a gait bob);
 *   - tubes: lofted rings along the path (low-poly: faceted non-indexed mesh with crisp per-face colours; voxel: stepped square boxes),
 *     one dynamic mesh each;
 *   - parts attached in the body frame (blob / cone / prism / stick / plate), mirrored pairs, head parts that turn and nod;
 *   - legs: two-bone IK from the sim's feet (+ an optional ankle), paws and toes; wings: chains of flat panels that flap;
 *   - the squirrel's glide membranes.
 * All meshes are plain `Mesh`es (castShadow can be set on them), materials are shared per colour and disposed with the group.
 * The model stays inside the sim's widths; nothing here feeds back into the sim.
 */

import * as THREE from "three";
import { bodyPoint, flightBasis, footLift, type Animal, type Creature } from "./sim3";
import { surfacePoint, type World } from "./world3";
import { disposeGroup, T3, VOX, type Look } from "./look";
import { MODELS, WING_SHAPES, genericModel, type Att, type LegStyle, type Model, type Outline, type TubeSpec } from "./animalmodels";

type V = THREE.Vector3;
const V3 = (x = 0, y = 0, z = 0): V => new THREE.Vector3(x, y, z);

/** A coordinate frame on the body: position, forward (towards the head), up (surface normal side), side (= up x forward), half width. */
interface Frame {
  p: V;
  f: V;
  u: V;
  s: V;
  w: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function orthoFrame(p: V, f0: V, n: V, w: number): Frame {
  const f = f0.clone();
  if (f.lengthSq() < 1e-9) f.set(1, 0, 0);
  f.normalize();
  const u = n.clone().addScaledVector(f, -n.dot(f));
  if (u.lengthSq() < 1e-8) u.set(0, 1, 0).addScaledVector(f, -f.y);
  if (u.lengthSq() < 1e-8) u.set(1, 0, 0);
  u.normalize();
  return { p, f, u, s: new THREE.Vector3().crossVectors(u, f).normalize(), w };
}

/** The unit-geometry kinds, per look. Cones and prisms start at their base (z = 0) and point along +z. */
function makeGeo(kind: "blob" | "cone" | "prism", poly: boolean, taper: number, lo: boolean): THREE.BufferGeometry {
  if (kind === "blob") return poly ? new THREE.IcosahedronGeometry(0.5, lo ? 0 : 1) : new THREE.BoxGeometry(1, 1, 1);
  if (kind === "cone") {
    const g = new THREE.ConeGeometry(0.5, 1, poly ? 5 : 4).rotateX(Math.PI / 2);
    if (!poly) g.rotateZ(Math.PI / 4);
    return g.translate(0, 0, 0.5);
  }
  const g = poly ? new THREE.CylinderGeometry(0.5 * taper, 0.5, 1, 6).rotateX(Math.PI / 2) : new THREE.BoxGeometry(1, 1, 1);
  return g.translate(0, 0, 0.5);
}

/** A flat outline as a fan of crisp-coloured triangles in the x-z plane (x 0..1 outward, scaled by the mesh). `flip` mirrors x. */
function plateGeo(o: Outline, flip: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const sx = flip ? -1 : 1;
  let cx = 0, cz = 0;
  for (const [x, z] of o.pts) {
    cx += x / o.pts.length;
    cz += z / o.pts.length;
  }
  const c = new THREE.Color();
  for (let i = 0; i < o.pts.length; i++) {
    const a = o.pts[i];
    const b = o.pts[(i + 1) % o.pts.length];
    pos.push(cx * sx, 0, cz, a[0] * sx, 0, a[1], b[0] * sx, 0, b[1]);
    c.set(o.col((cx + a[0] + b[0]) / 3, (cz + a[1] + b[1]) / 3));
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** A soft pale rim on silhouette edges so the animal reads against bark and leaves (added to every creature material). */
function addRim(mat: THREE.MeshLambertMaterial): void {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float rimK = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.6);
       outgoingLight += vec3(0.9, 0.95, 1.0) * rimK * 0.26;
       #include <opaque_fragment>`,
    );
  };
  mat.customProgramCacheKey = () => "creature-rim";
}

// ---- tubes ------------------------------------------------------------------------------------------

class Tube {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly ds: number[];
  private readonly stepped: boolean;
  private readonly S: number;

  constructor(readonly spec: TubeSpec, poly: boolean, readonly k: number, mat: THREE.Material) {
    this.stepped = !poly;
    this.S = poly ? spec.sides ?? 8 : 4;
    const step = (poly ? spec.step : spec.voxStep ?? spec.step * 1.6) * k;
    const d0 = spec.d0 * k;
    const d1 = spec.d1 * k;
    const n = Math.max(2, Math.round((d1 - d0) / step));
    this.ds = Array.from({ length: n + 1 }, (_, i) => d0 + ((d1 - d0) * i) / n);
    const segs = this.stepped ? n : n; // stepped: one box per interval; poly: one ring pair per interval
    const S = this.S;
    const verts = this.stepped ? segs * 36 : segs * S * 6 + 2 * S * 3;
    this.pos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const c = new THREE.Color();
    let o = 0;
    const put = (hex: string, cnt: number): void => {
      c.set(hex);
      for (let q = 0; q < cnt; q++) {
        col[o++] = c.r;
        col[o++] = c.g;
        col[o++] = c.b;
      }
    };
    for (let r = 0; r < segs; r++) {
      const d = (this.ds[r] + this.ds[r + 1]) / 2 / k;
      const base = { d, u: (r + 0.5) / segs, i: r };
      if (this.stepped) {
        put(spec.color({ ...base, phi: 0, side: 0 }), 6);
        put(spec.color({ ...base, phi: Math.PI / 2, side: 1 }), 6);
        put(spec.color({ ...base, phi: Math.PI, side: 0 }), 6);
        put(spec.color({ ...base, phi: Math.PI / 2, side: -1 }), 6);
        put(spec.color({ ...base, phi: Math.PI / 2, side: 0 }), 12);
      } else {
        for (let q = 0; q < S; q++) {
          const th = ((q + 0.5) / S) * Math.PI * 2;
          const phi = Math.abs(Math.atan2(Math.sin(th), Math.cos(th)));
          put(spec.color({ ...base, phi, side: Math.sin(th) > 1e-3 ? 1 : Math.sin(th) < -1e-3 ? -1 : 0 }), 6);
        }
      }
    }
    if (!this.stepped) {
      put(spec.color({ d: spec.d0, u: 0, i: 0, phi: Math.PI / 2, side: 0 }), S * 3);
      put(spec.color({ d: spec.d1, u: 1, i: segs, phi: Math.PI / 2, side: 0 }), S * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  /** Re-lay the rings along the (deformed) body: `frame(d)` in scaled units; `breath` scales the height. */
  update(frame: (d: number) => Frame, breath: number): void {
    const k = this.k;
    const spec = this.spec;
    const P = this.pos;
    let o = 0;
    const put = (v: V): void => {
      P[o++] = v.x;
      P[o++] = v.y;
      P[o++] = v.z;
    };
    const quad = (a: V, b: V, c: V, d: V): void => {
      put(a), put(b), put(c), put(a), put(c), put(d);
    };
    if (this.stepped) {
      const fr = this.ds.map((d) => frame(d));
      for (let r = 0; r + 1 < this.ds.length; r++) {
        const mid = frame((this.ds[r] + this.ds[r + 1]) / 2);
        const [rw0, rh0] = spec.prof((this.ds[r] + this.ds[r + 1]) / 2 / k, mid.w / k);
        const rw = Math.max(0.15, rw0 * k), rh = Math.max(0.15, rh0 * k * breath);
        const a = fr[r].p, b = fr[r + 1].p;
        const corner = (end: V, su: number, ss: number): V => end.clone().addScaledVector(mid.u, su * rh).addScaledVector(mid.s, ss * rw);
        const A = [corner(a, 1, 1), corner(a, 1, -1), corner(a, -1, -1), corner(a, -1, 1)];
        const B = [corner(b, 1, 1), corner(b, 1, -1), corner(b, -1, -1), corner(b, -1, 1)];
        quad(A[1], A[0], B[0], B[1]); // top
        quad(A[0], A[3], B[3], B[0]); // +side
        quad(A[3], A[2], B[2], B[3]); // belly
        quad(A[2], A[1], B[1], B[2]); // -side
        quad(A[0], A[1], A[2], A[3]); // front
        quad(B[3], B[2], B[1], B[0]); // back
      }
    } else {
      const S = this.S;
      const R = this.ds.length;
      const ring = new Float32Array(R * S * 3);
      const cen = new Float32Array(R * 3);
      for (let i = 0; i < R; i++) {
        const d = this.ds[i];
        const F = frame(d);
        const [rw0, rh0] = spec.prof(d / k, F.w / k);
        const rw = Math.max(0.08, rw0 * k), rh = Math.max(0.08, rh0 * k * breath);
        cen[i * 3] = F.p.x, cen[i * 3 + 1] = F.p.y, cen[i * 3 + 2] = F.p.z;
        for (let q = 0; q < S; q++) {
          const th = (q / S) * Math.PI * 2;
          const top = q === 0 && spec.crest ? spec.crest(d / k, i) * k : 0;
          const cu = Math.cos(th) * (rh + top), cs = Math.sin(th) * rw;
          const o = (i * S + q) * 3;
          ring[o] = F.p.x + F.u.x * cu + F.s.x * cs;
          ring[o + 1] = F.p.y + F.u.y * cu + F.s.y * cs;
          ring[o + 2] = F.p.z + F.u.z * cu + F.s.z * cs;
        }
      }
      const at = (i: number, q: number): number => (i * S + (q % S)) * 3;
      const pr = (o: number): void => {
        P[w++] = ring[o];
        P[w++] = ring[o + 1];
        P[w++] = ring[o + 2];
      };
      const pc = (i: number): void => {
        P[w++] = cen[i * 3];
        P[w++] = cen[i * 3 + 1];
        P[w++] = cen[i * 3 + 2];
      };
      let w = 0;
      for (let r = 0; r + 1 < R; r++) {
        for (let q = 0; q < S; q++) {
          const a = at(r, q), b = at(r, q + 1), c = at(r + 1, q + 1), d = at(r + 1, q);
          pr(a), pr(b), pr(c), pr(a), pr(c), pr(d);
        }
      }
      for (let q = 0; q < S; q++) pc(0), pr(at(0, q + 1)), pr(at(0, q));
      for (let q = 0; q < S; q++) pc(R - 1), pr(at(R - 1, q)), pr(at(R - 1, q + 1));
    }
    const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}

// ---- the rig ------------------------------------------------------------------------------------------

interface AttPart {
  att: Att;
  mesh: THREE.Mesh;
  sgn: 1 | -1;
}

interface LegPart {
  style: LegStyle;
  segs: THREE.Mesh[];
  joints: THREE.Mesh[];
  paw: THREE.Mesh | null;
  toes: THREE.Mesh[];
}

interface WingPart {
  sgn: 1 | -1;
  pair: number;
  panels: THREE.Mesh[];
  /** Fainter copies drawn a little behind the beat (fast insect wings). */
  ghost?: THREE.Mesh[];
}

export class CreatureRig {
  readonly group = new THREE.Group();
  camScale = 1;
  /** World points the last update posed: the head and the middle of the body (for cameras / debugging). */
  readonly headPoint = V3();
  readonly center = V3();
  private look: Look = "voxel";
  private built: { animal: Animal; look: Look } | null = null;
  private model: Model = genericModel({ nodes: [], legs: [] } as unknown as Animal);
  private mats = new Map<string, THREE.MeshLambertMaterial>();
  private geos = new Map<string, THREE.BufferGeometry>();
  private tubes: Tube[] = [];
  private atts: AttPart[] = [];
  private legParts: LegPart[] = [];
  private wingParts: WingPart[] = [];
  private membranes: THREE.Mesh[] = [];
  private lastT = 0;
  private wingOpen = 0;
  private wingPhase = 0;
  private glideOpen = 0;

  /** Forget the built meshes (look or animal changed); they are rebuilt on the next update. */
  invalidate(): void {
    this.built = null;
  }

  dispose(): void {
    disposeGroup(this.group);
    this.mats.clear();
    this.geos.clear();
  }

  // ---- building ----

  private mat(col: string, shade = 1, o: { alpha?: number; double?: boolean; vc?: boolean } = {}): THREE.MeshLambertMaterial {
    const key = `${col}|${shade}|${o.alpha ?? 1}|${o.double ? 1 : 0}|${o.vc ? 1 : 0}`;
    let m = this.mats.get(key);
    if (!m) {
      const alpha = o.alpha ?? 1;
      m = new THREE.MeshLambertMaterial({
        color: o.vc ? 0xffffff : new THREE.Color(col).multiplyScalar(shade),
        vertexColors: !!o.vc,
        flatShading: this.look === "lowpoly" || !!o.vc, // normal-less meshes (tubes, plates) are lit from screen-space derivatives in both looks
        side: o.double ? THREE.DoubleSide : THREE.FrontSide,
        transparent: alpha < 1,
        opacity: alpha,
        depthWrite: alpha >= 1,
      });
      addRim(m);
      this.mats.set(key, m);
    }
    return m;
  }

  private geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = make()));
    return g;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  private shape(kind: "blob" | "cone" | "prism", taper = 0.75, lo = false): THREE.BufferGeometry {
    const poly = this.look === "lowpoly";
    return this.geo(`${kind}|${poly}|${taper.toFixed(2)}|${lo}`, () => makeGeo(kind, poly, taper, lo));
  }

  private build(a: Animal): void {
    disposeGroup(this.group);
    this.mats.clear();
    this.geos.clear();
    this.tubes = [];
    this.atts = [];
    this.legParts = [];
    this.wingParts = [];
    this.membranes = [];
    const poly = this.look === "lowpoly";
    const m = (this.model = MODELS[a.id] ?? genericModel(a));
    const k = a.scale || 1;
    // tubes
    for (const t of m.tubes) {
      const tube = new Tube(t, poly, k, this.mat("#ffffff", 1, { vc: true, double: !poly }));
      this.group.add(tube.mesh);
      this.tubes.push(tube);
    }
    // attached parts (mirrored ones twice)
    for (const att of m.atts) {
      if (att.only && att.only !== this.look) continue;
      for (const sgn of att.mirror ? ([1, -1] as const) : ([1] as const)) {
        let mesh: THREE.Mesh;
        if (att.kind === "plate") {
          const o = WING_SHAPES[att.plate ?? ""] ?? WING_SHAPES.bee1;
          mesh = this.mesh(this.geo(`plate|${att.plate}|${sgn}`, () => plateGeo(o, sgn < 0)), this.mat("#ffffff", 1, { vc: true, double: true, alpha: att.alpha }));
        } else {
          const taper = att.kind === "stick" ? Math.min(1, Math.max(0.05, att.size[1] / Math.max(1e-3, att.size[0]))) : 0.75;
          const kind = att.kind === "stick" ? "prism" : att.kind;
          mesh = this.mesh(this.shape(kind, kind === "prism" ? Math.round(taper * 20) / 20 : 0.75, !!att.lo), this.mat(att.col, att.shade ?? 1, { alpha: att.alpha }));
        }
        this.atts.push({ att, mesh, sgn });
      }
    }
    // legs
    a.legs.forEach((leg, i) => {
      const st = m.legs ? m.legs(i, a.legs.length, leg) : { len: 1.3, bend: [0, 0.5, 1] as [number, number, number], th: [3, 2.4] as [number, number], col: a.body };
      const lm = this.mat(st.col);
      const lm2 = this.mat(st.colLow ?? st.col, 0.92);
      const nSeg = st.ankle ? 3 : 2;
      const segs: THREE.Mesh[] = [];
      for (let q = 0; q < nSeg; q++) segs.push(this.mesh(this.shape("prism", 0.75), q === 0 ? lm : lm2));
      const joints: THREE.Mesh[] = [];
      for (let q = 0; q < nSeg - 1; q++) joints.push(this.mesh(this.shape("blob", 0.75, true), this.mat(st.joint ?? st.col)));
      let paw: THREE.Mesh | null = null;
      const toes: THREE.Mesh[] = [];
      if (st.paw) {
        paw = this.mesh(this.shape("blob", 0.75, true), this.mat(st.paw.col));
        for (let q = 0; q < (st.paw.toes?.n ?? 0); q++) toes.push(this.mesh(this.shape("cone", 0.75, true), this.mat(st.paw.toes!.col)));
      }
      this.legParts.push({ style: st, segs, joints, paw, toes });
    });
    // wings
    if (m.wings) {
      const w = m.wings;
      for (let pair = 0; pair < w.pairs; pair++) {
        for (const sgn of [1, -1] as const) {
          const mk = (p: (typeof w.panels)[number], alpha: number): THREE.Mesh => {
            // two-pair wings use the shape's fore (1) / hind (2) outline: `bee1` -> `bee2`
            const key = w.pairs === 2 ? `${p.shape.replace(/\d$/, "")}${pair + 1}` : p.shape;
            const o = WING_SHAPES[WING_SHAPES[key] ? key : p.shape] ?? WING_SHAPES.bee1;
            return this.mesh(this.geo(`wing|${key}|${sgn}`, () => plateGeo(o, sgn < 0)), this.mat("#ffffff", 1, { vc: true, double: true, alpha }));
          };
          const panels = w.panels.map((p) => mk(p, w.alpha));
          const ghost = (a.wings?.flapHz ?? 0) > 20 ? w.panels.map((p) => mk(p, w.alpha * 0.45)) : undefined;
          this.wingParts.push({ sgn, pair, panels, ghost });
        }
      }
    }
    // squirrel glide membranes: two dynamic quads
    if (m.membrane) {
      for (let side = 0; side < 2; side++) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
        const c = new THREE.Color(m.membrane.col);
        const e = new THREE.Color(m.membrane.edge);
        const cols = [c, e, e, c, e, c].flatMap((x) => [x.r, x.g, x.b]);
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cols), 3));
        this.membranes.push(this.mesh(g, this.mat("#ffffff", 1, { vc: true, double: true })));
      }
    }
    const len = Math.max(...a.nodes.map((n) => n.d));
    this.camScale = Math.min(1.25, Math.max(0.22, Math.sqrt(len / 285)));
    this.built = { animal: a, look: this.look };
  }

  // ---- per frame ----

  update(world: World, c: Creature, t: number, look: Look): void {
    const a = c.animal;
    if (look !== this.look) this.built = null;
    this.look = look;
    if (!this.built || this.built.animal !== a || this.built.look !== look) this.build(a);
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const m = this.model;
    const k = a.scale || 1;
    const flying = !!c.flight;
    const fb = flying ? flightBasis(c) : null;
    const voxLift = look === "voxel" ? VOX * 0.45 : 0;
    const speed01 = Math.min(1, Math.abs(c.speedNow) / Math.max(1, a.speed));
    const idle = flying || c.air || c.silk ? 0 : 1 - speed01;
    const ph = c.D / Math.max(1, k); // gait / slither phase base, in unscaled px walked
    const shake = c.shake;
    const wob = flying && a.flight && a.flight.bob > 0
      ? V3(Math.sin(t * 6.3) * 0.5, Math.sin(t * 8.1), Math.cos(t * 5.1) * 0.5).multiplyScalar(a.flight.bob)
      : V3();
    const jit = (i: number): V =>
      (shake > 0 ? V3(Math.sin(t * 61 + i * 7.1), Math.sin(t * 53 + i * 3.7), Math.sin(t * 47 + i * 5.3)).multiplyScalar(shake * a.nodes[0].w * 0.35) : V3()).add(wob);
    const flash = shake > 0 ? shake * (0.4 + 0.6 * Math.abs(Math.sin(t * 14))) : 0;
    for (const mt of this.mats.values()) mt.emissive.setRGB(flash * 0.9, flash * 0.1, flash * 0.05);

    // ---- body path: node positions (lifted off the bark), normals
    const crouch = c.aim ? 0.3 * c.aim.charge : 0;
    const stance = (m.stance ?? 1) * (1 - crouch);
    const hipW = a.legs.length ? a.legs.reduce((x, l) => x + a.nodes[l.node].w, 0) / a.legs.length : 0;
    const lift = (w: number): number => {
      const ww = m.level && hipW > 0 ? hipW : w;
      return ww * 0.55 + (a.legs.length === 0 || flying ? 0 : ww * 0.9 * stance) + (flying ? 0 : voxLift);
    };
    const bob = flying || c.air ? 0 : Math.sin((ph / Math.max(1, a.stride / k)) * Math.PI * 2) * speed01;
    const n = a.nodes.length;
    const P: V[] = [];
    const N: V[] = [];
    a.nodes.forEach((nd, i) => {
      const bp = bodyPoint(c, nd.d);
      let p = T3(bp.p);
      let nn = V3(0, 1, 0);
      if (fb && c.flight) {
        p = T3(c.flight.p).addScaledVector(T3(fb.fwd), -nd.d);
        nn = T3(fb.up);
      } else if (bp.surf) {
        const b = world.branches.get(bp.surf.b);
        if (b) {
          const sp = surfacePoint(b, bp.surf.s, bp.surf.th);
          nn = T3(sp.n);
          p = T3(sp.p);
        }
      }
      P.push(p.addScaledVector(nn, lift(nd.w) + bob * nd.w * 0.05).add(jit(i)));
      N.push(nn);
    });
    // tangents (towards the head) and cosmetic deformation along local axes
    const tang = (Q: V[]): V[] => Q.map((_, i) => Q[Math.max(0, i - 1)].clone().sub(Q[Math.min(n - 1, i + 1)]));
    this.headPoint.copy(P[0]);
    this.center.set(0, 0, 0);
    for (const p of P) this.center.addScaledVector(p, 1 / n);
    const T0 = tang(P);
    const dMax = a.nodes[n - 1].d / k;
    P.forEach((p, i) => {
      const d = a.nodes[i].d / k;
      const F = orthoFrame(p, T0[i], N[i], 0);
      let lat = 0, up = 0;
      if (m.slither) {
        const sl = m.slither;
        const env = smoothstep(sl.from ?? 0, (sl.from ?? 0) + 30, d);
        const wave = (sl.wave > 0 ? 1 : 0) * 2 * Math.PI * (ph / sl.wave - d / sl.wave);
        lat += env * (sl.amp * speed01 * Math.sin(wave) + (sl.idle ?? 0) * idle * Math.sin(t * 1.3 - d / sl.wave * 4.4));
      }
      const tl = m.tail;
      if (tl && d >= tl.d0) {
        const j = (d - tl.d0) / Math.max(1, dMax - tl.d0);
        const calm = c.air && tl.flatInGlide ? 0.25 : 1;
        lat += tl.sway * Math.sin(t * tl.hz * Math.PI * 2 - j * 3.2) * Math.pow(j, 1.2) * (0.55 + 0.45 * idle + 0.4 * speed01);
        up += (tl.raise ?? 0) * Math.pow(j, tl.pow ?? 1.5) * calm;
      }
      if (m.droop && d >= m.droop.d0) up -= m.droop.amount * Math.pow((d - m.droop.d0) / Math.max(1, dMax - m.droop.d0), 1.5) * (flying ? 1 : 0.2);
      if (lat !== 0 || up !== 0) p.addScaledVector(F.s, lat * k).addScaledVector(F.u, up * k);
    });
    const T1 = tang(P);
    const D = a.nodes.map((x) => x.d);
    let cursor = 0;
    const frames = new Map<number, Frame>();
    const frame = (d: number): Frame => {
      const key = Math.round(d * 64);
      const hit = frames.get(key);
      if (hit) return hit;
      let F: Frame;
      if (d <= 0) F = orthoFrame(P[0].clone().addScaledVector(T1[0].clone().normalize(), -d), T1[0], N[0], a.nodes[0].w);
      else if (d >= D[n - 1]) F = orthoFrame(P[n - 1].clone().addScaledVector(T1[n - 1].clone().normalize(), -(d - D[n - 1])), T1[n - 1], N[n - 1], a.nodes[n - 1].w);
      else {
        let i = Math.min(cursor, n - 2);
        if (D[i] > d) i = 0;
        while (i < n - 2 && D[i + 1] < d) i++;
        cursor = i;
        const t01 = (d - D[i]) / Math.max(1e-6, D[i + 1] - D[i]);
        F = orthoFrame(
          P[i].clone().lerp(P[i + 1], t01),
          T1[i].clone().normalize().lerp(T1[i + 1].clone().normalize(), t01),
          N[i].clone().lerp(N[i + 1], t01),
          a.nodes[i].w + (a.nodes[i + 1].w - a.nodes[i].w) * t01,
        );
      }
      frames.set(key, F);
      return F;
    };

    // ---- head frame: turns and nods about the neck while idle / walking
    const hm = m.head;
    const neck = frame(a.nodes[Math.min(1, n - 1)].d * 0.55); // the head pivots about the neck, a little behind it
    const lookA = hm ? hm.look * idle * Math.sin(t * 0.55 + 1.1) * Math.sin(t * 0.31 + 0.4) * 1.3 : 0;
    const nodA = hm ? hm.nod * idle * Math.sin(t * 0.9 + 0.7) + (hm.bob ?? 0) * speed01 * Math.sin(ph / Math.max(1, a.stride / k) * Math.PI * 2) : 0;
    const headFrame = (F: Frame): Frame => {
      if (!lookA && !nodA) return F;
      const q = new THREE.Quaternion().setFromAxisAngle(F.u, lookA);
      const q2 = new THREE.Quaternion().setFromAxisAngle(F.s.clone().applyQuaternion(q), -nodA);
      q.premultiply(q2);
      return { p: neck.p.clone().add(F.p.clone().sub(neck.p).applyQuaternion(q)), f: F.f.clone().applyQuaternion(q), u: F.u.clone().applyQuaternion(q), s: F.s.clone().applyQuaternion(q), w: F.w };
    };

    // ---- tubes
    const breath = 1 + (m.breathe ?? 0) * idle * Math.sin(t * 2.3);
    for (const tb of this.tubes) tb.update(frame, breath);

    // ---- attached parts
    const blinkClosed = ((t / 3.7 + 0.31) % 1) < 0.035 ? 0.12 : 1;
    const flick = (((t / 4.3) % 1) / 0.16);
    const tongue = flick < 1 ? Math.pow(Math.sin(flick * Math.PI), 0.6) : 0;
    const q0 = new THREE.Quaternion();
    for (const ap of this.atts) {
      const at = ap.att;
      const base = at.frame === "head" ? headFrame(frame(at.d * k)) : frame(at.d * k);
      if (at.hide === "flight" && flying) { ap.mesh.visible = false; continue; }
      if (at.hide === "ground" && !flying) { ap.mesh.visible = false; continue; }
      if (at.hide === "air" && (c.air || flying)) { ap.mesh.visible = false; continue; }
      ap.mesh.visible = true;
      const sg = ap.sgn;
      const pt = (v: [number, number, number], scaleAbout?: [number, number, number], e = 1): V => {
        const x = scaleAbout ? scaleAbout[0] + (v[0] - scaleAbout[0]) * e : v[0];
        const y = scaleAbout ? scaleAbout[1] + (v[1] - scaleAbout[1]) * e : v[1];
        const z = scaleAbout ? scaleAbout[2] + (v[2] - scaleAbout[2]) * e : v[2];
        return base.p.clone().addScaledVector(base.f, x * k).addScaledVector(base.u, y * k).addScaledVector(base.s, z * sg * k);
      };
      if (at.kind === "stick" && at.to) {
        let e = 1;
        if (at.anim === "tongue") {
          e = tongue;
          if (e < 0.04) { ap.mesh.visible = false; continue; }
        }
        const p0 = pt(at.at, at.pivot, e);
        const p1 = pt(at.to, at.pivot, e);
        // antennae / whiskers wiggle a little
        if (at.anim === "antenna") p1.addScaledVector(base.u, Math.sin(t * 5.1 + at.at[2] * 2) * 0.5 * k).addScaledVector(base.s, Math.sin(t * 4.3 + sg) * 0.4 * k);
        const d = p1.clone().sub(p0);
        const L = d.length();
        setPart(ap.mesh, p0, d.normalize(), base.u, at.size[0] * k, at.size[0] * k, L);
        continue;
      }
      let [pitch, yaw, roll] = at.rot ?? [0, 0, 0];
      if (at.anim === "antenna") { pitch += Math.sin(t * 4.1) * 0.12; yaw += Math.sin(t * 3.3 + sg) * 0.15; }
      if (at.anim === "mandible") yaw += sg * (0.12 + 0.16 * Math.sin(t * 2.7));
      if (at.anim === "crest") pitch += flying ? 0.3 : 0.1 * Math.sin(t * 0.9) * idle; // sleeked back in flight, a slow lift when idle
      if (at.anim === "twitch") roll += (((t / 5.3 + (sg > 0 ? 0 : 0.37)) % 1) < 0.05 ? 0.35 : 0);
      const size: V3t = [...at.size];
      if (at.anim === "blink") size[1] *= blinkClosed;
      const p = pt(at.at);
      orient(ap.mesh, base, pitch, yaw * sg, roll * sg, q0);
      ap.mesh.position.copy(p);
      ap.mesh.scale.set(Math.max(0.2, size[0] * k), Math.max(0.2, size[1] * k), Math.max(0.2, size[2] * k));
    }

    // ---- legs
    const gliding = !!m.membrane && !!c.air && !c.air.slip && !!a.leap?.steer && a.legs.length >= 4;
    this.glideOpen += ((gliding ? 1 : 0) - this.glideOpen) * Math.min(1, dt * 9);
    const go = this.glideOpen;
    const nodeMid = a.legs.reduce((x, l) => x + l.node, 0) / Math.max(1, a.legs.length);
    const nodeSpread = a.legs.reduce((x, l) => Math.max(x, Math.abs(l.node - nodeMid)), 0);
    const footPos: V[] = [];
    a.legs.forEach((leg, i) => {
      const lp = this.legParts[i];
      const st = lp.style;
      const nd = a.nodes[leg.node];
      const F = frame(nd.d);
      const hipOut = st.hipOut ?? 0.85;
      const hip = F.p.clone().addScaledVector(F.s, leg.side * nd.w * hipOut).addScaledVector(F.u, -nd.w * 0.12);
      const hidden = st.hide === "flight" && flying;
      for (const q of [...lp.segs, ...lp.joints, ...(lp.paw ? [lp.paw] : []), ...lp.toes]) q.visible = !hidden;
      if (hidden) { footPos.push(hip.clone()); return; }
      const ankleH = (st.ankle ?? 0) * k;
      const hipH = lift(nd.w) - nd.w * 0.12;
      const lat = Math.max(0.3 * nd.w, a.splay - nd.w * hipOut);
      const Lt = Math.max(2, Math.hypot(Math.max(0.3 * nd.w, hipH - ankleH), lat) * st.len);
      const dirS = nodeSpread > 0 ? (leg.node < nodeMid ? 1 : -1) : leg.lead >= 0 ? 1 : -1; // front or hind leg (by hip node; all hips on one node: by lead)
      const f = c.feet[i];
      const fb2 = f ? world.branches.get(f.at.b) : undefined;
      let foot: V;
      let fn = N[Math.min(leg.node, n - 1)].clone();
      // gliding: the limbs stretch out sideways to hold the membrane wide (about 3.5 body half-widths from the axis)
      const spread = hip.clone().addScaledVector(F.s, leg.side * Math.max(Lt * 0.95, nd.w * (dirS > 0 ? 3.7 : 3.2))).addScaledVector(F.f, dirS * Math.max(Lt * 0.5, nd.w * (dirS > 0 ? 1.4 : 1.9))).addScaledVector(F.u, -Lt * 0.05);
      if (c.air || c.silk || flying || !fb2) {
        const tuck = hip.clone().addScaledVector(F.s, leg.side * nd.w * (flying ? 0.25 : 0.8)).addScaledVector(F.u, -nd.w * (flying ? 0.9 : 1.1)).addScaledVector(F.f, flying ? -nd.w * leg.lead * 0.1 : 0);
        const stretch = st.air === "stretch" && !flying && !c.silk
          ? hip.clone().addScaledVector(F.f, dirS * Lt * 0.6).addScaledVector(F.s, leg.side * Lt * 0.35).addScaledVector(F.u, -Lt * 0.35)
          : tuck;
        foot = stretch;
        fn = F.u.clone();
      } else {
        const sp = surfacePoint(fb2, f.at.s, f.at.th, footLift(c, i) * 0.9 + 1.5 + voxLift);
        foot = T3(sp.p);
        fn = T3(sp.n);
      }
      if (go > 0.01 && !flying) foot.lerp(spread, go);
      foot.add(jit(100 + i));
      footPos.push(foot.clone());
      const ankle = foot.clone().addScaledVector(fn, ankleH);
      const bend = F.f.clone().multiplyScalar(st.bend[0]).addScaledVector(F.u, st.bend[1]).addScaledVector(F.s, leg.side * st.bend[2]);
      const split = st.split ?? 0.5;
      const knee = ik(hip, ankle, Lt * split, Lt * (1 - split), bend);
      const th = st.th;
      const sc = k;
      limb(lp.segs[0], hip, knee, F.u, th[0] * sc);
      limb(lp.segs[1], knee, ankle, F.u, th[1] * sc);
      if (lp.segs[2]) limb(lp.segs[2], ankle, foot, F.u, (th[2] ?? th[1] * 0.7) * sc);
      lp.joints.forEach((j, q) => {
        const jp = q === 0 ? knee : ankle;
        j.position.copy(jp);
        const r = Math.max(0.3, (q === 0 ? th[0] : th[1]) * sc * 1.12);
        j.scale.set(r, r, r);
        j.quaternion.identity();
      });
      if (lp.paw && st.paw) {
        // feet point along the heading, flat on the surface
        const fw = F.f.clone().addScaledVector(fn, -F.f.dot(fn)).normalize();
        const pf = orthoFrame(foot.clone(), fw, fn, 0);
        const ps = st.paw.size;
        lp.paw.position.copy(foot).addScaledVector(pf.u, ps[1] * 0.35 * k).addScaledVector(pf.f, ps[2] * 0.2 * k);
        orient(lp.paw, pf, 0, 0, 0, q0);
        lp.paw.scale.set(ps[0] * k, ps[1] * k, ps[2] * k);
        const tz = st.paw.toes;
        lp.toes.forEach((toe, q) => {
          const nT = lp.toes.length;
          const ang = (q - (nT - 1) / 2) * (tz?.spread ?? 0.4);
          toe.position.copy(foot).addScaledVector(pf.f, ps[2] * 0.45 * k).addScaledVector(pf.u, ps[1] * 0.22 * k).addScaledVector(pf.s, Math.sin(ang) * ps[0] * 0.25 * k);
          orient(toe, pf, -0.12, ang, 0, q0);
          toe.scale.set((tz?.th ?? 1) * k, (tz?.th ?? 1) * k, (tz?.len ?? 3) * k);
        });
      }
    });

    // ---- glide membranes between front and hind legs
    if (this.membranes.length) {
      this.membranes.forEach((mm, qi) => {
        const sg = qi === 0 ? 1 : -1;
        mm.visible = go > 0.03;
        if (!mm.visible) return;
        const front = a.legs.findIndex((l) => l.side === sg);
        const hind = a.legs.map((l, i) => ({ l, i })).filter((x) => x.l.side === sg).pop()!.i;
        const wrist = footPos[front], ankle = footPos[hind];
        const sh = frame(a.nodes[a.legs[front].node].d), hp = frame(a.nodes[a.legs[hind].node].d);
        const sPt = sh.p.clone().addScaledVector(sh.s, sg * sh.w * 0.9);
        const hPt = hp.p.clone().addScaledVector(hp.s, sg * hp.w * 0.9);
        const arr = (mm.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
        const v = [sPt, wrist, ankle, sPt, ankle, hPt];
        v.forEach((p, q) => { arr[q * 3] = p.x; arr[q * 3 + 1] = p.y; arr[q * 3 + 2] = p.z; });
        (mm.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      });
    }

    // ---- wings
    const w = m.wings;
    if (w && this.wingParts.length) {
      const sw = a.wings;
      const target = flying ? 1 : 0;
      this.wingOpen += (target - this.wingOpen) * Math.min(1, dt * 10);
      const hz = flying && sw ? sw.flapHz * (sw.flapHz > 20 ? 0.45 : 1) : 0; // fast insect wings are slowed to something the frame rate can show
      const eff = flying ? (a.flight?.kind === "wing" ? 0.04 + 0.96 * c.flight!.flap : 1) : 0;
      this.wingPhase += dt * Math.PI * 2 * hz * (a.flight?.kind === "wing" ? 0.45 + 0.55 * eff : 1);
      const shoulder = frame(w.d * k);
      const pitchB = fb ? Math.asin(Math.max(-1, Math.min(1, fb.fwd.y))) : 0;
      for (const wp of this.wingParts) {
        const sg = wp.sgn;
        const baseQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(shoulder.s, shoulder.u, shoulder.f));
        const base = shoulder.p.clone().addScaledVector(shoulder.f, w.at[0] * k).addScaledVector(shoulder.u, w.at[1] * k).addScaledVector(shoulder.s, w.at[2] * sg * k);
        // the panels chained from the shoulder at a flap phase; the ghost copy trails by 0.8 rad (a motion-blur smear on fast insect wings)
        const lay = (meshes: THREE.Mesh[], phase: number, show: boolean): void => {
          let pos = base.clone();
          let q = baseQ.clone();
          meshes.forEach((mesh, pi) => {
            const panel = w.panels[pi];
            const [roll, yaw, pitch] = w.pose({ phase: phase + (wp.pair ? Math.PI : 0), amp: eff, open: this.wingOpen, pair: wp.pair, pitch: pitchB }, pi);
            const ql = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), yaw * sg)
              .multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), roll * sg))
              .multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -pitch));
            q = q.multiply(ql);
            mesh.position.copy(pos);
            mesh.quaternion.copy(q);
            const len = panel.len * k * (wp.pair ? 0.9 : 1);
            mesh.scale.set(len, 1, panel.chord * k * (wp.pair ? 0.9 : 1));
            pos = pos.clone().add(V3(sg * len, 0, 0).applyQuaternion(q));
            mesh.visible = show && (this.wingOpen > 0.02 || w.foldedVisible !== false);
          });
        };
        lay(wp.panels, this.wingPhase, true);
        if (wp.ghost) lay(wp.ghost, this.wingPhase - 0.8, flying);
      }
    }
  }
}

type V3t = [number, number, number];

/** Orient `mesh` in the frame `F`, then the local rotation: pitch (nose up +) about the side axis first, then roll about forward (a lean), then yaw about up. */
function orient(mesh: THREE.Mesh, F: Frame, pitch: number, yaw: number, roll: number, tmp: THREE.Quaternion): void {
  const basis = new THREE.Matrix4().makeBasis(F.s, F.u, F.f);
  mesh.quaternion.setFromRotationMatrix(basis);
  if (pitch || yaw || roll) {
    tmp.setFromAxisAngle(V3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), roll)).multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -pitch));
    mesh.quaternion.multiply(tmp);
  }
}

/** Place a base-anchored part (cone / prism: z 0..1) from `p` along `dir`, `up` = a hint for the roll. */
function setPart(mesh: THREE.Mesh, p: V, dir: V, up: V, w: number, h: number, l: number): void {
  const z = dir.clone().normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z));
  if (y.lengthSq() < 1e-8) y.set(0, 1, 0).addScaledVector(z, -z.y);
  if (y.lengthSq() < 1e-8) y.set(1, 0, 0);
  y.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  mesh.position.copy(p);
  mesh.scale.set(Math.max(0.2, w), Math.max(0.2, h), Math.max(0.2, l));
}

function limb(mesh: THREE.Mesh, a: V, b: V, up: V, th: number): void {
  const d = b.clone().sub(a);
  const l = d.length();
  mesh.visible = l > 1e-3;
  setPart(mesh, a, d.normalize(), up, th, th, l);
}

/** Two-bone IK: the knee that keeps both segments their length, bending towards `bend`; stretches straight when out of reach. */
function ik(hip: V, foot: V, l1: number, l2: number, bend: V): V {
  const d = foot.clone().sub(hip);
  const dist = Math.max(1e-4, d.length());
  const dir = d.clone().divideScalar(dist);
  if (dist >= l1 + l2 - 1e-3) return hip.clone().addScaledVector(dir, (dist * l1) / (l1 + l2));
  const a = Math.max(-l1, Math.min(l1, (dist * dist + l1 * l1 - l2 * l2) / (2 * dist)));
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = bend.clone().addScaledVector(dir, -bend.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 1, 0).addScaledVector(dir, -dir.y);
  perp.normalize();
  return hip.clone().addScaledVector(dir, a).addScaledVector(perp, h);
}
