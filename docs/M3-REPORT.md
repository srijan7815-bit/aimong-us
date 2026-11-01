# M3 — core rules (report)

Date: 2026-11-01 · Milestone status: **complete locally, verified on a local server**
Version: `0.4.0` · `MILESTONE = 'M3'`

M3 turns the movement preview into a real round of the game: roles, tasks with
twelve real minigames, kills, bodies, reports, emergency meetings, discussion,
voting, ejection, ghosts, vents, three sabotages and all win conditions.

AI players still exist as *seated bodies only* — they take seats, they get roles,
and they stand still. Nothing in this milestone claims otherwise, on screen or in
the docs. M4 gives them a scripted brain.

## What a round does now

| Rule | Value | Where |
| --- | --- | --- |
| Roles | 1 impostor per 5–7 seats, 2 per 8+ (host can override) | `assignRoles` |
| Tasks | 5 per crew member, from 12 map spots, 12 distinct minigames | `assignTasks`, `minigameForSpot` |
| Kill | 48 px, 25 s cooldown, leaves a body the killer walks away from | `GameRoom.kill` |
| Report | 64 px of a body → meeting | `GameRoom.report` |
| Emergency | Galley button, 96 px, one per player per round | `GameRoom.emergency` |
| Discussion / voting | 60 s / 30 s (host can change both) | `settings` |
| Vote | one per living player, skip counts, majority ejects, tie = nobody | `tallyVotes` |
| Ghosts | pass through walls, see, chat, cannot vote or act | `openGrid` |
| Vents | impostor only, 44 px, teleports between linked pairs | `WORLD.vents` |
| Sabotage | lights 40 s (vision 2.5 tiles), doors 12 s, reactor 45 s lethal | `SABOTAGE_SPECS` |
| Win | crew: tasks done, or last impostor ejected · impostors: parity, reactor, or crew tasks run out | `checkWin` |

Server-side range checks are on every action, so a modified client cannot act at
a distance. Roles never enter the synced state: they travel in the private `you`
packet only, and the playthrough test asserts that the broadcast state contains no
`role`/`impostor` string.

## Measured acceptance

| Check | Command | Result |
| --- | --- | --- |
| Rules over the wire, 7 SDK clients, full round | `npx tsx scripts/playthrough.ts` | **PASS, 19 checks** |
| Smoke (HTTP, join, code, cluster) | `SMOKE_URL=… npx tsx scripts/smoke.ts` | **PASS, 22 checks** |
| Unit tests (shared + server) | `npx vitest run` | **68/68** (shared 48, server 20) |
| Real browser, 2 humans + 4 residents, through the UI | `node scripts/m3-client-test.mjs` | **PASS, 11 checks** |
| Client build | `pnpm --filter @aimong/client build` | ✓ (chunk-size warning only) |

Playthrough transcript highlights (real numbers from the run):

```
✓ roles dealt privately: 1 impostor(s), 6 crew
✓ no role appears in the broadcast state (only the private packet)
✓ crew got 5 tasks each, impostors got none
✓ a crew member walked to task-observatory-lens and completed a task (1/5)
✓ server refuses a task completed away from its spot
✓ kill refused at 1459 px distance
✓ P2 was killed at close range and is now a ghost
✓ a body appeared where they fell
✓ kill is refused while the cooldown is running
✓ ghost drifted 191 px through walls (now on tile " ")
✓ body reported by P2 — the round is in MEETING (DISCUSSION)
✓ discussion ran its timer and voting opened
✓ 6 living players voted; a ghost's vote was refused
✓ majority ejected P1
✓ match ended: crew win (impostors-dead) — "Crew win — the last impostor was ejected."
✓ roles revealed at the end: P1=impostor, P2..P7=crew
✓ sabotage: Lights out active for 40s (crew vision drops to 2.5 tiles; base mask here is 144 tiles)
✓ every living player ends the round standing on floor
```

Browser test (two real Chrome instances, phone-shaped layout, a real owner
console): residents seated from the console, roles private per player, the task
list real, all twelve minigames rendered, one task **really played and completed**
(`Scan the specimen` → HUD `Tasks 1/5`), the Galley emergency button, meeting chat
across browsers, a vote with the counter updating, and play resuming afterwards.
Screenshots: `docs/shots/15-meeting.png`, `docs/shots/16-vote.png`.

## Bugs this milestone's tests caught (all fixed)

1. **Winning a minigame never sent `taskDone`.** `openMinigame` passed the *same*
   callback as both `solve` and `close`, so solving closed the panel without ever
   resolving the handle — no task could be completed from the world. The handle
   now exposes `finish(ok)`, and `solve` settles it with `true`.
2. **The task list never ticked.** `taskDone` updated the server's copy and never
   re-sent the private `you` packet, so the HUD stayed at `0/5` forever.
3. **The action bar was rebuilt 20 times a second**, destroying the button under
   the player's thumb mid-tap. It now rebuilds only when what is on offer changes.
4. **The meeting card was rebuilt 20 times a second**, stealing focus from the
   chat box and dropping keystrokes. It is built once and only its volatile parts
   are rewritten.
5. **The HUD ignored taps**: `.play-hud` is `pointer-events:none` so the map keeps
   dragging, which also switched off the task button. The button takes taps back.
6. **Start stayed disabled after residents were seated**: the lobby counted the
   host's AI-seat setting, not the residents actually sitting down.
7. **The playthrough's walking could wedge** against a body or a corner; it now
   re-plans every 400 ms and sidesteps when it stops making progress.

## Files

New: `packages/shared/src/game/rules.ts` (rulebook), `packages/shared/test/rules.test.ts`,
`packages/shared/src/world/path.ts` (A*), `apps/client/src/game/minigames.ts`,
`apps/client/src/screens/play.ts`, `apps/server/scripts/playthrough.ts`,
`scripts/m3-client-test.mjs`.

Grown: `protocol.ts` (kill/vent/report/emergency/taskDone/fix/sabotage/vote/lobby),
`GameRoom.ts` (the whole rules loop), `state.ts` (bodies, sabotage, meeting, result),
`styles.css` (~500 lines of M3 UI), `main.ts` (private packets, verdicts, debug hooks).

## Not done / honest gaps

- AI players are seated bodies: they take roles and stand still until M4.
- No sound, no art pass, no haptics on game events yet (M7).
- Minigames are widget-grade, not final art (M7).
- Three of the twelve minigames (`morse`, `valve`, `connect`) are only driven by a
  human hand in testing — the automated browser test plays the other nine.
- Not yet deployed: this milestone is verified locally; the push needs a fresh
  GitHub token from the owner.
