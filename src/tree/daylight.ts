/**
 * tree/daylight.ts — the light of the day (PURE, unit-tested in tools/unit-daylight.mjs): where the sun and the moon are and what the sky,
 * the lights, the fog and the stars look like at a given time. The scene (TreeScene) feeds the result to its lights, its sky (sky.ts) and
 * its shadows every few frames.
 *
 * The sun follows the real astronomy for a fixed latitude (50 degrees north, a convincing middle of the road): solar declination from the
 * day of the year, hour angle from the clock hour (12:00 = the sun due south and highest). So summer days are long and winter days short,
 * dusk and dawn are slow, and the sun is low and red near the horizon. Everything else is a function of the sun's ELEVATION, with smooth
 * ramps (no step anywhere: a day is a continuous film). At night the cool moon is the rim light (no shadows: cheaper),
 * the stars come out, and `nightFloor` (0..1, a setting) keeps the scene readable.
 *
 * World axes: y up, +x east, -z north (so +z is south: at noon the sun is in the +z direction).
 */

import type { V3 } from "./world3";

export type RGB = readonly [number, number, number];

export interface Daylight {
  /** The hour this was computed for (0..24). */
  hours: number;
  /** Sun elevation above the horizon, radians (negative at night), and the unit vector TOWARDS the sun / the moon. */
  sunElev: number;
  sunDir: V3;
  moonDir: V3;
  /** 0 = night .. 1 = day (smooth). */
  dayK: number;
  /** The directional light = the sun: direction towards it, colour (sRGB 0..1), intensity (0 once it has set). */
  lightDir: V3;
  lightColor: RGB;
  lightIntensity: number;
  /** Hemisphere (sky / ground colours), ambient fill and the weak opposite "rim" light. */
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  fillColor: RGB;
  fillIntensity: number;
  rimColor: RGB;
  rimIntensity: number;
  /** Where the rim light comes from (towards it): opposite the sun by day, the moon at night. */
  rimDir: V3;
  /** Sky dome: colours at the zenith / the horizon, the glow round the sun (colour, strength 0..1). */
  skyZenith: RGB;
  skyHorizon: RGB;
  glowColor: RGB;
  glowStrength: number;
  /** Fog (same colour as the horizon) and its range. */
  fogColor: RGB;
  fogNear: number;
  fogFar: number;
  /** Star brightness 0..1; the moon's visibility 0..1; the sun disc's 0..1. */
  stars: number;
  moon: number;
  sunDisc: number;
  /** Multiplies the clouds' colour (white by day, orange at dusk, dark blue at night). */
  cloudTint: RGB;
  /** 1 = full sun shadows, 0 = none (the shadow pass is skipped below ~0.03). */
  shadowStrength: number;
  /** 0 by day .. 1 in the dark: how much the wisp's lantern light is on. */
  wispLight: number;
}

const DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Piecewise-linear ramp over the sun's elevation in degrees: `stops` = [elevation, value] ascending. */
function ramp<T extends RGB | number>(e: number, stops: ReadonlyArray<readonly [number, T]>): T {
  if (e <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [e1, v1] = stops[i];
    if (e <= e1) {
      const [e0, v0] = stops[i - 1];
      const t = (e - e0) / (e1 - e0 || 1);
      return (typeof v0 === "number" ? mix(v0, v1 as number, t) : mix3(v0 as RGB, v1 as RGB, t)) as T;
    }
  }
  return stops[stops.length - 1][1];
}

/** Local latitude used for the sun (degrees north). */
export const LATITUDE = 50;

/** The sun's elevation (radians) and azimuth (radians from north, clockwise) at `hours` (0..24) on `dayOfYear` (0..365). */
export function sunAngles(hours: number, dayOfYear: number): { elev: number; az: number } {
  const dec = 23.44 * DEG * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 80));
  const lat = LATITUDE * DEG;
  const H = (hours - 12) * 15 * DEG; // hour angle: 0 at noon, negative in the morning
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const elev = Math.asin(clamp(sinEl, -1, 1));
  // azimuth from north, clockwise (east = 90 degrees)
  const y = -Math.sin(H) * Math.cos(dec);
  const x = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  return { elev, az: Math.atan2(y, x) };
}

/** Sunrise and sunset hours (elevation crosses 0) on a day, or null at a polar day / night (never at 50 degrees, but the maths is guarded). */
export function sunTimes(dayOfYear: number): { rise: number; set: number } | null {
  const dec = 23.44 * DEG * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 80));
  const c = -Math.tan(LATITUDE * DEG) * Math.tan(dec);
  if (!(c > -1 && c < 1)) return null;
  const h = Math.acos(c) / (15 * DEG); // half day length, hours
  return { rise: 12 - h, set: 12 + h };
}

const toDir = (elev: number, az: number): V3 => ({ x: Math.cos(elev) * Math.sin(az), y: Math.sin(elev), z: -Math.cos(elev) * Math.cos(az) });

export const NIGHT_FLOOR_DEFAULT = 0.5;

/**
 * Everything the scene needs at `hours` on `dayOfYear`. `nightFloor` (0..1) lifts the hemisphere / fill light at night (0 = properly dark,
 * 1 = bright moonlit). Never throws; NaN / out-of-range inputs are repaired.
 */
export function daylight(hours: number, dayOfYear = 172, nightFloor = NIGHT_FLOOR_DEFAULT): Daylight {
  const h = Number.isFinite(hours) ? ((hours % 24) + 24) % 24 : 12;
  const doy = Number.isFinite(dayOfYear) ? clamp(dayOfYear, 0, 366) : 172;
  const floor = Number.isFinite(nightFloor) ? clamp(nightFloor, 0, 1) : NIGHT_FLOOR_DEFAULT;
  const { elev, az } = sunAngles(h, doy);
  const e = elev / DEG; // degrees
  const sunDir = toDir(elev, az);
  // the moon: roughly opposite the sun (a full moon every night), a little to the side so it is not exactly behind the sun's path
  const moonDir = norm({ x: -sunDir.x * 0.95 + 0.12, y: -sunDir.y * 0.9 + 0.05, z: -sunDir.z * 0.95 });

  const dayK = smooth(-8, 6, e);
  const nightK = 1 - dayK;

  // ---- the directional light is the SUN (its intensity runs out as it sets); the MOON is the cool "rim" light from the other side (below) ----
  const sunI = 3.1 * smooth(-3, 10, e);
  const warm = 1 - smooth(0, 28, e); // low sun = warm light
  const lightColor = mix3([1, 0.95, 0.84], [1, 0.55, 0.3], warm);
  const lightIntensity = sunI;
  const lightDir = sunDir;

  // ---- hemisphere, fill, rim ----
  const hemiSky = ramp<RGB>(e, [[-18, [0.4, 0.5, 0.9]], [-6, [0.46, 0.52, 0.78]], [0, [1, 0.72, 0.58]], [12, [0.85, 0.89, 1]], [30, [0.81, 0.89, 1]]]);
  const hemiGround = ramp<RGB>(e, [[-18, [0.2, 0.24, 0.32]], [-4, [0.26, 0.26, 0.3]], [6, [0.42, 0.33, 0.24]], [30, [0.47, 0.44, 0.31]]]);
  const nightHemi = 0.4 + 0.9 * floor;
  const hemiIntensity = mix(nightHemi, 1.05, dayK);
  const fillColor = mix3([0.55, 0.62, 0.9], [0.68, 0.73, 0.85], dayK);
  const fillIntensity = mix(0.25 + 0.4 * floor, 0.42, dayK);
  const rimColor = mix3([0.62, 0.71, 1], [0.62, 0.72, 1], dayK);
  const rimIntensity = mix(0.6, 0.55, dayK); // by day the weak cool fill from the shaded side, at night the moon
  // by day: from the side opposite the sun and low; at night: from the moon (the two are nearly the same side, so the hand-over is smooth)
  const opp = norm({ x: -sunDir.x, y: 0.26, z: -sunDir.z });
  const rimDir = norm({ x: mix(moonDir.x, opp.x, dayK), y: mix(moonDir.y, opp.y, dayK), z: mix(moonDir.z, opp.z, dayK) });

  // ---- sky ----
  const skyZenith = ramp<RGB>(e, [[-18, [0.012, 0.02, 0.07]], [-8, [0.05, 0.08, 0.2]], [-1, [0.2, 0.28, 0.5]], [8, [0.24, 0.4, 0.68]], [30, [0.24, 0.45, 0.72]]]);
  const skyHorizon = ramp<RGB>(e, [[-18, [0.04, 0.06, 0.14]], [-8, [0.16, 0.16, 0.3]], [-2, [0.78, 0.42, 0.34]], [4, [0.96, 0.66, 0.46]], [14, [0.84, 0.82, 0.8]], [32, [0.76, 0.85, 0.91]]]);
  const glowStrength = smooth(-10, -1, e) * (1 - smooth(20, 45, e)) * 0.9 + 0.35 * smooth(10, 40, e) * (1 - smooth(40, 70, e)) + 0.12;
  const glowColor = mix3([1, 0.5, 0.3], [1, 0.86, 0.62], smooth(0, 25, e));
  const fogNear = mix(1400, 2200, dayK);
  const fogFar = mix(9500, 13500, dayK);

  // ---- things that come and go ----
  const stars = smooth(-5, -15, e);
  const moonElev = Math.asin(clamp(moonDir.y, -1, 1)) / DEG;
  const moon = nightK * smooth(-3, 6, moonElev);
  const sunDisc = smooth(-5, 5, e);
  const cloudTint = ramp<RGB>(e, [[-14, [0.1, 0.13, 0.24]], [-4, [0.36, 0.34, 0.46]], [3, [1, 0.74, 0.58]], [14, [1, 0.94, 0.88]], [30, [1, 1, 1]]]);
  const shadowStrength = smooth(3, 13, e);
  const wispLight = smooth(8, -4, e);

  return {
    hours: h, sunElev: elev, sunDir, moonDir, dayK, lightDir, lightColor, lightIntensity,
    hemiSky, hemiGround, hemiIntensity, fillColor, fillIntensity, rimColor, rimIntensity, rimDir,
    skyZenith, skyHorizon, glowColor, glowStrength: clamp(glowStrength, 0, 1), fogColor: skyHorizon, fogNear, fogFar,
    stars, moon, sunDisc, cloudTint, shadowStrength, wispLight,
  };
}
