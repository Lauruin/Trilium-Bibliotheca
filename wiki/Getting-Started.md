# Getting Started

Goal: the app running in your browser, connected to a Trilium vault, in a few minutes.
There are three ways to get a Trilium to talk to; pick one.

## Where does each command run?

The project is developed inside a devcontainer that has a Docker-in-Docker (`dind`)
sidecar. [LOCAL-TESTING.md](../LOCAL-TESTING.md) tags every command block, and this wiki uses the same tags:

- **CONTAINER** - run in the devcontainer's terminal, from the project folder
  (LOCAL-TESTING.md marks these with a whale). If you do not use the devcontainer, this is simply "your terminal in the repo".
- **HOST** - run on your own machine, outside the devcontainer (LOCAL-TESTING.md marks these with a monitor).
- **BROWSER** - open a URL in your own browser (LOCAL-TESTING.md marks these with a globe).

The name `dind` only exists inside the container network. It is not a host name on your machine.

## What you need

- **Node.js** and npm. The hosted-app image builds with `node:22-alpine`, so Node 22 is what is known to work. `package.json` declares no `engines` field.
- **Docker** only if you want the disposable Trilium mock or the hosted container. Not needed for the fake (below).
- A modern browser. The **tree view needs WebGL**; the library view does not.

## 1. Clone and install

**CONTAINER**

```bash
git clone https://github.com/Lauruin/Trilium-Bibliotheca.git
cd Trilium-Bibliotheca
git checkout devbranch        # see the note below
npm install
```

Branch layout, as recorded in `AGENTS.md` (2026-10): `main` holds planning docs only
and is merged by the repository owner; `devbranch` is the integration branch where the
code lives. Check `git branch -a` if this has changed.

In the devcontainer the terminal opens in `/workspace`, which has no `package.json`;
`cd` into the project first (the `ENOENT /workspace/package.json` error means you did not).

## 2. Pick a Trilium

### Option A - the disposable mock in Docker (recommended for trying things)

**CONTAINER**

```bash
BOOTSTRAP_SERVICES=trilium tools/trilium-bootstrap.sh   # start Trilium only, set a password, mint an ETAPI token
```

This starts `triliumnext/trilium:v0.106.0` from `compose.yml`, initialises an empty
document, sets the password `biblio-test-pw` (override with `BIBLIOTHECA_TEST_PASSWORD`),
mints an ETAPI token and writes it to `.bootstrap.env` (gitignored, mode 600). Without
`BOOTSTRAP_SERVICES=trilium` the script also builds and starts the hosted-app image.

The script's defaults assume the devcontainer (`DOCKER_HOST=tcp://dind:2375`,
`TRILIUM_URL=http://dind:8080`); both are read from the environment first. Using it on a plain
Docker host would mean overriding those two variables; that path has not been tested here.

Then fill it with something to look at (it only ever touches its own top-level note):

**CONTAINER**

```bash
node tools/seed-vault.js            # "Mock Vault (medium)": ~160 themed notes, every note type
```

More profiles and the details are in [Mock and Seeding](Mock-and-Seeding.md).

### Option B - no Docker: the in-memory fake

**CONTAINER**

```bash
npm run mock:fake -- --seed medium
```

It prints `TRILIUM_URL=...` and `TRILIUM_TOKEN=...` (the login password is also `biblio-test-pw`).
Nothing is persisted; stop it with Ctrl-C. The URL is reachable from a browser inside the same
container only, not from a host browser. The fake is an ETAPI look-alike for development and tests,
not a Trilium; see [Mock and Seeding](Mock-and-Seeding.md).

### Option C - your own Trilium

Any Trilium that serves ETAPI. The app was verified against **v0.106.0**. Because the
**browser** calls ETAPI directly (there is no proxy in between), the server must allow
cross-origin requests from the app's origin (supported since Trilium v0.93.0):

```ini
# config.ini [Network] section, or the TRILIUM_NETWORK_CORS_* environment variables
corsAllowOrigin=http://localhost:5173
corsAllowMethods=GET,POST,PUT,PATCH,DELETE,OPTIONS
corsAllowHeaders=Authorization,Content-Type
```

Never point the test tools at a real vault: `tools/` creates and deletes notes
(see [Mock and Seeding](Mock-and-Seeding.md)). The app itself is read-mostly; what it writes is listed in [Trilium Mapping](Trilium-Mapping.md).

## 3. Run the app

**CONTAINER**

```bash
npm run dev          # http://localhost:5173 (port pinned, strictPort)
```

**BROWSER** - open `http://localhost:5173`. In the devcontainer, VS Code forwards that port.

### Hosted container (optional)

**CONTAINER**

```bash
docker compose up -d --build bibliotheca     # nginx serving the static bundle on port 8081
```

Reach it at `http://dind:8081` from inside the container network, or `http://localhost:18081`
from a host browser when the devcontainer sidecar publishes it (see the port table below).
The image is stateless: no volumes, read-only root filesystem. The build runs the strict
type-check, so a type error fails the image build. Without configuration it is the plain app: each
visitor enters a server + token and the browser talks to that Trilium directly, so add this app's
origin to that Trilium's `corsAllowOrigin`.

**Hosted mode (single origin).** Put variables in a `.env` next to `compose.yml` (`.env.example` lists them):
`BIBLIO_TRILIUM_URL` (where the container reaches Trilium), `BIBLIO_TRILIUM_TOKEN` (an ETAPI token; it stays
in the container), optional `BIBLIO_TRILIUM_READONLY=1`, `_ROOT_NOTE_ID`, `_NAME`, `_PUBLIC_URL`. nginx then proxies
`/etapi/` and adds the token itself, so no CORS is needed and the browser never holds a token; `/config.json`
(no secrets) tells the app, which opens with that server preselected (a server entered in Settings still wins).
Optional AI: `BIBLIO_AI_PROVIDER` (`anthropic`, default model `claude-haiku-5-5`, or `openai-compatible`),
`BIBLIO_AI_KEY`, `BIBLIO_AI_BASE_URL`, `BIBLIO_AI_MODEL`: nginx forwards only the one chat endpoint, rate limited,
with the key added server-side (no feature uses it yet). A bad value stops the container with a message
(`docker logs bibliotheca-web`). Test it: `npm run test:proxy` (builds the image, runs it against the mock; 23 checks,
`--browser` adds a real-browser pass).

## 4. First run: the settings dialog

With no stored settings the dialog "Connect to Trilium" opens by itself. Fields:

| Field | What to enter |
|---|---|
| Server URL | A URL the **browser** can reach, e.g. `http://localhost:18080` for the mock when browsing from a host browser, `http://dind:8080` only for a browser inside the devcontainer. No trailing `/etapi`. |
| ETAPI token | Optional if you give the password. From Trilium: Options, ETAPI. For the mock: `grep TRILIUM_TOKEN .bootstrap.env`. |
| Instance password | Alternative to the token; the app exchanges it for a token via `POST /etapi/auth/login`. For the mock: `biblio-test-pw`. |
| Library root note id | Default `root` (Trilium's tree root). Set another note id to build the world from a sub-tree. |

"test & save" checks `GET /etapi/app-info` with the final credentials before anything is stored.
Settings live in this browser's localStorage (`biblio.v1.settings`), including the token; read the
security summary in [Decisions](Decisions.md).

Optional defaults for the first run: copy `.env.example` to `.env.local` and set `VITE_TRILIUM_URL`
(and, if you must, `VITE_TRILIUM_TOKEN`). They only pre-fill the dialog when nothing is stored yet.
Never put a real token in a committed file.

## Ports

| Port | Service | Notes |
|---|---|---|
| 5173 | Vite dev server | `npm run dev`; pinned with `--strictPort` |
| 4173 | Vite preview | `npm run build && npm run preview` |
| 8081 | Hosted app container (`bibliotheca-web`) | nginx |
| 8080 | Trilium mock | published through the `dind` sidecar |

In the devcontainer setup the sidecar publishes them to the host as `127.0.0.1:18080` (Trilium) and
`127.0.0.1:18081` (hosted app), because 8080 is often taken on a host. Rules for that sidecar
(project name, port clashes) are in [LOCAL-TESTING.md](../LOCAL-TESTING.md) section 0.
Verify a service by content, not just a `200`: another app may own the port.

## 5. First things to try

1. The app opens in the **tree** (needs WebGL; else the library). Walk with `W`/`S`/`A`/`D`, press `3` a few times to meet the fliers, click a leaf to walk there, `E` next to one to read it. Click the glowing **wisp** on its post to search.
2. `E` at the door in the foot of the world tree walks you into the **library**: walk with `A`/`D`, press `E` at a door and at a book; `O` for the overview, then `O` again; `T` takes you back to the door.
4. `C` to capture a thought; check that an "Inbox" note appeared in Trilium.

Details: [Library View](Library-View.md), [Tree View](Tree-View-Yggdrasil.md), [Capture and PWA](Capture-and-PWA.md).
If something fails, see [Troubleshooting](Troubleshooting.md).
