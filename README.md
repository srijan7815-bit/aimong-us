# AImong Us

**Live: https://aimong-us.onrender.com** — open it on your phone, tap Install.

A private, browser-based social-deduction game where you and your friends play
alongside AI players that have their own names, personalities and (later) their
own underlying models. Friends-only: no accounts, no matchmaking, just a 5-letter
room code.

**Current build: M1 — the lobby works end to end, and it installs on your phone
as an app.** Movement, tasks, kills, meetings and the AI brains land in M2–M8
(see `PLAN.md`). The Start button says so instead of pretending.

## It's an app on your phone

Open the deployed URL in Chrome on Android → tap **Install** in the game (or ⋮ →
*Add to Home screen*). You get a pod-bot on your home screen that opens
fullscreen and talks to the Render server, reconnects after a phone lock, and
still opens (with a plain message) when you are offline or the free server is
asleep. Full steps: `DEPLOY.md`.

## Run it locally

```bash
pnpm install
pnpm -r build                       # build shared + client + server
node apps/server/dist/index.js      # serves the game on http://localhost:2567
```

Open `http://localhost:2567`, tap **Create room**, and join from a second
browser/phone with the 5-letter code.

Dev mode with hot reload:

```bash
pnpm dev        # Vite on :5173 (proxies to the API/WebSocket on :2567) + server on :2567
```

### Handy commands

| Command | What it does |
|---------|--------------|
| `pnpm test` | unit tests (shared + server) |
| `pnpm typecheck` | strict TS across the workspace |
| `pnpm --filter @aimong/server sim` | headless simulation harness (arrives M4) |
| `node --import tsx apps/server/scripts/smoke.ts` | scripted 2-client lobby test against a running server |
| `pnpm -r build` | production build |

## Host a game in 5 steps

1. Open the link, type a name, tap **Create room**.
2. Copy the 5-letter code (or tap **Share**).
3. Everyone else opens the same link and types the code.
4. The host sets seats, AI count, timers and the AI cost cap in **Match
   settings**.
5. Tap **Start game** (in this build it explains what is coming next).

## Deploy (Render, one instance)

> **Fastest path:** `GITHUB_TOKEN=… RENDER_API_KEY=… node scripts/deploy-render.mjs`
> — it creates the repo, pushes, creates the service and waits for `/healthz`.
> Manual steps (blueprint): `DEPLOY.md`.

`render.yaml` is a blueprint: **New → Blueprint** in Render, point it at this
repo, and paste these values in the dashboard when asked (never in git):

| Variable | Value |
|----------|-------|
| `PUBLIC_URL` | your Render URL, e.g. `https://aimong-us.onrender.com` |
| `OPENROUTER_API_KEY` | only when the AI brains arrive (M5) |
| `NVIDIA_API_KEY` | optional, second provider (M6) |
| `ADMIN_TOKEN` | optional, protects the `/admin` page (M5) |

State lives in memory, so the service **must stay at one instance**
(`numInstances: 1`). The free plan sleeps after ~15 minutes idle; use Starter for
game night.

## Tuning without touching code

| File | Controls |
|------|----------|
| `config/game.defaults.json` | player counts, timers, vision, AI cadence, cost cap |
| `config/personas.json` | the 12 AI personalities |
| `config/roster.json` | which models sit in which seat (`fast` vs `smart` tiers) |
| `apps/client/public/manifest.webmanifest` | app name, icons, shortcuts, fullscreen behaviour |
| `scripts/gen-icons.py` | regenerates the home-screen icons (`pnpm icons`) |
| `prompts/brain.md` | the AI system/user prompt templates |
| `.env` / Render env | `MAX_COST_USD_PER_GAME`, `MAX_ROOMS`, `LOG_LEVEL`, provider keys |

## Docs

- `PLAN.md` — architecture and game design (source of truth)
- `PROD_QUA.md` — art, audio, haptics, UX, performance, QA checklist
- `HUMANIZE.md` — how AI players are made to feel human
- `INSTRUCTIONS.md` — build order and acceptance checks
- `STATUS.md` — what is done / in progress / next / broken
- `DECISIONS.md` — every autonomous decision and why
- `RESEARCH.md`, `THIRD_PARTY.md` — licences (all original art, MIT/Apache deps)

## Licences

All art, audio, map and names are original or CC0. Dependencies are MIT/Apache-2.0.
Nothing from the commercial game is used, extracted or imitated. Full ledger in
`THIRD_PARTY.md`.
