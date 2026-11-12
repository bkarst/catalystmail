// Domains, ramps and mailboxes (spec §13.4 "Mailboxes, domains, deliverability").

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery } from '../common.ts';
import { defineOperation } from '../operation.ts';
import {
  capOverrideSchema,
  createDomainSchema,
  createMailboxSchema,
  domainExample,
  domainRampSchema,
  domainReputationSchema,
  domainSchema,
  mailboxExample,
  mailboxSchema,
  mailboxStatsSchema,
  mailboxStatusSchema,
  pollRunSchema,
  rampActionSchema,
  stepBackSchema,
  updateMailboxSchema,
  updateRampSchema,
} from '../schemas/sending.ts';

const domainParams = z.object({ domainId: id('domain', 'The sending domain.') });
const mailboxParams = z.object({ mailboxId: id('mailbox', 'The mailbox.') });

const rampExample = {
  domain_id: domainExample.id,
  plan: 'new_domain' as const,
  custom_schedule: null,
  step: 9,
  final_step: 13,
  status: 'ramping' as const,
  status_reason: 'healthy',
  manual_hold: false,
  mailbox_cap_total: 120,
  today_cap: 70,
  tomorrow_cap: 81,
  schedule: [20, 23, 26, 30, 35, 40, 46, 53, 61, 70, 81, 93, 107, 120].map((cap, step) => ({ step, cap })),
  cap_override: null,
  history: [{ day: '2026-11-09', planned_cap: 61, sent: 58, ramp_step: 8, ramp_action: 'advanced', reputation_band: 'healthy' }],
};

// ── Domains ────────────────────────────────────────────────────────────────────────────────────

export const listDomains = defineOperation({
  operationId: 'listDomains',
  method: 'get',
  path: '/domains',
  tag: 'Domains',
  summary: 'List sending domains',
  description: 'Returns every sending domain with its DNS check, reputation band and ramp in brief, by name. Use getDomainRamp or getDomainReputation for the detail.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  query: z.object(paginationQuery),
  response: { status: 200, description: 'A page of domains.', schema: paginated(domainSchema, 'Domain'), example: { data: [domainExample], next_cursor: null } },
  mcp: { toolset: 'deliverability' },
});

export const createDomain = defineOperation({
  operationId: 'createDomain',
  method: 'post',
  path: '/domains',
  tag: 'Domains',
  summary: 'Add a sending domain',
  description:
    'Adds a domain to send from and starts it on a ramp plan (new_domain unless told otherwise). Then publish the SPF, DKIM, DMARC and tracking records and run checkDomainDns; add mailboxes with createMailbox. Fails with `conflict` if the domain is already added.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  idempotencyKey: 'optional',
  body: { schema: createDomainSchema, example: { domain: 'getacme.com', tracking_host: 'go.getacme.com' } },
  response: { status: 201, description: 'The domain that was added.', schema: domainSchema, example: { ...domainExample, checks: null, last_checked_at: null, mailbox_count: 0 } },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const getDomain = defineOperation({
  operationId: 'getDomain',
  method: 'get',
  path: '/domains/{domainId}',
  tag: 'Domains',
  summary: 'Get one sending domain',
  description: 'Returns a domain with its last DNS check record by record, reputation band and ramp in brief.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  params: domainParams,
  response: { status: 200, description: 'The domain.', schema: domainSchema, example: domainExample },
  mcp: { toolset: 'deliverability' },
});

export const deleteDomain = defineOperation({
  operationId: 'deleteDomain',
  method: 'delete',
  path: '/domains/{domainId}',
  tag: 'Domains',
  summary: 'Remove a sending domain',
  description: 'Removes a domain that has no mailboxes. Fails with `conflict` while mailboxes still use it; delete or move those first.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: domainParams,
  response: { status: 204, description: 'The domain was removed.' },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const checkDomainDns = defineOperation({
  operationId: 'checkDomainDns',
  method: 'post',
  path: '/domains/{domainId}/check',
  tag: 'Domains',
  summary: 'Check a domain’s SPF, DKIM, DMARC, MX and tracking records now',
  description:
    'Looks up the domain’s DNS records, stores the result and returns the domain. Each record comes with what was found and what is expected, so a failing one can be fixed by copying the expected value. Failing SPF, DKIM, DMARC or MX blocks campaign launch (§8.2). It also runs daily.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: domainParams,
  response: { status: 200, description: 'The domain with its new check.', schema: domainSchema, example: domainExample },
  mcp: { toolset: 'deliverability' },
});

export const resumeDomainFirstTouches = defineOperation({
  operationId: 'resumeDomainFirstTouches',
  method: 'post',
  path: '/domains/{domainId}/first-touches/resume',
  tag: 'Domains',
  summary: 'Let first emails go again after an authentication failure',
  description:
    'When SPF, DKIM or DMARC stops passing, Catalyst stops first emails from the domain and tells the owners (§8.9). Once the records pass again (run checkDomainDns), this lets them go again. Pass `acknowledge_cause: true` to confirm you have read and dealt with the cause; this is audited. Answers 409 while a record still fails.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: domainParams,
  body: {
    schema: z.strictObject({ acknowledge_cause: z.boolean().optional().meta({ description: 'Required: true.' }) }).meta({ id: 'ResumeDomainFirstTouches' }),
    example: { acknowledge_cause: true },
  },
  response: { status: 200, description: 'The domain, sending first emails again.', schema: domainSchema, example: domainExample },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const getDomainReputation = defineOperation({
  operationId: 'getDomainReputation',
  method: 'get',
  path: '/domains/{domainId}/reputation',
  tag: 'Domains',
  summary: 'Get a domain’s reputation score, what it costs and its history',
  description: 'Returns the domain reputation score and band, the points each input cost in the last recompute (§8.10), and the score per day for 30 days. Scores are measured and cannot be changed.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  params: domainParams,
  response: {
    status: 200,
    description: 'The reputation.',
    schema: domainReputationSchema,
    example: { domain_id: domainExample.id, score: 91, band: 'healthy', band_changed_at: null, inputs: { points: { hardBounces: 9 } }, history: [{ day: '2026-11-09', score: 91, band: 'healthy' }] },
  },
  mcp: { toolset: 'deliverability' },
});

export const getDomainRamp = defineOperation({
  operationId: 'getDomainRamp',
  method: 'get',
  path: '/domains/{domainId}/ramp',
  tag: 'Domains',
  summary: 'Get a domain’s ramp plan, schedule and planned vs sent history',
  description: 'Returns the ramp plan, current step, today’s and tomorrow’s cap, the full schedule, any cap override and 30 days of planned vs sent volume (§8.3).',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  params: domainParams,
  response: { status: 200, description: 'The ramp.', schema: domainRampSchema, example: rampExample },
  mcp: { toolset: 'deliverability' },
});

function rampChange<const Id extends string, const P extends string, const M extends 'post' | 'patch', B extends z.ZodType>(
  operationId: Id,
  path: P,
  method: M,
  summary: string,
  description: string,
  body: B,
  example: z.input<B>,
) {
  return defineOperation({
    operationId,
    method,
    path,
    tag: 'Domains',
    summary,
    description: `${description} Needs \`settings:manage\`; written to the audit log with the reason.`,
    access: 'scoped',
    scopes: ['settings:manage'],
    params: domainParams,
    body: { schema: body, example },
    response: { status: 200, description: 'The ramp after the change.', schema: domainRampSchema, example: rampExample },
    errors: [409],
    mcp: { toolset: 'deliverability' },
  });
}

export const updateDomainRamp = rampChange(
  'updateDomainRamp',
  '/domains/{domainId}/ramp',
  'patch',
  'Change a domain’s ramp plan',
  'Switches the plan (new_domain, aged_domain, established or custom with a schedule). The domain keeps its step; established jumps to the full mailbox total, so use it only for domains already sending outreach with good results.',
  updateRampSchema,
  { plan: 'aged_domain', reason: 'The domain has sent normal mail for two years' },
);
export const holdDomainRamp = rampChange(
  'holdDomainRamp',
  '/domains/{domainId}/ramp/hold',
  'post',
  'Hold a domain’s ramp at its current step',
  'Stops the ramp moving up until resumeDomainRamp. Reputation can still step it back.',
  rampActionSchema,
  { reason: 'Checking list quality' },
);
export const resumeDomainRamp = rampChange(
  'resumeDomainRamp',
  '/domains/{domainId}/ramp/resume',
  'post',
  'Let a held ramp move up again',
  'Ends a manual hold. The ramp moves up again on the next Healthy sending day.',
  rampActionSchema,
  { reason: 'List cleaned' },
);
export const stepBackDomainRamp = rampChange(
  'stepBackDomainRamp',
  '/domains/{domainId}/ramp/step-back',
  'post',
  'Drop a domain’s ramp back by hand',
  'Moves the ramp back by `steps` (default 1), lowering today’s cap at the next plan run.',
  stepBackSchema,
  { steps: 2, reason: 'Bounce spike on Monday' },
);

export const setDomainCapOverride = defineOperation({
  operationId: 'setDomainCapOverride',
  method: 'put',
  path: '/domains/{domainId}/cap-override',
  tag: 'Domains',
  summary: 'Set a temporary daily cap for a domain',
  description:
    'Replaces the ramp step’s cap until `until` (at most 14 days). Lowering has no limit; raising is limited to 50% above the current step and answers `validation_failed` beyond that. Needs `settings:manage`; audited.',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: domainParams,
  body: { schema: capOverrideSchema, example: { cap: 30, until: '2026-11-20', reason: 'Holiday week' } },
  response: { status: 200, description: 'The ramp with the override.', schema: domainRampSchema, example: { ...rampExample, cap_override: { cap: 30, until: '2026-11-20', reason: 'Holiday week' } } },
  mcp: { toolset: 'deliverability' },
});

export const clearDomainCapOverride = defineOperation({
  operationId: 'clearDomainCapOverride',
  method: 'delete',
  path: '/domains/{domainId}/cap-override',
  tag: 'Domains',
  summary: 'Remove a domain’s temporary cap',
  description: 'Ends a cap override early; the ramp step’s cap applies again. Needs `settings:manage`; audited.',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: domainParams,
  response: { status: 204, description: 'The override was removed.' },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

// ── Mailboxes ──────────────────────────────────────────────────────────────────────────────────

export const listMailboxes = defineOperation({
  operationId: 'listMailboxes',
  method: 'get',
  path: '/mailboxes',
  tag: 'Mailboxes',
  summary: 'List mailboxes',
  description: 'Returns the sending mailboxes with status, limits, warm-up, health and polling, by address. Credentials are never returned.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  query: z.object({
    ...paginationQuery,
    domain_id: id('domain').optional().meta({ description: 'Only mailboxes on this domain.' }),
    status: mailboxStatusSchema.optional().meta({ description: 'Only mailboxes with this status.' }),
  }),
  response: { status: 200, description: 'A page of mailboxes.', schema: paginated(mailboxSchema, 'Mailbox'), example: { data: [mailboxExample], next_cursor: null } },
  mcp: { toolset: 'deliverability' },
});

export const createMailbox = defineOperation({
  operationId: 'createMailbox',
  method: 'post',
  path: '/mailboxes',
  tag: 'Mailboxes',
  summary: 'Connect a mailbox with a password or app password',
  description:
    'Adds a sending mailbox on a domain you already added. The password is stored encrypted and never returned. The mailbox stays pending, sending nothing, until testMailboxConnection passes. Warm-up starts at 10 a day. For Google or Microsoft OAuth, connect from Settings instead.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  idempotencyKey: 'optional',
  body: { schema: createMailboxSchema, example: { email: 'alex@getacme.com', display_name: 'Alex Rivera', provider: 'google', password: 'app-password-here' } },
  response: { status: 201, description: 'The mailbox that was added.', schema: mailboxSchema, example: { ...mailboxExample, status: 'pending', warmup_step: 0, today_cap: 10 } },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const getMailbox = defineOperation({
  operationId: 'getMailbox',
  method: 'get',
  path: '/mailboxes/{mailboxId}',
  tag: 'Mailboxes',
  summary: 'Get one mailbox',
  description: 'Returns a mailbox with its status, limits, warm-up, health and polling. Credentials are never returned.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  params: mailboxParams,
  response: { status: 200, description: 'The mailbox.', schema: mailboxSchema, example: mailboxExample },
  mcp: { toolset: 'deliverability' },
});

export const updateMailbox = defineOperation({
  operationId: 'updateMailbox',
  method: 'patch',
  path: '/mailboxes/{mailboxId}',
  tag: 'Mailboxes',
  summary: 'Change a mailbox’s limits, warm-up, signature or password',
  description:
    'Changes only the fields you send, within the fixed limits of §8.3.4: a daily limit above 150 needs `settings:manage`, sends are at least 60 s apart, and warm-up stays on for the first 14 days. A new password is audited and puts the mailbox back to pending until the connection test passes.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: mailboxParams,
  ifMatch: true,
  body: { schema: updateMailboxSchema, example: { daily_limit: 30, signature_text: 'Alex\nAcme' } },
  response: { status: 200, description: 'The mailbox after the change.', schema: mailboxSchema, example: mailboxExample },
  mcp: { toolset: 'deliverability' },
});

export const deleteMailbox = defineOperation({
  operationId: 'deleteMailbox',
  method: 'delete',
  path: '/mailboxes/{mailboxId}',
  tag: 'Mailboxes',
  summary: 'Remove a mailbox that never sent',
  description: 'Removes a mailbox and its stored credentials. A mailbox with threads or messages cannot be removed, because its conversations would lose their sender: answers `conflict`; pause it instead.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: mailboxParams,
  response: { status: 204, description: 'The mailbox was removed.' },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const pauseMailbox = defineOperation({
  operationId: 'pauseMailbox',
  method: 'post',
  path: '/mailboxes/{mailboxId}/pause',
  tag: 'Mailboxes',
  summary: 'Pause sending from a mailbox',
  description: 'Stops all sending from the mailbox, including replies. It is still polled, so replies are still received and handled. Undo with resumeMailbox.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: mailboxParams,
  body: { schema: z.strictObject({ reason: z.string().min(1).max(500).optional().meta({ description: 'Why, shown on the mailbox.' }) }).meta({ id: 'PauseMailbox' }), example: { reason: 'Vacation' } },
  response: { status: 200, description: 'The paused mailbox.', schema: mailboxSchema, example: { ...mailboxExample, status: 'paused', status_reason: 'Paused by hand: Vacation' } },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const createMailboxDkimKey = defineOperation({
  operationId: 'createMailboxDkimKey',
  method: 'post',
  path: '/mailboxes/{mailboxId}/dkim',
  tag: 'Mailboxes',
  summary: 'Have Catalyst sign a mailbox’s mail with its own DKIM key',
  description:
    'For a generic SMTP host that doesn’t sign DKIM (§7.1): Catalyst makes a 2048-bit RSA key, keeps the private key encrypted, and signs every email from the mailbox with it. Publish the returned TXT record, then run checkDomainDns: the selector is added to the domain’s, so the check looks for it. Mailboxes on the same domain share one key and record. Google and Microsoft sign their own mail, so their mailboxes answer 409.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: mailboxParams,
  body: {
    schema: z.strictObject({ selector: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional().meta({ description: 'The selector to publish under; `catalyst` by default.', examples: ['catalyst'] }) }).meta({ id: 'CreateMailboxDkimKey' }),
    example: { selector: 'catalyst' },
  },
  response: { status: 200, description: 'The mailbox, with the record to publish.', schema: mailboxSchema, example: { ...mailboxExample, provider: 'other', catalyst_dkim: { selector: 'catalyst', record_name: 'catalyst._domainkey.getacme.com', record_value: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqh…' } } },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const deleteMailboxDkimKey = defineOperation({
  operationId: 'deleteMailboxDkimKey',
  method: 'delete',
  path: '/mailboxes/{mailboxId}/dkim',
  tag: 'Mailboxes',
  summary: 'Stop signing a mailbox’s mail with Catalyst’s DKIM key',
  description: 'Mail from the mailbox goes out unsigned by Catalyst again. The key is deleted once no mailbox on the domain uses it; the DNS record can then be removed.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: mailboxParams,
  response: { status: 200, description: 'The mailbox.', schema: mailboxSchema, example: mailboxExample },
  errors: [409],
  mcp: { toolset: 'deliverability', destructive: true },
});

export const resumeMailbox = defineOperation({
  operationId: 'resumeMailbox',
  method: 'post',
  path: '/mailboxes/{mailboxId}/resume',
  tag: 'Mailboxes',
  summary: 'Resume sending from a paused mailbox',
  description:
    'Resumes a paused mailbox. If a circuit breaker paused it (bounces, complaints, blocklist), you must pass `acknowledge_cause: true` to confirm you have read and dealt with the cause (§8.9); this is audited.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: mailboxParams,
  body: {
    schema: z
      .strictObject({ acknowledge_cause: z.boolean().optional().meta({ description: 'Required (true) when a circuit breaker paused the mailbox.' }) })
      .meta({ id: 'ResumeMailbox' }),
    example: { acknowledge_cause: true },
  },
  response: { status: 200, description: 'The mailbox, sending again.', schema: mailboxSchema, example: mailboxExample },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});

export const listPollRuns = defineOperation({
  operationId: 'listPollRuns',
  method: 'get',
  path: '/mailboxes/{mailboxId}/poll-runs',
  tag: 'Mailboxes',
  summary: 'List a mailbox’s recent polls',
  description: 'Returns the mailbox’s IMAP polls, newest first, with how many messages each fetched and matched and any error.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  params: mailboxParams,
  query: z.object(paginationQuery),
  response: {
    status: 200,
    description: 'A page of poll runs.',
    schema: paginated(pollRunSchema, 'PollRun'),
    example: {
      data: [{ id: 'prn_01jd3x5k8qf7tb9w2m4n6p8r0s', trigger: 'schedule', status: 'ok', started_at: '2026-11-10T17:30:00Z', finished_at: '2026-11-10T17:30:04Z', duration_ms: 4100, fetched_count: 3, matched_count: 2, ignored_count: 1, error: null }],
      next_cursor: null,
    },
  },
  mcp: { toolset: 'deliverability' },
});

export const getMailboxStats = defineOperation({
  operationId: 'getMailboxStats',
  method: 'get',
  path: '/mailboxes/{mailboxId}/stats',
  tag: 'Mailboxes',
  summary: 'Get a mailbox’s daily sending, bounce and reply counts',
  description: 'Returns per-day counts for the last `days` days (default 30) with totals, and the inputs of the mailbox health score.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  params: mailboxParams,
  query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30).meta({ description: 'How many days back, 1 to 90.', examples: [30] }) }),
  response: {
    status: 200,
    description: 'The stats.',
    schema: mailboxStatsSchema,
    example: {
      mailbox_id: mailboxExample.id,
      days: [{ day: '2026-11-09', sent: 38, new_threads: 30, replies_sent: 4, bounced_hard: 0, bounced_soft: 1, complaints: 0, inbound_replies: 5, opens_human: 12, unsubscribes: 0 }],
      totals: { sent: 38 },
      health_inputs: {},
    },
  },
  mcp: { toolset: 'deliverability' },
});

export const testMailboxConnection = defineOperation({
  operationId: 'testMailboxConnection',
  method: 'post',
  path: '/mailboxes/{mailboxId}/test',
  tag: 'Mailboxes',
  summary: 'Run the mailbox connection test',
  description:
    'Checks SMTP and IMAP sign-in, finds the INBOX, Sent and Junk folders, sends a test email to the mailbox itself, finds it in INBOX and reads its SPF, DKIM and DMARC results, checks the Sent copy, and deletes it (§7.1). The mailbox becomes active when the test passes. Takes up to two minutes.',
  access: 'scoped',
  scopes: ['mailboxes:write'],
  params: mailboxParams,
  response: {
    status: 200,
    description: 'The checklist.',
    schema: z
      .object({
        passed: z.boolean().meta({ description: 'Every required step passed; the mailbox is now active.' }),
        steps: z
          .array(
            z.object({
              step: describedEnum(
                {
                  smtp_auth: 'Signing in to the SMTP server.',
                  imap_auth: 'Signing in to the IMAP server.',
                  folders: 'Finding INBOX, Sent and Junk.',
                  send: 'Sending a test email to the mailbox itself.',
                  receive: 'Finding it in INBOX, with SPF, DKIM and DMARC results.',
                  sent_copy: 'Finding the copy in Sent.',
                  cleanup: 'Deleting the test email.',
                },
                { description: 'Which step.' },
              ),
              status: describedEnum({ pass: 'Passed.', warn: 'Works, but worth a look.', fail: 'Failed.', skipped: 'Not run because an earlier step failed.' }, { description: 'How it went.' }),
              detail: z.string().nullable().meta({ description: 'What happened.' }),
            }),
          )
          .meta({ description: 'Each step, in order.' }),
        mailbox: mailboxSchema,
      })
      .meta({ id: 'ConnectionTest' }),
    example: {
      passed: true,
      steps: [
        { step: 'smtp_auth', status: 'pass', detail: null },
        { step: 'receive', status: 'pass', detail: 'SPF pass, DKIM pass, DMARC pass (aligned).' },
      ],
      mailbox: mailboxExample,
    },
  },
  mcp: { toolset: 'deliverability' },
});

export const pollMailboxNow = defineOperation({
  operationId: 'pollMailboxNow',
  method: 'post',
  path: '/mailboxes/{mailboxId}/poll',
  tag: 'Mailboxes',
  summary: 'Check a mailbox for new mail now',
  description:
    'Queues an immediate poll ("Check now"), the same as the 30-minute schedule. Returns at once (202); see listPollRuns for the result. Answers 409 `poll_in_progress` while a poll of this mailbox is running.',
  access: 'scoped',
  scopes: ['mailboxes:read'],
  params: mailboxParams,
  response: {
    status: 202,
    description: 'The poll is queued.',
    schema: z
      .object({ mailbox_id: id('mailbox'), queued_at: z.iso.datetime().meta({ description: 'When the poll was queued.' }), last_poll_at: z.iso.datetime().nullable().meta({ description: 'When the previous poll finished.' }) })
      .meta({ id: 'PollQueued' }),
    example: { mailbox_id: mailboxExample.id, queued_at: '2026-11-10T17:40:00Z', last_poll_at: '2026-11-10T17:30:00Z' },
  },
  errors: [409],
  mcp: { toolset: 'deliverability' },
});
