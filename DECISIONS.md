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

## 2026-11-01 — M1.5: native shell, the Commons, and how they are numbered

**Owner-inserted milestone, numbered M1.5.** The owner asked for a native Android
app and a persistent AI "cluster home" before gameplay exists. PLAN.md's M2–M7 keep
their numbers; this work is M1.5 so the locked order in the task list (docs read in
order, milestones in order) stays intact.

**Native delivery = Capacitor WebView shell, not a Kotlin client.** PLAN §2 locks the
client to TypeScript + Phaser; a WebView keeps one UI codebase and still gives a real
installed app (own icon, splash, no address bar, own storage). The distinction that
matters to the owner — "played in a native app, not a browser tab" — is met. A
Kotlin/Compose port would fork the UI and cost several milestones.

**`mobile/` sits outside the pnpm workspace.** Android builds need a JDK and SDK that
game developers should not need to run `pnpm dev`. `mobile/` has its own
`package.json`; CI and `scripts/build-apk.sh` build it on demand.

**Residents are server-side, not per-room.** The Commons holds them between games so
"message all of them" is possible at all. A per-room bot cannot answer when no room
exists. Cross-game memory (M6) will replace the in-memory feed with a durable store.

**No fake voices.** With no LLM provider key, the console says "no voice connected
yet" and the feed shows a system line. Fabricating resident replies would break the
"no fabricated functionality" rule that already makes `start` refuse.

**`CONSOLE_KEY` unset = open console, loudly.** A fresh deploy has no key, and the
owner must be able to reach their cluster without a round trip through me. The page
prints a red banner in that case and `/api/console/*` stays open. Set
`CONSOLE_KEY` in Render → Environment to lock it; the key is compared in constant
time and stored only in the browser's localStorage. Cheap to flip, documented in
`DEPLOY.md`.

**Team codes are validated against live rooms.** Dispatching to a code that has no
live room returns 404 with a plain-language message instead of silently marking
residents `in-game` somewhere that does not exist.

**APK is debug-signed and published as a GitHub Release / CI artifact.** No Play
Store account, no signing keys to lose. Android requires the "install unknown apps"
toggle; `DEPLOY.md` walks through it.

## 2026-11-01 — M2: map, movement, fog

**The map is generated, not hand-drawn in Tiled.** `scripts/gen-map.mjs` holds a
hand-authored blueprint (room rectangles, corridors, pillars, vents, tasks, spawns)
and emits two artefacts: the Tiled JSON for artists, and a TypeScript data module
for the game. The generator validates reachability, room count, reciprocal vents
and *at least two graph loops* and refuses to write an invalid station. Reason: a
walkability grid copied by hand into two places is exactly the kind of thing that
silently desynchronises between client and server.

**One vision function, not two.** `computeVisionMask` (exact DDA, corner touches
block) is imported by the client for the fog and by the server for visibility
answers; `apps/server/test/vision-parity.test.ts` pins both to the same result and
also pins the map's hash. The alternative — the client drawing its own approximation —
would give away information the server does not think you have, and would make
M5's "AIs only know what they could perceive" impossible to guarantee.

**`start` opens a free-roam station instead of refusing.** Through M1 the button
claimed movement was "coming in M2". Now that movement exists, refusing would be
the dishonest option; the room enters `PLAY` with an explicit notice that roles,
tasks and kills arrive in M3. No win conditions, no kills, nothing that pretends
to be a round.

**Prediction + decaying display offset, not smooth-follow.** The pod's position is
always the prediction; server corrections are applied to prediction *and* history
instantly (they are the truth we act on) and mirrored into a display offset that
decays over ~45 ms. A smooth-follow lerp was tried first and abandoned: below
~10 fps it never catches up, so the pod walks visibly behind reality forever.

**Corrections are clamped to 48 px.** A correction larger than that is a
teleport in the same request (respawn, reconnect), so we snap rather than glide
across the station.

**Input is authoritative from the server only.** The client never writes positions
to the network; it sends `{seq,x,y}` vectors, the server samples the *latest*
one at 20 Hz with a 500 ms TTL (so a dead phone's pod stops instead of gliding).
Out-of-order sequences are dropped.

**Placeholder art ships behind a manifest now.** `VITE_ATLAS` chooses the folder;
the manifest names frames. Swapping art later is a folder + a build flag, no code
change, and the licence of the placeholder set is ours (drawn by
`scripts/gen-atlas.py`). A future artist gets the exact frame list from the
manifest.

**The APK bundles the client, so it must be rebuilt per milestone.** The native
shell keeps its offline-first bundled assets; CI builds an APK on every push that
touches the client, and `docs/app/` + the Releases page carry the current build.
Owner-facing consequence: after a deploy, the *installed app* still shows the old
client until a new APK is installed. Documented in DEPLOY.md rather than silently
switching the app to load remote assets.

**Console auth fails closed in production.** Owner instruction. Missing
`CONSOLE_KEY` on a production server now returns 403 from `/console` and from
`/api/console/*` — an unlocked console is a public door into the AI cluster. In
development the same state stays open so `pnpm dev` has no setup step. Reads are
limited to 120/min and writes to 20/min per IP.

## M3 — core rules

**One rulebook module, used by the server, the bots and the tests.**
`packages/shared/src/game/rules.ts` owns roles, task assignment, vote counting, win
conditions and sabotage specs. The server calls it; the M4 scripted bodies will
call the same functions. Duplicating "5 tasks per crew" in the client would drift
the moment balance changes.

**The client never decides anything that matters.** It renders what the server
says and sends intents (`use`, `kill`, `vote`…). Every range check exists twice:
the client hides the button, the server refuses the action. The playthrough test
proves the second half by acting at a distance.

**Roles live in a private packet, never in synced state.** `you` carries the role,
your task list and your impostor mates. The playthrough asserts that no role string
appears anywhere in the broadcast state, so a curious player can read the network
traffic all they like.

**Task minigames are DOM widgets, not Phaser scenes.** They are cheap to write,
keyboard- and screen-reader friendly, and they do not fight the game loop for the
canvas. The shell (`shell()` in `minigames.ts`) owns the promise, so *solving* and
*abandoning* are different outcomes — the bug that made tasks uncompletable was
exactly those two being the same callback.

**UI that the player touches is never rebuilt per state packet.** The action bar
and the meeting card keep their DOM nodes and rewrite only what changed. Rebuilding
at 20 Hz silently ate taps and chat keystrokes; a phone at 30 fps would have made
that look like "the game is unresponsive".

**Ghosts get `openGrid` (nothing is solid), not a special movement path.** Collision
is the only place walls exist, so a ghost is a one-line change instead of a second
movement system. Vision, tasks and votes are gated separately.

**The client test drives the on-screen stick, not the keyboard.** The product ships
a thumb stick; a test that walks with WASD proves nothing about the thing players
touch. Arrow keys stay supported on desktop.

**Debug hooks are gated behind `?debug=1`.** `__station`, `__debugMinigame`,
`__debugActions`, `__debugTasks`, `__debugSent` and the minigame trace all check the
query string, so the shipped app exposes nothing extra while the acceptance tests
can see into the page.


## 2026-11-01 — M3.5 (roles and the rest of the feature set)

16. **Original role names, mechanics only.** The owner's expansion asks for every
    role and feature but forbids the commercial game's wording, art and names.
    So: engineer → **Patch**, scientist → **Watcher**, guardian → **Warden**,
    shapeshifter → **Shifter**. The behaviour is the closest sane version of the
    public wiki-level description; the labels, numbers and strings are ours. The
    role tables live in `game/roles.ts` so the server, the UI, the bots and the
    prompts can never drift apart.
17. **Numbers chosen for a phone session.** Patch vents 10 s / 30 s recharge,
    Watcher 10 s battery / 15 s recharge, Warden 10 s ward / 35 s cooldown / 3
    tiles, Shifter 10 s / 25 s cooldown. Every one is host-tunable and documented
    in `ROLE_ABILITY`; the balance sim (M6) will move them, not the code.
18. **A shift is an event, not state.** The station broadcasts "someone shifted"
    (that is the tell the genre gives you) and the pod's label follows the
    server's `visibleName`, so a crewmate can see *that* it happened without ever
    being handed the shifter's real identity.
19. **Station tools are room-gated and counted.** Admin table only at Cargo or
    Bridge, cameras at Observatory or Comms, door log at Comms, four uses each per
    round. The refusal text is shared (`refusalText`) so the button and the server
    say the same sentence.
20. **Chat is a router, not a special case per phase.** `say()` decides: lobby and
    results = open; meetings = everyone alive; outside meetings = ghosts only;
    lights-out = nothing unless the host allows it; ghost chat setting can turn the
    dead channel off. Lobby chat being refused by the first version of this router
    is exactly why the smoke test exists.
21. **Cosmetics are code, not assets.** 7 hats, 4 skins, 4 pets, 3 nameplates, all
    drawn from primitives in Phaser plus a CSS picker, stored on the seat so other
    people see them. Look-only by construction: the server validates the ids with
    `readCosmetics` and stores strings; no cosmetic is read by any rule.
22. **Walking is shared code.** `steerAlongPath` (aim ahead, skip reached nodes,
    cut a corner only with a clear line) lives in `packages/shared/src/world/path.ts`
    because the M4 bodies need the same walker the test scripts use. The bug it
    fixes — a pod shuttling between two tile centres forever — was found by the
    M3.5 playthrough, not by luck.
23. **Input sequence numbers are per seat for a whole match.** The server drops
    out-of-order packets; a script that restarts at 1 for each leg stands still
    until the counter catches up. The harness now keeps one counter per seat.
24. **Task categories come from the console, not the spot id.** `taskCategoryForSpot`
    switches on the console `kind` (repair → short, fill → long, tune → common,
    scan → visual) so the real map deals 3/3/3/3 and adding a console cannot
    silently unbalance the categories.
25. **Tier 2 is deferred, not dropped.** Noisemaker, Tracker, Phantom, the
    detective role, a second map with ladders/moving platforms and map selection
    stay on the schedule before M7, as the owner's expansion ordered.
26. **The committed lockfile is pnpm 12.16.1's own output.** Render's build runs
    `npm i -g pnpm@12.16.1 && pnpm install --frozen-lockfile`, and pnpm 12 refuses
    a lockfile that does not record its *own* `packageManagerDependencies`
    (`ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`) — even though a pnpm 9
    install is happy with it. Regenerate with pnpm 12.16.1
    (`npm i -g pnpm@12.16.1 && pnpm install`), never with the sandbox's pnpm 9,
    or the Render deploy fails at the install step. Playwright stays out of the
    repo for the same reason: its install step downloads browsers.

## 2026-11-01 — M4/M5 (residents with bodies and voices)

27. **NIM model choice is empirical, not aspirational.** Most ids in
    `GET /v1/models` are not entitled on this key (404 "Function … not found"),
    several well-known ones are **end-of-life** (`meta/llama-3.1-8b-instruct`,
    `meta/llama-3.3-70b-instruct` → 410), and the newest reasoning models
    (`nemotron-3.5-lightning-30b-a3b`) return an *empty* `content` because every
    token goes to `reasoning_tokens`. `nvidia/nemotron-3.5-bolt-e4b` answers with
    real content in ~0.4–0.7 s, so it is used for **both** tiers (play + meeting)
    until a better entitled model exists. An empty `content` is treated as a
    failed call, so a seat never "thinks" silently in place of talking.
28. **One gateway, no SDKs.** Everything we call speaks OpenAI
    chat-completions, so the gateway is one `fetch` with a provider table, a
    token bucket (NIM 30 rpm of its ~40 free), `MAX_LLM_CONCURRENCY`
    backpressure (a skipped call simply means the resident thinks again next
    tick), and a 20 s abort. When nothing is configured the gateway says
    `offline` and the residents stay silent rather than faking a message.
29. **Rules moved out of the socket handlers.** `resolveKill`, `completeTask`,
    `tryFix`, `startSabotage`, `tryReport`, `castVote` are now room methods; the
    `onMessage` handlers and the AI driver both call them. This is what makes
    "the bots cheat?" answerable: they cannot, because they have no second code
    path. Residents act only through `AiPort`, which owns no rules.
30. **Residents think rarely, talk when it matters.** Play-time model calls run
    every 14–24 s per seat and only steer coarse intent; the discussion phase
    gets the budget (two lines per resident per meeting). Duplicate lines are
    filtered room-wide so four residents never say the same sentence.
31. **The driver never trusts the model.** `say` must be non-empty and unique;
    `intent.target` is honoured only when it names a seat the model could legally
    act on; everything structural (walking, cooldowns, kill range, task
    presence) stays deterministic. A hallucinating brain cannot break a rule.
32. **One retry on a failed model call.** On the free NIM tier we watched bursts of
    `404` with an empty body for a model that had answered a second earlier.
    A single retry after 400 ms covers the transient case; after that the seat
    stays quiet for that tick. A silent resident is better than a hung match, and
    the failure is visible in the console's `failed` counter.

## 2026-11-02 — how players get in

33. **The app connects to the gateway; the player does not paste anything.**
    `https://aimong-us.onrender.com` is baked into the build, so Play asks the
    server where to go (`GET /api/play`) and joins the waiting lobby, or creates
    one. The 5-letter code survives for two jobs only: the owner console needs a
    stable handle to send residents to a specific match, and a friend on another
    device can still join a named station on purpose. Rationale: codes are a toll
    booth on every single game, and the room code was the only thing standing
    between "open the app" and "you're playing".
34. **A running match is never offered to a newcomer.** `/api/play` filters on
    `phase === 'LOBBY'` and free seats, so pressing Play mid-game opens a fresh
    station instead of dropping a stranger into someone else's round.
