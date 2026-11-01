import { z } from 'zod';
export declare const RoomId: z.ZodString;
export declare const PlayerId: z.ZodString;
export declare const Intent: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"GO_TO">;
    room: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "GO_TO";
    room: string;
}, {
    type: "GO_TO";
    room: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"DO_TASK">;
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "DO_TASK";
    taskId: string;
}, {
    type: "DO_TASK";
    taskId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"FOLLOW">;
    playerId: z.ZodString;
    durationSec: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "FOLLOW";
    playerId: string;
    durationSec: number;
}, {
    type: "FOLLOW";
    playerId: string;
    durationSec: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"STAY_NEAR">;
    playerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "STAY_NEAR";
    playerId: string;
}, {
    type: "STAY_NEAR";
    playerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"AVOID">;
    playerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "AVOID";
    playerId: string;
}, {
    type: "AVOID";
    playerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"WAIT">;
    seconds: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "WAIT";
    seconds: number;
}, {
    type: "WAIT";
    seconds: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"WANDER">;
}, "strip", z.ZodTypeAny, {
    type: "WANDER";
}, {
    type: "WANDER";
}>, z.ZodObject<{
    type: z.ZodLiteral<"REPORT_BODY">;
}, "strip", z.ZodTypeAny, {
    type: "REPORT_BODY";
}, {
    type: "REPORT_BODY";
}>, z.ZodObject<{
    type: z.ZodLiteral<"CALL_MEETING">;
}, "strip", z.ZodTypeAny, {
    type: "CALL_MEETING";
}, {
    type: "CALL_MEETING";
}>, z.ZodObject<{
    type: z.ZodLiteral<"FIX_SABOTAGE">;
}, "strip", z.ZodTypeAny, {
    type: "FIX_SABOTAGE";
}, {
    type: "FIX_SABOTAGE";
}>, z.ZodObject<{
    type: z.ZodLiteral<"KILL">;
    playerId: z.ZodString;
    reckless: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: "KILL";
    playerId: string;
    reckless?: boolean | undefined;
}, {
    type: "KILL";
    playerId: string;
    reckless?: boolean | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"VENT_TO">;
    ventId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "VENT_TO";
    ventId: string;
}, {
    type: "VENT_TO";
    ventId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"SABOTAGE">;
    kind: z.ZodEnum<["LIGHTS", "DOORS", "REACTOR"]>;
}, "strip", z.ZodTypeAny, {
    type: "SABOTAGE";
    kind: "LIGHTS" | "DOORS" | "REACTOR";
}, {
    type: "SABOTAGE";
    kind: "LIGHTS" | "DOORS" | "REACTOR";
}>, z.ZodObject<{
    type: z.ZodLiteral<"FAKE_TASK">;
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "FAKE_TASK";
    taskId: string;
}, {
    type: "FAKE_TASK";
    taskId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"HUNT">;
    playerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "HUNT";
    playerId: string;
}, {
    type: "HUNT";
    playerId: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"SAY">;
    text: z.ZodString;
    replyTo: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "SAY";
    text: string;
    replyTo?: string | undefined;
}, {
    type: "SAY";
    text: string;
    replyTo?: string | undefined;
}>, z.ZodObject<{
    type: z.ZodLiteral<"VOTE">;
    target: z.ZodUnion<[z.ZodString, z.ZodLiteral<"SKIP">]>;
}, "strip", z.ZodTypeAny, {
    type: "VOTE";
    target: string;
}, {
    type: "VOTE";
    target: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"STAY_SILENT">;
}, "strip", z.ZodTypeAny, {
    type: "STAY_SILENT";
}, {
    type: "STAY_SILENT";
}>]>;
export declare const Mood: z.ZodObject<{
    tension: z.ZodNumber;
    conf: z.ZodNumber;
    annoy: z.ZodNumber;
    amuse: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    tension: number;
    conf: number;
    annoy: number;
    amuse: number;
}, {
    tension: number;
    conf: number;
    annoy: number;
    amuse: number;
}>;
export declare const BrainOut: z.ZodObject<{
    thought: z.ZodString;
    intent: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"GO_TO">;
        room: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "GO_TO";
        room: string;
    }, {
        type: "GO_TO";
        room: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"DO_TASK">;
        taskId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "DO_TASK";
        taskId: string;
    }, {
        type: "DO_TASK";
        taskId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"FOLLOW">;
        playerId: z.ZodString;
        durationSec: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "FOLLOW";
        playerId: string;
        durationSec: number;
    }, {
        type: "FOLLOW";
        playerId: string;
        durationSec: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"STAY_NEAR">;
        playerId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "STAY_NEAR";
        playerId: string;
    }, {
        type: "STAY_NEAR";
        playerId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"AVOID">;
        playerId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "AVOID";
        playerId: string;
    }, {
        type: "AVOID";
        playerId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"WAIT">;
        seconds: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "WAIT";
        seconds: number;
    }, {
        type: "WAIT";
        seconds: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"WANDER">;
    }, "strip", z.ZodTypeAny, {
        type: "WANDER";
    }, {
        type: "WANDER";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"REPORT_BODY">;
    }, "strip", z.ZodTypeAny, {
        type: "REPORT_BODY";
    }, {
        type: "REPORT_BODY";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"CALL_MEETING">;
    }, "strip", z.ZodTypeAny, {
        type: "CALL_MEETING";
    }, {
        type: "CALL_MEETING";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"FIX_SABOTAGE">;
    }, "strip", z.ZodTypeAny, {
        type: "FIX_SABOTAGE";
    }, {
        type: "FIX_SABOTAGE";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"KILL">;
        playerId: z.ZodString;
        reckless: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        type: "KILL";
        playerId: string;
        reckless?: boolean | undefined;
    }, {
        type: "KILL";
        playerId: string;
        reckless?: boolean | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"VENT_TO">;
        ventId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "VENT_TO";
        ventId: string;
    }, {
        type: "VENT_TO";
        ventId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"SABOTAGE">;
        kind: z.ZodEnum<["LIGHTS", "DOORS", "REACTOR"]>;
    }, "strip", z.ZodTypeAny, {
        type: "SABOTAGE";
        kind: "LIGHTS" | "DOORS" | "REACTOR";
    }, {
        type: "SABOTAGE";
        kind: "LIGHTS" | "DOORS" | "REACTOR";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"FAKE_TASK">;
        taskId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "FAKE_TASK";
        taskId: string;
    }, {
        type: "FAKE_TASK";
        taskId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"HUNT">;
        playerId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "HUNT";
        playerId: string;
    }, {
        type: "HUNT";
        playerId: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"SAY">;
        text: z.ZodString;
        replyTo: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "SAY";
        text: string;
        replyTo?: string | undefined;
    }, {
        type: "SAY";
        text: string;
        replyTo?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"VOTE">;
        target: z.ZodUnion<[z.ZodString, z.ZodLiteral<"SKIP">]>;
    }, "strip", z.ZodTypeAny, {
        type: "VOTE";
        target: string;
    }, {
        type: "VOTE";
        target: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"STAY_SILENT">;
    }, "strip", z.ZodTypeAny, {
        type: "STAY_SILENT";
    }, {
        type: "STAY_SILENT";
    }>]>;
    mood: z.ZodOptional<z.ZodObject<{
        tension: z.ZodNumber;
        conf: z.ZodNumber;
        annoy: z.ZodNumber;
        amuse: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        tension: number;
        conf: number;
        annoy: number;
        amuse: number;
    }, {
        tension: number;
        conf: number;
        annoy: number;
        amuse: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    thought: string;
    intent: {
        type: "GO_TO";
        room: string;
    } | {
        type: "DO_TASK";
        taskId: string;
    } | {
        type: "FOLLOW";
        playerId: string;
        durationSec: number;
    } | {
        type: "STAY_NEAR";
        playerId: string;
    } | {
        type: "AVOID";
        playerId: string;
    } | {
        type: "WAIT";
        seconds: number;
    } | {
        type: "WANDER";
    } | {
        type: "REPORT_BODY";
    } | {
        type: "CALL_MEETING";
    } | {
        type: "FIX_SABOTAGE";
    } | {
        type: "KILL";
        playerId: string;
        reckless?: boolean | undefined;
    } | {
        type: "VENT_TO";
        ventId: string;
    } | {
        type: "SABOTAGE";
        kind: "LIGHTS" | "DOORS" | "REACTOR";
    } | {
        type: "FAKE_TASK";
        taskId: string;
    } | {
        type: "HUNT";
        playerId: string;
    } | {
        type: "SAY";
        text: string;
        replyTo?: string | undefined;
    } | {
        type: "VOTE";
        target: string;
    } | {
        type: "STAY_SILENT";
    };
    mood?: {
        tension: number;
        conf: number;
        annoy: number;
        amuse: number;
    } | undefined;
}, {
    thought: string;
    intent: {
        type: "GO_TO";
        room: string;
    } | {
        type: "DO_TASK";
        taskId: string;
    } | {
        type: "FOLLOW";
        playerId: string;
        durationSec: number;
    } | {
        type: "STAY_NEAR";
        playerId: string;
    } | {
        type: "AVOID";
        playerId: string;
    } | {
        type: "WAIT";
        seconds: number;
    } | {
        type: "WANDER";
    } | {
        type: "REPORT_BODY";
    } | {
        type: "CALL_MEETING";
    } | {
        type: "FIX_SABOTAGE";
    } | {
        type: "KILL";
        playerId: string;
        reckless?: boolean | undefined;
    } | {
        type: "VENT_TO";
        ventId: string;
    } | {
        type: "SABOTAGE";
        kind: "LIGHTS" | "DOORS" | "REACTOR";
    } | {
        type: "FAKE_TASK";
        taskId: string;
    } | {
        type: "HUNT";
        playerId: string;
    } | {
        type: "SAY";
        text: string;
        replyTo?: string | undefined;
    } | {
        type: "VOTE";
        target: string;
    } | {
        type: "STAY_SILENT";
    };
    mood?: {
        tension: number;
        conf: number;
        annoy: number;
        amuse: number;
    } | undefined;
}>;
export declare const Persona: z.ZodObject<{
    id: z.ZodString;
    handle: z.ZodString;
    vibe: z.ZodString;
    traits: z.ZodObject<{
        talk: z.ZodNumber;
        aggr: z.ZodNumber;
        trust: z.ZodNumber;
        humor: z.ZodNumber;
        conf: z.ZodNumber;
        impulse: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        conf: number;
        talk: number;
        aggr: number;
        trust: number;
        humor: number;
        impulse: number;
    }, {
        conf: number;
        talk: number;
        aggr: number;
        trust: number;
        humor: number;
        impulse: number;
    }>;
    voice: z.ZodObject<{
        case: z.ZodEnum<["lower", "normal", "mixed"]>;
        avgWords: z.ZodNumber;
        emoji: z.ZodNumber;
        slang: z.ZodArray<z.ZodString, "many">;
        tics: z.ZodArray<z.ZodString, "many">;
        typo: z.ZodNumber;
        caps: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        case: "lower" | "normal" | "mixed";
        avgWords: number;
        emoji: number;
        slang: string[];
        tics: string[];
        typo: number;
        caps?: number | undefined;
    }, {
        case: "lower" | "normal" | "mixed";
        avgWords: number;
        emoji: number;
        slang: string[];
        tics: string[];
        typo: number;
        caps?: number | undefined;
    }>;
    crew: z.ZodString;
    impostor: z.ZodString;
    underAccusation: z.ZodString;
    body: z.ZodObject<{
        reactMs: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
        pause: z.ZodNumber;
        detour: z.ZodNumber;
        dawdle: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        reactMs: [number, number];
        pause: number;
        detour: number;
        dawdle: number;
    }, {
        reactMs: [number, number];
        pause: number;
        detour: number;
        dawdle: number;
    }>;
    samples: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    handle: string;
    vibe: string;
    traits: {
        conf: number;
        talk: number;
        aggr: number;
        trust: number;
        humor: number;
        impulse: number;
    };
    voice: {
        case: "lower" | "normal" | "mixed";
        avgWords: number;
        emoji: number;
        slang: string[];
        tics: string[];
        typo: number;
        caps?: number | undefined;
    };
    crew: string;
    impostor: string;
    underAccusation: string;
    body: {
        reactMs: [number, number];
        pause: number;
        detour: number;
        dawdle: number;
    };
    samples: string[];
}, {
    id: string;
    handle: string;
    vibe: string;
    traits: {
        conf: number;
        talk: number;
        aggr: number;
        trust: number;
        humor: number;
        impulse: number;
    };
    voice: {
        case: "lower" | "normal" | "mixed";
        avgWords: number;
        emoji: number;
        slang: string[];
        tics: string[];
        typo: number;
        caps?: number | undefined;
    };
    crew: string;
    impostor: string;
    underAccusation: string;
    body: {
        reactMs: [number, number];
        pause: number;
        detour: number;
        dawdle: number;
    };
    samples: string[];
}>;
export type BrainOut = z.infer<typeof BrainOut>;
export type Intent = z.infer<typeof Intent>;
export type Persona = z.infer<typeof Persona>;
