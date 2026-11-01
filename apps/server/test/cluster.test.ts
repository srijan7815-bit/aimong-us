import { describe, expect, it } from 'vitest';
import { Commons } from '../src/cluster/commons.js';

describe('Commons (the AI cluster’s home ground)', () => {
  it('seats one resident per persona from config, named and tiered', () => {
    const c = new Commons();
    const snap = c.snapshot();
    expect(snap.residents.length).toBeGreaterThanOrEqual(6);
    expect(snap.residents.every((r) => r.name.length > 0 && r.status === 'idle')).toBe(true);
    // Statuses are honest: nothing is in a room before a team code is sent.
    expect(snap.residents.some((r) => r.roomCode !== null)).toBe(false);
  });

  it('says it has no voice instead of faking resident replies', () => {
    const c = new Commons();
    const { recipients } = c.ownerSay('behave tonight');
    expect(recipients.length).toBe(c.snapshot().residents.length);
    const feed = c.snapshot().messages;
    expect(feed.some((m) => m.from === 'owner' && m.text === 'behave tonight')).toBe(true);
    expect(feed.some((m) => m.text.includes('No voice connected'))).toBe(true);
    expect(feed.some((m) => m.from === 'resident')).toBe(false);
  });

  it('addresses a subset when asked', () => {
    const c = new Commons();
    const two = c.snapshot().residents.slice(0, 2).map((r) => r.id);
    const { message, recipients } = c.ownerSay('you two, take point', two);
    expect(recipients).toEqual(two);
    expect(message.to).toEqual(two);
  });

  it('sends residents to a team code, marks them in-game, then brings them home', () => {
    const c = new Commons();
    const sent = c.dispatch({ code: 'abcde', seats: 3 });
    expect(sent.code).toBe('ABCDE');
    expect(sent.sent.length).toBe(3);

    const takenForRoom = c.takeForRoom('ABCDE', 3);
    expect(takenForRoom.length).toBe(3);
    c.markJoined('ABCDE', takenForRoom.map((r) => r.id));

    const inGame = c.snapshot().residents.filter((r) => r.status === 'in-game');
    expect(inGame.length).toBe(3);
    // Residents already in a room are not sent to a second one.
    const again = c.dispatch({ code: 'FFFFF', seats: 9 });
    expect(again.sent.length).toBe(c.snapshot().residents.length - 3);

    c.releaseRoom('ABCDE');
    expect(c.snapshot().residents.filter((r) => r.status === 'in-game').length).toBe(0);
  });

  it('records the last dispatch so the console can show it', () => {
    const c = new Commons();
    c.dispatch({ code: 'KXQ7M', seats: 2, note: 'hi' });
    const snap = c.snapshot();
    expect(snap.lastDispatch?.code).toBe('KXQ7M');
    expect(snap.lastDispatch?.sent).toBe(2);
    expect(snap.messages.some((m) => m.text === 'hi')).toBe(true);
  });
});
