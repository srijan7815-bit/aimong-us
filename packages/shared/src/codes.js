/**
 * Room codes: 5 chars from an unambiguous alphabet (no 0/O/1/I) per
 * game.defaults.json `room.codeAlphabet`. Codes are spoken out loud and typed
 * on phones, so normalisation is deliberately forgiving.
 */
import { z } from 'zod';
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
/**
 * Characters players type by mistake. 1/I are read as L (L is in the alphabet),
 * while 0 and O cannot be mapped to anything legal and are dropped entirely.
 */
const CONFUSABLES = {
    '1': 'L',
    I: 'L',
};
/**
 * Uppercase, drop punctuation/spaces, map 1/I -> L, and drop anything else that
 * is not a legal code character (0 and O are simply not in the alphabet, so a
 * pasted "KXQ-7M" or a fat-fingered "KX07M" still lands on something sensible).
 */
export function normalizeCode(raw) {
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let out = '';
    for (const ch of cleaned) {
        const mapped = CONFUSABLES[ch] ?? ch;
        if (CODE_ALPHABET.includes(mapped))
            out += mapped;
    }
    return out.slice(0, CODE_LENGTH);
}
export function isValidCode(code) {
    if (code.length !== CODE_LENGTH)
        return false;
    return [...code].every((ch) => CODE_ALPHABET.includes(ch));
}
export const RoomCode = z
    .string()
    .transform(normalizeCode)
    .refine(isValidCode, { message: 'Room code must be 5 characters (no 0/O/1/I)' });
/**
 * Generate a code. `rng` is injectable so tests (and replays) stay deterministic.
 * `taken` lets the caller avoid collisions with live rooms.
 */
export function generateCode(taken = [], rng = Math.random) {
    const draw = () => {
        let out = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)] ?? CODE_ALPHABET[0];
        }
        return out;
    };
    for (let attempt = 0; attempt < 500; attempt++) {
        const candidate = draw();
        if (!taken.includes(candidate))
            return candidate;
    }
    throw new Error('Unable to allocate a unique room code');
}
//# sourceMappingURL=codes.js.map