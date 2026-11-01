/**
 * Persona lookup for the brains. config/personas.json is the owner's file: we
 * read it, we never rewrite it. Resident ids are `ai:<personaId>`.
 */
import { z } from 'zod';
import { readConfigJson } from '../config.js';

const PersonaFile = z.object({
  personas: z.array(
    z.object({
      id: z.string(),
      handle: z.string(),
      vibe: z.string(),
      crew: z.string(),
      impostor: z.string(),
    }),
  ),
});

export interface PersonaText {
  id: string;
  handle: string;
  vibe: string;
  crew: string;
  impostor: string;
}

const FALLBACK: PersonaText = {
  id: 'guest',
  handle: 'Guest',
  vibe: 'easygoing, says little',
  crew: 'finishes tasks and follows the group',
  impostor: 'quiet killer who lets others talk',
};

let cache: Map<string, PersonaText> | null = null;

function load(): Map<string, PersonaText> {
  if (cache) return cache;
  cache = new Map();
  try {
    const file = readConfigJson('personas.json', (v) => PersonaFile.parse(v));
    for (const p of file.personas) {
      cache.set(p.id, { id: p.id, handle: p.handle, vibe: p.vibe, crew: p.crew, impostor: p.impostor });
    }
  } catch {
    // A missing or malformed personas file must not take the server down.
  }
  return cache;
}

/** Persona for a seat id (`ai:mira`) or a bare persona id (`mira`). */
export function personaFor(seatId: string): PersonaText {
  const id = seatId.startsWith('ai:') ? seatId.slice(3) : seatId;
  return load().get(id) ?? { ...FALLBACK, id, handle: id };
}
