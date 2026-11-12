import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { decideSend, type SendDecisionInput } from './autonomy.ts';
import {
  decideAfterOutbound,
  decideInbound,
  needsClaude,
  type ClaudeOpinion,
  type JevClassification,
} from './classification.ts';
import { intlZoneCalendar } from '../time/zone.ts';
import { ESCALATION_RULES, escalationDueAt, primaryReason, priorityAfterBreach } from './escalation.ts';

const jev = (overrides: Partial<JevClassification> = {}): JevClassification => ({
  kind: { value: 'human_reply', p: 0.97 },
  needsReply: 0.95,
  intent: { value: 'question', p: 0.86 },
  unsubscribe: 0.01,
  goals: {},
  escalations: {},
  suspicious: 0.01,
  ...overrides,
});
const claude = (overrides: Partial<ClaudeOpinion> = {}): ClaudeOpinion => ({
  kind: 'human_reply',
  intent: 'question',
  goalSignals: [],
  escalation: { required: false, reasons: [] },
  suspiciousInstructions: false,
  followUpAfter: null,
  confidence: 0.9,
  ...overrides,
});
const goals = [{ key: 'call_booked', autoConfirm: true }, { key: 'paid', autoConfirm: true }];
const decide = (j: JevClassification | null, c: ClaudeOpinion | null = claude()) =>
  decideInbound({ jev: j, claude: c, goals, goalAutoConfirmThreshold: 0.85 });

describe('classification policy: a clear question', () => {
  it('drafts a reply that may auto-send when both models agree', () => {
    const decision = decide(jev());
    assert.equal(decision.reply, 'draft');
    assert.deepEqual(decision.autoSendBlockers, []);
    assert.deepEqual(decision.escalations, []);
    assert.deepEqual(decision.disagreements, []);
    assert.equal(decision.fallback, false);
  });
});

describe('classification policy: unsubscribe band edges', () => {
  it('acts at 0.7, asks from 0.3, ignores below', () => {
    assert.equal(decide(jev({ unsubscribe: 0.7 })).unsubscribe, 'act');
    assert.equal(decide(jev({ unsubscribe: 0.69 })).unsubscribe, 'ask');
    assert.equal(decide(jev({ unsubscribe: 0.3 })).unsubscribe, 'ask');
    assert.equal(decide(jev({ unsubscribe: 0.29 })).unsubscribe, 'none');
  });

  it('holds sending and raises low_confidence in the middle band (IT-28)', () => {
    const decision = decide(jev({ unsubscribe: 0.5 }));
    assert.deepEqual(decision.escalations, ['low_confidence']);
    assert.ok(decision.autoSendBlockers.includes('unsubscribe_uncertain'));
  });

  it('acts when only Claude reads an unsubscribe: the safer reading wins', () => {
    const decision = decide(jev({ unsubscribe: 0.1 }), claude({ intent: 'unsubscribe' }));
    assert.equal(decision.unsubscribe, 'act');
    assert.deepEqual(decision.disagreements, ['unsubscribe']);
    assert.equal(decide(jev({ unsubscribe: 0.1 }), claude({ kind: 'unsubscribe_request' })).unsubscribe, 'act');
  });

  it('ends the pipeline: nothing else is decided', () => {
    const decision = decide(jev({ unsubscribe: 0.9, goals: { call_booked: 0.99 } }));
    assert.equal(decision.reply, 'none');
    assert.deepEqual(decision.goals, []);
  });
});

describe('classification policy: automatic replies', () => {
  it('settles an out-of-office at 0.85', () => {
    assert.equal(decide(jev({ kind: { value: 'out_of_office', p: 0.85 } }), null).autoReply, 'out_of_office');
    assert.equal(decide(jev({ kind: { value: 'auto_reply', p: 0.9 } }), null).autoReply, 'auto_reply');
  });

  it('below 0.85 treats it as a human reply, but nothing auto-sends', () => {
    const decision = decide(jev({ kind: { value: 'out_of_office', p: 0.84 } }));
    assert.equal(decision.autoReply, null);
    assert.equal(decision.reply, 'draft');
    assert.ok(decision.autoSendBlockers.includes('kind_uncertain'));
  });

  it('blocks auto-send when Claude thinks a human-looking message is automatic', () => {
    const decision = decide(jev(), claude({ kind: 'auto_reply' }));
    assert.ok(decision.autoSendBlockers.includes('kind_uncertain'));
    assert.ok(decision.disagreements.includes('kind'));
  });
});

describe('classification policy: reply needed band edges', () => {
  it('drafts at 0.7, drafts for approval from 0.3, stays silent below', () => {
    assert.equal(decide(jev({ needsReply: 0.7 })).reply, 'draft');
    const middle = decide(jev({ needsReply: 0.69 }));
    assert.equal(middle.reply, 'draft_for_approval');
    assert.ok(middle.autoSendBlockers.includes('needs_reply_uncertain'));
    assert.equal(decide(jev({ needsReply: 0.3 })).reply, 'draft_for_approval');
    assert.equal(decide(jev({ needsReply: 0.29 })).reply, 'none');
  });
});

describe('classification policy: escalations', () => {
  it('raises mandatory reasons at 0.5 and flags them from 0.3', () => {
    assert.deepEqual(decide(jev({ escalations: { pricing_negotiation: 0.5 } })).escalations, ['pricing_negotiation']);
    const flagged = decide(jev({ escalations: { pricing_negotiation: 0.49 } }));
    assert.deepEqual(flagged.escalations, []);
    assert.deepEqual(flagged.autoSendBlockers, ['escalation_flag:pricing_negotiation']);
    assert.deepEqual(decide(jev({ escalations: { pricing_negotiation: 0.29 } })).autoSendBlockers, []);
  });

  it('raises the other reasons only at 0.7', () => {
    assert.deepEqual(decide(jev({ escalations: { high_value: 0.7 } })).escalations, ['high_value']);
    const flagged = decide(jev({ escalations: { meeting_logistics: 0.69 } }));
    assert.deepEqual(flagged.escalations, []);
    assert.deepEqual(flagged.autoSendBlockers, ['escalation_flag:meeting_logistics']);
  });

  it('treats a suspicious message as mandatory', () => {
    assert.deepEqual(decide(jev({ suspicious: 0.5 })).escalations, ['suspicious_content']);
    assert.deepEqual(decide(jev({ suspicious: 0.4 })).autoSendBlockers, ['escalation_flag:suspicious_content']);
  });

  it('raises a reason only Claude found, and records the disagreement', () => {
    const decision = decide(jev({ escalations: { complaint: 0.1 } }), claude({ escalation: { required: true, reasons: ['complaint'] } }));
    assert.deepEqual(decision.escalations, ['complaint']);
    assert.deepEqual(decision.disagreements, ['escalation:complaint']);
  });

  it('raises reasons Jev has no question for without calling it a disagreement', () => {
    const decision = decide(jev(), claude({ escalation: { required: true, reasons: ['knowledge_gap'] }, suspiciousInstructions: true }));
    assert.deepEqual(decision.escalations, ['knowledge_gap', 'suspicious_content']);
    assert.deepEqual(decision.disagreements, ['escalation:suspicious_content']);
  });

  it('does not raise the same reason twice', () => {
    const decision = decide(jev({ escalations: { complaint: 0.9 } }), claude({ escalation: { required: true, reasons: ['complaint'] } }));
    assert.deepEqual(decision.escalations, ['complaint']);
  });
});

describe('classification policy: goals', () => {
  it('achieves at the campaign threshold, asks from 0.5, ignores below', () => {
    assert.deepEqual(decide(jev({ goals: { call_booked: 0.85 } })).goals, [{ key: 'call_booked', action: 'achieve', p: 0.85 }]);
    assert.deepEqual(decide(jev({ goals: { call_booked: 0.84 } })).goals, [{ key: 'call_booked', action: 'confirm', p: 0.84 }]);
    assert.deepEqual(decide(jev({ goals: { call_booked: 0.5 } })).goals, [{ key: 'call_booked', action: 'confirm', p: 0.5 }]);
    assert.deepEqual(decide(jev({ goals: { call_booked: 0.49 } })).goals, []);
  });

  it('asks instead of achieving when the goal does not allow auto-confirm', () => {
    const decision = decideInbound({
      jev: jev({ goals: { call_booked: 0.99 } }),
      claude: claude(),
      goals: [{ key: 'call_booked', autoConfirm: false }],
      goalAutoConfirmThreshold: 0.85,
    });
    assert.deepEqual(decision.goals, [{ key: 'call_booked', action: 'confirm', p: 0.99 }]);
  });

  it('asks a person when the two models disagree', () => {
    const claudeDenies = decide(
      jev({ goals: { call_booked: 0.93 } }),
      claude({ goalSignals: [{ goalKey: 'call_booked', achieved: false, confidence: 0.8 }] }),
    );
    assert.deepEqual(claudeDenies.goals, [{ key: 'call_booked', action: 'confirm', p: 0.93 }]);
    assert.ok(claudeDenies.disagreements.includes('goal:call_booked'));

    const onlyClaude = decide(
      jev({ goals: { call_booked: 0.2 } }),
      claude({ goalSignals: [{ goalKey: 'call_booked', achieved: true, confidence: 0.9 }] }),
    );
    assert.deepEqual(onlyClaude.goals, [{ key: 'call_booked', action: 'confirm', p: 0.2 }]);
    assert.ok(onlyClaude.disagreements.includes('goal:call_booked'));
  });

  it('lets Jev alone achieve a goal after a person-written outbound message (IT-29)', () => {
    const outbound = jev({ kind: null, needsReply: null, unsubscribe: null, suspicious: null, goals: { call_booked: 0.9, paid: 0.05 } });
    assert.deepEqual(decideAfterOutbound(outbound, goals, 0.85), [{ key: 'call_booked', action: 'achieve', p: 0.9 }]);
  });
});

describe('classification policy: closing and check-ins', () => {
  const notInterested = (p: number) => jev({ intent: { value: 'not_interested', p }, needsReply: 0.1 });

  it('closes at 0.85 only when Claude agrees', () => {
    assert.equal(decide(notInterested(0.85), claude({ intent: 'not_interested' })).close, 'close');
    assert.equal(decide(notInterested(0.84), claude({ intent: 'not_interested' })).close, 'approval');
    assert.equal(decide(notInterested(0.5), claude({ intent: 'not_interested' })).close, 'approval');
    assert.equal(decide(notInterested(0.49), claude({ intent: 'not_interested' })).close, 'none');
    assert.equal(decide(notInterested(0.95), claude({ intent: 'objection' })).close, 'approval');
    assert.equal(decide(notInterested(0.95), null).close, 'approval');
  });

  it('schedules a check-in only with a date and agreement', () => {
    const notNow = (p: number) => jev({ intent: { value: 'not_now', p } });
    assert.equal(decide(notNow(0.7), claude({ intent: 'not_now', followUpAfter: '2027-03-01' })).checkIn, 'schedule');
    assert.equal(decide(notNow(0.69), claude({ intent: 'not_now', followUpAfter: '2027-03-01' })).checkIn, 'approval');
    assert.equal(decide(notNow(0.9), claude({ intent: 'not_now', followUpAfter: null })).checkIn, 'approval');
    assert.equal(decide(notNow(0.9), claude({ intent: 'interested', followUpAfter: '2027-03-01' })).checkIn, 'approval');
    assert.equal(decide(jev()).checkIn, 'none');
  });
});

describe('classification policy: auto-send intent', () => {
  it('needs an auto-sendable intent at 0.7 with Claude agreeing', () => {
    assert.deepEqual(decide(jev({ intent: { value: 'interested', p: 0.7 } }), claude({ intent: 'interested' })).autoSendBlockers, []);
    assert.deepEqual(decide(jev({ intent: { value: 'interested', p: 0.69 } }), claude({ intent: 'interested' })).autoSendBlockers, ['intent_uncertain']);
    assert.deepEqual(decide(jev({ intent: { value: 'referral', p: 0.9 } }), claude({ intent: 'referral' })).autoSendBlockers, ['intent_not_auto_sendable']);
  });

  it('goes to approval when Jev says interested and Claude says not now (IT-27)', () => {
    const decision = decide(jev({ intent: { value: 'interested', p: 0.82 } }), claude({ intent: 'not_now' }));
    assert.deepEqual(decision.autoSendBlockers, ['intent_disagreement']);
    assert.deepEqual(decision.disagreements, ['intent']);
    assert.equal(decision.reply, 'draft');
  });
});

describe('classification policy: fallback when Jev is unavailable (IT-26)', () => {
  it('sends every reply to approval and never auto-confirms a goal', () => {
    const decision = decide(null, claude({ goalSignals: [{ goalKey: 'call_booked', achieved: true, confidence: 0.99 }] }));
    assert.equal(decision.fallback, true);
    assert.equal(decision.reply, 'draft_for_approval');
    assert.deepEqual(decision.autoSendBlockers, ['classification_fallback']);
    assert.deepEqual(decision.goals, [{ key: 'call_booked', action: 'confirm', p: 0.99 }]);
  });

  it('applies the same thresholds to Claude confidence', () => {
    assert.equal(decide(null, claude({ intent: 'unsubscribe', confidence: 0.7 })).unsubscribe, 'act');
    assert.equal(decide(null, claude({ intent: 'unsubscribe', confidence: 0.5 })).unsubscribe, 'ask');
    assert.equal(decide(null, claude({ kind: 'out_of_office', confidence: 0.9 })).autoReply, 'out_of_office');
    assert.deepEqual(decide(null, claude({ escalation: { required: true, reasons: ['complaint', 'high_value'] }, confidence: 0.6 })).escalations, ['complaint']);
    assert.equal(decide(null, claude({ intent: 'not_interested', confidence: 0.99 })).close, 'approval');
  });

  it('refuses to decide with no classification at all', () => {
    assert.throws(() => decide(null, null));
  });
});

describe('needsClaude: what Jev settles alone', () => {
  it('skips Claude for a clear unsubscribe, a clear automatic reply, and "Thanks, talk Thursday" (IT-25)', () => {
    assert.equal(needsClaude(jev({ unsubscribe: 0.9 })), false);
    assert.equal(needsClaude(jev({ kind: { value: 'out_of_office', p: 0.95 } })), false);
    assert.equal(needsClaude(jev({ needsReply: 0.1, intent: { value: 'neutral', p: 0.8 } })), false);
  });

  it('calls Claude when a reply is needed or anything is flagged', () => {
    assert.equal(needsClaude(jev()), true);
    assert.equal(needsClaude(jev({ needsReply: 0.3 })), true);
    assert.equal(needsClaude(jev({ needsReply: 0.1, unsubscribe: 0.4 })), true);
    assert.equal(needsClaude(jev({ needsReply: 0.1, suspicious: 0.35 })), true);
    assert.equal(needsClaude(jev({ needsReply: 0.1, escalations: { complaint: 0.3 } })), true);
    assert.equal(needsClaude(jev({ kind: { value: 'auto_reply', p: 0.6 } })), true);
  });

  it('calls Claude for a no-reply message whose intent still leads to an action', () => {
    assert.equal(needsClaude(jev({ needsReply: 0.1, intent: { value: 'not_interested', p: 0.9 } })), true);
    assert.equal(needsClaude(jev({ needsReply: 0.1, intent: { value: 'not_now', p: 0.6 } })), true);
    assert.equal(needsClaude(jev({ needsReply: 0.1, intent: { value: 'not_interested', p: 0.4 } })), false);
  });
});

describe('autonomy (§10.7)', () => {
  const reply: SendDecisionInput = {
    autonomy: 'assisted',
    messageClass: 'ai_reply',
    classificationBlockers: [],
    draftConfidence: 0.9,
    autoSendMinConfidence: 0.8,
    guardrailsPassed: true,
    escalationReasons: [],
    aiRepliesSent: 0,
    maxAiRepliesPerThread: 6,
  };
  const reasons = (overrides: Partial<SendDecisionInput>) => decideSend({ ...reply, ...overrides }).reasons;

  it('always auto-sends template messages', () => {
    for (const autonomy of ['manual', 'assisted', 'autonomous'] as const) {
      assert.equal(decideSend({ autonomy, messageClass: 'template' }).decision, 'auto_send');
    }
  });

  it('sends everything AI-written to approval in manual mode', () => {
    for (const messageClass of ['ai_personalized', 'ai_reply', 'ai_follow_up'] as const) {
      assert.deepEqual(decideSend({ ...reply, autonomy: 'manual', messageClass }), { decision: 'pending_approval', reasons: ['manual_autonomy'] });
    }
  });

  it('reviews the first 10 personalized first touches in assisted mode, none in autonomous', () => {
    const personalized = { messageClass: 'ai_personalized' as const, guardrailsPassed: true, reviewFirstNPersonalized: 10 };
    assert.deepEqual(decideSend({ ...personalized, autonomy: 'assisted', personalizedReviewed: 9 }).reasons, ['sample_review']);
    assert.equal(decideSend({ ...personalized, autonomy: 'assisted', personalizedReviewed: 10 }).decision, 'auto_send');
    assert.equal(decideSend({ ...personalized, autonomy: 'autonomous', personalizedReviewed: 0 }).decision, 'auto_send');
    assert.deepEqual(decideSend({ ...personalized, autonomy: 'autonomous', guardrailsPassed: false }).reasons, ['guardrails_failed']);
  });

  it('auto-sends an assisted reply only when every condition holds (IT-04)', () => {
    assert.deepEqual(decideSend(reply), { decision: 'auto_send', reasons: [] });
    assert.deepEqual(reasons({ draftConfidence: 0.79 }), ['low_draft_confidence']);
    assert.deepEqual(reasons({ draftConfidence: 0.8 }), []);
    assert.deepEqual(reasons({ guardrailsPassed: false }), ['guardrails_failed']);
    assert.deepEqual(reasons({ escalationReasons: ['knowledge_gap'] }), ['escalation']);
    assert.deepEqual(reasons({ aiRepliesSent: 6 }), ['reply_limit']);
    assert.deepEqual(reasons({ isNewParticipant: true }), ['new_participant']);
    assert.deepEqual(reasons({ aiPaused: true }), ['ai_paused']);
    assert.deepEqual(reasons({ classificationBlockers: ['intent_disagreement'] }), ['intent_disagreement']);
    assert.deepEqual(reasons({ classificationBlockers: null }), ['not_classified']);
  });

  it('skips the needs-reply condition for AI follow-ups, and all of them when the contact never replied', () => {
    const followUp = { messageClass: 'ai_follow_up' as const };
    assert.deepEqual(reasons({ ...followUp, classificationBlockers: ['needs_reply_uncertain'] }), []);
    assert.deepEqual(reasons({ ...followUp, classificationBlockers: ['intent_uncertain'] }), ['intent_uncertain']);
    assert.deepEqual(reasons({ ...followUp, classificationBlockers: null }), []);
    assert.deepEqual(reasons({ ...followUp, aiRepliesSent: 6 }), []);
  });

  it('in autonomous mode needs guardrails and confidence 0.6, and still never sends on a fallback classification', () => {
    const autonomous = { autonomy: 'autonomous' as const };
    assert.deepEqual(reasons({ ...autonomous, draftConfidence: 0.6, classificationBlockers: ['intent_uncertain'] }), []);
    assert.deepEqual(reasons({ ...autonomous, draftConfidence: 0.59 }), ['low_draft_confidence']);
    assert.deepEqual(reasons({ ...autonomous, classificationBlockers: ['classification_fallback'] }), ['classification_fallback']);
    assert.deepEqual(reasons({ ...autonomous, escalationReasons: ['complaint'] }), ['escalation']);
  });
});

describe('escalation rules (§11.1)', () => {
  it('gives each reason its priority and SLA', () => {
    assert.deepEqual(ESCALATION_RULES.identity_question, { priority: 'urgent', sla: { amount: 2, unit: 'business_hours' } });
    assert.deepEqual(ESCALATION_RULES.knowledge_gap, { priority: 'high', sla: { amount: 4, unit: 'business_hours' } });
    assert.deepEqual(ESCALATION_RULES.went_quiet, { priority: 'normal', sla: { amount: 1, unit: 'business_days' } });
  });

  it('files an escalation under its most urgent reason', () => {
    assert.equal(primaryReason(['goal_confirmation', 'knowledge_gap', 'complaint', 'human_requested']), 'complaint');
    assert.equal(primaryReason(['referral', 'reopened']), 'referral');
    assert.equal(primaryReason([]), null);
  });

  it('raises priority one level on an SLA breach', () => {
    assert.equal(priorityAfterBreach('normal'), 'high');
    assert.equal(priorityAfterBreach('high'), 'urgent');
    assert.equal(priorityAfterBreach('urgent'), 'urgent');
  });
});

describe('escalation SLAs in business hours (§11.1)', () => {
  const ctx = { zone: 'America/New_York', calendar: intlZoneCalendar };
  const ny = (day: number, hour: number, minute = 0) => intlZoneCalendar.fromLocal({ year: 2026, month: 11, day, hour, minute, second: 0 }, 'America/New_York');

  it('counts only business hours, carrying over nights and weekends', () => {
    // Tuesday 10:00 + 2 business hours = 12:00.
    assert.deepEqual(escalationDueAt(ESCALATION_RULES.complaint, ny(10, 10), ctx), ny(10, 12));
    // Tuesday 16:00 + 4 business hours = Wednesday 12:00.
    assert.deepEqual(escalationDueAt(ESCALATION_RULES.knowledge_gap, ny(10, 16), ctx), ny(11, 12));
    // Friday 15:30 + 4 business hours = Monday 11:30.
    assert.deepEqual(escalationDueAt(ESCALATION_RULES.knowledge_gap, ny(13, 15, 30), ctx), ny(16, 11, 30));
    // Saturday: the clock starts on Monday at 09:00.
    assert.deepEqual(escalationDueAt(ESCALATION_RULES.complaint, ny(14, 11), ctx), ny(16, 11));
  });

  it('counts business days for normal priority', () => {
    // Friday 15:00 + 1 business day = Monday 15:00.
    assert.deepEqual(escalationDueAt(ESCALATION_RULES.went_quiet, ny(13, 15), ctx), ny(16, 15));
  });
});
