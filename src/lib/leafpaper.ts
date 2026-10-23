/**
 * lib/leafpaper.ts — the reader's "leaf" papers: a page that looks like a leaf.
 *
 * Pure and deterministic (no randomness, no DOM): `leafDecor(variant, width)` returns the extra CSS and the two
 * wrapper fragments the reader puts around `.page`. The text area stays an ordinary rectangle, so reading is
 * unaffected; what changes is everything around and under it:
 *   - a vein overlay (midrib + curved side veins, an SVG tile repeated down the page) at very low opacity,
 *   - a fine speckle texture (feTurbulence noise) at very low opacity,
 *   - serrated left/right edges (a CSS mask built from two small SVG strips) and a rounded, tapering bottom,
 *   - a short stem (petiole) above the top edge,
 *   - a soft drop shadow on the wrapper (outside the mask, so the shadow follows the leaf shape).
 * Contrast is guarded in unit tests: the overlays never exceed LEAF_OVERLAY_MAX_OPACITY, and the paper's
 * ink / link colours are measured against every stop of the base gradient (the overlay only darkens a little).
 */

export type LeafVariant = "spring" | "autumn" | "maple";

/** No decorative layer under the text may be more opaque than this (keeps ink/page contrast intact). */
export const LEAF_OVERLAY_MAX_OPACITY = 0.14;

interface Tone {
  /** vein / speckle colour (rgb 0..255) */
  vein: [number, number, number];
  stem: string;
  /** inside-the-edge darkening */
  inset: string;
  /** serration depth (px) and period (px): maple has deeper, wider teeth */
  tooth: { depth: number; period: number };
  /** x (0..50, in a 100-wide cap) of the first control point of the tip curve: smaller = rounder, larger = more pointed */
  tip: number;
}

const TONES: Record<LeafVariant, Tone> = {
  spring: { vein: [58, 96, 32], stem: "#3f6a28", inset: "rgba(60,95,30,.30)", tooth: { depth: 7, period: 30 }, tip: 36 },
  autumn: { vein: [120, 78, 24], stem: "#7a5a22", inset: "rgba(130,85,20,.30)", tooth: { depth: 6, period: 34 }, tip: 22 },
  maple: { vein: [128, 40, 22], stem: "#7a3a22", inset: "rgba(140,50,25,.30)", tooth: { depth: 12, period: 46 }, tip: 44 },
};

/** Tiny integer hash -> 0..1 (deterministic jitter for the veins). */
function h01(i: number): number {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

const rgb = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const dataUrl = (svg: string): string => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

/** The vein tile: 720 x 960, midrib down the middle, side veins curving up and out, no vein touches the tile's top or bottom edge. */
export function veinsSvg(v: LeafVariant): string {
  const t = TONES[v];
  const col = rgb(t.vein);
  const paths: string[] = [];
  paths.push(`<path d="M360,40 L360,920" stroke="${col}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`);
  let k = 0;
  for (let y = 130; y <= 880; y += 62) {
    for (const side of [-1, 1]) {
      const j = h01(k++) * 14 - 7;
      const len = 250 + h01(k++) * 70;
      const x1 = 360 + side * len;
      const y1 = y - 92 + j;
      const cx1 = 360 + side * 70;
      const cy1 = y - 6;
      const cx2 = 360 + side * (len * 0.62);
      const cy2 = y - 38 + j;
      paths.push(`<path d="M360,${y} C${cx1},${cy1} ${cx2},${cy2} ${x1},${y1}" stroke="${col}" stroke-width="1.9" fill="none" stroke-linecap="round"/>`);
      // two small branches off each side vein
      for (const f of [0.38, 0.68]) {
        const bx = 360 + side * len * f;
        const by = y - 92 * f * 0.92 + j * f;
        const ex = bx + side * 58;
        const ey = by - 44 - h01(k++) * 14;
        paths.push(`<path d="M${bx},${by} Q${bx + side * 30},${by - 6} ${ex},${ey}" stroke="${col}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960"><g opacity="0.12">${paths.join("")}</g></svg>`;
}

/** A 200 x 200 speckle tile (fractal noise tinted with the vein colour). */
export function speckleSvg(v: LeafVariant): string {
  const [r, g, b] = TONES[v].vein.map((c) => (c / 255).toFixed(3));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="n" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 0.9 -0.18"/></filter>` +
    `<rect width="200" height="200" filter="url(#n)" opacity="0.11"/></svg>`
  );
}

/** The stem above the leaf: a short curved stalk (30 x 56). */
export function stemSvg(v: LeafVariant): string {
  const c = TONES[v].stem;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="56" viewBox="0 0 30 56">` +
    `<path d="M15,56 C15,40 11,26 18,4" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<path d="M15,56 C15,40 11,26 18,4" stroke="#fff" stroke-opacity=".18" stroke-width="1.6" fill="none" stroke-linecap="round" transform="translate(-1.2,0)"/></svg>`
  );
}

/** One edge strip of the serration mask: opaque where the page shows, sawtooth on the outer side. `left` strips mirror `right`. */
export function edgeStripSvg(v: LeafVariant, side: "left" | "right"): string {
  const { depth, period } = TONES[v].tooth;
  // a triangle whose tip reaches the outer edge: the visible part is everything between the notches
  const pts = side === "left" ? `${depth},0 ${depth},${period} 0,${period / 2}` : `0,0 0,${period} ${depth},${period / 2}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${depth}" height="${period}" viewBox="0 0 ${depth} ${period}"><polygon points="${pts}" fill="#000"/></svg>`;
}

/** Height (px) of the pointed cap at the top (under the stem) and at the bottom (the tip) of the leaf. */
export const CAP_TOP = 140;
export const CAP_BOTTOM = 170;

/**
 * The leaf's top or bottom cap: a pointed ogive filling the full width (stretched horizontally by the mask, so it fits any
 * page width) and a fixed height, so a short note gets an ovate leaf and a very long one a long leaf with the same tips.
 */
export function capSvg(v: LeafVariant, which: "top" | "bottom"): string {
  const k = TONES[v].tip;
  const H = which === "top" ? CAP_TOP : CAP_BOTTOM;
  const d =
    which === "top"
      ? `M0,${H} C0,${H * 0.43} ${k},${H * 0.16} 50,0 C${100 - k},${H * 0.16} 100,${H * 0.43} 100,${H} Z`
      : `M0,0 C0,${H * 0.5} ${k},${H * 0.84} 50,${H} C${100 - k},${H * 0.84} 100,${H * 0.5} 100,0 Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="${H}" viewBox="0 0 100 ${H}" preserveAspectRatio="none"><path d="${d}" fill="#000"/></svg>`;
}

export interface LeafDecor {
  /** Extra CSS for the iframe document (appended after the paper's own). */
  css: string;
  /** Markup placed before `.page` (opens the wrappers, adds the stem). */
  before: string;
  /** Markup placed after `.page` (closes the wrappers). */
  after: string;
}

/**
 * Everything the reader needs to draw a leaf page of the given variant and content width.
 * Structure: `.leaf-wrap` (drop shadow, after the masks) > `.leaf-stem` + `.leaf-teeth` (side serration mask, full height) > `.page`
 * (silhouette mask: top cap, solid middle, bottom cap). Nested masks intersect, so the teeth only show along the silhouette's sides.
 */
export function leafDecor(v: LeafVariant, width: number): LeafDecor {
  const t = TONES[v];
  const { depth, period } = t.tooth;
  const L = dataUrl(edgeStripSvg(v, "left"));
  const R = dataUrl(edgeStripSvg(v, "right"));
  const teethMask = `linear-gradient(#000 0 0), ${L}, ${R}`;
  const teethSize = `calc(100% - ${depth * 2}px) 100%, ${depth}px ${period}px, ${depth}px ${period}px`;
  const teethPos = `center, left top, right top`;
  const teethRep = `no-repeat, repeat-y, repeat-y`;
  const capMask = `${dataUrl(capSvg(v, "top"))}, linear-gradient(#000 0 0), ${dataUrl(capSvg(v, "bottom"))}`;
  const capSize = `100% ${CAP_TOP}px, 100% calc(100% - ${CAP_TOP + CAP_BOTTOM - 2}px), 100% ${CAP_BOTTOM}px`;
  const capPos = `left top, left ${CAP_TOP - 1}px, left bottom`;
  const capRep = `no-repeat, no-repeat, no-repeat`;
  const css = `
  .leaf-wrap { position: relative; max-width: ${width}px; margin: 0 auto; padding-top: 40px; filter: drop-shadow(0 7px 12px rgba(0,0,0,.5)); }
  .leaf-stem { position: absolute; top: 0; left: 50%; width: 30px; height: 56px; margin-left: -15px; background: ${dataUrl(stemSvg(v))} no-repeat center / contain; }
  .leaf-teeth {
    position: relative;
    -webkit-mask-image: ${teethMask}; mask-image: ${teethMask};
    -webkit-mask-size: ${teethSize}; mask-size: ${teethSize};
    -webkit-mask-position: ${teethPos}; mask-position: ${teethPos};
    -webkit-mask-repeat: ${teethRep}; mask-repeat: ${teethRep};
  }
  .leaf-wrap .page {
    position: relative; max-width: none; margin: 0; min-height: calc(100vh - 150px);
    padding: ${CAP_TOP - 20}px 64px ${CAP_BOTTOM - 10}px;
    background-image: ${dataUrl(veinsSvg(v))}, ${dataUrl(speckleSvg(v))}, var(--leaf-base);
    background-size: 100% 960px, 200px 200px, auto;
    background-repeat: repeat-y, repeat, no-repeat;
    box-shadow: inset 0 0 64px ${t.inset};
    -webkit-mask-image: ${capMask}; mask-image: ${capMask};
    -webkit-mask-size: ${capSize}; mask-size: ${capSize};
    -webkit-mask-position: ${capPos}; mask-position: ${capPos};
    -webkit-mask-repeat: ${capRep}; mask-repeat: ${capRep};
  }
  @media (max-width: 640px) { .leaf-wrap .page { padding-left: 34px; padding-right: 34px; } }`;
  return { css, before: `<div class="leaf-wrap"><div class="leaf-stem"></div><div class="leaf-teeth">`, after: `</div></div>` };
}
