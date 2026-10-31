# STATUS.md — where this stands (update every session)

Last updated: 2026-11-01 · Milestone: **M1 complete, M2 next**

## Done

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

- **Not deployed to Render yet** — needs the owner to create the service from
  `render.yaml` and paste `PUBLIC_URL` (+ keys later). Until then the build is
  verified locally only.
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
