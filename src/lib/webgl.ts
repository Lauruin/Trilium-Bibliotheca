/**
 * lib/webgl.ts — is WebGL usable here? (the tree view, now the default start view, needs it; the library does not)
 *
 * Checked once by creating a throwaway canvas context. Headless / CI browsers without a GPU and some weak devices say no, and the app
 * then starts in the library with a toast instead of a dead 3D view.
 */

let cached: boolean | undefined;

export function webglAvailable(): boolean {
  if (cached !== undefined) return cached;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    cached = !!gl;
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext(); // do not keep a context alive for the probe
  } catch {
    cached = false;
  }
  return cached;
}

export type ViewName = "library" | "tree";

/**
 * Which view the app starts in: `?view=library|tree` wins (used by the tests and for debugging); otherwise the tree, or the
 * library when WebGL is missing. `fellBack` says the tree was wanted but impossible (the caller shows a toast).
 */
export function chooseStartView(search: string, hasWebgl: boolean): { view: ViewName; fellBack: boolean } {
  const asked = new URLSearchParams(search).get("view");
  if (asked === "library") return { view: "library", fellBack: false };
  if (!hasWebgl) return { view: "library", fellBack: true };
  return { view: "tree", fellBack: false };
}
