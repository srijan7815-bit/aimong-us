# PROD_QUA.md — Product Quality Spec for AImong Us

Goal: it should **feel as polished as a top mobile social-deduction game** — snappy, readable, juicy, tense — while every visual and sound is **original** (see PLAN §13). Mobile (Android Chrome) is the primary target; desktop is secondary.

**Quality principle:** *Readable first, pretty second, juicy third.* A player must instantly know: where am I, who's near me, what can I do right now.

---

## 1. Art direction

### 1.1 Style
- 2D top-down, **chunky dark outlines, flat colors with soft cel shading**, subtle ambient-occlusion shadows under characters and walls.
- Moody sci-fi: cool blue-teal station interiors, warm accent lights, red for danger. Each room has a distinct color/lighting identity so rooms are recognizable at a glance (AIs and humans both refer to rooms by name).
- Base logical resolution **1280×720**, scale-to-fit, `devicePixelRatio` capped at 2. Tile size **32 px** (or 48 px if art needs it).

### 1.2 Characters (must be original and distinct from the commercial game's crewmate)
- Suggested design: **"pod-bots"** — rounded-rectangle body with a single antenna, two glowing eyes behind a rounded porthole, small boots. Distinct silhouette, instantly recognizable at 24 px tall.
- **12 player colors** with high mutual contrast. Starting palette (tune for color-blind safety):
  `#E5484D red · #3E63DD blue · #30A46C green · #F76B15 orange · #8E4EC6 purple · #12A594 teal · #FFC53D yellow · #E93D82 pink · #A18072 brown · #D6D6D6 white · #3A3A3F black · #7CE2FE cyan`
- **Color-blind aid:** each color also gets a small unique **symbol/hat-pattern** (shape on the antenna tip) shown on the character and in the vote grid.
- Cosmetics v1: none required. (Stretch: hats via a simple overlay system.)
- **Dead body:** original treatment — "short-circuited" pod-bot lying with a small spark/smoke particle and a faint beacon glow so it's noticeable at range.
- **Ghost:** translucent, floating bob, soft trail, cyan tint.

### 1.3 Animation (sprite sheets / skeletal)
| Animation | Frames / duration | Notes |
|---|---|---|
| Idle | 4 f loop, subtle bob + antenna sway | |
| Walk | 8 f loop, foot bounce, squash & stretch | Flip sprite for direction |
| Task interact | looping hand/scan pose | Visible "alibi" glow for visible tasks |
| Vent in/out | 6 f hop + lid clang | Visible to line-of-sight players |
| Kill | ~1 s original cinematic, camera punch-in, screen shake, flash | Distinct from official kill animations; 3 variants for variety |
| Death / ghost rise | 12 f | |
| Report | alarm flash + radial wipe to meeting | |
| Eject | ~4 s: character drifts into space, slow spin, star parallax, text reveal | |
| Role reveal | team lineup, camera zoom, color wash (blue crew / red impostor) | |

### 1.4 Lighting & vision (critical for tension)
- **Fog-of-war mask:** soft-edged circular vision with **line-of-sight occlusion** (walls block). Implement with a render texture / shader mask; edge feather ~24 px.
- Sabotage **Lights**: radius shrinks smoothly (tween 0.6 s), vignette tightens, subtle noise/flicker.
- Dynamic **room lighting**: pulsing red emergency lights during Reactor sabotage; flickering fluorescent in some rooms.
- Bodies/impostor vents glow slightly so they're discoverable.

### 1.5 UI visual language
- Rounded panels, high contrast, large readable type (see §7), consistent iconography (SVG icons, 2 px strokes).
- Fonts: one display font for titles (e.g., a bold rounded sci-fi face) + one highly legible UI font; **self-host** fonts (OFL/CC licensed), subset them.
- **Screens:**
  1. **Home:** logo, `Create room` / `Join with code` (big 5-box code input, auto-uppercase, paste-friendly), settings gear (audio/haptics/a11y).
  2. **Lobby:** room code huge + copy/share button (uses `navigator.share` on Android), player list with color pods, **AI seats** with persona chip + "AI" badge, host controls (AI count, difficulty/aggression, map, timers, cost cap indicator), Start button, "Ready" state.
  3. **Game HUD:** joystick (left), action buttons (right: **USE / KILL / VENT / REPORT / SABOTAGE**), task list (collapsible), progress bar (crew), minimap (tap to open full map), sabotage alert banner, cooldown ring on KILL.
  4. **Meeting:** top timer + phase label, chat feed (bubbles with color pod + name), **typing indicators** (AI ones delayed/natural), quick-chat chips for fast phone input ("where?", "who?", "sus", "I was in {room}"), vote grid of players (tap to vote, confirm), live "voted" ticks (not who).
  5. **Vote result:** dramatic reveal one-by-one, tally bars, ejected player text ("X was ejected" — whether they were an impostor is a host setting).
  6. **End screen:** winners banner → **Reveal** (roles, **which AI seat used which model**, kill timeline, best liar etc.) → Replay / Play again.
  7. **Replay (God View):** timeline scrubber, speed control, thought bubbles of AIs.

---

## 2. Audio

### 2.1 Technical
- WebAudio API via Howler.js (or equivalent). **Unlock on first user tap**; show "tap to enable sound" if blocked.
- Formats: `.ogg` + `.m4a` fallback; stream music, preload SFX in sprite sheets; total initial audio < 1.5 MB, rest lazy-loaded.
- Audio buses: **Master / Music / SFX / UI / Voice** with separate sliders in Settings. Music **ducks** during meetings' vote reveal and kill stingers.
- **Positional audio:** footsteps, doors, vents, and task sounds pan/attenuate by distance to the listener (max audible ~8 tiles); sound is *information* in this game.
- Pause/mute when tab hidden; resume gracefully.

### 2.2 Music (original or CC0; looped, seamless)
| Cue | Mood |
|---|---|
| Lobby | relaxed synth, playful, 90 BPM |
| Gameplay ambience | low drone + sparse pulses, tension scales with game state (fewer crew alive/time pressure → add layers) |
| Meeting | tense suspenseful loop, ticking undertone, intensity rises in last 10 s |
| Vote reveal | drum rolls → sting |
| Eject | sparse eerie pad |
| Win / Lose stingers | ~4 s each, distinct for Crew vs Impostor win |
| Sabotage | urgent pulse layer over ambience |

### 2.3 SFX list (all original/CC0; each with 2–3 variations to avoid repetition)
Footsteps (per floor type: metal, carpet, grating) · door open/close/lock · vent open/clang · task start/progress/complete · all-tasks-done chime · kill stinger (short, punchy, unmistakable) · body discovered alarm · emergency button slam · meeting gong/whoosh · chat message pop · typing tick · vote lock-in · vote reveal tick · eject whoosh · sabotage siren (lights buzz, reactor klaxon, door slam) · fix-sabotage success · role-reveal swell · UI tap/hover/back · cooldown ready ping · ghost whisper ambient.
- **Mix targets:** dialogue/UI clear, loudest peaks −3 dBFS, integrated loudness roughly −16 LUFS for music/ambience, no clipping.

### 2.4 Voice (stretch, high-impact)
- Optional **TTS for AI chat lines** during meetings (toggle in settings, default off): each AI seat gets a distinct voice via `speechSynthesis` (free, on-device) or a cloud TTS if the owner provides a key. Queue lines so they don't overlap; show captions always.
- Never speak human players' chat unless they opt in.

### 2.5 Sourcing (no copying official audio)
- Use CC0/permissive libraries (e.g., Kenney, OpenGameArt CC0, Freesound CC0 only) or generate/synthesize original sounds (e.g., jsfxr/ChipTone style, or AI audio tools whose licenses allow use). Log each file in `THIRD_PARTY.md`.

---

## 3. Haptics (Android Chrome via Vibration API; iOS Safari doesn't support — degrade silently)

- Feature-detect `navigator.vibrate`; settings toggle **Haptics: Off / Light / Full** (default Full on touch devices). Respect `prefers-reduced-motion` (default Light).
- Vibrate only on **user-gesture-triggered or active-tab** contexts; never during meetings' idle.

| Event | Pattern (ms) |
|---|---|
| UI tap / button press | `[8]` |
| Task step done | `[15]` |
| Task completed | `[25, 30, 40]` |
| Kill executed (impostor) | `[70, 30, 120]` |
| Being killed | `[200, 60, 300]` |
| Body discovered / report | `[150, 60, 150]` |
| Emergency meeting called | `[120, 50, 120, 50, 250]` |
| Vote cast | `[20]` |
| Vote reveal tick | `[10]` per tick |
| Ejected (you) | `[400]` |
| Sabotage start | repeating `[80, 120]` ×3 |
| Sabotage fixed | `[30, 40, 30]` |
| Your turn to chat / mentioned by name | `[25, 40, 25]` |
| Win | `[40, 40, 40, 40, 120]` |
| Lose | `[300]` |

- Haptics manager module: `haptics.play("kill")`, centralized, throttled (≥50 ms between patterns), mutable.

---

## 4. Game feel ("juice")

- **Camera:** smooth follow (lerp ~0.12), look-ahead, small zoom-punch on kill/report, screen shake presets (light/medium/heavy) with a reduce-motion override.
- **Hit-stop** 60–90 ms on kills; chromatic flash overlay for 150 ms.
- **Particles:** dust on walking, sparks on body, confetti on win, vent steam, task completion bursts, ambient floating dust in light shafts.
- **Tweening/easing:** every UI element animates in/out (back-out ease for pop-ins, 150–250 ms). No hard pops.
- **Button feedback:** scale 0.95 on press, ripple, sound + haptic together.
- **Cooldown ring** and clear disabled states; **context-sensitive USE button** that changes icon/label (Task / Report / Vent / Open).
- **Meeting transitions:** radial wipe in, characters slide in around a table, name tags pop; vote result drumroll → reveal.
- **Typing indicators** and chat bubbles pop in with a soft bounce.
- **Sabotage drama:** red pulse, siren, banner slide-in, objective arrows on the HUD pointing to fix locations.

---

## 5. Controls & input

- **Mobile (primary):** left **virtual joystick** (floating or fixed; setting), right-hand action buttons ≥ **56 px**, spaced ≥ 12 px; touch targets everywhere ≥ **48 px**. Landscape-locked layout with a "rotate your phone" prompt in portrait. Prevent pinch-zoom, double-tap zoom, pull-to-refresh, text selection; `touch-action: none` on the canvas.
- **Safe areas:** respect notches (`env(safe-area-inset-*)`), `viewport-fit=cover`.
- **Desktop:** WASD/arrows to move, `E`/Space = USE, `Q` = KILL, `R` = REPORT, `V` = VENT, `Tab` = map, `Enter` = chat. Mouse click on HUD buttons works too. Gamepad optional.
- **Latency feel:** client-side prediction for own movement with server reconciliation; own character never feels delayed.
- **PWA:** web app manifest + icons + `display: fullscreen`/`standalone`, "Add to Home Screen" prompt after first game; theme color; splash screen. Basic service worker caching of static assets (not WebSocket traffic).
- **Wake lock:** request `navigator.wakeLock` during games so the phone doesn't sleep.

---

## 6. Performance & reliability targets

| Metric | Target |
|---|---|
| Frame rate | **60 fps** on a mid-range Android (e.g., ~Snapdragon 6-series class), auto-drop to a **30 fps "Battery" mode** if frame time degrades |
| First load (4G) | initial JS+assets ≤ **3 MB gzip**, interactive < **4 s**; rest lazy-loaded |
| Join code → in lobby | < **3 s** (plus Render cold-start handling with friendly "Waking up the station…" screen) |
| Network | ≤ **6 KB/s** per client average; state delta-compressed; interpolation buffer ~100 ms |
| Input latency | local movement response < 50 ms (prediction) |
| Memory | < 300 MB on mobile after 3 consecutive games; no leaks (pool objects, destroy scenes cleanly) |
| Battery | ≤ ~10%/15 min of play on a typical phone in Battery mode |
| Crash-free sessions | ≥ 99% across playtests |

Techniques: **texture atlases**, sprite pooling, culling off-screen objects, baked static lighting where possible, avoid per-frame allocations, cap particles (e.g., 150 on mobile), use WebGL, compress audio, preconnect/preload critical assets, code-split scenes.

---

## 7. Accessibility & inclusivity

- **Color-blind modes** (deuteranopia/protanopia/tritanopia palettes) + per-color symbols (§1.2).
- **Text:** min 16 px UI text on mobile, chat font size slider (S/M/L/XL), strong contrast (WCAG AA ≥ 4.5:1).
- **Reduce motion** toggle: disables screen shake/flashes/parallax; **photosensitivity safety:** no flashing >3 Hz; sabotage flashes limited & optional.
- **Captions** for important audio cues (alarms, sabotage, kill nearby) as on-screen icons/text.
- **One-handed mode** for mobile (mirrors layout; compact buttons).
- **Hold-vs-tap options** for task minigames; generous timing; no minigame requires precision under 100 ms.
- Localization-ready: all strings in a dictionary file (en first; hi/ja later is a nice touch).

---

## 8. AI-presence UX (what makes this game unique)

- Every AI seat has: a **name, color, and persona chip** (e.g., "Analyst", "Chaos Gremlin"), plus a tiny **"AI" badge**. The underlying **model is hidden until the post-game reveal**.
- **Human-like pacing:** typing indicator appears *before* messages, duration ∝ length; occasional "…" pauses; never instant replies; messages don't arrive in perfectly regular beats.
- **Thought-free during play:** the player never sees AI thoughts live (they're shown only in Replay/God View).
- **Mentions:** tapping a player name in chat inserts `@name`; AI replies prioritize being addressed.
- **Reactions:** quick emote reactions in meetings (👀 🤔 😂 💀); AIs use them sparingly.
- **Fair play cues:** a small "fog-of-war" icon in settings explains that AIs only know what they could see.
- **Loading/waiting moments:** funny flavor lines ("Teaching the AIs to lie… for science", "Calibrating suspicion…"). Keep humor light and in the owner's casual tone.

---

## 9. Asset production pipeline (owner draws nothing)

1. **Placeholder-first:** generate simple vector/pixel placeholders procedurally so gameplay works immediately; all assets referenced through `assets/manifest.json` + a **single atlas** per category so final art is a drop-in swap.
2. **Final art options (agent decides, logs in THIRD_PARTY.md):** (a) CC0/permissive packs (e.g., Kenney-style tilesets/UI), recolored and combined into a coherent style; (b) AI-assisted generation of concepts → cleaned/vectorized sprites; (c) procedural/SVG-drawn pod-bots with code-generated color variants.
3. Spritesheets packed with TexturePacker-free tooling (e.g., `free-tex-packer`), power-of-two atlases, ≤ 2048×2048.
4. Audio: normalize, trim silence, loop-point check, export ogg+m4a.
5. **Asset license ledger** is mandatory — no file ships without an entry.

---

## 10. Quality gates (QA checklist — mark each PASS/FAIL with notes)

**Visual**
- [ ] Characters readable at 24 px; all 12 colors distinguishable (incl. color-blind modes)
- [ ] Fog-of-war LOS correct; walls occlude; soft edge; Lights sabotage shrink works
- [ ] All animations present (idle, walk, task, vent, kill, death, report, eject, role reveal)
- [ ] No texture bleeding/seams on tilemap at any zoom; no z-order glitches
- [ ] UI never overlaps notches/safe areas; portrait prompt works

**Audio**
- [ ] Audio unlocks on first tap; mute/volume sliders work per bus
- [ ] Positional audio audible and useful; no clipping; music ducking works
- [ ] Every SFX in §2.3 implemented with variations
- [ ] No audio plays when tab hidden

**Haptics**
- [ ] All patterns in §3 fire on correct events on a real Android phone
- [ ] Toggle Off/Light/Full works; iOS/desktop degrade silently

**Controls**
- [ ] Joystick smooth, no stuck input when finger leaves; multi-touch (move + press) works
- [ ] Desktop keyboard map works; context USE button correct in all contexts
- [ ] No accidental zoom/scroll/refresh on mobile

**Gameplay feel**
- [ ] Own movement feels instant; remote players interpolate smoothly on 4G
- [ ] Kill/report/meeting/eject sequences feel dramatic and are < 5 s each
- [ ] Meeting UI usable one-handed; quick-chat chips work; vote can't be double-submitted

**AI presence**
- [ ] AI typing delays natural; no overlapping walls of text; ≤6 messages/AI/meeting
- [ ] AI messages reference real events; no leaks of hidden info
- [ ] Reveal screen shows models, roles, timeline, fun stats; replay God View works

**Performance/reliability**
- [ ] Meets §6 targets on a real mid-range Android + desktop Chrome
- [ ] 3 back-to-back games: no memory growth, no crashes
- [ ] Reconnect within 60 s restores state
- [ ] Render cold-start screen shown and recovers

**Accessibility**
- [ ] Reduce-motion, captions, text-size, color-blind modes work
- [ ] No flashing above safe thresholds

**Compliance**
- [ ] `THIRD_PARTY.md` lists every asset/font/lib with license; nothing from the commercial game
- [ ] Name/branding doesn't use the official logo, colors scheme, fonts, or character likeness

**Release bar:** ≥ 90% PASS, zero S1 failures, no FAIL in Compliance.

---

## 11. Stretch goals (only after v1.0)
- Extra maps and roles (Detective-style, Saboteur-lite), proximity voice chat for humans, hats/cosmetics, spectator link, AI "trash-talk after game" banter, per-model leaderboard across games, Hindi/Japanese UI, Android TWA wrapper for Play-Store-free sideloading.
