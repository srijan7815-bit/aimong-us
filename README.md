# AImong Us

**Live: https://aimong-us.onrender.com** — open it on your phone, tap Install.

A private, browser-based social-deduction game where you and your friends play
alongside AI players that have their own names, personalities and (later) their
own underlying models. Friends-only: no accounts, no matchmaking, just a 5-letter
room code.

**Current build: M3.5 — a full round of the game, with every role and feature,
and it installs on your phone as an app.** Roles (Patch / Watcher / Warden /
Shifter), task categories and stages, meetings and voting, station tools, five
sabotages, free-roam practice and cosmetics all work. The AI brains land in M4–M5
(see `PLAN.md`); for now AI seats stand still, and the Start button says so
instead of pretending.

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

1. Open the link, type a name, pick a hat if you like, tap **Create room**.
2. Copy the 5-letter code (or tap **Share**) — everyone else types it on the home
   screen.
3. The host sets seats, timers, task counts and role chances in **Match settings**
   and **Tasks & roles**; the lobby shows what the table would deal.
4. Everyone taps **Ready**, the host taps **Start game**.
5. In the round: drag to walk, tap **Use** at a console, **Report** a body, and the
   **Emergency** button in the Galley. **Practise alone** on the home screen gives
   you a solo station with every console live.

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

## Play it

- **Android app:** [download the APK](https://github.com/srijan7815-bit/aimong-us/releases/download/v0.1.2-android/aimong-us-0.1.2.apk),
  install it (allow "install unknown apps"), open **AImong Us**.
- **In a browser:** https://aimong-us.onrender.com
- **The Commons (owner console):** https://aimong-us.onrender.com/console — the AI
  cluster's home ground. Broadcast a message to every resident, then paste the room
  code from the app to send them in as players.

Rebuild the APK: `bash scripts/build-apk.sh` (needs JDK 21 + Android SDK; CI does it
for you on every push that touches the client).

## Keeping the free server awake (optional)

The free Render plan sleeps after ~15 minutes with no traffic; the first open then
takes 30–60 s while it boots. The app already shows "Waking up the station…" and
retries, so nothing breaks — it is just slow.

There is deliberately **no ping code in this repo**. If you want the instance warm
on a game night, point an external uptime pinger at the health endpoint:

| Setting | Value |
|---|---|
| URL to monitor | `https://aimong-us.onrender.com/healthz` |
| Method | `GET` |
| Expected | HTTP `200` and body containing `"ok":true` |
| Interval | every 10 minutes (Render sleeps at 15) |

Any of these work on their free tier — UptimeRobot, Better Stack, cron-job.org,
Freshping. Two caveats worth knowing:

- A 10-minute pinger keeps the web service warm but **does not** cover Render's
  monthly free instance hours. For a real game night, switch the service to the
  **Starter** plan for a day and back to free afterwards; that removes the sleep
  entirely.
- Don't point the pinger at `/console` or `/api/console/*` — those are
  rate-limited and, in production, refuse traffic without `CONSOLE_KEY`.

## Controls

| | |
|---|---|
| Phone | Drag anywhere on the left half of the screen — the stick appears under your thumb. Landscape is the intended orientation; portrait shows a hint card. |
| Desktop | `WASD` or arrow keys. |
| Any | Leave button (top right) returns to the lobby. |

Everything in the round is authoritative on the server: movement prediction, fog,
kills, tasks and meetings all come from one 20 Hz simulation, and the client only
draws what it is told.
