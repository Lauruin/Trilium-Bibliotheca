/**
 * lib/media.ts — what a binary note (type `image` / `file`) really contains, and how the reader shows it.
 *
 * Why: ETAPI serves the raw bytes of image and file notes at `GET /notes/{id}/content`; reading them as text
 * (the old behaviour) corrupts them. A note's mime can also be empty or wrong (hand-made notes), so the
 * decision is made from the BYTES (magic numbers), never from the server's mime alone. Pure and
 * browser-independent (Uint8Array in, plain data out), so it is unit-tested in Node.
 */

/** Note types whose content is bytes, not text. */
export function isBinaryNoteType(type: string): boolean {
  return type === "image" || type === "file";
}

export type MediaKind = "image" | "svg" | "pdf" | "text" | "binary";

export interface Sniffed {
  kind: MediaKind;
  /** The mime we derived from the bytes ("" for plain binary). Used for the blob we create, not the server's. */
  mime: string;
}

/** How the reader shows a binary note. */
export type MediaPlan = "image" | "pdf" | "text" | "download";

/** Largest binary we show inline (images, PDFs); bigger ones get a download card. */
export const MAX_VIEW_BYTES = 40 * 1024 * 1024;
/** Largest text file shown as text; the rest is cut with a notice. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number): string => {
  let s = "";
  for (let i = from; i < Math.min(to, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
};

/** Recognise a file from its first bytes. Never throws; an empty input is "binary". */
export function sniffBytes(b: Uint8Array): Sniffed {
  if (b.length >= 8 && startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mime: "image/png" };
  if (b.length >= 3 && startsWith(b, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg" };
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return { kind: "image", mime: "image/gif" };
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { kind: "image", mime: "image/webp" };
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && /^(avif|avis)$/.test(ascii(b, 8, 12))) return { kind: "image", mime: "image/avif" };
  // BMP: "BM", four reserved zero bytes at offset 6, then a known DIB header size at offset 14 (so text starting "BM..." is not a bitmap)
  if (b.length >= 18 && ascii(b, 0, 2) === "BM" && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0 && [12, 40, 52, 56, 64, 108, 124].includes(b[14]) && b[15] === 0 && b[16] === 0 && b[17] === 0) {
    return { kind: "image", mime: "image/bmp" };
  }
  // PDF: the header at the very start (a UTF-8 BOM or a few blank bytes before it are tolerated), never "somewhere in the text"
  if (/^(\u00ef\u00bb\u00bf)?[\s\0]{0,8}%PDF-/.test(ascii(b, 0, 16))) return { kind: "pdf", mime: "application/pdf" };

  // SVG is XML text: optional BOM / xml declaration / comments / doctype, then <svg
  const head = ascii(b, 0, 1024).replace(/^\u00ef\u00bb\u00bf/, "");
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype\s+svg[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>/]/i.test(head)) {
    return { kind: "svg", mime: "image/svg+xml" };
  }

  // plain text: no NUL bytes, almost no control characters, and valid UTF-8 (in the first 4 KiB; a multi-byte
  // character cut by the slice is tolerated). Legacy 8-bit encodings are not recognised: they get a download.
  const n = Math.min(b.length, 4096);
  if (n === 0) return { kind: "binary", mime: "" };
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const v = b[i];
    if (v === 0) return { kind: "binary", mime: "" };
    if (v < 9 || (v > 13 && v < 32 && v !== 27)) ctrl++;
  }
  if (ctrl / n >= 0.02) return { kind: "binary", mime: "" };
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, n), { stream: true });
  } catch {
    return { kind: "binary", mime: "" };
  }
  return { kind: "text", mime: "text/plain" };
}

/** Does the note's own mime say "this is text"? (used for `file` notes whose bytes look like text) */
export function mimeIsTextual(mime: string): boolean {
  return /^text\//i.test(mime) || /(json|xml|csv|yaml|javascript|x-sh|markdown)/i.test(mime);
}

/**
 * Decide how to show a binary note from its sniffed bytes, its note type and mime, and its size.
 * Images and PDFs are shown whatever the note type says (a `file` note holding a PNG is a picture);
 * text-looking `file` notes with a textual (or missing) mime are shown as text; the rest is offered for download.
 */
export function planMedia(type: string, mime: string, sniffed: Sniffed, size: number): MediaPlan {
  if (size > MAX_VIEW_BYTES && sniffed.kind !== "text") return "download";
  if (sniffed.kind === "image" || sniffed.kind === "svg") return "image";
  if (sniffed.kind === "pdf") return "pdf";
  if (sniffed.kind === "text" && (type === "file" || type === "image") && (mime === "" || mime === "application/octet-stream" || mimeIsTextual(mime))) {
    return "text";
  }
  return "download";
}

/** `1.4 MB`-style size. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif",
  "image/bmp": "bmp", "image/svg+xml": "svg", "application/pdf": "pdf", "text/plain": "txt",
};

/** A safe download name from a note title: no path separators or control characters, an extension when the type is known. */
export function downloadName(title: string, mime: string): string {
  // eslint-disable-next-line no-control-regex
  let name = (title || "note").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "note";
  const ext = EXT_BY_MIME[mime];
  if (ext && !new RegExp(`\\.${ext}$`, "i").test(name)) name += `.${ext}`;
  return name;
}

/** Decode up to `max` bytes of UTF-8 text; says whether it was cut. Invalid sequences become U+FFFD, never an error. */
export function decodeText(b: Uint8Array, max = MAX_TEXT_BYTES): { text: string; truncated: boolean } {
  const cut = b.length > max;
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(cut ? b.subarray(0, max) : b), truncated: cut };
}
