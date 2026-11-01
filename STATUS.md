# STATUS.md — where this stands (update every session)

Last updated: 2026-11-01 · Milestone: **M4/M5-lite (residents with bodies + NIM brains) COMPLETE · next: M5 proper (meeting orchestration, mood, memory)**

> **Live app: https://aimong-us.onrender.com** (Render free plan, singapore,
> service `srv-dbjag6oae00c73dlkek0`, repo `github.com/srijan7815-bit/aimong-us`)
> Verified on the public URL: `/healthz` ok, manifest + icons + service worker
> served, installable, offline shell, cold-start recovery, two devices joined the
> same lobby by code — 12/12 PWA checks passing against production.

## Done

## M4 / M5-lite — residents with bodies and NIM voices (complete)

- **Bodies (M4):** every AI seat walks with A* + string-pulled steering, works
  its own tasks (two-stage longs included), fixes sabotages it can reach, reports
  bodies it can see, and as an impostor hunts, kills in range, sabotages and
  never touches its own team. Rules moved out of the socket handlers into
  `resolveKill` / `completeTask` / `tryFix` / `startSabotage` / `tryReport` /
  `castVote`, so residents and humans take the *same* path.
- **Brains (M5-lite):** one OpenAI-compatible gateway, NVIDIA NIM first
  (`nvidia/nemotron-3.5-bolt-e4b`, ~0.4-0.7 s/call), OpenRouter fallback, token
  bucket + concurrency ceiling + timeout, `offline`/`mock` modes that never fake
  a reply. Residents answer the owner in the console from real model output.
- **Fog-legal observation:** only what `canSeeAnywhere` allows, plus the seat's
  own ledger; strict JSON decisions (`thought`/`say`/`intent`) or the seat does
  not act; duplicate lines are filtered room-wide.
- **Measured (local, real NIM key):** `ai-playthrough` **11/11** — 7 residents
  seated via the console, 7/7 walked out of spawn, tasks credited, a kill, a
  report, a meeting, votes cast, 8 speakers, **48 LLM calls**. Example chat heard
  live: `Dima: ro medbay not galley` / `Mira: ro where exactly did you say` /
  `Tobias (ghost): everyone please state where you were`.
- **Regression suite unchanged:** M3.5 playthrough **21/21**, smoke **23/23**
  (now also asserts a resident answers through the gateway), unit tests
  **101/101**.

## M3.5 — full role and feature set (complete, live)

- **Roles with original names:** Patch (vents), Watcher (handheld vitals), Warden
  (post-mortem shield), Shifter (disguise), on top of crewmate/impostor. Role
  chances are host-tunable; the lobby previews what the table would deal.
- **Everything around a round:** four task categories with two-stage long tasks
  and a step-counting crew bar, visual-task alibis, ghosts finishing their lists,
  emergency cooldown, anonymous votes, confirm ejects, ghost chat, a lights-out
  chat block, station tools (admin table, cameras, door log, vitals), comms and O2
  sabotages, free-roam practice, quick chat, and original cosmetics
  (hats/skins/pets/nameplates) with a device-saved picker.
- **New HUD:** role card, ability bar with live cooldowns and truthful refusals,
  category chips + stage counters, tool sheets, sabotage pointers, ghost chat.
- **Measured acceptance (local):** M3.5 PLAYTHROUGH PASS **21 checks** (8 SDK
  clients, no role ever in public state), SMOKE PASS **22 checks**, unit tests
  **93/93**, browser test **PASS 8 checks**.
- **Verified LIVE** on `https://aimong-us.onrender.com` after the deploy of
  `6d0ccc3`: `/healthz` = `M3.5 / 0.5.0`, the 21-check wire playthrough **PASS**,
  the 8-check browser test **PASS**. The smoke test stops at its owner-console step
  in production because no `CONSOLE_KEY` is set there (fails closed by design).
- **Deploy gotcha fixed:** pnpm 12 refuses a lockfile without its own
  `packageManagerDependencies`, so the committed `pnpm-lock.yaml` is now pnpm
  12.16.1's output and Playwright is not a repo dependency (`DECISIONS.md` 26).
- Fixed six real bugs the tests found, two of them in the shared walker (details
  in `docs/M3.5-REPORT.md`).
- **Still stand-in:** AI players take seats and roles but stand still; Tier 2 roles
  (Noisemaker, Tracker, Phantom, detective) and the second map are scheduled
  before M7.

## M3 — core rules (complete, live)

- Roles, tasks (12 real minigames), kills, bodies, reports, the Galley emergency
  button, discussion → voting → ejection, ghosts, vents, three sabotages and every
  win condition. Details and honest gaps: `docs/M3-REPORT.md`.
- Rulebook as data in `packages/shared/src/game/rules.ts` (+ 48 shared tests),
  A* pathfinding in `packages/shared/src/world/path.ts`.
- **Measured acceptance:** PLAYTHROUGH PASS **19 checks** (7 SDK clients, a whole
  round over the wire, roles never in public state), SMOKE PASS **22 checks**,
  unit tests **68/68**, browser test with two real Chrome instances + the owner
  console + 4 residents **PASS 11 checks** (a task really completed through its
  minigame, the emergency button, meeting chat across browsers, a vote counted).
- Fixed seven real bugs those tests found, including "winning a minigame never
  counted" and "the task list never ticked".
- Not pushed yet: needs a fresh GitHub token from the owner.
- **Still stand-in:** AI players take seats and roles but stand still. They get a
  brain in M4/M5 — the client help sheet says exactly that.

- **M0 — Recon & legal:** `RESEARCH.md` (6 MIT references reviewed, licence table,
  asset plan), `THIRD_PARTY.md` (full dependency + asset ledger), no copied assets.
- **M1 — Skeleton + deploy:**
  - pnpm monorepo: `apps/client` (Phaser-ready Vite app), `apps/server`
    (Colyseus + Express), `packages/shared` (zod schemas, codes, colours,
    settings), `config/*.json`, `prompts/brain.md` in place.
  - Lobby: create room → 5-letter code, join by code, player list with pods,
    AI seats, host-only settings (seats, AI count, impostors, tasks, kill
    cooldown, discussion, voting, AI cost cap, eject-role reveal), host transfer,
    kick, lobby chat, ready state, 60 s reconnect, room cap, `/healthz`,
    `/api/rooms/:code`, `/api/rooms`.
  - Render blueprint (`render.yaml`) + `.env.example`.
  - Tests: 22 unit tests (shared + server), scripted 2-client smoke test
    (`apps/server/scripts/smoke.ts`), real headless-browser 2-phone test.
- Screenshots of the working lobby in `docs/shots/`.
- **Installable app (PWA) — added after the M1 report at the owner's request:**
  manifest + maskable icons + splash screens generated from the in-repo pod-bot
  vector (`scripts/gen-icons.py`), service worker (network-first shell,
  immutable hashed assets, never caches game traffic), home-screen install card,
  app shortcuts (Create / Join), fullscreen standalone launch, offline shell with
  a plain-language message, and a cold-start screen that pings `/healthz` and
  retries while a sleeping Render instance wakes.
- `DEPLOY.md` (exact Render + phone-install steps) and
  `scripts/deploy-render.mjs` (one-command GitHub repo + Render service + health
  wait) ready for the owner's tokens. **Untested: needs real tokens.**

- **M1.5 — Native Android shell + the Commons (owner request, inserted ahead of M2):**
  - `mobile/` Capacitor 7 shell → real APK `us.aimong.app` "AImong Us", minSdk 23,
    targetSdk 35, bundled client compiled against the Render URL, own icon + splash
    generated by `scripts/gen-android-assets.py`. Rebuild with
    `bash scripts/build-apk.sh` or the `android-apk` GitHub Actions workflow.
    APK: `docs/app/aimong-us-0.1.2.apk` (+ sha256).
  - `/console` — the Commons: the AI cluster's home ground on Render. 12 residents
    seated at boot from `config/personas.json`, owner broadcast to all (or a
    subset), team-code dispatch that seats residents into a live lobby as `isAi`
    players, automatic return home when the room closes, live feed. Honest about
    having no voice: with no LLM key it says so instead of faking replies.
  - Tests: 27 unit tests (+5 cluster), smoke now 17 checks (was 11).
  - Details: `docs/M1.5-REPORT.md`.

## Live now (M1.5, verified on production 2026-11-01)

- **https://aimong-us.onrender.com/console** — the Commons is deployed. Production
  run: 7/7 checks (room `M7CUT` created from a phone viewport, broadcast landed in
  the feed, 4 residents dispatched by team code and badged AI in the lobby, server
  reported 5 players, everyone home after the room closed).
- **Android APK:** https://github.com/srijan7815-bit/aimong-us/releases/download/v0.1.2-android/aimong-us-0.1.2.apk
  (sha256 `fd808672fb0342dfc31b60edc7d70de663e9a1e6835310013e9573e806a61558`, matches
  `docs/app/aimong-us-0.1.2.apk.sha256`).

- **M2 — Movement & map (owner-ordered, complete locally):**
  - Original station `Halcyon-9`, 64×44 tiles, 10 named rooms, 13 corridors,
    **4 loops**, 8 vent pairs, 12 task spots, 10 spawns. Generated by
    `scripts/gen-map.mjs` into a Tiled JSON *and* into
    `packages/shared/src/world/map-data.ts` (walkability grid + room graph), so
    client and server cannot disagree about geometry.
  - Server-authoritative movement at 20 Hz (`GameRoom.tick`), input vectors from
    clients, client-side prediction with the *same* `stepPlayer()` the server runs,
    remote players interpolated 90 ms in the past.
  - Fog of war from one shared function (`computeVisionMask`, exact DDA line of
    sight): drawn by the client, available to the server, and the AI observation
    builder will reuse it in M5.
  - Mobile: floating joystick (128 px base, 56 px knob, left half of the screen),
    48 px minimum for every other control, portrait shows a "turn your phone"
    card, page zoom/scroll/pull-to-refresh disabled on the play surface. Desktop
    WASD/arrows.
  - Placeholder art from `scripts/gen-atlas.py` behind a swappable atlas manifest
    (`VITE_ATLAS` picks a folder).
  - Residents seated from the Commons now spawn on the map (they stand still until
    M4 gives them bodies).
  - Measured: server tick **p95 0.186 ms** with 10 players walking (budget 10 ms);
    3 clients walked 822/822/284 px with peak speeds 127/136/166 px/s (no
    rubber-banding); fog masks matched the server calculation for all three.
  - Tests: **49 unit tests**, **22 smoke checks**, plus a 3-client browser test
    (`scripts/m2-client-test.mjs`) and a tick benchmark
    (`apps/server/scripts/perf-m2.ts`).
  - Details: `docs/M2-REPORT.md`.
- **Console hardening (owner request):** `/console` and `/api/console/*` now
  **fail closed** when `NODE_ENV=production` and `CONSOLE_KEY` is unset (403, with
  instructions), keep the constant-time key check when it is set, and rate limit
  every endpoint (reads 120/min, writes 20/min per IP). Development with no key
  stays open on purpose.
- **Keep-warm:** no code. `README.md` documents pointing an external uptime pinger
  at `/healthz` every 10 minutes, and the Starter-plan option for game nights.

## In progress

- Nothing half-finished; M1 is closed and committed.

## Next (M2)

1. Original map "Halcyon-9" as Tiled JSON → walkability grid + `mapGraph` in
   `packages/shared`.
2. Phaser game scene: tilemap render, collision, camera follow, 20 Hz input
   vectors, client interpolation.
3. Fog of war: vision radius + line-of-sight mask, shared visibility function
   (server uses the same code for AI observations).

## Known issues / gaps (honest list)

- **Deployed** (free plan): the instance sleeps after ~15 min idle, so the first
  open of the night takes 30–60 s behind the "waking up the station" screen.
- `PUBLIC_URL` env is not set on Render (it is only used in logs). Harmless.
- The GitHub token used for the first deploy should be revoked by the owner.
- Install prompt only appears for real browsers over HTTPS with
  `beforeinstallprompt`; on desktop headless it is simulated in tests. The
  "Install" card falls back to written instructions when the browser does not
  offer it.
- **No ESLint** (see DECISIONS §13); Prettier + `tsc --strict` + vitest only.
- **Start button does not launch a game** (deliberate — no simulation until M2/M3).
- AI seats are configured but not instantiated; no AI players exist in the lobby
  yet (M4/M5).
- Playtested only in headless Chromium at a Pixel 7 viewport; **no physical
  Android phone test yet** (haptics, safe areas, real touch).
- `MAX_ROOMS` is 3; a 4th lobby gets a friendly "station at capacity" error.
- Reconnect grace is 60 s; longer background-tab suspends lose the seat.
- English-only strings at the moment; the dictionary extraction is scheduled
  with the M7 a11y pass.
