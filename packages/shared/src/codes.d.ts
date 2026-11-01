/**
 * Room codes: 5 chars from an unambiguous alphabet (no 0/O/1/I) per
 * game.defaults.json `room.codeAlphabet`. Codes are spoken out loud and typed
 * on phones, so normalisation is deliberately forgiving.
 */
import { z } from 'zod';
export declare const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export declare const CODE_LENGTH = 5;
/**
 * Uppercase, drop punctuation/spaces, map 1/I -> L, and drop anything else that
 * is not a legal code character (0 and O are simply not in the alphabet, so a
 * pasted "KXQ-7M" or a fat-fingered "KX07M" still lands on something sensible).
 */
export declare function normalizeCode(raw: string): string;
export declare function isValidCode(code: string): boolean;
export declare const RoomCode: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
export type Rng = () => number;
/**
 * Generate a code. `rng` is injectable so tests (and replays) stay deterministic.
 * `taken` lets the caller avoid collisions with live rooms.
 */
export declare function generateCode(taken?: readonly string[], rng?: Rng): string;
