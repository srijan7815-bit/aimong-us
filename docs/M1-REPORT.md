# M0 + M1 report — 2026-11-01

## What shipped

**M0 (recon & legal).** Six permissively-licensed (MIT) references reviewed for
architecture ideas only — SkyOffice, ts-online-game-template,
tic-tac-toe-multiplayer-starter, qspy, mafia-arena, LieGraph. Licence table and
asset plan in `RESEARCH.md`; every dependency and asset logged in
`THIRD_PARTY.md`. Nothing from the commercial game was used, extracted or
imitated; GPL projects were deliberately excluded. Provider model IDs, prices and
rate limits were pulled live and recorded (`RESEARCH.md §5`, `DECISIONS.md §15–17`).

**M1 (skeleton + deploy).**
- pnpm monorepo: `apps/client`, `apps/server`, `packages/shared`, `config/`,
  `prompts/brain.md`, `render.yaml`, `.env.example`.
- Join-by-code lobby: create → 5-letter code, join by code (typed, pasted or via
  `?code=` link), live player list with pod-bot avatars, AI seat count, host-only
  settings (seats, AI, impostors, tasks, kill cooldown, discussion, voting, AI
  cost cap, reveal-ejected-role), host transfer, kick, lobby chat, ready state,
  60-second reconnect after a dropped phone, room cap, `/healthz`,
  `/api/rooms/:code`, `/api/rooms`.
- Mobile-first UI (Pixel-7 viewport verified), procedural original pod-bot art
  with a unique antenna symbol per colour (colour-blind aid), haptics on taps,
  toasts, help sheet.

## Verified (not claimed — tested)

| Check | How | Result |
|-------|-----|--------|
| Health endpoint | `curl /healthz` | `{ok:true, rooms:n, milestone:"M1"}` |
| Room create + code | scripted smoke + browser | 5-letter code from the unambiguous alphabet |
| Code → room resolution | `GET /api/rooms/:code` | resolves, 404 once the room closes |
| Two players converge | headless Chromium, 2 phone contexts | both see `Aman` + `Neha` |
| Duplicate names | scripted smoke | second `Owner` becomes `Owner2` |
| Host-only controls | browser | non-host sees no Start button; settings patch rejected |
| Settings propagate | browser | discussion 60s → 75s on the other phone |
| Chat round trip | browser | message appears on the other device |
| Refresh keeps the seat | browser reload | seat restored inside the 60 s window |
| Room disposes + code freed | scripted smoke | `/api/rooms/:code` → 404 |
| Unit tests | `pnpm test` | 22 passed (codes, colours, settings, sanitisation, registry, rate limit, config) |
| Types | `pnpm -r typecheck` | clean (strict, no `any`) |
| Production build | `pnpm -r build` | client 256 kB / 77 kB gzip, server compiled |
| Dev workflow | `pnpm dev` | Vite :5173 proxying to the game server on :2567 |

## Not done / honest gaps

- **Not deployed to Render yet.** The blueprint is ready, but creating the
  service needs the owner's Render account (and the code needs to be in a Git
  repo first). Everything else is deploy-ready.
- No AI seats exist in the lobby yet (they arrive with the bots in M4/M5) — only
  the count and the settings are live.
- Start button intentionally explains that the simulation arrives in M2/M3.
- Tested in headless Chromium at a Pixel 7 viewport, not on a physical Android
  phone (haptics + safe areas need the real thing).
- No ESLint (Prettier + strict `tsc` + Vitest instead) — logged in `DECISIONS.md`.

## Next

M2: original "Halcyon-9" tilemap → walkability grid + room graph, server-side
movement with collision, client interpolation, fog-of-war vision with
line-of-sight, one shared visibility function for both rendering and AI
observations.
