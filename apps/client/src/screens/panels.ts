/**
 * M3.5 HUD panels: role card, ability bar, task sheet, task bar, station tools,
 * sabotage pointers and target pickers.
 *
 * All of it is read-only rendering plus a callback per tap; the play screen owns
 * the wiring. Every number shown (cooldown, uses left, refusal reason) comes from
 * the shared tables the server checks against, so the button and the server can
 * never disagree about whether something is allowed.
 */
import {
  ABILITY_SPECS,
  ROLE_LABEL,
  SABOTAGE_SPECS,
  TILE_SIZE,
  WORLD,
  checkAbility,
  refusalText,
  roomAt,
  type AbilityClock,
  type AbilityId,
  type SabotageKind,
} from '@aimong/shared';
import { el } from '../lib/dom.js';
import type { LobbyView, PlayerRow, SecretRow, ToolRow } from '../net/session.js';

export interface PanelContext {
  view(): LobbyView | null;
  me(): PlayerRow | undefined;
  secret(): SecretRow | null;
  send(type: string, payload?: unknown): void;
}

const CATEGORY_LABEL: Record<string, string> = {
  common: 'Common',
  short: 'Short',
  long: 'Long',
  visual: 'Visual',
};

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tileCentre(tile: { x: number; y: number }): { x: number; y: number } {
  return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: tile.y * TILE_SIZE + TILE_SIZE / 2 };
}

function secondsLeft(until: number): number {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

// --------------------------------------------------------------- role card

export interface RoleCard {
  node: HTMLElement;
  update(): void;
}

/**
 * "You are the Patch" — shown for a few seconds when the round starts and any
 * time the role chip is tapped. The summary text comes from the shared role
 * table, so the rules printed here are the rules the server enforces.
 */
export function createRoleCard(ctx: PanelContext): RoleCard & { showFor(ms: number): void; hide(): void } {
  const title = el('strong', { class: 'role-title', text: 'Crew' });
  const summary = el('p', { class: 'role-summary' });
  const numbers = el('div', { class: 'role-numbers' });
  const mates = el('div', { class: 'role-mates' });
  const hint = el('p', { class: 'role-hint', text: 'Tap your role chip any time to read this again.' });
  const close = el('button', {
    class: 'btn btn-ghost',
    type: 'button',
    text: 'Got it',
    on: { click: () => hide() },
  });
  const node = el('div', { class: 'role-card hidden' }, [
    el('div', { class: 'role-head' }, [title, el('span', { class: 'chip', text: 'Your role' })]),
    summary,
    numbers,
    mates,
    hint,
    close,
  ]);

  let timer = 0;
  function hide(): void {
    window.clearTimeout(timer);
    node.classList.add('hidden');
  }
  function showFor(ms: number): void {
    node.classList.remove('hidden');
    window.clearTimeout(timer);
    timer = window.setTimeout(hide, ms);
  }
  function update(): void {
    const secret = ctx.secret();
    if (!secret) return;
    const roleId = secret.roleId || (secret.role === 'impostor' ? 'impostor' : 'crewmate');
    title.textContent = `You are ${secret.label ?? ROLE_LABEL[roleId as keyof typeof ROLE_LABEL] ?? 'Crew'}`;
    title.dataset.role = roleId;
    summary.textContent = secret.summary ?? '';
    const params = secret.params ?? {};
    numbers.replaceChildren(
      ...Object.entries(params)
        .filter(([key]) => /sec|tiles/i.test(key))
        .map(([key, value]) =>
          el('span', {
            class: 'role-number',
            text: `${key.replace(/([A-Z])/g, ' $1').replace(/Sec$/, 's').trim()}: ${value}`,
          }),
        ),
    );
    mates.replaceChildren(
      ...(secret.role === 'impostor'
        ? [
            el('div', {
              class: 'role-mate-line',
              text:
                secret.mates.length > 0
                  ? `Your side: ${secret.mates.map((m) => m.name).join(', ')}`
                  : 'You are the only impostor.',
            }),
          ]
        : []),
    );
  }
  return { node, update, showFor, hide };
}

// -------------------------------------------------------------- ability bar

interface AbilityButton {
  spec: (typeof ABILITY_SPECS)[AbilityId];
  clock: AbilityClock;
}

function clockFor(secret: SecretRow | null, id: AbilityId): AbilityClock {
  const found = secret?.abilities.find((a) => a.id === id);
  return { readyAt: found?.readyAt ?? 0, activeUntil: found?.activeUntil ?? 0, usesLeft: found?.usesLeft ?? 0 };
}

/**
 * One button per ability the private packet lists, plus the station tools. The
 * clock is drawn from the server's own numbers; a disabled button always says
 * why in its sub-label (that text is the shared `refusalText`).
 */
export function createAbilityBar(
  ctx: PanelContext,
  hooks: { onPickTarget(id: AbilityId): void; onNotice(text: string): void },
): { node: HTMLElement; update(): void } {
  const node = el('div', { class: 'ability-bar hidden' });
  let signature = '';

  function describe(button: AbilityButton): { label: string; sub: string; tone: string; disabled: boolean; active: boolean } {
    const { spec, clock } = button;
    const me = ctx.me();
    const view = ctx.view();
    const secret = ctx.secret();
    const now = Date.now();
    const roleId = (secret?.roleId ?? 'crewmate') as never;
    const roomId = me ? (roomAt(WORLD, me.x, me.y)?.id ?? '') : '';
    const refusal = me
      ? checkAbility(spec, clock, now, {
          role: roleId,
          alive: me.alive,
          isGhost: me.isGhost,
          inMeeting: view?.meeting.active === true,
          room: roomId,
        })
      : 'dead';
    const active = clock.activeUntil > now;
    let sub = spec.hint;
    if (active) sub = `${secondsLeft(clock.activeUntil)}s left · tap to stop`;
    else if (refusal === 'cooldown') sub = `${secondsLeft(clock.readyAt)}s`;
    else if (refusal) sub = refusalText(refusal);
    else if (spec.usesPerRound > 0) sub = `${clock.usesLeft} left this round`;
    return {
      label: spec.label,
      sub,
      tone: active ? 'active' : spec.postMortem ? 'ghost' : 'ready',
      disabled: refusal !== null && !active,
      active,
    };
  }

  function update(): void {
    const secret = ctx.secret();
    const me = ctx.me();
    const view = ctx.view();
    if (!secret || !me || !view || view.phase !== 'PLAY') {
      node.classList.add('hidden');
      node.replaceChildren();
      signature = '';
      return;
    }
    const buttons: AbilityButton[] = secret.abilities.map((a) => ({
      spec: ABILITY_SPECS[a.id as AbilityId],
      clock: clockFor(secret, a.id as AbilityId),
    }));
    const key = buttons
      .map((b) => `${b.spec.id}:${b.clock.readyAt > Date.now() ? Math.ceil((b.clock.readyAt - Date.now()) / 1000) : 0}:${b.clock.activeUntil > Date.now() ? 1 : 0}:${b.clock.usesLeft}`)
      .join('|');
    if (key !== signature) {
      signature = key;
      node.replaceChildren(
        ...buttons.map((button) => {
          const info = describe(button);
          const btn = el('button', {
            class: `ability ${info.tone}`,
            type: 'button',
            title: button.spec.hint,
            on: {
              click: () => {
                if (info.active) {
                  ctx.send('abilityEnd', { id: button.spec.id });
                  return;
                }
                if (button.spec.id === 'shield' || button.spec.id === 'shift') {
                  hooks.onPickTarget(button.spec.id);
                  return;
                }
                ctx.send('ability', { id: button.spec.id });
              },
            },
          });
          btn.append(el('span', { class: 'ability-label', text: info.label }), el('span', { class: 'ability-sub', text: info.sub }));
          (btn as HTMLButtonElement).disabled = info.disabled;
          btn.dataset.ability = button.spec.id;
          return btn;
        }),
      );
    }
    node.classList.toggle('hidden', buttons.length === 0);
  }

  return { node, update };
}

// ------------------------------------------------------------- target picker

export function createTargetPicker(ctx: PanelContext): {
  node: HTMLElement;
  open(id: AbilityId): void;
  close(): void;
  isOpen(): boolean;
} {
  const title = el('strong', { text: 'Pick a crewmate' });
  const list = el('div', { class: 'target-list' });
  const node = el('div', { class: 'target-sheet hidden' }, [
    el('div', { class: 'sheet-title-row' }, [
      title,
      el('button', { class: 'btn btn-ghost small', type: 'button', text: 'Close', on: { click: () => close() } }),
    ]),
    list,
  ]);
  let open = false;

  function close(): void {
    open = false;
    node.classList.add('hidden');
  }

  function openWith(id: AbilityId): void {
    const me = ctx.me();
    const view = ctx.view();
    const secret = ctx.secret();
    if (!me || !view) return;
    open = true;
    title.textContent = id === 'shield' ? 'Ward which crewmate?' : 'Shift into which crewmate?';
    // Only seats the server would accept: alive, not yourself, and (for the
    // ward) crew. Ranges are checked server-side and reported truthfully.
    const candidates = view.players.filter((p) => p.alive && p.id !== me.id && p.rolePublic !== 'impostor');
    list.replaceChildren(
      ...candidates.map((player) =>
        el(
          'button',
          {
            class: 'target-row',
            type: 'button',
            on: {
              click: () => {
                ctx.send('ability', { id, target: player.id });
                close();
              },
            },
          },
          [
            el('span', { class: `target-dot ${player.color}` }),
            el('span', { text: player.name }),
            el('span', { class: 'target-dist', text: `${Math.round(dist(me, player) / TILE_SIZE)} tiles` }),
          ],
        ),
      ),
    );
    if (candidates.length === 0) list.replaceChildren(el('div', { class: 'dim', text: 'Nobody to pick.' }));
    node.classList.remove('hidden');
    void secret;
  }

  return { node, open: openWith, close, isOpen: () => open };
}

// ---------------------------------------------------------------- task sheet

export function taskSheet(secret: SecretRow | null): HTMLElement {
  const tasks = secret?.tasks ?? [];
  const done = tasks.filter((t) => t.done).length;
  const categories = ['common', 'short', 'long', 'visual'] as const;
  const chips = categories.map((category) => {
    const group = tasks.filter((t) => (t.category ?? 'short') === category);
    return el('span', {
      class: `task-chip${group.every((t) => t.done) && group.length > 0 ? ' done' : ''}`,
      text: `${CATEGORY_LABEL[category]} ${group.filter((t) => t.done).length}/${group.length}`,
    });
  });

  const rows = tasks.map((task) => {
    const stages = task.stages ?? 1;
    const stage = Math.min(stages, (task.stage ?? 0) + (task.done ? 1 : 0));
    return el('div', { class: `task-row${task.done ? ' done' : ''}` }, [
      el('span', { class: 'task-room', text: WORLD.rooms.find((r) => r.id === task.room)?.name ?? task.room }),
      el('span', { class: 'task-name', text: task.minigame }),
      stages > 1
        ? el('span', {
            class: `task-stage${stage >= stages ? ' full' : ''}`,
            text: `stage ${Math.min(stage, stages)}/${stages}`,
          })
        : el('span', { class: 'task-stage', text: CATEGORY_LABEL[task.category ?? 'short'] ?? '' }),
      el('span', { class: 'task-state', text: task.done ? '✓' : '•' }),
    ]);
  });

  return el('div', { class: 'task-sheet-body' }, [
    el('div', { class: 'sheet-title', text: `${done} of ${tasks.length} tasks done` }),
    el('div', { class: 'task-chips' }, chips),
    ...(rows.length > 0 ? rows : [el('div', { class: 'task-row', text: 'No tasks — you are not crew.' })]),
  ]);
}

// ------------------------------------------------------------------ task bar

/** Crew task progress. Honours the host's always / meetings / never setting. */
export function createTaskBar(ctx: PanelContext): { node: HTMLElement; update(): void } {
  const fill = el('div', { class: 'task-bar-fill' });
  const label = el('span', { class: 'task-bar-label', text: 'Tasks' });
  const node = el('div', { class: 'task-bar hidden' }, [label, el('div', { class: 'task-bar-track' }, [fill])]);

  function update(): void {
    const view = ctx.view();
    const secret = ctx.secret();
    if (!view || !secret) {
      node.classList.add('hidden');
      return;
    }
    const mode = view.settings.taskBarMode;
    const visible = view.taskBarVisible && (mode === 'always' || (mode === 'meetings' && view.meeting.active));
    node.classList.toggle('hidden', !visible);
    if (!visible) return;
    const total = Math.max(1, secret.tasks.length);
    const done = secret.tasks.filter((t) => t.done).length;
    fill.style.width = `${Math.round((done / total) * 100)}%`;
    label.textContent = `Tasks ${done}/${total}`;
  }

  return { node, update };
}

// --------------------------------------------------------------- station tool

export function createToolSheet(): { node: HTMLElement; show(tool: ToolRow): void; hide(): void } {
  const title = el('strong');
  const list = el('div', { class: 'tool-rows' });
  const node = el('div', { class: 'tool-sheet hidden' }, [
    el('div', { class: 'sheet-title-row' }, [
      title,
      el('button', { class: 'btn btn-ghost small', type: 'button', text: 'Close', on: { click: () => node.classList.add('hidden') } }),
    ]),
    list,
  ]);

  const TITLES: Record<string, string> = {
    admin: 'Admin table — heads per room',
    camera: 'Security cameras',
    doorlog: 'Door log',
    vitals: 'Vitals — who is alive',
  };

  function show(tool: ToolRow): void {
    title.textContent = TITLES[tool.id] ?? tool.id;
    list.replaceChildren(...tool.rows.map((row) => el('div', { class: 'tool-row', text: row })));
    if (tool.rows.length === 0) list.replaceChildren(el('div', { class: 'dim', text: 'Nothing to show yet.' }));
    node.classList.remove('hidden');
  }

  return { node, show, hide: () => node.classList.add('hidden') };
}

// ------------------------------------------------------- sabotage pointers

/**
 * Where to run when the station is failing. Arrows are relative to the screen so
 * a phone player can follow them without reading a map legend.
 */
export function sabotageHints(ctx: PanelContext): HTMLElement {
  const node = el('div', { class: 'sab-hints' });
  const view = ctx.view();
  const me = ctx.me();
  if (!view || !me || !view.sabotage.kind) return node;
  const spec = SABOTAGE_SPECS[view.sabotage.kind as SabotageKind];
  if (!spec) return node;
  const spots = spec.fixSpots
    .map((id) => WORLD.taskSpots.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s) && !view.sabotage.fixed.includes(s!.id));
  for (const spot of spots) {
    const centre = tileCentre(spot.tile);
    const angle = Math.atan2(centre.y - me.y, centre.x - me.x);
    const arrow = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][
      Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8
    ];
    node.append(
      el('div', { class: 'sab-hint' }, [
        el('span', { class: 'sab-arrow', text: arrow ?? '→' }),
        el('span', { text: WORLD.rooms.find((r) => r.id === spot.room)?.name ?? spot.room }),
        el('span', { class: 'sab-dist', text: `${Math.round(dist(me, centre) / TILE_SIZE)} tiles` }),
      ]),
    );
  }
  return node;
}
