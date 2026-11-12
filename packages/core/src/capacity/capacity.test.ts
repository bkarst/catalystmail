import assert from 'node:assert/strict';
import fc from 'fast-check';
import { describe, it } from 'vitest';

import { largestRemainder, planCapacity, type CapacityCampaign, type CapacityMailbox } from './plan.ts';
import {
  isSendingDay,
  moveRamp,
  rampCap,
  rampFinalStep,
  validateCapOverride,
  validateCustomSchedule,
  warmupFinalStep,
  type RampMoveInput,
} from './ramp.ts';

const mailbox = (id: string, overrides: Partial<CapacityMailbox> = {}): CapacityMailbox => ({
  id,
  domainId: 'dom_1',
  dailyLimit: 40,
  warmupEnabled: true,
  warmupStartVolume: 10,
  warmupDailyIncrement: 5,
  warmupStep: 0,
  band: 'healthy',
  followUpsDueToday: 0,
  ...overrides,
});
const warmedUp = (id: string, overrides: Partial<CapacityMailbox> = {}) => mailbox(id, { warmupStep: 6, ...overrides });
const campaign = (id: string, priority: CapacityCampaign['priority'], mailboxIds: string[], limit = 30): CapacityCampaign => ({
  id,
  priority,
  dailyNewThreadsLimit: limit,
  mailboxes: mailboxIds.map((mailboxId) => ({ mailboxId, weight: 1 })),
});
const byId = <T extends { mailboxId: string }>(rows: T[], id: string) => rows.find((row) => row.mailboxId === id)!;

describe('ramp schedule', () => {
  it('follows the new_domain plan to the total of the mailbox caps (§8.3.1, §15.15 wireframe)', () => {
    const caps = Array.from({ length: 15 }, (_, step) => rampCap({ plan: 'new_domain', step, mailboxCapTotal: 120 }));
    assert.deepEqual(caps, [20, 23, 26, 30, 35, 40, 46, 53, 61, 70, 81, 93, 107, 120, 120]);
    assert.equal(rampFinalStep({ plan: 'new_domain', mailboxCapTotal: 120 }), 13);
  });

  it('follows the aged_domain plan', () => {
    const caps = Array.from({ length: 8 }, (_, step) => rampCap({ plan: 'aged_domain', step, mailboxCapTotal: 120 }));
    assert.deepEqual(caps, [40, 48, 58, 69, 83, 100, 119, 120]);
    assert.equal(rampFinalStep({ plan: 'aged_domain', mailboxCapTotal: 120 }), 7);
  });

  it('has no ramp for established domains', () => {
    assert.equal(rampCap({ plan: 'established', step: 0, mailboxCapTotal: 120 }), 120);
    assert.equal(rampFinalStep({ plan: 'established', mailboxCapTotal: 120 }), 0);
  });

  it('reads a custom schedule and holds its last cap', () => {
    const customSchedule = [{ step: 0, cap: 20 }, { step: 1, cap: 30 }, { step: 2, cap: 45 }];
    assert.equal(rampCap({ plan: 'custom', step: 1, mailboxCapTotal: 120, customSchedule }), 30);
    assert.equal(rampCap({ plan: 'custom', step: 9, mailboxCapTotal: 120, customSchedule }), 45);
    assert.equal(rampFinalStep({ plan: 'custom', mailboxCapTotal: 120, customSchedule }), 2);
    assert.throws(() => rampCap({ plan: 'custom', step: 0, mailboxCapTotal: 120 }), RangeError);
  });

  it('validates custom schedules: no gaps, whole caps, at most +50% per step', () => {
    assert.deepEqual(validateCustomSchedule([{ step: 0, cap: 20 }, { step: 1, cap: 30 }]), []);
    assert.equal(validateCustomSchedule([{ step: 0, cap: 20 }, { step: 1, cap: 31 }]).length, 1);
    assert.equal(validateCustomSchedule([{ step: 0, cap: 20 }, { step: 2, cap: 25 }]).length, 1);
    assert.equal(validateCustomSchedule([{ step: 0, cap: 0 }]).length, 1);
    assert.equal(validateCustomSchedule([]).length, 1);
  });

  it('computes where a mailbox warm-up ends', () => {
    assert.equal(warmupFinalStep(40, 10, 5), 6);
    assert.equal(warmupFinalStep(42, 10, 5), 7);
    assert.equal(warmupFinalStep(10, 10, 5), 0);
  });

  it('counts a sending day only at half the cap or more', () => {
    assert.equal(isSendingDay(10, 20), true);
    assert.equal(isSendingDay(9, 20), false);
    assert.equal(isSendingDay(0, 0), false);
  });
});

describe('cap override (§8.3.6, IT-24)', () => {
  const base = { currentStepCap: 70, today: '2026-11-10' };

  it('accepts +50% for three days', () => {
    assert.deepEqual(validateCapOverride({ ...base, cap: 105, until: '2026-11-13' }), []);
  });

  it('rejects +80%, more than 14 days, and a past end date', () => {
    assert.equal(validateCapOverride({ ...base, cap: 126, until: '2026-11-13' }).length, 1);
    assert.equal(validateCapOverride({ ...base, cap: 70, until: '2026-11-25' }).length, 1);
    assert.equal(validateCapOverride({ ...base, cap: 70, until: '2026-11-09' }).length, 1);
    assert.deepEqual(validateCapOverride({ ...base, cap: 70, until: '2026-11-24' }), []);
  });

  it('lets the cap be lowered without limit', () => {
    assert.deepEqual(validateCapOverride({ ...base, cap: 0, until: '2026-11-11' }), []);
  });
});

describe('ramp movement (§8.3.2)', () => {
  const healthy: RampMoveInput = {
    step: 5,
    finalStep: 13,
    status: 'ramping',
    band: 'healthy',
    previousBand: 'healthy',
    consecutiveHealthyDays: 10,
    yesterdayWasSendingDay: true,
  };

  it('moves up one step on a Healthy sending day', () => {
    assert.deepEqual(moveRamp(healthy), { step: 6, status: 'ramping', action: 'advanced', reason: 'healthy' });
  });

  it('does not move up after a day that was not a sending day', () => {
    assert.deepEqual(moveRamp({ ...healthy, yesterdayWasSendingDay: false }), {
      step: 5, status: 'ramping', action: 'none', reason: 'not_a_sending_day',
    });
  });

  it('holds while At risk, then moves up again only after 2 Healthy days in a row', () => {
    const held = moveRamp({ ...healthy, band: 'at_risk' });
    assert.deepEqual(held, { step: 5, status: 'holding', action: 'held', reason: 'at_risk' });
    const firstHealthyDay = moveRamp({ ...healthy, status: held.status, previousBand: 'at_risk', consecutiveHealthyDays: 1 });
    assert.deepEqual(firstHealthyDay, { step: 5, status: 'holding', action: 'held', reason: 'recovering' });
    const secondHealthyDay = moveRamp({ ...healthy, status: firstHealthyDay.status, consecutiveHealthyDays: 2 });
    assert.deepEqual(secondHealthyDay, { step: 6, status: 'ramping', action: 'advanced', reason: 'healthy' });
  });

  it('drops back 2 steps on entering Critical, once', () => {
    const entered = moveRamp({ ...healthy, band: 'critical' });
    assert.deepEqual(entered, { step: 3, status: 'stepped_back', action: 'stepped_back', reason: 'critical' });
    const stillCritical = moveRamp({ ...healthy, step: 3, status: 'stepped_back', band: 'critical', previousBand: 'critical' });
    assert.deepEqual(stillCritical, { step: 3, status: 'stepped_back', action: 'held', reason: 'critical' });
    assert.equal(moveRamp({ ...healthy, step: 1, band: 'critical' }).step, 0);
  });

  it('stops while Paused', () => {
    assert.deepEqual(moveRamp({ ...healthy, band: 'paused' }), { step: 5, status: 'stopped', action: 'stopped', reason: 'paused' });
  });

  it('holds on a manual hold, but reputation still wins', () => {
    assert.equal(moveRamp({ ...healthy, manualHold: true }).reason, 'manual_hold');
    assert.equal(moveRamp({ ...healthy, manualHold: true, band: 'critical' }).action, 'stepped_back');
  });

  it('drops an idle domain back 3 steps after 14 days without sending', () => {
    const idle = { ...healthy, yesterdayWasSendingDay: false };
    assert.equal(moveRamp({ ...idle, idleDays: 13 }).step, 5);
    assert.deepEqual(moveRamp({ ...idle, idleDays: 14 }), { step: 2, status: 'stepped_back', action: 'stepped_back', reason: 'idle' });
    assert.equal(moveRamp({ ...idle, idleDays: 15 }).step, 5);
  });

  it('completes at the final step and stays there', () => {
    assert.deepEqual(moveRamp({ ...healthy, step: 12 }), { step: 13, status: 'complete', action: 'advanced', reason: 'healthy' });
    assert.deepEqual(moveRamp({ ...healthy, step: 13, status: 'complete' }), { step: 13, status: 'complete', action: 'none', reason: 'complete' });
  });
});

describe('largestRemainder', () => {
  const split = (total: number, weights: Record<string, number>) =>
    Object.fromEntries(largestRemainder(total, Object.entries(weights).map(([id, weight]) => ({ id, weight }))));

  it('always adds up exactly', () => {
    for (let total = 0; total <= 60; total += 1) {
      const parts = split(total, { a: 3, b: 2, c: 7, d: 1 });
      assert.equal(Object.values(parts).reduce((sum, part) => sum + part, 0), total);
    }
  });

  it('gives the leftover to the largest fractional parts', () => {
    assert.deepEqual(split(24, { agency: 3, founders: 2 }), { agency: 14, founders: 10 }); // 14.4 / 9.6
    assert.deepEqual(split(18, { agency: 3, founders: 2 }), { agency: 11, founders: 7 }); // 10.8 / 7.2
  });

  it('breaks ties by the larger share, then the lower ID', () => {
    assert.deepEqual(split(20, { mbx_c: 10, mbx_a: 10, mbx_b: 10 }), { mbx_a: 7, mbx_b: 7, mbx_c: 6 });
    assert.deepEqual(split(1, { small: 1, big: 3 }), { small: 0, big: 1 });
  });

  it('gives nothing to zero weights or from a zero total', () => {
    assert.deepEqual(split(5, { a: 0, b: 1 }), { a: 0, b: 5 });
    assert.deepEqual(split(0, { a: 1, b: 1 }), { a: 0, b: 0 });
    assert.deepEqual(split(5, { a: 0 }), { a: 0 });
  });
});

describe('capacity plan (§8.3.3)', () => {
  it('splits a new domain across three new mailboxes (IT-21)', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 20, band: 'healthy' }],
      mailboxes: [mailbox('mbx_1'), mailbox('mbx_2'), mailbox('mbx_3')],
      campaigns: [
        campaign('cmp_high', 'high', ['mbx_1', 'mbx_2', 'mbx_3']),
        campaign('cmp_normal', 'normal', ['mbx_1', 'mbx_2', 'mbx_3']),
      ],
    });
    assert.deepEqual(plan.mailboxes.map((m) => m.alloc), [7, 7, 6]);
    assert.deepEqual(plan.mailboxes.map((m) => m.replyReserve), [2, 2, 1]);
    assert.deepEqual(plan.mailboxes.map((m) => m.firstTouchPool), [5, 5, 5]);
    assert.deepEqual(plan.mailboxes.map((m) => m.limitedBy), ['domain_ramp', 'domain_ramp', 'domain_ramp']);
    assert.deepEqual(plan.domains, [{ domainId: 'dom_1', cap: 20, alloc: 20 }]);
    assert.deepEqual(plan.campaigns, [
      { campaignId: 'cmp_high', alloc: 9, limitedBy: 'domain_ramp' },
      { campaignId: 'cmp_normal', alloc: 6, limitedBy: 'campaign_share' },
    ]);
  });

  it('leaves 8 first touches on a day-1 mailbox when the domain cap is not the limit (IT-16)', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 20, band: 'healthy' }],
      mailboxes: [mailbox('mbx_1')],
      campaigns: [campaign('cmp_1', 'normal', ['mbx_1'], 100)],
    });
    const [only] = plan.mailboxes;
    assert.equal(only!.alloc, 10);
    assert.equal(only!.replyReserve, 2);
    assert.equal(only!.firstTouchPool, 8);
    assert.equal(only!.limitedBy, 'mailbox_cap');
    assert.deepEqual(plan.campaigns, [{ campaignId: 'cmp_1', alloc: 8, limitedBy: 'mailbox_cap' }]);
  });

  it('reproduces the domain page wireframe (§15.15)', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 70, band: 'healthy' }],
      mailboxes: [
        warmedUp('mbx_alex', { followUpsDueToday: 10 }),
        warmedUp('mbx_sam', { band: 'at_risk', followUpsDueToday: 7 }),
      ],
      campaigns: [
        campaign('cmp_agency', 'high', ['mbx_alex', 'mbx_sam']),
        campaign('cmp_founders', 'normal', ['mbx_alex', 'mbx_sam']),
      ],
    });
    const alex = byId(plan.mailboxes, 'mbx_alex');
    const sam = byId(plan.mailboxes, 'mbx_sam');
    assert.deepEqual([alex.alloc, alex.replyReserve, alex.followUps], [40, 6, 10]);
    assert.deepEqual(alex.campaigns, [{ campaignId: 'cmp_agency', alloc: 14 }, { campaignId: 'cmp_founders', alloc: 10 }]);
    assert.deepEqual([sam.cap, sam.alloc, sam.replyReserve, sam.followUps], [30, 30, 5, 7]);
    assert.deepEqual(sam.campaigns, [{ campaignId: 'cmp_agency', alloc: 11 }, { campaignId: 'cmp_founders', alloc: 7 }]);
    assert.equal(sam.limitedBy, 'mailbox_health');
    assert.deepEqual(plan.campaigns.map((c) => c.alloc), [25, 17]);
  });

  it('rounds band multipliers down and applies the domain band', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 70, band: 'at_risk' }],
      mailboxes: [warmedUp('mbx_1'), warmedUp('mbx_2')],
      campaigns: [],
    });
    assert.equal(plan.domains[0]!.cap, 52); // floor(70 × 0.75)
    assert.deepEqual(plan.mailboxes.map((m) => m.alloc), [26, 26]);
    assert.deepEqual(plan.mailboxes.map((m) => m.limitedBy), ['domain_reputation', 'domain_reputation']);
  });

  it('lets a cap override replace the ramp cap', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 70, capOverride: 30, band: 'healthy' }],
      mailboxes: [warmedUp('mbx_1')],
      campaigns: [],
    });
    assert.equal(plan.mailboxes[0]!.alloc, 30);
  });

  it('keeps the reserve for replies when follow-ups exceed the rest', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 120, band: 'healthy' }],
      mailboxes: [warmedUp('mbx_1', { followUpsDueToday: 50 })],
      campaigns: [campaign('cmp_1', 'normal', ['mbx_1'])],
    });
    const [only] = plan.mailboxes;
    assert.deepEqual([only!.alloc, only!.replyReserve, only!.followUps, only!.firstTouchPool], [40, 6, 34, 0]);
    assert.equal(only!.replyOverflow, 4);
    assert.equal(only!.replyLimit, 44);
    assert.equal(plan.campaigns[0]!.alloc, 0);
  });

  it('stops outreach but not replies in a Paused band', () => {
    const pausedDomain = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 70, band: 'paused' }],
      mailboxes: [warmedUp('mbx_1')],
      campaigns: [campaign('cmp_1', 'normal', ['mbx_1'])],
    });
    assert.deepEqual([pausedDomain.mailboxes[0]!.alloc, pausedDomain.mailboxes[0]!.firstTouchPool], [0, 0]);
    assert.equal(pausedDomain.mailboxes[0]!.replyLimit, 40);

    const pausedMailbox = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 70, band: 'healthy' }],
      mailboxes: [warmedUp('mbx_1', { band: 'paused' }), warmedUp('mbx_2')],
      campaigns: [],
    });
    assert.deepEqual(pausedMailbox.mailboxes.map((m) => m.alloc), [0, 40]);
    assert.equal(pausedMailbox.mailboxes[0]!.replyLimit, 40);
  });

  it('stops first touches, but not follow-ups or replies, while authentication fails (§8.9)', () => {
    const open = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 70, band: 'healthy' }],
      mailboxes: [warmedUp('mbx_1', { followUpsDueToday: 5 })],
      campaigns: [campaign('cmp_1', 'normal', ['mbx_1'])],
    });
    const failing = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 70, band: 'healthy', firstTouchesPaused: true }],
      mailboxes: [warmedUp('mbx_1', { followUpsDueToday: 5 })],
      campaigns: [campaign('cmp_1', 'normal', ['mbx_1'])],
    });
    const [before, after] = [open.mailboxes[0]!, failing.mailboxes[0]!];
    assert.ok(before.firstTouchPool > 0);
    assert.deepEqual([after.firstTouchPool, after.campaigns[0]!.alloc, after.limitedBy, failing.campaigns[0]!.limitedBy], [0, 0, 'domain_auth', 'domain_auth']);
    assert.deepEqual([after.followUps, after.replyLimit], [before.followUps, before.replyLimit]);
  });

  it('caps a campaign at its daily limit across all of its mailboxes', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 120, band: 'healthy' }],
      mailboxes: [warmedUp('mbx_1'), warmedUp('mbx_2')],
      campaigns: [campaign('cmp_1', 'normal', ['mbx_1', 'mbx_2'], 30)],
    });
    assert.deepEqual(plan.campaigns, [{ campaignId: 'cmp_1', alloc: 30, limitedBy: 'campaign_limit' }]);
    assert.deepEqual(plan.mailboxes.map((m) => m.campaigns[0]!.alloc), [15, 15]);
  });

  it('weights campaigns by priority and by their weight on the mailbox', () => {
    const plan = planCapacity({
      domains: [{ id: 'dom_1', rampCap: 120, band: 'healthy' }],
      mailboxes: [warmedUp('mbx_1')],
      campaigns: [
        { id: 'cmp_low', priority: 'low', dailyNewThreadsLimit: 30, mailboxes: [{ mailboxId: 'mbx_1', weight: 3 }] },
        { id: 'cmp_high', priority: 'high', dailyNewThreadsLimit: 30, mailboxes: [{ mailboxId: 'mbx_1', weight: 1 }] },
        { id: 'cmp_other', priority: 'high', dailyNewThreadsLimit: 30, mailboxes: [{ mailboxId: 'mbx_9', weight: 1 }] },
      ],
    });
    // Pool 34, equal weights of 3 → 17 each; the third campaign isn't on this mailbox.
    assert.deepEqual(plan.mailboxes[0]!.campaigns, [{ campaignId: 'cmp_low', alloc: 17 }, { campaignId: 'cmp_high', alloc: 17 }]);
    assert.equal(plan.campaigns.find((c) => c.campaignId === 'cmp_other')!.alloc, 0);
  });

  it('never plans more than any limit allows, on any mix (§19.3 property 8)', () => {
    const band = fc.constantFrom('healthy' as const, 'at_risk' as const, 'critical' as const, 'paused' as const);
    const mailboxSpec = fc.record({
      dailyLimit: fc.integer({ min: 1, max: 150 }),
      warmupEnabled: fc.boolean(),
      warmupStep: fc.nat({ max: 30 }),
      band,
      followUpsDueToday: fc.nat({ max: 40 }),
    });
    const campaignSpec = fc.record({
      priority: fc.constantFrom('high' as const, 'normal' as const, 'low' as const),
      limit: fc.integer({ min: 1, max: 60 }),
      weight: fc.integer({ min: 1, max: 4 }),
      uses: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
    });

    fc.assert(
      fc.property(
        fc.nat({ max: 300 }),
        band,
        fc.array(mailboxSpec, { minLength: 1, maxLength: 5 }),
        fc.array(campaignSpec, { maxLength: 4 }),
        (rampCap, domainBand, mailboxSpecs, campaignSpecs) => {
          const mailboxes = mailboxSpecs.map((spec, index) => mailbox(`mbx_${index}`, spec));
          const campaigns: CapacityCampaign[] = campaignSpecs.map((spec, index) => ({
            id: `cmp_${index}`,
            priority: spec.priority,
            dailyNewThreadsLimit: spec.limit,
            mailboxes: mailboxes.filter((_, at) => spec.uses[at]).map((entry) => ({ mailboxId: entry.id, weight: spec.weight })),
          }));
          const plan = planCapacity({ domains: [{ id: 'dom_1', rampCap, band: domainBand }], mailboxes, campaigns });

          // The domain cap is split exactly: nothing lost to rounding, nothing above a mailbox's own cap.
          const domain = plan.domains[0]!;
          const capTotal = plan.mailboxes.reduce((sum, entry) => sum + entry.cap, 0);
          assert.equal(domain.alloc, Math.min(domain.cap, capTotal));

          for (const entry of plan.mailboxes) {
            for (const figure of [entry.cap, entry.alloc, entry.replyReserve, entry.replyOverflow, entry.followUps, entry.firstTouchPool]) {
              assert.ok(Number.isInteger(figure) && figure >= 0, `whole number expected, got ${figure}`);
            }
            assert.ok(entry.alloc <= entry.cap);
            // The reserve is 15% rounded up, and outreach never touches it.
            assert.ok(entry.replyReserve * 100 >= entry.alloc * 15 && (entry.replyReserve - 1) * 100 < entry.alloc * 15);
            const firstTouches = entry.campaigns.reduce((sum, share) => sum + share.alloc, 0);
            assert.ok(firstTouches <= entry.firstTouchPool);
            assert.ok(entry.followUps + firstTouches <= Math.max(0, entry.alloc - entry.replyReserve));
          }
          for (const entry of plan.campaigns) {
            const campaign = campaigns.find((candidate) => candidate.id === entry.campaignId)!;
            assert.ok(entry.alloc <= campaign.dailyNewThreadsLimit);
            const acrossMailboxes = plan.mailboxes.flatMap((m) => m.campaigns).filter((share) => share.campaignId === entry.campaignId);
            assert.equal(acrossMailboxes.reduce((sum, share) => sum + share.alloc, 0), entry.alloc);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('splits any total exactly, each part within one of its exact share (property)', () => {
    fc.assert(
      fc.property(fc.nat({ max: 2000 }), fc.array(fc.nat({ max: 60 }), { minLength: 1, maxLength: 8 }), (total, weights) => {
        const parts = largestRemainder(total, weights.map((weight, index) => ({ id: `s_${index}`, weight })));
        const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
        const given = [...parts.values()].reduce((sum, part) => sum + part, 0);
        assert.equal(given, weightTotal === 0 ? 0 : total);
        weights.forEach((weight, index) => {
          const exact = weightTotal === 0 ? 0 : (total * weight) / weightTotal;
          assert.ok(Math.abs(parts.get(`s_${index}`)! - exact) < 1);
        });
      }),
      { numRuns: 500 },
    );
  });
});
