// Workspace settings (spec §13.4, §15.18): the name, the physical address in every footer, the
// timezone, the business hours escalation SLAs count in, notifications, and the AI budget (§10.2).

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).meta({ description: '`HH:MM`, 24-hour.' });
const businessHoursSchema = z
  .object({
    days: z.array(z.int().min(1).max(7)).min(1).max(7).meta({ description: 'ISO weekdays: 1 = Monday … 7 = Sunday.' }),
    start: hhmm,
    end: hhmm,
  })
  .meta({ id: 'BusinessHours', description: 'When escalation SLAs run, in the workspace timezone (§11.1).' });

const taskSchema = describedEnum(
  {
    analyze_inbound: 'Reading a reply (§10.5).',
    draft_reply: 'Drafting a reply (§10.6).',
    draft_follow_up: 'Writing an AI follow-up or a check-in (§5.10).',
    personalize: 'Opening lines and AI-written first emails.',
    summarize: 'The rolling thread summary.',
    kb_test: 'Testing the knowledge base.',
  },
  { id: 'ClaudeTask', description: 'A Claude task (§10.1).' },
);
const effortSchema = describedEnum(
  { low: 'Least thinking: fastest and cheapest.', medium: 'The API’s default.', high: 'More thinking.', xhigh: 'More still.', max: 'The most thinking.' },
  { id: 'Effort', description: 'How much the model thinks (`output_config.effort`).' },
);

const disclosureSchema = describedEnum(
  { none: 'Nothing is added (the default, pending legal review, §21).', signature_line: '“Written with help from an AI assistant.” goes under the signature of every email the agent wrote, in whole or in part.' },
  { id: 'AiDisclosure', description: 'Whether AI-written email says so (§10.9). Whatever the setting, the agent never claims to be a person.' },
);

const thresholdNameSchema = describedEnum(
  {
    unsubscribeAct: 'Unsubscribe at or above this (default 0.7).',
    unsubscribeAsk: 'From this up to the act band, sending holds and a person decides (0.3).',
    autoReply: 'An out-of-office or auto-reply is settled at or above this (0.85).',
    needsReplyDraft: 'A reply is drafted at or above this (0.7).',
    needsReplyNone: 'Below this, no reply is needed (0.3).',
    mandatoryEscalate: 'Complaints, legal, a person asked for, identity, pricing: escalate at or above (0.5; never higher).',
    otherEscalate: 'High value and meeting logistics: escalate at or above (0.7).',
    escalationFlag: 'Lower edge of every escalation’s ask band, which only blocks auto-send (0.3).',
    goalAsk: 'A person confirms a goal from this up to the campaign’s auto-confirm threshold (0.5).',
    notInterestedClose: 'Close as not interested at or above, with Claude agreeing (0.85).',
    notInterestedAsk: 'From this, closing goes to a person (0.5).',
    notNow: 'Schedule a check-in at or above, with Claude agreeing and a date (0.7).',
    autoSendIntent: 'A reply may send on its own only when the intent is at least this sure (0.7).',
  },
  { id: 'ClassificationThreshold', description: 'A §10.4 classification threshold (§22.B).' },
);

const quietHoursSchema = z.object({ start: hhmm, end: hhmm }).meta({ id: 'QuietHours', description: 'When high-priority mail waits until morning; urgent mail still goes (§11.2). May span midnight.' });

const settingsSchema = z
  .object({
    id: id('workspace'),
    name: z.string(),
    physical_address: z.string().meta({ description: 'The postal address in the compliance footer (§8.8).' }),
    default_timezone: z.string().meta({ description: 'An IANA zone: the workspace day, and contacts with no zone of their own.', examples: ['Europe/Berlin'] }),
    business_hours: businessHoursSchema,
    notifications: z.object({
      slack_configured: z.boolean().meta({ description: 'A Slack incoming webhook gets alerts; the URL itself is never shown.' }),
      quiet_hours: quietHoursSchema.nullable(),
    }),
    ai: z
      .object({
        monthly_budget_usd: z.number().nullable().meta({ description: 'The most AI may cost in a calendar month (workspace timezone), in USD; null for no cap. At 80% the owners and admins are told; at 100% the agent stops until the month turns, and replies go to a person (§10.2).', examples: [200] }),
        month: z.string().meta({ description: 'The month spend counts in, `YYYY-MM`.', examples: ['2026-11'] }),
        spent_usd: z.number().meta({ description: 'What AI has cost this month, in USD.', examples: [61.25] }),
        used: z.number().nullable().meta({ description: 'Spend over the budget (1 = all of it); null without a budget.', examples: [0.3063] }),
        level: describedEnum({ unlimited: 'No budget is set.', ok: 'Under 80% of the budget.', warning: '80% or more: the owners and admins were told.', exhausted: 'All of it: the agent has stopped until the month turns or the budget is raised.' }, { description: 'Where spend stands against the budget.' }),
        tasks: z
          .array(
            z.object({
              task: taskSchema,
              model: z.string().meta({ description: 'The model it runs on.', examples: ['claude-opus-5-5'] }),
              effort: effortSchema,
              overridden: z.boolean().meta({ description: 'Set for this workspace, rather than the default.' }),
            }),
          )
          .meta({ description: 'Each Claude task’s model and effort (§10.2).' }),
        disclosure: disclosureSchema,
        jev: z
          .object({
            model: z.string().nullable().meta({ description: 'The Jev version classifications run on; null while Jev isn’t set up (§10.4).', examples: ['jev-1.13.0'] }),
            pinned_by: describedEnum({ workspace: 'This workspace’s own pin.', deployment: 'The server’s TYPESAFE_MODEL.' }, { description: 'Where the pin comes from.' }).nullable(),
            thresholds: z.record(z.string(), z.number()).meta({ description: 'The classification thresholds in force (§10.4, §22.B), by name.', examples: [{ unsubscribeAct: 0.7, autoSendIntent: 0.7 }] }),
            thresholds_updated_at: timestamp('When this workspace last changed them; null on the defaults.').nullable(),
          })
          .meta({ description: 'Jev, the classifier of record (§10.4).' }),
      })
      .meta({ id: 'AiSettings' }),
    security: z.object({ require_owner_two_factor: z.boolean().meta({ description: 'Owners must sign in with two-factor authentication (§16).' }) }),
    updated_at: timestamp('When the settings last changed.'),
  })
  .meta({ id: 'WorkspaceSettings' });
const example = { id: 'wsp_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'Acme', physical_address: '500 Howard St, San Francisco, CA 94105', default_timezone: 'America/Los_Angeles', business_hours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }, notifications: { slack_configured: false, quiet_hours: { start: '20:00', end: '07:00' } }, ai: { monthly_budget_usd: 200, month: '2026-11', spent_usd: 61.25, used: 0.3063, level: 'ok' as const, tasks: [{ task: 'analyze_inbound' as const, model: 'claude-opus-5-5', effort: 'low' as const, overridden: false }], disclosure: 'none' as const, jev: { model: 'jev-1.13.0', pinned_by: 'deployment' as const, thresholds: { unsubscribeAct: 0.7 }, thresholds_updated_at: null } }, security: { require_owner_two_factor: false }, updated_at: '2026-11-10T08:00:00Z' };

export const getWorkspaceSettings = defineOperation({
  operationId: 'getWorkspaceSettings',
  method: 'get',
  path: '/settings',
  tag: 'Settings',
  summary: 'Get the workspace settings',
  description: 'The workspace’s name, physical address, timezone, business hours, notification settings, and the AI budget with this month’s spend.',
  access: 'scoped',
  scopes: ['settings:manage'],
  response: { status: 200, description: 'The settings.', schema: settingsSchema, example },
  mcp: { toolset: 'admin' },
});

export const updateWorkspaceSettings = defineOperation({
  operationId: 'updateWorkspaceSettings',
  method: 'patch',
  path: '/settings',
  tag: 'Settings',
  summary: 'Change the workspace settings',
  description: 'Changes the name, physical address, timezone, business hours, notification settings or AI budget. The address appears in every compliance footer from the next email on; business hours apply to escalations raised from now on.',
  access: 'scoped',
  scopes: ['settings:manage'],
  ifMatch: true,
  body: {
    schema: z
      .object({
        name: z.string().trim().min(1).max(100).optional().meta({ description: 'The workspace’s name.' }),
        physical_address: z.string().trim().min(10).max(300).optional().meta({ description: 'A postal address (CAN-SPAM).' }),
        default_timezone: z.string().min(1).max(64).optional().meta({ description: 'An IANA zone.', examples: ['Europe/Berlin'] }),
        business_hours: businessHoursSchema.optional(),
        notifications: z
          .object({
            slack_webhook_url: z.url({ protocol: /^https$/ }).max(500).nullable().optional().meta({ description: 'A Slack incoming-webhook URL for alerts, or null to stop. Stored encrypted.' }),
            quiet_hours: quietHoursSchema.nullable().optional(),
          })
          .strict()
          .optional(),
        ai: z
          .object({
            monthly_budget_usd: z.number().positive().max(1_000_000).nullable().optional().meta({ description: 'USD a calendar month, or null for no cap. Raising it restarts a stopped agent at once.', examples: [200] }),
            tasks: z
              .partialRecord(
                taskSchema,
                z
                  .strictObject({
                    model: z.string().regex(/^claude-[a-z0-9-]+$/).optional().meta({ description: 'A Claude model ID whose prices Catalyst knows, so its runs count against the budget.', examples: ['claude-haiku-5-5'] }),
                    effort: effortSchema.optional(),
                  })
                  .nullable(),
              )
              .optional()
              .meta({ description: 'Per-task overrides; null puts a task back on the default. Move `analyze_inbound` to a smaller model only once the evals show parity (§10.2).', examples: [{ analyze_inbound: { model: 'claude-haiku-5-5' } }] }),
            disclosure: disclosureSchema.optional(),
            jev_model: z.string().regex(/^jev-\d+\.\d+\.\d+$/).nullable().optional().meta({ description: 'Pin this workspace to a Jev version (never jev-latest); null follows the server’s. Move only once the evals pass (§19.7).', examples: ['jev-1.14.0'] }),
            thresholds: z
              .partialRecord(thresholdNameSchema, z.number().min(0).max(1))
              .nullable()
              .optional()
              .meta({ description: 'Overrides of §22.B’s thresholds, merged with the current ones; null goes back to the defaults. Each ask band must stay below its act band, and mandatory escalations can’t be made harder to raise.', examples: [{ autoSendIntent: 0.8 }] }),
          })
          .strict()
          .optional(),
        security: z
          .object({ require_owner_two_factor: z.boolean().optional().meta({ description: 'Require owners to sign in with two-factor authentication. Each owner without it can then do nothing but set it up.' }) })
          .strict()
          .optional(),
      })
      .strict(),
    example: { default_timezone: 'Europe/Berlin', business_hours: { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' } },
  },
  response: { status: 200, description: 'The settings.', schema: settingsSchema, example },
  errors: [412],
  mcp: { toolset: 'admin' },
});

const usageTotals = { runs: z.int().min(0), cost_usd: z.number().meta({ description: 'USD.' }) };

export const getAiUsage = defineOperation({
  operationId: 'getAiUsage',
  method: 'get',
  path: '/settings/ai/usage',
  tag: 'Settings',
  summary: 'What the AI agent cost, and how its runs went',
  description:
    'Settings → AI’s spend chart (§10.2): every Claude and Jev run in the last `days` days, by day in the workspace timezone, by task and by model, with tokens, failures (refusals, errors, invalid output), guardrail blocks and median latency, plus this month’s budget, the classification fallback rate and the Jev/Claude disagreement rate (§15.18 shows the last 7 days).',
  access: 'scoped',
  scopes: ['settings:manage'],
  query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30).meta({ description: 'How many days back, 1 to 90.', examples: [30] }) }),
  response: {
    status: 200,
    description: 'The usage.',
    schema: z
      .object({
        since: timestamp('The start of the period.'),
        total: z.object({ ...usageTotals, input_tokens: z.int().min(0), output_tokens: z.int().min(0), cache_read_tokens: z.int().min(0), cache_write_tokens: z.int().min(0) }),
        by_day: z.array(z.object({ day: z.string().meta({ description: '`YYYY-MM-DD`.' }), ...usageTotals })).meta({ description: 'Days with runs, oldest first.' }),
        by_task: z.array(
          z.object({
            task: z.string().meta({ description: 'The Claude task (§10.1).', examples: ['draft_reply'] }),
            ...usageTotals,
            failed: z.int().min(0).meta({ description: 'Refused, errored or with output that failed validation.' }),
            guardrail_blocked: z.int().min(0).meta({ description: 'Drafts the §10.9 checks stopped.' }),
            median_latency_ms: z.int().nullable(),
          }),
        ),
        by_model: z.array(z.object({ model: z.string().meta({ description: 'As the provider reported it.' }), ...usageTotals })),
        classification_fallback_rate: z.number().min(0).max(1).meta({ description: 'Share of the replies read in the period that Claude classified alone, without a Jev answer (§10.4).' }),
        disagreement_rate: z.number().min(0).max(1).meta({ description: 'Of the replies both Jev and Claude read, the share where they disagreed (§10.4).' }),
        budget: z.object({
          monthly_budget_usd: z.number().nullable(),
          month: z.string(),
          spent_usd: z.number(),
          used: z.number().nullable(),
          level: describedEnum({ unlimited: 'No budget is set.', ok: 'Under 80%.', warning: '80% or more.', exhausted: 'All of it: the agent has stopped.' }, { description: 'Where spend stands.' }),
        }),
      })
      .meta({ id: 'AiUsage' }),
    example: {
      since: '2026-10-12T09:00:00Z',
      total: { runs: 412, cost_usd: 61.25, input_tokens: 2_400_000, output_tokens: 310_000, cache_read_tokens: 1_900_000, cache_write_tokens: 120_000 },
      by_day: [{ day: '2026-11-10', runs: 18, cost_usd: 2.71 }],
      by_task: [{ task: 'draft_reply', runs: 140, cost_usd: 31.2, failed: 1, guardrail_blocked: 6, median_latency_ms: 8200 }],
      by_model: [{ model: 'claude-opus-5-5', runs: 412, cost_usd: 61.25 }],
      classification_fallback_rate: 0.02,
      disagreement_rate: 0.05,
      budget: { monthly_budget_usd: 200, month: '2026-11', spent_usd: 61.25, used: 0.3063, level: 'ok' },
    },
  },
  mcp: { toolset: 'admin' },
});
