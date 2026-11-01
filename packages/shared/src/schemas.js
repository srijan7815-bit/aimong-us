import { z } from 'zod';
export const RoomId = z.string().min(1).max(32);
export const PlayerId = z.string().min(1).max(32);
export const Intent = z.discriminatedUnion('type', [
    z.object({ type: z.literal('GO_TO'), room: RoomId }),
    z.object({ type: z.literal('DO_TASK'), taskId: z.string() }),
    z.object({ type: z.literal('FOLLOW'), playerId: PlayerId, durationSec: z.number().min(1).max(30) }),
    z.object({ type: z.literal('STAY_NEAR'), playerId: PlayerId }),
    z.object({ type: z.literal('AVOID'), playerId: PlayerId }),
    z.object({ type: z.literal('WAIT'), seconds: z.number().min(1).max(10) }),
    z.object({ type: z.literal('WANDER') }),
    z.object({ type: z.literal('REPORT_BODY') }),
    z.object({ type: z.literal('CALL_MEETING') }),
    z.object({ type: z.literal('FIX_SABOTAGE') }),
    // impostor-only: the server MUST reject these if role !== IMPOSTOR
    z.object({ type: z.literal('KILL'), playerId: PlayerId, reckless: z.boolean().optional() }),
    z.object({ type: z.literal('VENT_TO'), ventId: z.string() }),
    z.object({ type: z.literal('SABOTAGE'), kind: z.enum(['LIGHTS', 'DOORS', 'REACTOR']) }),
    z.object({ type: z.literal('FAKE_TASK'), taskId: z.string() }),
    z.object({ type: z.literal('HUNT'), playerId: PlayerId }),
    // meeting
    z.object({ type: z.literal('SAY'), text: z.string().min(1).max(160), replyTo: PlayerId.optional() }),
    z.object({ type: z.literal('VOTE'), target: z.union([PlayerId, z.literal('SKIP')]) }),
    z.object({ type: z.literal('STAY_SILENT') }),
]);
export const Mood = z.object({
    tension: z.number().min(0).max(1),
    conf: z.number().min(0).max(1),
    annoy: z.number().min(0).max(1),
    amuse: z.number().min(0).max(1),
});
export const BrainOut = z.object({
    thought: z.string().max(400),
    intent: Intent,
    mood: Mood.optional(),
});
export const Persona = z.object({
    id: z.string(),
    handle: z.string(),
    vibe: z.string(),
    traits: z.object({
        talk: z.number(),
        aggr: z.number(),
        trust: z.number(),
        humor: z.number(),
        conf: z.number(),
        impulse: z.number(),
    }),
    voice: z.object({
        case: z.enum(['lower', 'normal', 'mixed']),
        avgWords: z.number(),
        emoji: z.number(),
        slang: z.array(z.string()),
        tics: z.array(z.string()),
        typo: z.number(),
        caps: z.number().optional(),
    }),
    crew: z.string(),
    impostor: z.string(),
    underAccusation: z.string(),
    body: z.object({
        reactMs: z.tuple([z.number(), z.number()]),
        pause: z.number(),
        detour: z.number(),
        dawdle: z.number(),
    }),
    samples: z.array(z.string()),
});
//# sourceMappingURL=schemas.js.map