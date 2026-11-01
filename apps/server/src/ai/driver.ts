/**
 * Residents' hands (the "body" half of the brain/body split, PLAN §6).
 *
 * The driver owns everything deterministic: walking, arriving, pressing the
 * task console, stabbing, reporting, voting, sabotaging. It asks the model for
 * words and for a coarse intent every few seconds, but it validates everything
 * the model says against server truth before acting on it — a resident that
 * hallucinates `kill Mira` when Mira is its own teammate must not work.
 *
 * Rules live in GameRoom; this file only has permission to *ask* the room to do
 * things through AiPort, so there is exactly one implementation of every rule.
 */
import { steerAlongPath, type PathNode } from '@aimong/shared';
import { systemPrompt, userPrompt, parseDecision, type AiBodyView, type AiSeatView, type AiTaskView, type Observation } from './brain.js';
import type { LlmGateway } from './llm.js';
import { personaFor } from './personas.js';
import { logger } from '../logger-instance.js';

export interface AiPort {
  now(): number;
  phase(): string;
  practice(): boolean;
  ghostChatEnabled(): boolean;
  killRangePx(): number;
  selfById(id: string): AiSeatView | null;
  seats(): AiSeatView[];
  bodies(): AiBodyView[];
  sabotage(): { kind: string; label: string; endsAt: number; fixSpots: string[] };
  meeting(): { active: boolean; stage: string; endsAt: number; votesCast: number; votersAlive: number };
  chat(limit: number): Array<{ from: string; text: string }>;
  tasksOf(id: string): AiTaskView[];
  roleOf(id: string): { role: import('@aimong/shared').RoleId; team: 'crew' | 'impostor'; fellows: string[] };
  spot(spotId: string): { x: number; y: number } | null;
  /** Station room name at a position ("Cargo Bay"), so residents can say where. */
  roomAt(x: number, y: number): string;
  sees(id: string, x: number, y: number): boolean;
  pathTo(id: string, x: number, y: number): PathNode[] | null;
  /** Where an impostor would look for crew, and where the resident wanders. */
  patrolSpots(): Array<{ id: string; x: number; y: number }>;
  move(id: string, x: number, y: number): void;
  say(id: string, text: string): void;
  doTask(id: string, taskId: string): boolean;
  kill(id: string, targetId: string): boolean;
  report(id: string, bodyId: string): boolean;
  vote(id: string, target: string | null): void;
  sabotageAction(id: string, kind: string): boolean;
  fix(id: string, spotId: string): boolean;
  hasVoted(id: string): boolean;
}

type GoalKind = 'task' | 'fix' | 'hunt' | 'report' | 'patrol';

interface Goal {
  kind: GoalKind;
  x: number;
  y: number;
  targetId: string;
}

interface SuspicionEntry {
  score: number;
  reason: string;
}

interface Bot {
  id: string;
  name: string;
  goal: Goal | null;
  path: PathNode[] | null;
  pathAt: number;
  nextThinkAt: number;
  nextChatAt: number;
  nextSabotageAt: number;
  thoughtAt: number;
  thinking: boolean;
  seq: number;
  votedThisMeeting: boolean;
  chatsThisMeeting: number;
  ledger: string[];
  suspicion: Map<string, SuspicionEntry>;
  lastVisibleAt: Map<string, number>;
  /** Last decision the model made, kept for the console/debug pages. */
  lastThought: string;
}

/** Per-seat chat budget inside one meeting, and a floor between lines. */
const MEETING_CHATS = 2;
const CHAT_GAP_MS = 4500;

export class AiDriver {
  private bots = new Map<string, Bot>();
  private lastPhase = '';
  private ticks = 0;
  /** Lines said recently, so four residents do not parrot the same sentence. */
  private recentLines = new Map<string, number>();

  constructor(
    private readonly port: AiPort,
    private readonly llm: LlmGateway,
  ) {}

  /** Called on every room tick; cheap unless something is actually due. */
  tick(): void {
    this.ticks++;
    const now = this.port.now();
    const phase = this.port.phase();
    if (phase !== this.lastPhase) {
      this.onPhaseChange(phase, now);
      this.lastPhase = phase;
    }

    for (const seat of this.port.seats()) {
      if (!seat.isAi) continue;
      let bot = this.bots.get(seat.id);
      if (!bot) {
        bot = this.spawn(seat, now);
        this.bots.set(seat.id, bot);
      }
      // Seats can be renamed by the lobby; keep the display name fresh.
      bot.name = seat.name;

      const role = this.port.roleOf(seat.id);
      this.perceive(bot, seat, role.team, now);

      if (phase === 'MEETING') {
        this.meetingStep(bot, seat, role, now);
        this.moveStep(bot, seat, now);
        continue;
      }
      if (phase !== 'PLAY' && phase !== 'LOBBY') {
        this.stop(bot, seat);
        continue;
      }
      if (!seat.alive) {
        this.ghostStep(bot, seat, now);
        continue;
      }
      this.playStep(bot, seat, role, now);
      this.moveStep(bot, seat, now);
      this.thinkStep(bot, seat, role, now);
    }
  }

  /** Console/debug view: what each resident is doing and thinking. */
  snapshot(): Array<{ id: string; name: string; goal: string; thought: string }> {
    return [...this.bots.values()].map((b) => ({
      id: b.id,
      name: b.name,
      goal: b.goal ? `${b.goal.kind}:${b.goal.targetId}` : 'idle',
      thought: b.lastThought,
    }));
  }

  private spawn(seat: AiSeatView, now: number): Bot {
    return {
      id: seat.id,
      name: seat.name,
      goal: null,
      path: null,
      pathAt: 0,
      // Stagger the first thought so four residents never call at once.
      nextThinkAt: now + 1200 + Math.floor(Math.random() * 6000),
      nextChatAt: now + 2500 + Math.floor(Math.random() * 5000),
      nextSabotageAt: now + 25_000,
      thoughtAt: 0,
      thinking: false,
      seq: 0,
      votedThisMeeting: false,
      chatsThisMeeting: 0,
      ledger: [],
      suspicion: new Map(),
      lastVisibleAt: new Map(),
      lastThought: '',
    };
  }

  private onPhaseChange(phase: string, now: number): void {
    for (const bot of this.bots.values()) {
      bot.goal = null;
      bot.path = null;
      bot.votedThisMeeting = false;
      bot.chatsThisMeeting = 0;
      bot.nextChatAt = now + 1500 + Math.floor(Math.random() * 4000);
      if (phase === 'LOBBY' || phase === 'PLAY') {
        // A new round: yesterday's grudges should not survive... mostly.
        if (phase === 'PLAY') {
          bot.ledger = [];
          bot.suspicion.clear();
          bot.lastVisibleAt.clear();
        }
        bot.nextThinkAt = now + 1500 + Math.floor(Math.random() * 5000);
      }
      if (phase === 'MEETING') {
        bot.nextThinkAt = now + 600 + Math.floor(Math.random() * 3000);
      }
    }
    logger.debug({ phase }, 'ai driver phase change');
  }

  // ------------------------------------------------------------- perception

  /** Fog-legal memory: only things this seat can actually see right now. */
  private perceive(bot: Bot, seat: AiSeatView, team: 'crew' | 'impostor', now: number): void {
    for (const other of this.port.seats()) {
      if (other.id === seat.id || !other.alive) continue;
      if (!this.port.sees(seat.id, other.x, other.y)) continue;
      bot.lastVisibleAt.set(other.name, now);
    }
    for (const body of this.port.bodies()) {
      if (!this.port.sees(seat.id, body.x, body.y)) continue;
      const line = `saw ${body.victimName}'s body in ${this.roomNameAt(body.x, body.y)}`;
      if (!bot.ledger.includes(line)) bot.ledger.push(line);
      // Whoever was standing next to a body we found is worth a second look —
      // for a crewmate. An impostor only pretends to care.
      if (team === 'crew') {
        for (const other of this.port.seats()) {
          if (other.id === seat.id || !other.alive) continue;
          // Proximity to the body is the only signal a player gets; humans and
          // residents are treated exactly the same here.
          if (Math.hypot(other.x - body.x, other.y - body.y) > 120) continue;
          this.doubt(bot, other.name, 0.35, 'near the body');
        }
      }
    }
    // Impostors keep a fake ledger line so their stories can reference it.
    if (team === 'impostor') {
      for (const other of this.port.seats()) {
        if (other.id === seat.id || !other.alive) continue;
        if (!this.port.sees(seat.id, other.x, other.y)) continue;
        const line = `${other.name} was near ${this.roomNameAt(other.x, other.y)}`;
        if (!bot.ledger.includes(line) && bot.ledger.length < 12) bot.ledger.push(line);
      }
    }
  }

  private doubt(bot: Bot, name: string, amount: number, reason: string): void {
    const current = bot.suspicion.get(name);
    bot.suspicion.set(name, {
      score: Math.max(-1, Math.min(1, (current?.score ?? 0) + amount)),
      reason: current ? current.reason : reason,
    });
  }

  /** Room label for a position, used only in the resident's own memory lines. */
  private roomNameAt(x: number, y: number): string {
    return this.port.roomAt(x, y);
  }

  // ------------------------------------------------------------------ play

  private playStep(bot: Bot, seat: AiSeatView, role: { role: string; team: 'crew' | 'impostor'; fellows: string[] }, now: number): void {
    // 1. Something on the floor beats everything else.
    const body = this.port.bodies().find((b) => this.port.sees(seat.id, b.x, b.y));
    if (body && role.team === 'crew') {
      const distance = Math.hypot(body.x - seat.x, body.y - seat.y);
      if (distance <= 60) {
        if (this.port.report(seat.id, body.id)) {
          bot.goal = null;
          return;
        }
      } else {
        bot.goal = { kind: 'report', x: body.x, y: body.y, targetId: body.id };
        return;
      }
    }

    const sabotage = this.port.sabotage();
    if (role.team === 'impostor') {
      // Kill anything in reach, but never a teammate and never through a wall.
      const range = this.port.killRangePx();
      const prey = this.port
        .seats()
        .filter(
          (p) =>
            p.alive &&
            p.id !== seat.id &&
            this.port.roleOf(p.id).team === 'crew' &&
            this.port.sees(seat.id, p.x, p.y),
        )
        .sort((a, b) => Math.hypot(a.x - seat.x, a.y - seat.y) - Math.hypot(b.x - seat.x, b.y - seat.y))[0];
      if (prey) {
        const distance = Math.hypot(prey.x - seat.x, prey.y - seat.y);
        if (distance <= range && seat.killReadyAt <= now) {
          if (this.port.kill(seat.id, prey.id)) {
            bot.ledger.push(`killed ${prey.name}`);
            bot.goal = null;
            return;
          }
        }
        if (distance > range * 0.7) {
          bot.goal = { kind: 'hunt', x: prey.x, y: prey.y, targetId: prey.id };
          // Chase the actual body, refreshing the aim point as they move.
          bot.goal.x = prey.x;
          bot.goal.y = prey.y;
          return;
        }
      }
      // Sabotage when nobody is in reach to stab.
      if (!sabotage.kind && now > bot.nextSabotageAt) {
        const pick = ['lights', 'doors', 'comms', 'o2'][Math.floor(Math.random() * 4)] as string;
        if (this.port.sabotageAction(seat.id, pick)) {
          bot.nextSabotageAt = now + 45_000 + Math.floor(Math.random() * 30_000);
          bot.ledger.push(`sabotaged ${pick}`);
          return;
        }
        bot.nextSabotageAt = now + 15_000;
      }
      if (prey) return; // still chasing
      this.patrol(bot, seat);
      return;
    }

    // 2. Crew: a live sabotage outranks tasks.
    if (sabotage.kind && sabotage.fixSpots.length > 0) {
      const fixed = new Set<string>();
      const spots = sabotage.fixSpots
        .map((id) => ({ id, pos: this.port.spot(id) }))
        .filter((s): s is { id: string; pos: { x: number; y: number } } => s.pos !== null && !fixed.has(s.id));
      const nearest = spots
        .map((s) => ({ ...s, d: Math.hypot(s.pos.x - seat.x, s.pos.y - seat.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearest) {
        if (nearest.d <= 52) {
          if (this.port.fix(seat.id, nearest.id)) bot.goal = null;
          return;
        }
        bot.goal = { kind: 'fix', x: nearest.pos.x, y: nearest.pos.y, targetId: nearest.id };
        return;
      }
    }

    // 3. Next unfinished task, nearest first so routes look sane.
    const tasks = this.port.tasksOf(seat.id).filter((t) => !t.done);
    if (tasks.length === 0) {
      this.patrol(bot, seat);
      return;
    }
    const goal = bot.goal;
    const current =
      goal && goal.kind === 'task' ? tasks.find((t) => t.id === goal.targetId) : undefined;
    const chosen = current ?? this.nearestTask(seat, tasks);
    const spot = chosen ? this.port.spot(chosen.spotId) : null;
    if (!chosen || !spot) {
      this.patrol(bot, seat);
      return;
    }
    if (Math.hypot(spot.x - seat.x, spot.y - seat.y) <= 46) {
      if (this.port.doTask(seat.id, chosen.id)) {
        bot.goal = null;
        if (chosen.done) {
          // nothing else to remember: the task bar is the receipt
        }
      }
      return;
    }
    bot.goal = { kind: 'task', x: spot.x, y: spot.y, targetId: chosen.id };
  }

  private nearestTask(seat: AiSeatView, tasks: AiTaskView[]): AiTaskView | null {
    let best: { task: AiTaskView; d: number } | null = null;
    for (const task of tasks) {
      const spot = this.port.spot(task.spotId);
      if (!spot) continue;
      const d = Math.hypot(spot.x - seat.x, spot.y - seat.y);
      if (!best || d < best.d) best = { task, d };
    }
    return best?.task ?? null;
  }

  private patrol(bot: Bot, seat: AiSeatView): void {
    const spots = this.port.patrolSpots();
    if (spots.length === 0) {
      bot.goal = null;
      return;
    }
    // Keep wandering while the current patrol point is still far away.
    if (bot.goal?.kind === 'patrol' && Math.hypot(bot.goal.x - seat.x, bot.goal.y - seat.y) > 70) return;
    const pick = spots[Math.floor(Math.random() * spots.length)] as { id: string; x: number; y: number };
    bot.goal = { kind: 'patrol', x: pick.x, y: pick.y, targetId: pick.id };
  }

  private ghostStep(bot: Bot, seat: AiSeatView, now: number): void {
    // Ghosts of crew keep working their list (server allows it), and everyone
    // dead gets the ghost channel — that is the only chat they have left.
    if (bot.goal) {
      this.moveStep(bot, seat, now);
    }
    if (now > bot.nextChatAt && this.port.ghostChatEnabled() && this.llm.ready) {
      bot.nextChatAt = now + 20_000;
      const task = this.port.tasksOf(seat.id).find((t) => !t.done);
      if (task) {
        const spot = this.port.spot(task.spotId);
        if (spot) bot.goal = { kind: 'task', x: spot.x, y: spot.y, targetId: task.id };
      }
    }
  }

  // -------------------------------------------------------------- meetings

  private meetingStep(bot: Bot, seat: AiSeatView, role: { role: string; team: 'crew' | 'impostor'; fellows: string[] }, now: number): void {
    const meeting = this.port.meeting();
    if (!meeting.active) return;
    this.stop(bot, seat);

    if (meeting.stage === 'VOTING') {
      if (this.port.hasVoted(seat.id) || bot.votedThisMeeting) return;
      // Vote on the strongest suspicion; abstain when nobody looks bad, which is
      // exactly what a careful player does rather than hammering a random name.
      const ranked = [...bot.suspicion.entries()]
        .filter(([name]) => name !== bot.name)
        .sort((a, b) => b[1].score - a[1].score);
      const top = ranked[0];
      const target = top && top[1].score >= 0.25 ? this.idOfName(top[0]) : null;
      this.port.vote(seat.id, target);
      bot.votedThisMeeting = true;
      return;
    }

    // Discussion: the model gets to talk, at a human pace.
    if (now < bot.nextThinkAt || bot.thinking) return;
    if (bot.chatsThisMeeting >= MEETING_CHATS || now < bot.nextChatAt) {
      bot.nextThinkAt = now + 3000;
      return;
    }
    void role;
    void this.think(bot, seat, now, 'meeting');
  }

  private idOfName(name: string): string | null {
    const seat = this.port.seats().find((s) => s.name === name);
    return seat?.id ?? null;
  }

  // -------------------------------------------------------------- thinking

  private thinkStep(bot: Bot, seat: AiSeatView, role: { role: string; team: 'crew' | 'impostor'; fellows: string[] }, now: number): void {
    if (!this.llm.ready) return;
    if (now < bot.nextThinkAt || bot.thinking) return;
    // Play-time thinking is cheap and rare: the body is already competent and
    // every call costs tokens. Meetings are where words matter.
    bot.nextThinkAt = now + 14_000 + Math.floor(Math.random() * 10_000);
    void role;
    void this.think(bot, seat, now, 'play');
  }

  private async think(bot: Bot, seat: AiSeatView, now: number, mode: 'play' | 'meeting'): Promise<void> {
    bot.thinking = true;
    try {
      const role = this.port.roleOf(seat.id);
      const persona = personaFor(seat.id);
      const observation = this.observe(bot, seat, role);
      const reply = await this.llm.complete({
        tier: mode === 'meeting' ? 'smart' : 'fast',
        system: systemPrompt({
          handle: seat.name,
          vibe: persona.vibe,
          crewStyle: persona.crew,
          impostorStyle: persona.impostor,
          role: role.role,
          team: role.team,
          fellows: role.fellows,
        }),
        user: userPrompt(observation),
        maxTokens: mode === 'meeting' ? 180 : 140,
      });
      if (!reply) {
        bot.nextThinkAt = this.port.now() + 4000;
        return;
      }
      const decision = parseDecision(reply.text);
      if (!decision) {
        // A model that will not follow the output contract is not allowed to act.
        bot.nextThinkAt = this.port.now() + 6000;
        return;
      }
      bot.lastThought = decision.thought;
      const line = typeof decision.say === 'string' ? decision.say.trim() : '';
      const inMeeting = this.port.meeting().active;
      const cleaned = this.cleanLine(line);
      if (cleaned && (inMeeting || this.port.phase() === 'LOBBY') && bot.chatsThisMeeting < MEETING_CHATS) {
        if (!this.alreadySaid(cleaned)) {
          this.port.say(seat.id, cleaned);
          bot.chatsThisMeeting++;
          bot.nextChatAt = this.port.now() + CHAT_GAP_MS;
        }
      }
      // Intent is advisory: the body already has a plan, and the model's target
      // is only honoured when it names someone it can legally act on.
      if (decision.intent.kind === 'vote' && decision.intent.target) {
        const target = this.port.seats().find((s) => s.name === decision.intent.target || s.id === decision.intent.target);
        if (target && target.id !== seat.id && role.team === 'crew') {
          this.doubt(bot, target.name, 0.2, 'called out in chat');
        }
      }
      void now;
    } finally {
      bot.thinking = false;
    }
  }

  /** Has the room heard this line (or a near-duplicate) in the last minute? */
  private alreadySaid(line: string): boolean {
    const now = this.port.now();
    for (const [said, at] of [...this.recentLines]) {
      if (now - at > 60_000) this.recentLines.delete(said);
    }
    const key = line.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (key.length === 0) return true;
    for (const said of this.recentLines.keys()) {
      // Cheap near-duplicate test: sharing a six-word window is enough.
      const words = key.split(' ');
      for (let i = 0; i + 6 <= words.length; i++) {
        if (said.includes(words.slice(i, i + 6).join(' '))) return true;
      }
    }
    this.recentLines.set(key, now);
    return false;
  }

  /** Strip anything a phone keyboard would never produce, and cap the length. */
  private cleanLine(text: string): string {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[*_`#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
  }

  private observe(bot: Bot, seat: AiSeatView, role: { role: import('@aimong/shared').RoleId; team: 'crew' | 'impostor'; fellows: string[] }): Observation {
    const meeting = this.port.meeting();
    const visible = this.port
      .seats()
      .filter((p) => p.id !== seat.id && p.alive && this.port.sees(seat.id, p.x, p.y))
      .map((p) => ({
        name: p.name,
        color: p.colorName,
        distance: Math.hypot(p.x - seat.x, p.y - seat.y),
        moving: false,
      }));
    const bodies = this.port
      .bodies()
      .filter((b) => this.port.sees(seat.id, b.x, b.y))
      .map((b) => ({ victimName: b.victimName, distance: Math.hypot(b.x - seat.x, b.y - seat.y) }));
    const chatLines = meeting.active ? this.port.chat(10) : [];
    return {
      phase: this.port.phase(),
      self: {
        name: seat.name,
        role: role.role,
        team: role.team,
        alive: seat.alive,
        fellows: role.fellows,
        tasksLeft: this.port.tasksOf(seat.id).filter((t) => !t.done).length,
        killReadyIn: Math.max(0, Math.ceil((seat.killReadyAt - this.port.now()) / 1000)),
      },
      visible,
      bodies,
      sabotage: this.port.sabotage().label,
      chat: chatLines,
      ledger: bot.ledger,
      suspicion: [...bot.suspicion.entries()].map(([name, v]) => ({ name, score: v.score, reason: v.reason })),
      mentionOfSelf: chatLines.filter((c) => c.text.toLowerCase().includes(bot.name.toLowerCase())).map((c) => c.text),
      secondsLeft: meeting.active ? Math.max(0, Math.round((meeting.endsAt - this.port.now()) / 1000)) : 0,
    };
  }

  // -------------------------------------------------------------- movement

  private moveStep(bot: Bot, seat: AiSeatView, now: number): void {
    const goal = bot.goal;
    if (!goal) {
      this.stop(bot, seat);
      return;
    }
    const distance = Math.hypot(goal.x - seat.x, goal.y - seat.y);
    if (distance <= 20 && goal.kind !== 'hunt') {
      this.stop(bot, seat);
      return;
    }
    if (!bot.path || now - bot.pathAt > 400) {
      bot.path = this.port.pathTo(seat.id, goal.x, goal.y);
      bot.pathAt = now;
    }
    const steer = steerAlongPath(bot.path, seat.x, seat.y, {});
    if (!steer) {
      this.stop(bot, seat);
      bot.goal = null;
      return;
    }
    this.port.move(seat.id, steer.x, steer.y);
  }

  private stop(bot: Bot, seat: AiSeatView): void {
    this.port.move(seat.id, 0, 0);
    void bot;
    void seat;
  }
}
