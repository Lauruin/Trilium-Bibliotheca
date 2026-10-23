// Unit checks for the mite's leaf view (lib/leafreader.ts: note -> blocks -> laid-out lines, blade size, scroll), the hover excerpts
// (lib/leafsize.ts excerptOf) and the learning gate (library.ts: `learn` / `noai`, own + inherited labels). Run by tools/unit-test.mjs.
export default async ({ bundle, assert }) => {
  const R = await bundle("src/lib/leafreader.ts", "leafreader-unit.mjs");
  const LS = await bundle("src/lib/leafsize.ts", "leafsize-leaf-unit.mjs");
  const LIB = await bundle("src/lib/library.ts", "library-leaf-unit.mjs");
  const kinds = (bs) => bs.map((b) => b.kind);
  const texts = (bs) => bs.map((b) => b.text);

  // 1. html -> blocks
  {
    const b = R.htmlToBlocks("<h1>Title</h1><p>One <b>bold</b> and <i>it</i>.</p><h2>Sub</h2><p>Two&nbsp;words &amp; &lt;tags&gt; &#8364; &eacute;</p>");
    assert.deepEqual(kinds(b), ["h1", "p", "h2", "p"]);
    assert.deepEqual(texts(b), ["Title", "One bold and it.", "Sub", "Two words & <tags> € é"]);
    const l = R.htmlToBlocks("<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol><li>x</li><li>y</li></ol>");
    assert.deepEqual(l.map((x) => [x.kind, x.text, x.depth, x.mark]), [["li", "a", 0, "•"], ["li", "b", 0, "•"], ["li", "c", 1, "•"], ["li", "x", 0, "1."], ["li", "y", 0, "2."]]);
    const c = R.htmlToBlocks("<pre><code>line 1\n  line 2\n\nline 4</code></pre><p>after</p>");
    assert.deepEqual(c.map((x) => [x.kind, x.text]), [["code", "line 1\n  line 2\n\nline 4"], ["p", "after"]], "code keeps its line breaks");
    assert.deepEqual(R.htmlToBlocks("<blockquote><p>wise words</p></blockquote><p>plain</p>").map((x) => [x.kind, x.text]), [["quote", "wise words"], ["p", "plain"]]);
    assert.deepEqual(kinds(R.htmlToBlocks("<p>a</p><hr><p>b</p>")), ["p", "hr", "p"]);
    assert.equal(R.htmlToBlocks("<table><tr><td>a</td><td>b</td></tr></table>")[0].text, "a | b |", "table cells");
    assert.deepEqual(texts(R.htmlToBlocks("<p>line<br>break</p>")), ["line break"]);
    // hostile / broken input: nothing executable or tag-like survives, nothing throws
    const hostile = R.htmlToBlocks('<p onclick="x()">hi</p><script>alert(1)</script><style>p{}</style><!-- c --><svg><script>x</script></svg><img src=x onerror=y><a href="javascript:z">link</a><p>unterminated <b');
    assert.deepEqual(texts(hostile), ["hi", "link", "unterminated"], JSON.stringify(texts(hostile)));
    for (const bad of [null, undefined, 5, "", "<", "<<<>>>", "<p", "&#x110000;&#0;&bogus;&#xD800;", "<p>\u0000\u0007x</p>"]) assert.doesNotThrow(() => R.htmlToBlocks(bad), String(bad));
    assert.deepEqual(texts(R.htmlToBlocks("<p>&#0;&bogus;&#xD800;a</p>")), ["a"], "bad entities are dropped");
    assert.ok(!texts(R.htmlToBlocks("<p>\u0000\u0007x</p>")).join("").includes("\u0000"));
    // size bounds
    const huge = R.htmlToBlocks("<p>" + "word ".repeat(300000) + "</p>");
    assert.ok(huge.reduce((n, x) => n + x.text.length, 0) <= R.LEAF_TEXT_MAX + 200, "a huge note is cut");
    const many = R.htmlToBlocks("<p>x</p>".repeat(400000));
    assert.ok(many.length <= R.LEAF_TEXT_MAX + 2 && many[many.length - 1].text.includes("open it in the reader"), "very many blocks: cut with a notice");
    assert.ok(R.htmlToBlocks("<p>short</p>").length === 1, "a short note has no notice");
  }
  // 2. markdown, plain, blocksFor
  {
    const b = R.markdownToBlocks("# Head\n\nSome *text* with `code`.\n\n- one\n- two\n\n> quote\n\n```\ncode block\n  indented\n```\n\n<script>alert(1)</script>");
    assert.deepEqual(kinds(b), ["h1", "p", "li", "li", "quote", "code"], JSON.stringify(b));
    assert.equal(b[5].text, "code block\n  indented");
    assert.ok(!JSON.stringify(b).includes("alert"), "raw script in markdown is dropped");
    assert.deepEqual(R.plainToBlocks("a\nb\n\n\nc").map((x) => x.text), ["a\nb", "c"]);
    assert.deepEqual(R.plainToBlocks("").length, 0);
    assert.equal(R.blocksFor("text", "<p>x</p>")[0].text, "x");
    assert.equal(R.blocksFor("markdown", "x")[0].text, "x");
    assert.equal(R.blocksFor("code", "x")[0].kind, "code");
    assert.match(R.blocksFor("canvas", "{}")[0].text, /canvas/);
    assert.match(R.blocksFor("", "")[0].text, /unknown/);
  }
  // 3. layout with a fixed-width stand-in for measureText
  {
    const m = { measure: (t, size, bold, mono) => t.length * size * (mono ? 0.6 : 0.5) * (bold ? 1.1 : 1) };
    const blocks = R.htmlToBlocks("<h1>A heading that is long enough to wrap around the column</h1><p>" + "lorem ipsum dolor sit amet ".repeat(30) + "</p><ul><li>item one</li><li>item two which is also rather long and so wraps onto a second line</li></ul><pre>x = 1\n  y = 2</pre><hr><p>Supercalifragilisticexpialidocious-" + "x".repeat(200) + "</p>");
    const W = 300;
    const a = R.layoutBlocks(blocks, W, m);
    const b = R.layoutBlocks(blocks, W, m);
    assert.deepEqual(a, b, "deterministic");
    assert.ok(a.lines.length > 15 && a.height > 300);
    let prev = -1;
    for (const l of a.lines) {
      assert.ok(Number.isFinite(l.x) && Number.isFinite(l.y) && l.y >= prev, "lines go down");
      prev = l.y;
      assert.ok(l.kind === "hr" || m.measure(l.text, l.size, l.bold, l.mono) + l.x <= W + 1e-6, `no line is wider than the column (${l.kind}: ${l.text.slice(0, 30)})`);
    }
    assert.ok(a.lines.some((l) => l.mark === "•") && a.lines.filter((l) => l.mark).length === 2, "bullets on the first line of each item only");
    assert.ok(a.lines.filter((l) => l.kind === "li")[0].x >= 20, "list items are indented");
    assert.ok(a.lines.some((l) => l.kind === "code" && l.text === "  y = 2"), "code keeps leading spaces");
    assert.ok(a.height >= prev, "the height covers the last line");
    const narrow = R.layoutBlocks(blocks, 150, m);
    assert.ok(narrow.height > a.height && narrow.lines.length > a.lines.length, "a narrower column is taller");
    assert.deepEqual(R.layoutBlocks([], 300, m), { lines: [], height: 0 });
    for (const w of [NaN, 0, -5, Infinity]) assert.ok(Number.isFinite(R.layoutBlocks(blocks, w, m).height), `width ${w}`);
    assert.equal(R.lineAt(a.lines, a.lines[0].y), 0);
    assert.equal(R.lineAt(a.lines, -5), -1);
    assert.equal(R.lineAt(a.lines, a.height + 100), a.lines.length - 1);
    assert.equal(R.lineAt([], 5), -1);
  }
  // 4. the leaf's size grows with the note up to a cap; scroll keeps the mite in the middle
  {
    let prev = 0;
    for (const n of [0, 50, 200, 800, 2000, 4000, 20000, 1e7]) {
      const s = R.bladeSize(n, 1280, 800);
      assert.ok(s.h >= prev - 1e-9 && s.h <= 800 * 0.86 + 1e-9 && s.w <= 1280 * 0.9 + 1e-9 && s.scale >= 0.42 && s.scale <= 1, `blade ${n} chars`);
      assert.ok(Math.abs(s.w / s.h - R.BLADE_ASPECT) < 1e-9 || s.w <= 1280 * 0.9);
      prev = s.h;
    }
    assert.ok(R.bladeSize(100, 1280, 800).h < R.bladeSize(5000, 1280, 800).h * 0.7, "a short note is a small leaf");
    assert.equal(R.bladeSize(4000, 1280, 800).h, R.bladeSize(1e6, 1280, 800).h, "capped");
    assert.ok(Number.isFinite(R.bladeSize(NaN, 0, 0).h));
    assert.equal(R.scrollFor(10, 100, 300), 0, "text shorter than the window: no scroll");
    assert.equal(R.scrollFor(0, 1000, 300), 0);
    assert.equal(R.scrollFor(500, 1000, 300), 350);
    assert.equal(R.scrollFor(990, 1000, 300), 700, "never past the end");
  }
  // 5. hover excerpts
  {
    const E = LS.excerptOf;
    assert.equal(E("text", "<h1>Hi</h1><p>there &amp; <b>you</b></p>"), "Hi there & you");
    assert.equal(E("markdown", "# raw  markdown\n\ntext"), "# raw markdown text");
    assert.equal(E("image", "xxx"), "");
    assert.equal(E("file", "xxx"), "");
    const long = E("text", "<p>" + "word ".repeat(100) + "</p>");
    assert.ok(long.length <= 161 && long.endsWith("…") && !long.includes("  "), `cut at a word (${long.length})`);
    assert.equal(E("text", "<script>alert(1)</script>safe"), "safe");
    assert.equal(E("text", "<p>unterminated <b"), "unterminated");
    assert.ok(!E("text", "a\u0000b\u0007c").match(/[\u0000-\u001f]/));
    assert.equal(E("code", ""), "");
    assert.doesNotThrow(() => E("text", null));
  }
  // 6. the learning gate: own or inherited biblio_learn; own value false switches it off; biblio_noai is separate
  {
    const attr = (noteId, name, value = "", inh = false) => ({ attributeId: noteId + name, noteId, type: "label", name, value, isInheritable: inh });
    const notes = {
      root: { noteId: "root", title: "root", type: "text", childNoteIds: ["f", "g"], attributes: [] },
      f: { noteId: "f", title: "F", type: "text", childNoteIds: ["a", "b", "c"], attributes: [attr("f", "biblio_learn", "", true)] },
      a: { noteId: "a", title: "a", type: "text", childNoteIds: [], attributes: [attr("f", "biblio_learn", "", true)] },
      b: { noteId: "b", title: "b", type: "text", childNoteIds: [], attributes: [attr("f", "biblio_learn", "", true), attr("b", "biblio_learn", "false")] },
      c: { noteId: "c", title: "c", type: "text", childNoteIds: [], attributes: [attr("f", "biblio_learn", "", true), attr("c", "biblio_noai")] },
      g: { noteId: "g", title: "G", type: "text", childNoteIds: ["d", "e"], attributes: [attr("g", "biblio_learn", "", false)] },
      d: { noteId: "d", title: "d", type: "text", childNoteIds: [], attributes: [] },
      e: { noteId: "e", title: "e", type: "text", childNoteIds: [], attributes: [attr("e", "biblio_learn", "yes")] },
    };
    const tree = await LIB.walkLibraryTree({ getNote: async (id) => notes[id] }, "root");
    const f = (id) => [!!tree.notes[id].learn, !!tree.notes[id].noai];
    assert.deepEqual(f("root"), [false, false], "no label, no learning");
    assert.deepEqual(f("f"), [true, false], "the folder itself (own, inheritable)");
    assert.deepEqual(f("a"), [true, false], "a note under an inheritable label inherits it");
    assert.deepEqual(f("b"), [false, false], "an own biblio_learn=false switches an inherited one off");
    assert.deepEqual(f("c"), [true, true], "biblio_noai is separate: learnable, but never sent to an AI");
    assert.deepEqual(f("g"), [true, false], "an own (non-inheritable) label counts for that note");
    assert.deepEqual(f("d"), [false, false], "... and is NOT inherited by its children");
    assert.deepEqual(f("e"), [true, false], "own label with any value but false");
    assert.ok(!("learn" in tree.notes.root) && !("noai" in tree.notes.root), "the flags are absent, not false");
    assert.ok(!Object.keys(tree.notes.f.labels).includes("biblio_noai"), "labels stay OWN labels only");
    // the shelves never show the flag labels
    assert.ok(LIB.NOISE_LABELS.has("biblio_learn") && LIB.NOISE_LABELS.has("biblio_noai"));
  }
};
