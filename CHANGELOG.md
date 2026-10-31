# CHANGELOG

## [0.1.0] — 2026-11-01 — M0 + M1

### Added
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
