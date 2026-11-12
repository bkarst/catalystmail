// Sending capacity and the Deliverability overview (spec §8.3.5, §13.4, §15.15): read-only views of
// today's plan, the 7-day projection, and the state of every domain and mailbox.

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { activityExample, activitySchema } from '../schemas/platform.ts';
import { bandSchema, checkStatusSchema, mailboxStatusSchema, rampPlanSchema, rampStatusSchema } from '../schemas/sending.ts';

const MAILBOX_LIMITS = {
  domain_ramp: 'The domain’s ramp step.',
  domain_reputation: 'The domain’s reputation band.',
  domain_auth: 'First touches paused: SPF, DKIM or DMARC fails (§8.9).',
  mailbox_cap: 'The mailbox’s own daily limit or warm-up.',
  mailbox_health: 'The mailbox’s health band.',
} as const;
const mailboxLimitSchema = describedEnum(MAILBOX_LIMITS, { id: 'MailboxLimit', description: 'What limits the mailbox today.' });
const campaignLimitSchema = describedEnum(
  { ...MAILBOX_LIMITS, campaign_share: 'Sharing mailboxes with other campaigns.', campaign_limit: 'The campaign’s own new-threads-per-day limit.' },
  { id: 'CampaignLimit', description: 'What limits the campaign today.' },
);
const count = (description: string) => z.int().min(0).meta({ description });
const day = (description: string) => z.iso.date().meta({ description });

export const getSendingCapacity = defineOperation({
  operationId: 'getSendingCapacity',
  method: 'get',
  path: '/capacity',
  tag: 'Deliverability',
  summary: 'Today’s sending plan and the 7-day forecast',
  description:
    'How many emails each domain, mailbox and campaign may send today (§8.3.3), what each has used, and the limit holding it back. Each campaign has its pace and a forecast finish date for the threads waiting for a first email. `forecast` projects 7 days assuming every band stays Healthy, so ramps and warm-ups keep moving. Filter by domain, mailbox or campaign.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  query: z.object({
    domain_id: id('domain').optional().meta({ description: 'Only this domain and its mailboxes.' }),
    mailbox_id: id('mailbox').optional().meta({ description: 'Only this mailbox.' }),
    campaign_id: id('campaign').optional().meta({ description: 'Only this campaign.' }),
  }),
  response: {
    status: 200,
    description: 'The plan.',
    schema: z
      .object({
        day: day('Today, in the workspace’s timezone.'),
        domains: z.array(z.object({ domain_id: id('domain'), domain: z.string(), cap: count('The domain-wide cap today.'), alloc: count('What its active mailboxes were given.'), used: count('Composed or sent today.') })),
        mailboxes: z.array(
          z.object({
            mailbox_id: id('mailbox'),
            email: z.string(),
            domain_id: id('domain'),
            cap: count('Its own cap: daily limit and warm-up, times its health multiplier.'),
            alloc: count('Its share of the domain’s cap.'),
            reply_reserve: count('Held for replies only.'),
            reply_limit: count('The most replies it may send today.'),
            follow_ups: count('Follow-ups that fit today.'),
            first_touch_pool: count('Left for first emails.'),
            limited_by: mailboxLimitSchema,
            used: z.object({ initial: count('First emails.'), follow_ups: count('Follow-ups.'), replies: count('Replies.') }).meta({ description: 'Composed or sent today.' }),
            campaigns: z.array(z.object({ campaign_id: id('campaign'), alloc: count('First emails this campaign may send from it today.') })),
          }),
        ),
        campaigns: z.array(
          z.object({
            campaign_id: id('campaign'),
            name: z.string(),
            priority: describedEnum({ high: 'Weight 3.', normal: 'Weight 2.', low: 'Weight 1.' }, { description: 'Its sending priority.' }),
            wants: count('Its new-threads-per-day limit.'),
            alloc: count('First emails it may send today.'),
            used: count('First emails composed or sent today.'),
            waiting: count('Threads waiting for their first email.'),
            limited_by: campaignLimitSchema,
            finishes_on: day('When every waiting thread will have had its first email at the projected pace; null when the pace is zero.').nullable(),
          }),
        ),
        forecast: z
          .array(z.object({ day: day('The day.'), domains: z.array(z.object({ domain_id: id('domain'), cap: count('The projected cap.') })), campaigns: z.array(z.object({ campaign_id: id('campaign'), alloc: count('The projected first emails.') })) }))
          .meta({ description: 'The next 7 days, if every band stays Healthy.' }),
      })
      .meta({ id: 'SendingCapacity' }),
    example: {
      day: '2026-11-10',
      domains: [{ domain_id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s', domain: 'getacme.com', cap: 70, alloc: 70, used: 43 }],
      mailboxes: [
        {
          mailbox_id: 'mbx_01jd3x5k8qf7tb9w2m4n6p8r0s',
          email: 'alex@getacme.com',
          domain_id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s',
          cap: 40,
          alloc: 40,
          reply_reserve: 6,
          reply_limit: 44,
          follow_ups: 10,
          first_touch_pool: 24,
          limited_by: 'mailbox_cap',
          used: { initial: 17, follow_ups: 8, replies: 3 },
          campaigns: [{ campaign_id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s', alloc: 24 }],
        },
      ],
      campaigns: [{ campaign_id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'Agency outreach Q4', priority: 'high', wants: 30, alloc: 24, used: 17, waiting: 310, limited_by: 'domain_ramp', finishes_on: '2026-12-03' }],
      forecast: [{ day: '2026-11-11', domains: [{ domain_id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s', cap: 81 }], campaigns: [{ campaign_id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s', alloc: 28 }] }],
    },
  },
  mcp: { toolset: 'deliverability' },
});

export const getDeliverabilityOverview = defineOperation({
  operationId: 'getDeliverabilityOverview',
  method: 'get',
  path: '/deliverability',
  tag: 'Deliverability',
  summary: 'Every domain and mailbox at a glance',
  description:
    'The Deliverability overview (§15.15): each domain’s reputation, DNS and ramp (today’s cap and tomorrow’s if it stays Healthy), each mailbox’s status, health, sends today, warm-up and last poll, today’s planned and sent totals with the main limit, and the 20 latest deliverability events. getSendingCapacity has the full plan.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  response: {
    status: 200,
    description: 'The overview.',
    schema: z
      .object({
        domains: z.array(
          z.object({
            domain_id: id('domain'),
            domain: z.string(),
            reputation_score: z.int().min(0).max(100).meta({ description: 'Domain reputation, 0–100 (§8.10).' }),
            reputation_band: bandSchema,
            blocklisted: z.boolean(),
            alignment_status: describedEnum({ aligned: 'DKIM aligned.', not_aligned: 'Not aligned.', unknown: 'No usable results.' }, { description: 'From the last connection test (§7.1).' }).nullable(),
            dns: z
              .object({
                spf: checkStatusSchema.nullable(),
                dkim: checkStatusSchema.nullable(),
                dmarc: checkStatusSchema.nullable(),
                dmarc_policy: z.string().nullable().meta({ description: 'none, quarantine or reject.' }),
                mx: checkStatusSchema.nullable(),
                tracking: checkStatusSchema.nullable(),
                checked_at: timestamp('When DNS was last checked.').nullable(),
              })
              .meta({ description: 'The last DNS check, record by record; null before the first.' }),
            ramp: z.object({
              plan: rampPlanSchema,
              step: z.int().min(0),
              final_step: z.int().min(0),
              status: rampStatusSchema,
              today_cap: count('The domain-wide cap today.'),
              tomorrow_cap: count('Tomorrow’s cap if the domain stays Healthy.'),
            }),
          }),
        ),
        mailboxes: z.array(
          z.object({
            mailbox_id: id('mailbox'),
            email: z.string(),
            domain_id: id('domain'),
            status: mailboxStatusSchema,
            status_reason: z.string().nullable(),
            health_score: z.int().min(0).max(100).meta({ description: 'Mailbox health, 0–100 (§8.10).' }),
            health_band: bandSchema,
            sent_today: count('Sent today.'),
            today_cap: count('Its cap today; 0 unless active.'),
            warmup: z.object({ enabled: z.boolean(), step: z.int().min(0), final_step: z.int().min(0), complete: z.boolean() }),
            last_poll_at: timestamp('When it was last checked for new mail.').nullable(),
            last_poll_status: describedEnum({ ok: 'Every folder read.', partial: 'Some folders failed.', error: 'Nothing read.' }, { description: 'How the last poll went.' }).nullable(),
          }),
        ),
        today: z.object({
          day: day('Today, in the workspace’s timezone.'),
          planned: count('Domain caps added up.'),
          sent: count('Sent today.'),
          replies: count('Replies received today.'),
          main_limit: campaignLimitSchema.nullable().meta({ description: 'What holds sending back most today.' }),
        }),
        events: z.array(activitySchema).meta({ description: 'Ramp moves, band changes, breaker trips, pauses and polls, newest first.' }),
      })
      .meta({ id: 'DeliverabilityOverview' }),
    example: {
      domains: [
        {
          domain_id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s',
          domain: 'getacme.com',
          reputation_score: 91,
          reputation_band: 'healthy',
          blocklisted: false,
          alignment_status: 'aligned',
          dns: { spf: 'pass', dkim: 'pass', dmarc: 'pass', dmarc_policy: 'none', mx: 'pass', tracking: 'pass', checked_at: '2026-11-10T08:00:00Z' },
          ramp: { plan: 'new_domain', step: 9, final_step: 13, status: 'ramping', today_cap: 70, tomorrow_cap: 81 },
        },
      ],
      mailboxes: [
        {
          mailbox_id: 'mbx_01jd3x5k8qf7tb9w2m4n6p8r0s',
          email: 'alex@getacme.com',
          domain_id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s',
          status: 'active',
          status_reason: null,
          health_score: 96,
          health_band: 'healthy',
          sent_today: 31,
          today_cap: 40,
          warmup: { enabled: true, step: 6, final_step: 6, complete: true },
          last_poll_at: '2026-11-10T17:30:00Z',
          last_poll_status: 'ok',
        },
      ],
      today: { day: '2026-11-10', planned: 70, sent: 43, replies: 9, main_limit: 'domain_ramp' },
      events: [{ ...activityExample, type: 'domain.ramp_advanced' }],
    },
  },
  mcp: { toolset: 'deliverability' },
});
