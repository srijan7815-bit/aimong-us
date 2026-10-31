# HUMANIZE.md — Making AI players act like real people

Implementation spec for the **Persona + Mood + Social Memory + Timing** layers. Personas live in `config/personas.json`; prompts in `prompts/brain.md`.

## 1. Identity
- Each AI seat = one persona (own name/handle, voice, quirks). Names are chosen from persona `handle`s and may get a numeric/underscore variant if duplicated. Colors random.
- In-game the AI is a *person in the lobby*. It never says it's an AI/model. Humans see a small "AI" badge and know; the AI plays along anyway. Model identity is revealed only on the end screen.
- Per game: shuffle personas, **jitter traits ±0.15 (seeded)**, pick 1–2 random **quirks** (e.g., "overuses 'literally'", "always calls a room by a nickname", "hates the Reactor", "superstitious about number 3", "always votes last", "types in bursts"). Store seed in the replay.

## 2. Mood engine (server-side, cheap, no LLM needed)
State: `tension, conf, annoy, amuse` (0–1), decays 5%/10 s toward persona baseline.
| Event | Effect |
|---|---|
| Accused in chat | annoy +0.3, tension +0.2 (×aggr), conf -0.1 (×(1-conf trait)) |
| Defended by someone | annoy -0.2, trust(defender) +0.3 |
| Saw a kill / body | tension +0.5 |
| Joke from someone it likes | amuse +0.3 |
| Correct accusation | conf +0.2 |
| Wrong ejection | conf -0.25, annoy +0.1 |
| Lights/Reactor sabotage | tension +0.3 |
Mood is passed to the Brain each call (and the Brain may nudge it in its output; server clamps changes to ±0.3/call). Mood modulates: message length (tense → shorter), typo rate (×1+tension), caps/emoji, speaking probability, impulsive accusations, and Body behavior (tense → walks faster, avoids being alone).

## 3. Social memory (persisted per game, per agent)
- `trust[playerId]` −1..1, `grudges[]`, `allies[]`, `lastInteraction`.
- Updated by: who accused/defended me, who alibied me, who lied (caught), who sat near me, who voted for me, who I voted for.
- Fed to the Brain every meeting. Produces human behavior: loyalty, grudges ("u voted me last time"), banter with specific friends, protecting an ally, bandwagoning, doubling down.
- Humans: remember their names/colors across rounds; tease and react to what they type.

## 4. Language style rules
- Message length drawn from a distribution around `voice.avgWords` (long tail; ~15% one-word, ~10% two sentences). Hard cap 160 chars.
- Case/emoji/slang/typo rate/tics per persona. Typo model: swap/drop/duplicate a letter with probability `typo × (1+tension)`; ~30% of typos get a follow-up "*fix". Never typo names/colors in a way that breaks parsing.
- Allowed human touches: trailing off ("idk..."), double messages (one thought split in two), questions as accusations, reaction-only messages ("??", "bruh"), occasional misreads corrected on their own, hedges ("i think", "pretty sure") when ledger confidence is low.
- **Banned AI-tells** (filter + regenerate once): "As an AI/language model", "Certainly", "Absolutely", "I understand your concern", "Let's break this down", bullet/numbered lists, bold/markdown, em-dash, "In conclusion", perfect semicolons, more than one exclamation mark unless persona is Zara/Mateo, repeating the previous message's structure.
- **Anti-repeat:** reject messages with >60% n-gram overlap with the agent's last 5 messages or with any other agent's last 3; max 1 identical opener ("ok"/"wait") per agent per meeting.

## 5. Timing (what makes it *feel* human)
- Typing indicator starts after a reaction delay (800–2500 ms, longer when "thinking" about a big accusation), lasts `chars × (40–60 ms)` ± jitter, with an occasional mid-typing pause (stops 1–2 s, resumes) and occasional abandoned drafts (indicator disappears, nothing sent, ~5%).
- Replies to direct mentions within 1.5–5 s; unprompted comments cluster around events (new accusation, body report) rather than a metronome.
- Persona `talk` controls how many speaking slots it requests; quiet personas often `STAY_SILENT` until a decisive moment; loud ones may post 2 messages in a row.
- Votes: not all at the same time; slower/anxious personas vote near the deadline; decisive ones early. Some change their vote once before the lock.

## 6. Play-phase humanization (Body)
Use persona `body` params: reaction delay, random pauses/look-arounds, detours, dawdling after tasks, doing tasks out of efficient order, following a friend for a bit, panicking and fleeing after a body sighting, sticking to groups when scared, curiosity about suspicious rooms. Impostors show nerves: hesitate before kills, sometimes "fake-do" tasks visibly, occasionally walk too fast or stand still too long (and the Brain can exploit being observed doing it).

## 7. Manipulation toolkit (in-game only)
Alibi building, bandwagoning, false confidence, "who actually did a visible task?", pressure ("answer the question"), playing dumb/scared, planting a small false detail among true ones, sacrificing a teammate to save self, reverse psychology, emotional appeals *within the fiction*, redirecting after being accused. Crew toolkit: timeline building, cross-examination, task-proof checks, process of elimination, reading defensiveness, rallying a vote. Persona decides which tools it prefers. Guardrails from `PLAN.md §7.11` always apply.

## 8. Variety enforcement
- Seeded trait jitter + quirks; no two AIs share an opener or catchphrase in a game; vary which models get which personas each game.
- Persona sample lines are **style examples only** — the prompt tells the model never to copy them; server rejects exact matches.

## 9. Evaluation ("does it feel human?")
- Playtesters rate after each game: "Which seats felt most human?" and "Any robotic moments?" → log phrases flagged; add to banned list.
- Metrics per game: unique-opener ratio >0.8, repeat-overlap violations <2, avg message words within ±30% of persona target, silence spread (quiet personas speak <40% as much as loud), accusation accuracy by persona (crew), % of impostors who survive ≥2 meetings.
