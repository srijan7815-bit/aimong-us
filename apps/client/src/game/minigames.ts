/**
 * The twelve task minigames.
 *
 * Each one is a small DOM widget that calls `done()` exactly once when the player
 * solves it, and `cancel()` never — closing the panel mid-task just abandons it.
 * No minigame knows about networking: play.ts owns sending `taskDone` to the
 * server, which independently checks the player is standing on the spot.
 */
import { el } from '../lib/dom.js';
import type { Minigame } from '@aimong/shared';

export interface MinigameHandle {
  node: HTMLElement;
  /** Resolves true when solved, false when the player closed it. */
  result: Promise<boolean>;
  destroy(): void;
  /** Settle the game: true = solved (counts for the task), false = abandoned. */
  finish(ok: boolean): void;
}

const COLORS = ['#e5484d', '#3ba55d', '#4b8bf5', '#ffc53d', '#b06bf0', '#35d6b8'];

function shell(title: string, hint: string, body: HTMLElement, onClose: () => void): MinigameHandle {
  let resolve: (v: boolean) => void = () => undefined;
  const result = new Promise<boolean>((r) => (resolve = r));
  let settled = false;
  const finish = (ok: boolean): void => {
    if (settled) return;
    settled = true;
    resolve(ok);
    onClose();
  };
  const close = finish;
  const node = el('div', { class: 'mg-card' }, [
    el('div', { class: 'mg-head' }, [
      el('strong', { text: title }),
      el('button', { class: 'mg-close', type: 'button', text: '✕', on: { click: () => close(false) } }),
    ]),
    el('div', { class: 'mg-hint', text: hint }),
    body,
  ]);
  return {
    node,
    result,
    destroy: () => node.remove(),
    finish,
  };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

// --------------------------------------------------------------- the games

function wires(solve: () => void, close: () => void): MinigameHandle {
  const left = COLORS.slice(0, 3);
  const right = shuffle(left);
  let picked: string | null = null;
  const pane = el('div', { class: 'mg-wires' });
  const pairs = new Map<string, string>();
  const draw = (): void => {
    pane.replaceChildren();
    const leftCol = el('div', { class: 'mg-col' });
    const rightCol = el('div', { class: 'mg-col' });
    for (const color of left) {
      const wired = [...pairs.entries()].find(([a]) => a === color)?.[1];
      const node = el('button', {
        class: `mg-wire${wired ? ' wired' : ''}${picked === color ? ' picked' : ''}`,
        type: 'button',
        on: {
          click: () => {
            picked = picked === color ? null : color;
            draw();
          },
        },
      });
      node.style.setProperty('--w', color);
      leftCol.append(node);
    }
    for (const color of right) {
      const wired = [...pairs.values()].includes(color);
      const node = el('button', {
        class: `mg-wire${wired ? ' wired' : ''}`,
        type: 'button',
        on: {
          click: () => {
            if (!picked || wired) return;
            pairs.set(picked, color);
            picked = null;
            if (pairs.size === left.length) {
              if (left.every((c) => pairs.get(c) === c)) solve();
              else {
                pairs.clear();
                draw();
              }
            } else draw();
          },
        },
      });
      node.style.setProperty('--w', color);
      rightCol.append(node);
    }
    pane.append(leftCol, rightCol);
  };
  draw();
  const handle = shell('Repair wiring', 'Tap a wire on the left, then its match on the right.', pane, close);
  void handle.result;
  return handle;
}

function hold(solve: () => void, close: () => void): MinigameHandle {
  const bar = el('div', { class: 'mg-bar-fill' });
  const track = el('div', { class: 'mg-bar' }, [bar]);
  const button = el('button', { class: 'mg-big', type: 'button', text: 'Hold to prime' });
  let started = 0;
  let raf = 0;
  const tick = (): void => {
    const progress = Math.min(1, (performance.now() - started) / 2400);
    bar.style.width = `${progress * 100}%`;
    if (progress >= 1) solve();
    else raf = requestAnimationFrame(tick);
  };
  button.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    started = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  });
  const stop = (): void => {
    cancelAnimationFrame(raf);
    if (started) bar.style.width = '0%';
    started = 0;
  };
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);
  const handle = shell('Prime the pump', 'Hold the button until the bar is full.', el('div', { class: 'mg-stack' }, [track, button]), close);
  const original = handle.destroy;
  return Object.assign(handle, { destroy: () => { cancelAnimationFrame(raf); original(); } });
}

function memory(solve: () => void, close: () => void): MinigameHandle {
  const sequence = Array.from({ length: 4 }, () => Math.floor(Math.random() * 4));
  let step = 0;
  let showing = true;
  const grid = el('div', { class: 'mg-grid4' });
  const pads = [0, 1, 2, 3].map((i) => {
    const pad = el('button', { class: 'mg-pad', type: 'button' });
    pad.style.setProperty('--p', COLORS[i] ?? '#4b8bf5');
    pad.addEventListener('click', () => {
      if (showing) return;
      if (sequence[step] === i) {
        step++;
        pad.classList.add('lit');
        setTimeout(() => pad.classList.remove('lit'), 140);
        if (step === sequence.length) solve();
      } else {
        step = 0;
      }
    });
    grid.append(pad);
    return pad;
  });
  const play = (index: number): void => {
    if (index >= sequence.length) {
      showing = false;
      return;
    }
    const pad = pads[sequence[index] ?? 0];
    pad?.classList.add('lit');
    setTimeout(() => {
      pad?.classList.remove('lit');
      setTimeout(() => play(index + 1), 160);
    }, 320);
  };
  setTimeout(() => play(0), 380);
  return shell('Match the panel', 'Watch the four flashes, then repeat them.', grid, close);
}

function swipe(solve: () => void, close: () => void): MinigameHandle {
  const card = el('div', { class: 'mg-card-swipe' });
  const track = el('div', { class: 'mg-track' }, [card]);
  let dragging = false;
  let x = 6;
  const move = (clientX: number): void => {
    const rect = track.getBoundingClientRect();
    const max = rect.width - card.offsetWidth - 12;
    x = Math.max(6, Math.min(max, clientX - rect.left - card.offsetWidth / 2));
    card.style.left = `${x}px`;
    if (x >= max - 1) solve();
  };
  card.addEventListener('pointerdown', (ev) => {
    dragging = true;
    card.setPointerCapture(ev.pointerId);
  });
  card.addEventListener('pointermove', (ev) => {
    if (dragging) move(ev.clientX);
  });
  card.addEventListener('pointerup', () => (dragging = false));
  return shell('Swipe the keycard', 'Drag the card all the way to the right.', track, close);
}

function slider(solve: () => void, close: () => void): MinigameHandle {
  const target = 0.62 + Math.random() * 0.2;
  const zone = el('div', { class: 'mg-zone' });
  zone.style.left = `${target * 100 - 5}%`;
  const needle = el('div', { class: 'mg-needle' });
  const input = el('input', { class: 'mg-slider', type: 'range' }) as HTMLInputElement;
  input.min = '0';
  input.max = '100';
  input.value = '20';
  const update = (): void => {
    const value = Number(input.value) / 100;
    needle.style.left = `${value * 100}%`;
    if (Math.abs(value - target) < 0.045) solve();
  };
  input.addEventListener('input', update);
  const track = el('div', { class: 'mg-slider-track' }, [zone, needle, input]);
  return shell('Align the output', 'Slide until the needle sits inside the marker.', track, close);
}

function sort(solve: () => void, close: () => void): MinigameHandle {
  const weights = shuffle([12, 24, 31, 45, 58]);
  let picked: number[] = [];
  const row = el('div', { class: 'mg-row' });
  const render = (): void => {
    row.replaceChildren();
    for (const weight of weights) {
      const chosen = picked.includes(weight);
      const item = el('button', {
        class: `mg-chip${chosen ? ' picked' : ''}`,
        type: 'button',
        text: String(weight),
        on: {
          click: () => {
            if (chosen) return;
            picked.push(weight);
            if (picked.length === weights.length) {
              const ascending = [...picked].sort((a, b) => a - b);
              if (picked.every((v, i) => v === ascending[i])) solve();
              else {
                picked = [];
                render();
              }
            } else render();
          },
        },
      });
      row.append(item);
    }
  };
  render();
  return shell('Sort the samples', 'Tap the samples from lightest to heaviest.', row, close);
}

function morse(solve: () => void, close: () => void): MinigameHandle {
  const pattern = Array.from({ length: 4 }, () => Math.random() > 0.5);
  let step = 0;
  const dots = el('div', { class: 'mg-row' }, pattern.map((long) => el('span', { class: `mg-dot${long ? ' long' : ''}` })));
  const button = el('button', { class: 'mg-big', type: 'button', text: 'Tap the pattern' });
  button.addEventListener('click', () => {
    if (pattern[step]) return; // need a long press for a dash
    step++;
    if (step === pattern.length) solve();
  });
  button.addEventListener('pointerdown', (ev) => {
    if (!pattern[step]) return;
    ev.preventDefault();
    const timer = setTimeout(() => {
      step++;
      if (step === pattern.length) solve();
    }, 260);
    button.addEventListener('pointerup', () => clearTimeout(timer), { once: true });
  });
  return shell('Repeat the signal', 'Tap short, press long — copy the pattern above.', el('div', { class: 'mg-stack' }, [dots, button]), close);
}

function sequence(solve: () => void, close: () => void): MinigameHandle {
  const order = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let next = 0;
  const grid = el('div', { class: 'mg-grid3' });
  for (const n of order) {
    const cell = el('button', {
      class: 'mg-cell',
      type: 'button',
      text: String(n),
      on: {
        click: () => {
          if (n === next + 1) {
            next++;
            cell.classList.add('lit');
            if (next === 9) solve();
          } else next = 0;
        },
      },
    });
    grid.append(cell);
  }
  return shell('Reset the breakers', 'Tap 1 to 9 in order.', grid, close);
}

function valve(solve: () => void, close: () => void): MinigameHandle {
  const target = 0.3 + Math.random() * 0.4;
  const dial = el('div', { class: 'mg-dial' });
  const knob = el('div', { class: 'mg-knob' });
  dial.append(knob);
  let angle = 0.1;
  let dragging = false;
  const apply = (): void => {
    knob.style.transform = `rotate(${angle * 360}deg)`;
    if (Math.abs(angle - target) < 0.04) solve();
  };
  apply();
  dial.addEventListener('pointerdown', () => (dragging = true));
  dial.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const rect = dial.getBoundingClientRect();
    const dy = rect.top + rect.height / 2 - ev.clientY;
    angle = Math.max(0.02, Math.min(0.98, angle + dy / 400));
    apply();
  });
  dial.addEventListener('pointerup', () => (dragging = false));
  const hint = el('div', { class: 'mg-hint', text: 'Drag up or down to balance the pressure.' });
  return shell('Balance the valves', hint.textContent ?? '', dial, close);
}

function press(solve: () => void, close: () => void): MinigameHandle {
  const fill = el('div', { class: 'mg-bar-fill' });
  const bar = el('div', { class: 'mg-bar' }, [fill]);
  let charge = 0;
  let last = performance.now();
  let raf = 0;
  const decay = (): void => {
    const now = performance.now();
    charge = Math.max(0, charge - (now - last) / 4200);
    last = now;
    fill.style.width = `${charge * 100}%`;
    if (charge >= 1) solve();
    else raf = requestAnimationFrame(decay);
  };
  raf = requestAnimationFrame(decay);
  const button = el('button', {
    class: 'mg-big',
    type: 'button',
    text: 'Tap fast',
    on: {
      click: () => {
        charge = Math.min(1, charge + 0.09);
      },
    },
  });
  const handle = shell('Charge the cell', 'Tap as fast as you can before it drains.', el('div', { class: 'mg-stack' }, [bar, button]), close);
  const original = handle.destroy;
  return Object.assign(handle, { destroy: () => { cancelAnimationFrame(raf); original(); } });
}

function scan(solve: () => void, close: () => void): MinigameHandle {
  const target = el('div', { class: 'mg-target' });
  const marker = el('div', { class: 'mg-marker' });
  const track = el('div', { class: 'mg-scan' }, [target, marker]);
  target.style.left = `${35 + Math.random() * 30}%`;
  let position = 0;
  let direction = 1;
  let raf = 0;
  let misses = 0;
  const move = (): void => {
    position += direction * 0.014;
    if (position > 1) {
      position = 1;
      direction = -1;
    }
    if (position < 0) {
      position = 0;
      direction = 1;
    }
    marker.style.left = `${position * 100}%`;
    raf = requestAnimationFrame(move);
  };
  raf = requestAnimationFrame(move);
  const hit = el('button', {
    class: 'mg-big',
    type: 'button',
    text: 'Scan',
    on: {
      click: () => {
        const zoneLeft = parseFloat(target.style.left) / 100;
        if (Math.abs(position - zoneLeft) < 0.07) solve();
        else {
          misses++;
          if (misses >= 3) {
            position = 0;
            misses = 0;
          }
        }
      },
    },
  });
  const handle = shell('Scan the specimen', 'Tap Scan while the bar is inside the green window.', el('div', { class: 'mg-stack' }, [track, hit]), close);
  const original = handle.destroy;
  return Object.assign(handle, { destroy: () => { cancelAnimationFrame(raf); original(); } });
}

function connect(solve: () => void, close: () => void): MinigameHandle {
  const slots = [0, 1, 2].map((i) => ({ id: i, taken: false }));
  const plugs = shuffle([0, 1, 2]);
  let held: number | null = null;
  const board = el('div', { class: 'mg-connect' });
  const render = (): void => {
    board.replaceChildren();
    const socketCol = el('div', { class: 'mg-col' });
    for (const slot of slots) {
      const node = el('button', {
        class: `mg-socket${slot.taken ? ' filled' : ''}`,
        type: 'button',
        on: {
          click: () => {
            if (held === null || slot.taken) return;
            if (held === slot.id) {
              slot.taken = true;
              held = null;
              if (slots.every((s) => s.taken)) solve();
              else render();
            } else {
              held = null;
              render();
            }
          },
        },
      });
      socketCol.append(node);
    }
    const plugCol = el('div', { class: 'mg-col' });
    for (const plug of plugs) {
      if (slots[plug]?.taken) continue;
      const node = el('button', {
        class: `mg-plug${held === plug ? ' picked' : ''}`,
        type: 'button',
        on: {
          click: () => {
            held = held === plug ? null : plug;
            render();
          },
        },
      });
      node.style.setProperty('--p', COLORS[plug] ?? '#4b8bf5');
      plugCol.append(node);
    }
    board.append(socketCol, plugCol);
  };
  render();
  return shell('Reconnect the array', 'Tap a plug, then the socket with its colour pattern.', board, close);
}

const BUILDERS: Record<Minigame, (solve: () => void, close: () => void) => MinigameHandle> = {
  wires,
  hold,
  memory,
  swipe,
  slider,
  sort,
  morse,
  sequence,
  valve,
  press,
  scan,
  connect,
};

/**
 * Build one minigame.
 *
 * The builders take `solve` (the player won) and `close` (abandon) separately.
 * Both used to be handed the same callback, so *winning* a minigame closed the
 * panel without ever resolving `result` — which meant `taskDone` was never sent
 * and no task could be completed from the world. `solve` now settles the handle.
 */
export function openMinigame(kind: Minigame, onClose: () => void): MinigameHandle {
  const builder = BUILDERS[kind] ?? wires;
  let handle: MinigameHandle | null = null;
  const solve = (): void => handle?.finish(true);
  const close = (): void => onClose();
  handle = builder(solve, close);
  return handle;
}

export const MINIGAME_COUNT = Object.keys(BUILDERS).length;
