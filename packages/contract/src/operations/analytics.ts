// Analytics (spec §13.4, §15.4, §15.9): the Dashboard overview, funnels and campaign stats.

import { z } from 'zod';

import { describedEnum, id } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { activityExample, activitySchema } from '../schemas/platform.ts';
import { bandSchema } from '../schemas/sending.ts';

const share = (description: string) => z.number().min(0).max(1).meta({ description: `${description}, 0–1.` });
const count = (description: string) => z.int().min(0).meta({ description });
const dayCount = () => z.coerce.number().int().min(1).max(365);
const days = (description: string) => dayCount().optional().meta({ description, examples: [30] });

const funnelSchema = z
  .array(
    z.object({
      key: z.string().meta({ description: '`sent`, `received`, `responded`, or `goal:<key>`.' }),
      name: z.string(),
      count: count('Threads that reached it.'),
      conversion: share('Of the stage before it'),
    }),
  )
  .meta({ id: 'Funnel', description: 'Threads that reached each stage, then each goal (§15.4).' });
const funnelExample = [
  { key: 'sent', name: 'Sent', count: 412, conversion: 1 },
  { key: 'received', name: 'Received', count: 405, conversion: 0.983 },
  { key: 'responded', name: 'Responded', count: 46, conversion: 0.1136 },
  { key: 'goal:call', name: 'Call booked', count: 12, conversion: 0.2609 },
  { key: 'goal:paid', name: 'Paid', count: 3, conversion: 0.25 },
];

export const getFunnel = defineOperation({
  operationId: 'getFunnel',
  method: 'get',
  path: '/analytics/funnel',
  tag: 'Analytics',
  summary: 'The funnel: sent, received, responded, then each goal',
  description: 'How many threads reached each stage and goal, with each step’s conversion. One campaign, or every campaign with goals grouped by key. With `days`, only threads whose first email went out in that time.',
  access: 'scoped',
  scopes: ['analytics:read'],
  query: z.object({ campaign_id: id('campaign').optional().meta({ description: 'Only this campaign.' }), days: days('Only threads first emailed in the last this many days.') }),
  response: { status: 200, description: 'The funnel.', schema: z.object({ campaign_id: id('campaign').nullable(), since: z.iso.datetime().nullable(), stages: funnelSchema }).meta({ id: 'FunnelResult' }), example: { campaign_id: null, since: null, stages: funnelExample } },
  errors: [404],
  mcp: { toolset: 'analytics' },
});

export const getCampaignStats = defineOperation({
  operationId: 'getCampaignStats',
  method: 'get',
  path: '/campaigns/{campaignId}/stats',
  tag: 'Campaigns',
  summary: 'A campaign’s funnel, emails, steps, variants and goals',
  description:
    'The campaign Overview numbers (§15.9): the funnel, threads by state, emails sent, opened (by people), bounced and replied to, each step and A/B variant with its reply rate, and each goal with its estimated value. A reply is credited to the last email sent before it. With `days`, only the recent part.',
  access: 'scoped',
  scopes: ['analytics:read'],
  params: z.object({ campaignId: id('campaign', 'The campaign.') }),
  query: z.object({ days: days('Only the last this many days.') }),
  response: {
    status: 200,
    description: 'The stats.',
    schema: z
      .object({
        campaign_id: id('campaign'),
        since: z.iso.datetime().nullable(),
        funnel: funnelSchema,
        threads: z.object({ total: count('Every thread.'), by_state: z.record(z.string(), z.int().min(0)).meta({ description: 'Threads in each state.' }) }),
        emails: z.object({
          sent: count('Emails sent.'),
          opened: count('Opened by a person.'),
          bounced: count('Bounced.'),
          replies: count('Threads with a human reply.'),
          open_rate: share('Opened of sent'),
          reply_rate: share('Replies of sent'),
          bounce_rate: share('Bounced of sent'),
        }),
        steps: z.array(
          z.object({
            step_id: id('step'),
            label: z.string().meta({ description: '"Initial email", or the sequence and step.' }),
            sent: count('Sent.'),
            opened: count('Opened by a person.'),
            bounced: count('Bounced.'),
            replies: count('First replies credited to it.'),
            reply_rate: share('Replies of sent'),
            variants: z.array(z.object({ variant_id: id('variant'), label: z.string(), sent: count('Sent.'), opened: count('Opened.'), bounced: count('Bounced.'), replies: count('Replies.'), reply_rate: share('Replies of sent') })),
          }),
        ),
        goals: z.array(z.object({ goal_id: id('goal'), key: z.string(), name: z.string(), achieved: count('Threads that reached it.'), value_cents: z.int().nullable().meta({ description: 'Its value times the threads that reached it; null when it has no value.' }) })),
        value_cents: z.int().min(0).meta({ description: 'The goals’ values added up.' }),
      })
      .meta({ id: 'CampaignStats' }),
    example: {
      campaign_id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s',
      since: null,
      funnel: funnelExample,
      threads: { total: 520, by_state: { active: 430, needs_human: 3, completed: 3, stopped: 84 } },
      emails: { sent: 980, opened: 310, bounced: 9, replies: 46, open_rate: 0.3163, reply_rate: 0.0469, bounce_rate: 0.0092 },
      steps: [
        {
          step_id: 'stp_01jd3x5k8qf7tb9w2m4n6p8r0s',
          label: 'Initial email',
          sent: 412,
          opened: 150,
          bounced: 7,
          replies: 31,
          reply_rate: 0.0752,
          variants: [{ variant_id: 'var_01jd3x5k8qf7tb9w2m4n6p8r0s', label: 'A', sent: 206, opened: 80, bounced: 3, replies: 18, reply_rate: 0.0874 }],
        },
      ],
      goals: [{ goal_id: 'gol_01jd3x5k8qf7tb9w2m4n6p8r0s', key: 'paid', name: 'Paid', achieved: 3, value_cents: 480_000 }],
      value_cents: 480_000,
    },
  },
  errors: [404],
  mcp: { toolset: 'analytics' },
});

export const getDashboardOverview = defineOperation({
  operationId: 'getDashboardOverview',
  method: 'get',
  path: '/analytics/overview',
  tag: 'Analytics',
  summary: 'The Dashboard: what needs you, sends, replies, goals and deliverability',
  description:
    'The Dashboard tiles (§15.4) for the last `days` days: what is waiting for a person, today’s sends against the capacity plan, the reply rate against the period before with a daily line, goals reached with their estimated value, each live campaign’s funnel, deliverability at a glance, and recent activity.',
  access: 'scoped',
  scopes: ['analytics:read'],
  query: z.object({ days: dayCount().default(7).meta({ description: 'The period, in days.', examples: [7] }) }),
  response: {
    status: 200,
    description: 'The overview.',
    schema: z
      .object({
        days: z.int(),
        needs_you: z.object({ open: count('Open escalations.'), urgent: count('Of them, urgent.'), pending_approval: count('Emails waiting for approval.') }),
        sent_today: z.object({ sent: count('Sent today.'), planned: count('Today’s capacity plan.') }),
        reply_rate: z.object({
          rate: share('Threads replied to of threads emailed, in the period'),
          previous: share('The same, in the period before'),
          change_points: z.number().meta({ description: 'The change, in percentage points.' }),
          daily: z.array(z.object({ day: z.iso.date(), rate: share('That day') })),
        }),
        goals: z.object({ reached: z.array(z.object({ name: z.string(), count: count('Reached in the period.') })), value_cents: z.int().min(0).meta({ description: 'Their estimated value.' }) }),
        campaigns: z.array(z.object({ campaign_id: id('campaign'), name: z.string(), status: describedEnum({ active: 'Sending.', paused: 'Paused.' }, { description: 'Its status.' }), funnel: funnelSchema })),
        deliverability: z.object({
          bounce_rate_7d: share('Hard bounces of sends, 7 days'),
          complaint_rate_7d: share('Complaints of sends, 7 days'),
          domains_passing_dns: count('Domains whose SPF, DKIM and DMARC pass.'),
          domains_blocklisted: count('Domains on a blocklist.'),
          domains: z.array(z.object({ domain_id: id('domain'), domain: z.string(), reputation_band: bandSchema, ramp_step: z.int().min(0), ramp_final_step: z.int().min(0) })),
        }),
        recent_activity: z.array(activitySchema),
      })
      .meta({ id: 'DashboardOverview' }),
    example: {
      days: 7,
      needs_you: { open: 3, urgent: 1, pending_approval: 2 },
      sent_today: { sent: 84, planned: 120 },
      reply_rate: { rate: 0.112, previous: 0.098, change_points: 1.4, daily: [{ day: '2026-11-10', rate: 0.12 }] },
      goals: { reached: [{ name: 'Call booked', count: 9 }, { name: 'Paid', count: 2 }], value_cents: 480_000 },
      campaigns: [{ campaign_id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'Agency outreach Q4', status: 'active', funnel: funnelExample }],
      deliverability: { bounce_rate_7d: 0.009, complaint_rate_7d: 0, domains_passing_dns: 2, domains_blocklisted: 0, domains: [{ domain_id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s', domain: 'getacme.com', reputation_band: 'healthy', ramp_step: 9, ramp_final_step: 13 }] },
      recent_activity: [activityExample],
    },
  },
  mcp: { toolset: 'analytics' },
});

export const listKnowledgeGaps = defineOperation({
  operationId: 'listKnowledgeGaps',
  method: 'get',
  path: '/analytics/knowledge-gaps',
  tag: 'Analytics',
  summary: 'The questions the knowledge base couldn’t answer, most asked first',
  description:
    'Analytics → Knowledge gaps (§11.3): the questions in `knowledge_gap` escalations, grouped when they read the same (case, spacing and punctuation aside), most asked first, with how many are still open and whether an answer was saved as knowledge. Fix the commonest with createKnowledgeItem, or answer them with answerEscalation.',
  access: 'scoped',
  scopes: ['analytics:read'],
  query: z.object({
    days: days('Only questions asked in the last this many days.'),
    campaign_id: id('campaign').optional().meta({ description: 'Only this campaign.' }),
    limit: z.coerce.number().int().min(1).max(200).default(50).meta({ description: 'Most questions to return, 1 to 200.', examples: [50] }),
  }),
  response: {
    status: 200,
    description: 'The questions.',
    schema: z
      .object({
        data: z.array(
          z.object({
            question: z.string().meta({ description: 'How it was asked most recently.' }),
            asked: count('Escalations it came up in.'),
            open: count('Of them, still open.'),
            answered: z.boolean().meta({ description: 'An answer was saved as knowledge for it.' }),
            last_asked_at: z.iso.datetime(),
            escalation_ids: z.array(id('escalation')).meta({ description: 'The latest escalations it came up in, newest first (at most 5).' }),
          }),
        ),
      })
      .meta({ id: 'KnowledgeGaps' }),
    example: { data: [{ question: 'Do you sign BAAs?', asked: 4, open: 1, answered: true, last_asked_at: '2026-11-10T17:52:00Z', escalation_ids: ['esc_01jd3x5k8qf7tb9w2m4n6p8r0s'] }] },
  },
  mcp: { toolset: 'analytics' },
});
