# Bibliotheca wiki

**Bibliotheca turns your Trilium Notes vault into a place you can walk through.**
It is a standalone web app (React + Phaser + three.js) that reads your vault over
Trilium's external REST API (ETAPI) and shows it in two ways:

- **Library** - a pixel-art side-scroller. Folders are rooms, sub-folders are doors,
  labels ("tags") are bookcases, notes are books.
- **Tree (Yggdrasil)** - the same vault as a 3D tree you climb as an animal.
  Folders are branches, notes are leaves.

Status: **v0.1, a first vertical slice** (`package.json` says `0.1.0`). It is tested
against a disposable Trilium v0.106.0. Things that are only planned are marked
*(planned)* throughout this wiki; see [Roadmap and Ideas](Roadmap-and-Ideas.md).

This wiki is written for people using or hacking on the app. The agent-oriented
reference (verified ETAPI contract, gotchas, commands) is `AGENTS.md` in the repo root;
the wiki points to it instead of copying it wholesale.

## Ten-line tour

1. Open the app and enter your Trilium URL plus a password or ETAPI token in the settings dialog.
2. The **Library** loads. You stand in the room for your library root note.
3. Walk with `A`/`D` or the arrow keys, jump with `Space`, and press `E` at a door to enter that folder.
4. Press `E` at a book spine to read the note in the **reader** (fonts, papers, in-reader links).
5. The **wisp** (the search NPC) searches the vault with Trilium's own full-text search; **Socrates** is an honest "not built yet" placeholder.
6. `O` shows the **overview** of all rooms; drag a room to a new cell and the position is saved as labels on the note.
7. `B` opens **build mode**: themes, wall decor, furniture, rugs and bookcase finishes, each saved as one `biblio_*` label.
8. `C` opens **quick capture**: type a thought, `Ctrl+Enter` files it as a new note under your Inbox.
9. `T` switches to the **forest**: `1`-`4` choose an animal category (reader, crawlers, walkers, fliers), `W`/`A`/`S`/`D` move, hold `Space` to aim a jump (or take off, or reach), `X` spins silk (spiders), `B` edits the branch you stand on, `E` reads a leaf.
10. If the server is unreachable, the last tree snapshot opens instead (marked "offline").

## Where to go next

| I want to... | Read |
|---|---|
| Run it | [Getting Started](Getting-Started.md) |
| Understand the code layout | [Architecture](Architecture.md) |
| Know what Bibliotheca reads and writes in Trilium | [Trilium Mapping](Trilium-Mapping.md) |
| Learn the rooms and keys | [Library View](Library-View.md) |
| Climb the tree | [Tree View (Yggdrasil)](Tree-View-Yggdrasil.md), [Animals Guide](Animals-Guide.md) |
| Decorate rooms | [Build Mode](Build-Mode.md) |
| Read notes comfortably | [Reader](Reader.md) |
| Capture on a phone / install it | [Capture and PWA](Capture-and-PWA.md) |
| Run the tests | [Testing](Testing.md), [Mock and Seeding](Mock-and-Seeding.md) |
| Fix something that broke | [Troubleshooting](Troubleshooting.md) |
| Contribute | [Contributing](Contributing.md), [Decisions](Decisions.md), [Glossary](Glossary.md) |
| See what is planned | [Roadmap and Ideas](Roadmap-and-Ideas.md) |

## All pages

[Getting Started](Getting-Started.md) - [Architecture](Architecture.md) -
[Trilium Mapping](Trilium-Mapping.md) - [Library View](Library-View.md) -
[Tree View (Yggdrasil)](Tree-View-Yggdrasil.md) - [Animals Guide](Animals-Guide.md) -
[Reader](Reader.md) - [Build Mode](Build-Mode.md) - [Capture and PWA](Capture-and-PWA.md) -
[Testing](Testing.md) - [Mock and Seeding](Mock-and-Seeding.md) -
[Troubleshooting](Troubleshooting.md) - [Roadmap and Ideas](Roadmap-and-Ideas.md) -
[Glossary](Glossary.md) - [Contributing](Contributing.md) - [Decisions](Decisions.md)
