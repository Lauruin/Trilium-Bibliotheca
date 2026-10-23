/**
 * lib/trilium/client.ts — the ONLY module in this app that speaks to Trilium.
 *
 * Portability discipline (architecture-scope.md): every ETAPI call is
 * isolated here so that a future port to another note backend touches one
 * file, not the whole codebase. Game scene, UI and library mapping must not
 * import `fetch` or know URL shapes — they talk to this client.
 *
 * Auth (verified against docs.triliumnotes.org → ETAPI, and against a live
 * v0.106.0 instance in tools/etapi-probe.sh):
 *   - The token goes in the `Authorization` header, bare or `Bearer`-prefixed.
 *   - A token is minted with POST /etapi/auth/login {password} → 201 {authToken}
 *     (endpoint needs no auth itself; a fresh instance has no token until the
 *     first-run password is set — see tools/trilium-bootstrap.sh).
 *   - Wrong/missing token → 401 {code: "NOT_AUTHENTICATED"} on all other
 *     endpoints. That is expected behaviour, not an endpoint bug.
 */

import type {
  AppInfo,
  AuthResponse,
  CreateAttributeDef,
  CreateNoteDef,
  EtapiAttachment,
  EtapiAttribute,
  EtapiError,
  EtapiNote,
  NoteWithBranch,
  SearchResponse,
} from "./types";

/** Normalised error so callers never parse HTTP bodies themselves. */
export class TriliumApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(`ETAPI ${status} ${code}: ${message}`);
    this.name = "TriliumApiError";
  }
  /** 401 with NOT_AUTHENTICATED — token missing or wrong. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
  /** Server unreachable at all (network layer, wrong URL, CORS). */
  get isUnreachable(): boolean {
    return this.status === 0;
  }
}

export interface TriliumClientOptions {
  /** Trilium base URL without /etapi, e.g. "http://localhost:8080". "" = this app's own origin (hosted mode: nginx proxies /etapi/). */
  baseUrl: string;
  /** ETAPI token. Omitted only for login() itself, and in hosted mode (the proxy injects it). */
  token?: string;
  /** Refuse every write up front (hosted mode with a read-only proxy). The proxy enforces it too; this just gives a clear error. */
  readOnly?: boolean;
}

export class TriliumClient {
  private opts: TriliumClientOptions;

  constructor(opts: TriliumClientOptions) {
    this.opts = opts;
  }

  /** Swap credentials after the user edits settings without recreating the client. */
  update(opts: Partial<TriliumClientOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  /** Base of all endpoint paths, e.g. "http://localhost:8080/etapi". */
  get etapiBase(): string {
    return `${this.opts.baseUrl.replace(/\/+$/, "")}/etapi`;
  }

  /**
   * Single low-level entry point. Adds the auth header, normalises every
   * failure mode (network, CORS, non-JSON body, ETAPI error envelope) into
   * TriliumApiError. Never throws anything else.
   */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchOk(path, init);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** fetch + auth header + error normalisation; resolves only for 2xx. */
  private async fetchOk(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (this.opts.token !== undefined) headers.set("Authorization", this.opts.token);
    if (init?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let res: Response;
    try {
      res = await fetch(`${this.etapiBase}${path}`, { ...init, headers });
    } catch {
      // fetch rejects on network/DNS/CORS failures — indistinguishable, so we
      // collapse them into status 0 ("unreachable").
      throw new TriliumApiError(0, "UNREACHABLE", `${this.etapiBase}${path}`);
    }

    if (!res.ok) {
      // ETAPI errors are JSON {code, message}; some (401 on probes) may be text.
      let code = "UNKNOWN";
      let message = res.statusText;
      try {
        const body = (await res.json()) as EtapiError;
        if (body?.code) {
          code = body.code;
          message = body.message ?? message;
        }
      } catch {
        /* keep statusText fallback */
      }
      throw new TriliumApiError(res.status, code, message);
    }
    return res;
  }

  // ------------------------------------------------------------------
  // Auth & meta
  // ------------------------------------------------------------------

  /** Probe the instance. Works with a valid token; 401 means "alive, needs token". */
  getAppInfo(): Promise<AppInfo> {
    return this.request<AppInfo>("/app-info");
  }

  /**
   * Mint a token with the instance password (the headless bootstrap path).
   * Note the 429 case: too many failed logins blacklists the client IP for a
   * while — bootstrap scripts must not hammer this endpoint.
   */
  async login(password: string): Promise<string> {
    const body = await this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    return body.authToken;
  }

  // ------------------------------------------------------------------
  // Notes & tree
  // ------------------------------------------------------------------

  /** One note with attribute list, parent/child id lists. */
  getNote(noteId: string): Promise<EtapiNote> {
    return this.request<EtapiNote>(`/notes/${encodeURIComponent(noteId)}`);
  }

  /**
   * Raw note content AS TEXT. For text notes this is HTML; for code notes the source;
   * for markdown notes the markdown source. Binary notes (image / file) must use
   * {@link getNoteBlob}: reading bytes as text corrupts them.
   */
  async getNoteContent(noteId: string): Promise<string> {
    const res = await this.fetchOk(`/notes/${encodeURIComponent(noteId)}/content`, {
      headers: { Accept: "*/*" },
    });
    return res.text();
  }

  /**
   * Raw note content as bytes (image and file notes). The Content-Type of the Blob is the
   * note's mime as the server reports it (verified: image notes answer `image/png` etc.); it can be
   * empty or wrong for hand-made notes, so callers sniff the bytes (lib/media.ts) before trusting it.
   */
  async getNoteBlob(noteId: string): Promise<Blob> {
    const res = await this.fetchOk(`/notes/${encodeURIComponent(noteId)}/content`, {
      headers: { Accept: "*/*" },
    });
    return res.blob();
  }

  /** Attachments of a note (a bare array; verified against v0.106.0). */
  getNoteAttachments(noteId: string): Promise<EtapiAttachment[]> {
    return this.request<EtapiAttachment[]>(`/notes/${encodeURIComponent(noteId)}/attachments`);
  }

  /**
   * Bytes of one attachment (`GET /attachments/{id}/content`; answers with the attachment's mime).
   * This is how pictures embedded in a text note (`<img src="api/attachments/ID/image/name.png">`,
   * which need Trilium's session cookie in the browser) are fetched with the ETAPI token instead.
   */
  async getAttachmentBlob(attachmentId: string): Promise<Blob> {
    const res = await this.fetchOk(`/attachments/${encodeURIComponent(attachmentId)}/content`, {
      headers: { Accept: "*/*" },
    });
    return res.blob();
  }

  /** Full-text search (Trilium's own search engine). Returns full notes. */
  searchNotes(query: string): Promise<SearchResponse> {
    return this.request<SearchResponse>(`/notes?search=${encodeURIComponent(query)}`);
  }

  /** Replace a note's content with text (text / code notes). ETAPI reads only `text/plain` (or octet-stream) on this endpoint. */
  async putNoteContent(noteId: string, content: string): Promise<void> {
    this.assertWritable();
    await this.fetchOk(`/notes/${encodeURIComponent(noteId)}/content`, { method: "PUT", body: content, headers: { "Content-Type": "text/plain", Accept: "*/*" } });
  }

  /** Throws when this client is read-only: called first by every write. */
  private assertWritable(): void {
    if (this.opts.readOnly) throw new TriliumApiError(403, "READ_ONLY", "This server is read-only: nothing can be changed from here.");
  }

  /** Create a note under a parent. Used by tests and future write features. */
  createNote(def: CreateNoteDef): Promise<NoteWithBranch> {
    this.assertWritable();
    return this.request<NoteWithBranch>("/create-note", {
      method: "POST",
      body: JSON.stringify(def),
    });
  }

  // ------------------------------------------------------------------
  // Attributes (labels) — how this app persists room layout
  // ------------------------------------------------------------------

  /** Create a label on a note. */
  createAttribute(def: CreateAttributeDef): Promise<EtapiAttribute> {
    this.assertWritable();
    return this.request<EtapiAttribute>("/attributes", {
      method: "POST",
      body: JSON.stringify(def),
    });
  }

  /** Update an existing attribute's value (its id comes from note.attributes). */
  patchAttribute(
    attributeId: string,
    patch: { value?: string; position?: number },
  ): Promise<EtapiAttribute> {
    this.assertWritable();
    return this.request<EtapiAttribute>(`/attributes/${encodeURIComponent(attributeId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  /** Delete an attribute by id. */
  deleteAttribute(attributeId: string): Promise<void> {
    this.assertWritable();
    return this.request<void>(`/attributes/${encodeURIComponent(attributeId)}`, {
      method: "DELETE",
    });
  }
}