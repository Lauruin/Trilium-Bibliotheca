// Unit checks for the reader/media work: lib/media.ts (what a binary note really is, how it is shown), lib/embeds.ts (pictures embedded in
// text notes), lib/notepath.ts (breadcrumb / siblings / Trilium URL), and the new parts of lib/reader.ts + lib/leafpaper.ts (document builder,
// scroll memory, the three leaf papers). Run through tools/unit-test.mjs (it imports every tools/unit-*.mjs).
export default async ({ bundle, assert }) => {
  const M = await bundle("src/lib/media.ts", "media-unit.mjs");
  const E = await bundle("src/lib/embeds.ts", "embeds-unit.mjs");
  const P = await bundle("src/lib/notepath.ts", "notepath-unit.mjs");
  const R = await bundle("src/lib/reader.ts", "reader-unit2.mjs");
  const L = await bundle("src/lib/leafpaper.ts", "leafpaper-unit.mjs");

  const bytes = (...a) => Uint8Array.from(a);
  const ascii = (s) => Uint8Array.from(Buffer.from(s, "latin1"));
  const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

  // 1. sniffing: from the bytes, never from a mime
  assert.deepEqual(M.sniffBytes(PNG), { kind: "image", mime: "image/png" });
  assert.equal(M.sniffBytes(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16)).mime, "image/jpeg");
  assert.equal(M.sniffBytes(ascii("GIF89a\x01\x00")).mime, "image/gif");
  assert.equal(M.sniffBytes(ascii("GIF87a\x01\x00")).mime, "image/gif");
  assert.equal(M.sniffBytes(ascii("RIFF\x10\x00\x00\x00WEBPVP8 ")).mime, "image/webp");
  assert.equal(M.sniffBytes(ascii("RIFF\x10\x00\x00\x00WAVEfmt ")).kind, "binary", "RIFF that is not WEBP");
  assert.equal(M.sniffBytes(ascii("\x00\x00\x00\x1cftypavif\x00\x00\x00\x00")).mime, "image/avif");
  assert.equal(M.sniffBytes(ascii("%PDF-1.7\n%\xe2\xe3")).kind, "pdf");
  assert.equal(M.sniffBytes(ascii("\xef\xbb\xbf%PDF-1.4")).kind, "pdf", "BOM before the header");
  assert.equal(M.sniffBytes(ascii("see the spec: %PDF-1.7 starts a file")).kind, "text", "a text that merely MENTIONS %PDF- is text");
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<?xml version="1.0"?>\n<svg width="1"/>',
    '\xef\xbb\xbf<!-- c -->\n<!DOCTYPE svg PUBLIC "x" "y"><svg/>',
    "  \n<SVG viewBox='0 0 1 1'/>",
  ]) assert.equal(M.sniffBytes(ascii(svg)).kind, "svg", svg);
  assert.equal(M.sniffBytes(ascii("<html><svg></svg></html>")).kind, "text", "svg INSIDE html is not an svg file");
  assert.equal(M.sniffBytes(ascii("plain words, a csv\nline,two\n")).kind, "text");
  assert.equal(M.sniffBytes(ascii("BMW is a car maker and this is plain text")).kind, "text", "text starting with BM is not a bitmap");
  const bmp = ascii("BM\x46\x00\x00\x00\x00\x00\x00\x00\x36\x00\x00\x00\x28\x00\x00\x00\x01\x00");
  assert.equal(M.sniffBytes(bmp).mime, "image/bmp");
  assert.equal(M.sniffBytes(bytes(0, 1, 2, 3, 4, 5, 6, 7)).kind, "binary");
  assert.equal(M.sniffBytes(bytes()).kind, "binary", "empty");
  assert.equal(M.sniffBytes(bytes(0x89)).kind, "binary", "one byte of a signature is not a file");
  assert.equal(M.sniffBytes(bytes(0x89, 0x50, 0x4e, 0x47)).kind, "binary", "a truncated PNG signature");
  assert.equal(M.sniffBytes(ascii("a\u0000b")).kind, "binary", "a NUL byte means binary");
  // fuzz: never throws, always a valid kind
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 3000; i++) {
    const b = Uint8Array.from({ length: Math.floor(rnd() * 40) }, () => Math.floor(rnd() * 256));
    const s = M.sniffBytes(b);
    assert.ok(["image", "svg", "pdf", "text", "binary"].includes(s.kind));
  }

  // 2. what the reader does with a binary note
  const png = M.sniffBytes(PNG), pdf = M.sniffBytes(ascii("%PDF-1.4")), svg = M.sniffBytes(ascii("<svg/>")), txt = M.sniffBytes(ascii("hello")), bin = M.sniffBytes(bytes(0, 1));
  assert.equal(M.planMedia("image", "image/png", png, 70), "image");
  assert.equal(M.planMedia("image", "", png, 70), "image", "an EMPTY mime does not matter: the bytes decide");
  assert.equal(M.planMedia("file", "application/octet-stream", png, 70), "image", "a file note holding a PNG is a picture");
  assert.equal(M.planMedia("file", "application/pdf", pdf, 5000), "pdf");
  assert.equal(M.planMedia("image", "image/svg+xml", svg, 40), "image");
  assert.equal(M.planMedia("file", "text/csv", txt, 20), "text");
  assert.equal(M.planMedia("file", "", txt, 20), "text");
  assert.equal(M.planMedia("file", "application/zip", txt, 20), "download", "text-looking bytes with a binary mime stay a download");
  assert.equal(M.planMedia("file", "application/zip", bin, 2000), "download");
  assert.equal(M.planMedia("image", "image/tiff", bin, 2000), "download", "an image type we cannot decode is offered for download");
  assert.equal(M.planMedia("image", "image/png", png, M.MAX_VIEW_BYTES + 1), "download", "too big to show inline");
  assert.equal(M.planMedia("file", "text/plain", txt, M.MAX_VIEW_BYTES + 1), "text", "a big text file is cut, not refused");
  assert.equal(M.isBinaryNoteType("image") && M.isBinaryNoteType("file"), true);
  assert.equal(M.isBinaryNoteType("text") || M.isBinaryNoteType("code") || M.isBinaryNoteType("canvas"), false);

  // 3. small helpers
  assert.equal(M.formatBytes(0), "0 B");
  assert.equal(M.formatBytes(1536), "1.5 KB");
  assert.equal(M.formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(M.formatBytes(NaN), "?");
  assert.equal(M.downloadName("My/Evil\\..\\name?.png", "image/png"), "My_Evil_.._name_.png");
  assert.equal(M.downloadName("report", "application/pdf"), "report.pdf");
  assert.equal(M.downloadName("report.PDF", "application/pdf"), "report.PDF", "no double extension");
  assert.equal(M.downloadName("", ""), "note");
  assert.equal(M.downloadName("...hidden", ""), "hidden", "no leading dots");
  assert.ok(M.downloadName("x".repeat(500), "").length <= 120);
  const dt = M.decodeText(ascii("abc"), 2);
  assert.deepEqual(dt, { text: "ab", truncated: true });
  assert.equal(M.decodeText(Uint8Array.from([0x68, 0xff, 0x69])).text, "h�i", "bad UTF-8 never throws");

  // 4. which URLs are Trilium pictures
  const c = E.classifyImageSrc;
  assert.deepEqual(c("api/attachments/a78cP2ADAWlW/image/pic.png"), { kind: "attachment", id: "a78cP2ADAWlW" });
  assert.deepEqual(c("/api/attachments/a78cP2ADAWlW/image/pic.png?x=1"), { kind: "attachment", id: "a78cP2ADAWlW" });
  assert.deepEqual(c("../api/attachments/abcd1234/image/a%20b.png"), { kind: "attachment", id: "abcd1234" });
  assert.deepEqual(c("https://trilium.example.com/api/attachments/abcd1234/download"), { kind: "attachment", id: "abcd1234" });
  assert.deepEqual(c("api/images/JZlxCRAyiktS/pic.png"), { kind: "note", id: "JZlxCRAyiktS" });
  assert.deepEqual(c("/trilium/api/images/JZlxCRAyiktS"), { kind: "note", id: "JZlxCRAyiktS" }, "behind a reverse-proxy prefix (generic fallback)");
  assert.equal(c("data:image/png;base64,AAAA"), null);
  assert.equal(c("blob:https://x/abc"), null);
  assert.equal(c("javascript:alert(1)"), null);
  assert.equal(c("https://cdn.example.com/pic.png"), null, "an ordinary remote picture is left alone");
  assert.equal(c("api/attachments/ab/image/x.png"), null, "ids are 4+ chars");
  assert.equal(c("api/attachments/ab$d1234/image/x.png"), null, "ids are alphanumeric");
  assert.equal(c(""), null);

  // 5. collect / replace on normalised HTML
  const html = `<p>x</p><img src="api/attachments/aaaa1111/image/a.png" alt="a>b"><img alt="" src="api/images/bbbb2222/b.png"><img src="https://x.org/ok.png"><img src="api/attachments/aaaa1111/image/a.png">`;
  const refs = E.collectEmbeds(html);
  assert.equal(refs.size, 2, "de-duplicated by raw src");
  assert.deepEqual([...refs.values()].map((r) => r.id), ["aaaa1111", "bbbb2222"]);
  const rep = E.replaceImageSrcs(html, new Map([["api/attachments/aaaa1111/image/a.png", "data:X"]]));
  assert.equal((rep.match(/data:X/g) ?? []).length, 2, "both uses replaced");
  assert.ok(rep.includes('src="https://x.org/ok.png"') && rep.includes("api/images/bbbb2222"), "others untouched");
  assert.equal(E.collectEmbeds("<p>no images</p>").size, 0);
  assert.equal(E.collectEmbeds('<p>src="api/images/aaaa1111/x"</p>').size, 0, "text that looks like an attribute is not an img tag");

  // 6. inlining: fetchers are faked; the bytes decide what is accepted
  const blobOf = (u8) => new Blob([u8]);
  const calls = [];
  const mkFetcher = (over = {}) => ({
    note: async (id) => (calls.push(["note", id]), over.note ? over.note(id) : blobOf(PNG)),
    attachment: async (id) => (calls.push(["att", id]), over.attachment ? over.attachment(id) : blobOf(PNG)),
  });
  {
    const r = await E.inlineEmbeddedImages(html, mkFetcher());
    assert.equal(r.inlined, 2);
    assert.equal(r.failed, 0);
    assert.equal(calls.length, 2, "the same attachment used twice is fetched once");
    assert.ok(r.html.includes("data:image/png;base64,iVBORw0KGgo"));
    assert.ok(!r.html.includes("api/attachments") && !r.html.includes("api/images"), "no request to the Trilium URL is left in the document");
    assert.ok(r.html.includes("https://x.org/ok.png"), "unrelated remote pictures stay as they are");
  }
  {
    const r = await E.inlineEmbeddedImages(html, mkFetcher({ attachment: async () => { throw new Error("401"); } }));
    assert.equal(r.failed, 1);
    assert.equal(r.inlined, 1);
    assert.ok(r.html.includes("picture%20unavailable"), "a failed picture becomes the placeholder");
    assert.ok(!r.html.includes("api/attachments"));
  }
  {
    const evil = async () => blobOf(ascii("<html><script>alert(1)</script></html>"));
    const r = await E.inlineEmbeddedImages(html, mkFetcher({ attachment: evil, note: evil }));
    assert.equal(r.inlined, 0);
    assert.ok(!r.html.includes("alert(1)") && !r.html.includes("text/html"), "a response that is not a picture is never inlined");
  }
  {
    const svgBlob = async () => blobOf(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    const r = await E.inlineEmbeddedImages(html, mkFetcher({ attachment: svgBlob }));
    assert.ok(r.html.includes("data:image/svg+xml;base64,"), "svg is inlined as an IMAGE data url (scripts never run in <img>)");
  }
  {
    const big = async () => blobOf(new Uint8Array(E.EMBED_LIMITS.perImage + 1));
    const r = await E.inlineEmbeddedImages(html, mkFetcher({ attachment: big }));
    assert.equal(r.failed, 1, "over the per-image limit");
  }
  {
    const many = Array.from({ length: 60 }, (_, i) => `<img src="api/attachments/att${String(i).padStart(4, "0")}/image/p.png">`).join("");
    calls.length = 0;
    const r = await E.inlineEmbeddedImages(many, mkFetcher());
    assert.equal(r.inlined, E.EMBED_LIMITS.count);
    assert.equal(r.failed, 60 - E.EMBED_LIMITS.count);
    assert.equal(calls.length, E.EMBED_LIMITS.count, "beyond the count limit nothing is fetched at all");
  }
  {
    const lim = { ...E.EMBED_LIMITS, total: PNG.length * 2 + 1 };
    const three = ["aaaa1111", "bbbb2222", "cccc3333"].map((i) => `<img src="api/attachments/${i}/image/p.png">`).join("");
    const r = await E.inlineEmbeddedImages(three, mkFetcher(), lim);
    assert.equal(r.inlined, 2, "the total byte budget stops the third");
    assert.equal(r.failed, 1);
  }
  assert.deepEqual(await E.inlineEmbeddedImages("<p>plain</p>", mkFetcher()), { html: "<p>plain</p>", inlined: 0, failed: 0 });

  // 7. where a note sits
  const edge = (parentNoteId, noteId) => ({ parentNoteId, noteId, notePosition: 0 });
  const tree = {
    rootNoteId: "root", notes: {}, truncated: false,
    edges: [edge("root", "a"), edge("root", "b"), edge("root", "c"), edge("a", "a1"), edge("a", "a2"), edge("b", "a2"), edge("a1", "deep")],
  };
  assert.deepEqual(P.ancestorsOf(tree, "deep"), ["root", "a", "a1"]);
  assert.deepEqual(P.ancestorsOf(tree, "root"), []);
  assert.deepEqual(P.ancestorsOf(tree, "nope"), []);
  assert.deepEqual(P.ancestorsOf(tree, "a2"), ["root", "a"], "a clone's path follows the FIRST parent");
  const cyc = { rootNoteId: "x", notes: {}, truncated: false, edges: [edge("x", "y"), edge("y", "x")] };
  assert.ok(P.ancestorsOf(cyc, "y").length <= 2, "a cycle cannot loop");
  assert.deepEqual(P.siblingsOf(tree, "b"), { prev: "a", next: "c", index: 1, total: 3 });
  assert.deepEqual(P.siblingsOf(tree, "a"), { prev: null, next: "b", index: 0, total: 3 });
  assert.deepEqual(P.siblingsOf(tree, "c"), { prev: "b", next: null, index: 2, total: 3 });
  assert.equal(P.siblingsOf(tree, "root").total, 0);
  assert.equal(P.siblingsOf(tree, "a2").prev, "a1", "siblings under the first parent");
  tree.edges.push(edge("c", "late"));
  assert.deepEqual(P.ancestorsOf(tree, "late"), ["root", "c"], "the index follows edge changes");
  assert.equal(P.triliumUrl("https://t.example.com/", tree, "deep"), "https://t.example.com/#root/a/a1/deep");
  assert.equal(P.triliumUrl("https://t.example.com", tree, "root"), "https://t.example.com/#root");
  assert.equal(P.triliumUrl("https://t.example.com", { ...tree, rootNoteId: "folder1" }, "a"), "https://t.example.com/#a", "a walk that did not start at root: bare id");
  assert.equal(P.triliumUrl("", tree, "a"), null);
  assert.equal(P.triliumUrl("javascript:alert(1)", tree, "a"), null);

  // 8. reader document: the new CSS, the script tokens, the restore position
  const doc = R.readerDocument("<p>x</p>", R.DEFAULT_PREFS, "NONCE123", { restore: 0.4 });
  for (const sel of ["figure.image", "ul.todo-list", "aside.admonition", "section.include-note", ".marker-yellow", ".math-tex", "mark.biblio-find", "figure.table"]) {
    assert.ok(doc.includes(sel), `CSS for ${sel}`);
  }
  assert.ok(!doc.includes("NONCE_TOKEN") && !doc.includes("RESTORE_TOKEN"), "every token replaced");
  assert.ok(doc.includes('var NONCE = "NONCE123"') && doc.includes("var RESTORE = 0.4;"));
  assert.ok(doc.includes("script-src 'nonce-NONCE123'") && !doc.includes("allow-same-origin"));
  assert.ok(doc.includes("e.source !== parent") && doc.includes("d.nonce !== NONCE"), "messages from the parent are checked for source AND nonce");
  assert.ok(!doc.includes("leaf-wrap"), "an ordinary paper has no leaf wrapper");
  assert.ok(R.readerDocument("<p>x</p>", R.DEFAULT_PREFS, "N", { restore: 7 }).includes("var RESTORE = 1;"), "restore is clamped to 0..1");
  assert.ok(R.readerDocument("<p>x</p>", R.DEFAULT_PREFS, "N", { restore: NaN }).includes("var RESTORE = 0;"));
  assert.ok(R.readerDocument("<p>x</p>", R.DEFAULT_PREFS, "N").includes("var RESTORE = 0;"));
  assert.equal(R.readingMinutes(0), 0);
  assert.equal(R.readingMinutes(5), 1);
  assert.equal(R.readingMinutes(2200), 10);

  // 9. scroll memory parsing
  assert.deepEqual(R.sanitizeScrollMap(null), {});
  assert.deepEqual(R.sanitizeScrollMap({ a: 0.5, b: "x", c: 7, d: -1, e: NaN }), { a: 0.5, c: 1, d: 0 });
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  assert.equal(R.recallScroll("n1"), 0);
  R.rememberScroll("n1", 0.37);
  assert.equal(R.recallScroll("n1"), 0.37);
  R.rememberScroll("n1", 0.001);
  assert.equal(R.recallScroll("n1"), 0, "back at the top forgets the note");
  for (let i = 0; i < 260; i++) R.rememberScroll("n" + i, 0.5);
  assert.equal(R.recallScroll("n0"), 0, "only the 200 most recent are kept");
  assert.equal(R.recallScroll("n259"), 0.5);
  store.set("biblio.v1.readerScroll", "{not json");
  assert.equal(R.recallScroll("n259"), 0, "garbage in storage is ignored");
  delete globalThis.localStorage;

  // 10. the leaf papers: three variants, legible, deterministic, gentle overlays
  const lum = (hex) => {
    const c2 = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c2[0] + 0.7152 * c2[1] + 0.0722 * c2[2];
  };
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const leafKeys = Object.keys(R.PAPERS).filter((k) => R.PAPERS[k].leaf);
  assert.deepEqual(leafKeys.sort(), ["leaf", "leafAutumn", "leafMaple"]);
  for (const k of leafKeys) {
    const paper = R.PAPERS[k];
    const stops = paper.page.match(/#[0-9a-f]{6}/gi);
    assert.ok(stops.length >= 2);
    for (const st of stops) {
      assert.ok(contrast(paper.ink, st) >= 7, `${k}: ink/page ${contrast(paper.ink, st).toFixed(2)} on ${st}`);
      assert.ok(contrast(paper.link, st) >= 4.5, `${k}: link/page ${contrast(paper.link, st).toFixed(2)} on ${st}`);
    }
    assert.equal(R.sanitizePrefs({ paper: k }).paper, k, `${k} is a valid stored paper`);
    const d = R.readerDocument("<p>x</p>", { ...R.DEFAULT_PREFS, paper: k }, "N");
    assert.ok(d.includes("leaf-wrap") && d.includes("leaf-stem") && d.includes("mask-image") && d.includes("--leaf-base"), `${k} draws the leaf`);
    assert.ok(d.includes(paper.ink));
    assert.equal(d.split("<style>").length, 2, "one style block");
  }
  for (const v of ["spring", "autumn", "maple"]) {
    assert.equal(L.veinsSvg(v), L.veinsSvg(v), "deterministic");
    for (const svg of [L.veinsSvg(v), L.speckleSvg(v), L.stemSvg(v), L.edgeStripSvg(v, "left"), L.edgeStripSvg(v, "right"), L.capSvg(v, "top"), L.capSvg(v, "bottom")]) {
      assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>") && !/<script|onload|javascript:/i.test(svg), "plain svg");
      for (const m of svg.matchAll(/\bopacity="([\d.]+)"/g)) {
        if (svg === L.stemSvg(v)) continue;
        assert.ok(Number(m[1]) <= L.LEAF_OVERLAY_MAX_OPACITY, `${v}: overlay opacity ${m[1]}`);
      }
    }
    const dec = L.leafDecor(v, 720);
    assert.ok(dec.css.includes("max-width: 720px") && dec.before.includes("leaf-stem") && dec.before.includes("leaf-teeth") && dec.after === "</div></div>");
    assert.equal((dec.before.match(/<div/g) ?? []).length, (dec.before.match(/<\/div>/g) ?? []).length + (dec.after.match(/<\/div>/g) ?? []).length, "every div opened by the decoration is closed");
  }
  assert.notEqual(L.veinsSvg("spring"), L.veinsSvg("maple"), "variants differ");
  assert.notEqual(L.edgeStripSvg("spring", "left"), L.edgeStripSvg("maple", "left"), "maple has deeper teeth");
  assert.equal(R.DEFAULT_PREFS.paper, "parchment");
};
