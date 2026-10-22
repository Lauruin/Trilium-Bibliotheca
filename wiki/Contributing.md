# Contributing

Start with [Getting Started](Getting-Started.md) and [Architecture](Architecture.md). The agent-facing rules are in `AGENTS.md` (`CLAUDE.md` imports it).

## The standing rule: docs move with the code

Update the docs **in the same change** as the code, not afterwards and not only when asked. A change is not done until the docs match it. Touch whichever of these it affects before calling it finished:

| Doc | Update when |
|---|---|
| `README.md` | User-visible features or status, quick start, security notes |
| `LOCAL-TESTING.md` | Ports, commands, credentials, hotkeys and controls, test recipes |
| `AGENTS.md` | Architecture decisions, commands, ports, the verified ETAPI contract (record the response shape of any newly verified endpoint), gotchas (symptom to cause) |
| `wiki/` | Anything a page here states: keys, labels, limits, tool behaviour |
| `tools/README.md` | A script is added, renamed or changes what it needs or touches |
| Code and `compose.yml` comments | They mention a port, key or behaviour that changed |
| `game-ui.md`, `ueberblick.md`, `knowledge-planning/*` | A decision or plan changed; mark superseded parts instead of leaving them silently wrong |
| Tests | New behaviour gets a unit test or a browser-test step |

Stale docs are bugs: if you notice one while working, fix it then. Every statement in the wiki should be checkable against the code or an existing doc; mark planned things as *(planned)*.

## Git and safety

- Work on **feature branches**; never commit directly to `main`; never `git push --force`; never commit `node_modules/`, `shots/` or `.bootstrap.env`.
- `main` holds planning docs only (merged by the owner); `devbranch` is the integration branch. (State as of 2026-10, from `AGENTS.md`.)
- `/workspace` is a bind mount with **no undo**. Commit before a move, restructure or bulk edit, and never `rm -rf` a path you have not listed first.
- Never point tests or seeds at a real Trilium. Never put a real token or any provider API key in the repo or in docs.

## Before you call something done

**CONTAINER**

```bash
npx tsc -b && node tools/unit-test.mjs      # strict types, unit tests
npm run test:mock                           # if you touched tools/ or the generator
node tools/browser-test.js                  # if you touched the UI (needs the mock)
```

`npm test` runs everything but **wipes the mock**; see [Testing](Testing.md). Look at 3D changes with `tools/tree-shots.js`; the look is judged from the pictures.

## House rules in the code

- Only `src/lib/trilium/` talks HTTP. Map wire shapes to `src/types.ts` in `library.ts`.
- Phaser bus handlers are registered once at module level, never inside `create()`.
- The reader keeps `sandbox="allow-scripts"` without `allow-same-origin`, and its CSP. Never relax either.
- World-building and tree-property writes go through `lib/labels.ts#setLabel` (refuses non-`biblio_` names, own labels only), reached via `commitLabel`; everything else is read-only.
- Labels are lowercase with underscores (Trilium strips dots) and never `isInheritable`.
- Pure logic (`world3`, `sim3`, `silk`, `species`, `layout`, `leafkind`, `themes`, `decor`, `shelving`, `treeedit` planning) must stay free of Phaser, three.js and DOM so it stays unit-testable.
- Grip is decided by world gravity, never by a branch's own up axis.
- Comments explain *why*, and say what was verified. Keep `config.ts` boring and truthful.

## How to ...

### Add an animal

1. **`src/tree/sim3.ts`:** define an `Animal` constant: `nodes` (body trail distances `d` and half-widths `w`), `legs` (node, side, gait group, lead), `speed`, `turnRate`, `stride`, `splay`, `stepTime`, colours, `scale`, `leap` (or `null`), and the optional abilities: `reach`, `bodyGrip`, `maxTh`, `colors`, `legShape`, `clings`, `flight`, `wings`.
   Add it to the `ANIMALS` array with its `scaled(...)` factor, and put its `id` in **exactly one** category of `ANIMAL_CATEGORIES` (the number keys and the on-screen buttons derive from that list).
   A new category would mean a new number key: update the "invalid keys" assertion in the unit test (it expects `0, 4, 9, ...` to be rejected) and the key lists in the docs.
2. **Rendering:** add a `Model` for the `id` to `MODELS` in **`src/tree/animalmodels.ts`** (pure data, unscaled sim pixels: `tubes` for torso / tail / abdomen with a colour function, `atts` for heads, eyes, ears and other parts in the body frame, `legs` for the leg style, optional `wings`, `slither`, `tail`, `head`). `src/tree/creatures.ts` draws it in both looks and animates it from the sim; an animal without a model gets a generic tube + head + legs (`genericModel`). Keep tube widths within the sim's half-widths (`tools/unit-animals.mjs` checks it, and that every sim animal has a model).
3. **Tests:** `tools/unit-test.mjs` section 15 asserts animal ids are unique and every animal is in exactly one category; add behaviour tests next to the ability you use (sections 11, 15, 18 for aiming and the jay, 19 for reach, silk and the jumping spider). Decide the ability flags deliberately: `leap` makes the animal aim (hold `Space`), `reach` makes `Space` stretch, `silk` enables `X`, `clings` removes grip loss; `canUseThreads` (clingers, or half-width of 6 or less) decides who can walk on silk threads.
4. **Screenshots:** add the animal to the `order` list of the `animals` scenario in `tools/tree-shots.js` (all ten are in it today). The `snake` scenario presses `1` until the snake is the animal, so a change to the crawler order is harmless.
5. **Docs:** [Animals Guide](Animals-Guide.md) (the count in its first paragraph, the category table and the at-a-glance table), `README.md` (tree paragraph), `LOCAL-TESTING.md` (tree bullet), `AGENTS.md` (Yggdrasil section and test list), the controls line in `ui/TreeView.tsx` and the headers in `src/tree/proto.ts` and `TreeScene.ts` if keys changed.

### Add a leaf kind

1. **`src/tree/leafkind.ts`:** extend the `LeafKind` union and `LEAF_KINDS`; map note types in `BY_TYPE`; add the outline(s) to `LEAF_SHAPES` (counter-clockwise simple polygons in unit leaf space: `u` across the blade, `v` from stalk tip 0 to far tip 1); optionally a `LEAF_ACCENT` colour.
2. **`src/tree/look.ts`:** `buildLeaves` is driven by `LEAF_SHAPES`; the voxel and low-poly builders special-case `fruit` and a fold factor for `broad`/`maple`, so check both looks if your shape needs its own handling.
3. **`src/config.ts`:** the comment on `LABELS.leaf` lists the valid values.
4. **Tests and shots:** unit section 13 (kinds, scale, outlines, the `biblio_leaf` override); the `kinds` scenario of `tools/tree-shots.js` and the `KINDS` list in `src/tree/proto.ts`.
5. **Docs:** [Tree View](Tree-View-Yggdrasil.md), [Trilium Mapping](Trilium-Mapping.md), `AGENTS.md`, `README.md`, `LOCAL-TESTING.md`.

### Add a theme

1. **`src/game/themes.ts`:** append an entry to `THEMES` (tints for wall, wainscot, floor, glass, shaft, flame and an optional grade). The build panel chips, the overview tint, the door pennants and `resolveTheme` are all generic.
2. **Append, do not reorder:** the build panel binds keys `1` to `THEMES.length` by position, and `tools/browser-test.js` presses `2` and expects `midnight`. Only single digits are bound; themes past 9 are reachable by clicking.
3. Tints multiply, so a theme can only darken or shift the base art; tune it by screenshot. Light themes need palette-parameterised textures (not built).
4. **Tests:** unit section 7 (themes); `tools/mock-test.mjs` checks that generated `biblio_*` values are values the app understands, using the app's own lists.
5. **Docs:** `README.md` (the "colour moods" count), `LOCAL-TESTING.md` (the `1`-`7` range), [Build Mode](Build-Mode.md), [Trilium Mapping](Trilium-Mapping.md), the label table in `knowledge-planning/worldediting-plan.md`.

### Add a tree species

1. **`src/tree/species.ts`:** add the key to the `SpeciesKey` union and an entry to `SPECIES` (use `maple` as the reference: all multipliers 1). Growth fields: `trunkLen`, `trunkR`, `branchR`, `childLen` (multipliers), `taper`, `pitchMin`/`pitchMax` (degrees off the parent), `upBias`, `droop`, `lengthDecay`, `azimuthRule` (`golden`, `whorl`, `alternate`), `attachFrom`/`attachTo`, `sway`, `tropism`.
   **Palette:** `bark.base` (sRGB 0 to 1), `variation`, an optional `mark` (colour and chance of scars or lenticels), `moss` and `streak` (0 to 1), and `leaf.color` (a CSS colour for a leaf with no `#color` and no tag). Give it its own bark colour, leaf colour and growth numbers: unit section 17 asserts every species differs in all three.
2. **Order and count:** `SPECIES_KEYS` is the object's key order and drives the automatic pick (a hash of the note id, stepped by 5). Keep the count **not a multiple of 5** (the step must stay coprime to it), and expect that adding a species **changes which tree gets which automatic kind** in existing vaults (users who set `biblio_species` are unaffected).
3. The renderer (`look.ts#barkOf`), the branch panel's "Kind of tree" list (`SPECIES_KEYS`) and the `biblio_species` parsing (`parseSpeciesKey`) are generic: nothing else needs editing. Update the value list in the `LABELS.species` comment in `src/config.ts`.
4. **Tests:** unit section 17 (the species table sanity checks, "every species lays out finitely").
5. **Docs:** the species table in [Tree View](Tree-View-Yggdrasil.md#species), the value list of `biblio_species` in [Trilium Mapping](Trilium-Mapping.md), the species count (13) in `AGENTS.md`, `README.md` and the Glossary if it appears there.

### Add a branch property

A property is something the user can override per folder (`PropKey`). Follow `bend` or `taper` as the model.

1. **`src/config.ts`:** a new label in `LABELS` with a comment (it is excluded from shelves automatically).
2. **`src/tree/layout.ts`:** add the key to `PropKey`, `BranchProps`, `PROP_KEYS`, `PROP_LABELS` and (numbers) `PROP_RANGES` (min, max, step, unit: the step also decides how many decimals are written). Compute its **calculated** value in `grow()` **without reading its own override**, take `eff = ov.x ?? calc.x`, and build the geometry from `eff` so that children follow. Handle the hub explicitly (what does it ignore?) and the trunk case.
3. **`src/ui/BranchPanel.tsx`:** add it to `NUMERIC` and `NAMES` (a non-numeric property needs its own control, as the species select has).
4. **`src/lib/treeedit.ts`:** `planChanges` and `recalcAll` iterate `PROP_LABELS`, so a numeric property needs nothing more; a new kind of value needs a case in `planChanges` (how it compares with the calculated one) and in `formatNumber`.
5. **Tests:** unit section 17 (override applied, clamped, `null` resets, `calc` unchanged by the override, descendants move) and section 20 (what gets written).
6. **Docs:** the property table in [Tree View](Tree-View-Yggdrasil.md#editing-branches-b), [Trilium Mapping](Trilium-Mapping.md), `AGENTS.md`.

### Add a `biblio_*` label

1. **`src/config.ts`:** add it to `LABELS` with a comment. It is excluded from shelves automatically (`NOISE_LABELS` spreads `LABELS`, plus the `biblio_` prefix test).
2. **Parse and validate** like `themes.ts` and `decor.ts` do: unknown or garbled values count as absent; CSV values at most 200 characters and 24 entries.
3. **Read** it where it is used (`NoteInfo.labels` already carries all own labels, lowercased). **Write** it only through `commitLabel` from a build-panel tab (add a `LABEL_TEXT` entry for the toast); the journal and conflict check come for free.
4. If you change the shape of cached data, bump the cache key in `config.STORAGE`.
5. **Tests:** unit sections 7 to 9; if the generator should emit it, add it to `tools/lib/vault-gen.mjs` so both the fake and the real mock get it.
6. **Docs:** the label table in [Trilium Mapping](Trilium-Mapping.md), `AGENTS.md` ("World building" and the label list), `knowledge-planning/worldediting-plan.md`.

### Add a seed profile

1. **`tools/lib/vault-gen.mjs`:** add an entry to `PROFILES`: `{size, desc}` for a balanced themed vault, or `{stress: "name", desc}` plus a `buildName(ctx, vaultRoot, budget)` function. Builders create notes with `ctx.mk(budget, parentKey, spec)` and must use their **whole budget**. Keep everything deterministic: no `Math.random`, no `Date` (a test enforces it).
2. **`tools/mock-test.mjs`:** add the profile to the expectations (size, depth, width).
3. New label, relation or clone kinds belong in the generator, so the fake and the real mock both get them.
4. **Docs:** the profile table in `AGENTS.md`, `LOCAL-TESTING.md` (the profile list) and [Mock and Seeding](Mock-and-Seeding.md). `node tools/seed-vault.js --list` prints the real numbers.

### Add a wall or floor decor kind

`src/game/decor.ts` (`WALL_KINDS` or `FLOOR_KINDS`, and `FLOOR_WIDTH` for floor pieces), `src/game/textures.ts` (an asset key in `ASSET_KEYS` plus the drawing, registered under that key), `src/game/BibliothecaScene.ts` (the wall and furniture drawing code maps a kind to its asset). Grep an existing kind such as `telescope` to see every place. Then the unit tests for decor (section 8) and the docs.

### Add or change a documented key

Update: the in-app control hints (`config.CONTROLS_HINT`, `ui/TreeView.tsx`, `ui/Hud.tsx`), file headers in `src/tree/proto.ts` and `TreeScene.ts`, `README.md`, `LOCAL-TESTING.md`, `AGENTS.md`, and the controls tables in the wiki ([Library View](Library-View.md), [Tree View](Tree-View-Yggdrasil.md), [Build Mode](Build-Mode.md), [Reader](Reader.md)).

## About this wiki

The `wiki/` folder is a set of flat Markdown pages named like GitHub wiki pages (`Home.md`, `_Sidebar.md`, `_Footer.md`), so it can be browsed in the repo or an editor, or published as the GitHub wiki by copying the folder into the `<repo>.wiki.git` repository.

- Links between pages are plain relative links with the `.md` extension, which work when browsing the folder in an editor or in the repo. Links that start with `../` (to `README.md`, `LOCAL-TESTING.md`, `tools/README.md`) work only in repo or editor view, not inside the GitHub wiki.
- Whether the `.md` form renders correctly inside the GitHub wiki itself was **not verified**. If it does not, strip the extension: `sed -E -i 's/\]\(([A-Za-z0-9_-]+)\.md([#)])/](\1\2/g' *.md` (also not run against a live wiki).
- Page names double as the sidebar entries; when you add a page, add it to `_Sidebar.md` and to the list on `Home.md`.
- Keep pages screenshot-free (the `shots/` folder is gitignored) and keep content in one place: link to `AGENTS.md` for the verified ETAPI contract instead of copying it.
