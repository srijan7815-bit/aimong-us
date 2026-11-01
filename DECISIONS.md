# DECISIONS.md — running log

Format: date · decision · why. Newest last. Anything the owner did not
explicitly decide lives here (INSTRUCTIONS §0.2).

## 2026-11-01 — M0/M1

1. **Colyseus 0.18 modules instead of the `colyseus` umbrella package.** The
   umbrella install pulls `uWebSockets.js` from a git URL, which pnpm 12's
   supply-chain policy (`blockExoticSubdeps`) rejects. We depend on
   `@colyseus/core` + `@colyseus/ws-transport` + `@colyseus/schema` directly —
   same server, ordinary package supply chain. Client uses `@colyseus/sdk`
   0.18.x (the 0.16 `colyseus.js` package would be a protocol mismatch).
2. **Schema via `schema()` + `t.*` builders, not decorators.** Keeps plain `tsc`
   working with no `experimentalDecorators`, and matches the current Colyseus
   docs.
3. **Global `WebSocket` polyfill from `ws`.** Colyseus 0.18's reconnection path
   references the global `WebSocket`; Node 20 has none, which silently denied
   every reconnect with close code 4003. Verified by test before fixing.
4. **Node 22 on Render** (`NODE_VERSION=22`), Node ≥22 in `engines`. The
   polyfill keeps Node 20 working too.
5. **Room codes: 5 chars, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.** Input is
   normalised forgivingly: lowercase/spaces/punctuation stripped, `1`/`I` → `L`,
   and `0`/`O` dropped (they are not in the alphabet). Pasting `kx0q-7m` works.
6. **One web service, one instance.** Client bundle is served by the same Node
   process as the WebSocket endpoint; `MAX_ROOMS=3` (env) bounds cost; a room
   disposes when empty and frees its code.
7. **Reconnect = 60 s seat hold.** Implemented via Colyseus `onDrop` +
   `allowReconnection`; explicit "Leave" disposes the seat immediately. Verified
   by reloading a phone mid-lobby in a real browser.
8. **No fake start.** The lobby's Start button validates seat counts and then
   tells the truth: the simulation arrives in M2/M3. (Honesty rule from
   INSTRUCTIONS §0.7.)
9. **Room codes are resolvable over HTTP** (`GET /api/rooms/:code` → roomId) so a
   player only ever types 5 characters; no accounts, no public room list beyond
   "how many stations are up".
10. **Security basics from day one:** per-IP join rate limit (12/min), per-player
    chat limit (6 per 5 s), `maxMessagesPerSecond=20` per client, names and chat
    sanitised (angle brackets stripped so prompt delimiters stay unforgeable),
    zod validation on every inbound message, no secrets in the client bundle.
11. **Owners-first defaults:** 10 seats, 6 AI seats, 2 impostors, 60 s discussion,
    30 s voting, 25 s kill cooldown, $1.00 AI cost cap per game — taken from
    `config/game.defaults.json`; `MAX_COST_USD_PER_GAME` env overrides the cap.
12. **Placeholder art is real art.** Characters are procedural inline SVG
    pod-bots (12 colours × unique antenna symbols for colour-blind players) so
    there is no third-party licence and no asset pipeline blocking gameplay.
    M7 swaps in a generated atlas behind the same module boundary.
13. **No ESLint yet.** Prettier + strict `tsc` + vitest are in place; ESLint adds
    config churn without catching anything `tsc --strict` misses at this size.
    Revisit at M3 when the sim lands. (Logged rather than silently skipped.)
14. **Tests are real, not decorative.** 22 unit tests covering code generation,
    forgiving normalisation, colour assignment, settings clamping, input
    sanitisation, registry, rate limiting and config loading — plus a scripted
    end-to-end smoke test (2 clients) and a real headless-browser test (2 phones)
    that are run before calling a milestone done.

## Provider/model notes (recorded for M5/M6, verified 2026-11-01)

15. **NVIDIA NIM** free developer key: ~40 req/min, ~10k req/day; hosted free
    endpoints include `nvidia/nemotron-3.5-lightning-30b-a3b`,
    `nvidia/nemotron-3-super-120b-a12b`, `deepseek-ai/deepseek-v4.1-flash`,
    `z-ai/glm-5.3-flash`. Gateway must throttle NIM to ≤40 RPM.
16. **OpenRouter** `:free` models: 20 req/min and 50 req/day (1,000/day after a
    one-time $10) — too small to run a live game, so the roster must use cheap
    *paid* models for play and meetings and keep the local mock for tests.
    Observed prices: `z-ai/glm-5.3-flash` $0.015/M in, `deepseek/deepseek-v4-flash`
    $0.091/M, `openai/gpt-6-luna` $0.10/M, `deepseek/deepseek-v4-pro` $1.60/M.
    Exact IDs/prices are pinned in `config/roster.json` at M5, not guessed now.
17. **Cost model is a first-class constraint**, so the gateway will enforce:
    per-game cap → at 80% switch every seat to the cheapest tier → at 100% drop to
    scripted autopilot (game stays playable, no surprise bill).

## 2026-11-01 — installable phone app (owner request after M1)

18. **Ship as a PWA, not a wrapped APK.** The owner wants it "as a mobile game on
    my phone" talking to the Render server. A home-screen PWA (manifest +
    maskable icons + standalone display) installs in one tap from Chrome, gets a
    real launcher icon, runs fullscreen, and needs no Play Store, no signing
    keys, no build pipeline. A TWA wrapper stays a v1.1 stretch goal (it would
    need an Android build box and a signing key I do not have).
19. **Service worker caches the shell, never the game.** Navigations are
    network-first with a cached fallback (so the icon always opens, even offline
    or while Render wakes); content-hashed `/assets/*` are cache-first;
    `/api/*`, `/matchmake*` and `/healthz` are never cached. Bump
    `CACHE_VERSION` when the shell changes.
20. **Cold start is a feature, not an error.** Free Render instances sleep after
    ~15 min idle. The app paints a boot screen before JS, pings `/healthz` with
    backoff for up to 90 s, says "Waking up the station…", and auto-continues.
    Offline is detected instantly instead of spinning.
21. **Free plan by default.** No card required; `DEPLOY.md` documents the
    one-click switch to Starter (or a free UptimeRobot ping) for game nights.
22. **Icons are generated, original, and committed.** `scripts/gen-icons.py`
    draws them with Pillow from the same vector language as the pod-bots
    (supersampled, no SVG rasteriser or browser needed at build time). Committed
    PNGs mean the Render build has zero image tooling.
23. **Deploy automation is scripted and reusable.** `scripts/deploy-render.mjs`
    creates/reuses the GitHub repo, pushes `main`, creates/reuses the Render
    service, and waits for `/healthz`. Runs only with tokens the owner supplies;
    no secret is ever written to disk.
