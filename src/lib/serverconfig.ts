/**
 * lib/serverconfig.ts — what the HOST of this app configured (hosted mode).
 *
 * The container's entrypoint (docker/30-biblio-config.sh) renders `/config.json` from compose environment variables. When the
 * host defines a Trilium server, nginx proxies `/etapi/` to it and injects the ETAPI token SERVER-SIDE (the token never reaches
 * the browser, so there is nothing to steal from localStorage and no CORS to configure); the app then talks to its own origin
 * with no token. The user-entered URL + token mode ("independent") stays available next to it.
 *
 * `/config.json` never contains a secret: only the server's display name, the library root, whether it is read-only, an optional
 * public URL (for "open in Trilium" links) and the AI provider + model name. Everything here is defensive: a missing file (the
 * vite dev server answers with index.html), garbage, or a wrong shape all mean "no host configuration".
 */

import type { Settings } from "../types";

export interface HostServer {
  /** Shown in the settings dialog. */
  name: string;
  rootNoteId: string;
  /** The proxy refuses everything but GET / HEAD / OPTIONS: the app disables its writes up front. */
  readOnly: boolean;
  /** Trilium's own web address (the proxy hides the real one), used for "open in Trilium" links; "" = none. */
  publicUrl: string;
}

export type AiProvider = "anthropic" | "openai-compatible";
export const AI_PROVIDERS: readonly AiProvider[] = ["anthropic", "openai-compatible"];

export interface HostAi {
  provider: AiProvider;
  model: string;
}

export interface ServerConfig {
  server: HostServer | null;
  ai: HostAi | null;
}

export const NO_HOST_CONFIG: ServerConfig = { server: null, ai: null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, d = ""): string => (typeof v === "string" ? v.trim().slice(0, max) : d);

/** Trilium note ids are 4-32 chars of [A-Za-z0-9_]; Trilium's root is the literal "root". */
const NOTE_ID = /^(root|[A-Za-z0-9_]{4,32})$/;

/** Coerce arbitrary JSON into a ServerConfig. Never throws. */
export function parseServerConfig(v: unknown): ServerConfig {
  if (!isObj(v)) return NO_HOST_CONFIG;
  let server: HostServer | null = null;
  if (isObj(v.server)) {
    const root = str(v.server.rootNoteId, 32, "root");
    const pub = str(v.server.publicUrl, 300);
    server = {
      name: str(v.server.name, 60, "Trilium") || "Trilium",
      rootNoteId: NOTE_ID.test(root) ? root : "root",
      readOnly: v.server.readOnly === true,
      publicUrl: /^https?:\/\/[^\s]+$/i.test(pub) ? pub.replace(/\/+$/, "") : "",
    };
  }
  let ai: HostAi | null = null;
  if (isObj(v.ai) && typeof v.ai.provider === "string" && (AI_PROVIDERS as readonly string[]).includes(v.ai.provider)) {
    const model = str(v.ai.model, 100);
    if (model) ai = { provider: v.ai.provider as AiProvider, model };
  }
  return { server, ai };
}

/**
 * Fetch `/config.json` from our own origin. Anything that is not a JSON answer (404, index.html from a dev server, a network error)
 * is "no host configuration".
 */
export async function fetchServerConfig(fetchFn: typeof fetch = fetch): Promise<ServerConfig> {
  try {
    const res = await fetchFn("/config.json", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) return NO_HOST_CONFIG;
    return parseServerConfig(await res.json());
  } catch {
    return NO_HOST_CONFIG;
  }
}

/**
 * Which connection to use at boot. The host's server wins when there is one and the user has not chosen their own; a stored
 * user-defined connection ("independent" mode) always stays in force. A stored proxy marker whose server is gone from the host
 * config is dropped (the user must connect somewhere).
 */
export function chooseSettings(stored: Settings | null, host: ServerConfig): Settings | null {
  if (stored && !stored.proxy) return stored; // the user's own server
  if (host.server) return { serverUrl: "", token: "", rootNoteId: host.server.rootNoteId, proxy: true };
  return null; // (a stale proxy marker without a host server)
}
