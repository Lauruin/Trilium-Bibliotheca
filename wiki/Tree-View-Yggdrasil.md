# Tree View (Yggdrasil)

Press `T` (or the **tree** button) and your vault becomes a **forest you climb as an animal**: the library root is a central stump, every top-level folder is its own tree of one of 13 species standing in the ground (joined to the stump by walkable ground roots; the older **hub** layout, where all trunks arch out of one stump, stays selectable with `Y`), other folders are branches, notes are leaves. It is a real 3D scene (three.js), so it **needs WebGL**; without it the
view shows "The tree view needs WebGL, which is not available in this browser." and the library keeps working.
Press `T` again (the button then reads **library**) to return. The Phaser library scene is paused while you are in the tree.

The same `LibraryTree` that builds the rooms builds the tree, so the 400-note / depth-8 walk caps apply here too. Animals have their own page: [Animals Guide](Animals-Guide.md).
The code lives in `src/tree/` (pure layout and simulation, unit-tested) plus `src/ui/TreeView.tsx`, `src/ui/BranchPanel.tsx` and `src/lib/treeedit.ts` (the branch property editor).

## Controls

| Key | Action |
|---|---|
| `W` / `S` (or `Up` / `Down`) | **Guided movement (default):** `W` walks **up the branch** (towards its tip), `S` **down** (towards its base, then onto the parent: down a trunk into the hub or onto a ground root). Fliers, the glide, silk and aiming give the keys other meanings, see below. In **free** movement (`M`): forward along your heading (S does not walk) |
| `A` / `D` (or `Left` / `Right`) | **Guided:** turn left / right on the branch as the animal sees it, in a smooth curve (`W`+`D` bends right going up, `S`+`D` right going down, `A`/`D` alone creeps round the bark; let go and it straightens along the branch). **Free:** steer the head's heading; the body trails it |
| `M` | Movement mode: **guided** (default) or **free** (the old steered heading); remembered (`biblio.v1.treeMove`), also the "move" button |
| `Space` **hold, then release** | Animals that can jump (lizard, cat, flying squirrel, **jumping spider**): **hold = aim a jump** (you stand still; `A`/`D` turn the aim, `W`/`S` raise or lower it; an arc preview and a mild auto-target show where you would land), **release = leap**, a quick tap is the plain full-power leap, `Shift` cancels. Snake and ant: **hold to reach** out past the branch. Spider: nothing on a surface (it pumps its swing while hanging on silk). Bee, dragonfly, blue jay: **take off** |
| `X` | **Spider silk** (spider and jumping spider only): on a surface, drop on a thread. Hanging: `S` lets it down, `W` reels it up, `A`/`D` swing and turn, `Space` held pumps the swing, `X` again lets go. Details in the [Animals Guide](Animals-Guide.md#spider-silk-spider-and-jumping-spider) |
| `Shift` held | **Stay on this branch** (walking up past a side branch's base does not turn you into it); at the base of a ground root or at the end of a silk thread it climbs in (those keep the old rule). While flying: bee/dragonfly fly **down**; any flier touching a branch while Shift is held **lands**; the **blue jay** goes into **landing mode** (it flares and is drawn towards a branch ahead, see the [Animals Guide](Animals-Guide.md#flight-bee-dragonfly-blue-jay)). While aiming a jump: cancels |
| `E` | Read the leaf next to you (opens the note in the [Reader](Reader.md)); works while perched or hovering within about 70 units of a leaf |
| `B` | **Edit the properties of the branch you stand on** (opens the panel, see [Editing branches](#editing-branches-b)); `B` again closes it. Does nothing on a silk thread |
| `1` / `2` / `3` | Pick an animal **category**: crawlers (ant, spider, jumping spider, snake), walkers (lizard, cat), fliers (flying squirrel, bee, dragonfly, blue jay). Press the same key again to cycle through that category |
| `G` | Grip on/off. Off means you never slip |
| `H` | Auto-align on/off (default on) - **free movement only**: gently straightens your heading along the branch while you are not steering (guided movement always straightens; the button shows "n/a") |
| `V` | Camera: chase, level, fixed (remembered) |
| `L` | Look: voxel or low-poly (remembered) |
| `Y` | Layout: **forest** (default) or **hub** (remembered; also the "layout" button). The scene rebuilds in place and keeps your branch if it still exists, else you land on the stump |
| `N` | Branch names: signs, bubbles, off (remembered) |
| `F` | Canopy foliage on/off (remembered; also a checkbox + density slider at the bottom of the `B` panel) |
| `K` | Sun shadows: off, low (1024), medium (2048, default), high (4096 map); remembered, also the "shadows" button (see [Light, shadows and scenery](#light-shadows-and-scenery)) |
| `I` | Performance panel: FPS, JS time vs frame time, draw calls, triangles, resolution, profile (quality / auto / fast), quick switches (see [Performance](#performance)) |
| `P` | Pixel mode: renders at 0.4 pixel ratio with `image-rendering: pixelated` for a chunky look |
| Mouse wheel, `+` / `-` | Zoom (factor 0.2 to 8; default 1.5) |
| `T` | Back to the library |
| `R` | Respawn - **only on the prototype page** `lizard3d.html` |

Keys are ignored with Ctrl, Meta or Alt held (browser shortcuts), while typing in an input, and while a dialog is open.

On-screen: a breadcrumb of folders from the root plus your animal ("airborne", "reaching"); a hint line that shows what applies right now ("**X** drop on a silk thread", "On a thread: S lower, W reel up, ...", "Aiming: ...", "walking up enters <folder> · hold **Shift** to stay on this branch" (roots and threads: "**Shift** climb into ..."), "**E** read <note>"); animal buttons grouped by category;
toggles for look, **layout**, **edit branch**, names, foliage, **shadows**, **move (guided / free)**, auto-align (free only) and camera; a **grip bar** that appears only while grip is on and below full (yellow, orange, red); and a one-line controls summary.

### Aiming a jump

Space is **press and hold to aim, release to leap**, for exactly the animals that can jump (lizard, cat, flying squirrel, jumping spider; the crawlers ant, spider and snake never aim). While you hold it you stand still: `A`/`D` turn the aim (up to 70 degrees either side of your heading), `W`/`S` raise or lower it (from about 20 degrees below to about 34 degrees above the default leap angle),
and the power builds from 55 % to 100 % over 0.8 seconds (a release within the first 0.18 s is simply the plain full-power leap, as before aiming existed). `Shift` cancels. A dotted arc and a reticle show where the leap would land: **white** = lands on another branch as you aimed, **green** = the **auto-target** nudged your aim to make it (mild: at most about 30 degrees sideways and 14 degrees of pitch), **orange** = it would land on nothing.
The arc is drawn with the very ballistics the real leap uses, so it does not lie. Aiming only happens standing on a surface; being airborne, reaching, flying or slipping drops it.

### Silk threads

Spiders (spider, jumping spider) spin with `X`; the thread you leave behind is a real, climbable branch (ants, bees and dragonflies can walk on threads too; the others ignore them). Threads live until you **reload the page**: they are never saved to your vault. They follow edits of the tree while the page is open (they are re-attached to the same spot of their branch), and one whose anchor is gone is skipped. See the [Animals Guide](Animals-Guide.md#spider-silk-spider-and-jumping-spider).

## Camera

**Mouse camera** (the fourth entry of the `V` cycle, remembered with the others): the camera sits at a yaw / pitch round the animal (`orbitYaw`, `orbitPitch`) with world up staying up; dragging orbits it (right button, or the left button once the pointer has moved more than 5 px: a left click that does not move walks instead), wheel / `+` / `-` zoom. It follows the animal, never goes below the ground and is pushed out of the wood of the branch you are on and its neighbours. Movement keys do not depend on where the camera looks (guided movement reads them against the branch).

- **chase** (default): behind the animal with up = the surface normal, so the view **rolls around the branch** with you.
- **level**: follows from behind but keeps the horizon level; it remembers its last yaw when the animal points straight up or down.
- **fixed**: a still camera that only tracks the animal.
- The camera never goes below the ground. Its distance scales with the animal's size (an ant is tiny, so the camera comes close).

## Mouse: hover and click to walk

Pointing at the view always shows what is under the pointer (`pick.ts`, pure, unit-tested in `tools/unit-pilot.mjs`): a ring on the spot and a tooltip with the leaf's or the branch's title. A **click** walks the animal there; a **double-click on a leaf** walks there and opens the note in the reader; `Esc`, any movement key, `Space`, `Shift` or `X` stops the walk at once and hands the keys back; a click on nothing cancels it. Fliers must land first (a perched flier walks like anyone else).

- **Picking:** the ray through the pixel is tested against every branch segment as a capsule (closest approach of two lines; a tolerance that grows with distance, about 6 px on screen, so thin far twigs can be hit) and against the leaves' positions (a leaf wins over the branch it hangs on within 30 units; bigger leaves are easier to hit). The hit is a **surface position** `(branch, s, th)`. Silk threads are not pickable.
- **The pilot** (`autopilot.ts`, pure): it presses the SAME keys a player would (W / S / A / D / Shift) along the breadth-first route over the branch tree (parent / continuation / side links; silk is never routed over), so grip, turning, junctions and auto-climb all apply unchanged. It works in guided movement; an animal in free mode is switched to guided for the walk and given back afterwards. Per hop: down to the parent with `S`; to a continuation at the end with `W` (at a fork it first turns round the bark to the side of the wanted child, because the side you stand on picks the child); to a side branch it walks up to about 70 px below where it leaves, turns round the bark to the side of the base zone (`entryTheta`: the angle where the bark is closest to the child's centreline, the very test the simulation uses), then walks up through the zone (a ground root or thread needs `Shift`, which it holds); on the goal branch it turns to the goal's side of the bark first, then walks to its arc length. While walking up past side branches it holds `Shift` (stay) so it is not pulled into one it does not want.
- **Robustness:** lining up has hysteresis (turn until close, commit to entering, only re-align when far off) and a fixed turning direction (a target on the exact opposite side of the bark has no shortest way round); while turning it counters the animal's tip-ward creep; a 8 s watchdog (no 30 px of movement) and a 120 s timeout end a walk as "failed" with a reason (`stuck`, `timeout`, `no route` for floating twigs, `that side of the bark is out of reach` for the cat, which clings to the upper half only). In random start / goal pairs on forest and hub layouts every walking animal except the cat arrives every time in the tests (14/14), the cat reaches 4/12 to 7/12 (what its cling limit allows).
- `window.__treeScene.advance(seconds)` runs the same input + simulation step without rendering (the browser test uses it: software GL renders a frame in seconds). `scene.pilot`, `scene.hover`, `scene.startPilot(goal)`, `scene.pickAtPixel(x, y)` and `scene.screenOf(point)` are the hooks.

## The world model

### Branches are rails

Each folder is a 3D centreline with a round cross-section. A surface point is `(branch, s, th)`: `s` is arc length along the centreline, `th` the angle around it with **`th = 0` the top**, plus or minus half pi the sides, plus or minus pi underneath.
A rotation-minimising frame keeps "top" on top for ordinary branches. Side branches leave their parent at `attachS`. The simulation is renderer-independent; see [Architecture](Architecture.md).

### Layout (`layoutTree`): a forest (or the hub)

Deterministic: all jitter is a hash of the note id, so the forest is stable between visits. Two modes (`LayoutMode`): **forest** (the app default) and **hub** (the original, still selectable with `Y`; `layoutTree` called without a mode builds the hub, so old callers are unchanged).
In both the library root is a **short fat stump** at the origin (length `clamp(90 + 30 x its own notes, 90, 700)`, radius `max(18, 1.1 x the thickest trunk)`, taper 0.95, oak bark; its own notes are leaves on it) and every top-level folder is **its own tree**; with no top-level folder you just see the stump.

- **Forest:** each tree stands in the ground, its trunk rising nearly vertically (a 3 to 9 degree lean) with its species' own tropism. Trees are placed around the stump deterministically: tree *i* prefers one azimuth (an even ring up to 6 trees, then a sunflower spiral) and is pushed **outwards** until its footprint (every branch point plus about 50 px for leaves and foliage) clears the stump, the crowns of the trees placed before it and the other trunks (trunks at least three trunk diameters apart; crowns may overlap by at most 60 px of the 100 px margin, so branches stay clear), so wide trees stand further out. A 400-note vault is about 1100 px across, 1500 notes about 3800; 133 one-note trees need about 4200 px because every tree also needs room for its root.
- **Ground roots:** from the base of every trunk a **root** runs along the ground to the stump: an ordinary rail (a side branch of the stump, `Branch.root = true`, id `root:<tree>`), centred just above the ground so you walk on its top and it looks part-sunk, gently undulating, thinner at the stump and widening to the trunk's radius, then sweeping up in a wide knee into the trunk so the trunk continues without a kink. Roots carry no leaves, are not editable folders (`B` does nothing on one), get no name sign, and the breadcrumb reads "&lt;tree&gt; roots". Crawlers and walkers follow them like any branch: **down a trunk, along its root, onto the stump** needs no key; **from the stump into another root** you hold `Shift` at the stump's base (the hint line offers "climb into ... roots"), exactly like climbing into any side branch; fliers just fly. Grip never drains on a root's top.
- **Hub:** each trunk starts at the stump's **end**, is fanned evenly around it (jittered) and leaves nearly horizontally (76 to 84 degrees off vertical) before **arching up** (the "root arch") over a horizontal run of `max(200, 70 per tree)` (above 30 trees a flat 2100, or whatever the trunk thickness needs), so the trunk bases are at least about three trunk diameters apart. A single top-level folder simply continues the stump upwards. You can walk down any trunk into the hub and up another one.
- **Species:** every tree (and so every branch of it) has one of **13 species** that changes how it grows and looks, see [Species](#species).
- **Folders below a trunk** are side branches of their parent, spread along its rising part and fanned around it by the species' rule (golden-angle spiral, whorls of three, or alternating sides), pitched off the parent by the species' range, and always reaching up (a minimum upward component of 0.12).
- **Thickness** depends on the notes a folder carries and how many folder levels hang below it, **not** on its own depth:
  `r0 = max(6 (11 with sub-folders), 4 + 4.6 x cbrt(notes in the whole subtree) + 3 x subfolder height)`, trunk x1.15, then times the species' `trunkR` (trunks) or `branchR` (branches). For the reference species (maple, all multipliers 1) a 2-note folder is a twig of about 10, a 20-note folder with a sub-level about 20, a 400-note trunk 45 to 60.
- **Taper:** every branch has radius `r` at its base and `rEnd` at its tip, interpolated linearly (`radiusAt`). Leaves, grip and the renderer all use the **local** radius, so branches are real tapered rails. A **terminal** branch (nothing attached: no continuing branch, no sub-folder branch on its side; not a root or the stump) ends in a **point**: `rEnd = max(1.2 px, min(0.9 r, k x r))` with `k = clamp(0.25 x species taper, 0.07, 0.15)` (pines, redwoods and cypresses are sharpest, baobabs bluntest). A branch that carries sub-folders keeps `rEnd = min(0.9 r, max(4, species taper x r))` so its children have something to grow from.
  A side branch starts at most 0.85 x its parent's radius where it grows out (floor 4.5), so it is never fatter than its parent; trunks have no such cap (the hub is derived from them).
- **Length** of a side branch = `max(140, (130 + 42 sqrt(subtree size) + 9 x own notes) x (lengthDecay^depth + 0.15) x childLen + 90 per sub-folder)`, capped at 2400; a trunk's = its rise (the same formula x1.15 x `trunkLen`, at least 180, capped at 2400) (**plus** the arch in hub mode). Sub-folders attach at least `max(170, 3.2 x thickest child radius)` apart along the parent, which grows when crowded. Leaf slots are 56 apart.
- **Ground:** the layout's `groundY` is 0. A world without one (the demo log) gets a ground well below its lowest branch.
- Clones (a folder with several parents) grow once, under their first parent; cycles are safe; the depth cap is 12 levels.

Every folder branch has eleven **editable properties** (length, thickness, taper, rotation on the parent, pitch, attach, bend, species, and the wave: amplitude, frequency, shape). The numbers above are the *calculated* values; you can override each one by hand and save it as a label on the folder note: see [Editing branches](#editing-branches-b).

### Species

13 kinds, defined as plain data in `src/tree/species.ts`. `maple` is the reference (every multiplier 1). **Bark** and **leaf colour** (used for a note without `#color` and without a tag) are what you see; the traits are the growth numbers in words.

| Species | Traits | Bark | Default leaf colour |
|---|---|---|---|
| oak | Stout, thick trunk (x1.3), shorter rise, wide-spreading crooked branches (50 to 85 degrees), droops a little | dark brown, mossy | `#3f7a35` green |
| birch | Slim and tall, steeply rising branches (22 to 42 degrees), light twigs | white with dark scars | `#b5c93a` yellow-green |
| maple | The reference: balanced, golden-angle spiral, 38 to 70 degrees | grey-brown | `#c8432a` red |
| pine | Tall, branches in whorls of three, short drooping side branches (x0.55), strong taper | very dark brown, deeply furrowed | `#2a5a30` dark green |
| willow | Long, strongly drooping branches (x1.35 long, droop 1), thin side branches | grey-green brown, mossy | `#a8c9a0` pale green |
| cherry | Wide spreading (55 to 90 degrees), medium trunk | reddish brown with pale marks | `#f2a7c3` pink |
| acacia | Short, thin trunk; long near-horizontal branches (78 to 100 degrees) attached high, alternating sides: a flat crown | tan brown | `#7d9a2e` olive |
| baobab | Enormous short trunk (x1.9, rise x0.45), few short stout branches | pale grey-tan | `#6f9a3a` green |
| redwood | Giant: very tall trunk (rise x1.8), whorls of short branches (x0.4), strong taper | red-brown, deeply furrowed | `#2d5a2f` dark green |
| aspen | Slender, nearly upright branches (15 to 35 degrees), reaches for the light | pale cream with dark marks | `#e0b33a` gold |
| ash | Medium and upright-ish, alternating branches | grey | `#6e9a3c` green |
| cypress | A narrow dark column: branches hug the trunk (12 to 28 degrees), no droop | brown | `#1f4a2e` very dark green |
| ghost | A dead tree: gnarled (sway x1.6), drooping, no reaching for the light | pale grey | `#8a8f86` grey |

**How a species is picked:** the label `biblio_species` on a folder wins (case-insensitive; unknown values are ignored). It **inherits down** to the folder's sub-folders, and a sub-folder may override it again. On the **root** note it styles the hub only (default oak).
Otherwise each top-level tree gets an automatic kind: a hash of its note id, stepped through the list so that neighbours differ, and moved on while it equals one of the **previous three** trees, so any four neighbouring trees are four different kinds (as far as your explicit choices allow). Sub-folders inherit their tree's kind.
Pick it by hand in the branch panel (`B`, "Kind of tree") or by adding the label `biblio_species` with a species name in Trilium. Adding a species: [Contributing](Contributing.md#add-a-tree-species).

### Leaves

A leaf is `{id, branchId, s, th, color, title, kind, size, type}`; layout sets `size` 1 and measured sizes arrive later.

- **Colour:** the note's `#color` if valid, else a stable colour from its first tag, else the **species' leaf colour** (a green for most).
- **Kind (shape)** by note type: `text` broad; `code` needle; `markdown` maple; `canvas`, `relationMap`, `mermaid`, `render`, `book`, `search`, `webView`, `noteMap`, `mindMap`, `geoMap` blossom; `image`, `file`, `audio`, `video`, `pdf` fruit; anything else broad.
  A `#biblio_leaf` label (`broad|needle|maple|blossom|fruit`, any case) beats the type. Trilium v0.106 sends markdown notes as type `code` with a markdown mime; the app treats those as `markdown` (see [Trilium Mapping](Trilium-Mapping.md#markdown-notes-on-a-real-server)), so they get the maple leaf.
- **Size** follows the note length on a log curve: 0 characters is 0.55, then roughly 0.85 at 100, 1.25 at 1,000, 1.65 at 10,000 and 2.0 from 100,000 on; unknown length is 1.
  `lib/leafsize.ts` measures lengths **lazily in the background** after the tree opens: 4 requests in parallel, at most 400 fetches per open, only text (visible characters), markdown and code (raw length) notes; other types keep size 1.
  Results are cached in localStorage by the note's `blobId` (a changed blob means a refetch; a note with no `blobId` is never trusted), **numbers only** - content is never kept or logged.
- Leaves stand on their folder's branch on both sides, in rows when crowded. A note can be **pinned** with the label `biblio_lat` = `s,th` (`s` = 0 to 1 along the branch, `th` = degrees around it, 0 = top); the layout reads it but there is **no editor for it yet** (you add the label in Trilium). The other leaves keep their automatic slots, so a pinned leaf may overlap one of them.

### Ground, horizon, sky

So you can always tell up from down and how high you are: a sky dome with a sun, fog in the horizon colour, a grass-and-dirt ground, rocks, bushes, far pines and a ring of mountains. Anything that falls to the ground (or misses everything)
takes a **never-fatal recovery**: it is put back on the nearest branch, or on top of where it left.

### Names (`N`)

Folder names as sprites: **signs** (a wooden board at the base of each big branch, start radius 13 or more; hidden behind bark), **bubbles** (a speech bubble over every branch, drawn over everything, like a map), or **off**.
Default is signs. Sprites keep a roughly constant on-screen size. A "labels legend" is an *open idea*, not built; see [Roadmap and Ideas](Roadmap-and-Ideas.md).

### Foliage (`F`)

Trees are not naked: a translucent, "fog-ish" **canopy** sits around the thin, outer and terminal branches, so the tips are not stumps and, from a distance, the crowns read as crowns with the wood mostly hidden.
It **fades out near you**: clusters close to the animal (and more so on the branch you stand on and the branches next to it), close to the camera, or between the camera and the animal disappear smoothly (about 0.2 s), so
you always see your branch and your animal, and the foliage around you thins out as you approach a part of the tree. The trunk and the thick limbs stay clear. The **note leaves stay readable**: a cluster that has a leaf in it is thinned.
Ground roots, silk threads and branches lying on the ground get none.

The canopy **fits the species** (colour = the species' leaf colour, a little darker than the note leaves so those stand out):
round faceted puffs for oak, maple (some orange) and ash; small light leaves for birch and aspen; stacked cone skirts for pine, redwood and cypress; hanging strands for willow; pink-and-white blossom clouds for cherry;
flat umbrella plates for acacia; a few sparse tufts at the branch ends for baobab; pale, wispy, very translucent columns for the ghost tree.
In the voxel look every shape is made of **chunky cubes** (28 to 56 units, on a grid); in the low-poly look of faceted blobs and cones.

On/off with `F` or the **foliage** button, or from the checkbox at the **bottom of the `B` panel**, where a density slider (25% to 150%) adds or removes clusters. It is a view setting remembered in the browser
(`biblio.v1.treeFoliage`, `biblio.v1.treeFoliageDensity`), never written to notes. Cost for a vault of about 100 branches: a few hundred clusters = 2 to 3 thousand low-poly pieces (2 draw calls) or up to 20 thousand cubes (1 draw call, a cap that drops whole clusters, tips first).

## Looks

Both looks are built from the same data; switching only rebuilds meshes and the simulation never notices.

| | Voxel (default) | Low-poly |
|---|---|---|
| Bark | Instanced cubes snapped to a global 7-unit grid, with streaks, darker undersides and mossy tops; branch ends taper to a single cube | 6 to 12-sided flat-shaded tubes with baked ambient occlusion, bark furrows, moss patches, scars, knots, rounded forks and sharp cone tips |
| Leaves | Voxel clusters | Faceted vertex-coloured triangles, each a little different in tint, lighter at the tip, swaying in the wind |
| Animals | Blocky: stepped boxes, same model data | Faceted tubes, blobs, cones and prisms with crisp per-face colours (see [Animals Guide](Animals-Guide.md#what-they-look-like)) |
| Ground / mountains | Tiled blocks, stepped pyramids | Rolling faceted terrain (flat under the forest), colour patches, forest floor, grass tufts, flowers, mushrooms, rocks, bushes, a pond, hills, snow-capped mountains |
| Sky | Dome + sun, cube clouds | Dome with a warm glow round the sun, flat-bottomed low-poly clouds that drift, soft vignette |
| Cost | About 3 to 5 thousand cubes per branch (instanced); a 400-note vault has about 100 branches, fine on a GPU | Far cheaper |

Both share the sky, fog, rocks, bushes and pines, the [sun shadows](#light-shadows-and-scenery) and the [foliage](#foliage-f). Why voxel is the default: [Decisions](Decisions.md) (the user now prefers the low-poly look, so that is where the polish went).

### Light, shadows and scenery

- **Light:** a warm sun does most of the lighting, a hemisphere and a little flat fill keep the shadows bluish (never black), and a weak cool light from the opposite side puts a bluish edge on the shaded flanks. Colours are tone-mapped with the "neutral" curve, which keeps the colours as authored and only rolls off the brightest sunlit faces.
- **Shadows (`K`):** real sun shadows from one shadow map that follows your animal and zooms with the camera: close up they are crisp (about 4 texels per world unit), from far away the forest in front of you still shadows. Branches, leaves, the animal, the canopy, rocks and mushrooms cast; the ground, bark, leaves and foliage receive, so a branch shades the bark below it and the leaves dapple the ground. The canopy that has faded out around you does not cast, so the wood you stand on is not darkened by invisible leaves.
  Quality: **off** (no shadow pass; a soft blob under the animal shows where you are above the ground), **low** (1024), **medium** (2048, default), **high** (4096). Remembered in `biblio.v1.treeShadows`. The shadow edge is snapped to whole texels (it does not crawl when you move) and fades out at the edge of the map instead of ending in a line.
  Cost for an 88-branch forest: about 110 extra draw calls and 100k extra triangles in the low-poly look; in the voxel look the cubes only receive and a thin invisible tube per branch casts (1.1 to 1.6 million triangles per frame instead of 2.7), so on a weak GPU switch shadows off with `K`.
- **Scenery (low-poly):** the ground is flat where trees and roots touch it (so ground roots are never buried) and rolls into hills farther out; patches of lush, olive, deep and dry grass, litter under the trees, a dirt patch round the stump, tufts, flowers in patches, red mushrooms at the trunk bases, rocks and pebbles, bushes, far pines and round trees, a small pond beyond the forest, hills, snow-capped mountains and drifting clouds. Everything is deterministic (the same forest always looks the same) and instanced (about 65 thousand triangles in 17 draw calls for the whole environment of an 85-branch forest).

## Performance

The tree view is **GPU-bound** (pixel fill and overdraw at a high pixel ratio with MSAA, about a million triangles in the voxel look, the blended foliage, a shadow map redrawn every frame), not JavaScript-bound: the JS part of a frame is a few milliseconds. So the controls are about pixels, not code (`src/tree/perf.ts`, pure and unit-tested in `tools/unit-perf.mjs`).

**Reading the panel (`I`):** *fps* and *frame ms* are the time between rendered frames; *JS ms* is how long our own code (simulation, camera, foliage, shadows and the draw-call submit) took inside a frame; if the frame is long but JS is short, the GPU is the bottleneck (the panel says so). Draw calls and triangles include the shadow pass. *Ratio* is the drawing-buffer pixel ratio actually used (the screen's ratio capped by the profile, times the adaptive scale).

| Profile | Pixel ratio | MSAA | Frame cap | Adaptive resolution |
|---|---|---|---|---|
| `quality` | up to 2 | always | none | off (the old behaviour) |
| `auto` (default) | up to 1.5 | only when the ratio is at most 1.25 | 60 fps | steps down to 0.6x while frames are slow |
| `fast` | 1 | never | 60 fps | down to 0.5x |

- **Adaptive resolution** (`AdaptiveScale`): average frame time above 21 ms for 0.7 s steps the scale down (1, 0.85, 0.72, 0.6, 0.5); a clean stretch (17.6 ms or better) for 5 s steps it back up; at most one change per 1.2 s; every upward step that has to be taken back doubles the wait before the next try (up to 80 s), so it settles instead of oscillating. At the lowest step and still slow, the panel suggests shadows off (`K`), foliage off (`F`) or the low-poly look (`L`).
- **Frame cap** (`FrameLimiter`): schedules the next frame one interval after the previous *due* time, so a 144 Hz screen under a 60 fps cap really renders 60 fps (a naive "skip if too soon" rule gives 48).
- **MSAA** cannot be switched on a live WebGL context: a profile change applies it the next time the tree view opens (everything else applies at once). The renderer is created with `powerPreference: "high-performance"` (laptops with two GPUs use the fast one), no stencil buffer, and `renderer.info.autoReset = false` so the panel counts the shadow pass too.
- **Cheaper bookkeeping:** the nearest leaf is a flat loop over positions computed once per world (`tree/leafindex.ts`), the HUD's "next to a leaf" / "Shift climbs into" hints refresh ten times a second, the foliage fade updates at 30 Hz (it eases over 0.2 s anyway), spider silk geometry is rebuilt only when `silkVersion()` changes (it used to build a signature string of every branch every frame), and rebuilds of the meshes while you drag a slider in the branch panel are coalesced (at most one per 150 ms; the simulation already runs on the newest world).
- Remembered in `biblio.v1.treePerf`. The numbers are also available as `window.__treeScene.stats` (what the browser test reads). In a headless container with software GL the frame rate is about 2 fps: that says nothing about a real GPU.

## Grip and gravity (what makes you fall)

Grip is decided by **world gravity**, not by the branch's own frame. A surface point "hangs" when its outward normal points down (`n.y` below -0.12). While hanging, grip drains by `0.58 x k^2` per second with `k = (-n.y - 0.12) / 0.88`; otherwise it refills at 0.9 per second.
Consequences you can feel:

- A **vertical trunk never drains** (its normal is horizontal all round), so you can walk straight up and down it.
- A branch leaning 15 degrees past vertical drains about 0.015 per second even on its very underside: climbable for minutes.
- A fully horizontal underside slips in about 2 seconds. Shaking and a red flash warn you before.
- Empty grip is a **slip**, never fatal: you drop and land or snap back onto a branch.
- Special cases: the snake only drains when **no part of its body** is on top; the spider and jumping spider cling and never drain; the cat stays mostly on top (a cling limit); `G` off means you never slip.

The older "I fall off the main trunk" bug came from judging "hanging" against the branch's own up axis, which is arbitrary on a near-vertical branch. Never reintroduce that.

## Steering

- **Guided movement** (default, `M` switches; `steerGuided` in `sim3.ts`): the keys are read against the **branch**, not the camera. `W` = tip-ward, `S` = base-ward, `A`/`D` = left / right as the animal sees it. The keys ask for a heading and the animal's heading eases to it with a smooth angular velocity, so turns are curves, not snaps: `W`+`D` bends right while going up, `S` swings the animal round in a short arc (over the top side of the bark, or the way you are pressing `A`/`D`) and walks down, `A`/`D` alone creeps round the bark (to the underside and back, slowly; the grip rules still apply), and letting go straightens the animal along the branch, so there is no spiral to undo. A U-turn takes about half a second (lizard 0.58 s, ant 0.32 s; `GUIDED` gain 4.2, ease 18, k 7, turnSpeed 0.35, and the chase camera follows at up to 3.8 rad/s) and the animal slows to a swivel while it turns; thin branches turn slower (the width rule below, with a gentler floor) and never let it go round the bark faster than 1.6 rad/s (slower still on a twig narrower than half the animal). Along-branch means exactly that: on a branch that points down `W` walks down the world; on a near-horizontal ground root `W` runs along it. At a tip `W` just stops; walking up past a side branch's base climbs into it (Shift = stay). Aiming, reaching, silk, flight and the glide are unchanged. Real feel needs hands on a real GPU; the numbers are in `tools/unit-move.mjs`.
- **Free movement** (`M`): the original heading steering below, unchanged.
- (Free mode) on thin branches the surface turn rate shrinks for wide animals (`turnRate x clamp(radius / (2.2 x animal width), 0.3, 1)`), so a wide animal on a twig turns gently instead of spiralling around it.
- **Auto-align** (`H`, free movement only): while moving and not pressing `A`/`D`, the heading eases towards straight along the branch (forwards, or backwards if you are walking backwards), faster on thinner branches, without overshoot. Never while reaching, airborne or flying. Off means no correction.
- **Climbing into a side branch** happens **by itself**: walking tip-ward (W) while your spot on the bark is in the zone where the side branch leaves (its "base zone": the side of the bark it grows from) turns you onto it. Walking on the other side of the bark passes it, `Shift` held means "stay on this branch", and walking down (S) never diverts you. Coming back down a branch puts you on its parent in that zone and remembers the branch (`Creature.noAuto`) until you step out of the zone, so walking on up the parent does not pull you straight back in. At a fork at the end of a branch (several continuations: the hub, the log's two forks) the child **on the side of the bark you stand on** wins and the heading only breaks ties (score `0.35 x heading + side`). **Ground roots and silk threads keep the old rule**: `Shift` climbs in (an ordinary side branch wins over a root in the same spot).
- Walking back off the base of a side branch carries you onto its parent at the spot where it grows out. The **tip** of a branch is a dead end: you stop there (only the demo log on the prototype page has branches that continue from another's end).

## Editing branches (`B`)

Press `B` (or the **edit branch** button) while standing on a branch: a panel opens for **that folder's branch** (the root's panel edits the hub). It does nothing on a silk thread. `B` again or the **✕** button closes it (pending, unsaved edits are discarded).

**The eleven properties** (`PropKey` in `layout.ts`). Each has a **calculated** value (the formulas above, modulated by the species), an optional **override** (a label on the folder note) and the **effective** value in use, `eff = override ?? calc`:

| Property | Label on the folder note | Meaning | Range (clamped) |
|---|---|---|---|
| length | `biblio_blen` | Centreline length in px (a trunk: arch plus rise) | 20 to 9000 |
| thickness | `biblio_bthick` | Start radius in px | 3 to 150 |
| taper | `biblio_btaper` | End radius / start radius (a terminal branch's calculated tip is pointed, about 0.1) | 0.05 to 1 |
| spin ("Rotation on parent") | `biblio_bspin` | **Where on the parent's circumference the branch leaves**, in degrees: 0 = on top, 90 = a side, 180 = underneath (it used to be called "spiral" / azimuth, which sounded like a factor; it is not; the label keeps its name, so saved values still work). A trunk: the direction it leans (0 = +z, 90 = +x). Wraps at 360 | 0 to 360 |
| pitch | `biblio_bpitch` | Degrees off the parent's direction (a trunk: off the hub's vertical) | 0 to 110 |
| attach | `biblio_bat` | Where it leaves the parent, 0 to 1 of its length. **Ignored for trunks** (they start at the hub's end) | 0.03 to 0.97 |
| bend | `biblio_bbend` | -1 droops, +1 lifts (a vertical offset of `0.35 x bend x length x t^2` along the branch) | -1 to 1 |
| species | `biblio_species` | Kind of tree, inherits down to sub-folders | a species name |
| wave | `biblio_bwave` | **Wave amplitude**: how far the branch swings sideways, as a fraction of its length (0.05 = 5 %); automatically reduced so the branch never leans more than 35 degrees off its line | 0 to 0.3 |
| waveFreq | `biblio_bwfreq` | **Wave frequency**: cycles along the branch (a branch holds at most one cycle per 50 px) | 0.25 to 12 |
| waveFn | `biblio_bwfn` | **Wave shape**: `none`, `sine`, `zigzag`, `sawtooth` (slow rise, quick drop), `helix` (corkscrew), `sbend` (one smooth jog to the side), `noise` (natural wobble); case-insensitive | a shape name |

A separate label, `biblio_lat`, pins a **leaf note** (see Leaves); it has no panel yet.

**Semantics that matter:**

- **A branch's calculated value never depends on its own numeric overrides**, so the panel can always show "calc 12" beside the slider and the recalculate button (↺) restores exactly that. (The species is the one input that changes the *other* calculated values; `calc.species` itself is always the automatic or inherited kind.)
- **Children grow from the effective geometry of their parent**: lengthen a branch or change its pitch and everything above it moves with it.
- **Absence means calculated.** A label exists only while the value differs from the calculated one. Setting a slider back to the calculated value, or pressing ↺, removes the label. Missing, garbage and non-finite label values are ignored; finite out-of-range numbers are clamped (`1e999` is garbage, `9999` becomes 9000).
- **`null` = force the calculated value**: internally an explicit "ignore the label" entry that the live preview uses while you have pressed ↺ but not saved yet. Absent = leave as is.
- Rotation, pitch, attach and bend of the **hub** (the stump) are ignored (it has no parent), and so is the wave; its panel only shows length, thickness, taper and kind. A trunk has no attach row and its rotation row reads "Lean direction".
- **The wave** displaces the centreline sideways, perpendicular to the branch, and is **0 at the base with a zero slope**, so it always joins its parent smoothly; the tip is free. Sub-folders and leaves follow the *displaced* centreline. The calculated default is a gentle natural wobble: amplitude `0.012 x species sway` (trunks calmer), shape `noise` (willow `sine`, baobab `sbend`, ghost `zigzag`), frequency about one cycle per 280 px. The panel shows a small sketch of the shape in true proportions, and says so when the steepness limit is reducing your amplitude.
- Every row has a one-line help (and tooltip) in the panel. **Ground roots** are not folders and have no panel.

**The panel workflow.**

1. Move a slider or pick a kind: the tree **re-lays out live** with the pending values (nothing is written yet). Rows show a **saved** badge for values that already live in a label and an **edited** (or **recalc**) badge for pending ones; **calc N** shows the calculated value.
2. **Save** writes one `biblio_b*` label (or `biblio_species`) per changed property on the folder's note, each as its own undoable edit. Values equal to the calculated one remove the label instead of writing it. "Nothing changed." if there was nothing to write.
3. **↺** next to a row: if the value is saved it is queued for removal (back to calculated once saved); if it is only edited it just discards the edit.
4. **Recalculate all** removes every saved override of this branch at once (immediately, no need to press Save).
5. **Undo** undoes the last saved label write (the one session undo journal, 50 deep, shared with [build mode](Build-Mode.md); a Save of three properties is three journal entries, so three undos).

**Safety.** The tree view writes **only your own `biblio_*` labels on the folder notes** you edit: never titles, content or structure. The write path is `lib/treeedit.ts` (`planChanges`, `saveChanges`) into `commitLabel` and `setLabel`, which refuse any name not starting with `biblio_`, touch the note's **own** labels only (never an inherited one), re-fetch the note, and compare against the cached value: if the label changed elsewhere since the tree was loaded you get "That property was changed elsewhere, reopen the editor." and nothing is overwritten.
Properties are written one by one, so a failure part-way leaves the earlier ones written (each is in the undo journal).

## Persistence

Look, camera, names, layout and foliage are stored in localStorage (`biblio.v1.treeLook`, `biblio.v1.treeCam`, `biblio.v1.treeLabels`, `biblio.v1.treeLayout` (`forest` | `hub`, default forest), `biblio.v1.treeFoliage`, `biblio.v1.treeFoliageDensity`). Silk threads exist only until the page is reloaded.
The tree view **reads** your vault and writes only what you save from the branch panel (`biblio_*` labels on folder notes, see above). Placing leaves by hand (`biblio_lat`), moving branches by dragging and re-parenting notes are *planned*, see [Roadmap and Ideas](Roadmap-and-Ideas.md).

## The prototype page

`lizard3d.html` (dev: `http://localhost:5173/lizard3d.html`; hosted: `/lizard3d.html`) runs the same scene on a hand-made demo log, **without Trilium**. Add `?vault` to lay out a synthetic vault (random folders, note types and lengths) through the real `layoutTree`; extra parameters: `&layout=hub|forest` (default forest, not the stored preference), `&trees=N` (top-level folders), `&depth=D` (folder levels; keep it at 1 or 2 for software-GL screenshots), `&wave=fn:amp:freq` (for example `helix:0.06:3`, a wave on every folder). `R` respawns. It is also what `tools/tree-shots.js` photographs; see [Testing](Testing.md).
