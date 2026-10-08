/**
 * lib/trilium/types.ts — wire shapes of Trilium's ETAPI.
 *
 * Transcribed from the official OpenAPI specification
 * (apps/server/src/assets/etapi.openapi.yaml, TriliumNext/Trilium @ v0.106.0)
 * and cross-checked against the running instance in tools/etapi-probe.sh.
 * Only the fields this app consumes are declared; `Partial` fields the API
 * returns but we ignore are omitted on purpose (add them when needed, with
 * the spec as the source of truth).
 *
 * Everything here is transport detail. Import from ../types instead if you
 * want the app's own model.
 */

/** ETAPI entity ids are 4–32 chars of [a-zA-Z0-9_]. */
export type EntityId = string;

/** GET /etapi/app-info */
export interface AppInfo {
  appVersion: string;
  dbVersion: string;
  /** Newer builds add more fields (sync/version names); we ignore them. */
  [key: string]: unknown;
}

/** GET /etapi/notes?search=... → one element of SearchResponse.results */
export interface EtapiNote {
  noteId: EntityId;
  title: string;
  type: string;
  mime: string;
  /** In search results, attribute list is present; may be absent in other calls. */
  attributes?: EtapiAttribute[];
  /** Trilium reports tree structure as id lists, not nested objects. */
  childNoteIds?: EntityId[];
  parentNoteIds?: EntityId[];
  parentBranchIds?: EntityId[];
  childBranchIds?: EntityId[];
  isProtected?: boolean;
  [key: string]: unknown;
}

/** Attribute = label (key/value) or relation (note reference). */
export interface EtapiAttribute {
  attributeId: EntityId;
  noteId: EntityId;
  type: "label" | "relation";
  /** Lowercased by Trilium. Matches ^\S+ (no whitespace). */
  name: string;
  /** "" for valueless labels. */
  value: string;
  position?: number;
  isInheritable?: boolean;
}

/** POST /etapi/attributes body (creating a label). */
export interface CreateAttributeDef {
  noteId: EntityId;
  type: "label" | "relation";
  name: string;
  value?: string;
}

/**
 * POST /etapi/create-note body. `content` for a text note must be HTML
 * (Trilium's text notes are HTML, not markdown).
 */
export interface CreateNoteDef {
  parentNoteId: EntityId;
  title: string;
  type: "text" | "code" | "file" | "image" | "search" | "book" | "relationMap" | "render";
  content: string;
  notePosition?: number;
  prefix?: string;
  isExpanded?: boolean;
}

/** POST /etapi/create-note response. */
export interface NoteWithBranch {
  note: EtapiNote;
  branch: EtapiBranch;
}

/** GET/PATCH /etapi/branches/{branchId}. We only read them. */
export interface EtapiBranch {
  branchId: EntityId;
  noteId: EntityId;
  parentNoteId: EntityId;
  notePosition: number;
  prefix?: string;
  isExpanded?: boolean;
}

/** POST /etapi/auth/login response (201). */
export interface AuthResponse {
  /** Opaque token; send it in the Authorization header. */
  authToken: string;
}

/** GET /etapi/notes?search=... response. */
export interface SearchResponse {
  results: EtapiNote[];
  debugInfo?: unknown;
}

/** ETAPI error body: {code, message}. 401 code is NOT_AUTHENTICATED. */
export interface EtapiError {
  code: string;
  message: string;
}