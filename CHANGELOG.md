# CHANGELOG

## [0.2.0] — 2026-11-01

### Added
- **Native Android app** (`mobile/`, Capacitor 7): `us.aimong.app`, minSdk 23,
  targetSdk 35, bundled offline shell, icon + splash generated from the repo's own
  vector, built to a signed-debug APK by `scripts/build-apk.sh` and by the
  `android-apk` CI workflow. App traffic targets the Render deployment via
  `VITE_SERVER_URL`.
- **The Commons** (`/console`, `apps/server/src/cluster/commons.ts`): the AI
  cluster's persistent home on the server — resident roster seated from config,
  owner broadcast to everyone or a subset, team-code dispatch that seats residents
  into a live room as `isAi` players, auto-return home, live feed.
- `apps/server/src/rooms/presence.ts` — code → live room handles so the console can
  address a lobby by the code a human typed.
- `GameRoom.admitResidents()` — the seat layer both the scripted bodies (M4) and the
  LLM brain (M5) will drive.
- `packages/shared/src/cluster.ts` — cluster protocol schemas and view types.

### Changed
- `apps/server/scripts/smoke.ts`: 11 → 17 checks (adds cluster end-to-end).

### Security
- Owner console is gated by `CONSOLE_KEY` (constant-time compare). Left unset it
  works and warns visibly; see `DECISIONS.md`.

## [0.1.2] — 2026-11-01 — deployed

### Added
- Live deployment: https://aimong-us.onrender.com (Render, free plan, one
  instance, singapore) behind `render.yaml`; repo `srijan7815-bit/aimong-us`.
- Verified against production: health, manifest/icons/SW, installability, offline
  shell, cold-start recovery, two devices in one lobby by code (12/12 checks).

### Fixed
- Invite links (`/?code=XXXXX`) and app shortcuts applied before the home screen
  existed on slow cold starts; now applied after mount.

## [0.1.1] — 2026-11-01 — installable phone app

### Added
- PWA: `manifest.webmanifest` (standalone, maskable icon, Create/Join shortcuts),
  generated PNG icon set + splash screens (`scripts/gen-icons.py`, original art
  drawn from the in-game pod-bot vectors), service worker with network-first
  shell / cache-first hashed assets and explicit no-caching of `/api/*` and
  `/matchmake/*`, one-tap "new build available" reload.
- Home-screen install card (uses `beforeinstallprompt`) with written fallback
  instructions, installed-state indicator, app shortcuts, deep-link code prefill.
- Boot screen painted before JS loads, "Waking up the station…" cold-start flow
  with `/healthz` polling + auto-retry and an offline-specific message.
- Wake Lock helper (keeps the phone awake once the game screen lands in M2).
- `DEPLOY.md` and `scripts/deploy-render.mjs` (repo + Render service + health wait).

### Changed
- `render.yaml` defaults to the free plan (owner pays nothing) with a documented
  one-click switch to Starter for game night.
- Vite bundles `@aimong/shared` from source (no stale-dist trap); `pnpm dev` and
  `pnpm test` build the shared package first.
- `scripts/dev-browser-testing.sh` recreates the headless-browser harness
  (sandbox has no apt access, so libs are unpacked into /tmp).

### Fixed
- `beforeinstallprompt` could fire before the app subscribed to it, losing the
  install offer — listener now registers at module load.
- Offline cold start spun for 90 s; it now reports "you are offline" immediately.

## [0.1.0] — 2026-11-01 — M0 + M1

## [0.1.0] — 2026-11-01 — M0 + M1

#### Added
- pnpm workspace monorepo (client / server / shared), strict TypeScript, Vitest.
- `packages/shared`: room-code generation + forgiving normalisation, 12-colour
  palette with colour-blind symbols, lobby settings schema + clamping, protocol
  schemas (names/chat/messages), intent/mood/persona schemas from the spec.
- `apps/server`: Colyseus 0.18 `GameRoom` (create/join by code, host transfer,
  kick, lobby chat, settings, ready, reconnect grace, room cap), Express layer
  serving `/healthz`, `/api/rooms`, `/api/rooms/:code` and the built client,
  pino logging, per-IP/per-player rate limits.
- `apps/client`: mobile-first UI — home (create / 5-box code join, paste, deep
  link `?code=`), lobby (code copy/share, pod-bot roster, AI seats, host
  settings, chat, ready), help sheet with haptics toggle, toasts, reconnect.
  Procedural SVG pod-bot art (12 colours, unique antenna symbols).
- `render.yaml`, `.env.example`, CI workflow, `docs/shots/` screenshots.
- Tests: 22 unit tests, scripted 2-client smoke test, headless 2-phone browser test.

### Fixed
- Colyseus reconnection denied on Node 20 (`WebSocket is not defined`) — global
  `WebSocket` polyfill from `ws`.
- Name/chat sanitisation order allowed an over-long rejected name to carry
  delimiters; now sanitised before length validation.

### Docs
- `RESEARCH.md` (M0 recon, licences, asset plan), `THIRD_PARTY.md` (ledger),
  `DECISIONS.md`, `STATUS.md`, `README.md`.
