# The Hollow Below

A first-person pixel horror game about exploring a cave. Your rope snapped, the team that came before you is gone,
and something in the dark sees your light. Find their four tapes and a way back to the sky.

**What is inside:**

- **Game (frontend)** — React + TypeScript page with a 3D cave drawn by three.js. The cave is built from code
  (no model files): rooms and tunnels in `frontend/src/features/cave/caveLayout.ts` become a rock/air grid and then a
  mesh. Everything is rendered at low resolution with dithering, film grain, and a fear effect. All sounds are made in
  code with the Web Audio API.
- **Backend** — Python aiohttp server with a SQLite file. It saves every finished run (died or escaped, tapes found,
  time) and shows the totals on the title screen.
- **Tests** — backend tests, frontend unit tests, and Playwright browser tests that walk through the real cave.

### How to play

| Key | Action |
|-----|--------|
| W A S D | walk |
| Mouse | look around (click the game to lock the mouse) |
| Shift | run — loud, the monster can hear it |
| C | crouch — quiet, fits through the low crawlspace |
| F | flashlight on / off — it sees your light from far away |
| E | take a tape recorder, batteries, or glowsticks |
| G | throw a glowstick — its noise pulls the monster away from you |
| Space | jump |
| Esc | pause |

Shine the flashlight right in its face from close up for about a second and it runs away — but that costs battery,
and every time it gets a little more used to the light. Far away it does not charge at once: it stalks you from the
dark and strikes when you turn your back.

### Where to change things

| What | File |
|------|------|
| Rooms, tunnels, items, lights, tape texts | `frontend/src/features/cave/caveLayout.ts` |
| How twisty and wide the tunnels are | `frontend/src/features/cave/tunnels.ts` |
| Rock shapes, bumpiness, collision | `frontend/src/features/cave/caveGrid.ts` |
| Player speed, flashlight, story events, monster movement | `frontend/src/features/cave/game.ts` |
| Monster senses and decisions | `frontend/src/features/cave/creatureBrain.ts` |
| Monster body and how it walks | `frontend/src/features/cave/creatureModel.ts`, `creatureGait.ts` |
| The giant skeleton | `frontend/src/features/cave/giantSkeleton.ts` |
| Pixel look, lighting, fog | `frontend/src/features/cave/shaders.ts` |
| Rock texture and wall writing | `frontend/src/features/cave/textures.ts` |
| Sounds | `frontend/src/features/cave/audio.ts` |
| Menus and HUD | `frontend/src/pages/GamePage.tsx` |
| Saved runs (API + SQL) | `backend/http/routes.py`, `backend/db/runs.py` |

---

## Words you will see in this guide

| Word | What it means |
|------|---------------|
| **terminal** | A text window where you type commands. On Mac it is called Terminal, on Windows it is called Command Prompt or PowerShell. |
| **git** | A tool that downloads and tracks code. Every command starts with `git`. |
| **npm** | Node Package Manager — downloads JavaScript libraries that the frontend needs. |
| **uv** | A tool that downloads Python libraries that the backend needs. |
| **make** | A shortcut tool. `make setup` is just a shorter way to run several commands at once. |
| **uv run** | Runs a Python command inside the project's own Python environment. |
| **localhost** | Your own computer. `http://localhost:5101` means "open port 5101 on my own machine". |

---

## Project folders

```
Cave_explorer/
├── backend/              ← Python server code (saved runs)
│   └── db/               ← Database (SQLite) code
└── frontend/             ← React app
    └── src/features/cave ← the game itself
```

---

## Before you start — check your tools

Do this once on a new machine before cloning anything.

### Check uv (Python package manager)

```bash
uv -V
```

If you get "command not found", install it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then install a fresh Python:

```bash
uv python install 3.14
```

### Check npm (JavaScript package manager)

```bash
npm -v
```

If you get "command not found", install Node.js via nvm:

```bash
# Install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
# Load nvm without restarting the terminal:
. "$HOME/.nvm/nvm.sh"
# Install Node.js:
nvm install 26
```

---

## First-time setup

Do this once when you first clone the project.

### Step 1 — Download the project

Open a terminal and download the repository (put your GitHub login and project name).
Repository names must use only lowercase letters, numbers, and hyphens, for example `cave-explorer` — this name
becomes your app address on tlfpaas.

```bash
git clone https://github.com/your-login/your-project.git
cd your-project
```

`git clone` copies the project to your computer. `cd your-project` moves into that folder.

### Step 2 — Install everything

The easiest way (one command does it all):

```bash
make setup
```

That is it. `make setup` installs the locked Python and JavaScript libraries, installs Chromium for tests, and creates the local config files `.env` and `.docker.env`. It also creates `.agent.env` for coding agents.

<details>
<summary>What does make setup do exactly? (click to expand)</summary>

If you are curious, it runs these steps one by one:

```bash
uv sync --all-groups       # installs Python libraries
cd frontend
npm ci                     # installs the locked JavaScript libraries
npx playwright install chromium # installs the browser for end-to-end tests
cd ..
cp .env.example .env
cp .docker.env.example .docker.env
cp .agent.env.example .agent.env
```

You do not need to run these yourself — `make setup` does it for you.
</details>

---

## Running the app in development

All local app settings live in the root `.env` file.
Change ports, hosts, LAN settings, and local e2e settings there.
Do not edit the `Makefile` or frontend config files for that.

You need **two terminals** open at the same time — one for the backend, one for the frontend.

### Terminal 1 — start the backend (Python server)

```bash
make back
```

The backend will be available at `http://localhost:3101`.

> **With auto-reload:** `make back` already watches for file changes. If you want to run it without auto-reload, use `uv run python -m backend.main`.

### Terminal 2 — start the frontend (React app)

```bash
make front
```

The frontend will be available at `http://localhost:5101`.

Open `http://localhost:5101` in your browser to see the app.

### Backend logs

The backend prints useful startup, request, and saved-run logs to the terminal.
If you want quieter backend logs, set this in `.env`:

```env
APP_DEBUG_LOGS=0
```

### Share the app on the same Wi-Fi

If you want to test the app from another phone, tablet, or laptop on the same Wi-Fi, use the LAN commands instead of the normal localhost commands.

In one terminal:

```bash
make back-lan
```

In another terminal:

```bash
make front-lan
```

To open the correct Wi-Fi URL on this Mac:

```bash
make open-lan
```

In LAN mode, the app uses these ports:

- frontend: `http://<wifi-ip>:5104`
- backend: `http://<wifi-ip>:3104`

Important notes:

- Open the real Wi-Fi IP, not `0.0.0.0`.
- This helper is for macOS and expects the Wi-Fi interface to be `en0`.
- If the Wi-Fi IP cannot be found, use the normal localhost commands instead.
- Use this only on a trusted local network.

---

## How the frontend talks to the backend

`make front` reads the backend URL from the root `.env` file and passes it to Vite automatically.

> **Important:** Use the root `.env` file as the single source of truth for local ports and local URLs. Do not switch to editing `frontend/.env.*`, `Makefile`, or Playwright config files.

In LAN mode, use the same Wi-Fi IP on both sides:

- frontend URL: `http://<wifi-ip>:5104`
- backend URL: `http://<wifi-ip>:3104`

---

## Adding a new library

### Python library (for the backend)

```bash
uv add package-name
```

For a library only used in development (like a testing tool):

```bash
uv add --dev package-name
```

### JavaScript library (for the frontend)

```bash
cd frontend
npm install package-name
```

For a library only used in development:

```bash
cd frontend
npm install -D package-name
```

> Do not edit the dependency files by hand. Use these commands instead — they also update the lock files automatically.

---

## Running tests

### Backend tests

```bash
uv run pytest
```

### Frontend unit tests

```bash
cd frontend
npm test
```

### End-to-end tests (browser automation)

```bash
cd frontend
npm run test:e2e
```

Playwright opens Chromium, enters the cave, walks down the first tunnel, takes a tape, gets caught by the monster, and checks that the run was saved.

### Run all tests at once

From the project root:

```bash
make test
```

This runs Ruff, backend tests, Oxlint, the production frontend build (including TypeScript checks), frontend unit tests, and browser tests.

---

## Formatting code

Formatting makes code look consistent (correct indentation, spacing, etc.).

Python:

```bash
uv run ruff format .
```

Frontend:

```bash
cd frontend
npm run format
```

Or both at once:

```bash
make format
```

---

## Useful make shortcuts

| Command | What it does |
|---------|--------------|
| `make setup` | First-time install of everything |
| `make back` | Start backend with auto-reload |
| `make back-once` | Start backend without auto-reload |
| `make front` | Start frontend dev server |
| `make open` | Open the app in the browser |
| `make format` | Format all code |
| `make test` | Run all tests |
| `make test-e2e-docker` | Run browser tests against Docker containers |

---

## Updating dependencies

Normal update (stays within the version ranges in `pyproject.toml` and `frontend/package.json`):

```bash
make deps-update-safe
```

To also move frontend libraries to their latest stable major versions:

```bash
make deps-update-latest
```

Both commands keep the explicit Python version bounds. To change a Python major version, use `uv add 'package-name>=new-version,<next-major'` (or `uv add --dev` for a development tool) and review the release notes.

The frontend uses TypeScript 7 and Oxlint. Oxlint has built-in TypeScript and React Hooks rules, so it does not need a separate ESLint parser. Prettier formats code. Run `cd frontend && npm run lint` for a quick lint check.

After updating, always run tests to make sure nothing broke:

```bash
make test
make test-e2e-docker
```

---

## Deploy to tlfpaas

Your app goes online at `https://<project>.tlfedu.tech` through [tlfpaas](https://deploy.tlfedu.tech/guides/students/start).

1. Push your code to GitHub. **Every push starts a new deploy**, so run `make test` before `git push`.
2. Open https://deploy.tlfedu.tech/my/projects and wait until the deploy says `success`.
3. Open your app. The game needs no secrets: it has no accounts.

If something breaks, read the deploy log on the dashboard and the app logs at https://logs.tlfedu.tech.

---

## App icon

The app icon is `frontend/public/icon.svg`. When you know what your app is, ask your coding agent to draw a new icon
for it (the agent instructions are in `frontend/icon/AGENTS.md`), then make all phone and browser icons from it:

```bash
cd frontend
npm run icons
```

---

## Docker (optional, for deployment)

Docker packages the app into containers so it runs the same way everywhere.
You do not need Docker for local development. Use it when you want to test the production-style container setup or deploy to `tlfpaas`.

All Docker and Dokploy settings live in the root `.docker.env` file.
Change Docker ports, Docker URLs, Docker project names, and Docker e2e settings there.
Do not edit `docker-compose.yml` or the Dockerfiles for normal student configuration.

Quick local browser test with Docker:

```bash
make front-docker
make open-docker
```

Open in browser:
- App: `http://localhost:5105`
- Health check through the local gateway: `http://localhost:5105/api/health`

`make front-docker` starts a small local gateway so the browser uses the same path-based contract as production:

- `/api/*` -> backend
- everything else -> frontend

If you want only the backend container running for debugging, you can still use:

```bash
make back-docker
```

Stop and remove containers:

```bash
make stop-docker
make clean-docker
```

Run browser e2e tests against the Docker stack:

```bash
make test-e2e-docker
```

---

## Security notes (for learning)

- The game has no accounts and stores no personal data. The backend saves only: died/escaped, tapes found, seconds.
- `/api/runs/finish` checks every value and rejects posts from other websites (Origin check), so the numbers stay sane.
- Anyone who plays can still send a fake run with their own browser; the stats are for fun, not a secure leaderboard.

---

## Production deployment

This project is designed for [Dokploy](https://dokploy.com/) with Docker Compose.
The root `.docker.env.example` file shows the same variable set that Dokploy should provide.
Set these values in Dokploy instead of editing `docker-compose.yml`:

| Variable | What it is |
|----------|------------|
| `COMPOSE_PROJECT_NAME` | Docker Compose project name for the normal app stack |
| `DB_PATH` | SQLite path inside the backend container |
| `FRONTEND_ORIGIN` | Public URL of the app, e.g. `https://myapp.example.com` |
| `VITE_BACKEND_URL` | Frontend API base path for the built app; keep it at `/api` |
| `APP_MODE` | `prod` for production, `dev` for local work |

Important notes:

- Production requires `APP_MODE=prod` and an HTTPS `FRONTEND_ORIGIN`.
- The frontend API base path is still a build-time value. If `VITE_BACKEND_URL` changes, rebuild the frontend image.
- Internal container ports stay fixed at `8080` and `8081`.
- Keep `VITE_BACKEND_URL=/api` in both local Docker testing and production.
- The base `docker-compose.yml` is intentionally platform-safe for `tlfpaas`: it uses `expose`, route labels, and no local-only port publishing.

### Start the Docker stack

With `.docker.env` filled in, this is enough to boot the stack:

```bash
docker compose --env-file .docker.env -f docker-compose.yml up -d --build
```

That starts the frontend and backend containers. It does not add public one-domain routing by itself.

For local same-origin browser testing, the repo also includes `docker-compose.local.yml`, which adds a small gateway service and the local frontend build arg. The visible `make front-docker` and `make test-e2e-docker` commands use that local overlay automatically.

### Recommended production routing

Use one public origin and route by path:

- `/api/*` -> backend
- everything else -> frontend

This keeps the production app same-origin, so no CORS setup is needed.

In `tlfpaas`, the platform does this routing for you by looking at `tlfpaas.route` labels in the base `docker-compose.yml`.

If nginx or Traefik is on the same Docker network, it can route to:

- `frontend:8080`
- `backend:8081`

### Route roles for other app shapes

- Fullstack app: use `frontend` plus `backend`
- Single-service web app: one service with `tlfpaas.route=web`
- Backend-only public app: one service with `tlfpaas.route=backend`, serving only `/api`
- Worker or bot: no `tlfpaas.route` label

---
