/**
 * The Commons — the AI cluster's home on the server.
 *
 * Residents are the AI players. They live on the server between games (not just
 * inside one room), carry their persona and, later, their memory. The owner can
 * broadcast to the whole house and hand out a room code ("team code"); residents
 * then walk into that game and take seats in the lobby.
 *
 * Nothing here exposes resident reasoning to ordinary clients: the console is
 * owner-only, and a game room only ever sees public seat data.
 */
import { z } from 'zod';

export const ClusterMessage = z.object({
  id: z.string(),
  /** Who typed it: the owner, a resident, or the system. */
  from: z.enum(['owner', 'resident', 'system']),
  /** Display name (owner handle or resident name). */
  name: z.string(),
  text: z.string().min(1).max(400),
  ts: z.number(),
  /** Residents this line was addressed to (empty = everyone). */
  to: z.array(z.string()).default([]),
});
export type ClusterMessage = z.infer<typeof ClusterMessage>;

export const DispatchRequest = z.object({
  /** Room code the residents should join. */
  code: z.string().min(4).max(8),
  /** How many residents to send; omitted = fill every free seat. */
  seats: z.number().int().min(1).max(9).optional(),
  /** Optional instruction attached to the dispatch (delivered with the invite). */
  note: z.string().max(280).optional(),
});
export type DispatchRequest = z.infer<typeof DispatchRequest>;

export const OwnerMessage = z.object({
  text: z.string().min(1).max(400),
  /** Optional subset of resident ids; empty = the whole house. */
  to: z.array(z.string()).max(12).optional(),
});
export type OwnerMessage = z.infer<typeof OwnerMessage>;

export type ResidentStatus = 'idle' | 'invited' | 'joined' | 'in-game';

export interface ResidentView {
  id: string;
  name: string;
  /** Persona flavour, shown to the owner only. */
  persona: string;
  vibe: string;
  /** Model slot (tier) — the concrete model stays secret until the post-game reveal. */
  tier: 'fast' | 'smart';
  status: ResidentStatus;
  /** Room code this resident is currently in, if any. */
  roomCode: string | null;
  /** True once an LLM provider is wired for this seat (M5). */
  voiceReady: boolean;
}

export interface ClusterSnapshot {
  /** True when at least one LLM provider key is configured. */
  brainOnline: boolean;
  residents: ResidentView[];
  messages: ClusterMessage[];
  /** Room code the house was last sent to. */
  lastDispatch: { code: string; at: number; sent: number } | null;
}
