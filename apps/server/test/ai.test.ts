/**
 * The AI layer's contract, without a network: prompts stay fog-legal, decisions
 * are parsed strictly, and the mock mouth never breaks silence rules.
 */
import { describe, expect, it } from 'vitest';
import { parseDecision, systemPrompt, userPrompt, type Observation } from '../src/ai/brain.js';
import { LlmGateway } from '../src/ai/llm.js';
import { loadEnv } from '../src/config.js';

const observation: Observation = {
  phase: 'MEETING',
  self: { name: 'Mira', role: 'crewmate', team: 'crew', alive: true, fellows: [], tasksLeft: 3, killReadyIn: 0 },
  visible: [{ name: 'Ro', color: 'Red', distance: 90, moving: true }],
  bodies: [{ victimName: 'Kenji', distance: 40 }],
  sabotage: '',
  chat: [{ from: 'Ro', text: 'where were you' }],
  ledger: ['saw Kenji\'s body in the galley'],
  suspicion: [{ name: 'Ro', score: 0.6, reason: 'near the body' }],
  mentionOfSelf: ['who saw mira'],
  secondsLeft: 30,
};

describe('prompts', () => {
  it('never leaks roles that are not the seat\'s own', () => {
    const prompt = systemPrompt({
      handle: 'Mira',
      vibe: 'sharp',
      crewStyle: 'tracks rooms',
      impostorStyle: 'calm liar',
      role: 'crewmate',
      team: 'crew',
      fellows: [],
    });
    expect(prompt).toContain('ROLE: crewmate');
    expect(prompt).not.toContain('fellow impostors');
  });

  it('carries the observation and the chat as untrusted blocks', () => {
    const prompt = userPrompt(observation);
    expect(prompt).toContain('Ro(Red');
    expect(prompt).toContain('<chat>Ro: where were you</chat>');
    expect(prompt).toContain('YOUR SUSPICIONS');
  });
});

describe('parseDecision', () => {
  it('accepts bare JSON', () => {
    const parsed = parseDecision('{"thought":"t","say":"hi","intent":{"kind":"vote","target":"Ro"}}');
    expect(parsed?.say).toBe('hi');
    expect(parsed?.intent.kind).toBe('vote');
  });

  it('accepts JSON wrapped in a fence or prose', () => {
    const parsed = parseDecision('sure thing\n```json\n{"thought":"x","say":null,"intent":{"kind":"stay"}}\n```');
    expect(parsed?.intent.kind).toBe('stay');
  });

  it('rejects an unknown intent kind instead of guessing', () => {
    expect(parseDecision('{"thought":"x","intent":{"kind":"nuke"}}')).toBeNull();
  });

  it('rejects prose with no object at all', () => {
    expect(parseDecision('I think Ro is sus')).toBeNull();
  });
});

describe('gateway', () => {
  it('reports offline with no key and no mock', () => {
    const env = loadEnv({ ...process.env, NVIDIA_API_KEY: '', OPENROUTER_API_KEY: '', LLM_MOCK: '0' });
    const llm = new LlmGateway(env);
    expect(llm.ready).toBe(false);
    expect(llm.description).toBe('offline');
  });

  it('answers deterministically in mock mode without any key', async () => {
    const env = loadEnv({ ...process.env, NVIDIA_API_KEY: '', LLM_MOCK: '1' });
    const llm = new LlmGateway(env);
    expect(llm.ready).toBe(true);
    const first = await llm.complete({ tier: 'fast', system: 's', user: 'same observation' });
    const second = await llm.complete({ tier: 'fast', system: 's', user: 'same observation' });
    expect(first?.text).toBe(second?.text);
    expect(first?.model).toBe('mock');
  });
});
