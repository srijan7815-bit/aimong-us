# RESEARCH.md — M0 recon & legal check

Date: 2026-11-01. Scope: study permissively-licensed open-source work for
architecture ideas (netcode, tick loops, room state, task state machines,
tilemap handling) and settle the asset plan. **No code, art, audio, map or name
was copied from anything, and nothing from the commercial game was inspected,
extracted or decompiled.**

## 1. References reviewed (licence-checked via the GitHub API on 2026-11-01)

| # | Repo | Licence | Stars | What it is | Useful for us | What we do differently |
|---|------|---------|-------|------------|---------------|------------------------|
| 1 | [kevinshen56714/SkyOffice](https://github.com/kevinshen56714/SkyOffice) | MIT | 1,314 | Phaser 3 + Colyseus + React "virtual office": character select, avatars walking, proximity chat over PeerJS | The closest shape to our stack; how a Phaser scene reads a Colyseus schema and interpolates remote players | We use vanilla TS (no React/Redux), our own character rig (procedural SVG → atlas), and no PeerJS — voice is a stretch goal |
| 2 | [ASteinheiser/ts-online-game-template](https://github.com/ASteinheiser/ts-online-game-template) | MIT | 56 | TypeScript monorepo template for MMO-style Colyseus games | Monorepo/workspace layout and server-authoritative movement conventions | We add shared zod schemas + fog-of-war observation builder; stricter typing throughout |
| 3 | [ourcade/tic-tac-toe-multiplayer-starter](https://github.com/ourcade/tic-tac-toe-multiplayer-starter) | MIT | 23 | Minimal Colyseus + Phaser starter with room states | Smallest reference for room lifecycle and client reconnection | We need N-player rooms with host transfer, codes and reconnect grace — far beyond it |
| 4 | [miapolis/qspy](https://github.com/miapolis/qspy) | MIT | 7 | Browser social-deduction game ("find the spy"), TS + socket.io | Phases (lobby → role → reveal → vote), turn/host modelling | Colyseus instead of socket.io; our rules, map, art and AI layer are original |
| 5 | [mohsen1/mafia-arena](https://github.com/mohsen1/mafia-arena) | MIT | 6 | LLM-driven Mafia: evaluates models' social reasoning in multi-agent games | Prompt/observation packaging and evaluation metrics for AI social play | We need real-time movement + fog of war, not just chat turns; our cost caps and grounding checks are stricter |
| 6 | [leslieo2/LieGraph](https://github.com/leslieo2/LieGraph) | MIT | 50 | LangGraph "who is spy" multi-agent social deduction | Agent memory/vote aggregation ideas | Python; we reimplement the ideas in TS inside our own agent loop |

Excluded on purpose (licence or scope): CrewLink (GPL-3.0), AmongUsMenu /
MalumMenu / SickoMenu (GPL-3.0, also cheat tools), nodepolus, and anything that
implements the official game's protocol. GPL/AGPL code is not copied into this
repo. Full ledger in `THIRD_PARTY.md`.

## 2. What we actually take

Ideas only — no source files, no assets:

- **Client:** Phaser scene owns rendering; a thin net layer subscribes to
  snapshot patches and interpolates remote entities (~100 ms buffer). Nothing
  about game truth lives on the client.
- **Server:** authoritative room, fixed tick, state patch ~12–15 Hz, inputs only
  from clients, legality re-checked server-side (we do this for kills, vents,
  task progress as they land in M3).
- **Rooms:** join by code → map to a Colyseus `roomId`, host transferable,
  reconnect grace window with a token.
- **Phases** as an explicit state machine (`LOBBY → STARTING → PLAY → MEETING →
  END`) with timers owned by the server, not the UI.
- **Agent memory** as an append-only ledger of perceived events; votes aggregated
  from structured output.

## 3. Library/tooling decisions (see DECISIONS.md for the running log)

| Need | Choice | Note |
|------|--------|------|
| Realtime | Colyseus 0.18 (`@colyseus/core` + `ws-transport`) | Installed from npm; the umbrella `colyseus` package pulls `uWebSockets.js` from a git URL, which pnpm 12's supply-chain policy blocks — so we compose the modules ourselves |
| Client SDK | `@colyseus/sdk` 0.18.x | Matches the 0.18 server; 0.16 `colyseus.js` would be a protocol mismatch |
| Engine | Phaser 3.90 | Locked in PLAN §5 (Phaser 4 is out but is not what the spec chose) |
| Build | Vite 7, TS 5.9 strict, vitest 3, pnpm workspaces | No ESLint yet (logged as a decision, prettier present) |
| Schema | `@colyseus/schema` 5 `schema()` + `t.*` builders | No decorators → no experimental flags in `tsc` |

## 4. Asset plan (original-first, tracked)

- **Characters (12 colours):** procedurally drawn "pod-bots" in inline SVG right
  now — rounded body, single antenna with one unique symbol per colour (colour-
  blind aid), porthole visor, boots. Final art in M7 becomes a Phaser atlas
  generated from the same vector source, so no third-party licence is involved.
- **Map:** original station "Halcyon-9" authored by me as Tiled JSON (rooms,
  corridors, 2 loops, vents) — not derived from any existing map.
- **UI:** inline CSS/SVG only, system font stack. No font downloads, nothing
  unlicensed to log.
- **Audio (M7):** synthesised in-repo (jsfxr-style waveform generation) or CC0
  packs (Kenney / OpenGameArt CC0), each file logged in `THIRD_PARTY.md`.
- **Rule:** no file ships without an entry in `THIRD_PARTY.md`.

## 5. Provider research (for M5/M6, recorded now)

Model IDs and limits were pulled live from the providers on 2026-11-01 and are
recorded in `config/roster.json` + `DECISIONS.md §models`. Headlines:

- **NVIDIA NIM** (OpenAI-compatible, `https://integrate.api.nvidia.com/v1`):
  ~40 requests/minute and ~10,000/day on a free developer key, free hosted
  endpoints including `nvidia/nemotron-3.5-lightning-30b-a3b`,
  `nvidia/nemotron-3-super-120b-a12b`, `deepseek-ai/deepseek-v4.1-flash`,
  `z-ai/glm-5.3-flash`. Trial terms are for testing/evaluation — fine for a
  friends-only build. Our gateway must throttle NIM to ≤40 RPM.
- **OpenRouter** (`https://openrouter.ai/api/v1`): free `:free` models are capped
  at 20 req/min and 50 req/day (1,000/day after a one-time $10 purchase), so the
  free tier cannot drive a whole game; paid models have no gateway-level cap.
  Cheap paid options observed: `z-ai/glm-5.3-flash` ($0.0149/M in),
  `deepseek/deepseek-v4-flash` ($0.091/M in), `anthropic/claude-haiku-5.5`
  ($0.10/M in), `openai/gpt-6-luna` ($0.10/M in). Stronger meeting models:
  `deepseek/deepseek-v4-pro` ($1.60/M in), `openai/gpt-6.1-terra` ($1.00/M in).
- Consequence for cost: the play phase must run on a cheap/fast model and
  meetings on a stronger-but-still-cheap one; the hard cap
  (`MAX_COST_USD_PER_GAME`) plus downgrade ladder is not optional.

No scraping, no reverse engineering, no official assets. Everything expressive in
this repo is written here.
