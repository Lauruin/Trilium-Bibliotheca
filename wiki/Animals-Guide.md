# Animals Guide

You climb the [tree](Tree-View-Yggdrasil.md) as one of **ten animals**, grouped into three categories on the number keys. An animal is *data* (an `Animal` spec in `src/tree/sim3.ts`), not code: a steered head, a body that trails it along its recorded path, procedurally placed feet and a few ability flags.
You start as the lizard each time you open the tree; the choice is not remembered between visits.
How each animal **looks** is data too (`src/tree/animalmodels.ts`, drawn by `src/tree/creatures.ts`); see [What they look like](#what-they-look-like).

## Categories and the number keys

| Key | Category | Cycle order (press the key again for the next one) |
|---|---|---|
| `1` | **Crawlers** | ant, spider, jumping spider, snake |
| `2` | **Walkers** | lizard, cat |
| `3` | **Fliers** | flying squirrel, bee, dragonfly, blue jay |

Pressing a category key while you are an animal **outside** that category picks its first animal; pressing it while you are **in** it picks the next, wrapping around (`animalForKey` in `sim3.ts`). Any other number does nothing. The on-screen animal buttons do the same job by mouse.
Switching respawns you on the same branch at the same spot (on top), and keeps your grip, auto-align and movement-mode settings. The "fliers" category includes the **flying squirrel**, which glides rather than flies freely. **Crawlers cannot jump** (ant, spider, snake) except the **jumping spider**.

## The ten at a glance

Sizes and speeds are in world units after the per-animal scale in `ANIMALS` (the lizard x1.7, snake x1.5, ant x0.55, cat x1.9, squirrel x1.7, spider x1.6, bee x1.1, dragonfly x1.1, blue jay x1.6, jumping spider x1.12); body length is the trail length of the body nodes. For scale: a twig branch is about 10 thick, a mid branch about 20, a trunk 45 to 60.

| Animal | Category | Size class | Body length | Walk speed | Abilities |
|---|---|---|---|---|---|
| Ant | Crawlers | tiny | ~13 | 39 | Smallest; turns fast (3 rad/s); **cannot jump**; hold `Space` to **reach** a short way (~72) to bridge a twig gap; fits twigs; can walk on silk threads |
| Spider | Crawlers | small | ~50 | 136 | Eight legs, high knees; **clings**: never loses grip, even fully underneath; **cannot jump**; spins **silk** (`X`: drop, swing, climbable threads) |
| Jumping spider | Crawlers | small | ~34 | 106 | Dark body with an orange-red abdomen; **clings**; the one crawler that **jumps** (strong for its size, about 20 body lengths on the flat) with the full aim; also spins silk (a shorter rope) |
| Snake | Crawlers | very long | ~945 | 165 | **Cannot jump**; hold `Space` to **reach** (up to ~645) as a living bridge; judged by its whole body for grip |
| Lizard | Walkers | large | ~286 | 221 | The all-rounder; normal leap, aimed |
| Cat | Walkers | large | ~253 | 323 | Fastest walker, strongest leap (aimed); **mostly stays on top** (a cling limit of about 69 degrees from the top) |
| Flying squirrel | Fliers | medium | ~153 | 238 | Aimed like the others, but every leap is a **glide** you can steer, dive and flare |
| Bee | Fliers | tiny | ~25 | 50 | **Hover flight** (top speed ~231), lands by touching bark; walks slowly |
| Dragonfly | Fliers | small | ~61 | 55 | **Hover flight**, faster and darting (top ~363); lands by touching bark |
| Blue jay | Fliers | medium | ~125 | 224 | **Wing flight**: always moves forward, trades height for speed; two feet; lands with `Shift` (**landing mode** steers it towards a branch) |

(Numbers are derived from the specs in `sim3.ts` and rounded; treat them as relative sizes, they are tuning values that may change.)

## What they look like

Every animal is drawn in both [looks](Tree-View-Yggdrasil.md#looks) from the same model data: in the **low-poly** look (the one to prefer) bodies are faceted tubes with crisp per-face colours and parts are faceted blobs, cones and prisms; in the **voxel** look the same model is built from stepped boxes. All animals stand on **procedural legs** that follow the sim's feet (two-bone IK, so a leg keeps its length: knees, ankles, paws and toes bend and lift as the feet step), and a pale rim keeps the silhouette readable against bark. Idle animals breathe, turn their head, blink and sway their tails; walkers wiggle (snake and lizard undulate while they move), and leaping animals stretch their legs out.

| Animal | Look |
|---|---|
| Ant | Three clear parts: dark head with two small eyes, hooked antennae and little mandibles; a rust-brown thorax; a big dark gaster behind a thin waist. Six thin three-segment legs with high knees. |
| Spider | Brown cephalothorax with a cluster of eyes, fangs and palps; a big ovoid abdomen with pale chevrons; eight long, jointed legs with a high knee and a short tarsus, banded joints. |
| Jumping spider | Dark, compact body with two **big forward eyes** (with a glint), smaller eyes above and a white-fuzz face; an **orange-red abdomen** with a dark stripe; shorter, thicker legs with pale joints. Stretches its legs when it jumps. |
| Snake | A long tube of diamond blotches on tan with a cream belly; a flat wedge head with gold slit eyes and a **forked tongue that flicks**; the body **slithers** in an S wave while it moves and sways a little when idle. |
| Lizard | Green with dark saddle bands, a spiky dorsal crest, a banded tail that sways and wiggles; wedge head with gold eyes and a forked tongue; sprawled four-toed legs, belly close to the bark. |
| Cat | Orange tabby: dark stripes, a cream chest and belly, a ringed tail that is **held up and sways**; round head with pointed pink-lined ears (that twitch), green eyes with slit pupils, a pink nose and whiskers; taller, straighter legs with cream paws. |
| Flying squirrel | Grey-brown with a cream belly, a big bushy raised tail with a dark-ringed tip, big dark eyes with a glint, round ears and whiskers; **glide membranes** spread between the front and hind legs while it glides (legs stretched out wide, tail streams back). |
| Bee | Yellow-and-black banded abdomen with a sting, fuzzy thorax, big dark eyes and antennae; two pairs of translucent wings, folded back when perched and beating while it flies; the abdomen droops a little in flight. |
| Dragonfly | A long, slender, segmented blue abdomen, a green thorax, huge blue compound eyes; four long translucent wings with a dark mark: held **out flat** when perched, beating in alternating pairs in flight. |
| Blue jay | Blue back with a **swept-back crest**, a white face and belly, a black collar and a dark beak; a barred blue-black-white tail fan; wings of two panels (arm and hand) with black bars and white tips: folded while perched, **flapping with the `Space` effort** and held out when it glides; two thin feet (not shown in flight). |

## Controls common to all

`W`/`S` walk up / down the branch, `A`/`D` turn left / right on it (guided movement, the default; `M` switches to the old free mode: forward along your heading, steer the head), `Space` (hold to aim, release to leap; or the special action below), `X` silk (spiders), walking up past a side branch's base climbs into it by itself (`Shift` held = stay on this branch), a mouse click walks to that spot (double-click a leaf to read it), `E` reads the leaf next to you, `B` edits the branch you stand on, `G` toggles grip, `H` toggles auto-align (free mode), `M` guided / free movement.
Full table: [Tree View](Tree-View-Yggdrasil.md#controls).

## Mechanics

### Walking, aiming and steering

You steer the **head**; the body follows. **Guided movement (default):** `W` walks up the branch, `S` down, `A`/`D` turn left / right as the animal sees it; the heading curves smoothly towards what the keys ask for and straightens along the branch when you let go, so you cannot spiral around a branch by accident (`S` swings the animal round in about a second; `A`/`D` alone creeps round the bark when you want the other side). **Free movement** (`M`): the heading is the angle between your direction of travel and the branch: 0 walks straight along it, anything else spirals around it; on thin branches wide animals turn more gently, and **auto-align** (`H`) eases the heading straight again when you let go of `A`/`D`.
A leap goes **relative to the surface**: away along its normal plus forward, so it feels the same from the top, the side or the underside.

**Aiming (lizard, cat, flying squirrel, jumping spider).** Hold `Space` to aim and release to leap. While you hold it you stand still; `A`/`D` turn the aim (up to 70 degrees each side of your heading), `W`/`S` raise or lower it, and the power rises from 55 % to 100 % over 0.8 seconds (a quick tap is the plain full-power leap). A dotted **arc preview** with a reticle shows the landing: white = lands on a branch, green = the **auto-target** helped, orange = lands on nothing.
The auto-target is always on and mild: when your aim would miss every other branch it searches a small cone around it (about 30 degrees sideways, 14 degrees of pitch) for an arc that lands, and never onto your own branch or the ground; keep steering and the cone follows you. `Shift` cancels the aim. The preview uses the same physics as the real leap, so what you see is what you fly.
The ant, spider and snake never aim (they cannot jump); the fliers use `Space` to take off.

Misses are never fatal: if you hit nothing within a short time (2.2 s; 7 s for gliders), or fall to the ground, you are put back on the nearest branch within reach (or on top of where you left).

### Grip by gravity

Hanging on a surface whose normal points down drains the grip; the top refills it. A vertical trunk never drains, a lightly overhanging branch drains very slowly, a full underside slips in about 2 seconds. The grip bar appears when it is below full, the animal trembles and flashes red when a fall is near, and a slip is a never-fatal drop.
Per animal: the **snake** (`bodyGrip`) only drains when **no sampled part of its body** is on top; the **spider and jumping spider** (`clings`) never drain; the **cat** simply avoids the underside. `G` turns slipping off altogether. Fliers do not use grip while flying. Details and numbers: [Tree View](Tree-View-Yggdrasil.md#grip-and-gravity-what-makes-you-fall).

### Reach (snake and ant)

The two crawlers that cannot jump bridge gaps by stretching. Hold `Space`: the head stretches out past the branch (snake: about 255 units/s up to about 645 units; **ant: about 72 units/s up to about 72**, the base 130 scaled with the animal, enough for a twig gap of about 50) and then **holds there**. While you hold, `A`/`D` yaw the stretching head and `W`/`S` pitch it.
If the head touches another branch it **bridges** onto it and you carry on from there. If you release without contact it **retracts** (faster than it stretched). Stretched out, grip refills while some part of the body is on top and drains slowly (0.32 per second) when none is; when it runs out you fall (never fatally) and are recovered. The ant's whole body leaves the branch when it reaches, so it holds on by the spot it stretched out from. In the voxel look all creatures are drawn a little higher (the bark blocks stick out past the true surface), so the ant no longer sinks into the blocks.

### Spider silk (spider and jumping spider)

`X` on a surface drops you on a **silk thread**: a rope from where you stand, with the spider hanging under its anchor like a pendulum (it can slide over the edge of a branch top as the rope is let out). While you hang:

- `S` **lets the rope out** (spider about 96 units/s, up to about 480; the jumping spider about 67 units/s, up to about 336; never closer than 10 units to the ground),
- `W` **reels it in**, 1.3 times faster; fully reeled in you are back on the anchor and **no thread is kept**,
- `A`/`D` **swing** sideways and turn your facing,
- `Space` **held pumps** the swing along your facing,
- `X` again **lets go**: an ordinary fall (never a glide).

If you touch a branch while hanging or after letting go, you **land** there and the rope becomes a **bridge**; if you let go in mid-air the thread stays as a **free thread**. Either way it is now a real branch (radius 2.5) you can walk and climb: off its start you step onto its anchor branch, off its end onto the branch it ends on, and `Shift` near either end climbs onto it (threads and ground roots keep the Shift rule).
**Who can use threads:** the clingers (spider, jumping spider) and every animal with a half-width of 6 or less (ant, bee, dragonfly). The lizard, cat, snake, squirrel and jay ignore threads completely (they pass through them). Threads exist **until you reload the page**; they are never written to your vault. They follow edits of the tree while the page is open.

### Glide (flying squirrel)

Any `Space` leap becomes a long, slow-falling glide (gravity x0.22, a gentle terminal fall speed). In the air `A`/`D` bend the flight, `W` **dives** (faster horizontally, up to 1.4x the leap speed, steeper) and `S` **flares** (slows to about 0.55x, floatier). A glide may last up to 7 seconds before the missed-everything recovery. It lands automatically on any branch it touches. Users reported this as the most fun animal.

### Flight (bee, dragonfly, blue jay)

`Space` on a branch **takes off**: a hop along the surface normal. While airborne the animal has no perch and no grip.

**Hover fliers (bee, dragonfly)** fly where they point.

- `W` forward, `S` backward at half speed, `A`/`D` yaw.
- `Space` **held** goes up, `Shift` **held** goes down.
- Velocity eases to your input, so you stop within about a second of letting go. The bob you see is cosmetic.
- **Landing:** touch any branch and you land (`autoLand`), or hold `Shift` while touching.
- A perched bee or dragonfly just walks, slowly.

**Wing flier (blue jay)** never hovers.

- It always moves **forward**. `W` **dives** (pitches down, gains speed), `S` **climbs** (pitches up, loses speed); pitch is limited to plus or minus 55 degrees and eases back to a level glide when you release.
- Speed follows an energy model: diving builds speed (up to the top speed in about two seconds), climbing bleeds it towards the stall speed, and **below the stall the nose drops**. Holding `Space` **flaps** for extra thrust and a little lift.
- `A`/`D` bank-turn; turns are wide when fast and tighter when slow.
- **Landing:** touching bark at cruise speed does *not* land the jay: it is pushed off along the surface normal (never through the bark). The perch it took off from only lands it after it has cleared it.
- **Landing mode (hold `Shift`):** the jay flares (slows to about 1.15 times its stall speed, no nose-drop) and levels out, and a **target magnet** picks the best spot on a branch within about 400 units and 45 degrees of its heading (nearer, upper half of the branch preferred) and steers towards it; a green reticle marks the target. `A`/`D` still steer and win over the magnet. Touching a branch then lands it; touching one while slower than 1.4 times the stall speed also lands it without `Shift`. Perched, the jay stands on its two feet.

A flier whose grip ran out (a slip fall) can press `Space` to open its wings while it falls. All fliers: never below 15 units above the ground, and a free-flight step is sub-stepped at 20 ms or less so a fast flier cannot skip through a twig. While flying you can still press `E` near a leaf to read it.

## Tips

- **Crossing a gap between branches:** the snake and the ant bridge it with `Space` (the ant only short gaps); the cat leaps furthest; the jumping spider jumps far for its size; the squirrel glides; any flier just flies; a spider can swing across on silk.
- **Aiming:** a green reticle means the auto-target found a landing; if it is orange, turn or tilt until it is white or green, then release.
- **Underneath a branch:** the spiders hang for free. For others, `G` off lets you explore the underside without slipping, or keep moving; the snake is safe while any part of it is on top.
- **Climbing a trunk:** any animal can walk straight up a vertical trunk without slipping. Walking up past a side branch's base turns you onto it by itself when you are on the side of the bark where it grows; hold `Shift` to stay on the trunk. The on-screen hint tells you what the branch ahead will do.
- **Between trees (forest layout):** crawlers and walkers can walk down a trunk, along its **ground root** and onto the central stump with no extra key; to go from the stump into another root hold `Shift` at the stump's base (the hint line offers it), then walk up that trunk. The cat clings only to the top half of a branch, so it can't stand on every side of the stump. Fliers just fly between the trees. See [Tree View](Tree-View-Yggdrasil.md#layout-layouttree-a-forest-or-the-hub).
- **Small animals on thin branches:** the ant and the spiders fit twigs that make a lizard swivel slowly. In guided movement a fat animal on a twig turns more slowly (it never corkscrews); in free movement leave auto-align on.
- **Scouting the whole tree:** zoom out (`-`) and take the jay, or the dragonfly for precise hovering. Press `N` to show branch names while you fly.
- **Landing a jay:** line it up gently over a branch, hold `Shift` (landing mode) and let it touch.
- **Reading from the air:** hover next to a leaf and press `E`.

## Related

[Tree View (Yggdrasil)](Tree-View-Yggdrasil.md), [Contributing](Contributing.md#add-an-animal) (how to add one), [Roadmap and Ideas](Roadmap-and-Ideas.md) (animals by zoom level, unlockable animals: planned, not built).
