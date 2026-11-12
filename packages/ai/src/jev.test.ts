import assert from 'node:assert/strict';

import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { describe, it } from 'vitest';

import { conversationQuestions, readJevAnswers, typesafeJev } from './jev.ts';

const goals = [{ key: 'call', success_criteria: 'Books a discovery call' }];

describe('Jev classifier conversation.v1 (§10.4, §22.F)', () => {
  it('asks every question after an inbound message, and only the whole-conversation ones after ours', () => {
    const inbound = conversationQuestions(goals, 'inbound');
    assert.deepEqual(Object.keys(inbound).sort(), ['esc_complaint', 'esc_high_value', 'esc_human_requested', 'esc_identity_question', 'esc_legal_or_compliance', 'esc_meeting_logistics', 'esc_pricing_negotiation', 'goal_call', 'intent', 'kind', 'needs_reply', 'sentiment', 'suspicious', 'temperature', 'unsubscribe']);
    assert.deepEqual(Object.keys(conversationQuestions(goals, 'outbound')).sort(), ['goal_call', 'intent', 'sentiment', 'temperature']);
    assert.match(JSON.stringify(inbound.goal_call), /Has the contact done the following: «Books a discovery call»\?/);
    assert.ok(!('other' in ((inbound.intent as { criteria: object }).criteria)), 'no catch-all option, as TypeSafe advises');
  });

  it('checks the answers against our schema, and counts the cost of the input tokens', async () => {
    const questions = conversationQuestions(goals, 'outbound');
    const answers = {
      intent: { type: 'choice', choice: 'meeting_request', confidence: 0.9, probabilities: { meeting_request: 0.9, interested: 0.1 } },
      sentiment: { type: 'score', score: 3.4, confidence: 0.7, probabilities: { 3: 0.6, 4: 0.4 } },
      temperature: { type: 'score', score: 2, confidence: 0.8, probabilities: { 2: 0.8 } },
      goal_call: { type: 'noul', noul: 0.92 },
    };
    const sdk = (result: unknown) => ({ systemOne: async () => result }) as unknown as TypeSafeClient;
    const ok = await typesafeJev(sdk({ model: 'jev-1.13.0', answers, usage: { input_tokens: 1_000_000, output_tokens: 20 } })).classify({ state: {} as never, questions, model: 'jev-1.13.0' });
    assert.equal(ok.status, 'ok');
    assert.deepEqual(ok.status === 'ok' && ok.usage, { inputTokens: 1_000_000, outputTokens: 20, costUsdMicros: 42_000 });
    const read = readJevAnswers(answers as never, goals);
    assert.deepEqual([read.classification.intent, read.classification.goals, read.sentiment, read.temperature], [{ value: 'meeting_request', p: 0.9 }, { call: 0.92 }, 'positive', 2]);

    const wrong = await typesafeJev(sdk({ model: 'jev-1.13.0', answers: { ...answers, goal_call: { type: 'noul', noul: 1.7 } }, usage: { input_tokens: 10, output_tokens: 1 } })).classify({ state: {} as never, questions, model: 'jev-1.13.0' });
    assert.deepEqual([wrong.status, wrong.status !== 'ok' && wrong.error], ['invalid_output', "Answers that don't match their question: goal_call"]);
    const down = await typesafeJev({ systemOne: async () => { throw new Error('503 Service Unavailable'); } } as unknown as TypeSafeClient).classify({ state: {} as never, questions, model: 'jev-1.13.0' });
    assert.equal(down.status, 'error');
  });
});
