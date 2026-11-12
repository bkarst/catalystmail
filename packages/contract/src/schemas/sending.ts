// Sending domains, their ramp and reputation, and mailboxes (spec §6.5, §8).

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';
import { domainName } from './companies.ts';

export const bandSchema = describedEnum(
  {
    healthy: 'Score 80 or more: full volume, and the ramp moves up.',
    at_risk: 'Score 60–79: volume × 0.75, and the ramp holds.',
    critical: 'Score 40–59: volume × 0.5, and the ramp drops back 2 steps.',
    paused: 'Score below 40: no first touches or follow-ups; replies only.',
  },
  { id: 'ReputationBand', description: 'A reputation band, from a domain or mailbox score (§8.10).' },
);

export const rampPlanSchema = describedEnum(
  {
    new_domain: 'Starts at 20 a day, +15% per sending day (default; for domains under 90 days old or never used for email).',
    aged_domain: 'Starts at 40 a day, +20% per sending day (older domains with normal mail but no outreach).',
    established: 'No ramp: the cap is the total of the mailbox caps. Admin only.',
    custom: 'An explicit step → cap table. Admin only; no step more than 50% above the one before.',
  },
  { id: 'RampPlan', description: 'How a domain’s daily cap grows (§8.3.1).' },
);

export const rampStatusSchema = describedEnum(
  {
    ramping: 'Moving up one step per sending day while Healthy.',
    holding: 'Held, by an admin or because the domain is At risk.',
    stepped_back: 'Dropped back, because the domain went Critical or idle, or by an admin.',
    complete: 'At the top of the plan.',
    stopped: 'The domain is Paused; nothing but replies goes out.',
  },
  { id: 'RampStatus', description: 'Where the ramp stands.' },
);

export const checkStatusSchema = describedEnum(
  { pass: 'Set up correctly.', warn: 'Works, with a recommended improvement.', fail: 'Missing or wrong; blocks launch.' },
  { id: 'CheckStatus', description: 'The result of one DNS check.' },
);

export const recordCheckSchema = z
  .object({
    status: checkStatusSchema,
    name: z.string().meta({ description: 'Where the record lives, e.g. `_dmarc.getacme.com`.' }),
    found: z.array(z.string()).meta({ description: 'What DNS returned.' }),
    expected: z.string().meta({ description: 'What the record should say, to copy into DNS.' }),
    message: z.string().meta({ description: 'What is wrong, or that it is fine, in words.' }),
  })
  .meta({ id: 'RecordCheck' });

export const domainChecksSchema = z
  .object({
    spf: recordCheckSchema,
    dkim: recordCheckSchema,
    dmarc: recordCheckSchema,
    mx: recordCheckSchema,
    tracking: recordCheckSchema,
    ready: z.boolean().meta({ description: 'No launch blocker failed (§8.2).' }),
  })
  .meta({ id: 'DomainChecks', description: 'The last DNS check, record by record.' });

export const scheduleSchema = z.array(z.object({ step: z.int().min(0), cap: z.int().min(1) })).meta({ description: 'Daily caps by ramp step.' });

export const domainSchema = z
  .object({
    id: id('domain'),
    domain: z.string().meta({ description: 'The sending domain.', examples: ['getacme.com'] }),
    tracking_host: z.string().nullable().meta({ description: 'The open and click tracking host, a CNAME on the sending domain.', examples: ['go.getacme.com'] }),
    dkim_selectors: z.array(z.string()).meta({ description: 'DKIM selectors to check; empty means the mail provider’s defaults.' }),
    checks: domainChecksSchema.nullable().meta({ description: 'The last DNS check; null until the first one.' }),
    alignment_status: describedEnum(
      {
        aligned: 'The last connection test’s email passed DMARC with DKIM signed by this domain.',
        not_aligned: 'It passed or failed DMARC without a DKIM signature from this domain.',
        unknown: 'The receiving server reported no usable results.',
      },
      { description: 'What the `Authentication-Results` of the last mailbox connection test said (§7.1); null until a test reaches INBOX.' },
    ).nullable(),
    last_checked_at: timestamp('When DNS was last checked.').nullable(),
    blocklisted: z.boolean().meta({ description: 'The domain or its sending IP is on a major blocklist.' }),
    postmaster: z
      .object({
        connected: z.boolean().meta({ description: 'Google Postmaster Tools is connected for the domain (§8.10).' }),
        synced_at: timestamp('When its data was last fetched.').nullable(),
        spam_rate: z.number().nullable().meta({ description: 'The latest day’s Gmail user-reported spam rate, as a fraction; null with no data.', examples: [0.0008] }),
        auth: z.object({ spf: z.number().nullable(), dkim: z.number().nullable(), dmarc: z.number().nullable() }).meta({ description: 'The latest day’s authentication success rates at Gmail, as fractions.' }),
        compliance: describedEnum({ compliant: 'Meets Gmail’s sender requirements.', needs_work: 'Some requirement isn’t met; it costs reputation points like failing authentication.', unknown: 'No compliance data yet.' }, { description: 'Gmail’s sender compliance status.' }),
        needs_work: z.array(z.string()).meta({ description: 'The requirements Gmail says are unmet, e.g. ONE_CLICK_UNSUBSCRIBE.' }),
        no_data: z.boolean().meta({ description: 'Google shows no data, usually because the domain sends too little to Gmail. Neutral, not good.' }),
        error: z.string().nullable().meta({ description: 'Why the last sync didn’t work.' }),
      })
      .meta({ description: 'Gmail’s view of the domain, from Postmaster Tools. Connect with GET /domains/{domainId}/postmaster/connect (signed in).' }),
    first_touches_paused: z
      .object({ since: timestamp('When it tripped.'), reason: z.string().meta({ description: 'The records that started failing.', examples: ['dkim'] }) })
      .nullable()
      .meta({ description: 'SPF, DKIM or DMARC started failing, so no first emails go from this domain; follow-ups and replies still do (§8.9). Fix the records, check DNS, then resumeDomainFirstTouches.' }),
    reputation_score: z.int().min(0).max(100).meta({ description: 'Domain reputation, 0–100 (§8.10).' }),
    reputation_band: bandSchema,
    ramp: z
      .object({
        plan: rampPlanSchema,
        step: z.int().min(0).meta({ description: 'The current step.' }),
        final_step: z.int().min(0).meta({ description: 'The step at which the plan reaches its ceiling.' }),
        status: rampStatusSchema,
        manual_hold: z.boolean().meta({ description: 'An admin is holding the ramp at this step.' }),
        today_cap: z.int().min(0).meta({ description: 'The domain-wide cap for today: the step (or override) times the band multiplier.' }),
        cap_override: z
          .object({ cap: z.int().min(0), until: z.iso.date(), reason: z.string().nullable() })
          .nullable()
          .meta({ description: 'A temporary cap set by an admin, replacing the step’s cap until the end date.' }),
      })
      .meta({ id: 'DomainRampSummary', description: 'The domain’s ramp in brief; getDomainRamp has the schedule and history.' }),
    mailbox_count: z.int().min(0).meta({ description: 'Mailboxes on this domain.' }),
    created_at: timestamp('When the domain was added.'),
  })
  .meta({ id: 'Domain', description: 'A domain Catalyst sends from, with its DNS, reputation and ramp.' });
export type Domain = z.infer<typeof domainSchema>;

const passCheck = (name: string, expected: string) => ({ status: 'pass' as const, name, found: [expected], expected, message: 'Set up correctly.' });
export const domainExample: Domain = {
  id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s',
  domain: 'getacme.com',
  tracking_host: 'go.getacme.com',
  dkim_selectors: [],
  checks: {
    spf: passCheck('getacme.com', 'v=spf1 include:_spf.google.com ~all'),
    dkim: passCheck('google._domainkey.getacme.com', 'v=DKIM1; k=rsa; p=…'),
    dmarc: passCheck('_dmarc.getacme.com', 'v=DMARC1; p=quarantine; rua=mailto:dmarc@getacme.com'),
    mx: passCheck('getacme.com', 'aspmx.l.google.com'),
    tracking: passCheck('go.getacme.com', 'CNAME catalyst.example.com'),
    ready: true,
  },
  alignment_status: 'aligned',
  last_checked_at: '2026-11-10T08:00:00Z',
  blocklisted: false,
  first_touches_paused: null,
  postmaster: { connected: false, synced_at: null, spam_rate: null, auth: { spf: null, dkim: null, dmarc: null }, compliance: 'unknown', needs_work: [], no_data: true, error: null },
  reputation_score: 91,
  reputation_band: 'healthy',
  ramp: { plan: 'new_domain', step: 9, final_step: 13, status: 'ramping', manual_hold: false, today_cap: 70, cap_override: null },
  mailbox_count: 3,
  created_at: '2026-10-01T09:00:00Z',
};

export const createDomainSchema = z
  .strictObject({
    domain: domainName('The domain to send from. A separate look-alike domain is recommended (§8.1).'),
    tracking_host: domainName('A host on the sending domain for open and click tracking, e.g. go.getacme.com.').optional(),
    ramp_plan: describedEnum(
      { new_domain: 'For domains under 90 days old, or never used for email (default).', aged_domain: 'For older domains with normal mail history but no outreach.' },
      { description: 'The starting ramp plan. Established and custom plans are set by an admin with updateDomainRamp.' },
    ).optional(),
    dkim_selectors: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,63}$/)).max(5).optional().meta({ description: 'DKIM selectors, when the provider’s defaults don’t apply.' }),
  })
  .meta({ id: 'CreateDomain' });

const reason = z.string().min(3).max(500).meta({ description: 'Why, for the audit log and the Events tab.', examples: ['List quality check after the Monday bounce spike'] });

export const updateRampSchema = z
  .strictObject({
    plan: rampPlanSchema,
    custom_schedule: z
      .array(z.strictObject({ step: z.int().min(0).max(100), cap: z.int().min(1).max(10_000) }))
      .min(1)
      .max(100)
      .optional()
      .meta({ description: 'Required for the custom plan: steps 0, 1, 2 … with caps, none more than 50% above the one before.' }),
    reason,
  })
  .meta({ id: 'UpdateDomainRamp' });

export const rampActionSchema = z.strictObject({ reason }).meta({ id: 'RampAction' });

export const stepBackSchema = z
  .strictObject({ steps: z.int().min(1).max(20).optional().meta({ description: 'How many steps to drop back. Defaults to 1.' }), reason })
  .meta({ id: 'StepBackDomainRamp' });

export const capOverrideSchema = z
  .strictObject({
    cap: z.int().min(0).max(10_000).meta({ description: 'The daily cap to use instead of the ramp step’s. Raising is limited to 50% above the current step.' }),
    until: z.iso.date().meta({ description: 'The last day the override applies (workspace timezone), at most 14 days ahead.', examples: ['2026-11-20'] }),
    reason,
  })
  .meta({ id: 'SetDomainCapOverride' });

export const domainRampSchema = z
  .object({
    domain_id: id('domain'),
    plan: rampPlanSchema,
    custom_schedule: scheduleSchema.nullable(),
    step: z.int().min(0).meta({ description: 'The current step.' }),
    final_step: z.int().min(0).meta({ description: 'The step at which the plan reaches its ceiling.' }),
    status: rampStatusSchema,
    status_reason: z.string().nullable().meta({ description: 'Why the ramp is where it is.' }),
    manual_hold: z.boolean().meta({ description: 'An admin is holding the ramp.' }),
    mailbox_cap_total: z.int().min(0).meta({ description: 'The total of the active mailboxes’ daily limits: where the ramp ends.' }),
    today_cap: z.int().min(0).meta({ description: 'Today’s domain-wide cap after the band multiplier.' }),
    tomorrow_cap: z.int().min(0).meta({ description: 'Tomorrow’s cap if the domain stays Healthy and today is a sending day.' }),
    schedule: z
      .array(z.object({ step: z.int().min(0), cap: z.int().min(0) }))
      .meta({ description: 'The cap at every step of the plan, up to its ceiling: the active mailboxes’ total. Every cap is 0 while the domain has no active mailbox.' }),
    cap_override: z.object({ cap: z.int().min(0), until: z.iso.date(), reason: z.string().nullable() }).nullable().meta({ description: 'The temporary cap, if one is set.' }),
    history: z
      .array(
        z.object({
          day: z.iso.date(),
          planned_cap: z.int(),
          sent: z.int(),
          ramp_step: z.int().nullable(),
          ramp_action: z.string().nullable(),
          reputation_band: z.string().nullable(),
        }),
      )
      .meta({ description: 'Planned and sent volume per day for the last 30 days, oldest first.' }),
  })
  .meta({ id: 'DomainRamp', description: 'A domain’s ramp plan, schedule and history (§8.3).' });

export const domainReputationSchema = z
  .object({
    domain_id: id('domain'),
    score: z.int().min(0).max(100).meta({ description: 'The current score.' }),
    band: bandSchema,
    band_changed_at: timestamp('When the band last changed.').nullable(),
    inputs: z.record(z.string(), z.unknown()).meta({ description: 'The inputs of the last recompute and the points each cost (§8.10).' }),
    history: z.array(z.object({ day: z.iso.date(), score: z.int().nullable(), band: z.string().nullable() })).meta({ description: 'The score per day for the last 30 days, oldest first.' }),
  })
  .meta({ id: 'DomainReputation' });

export const mailboxStatusSchema = describedEnum(
  {
    pending: 'Added but its connection test hasn’t passed; it sends nothing.',
    active: 'Sending and polled every 30 minutes.',
    paused: 'Paused by a person or a circuit breaker; still polled for replies, sends nothing.',
    error: 'Polling or sending keeps failing, usually expired credentials.',
  },
  { id: 'MailboxStatus', description: 'Whether a mailbox sends.' },
);

const limits = {
  daily_limit: z.int().min(1).max(500).meta({ description: 'Most emails a day once warmed up. Above 150 needs an admin (`settings:manage`).', examples: [40] }),
  hourly_limit: z.int().min(1).max(60).meta({ description: 'Most emails an hour.', examples: [12] }),
  min_interval_sec: z.int().min(60).max(3600).meta({ description: 'Shortest gap between two sends, in seconds (at least 60).', examples: [120] }),
  max_interval_sec: z.int().min(60).max(7200).meta({ description: 'Longest gap between two sends, in seconds.', examples: [420] }),
  warmup_enabled: z.boolean().meta({ description: 'Whether the daily cap ramps up from the start volume. Cannot be turned off in the first 14 days.' }),
  warmup_start_volume: z.int().min(1).max(100).meta({ description: 'Emails on the first warm-up day.', examples: [10] }),
  warmup_daily_increment: z.int().min(1).max(50).meta({ description: 'How much the warm-up cap grows per Healthy day.', examples: [5] }),
  display_name: z.string().min(1).max(100).meta({ description: 'The sender name recipients see.', examples: ['Alex Rivera'] }),
  signature_text: z.string().max(2000).nullable().meta({ description: 'Plain-text signature appended to every email.' }),
  owner_user_id: id('user', 'Who gets this mailbox’s escalations by default.').nullable(),
};

export const catalystDkimSchema = z
  .object({
    selector: z.string().meta({ description: 'The DKIM selector (`s=`).', examples: ['catalyst'] }),
    record_name: z.string().meta({ description: 'Where to publish the public key: a TXT record at this name.', examples: ['catalyst._domainkey.getacme.com'] }),
    record_value: z.string().meta({ description: 'The TXT record’s value.', examples: ['v=DKIM1; k=rsa; p=MIIBIjANBgkqh…'] }),
  })
  .meta({ id: 'CatalystDkim', description: 'Catalyst signs this mailbox’s mail with its own DKIM key, for a host that doesn’t sign (§7.1). The private key is never returned.' });

export const mailboxSchema = z
  .object({
    id: id('mailbox'),
    email: z.string().meta({ description: 'The sending address.', examples: ['alex@getacme.com'] }),
    sending_domain_id: id('domain', 'The domain the mailbox sends from.'),
    provider: describedEnum({ google: 'Google Workspace.', microsoft: 'Microsoft 365.', other: 'Any SMTP and IMAP host.' }, { description: 'The mail provider, from the SMTP host.' }),
    auth: describedEnum(
      { password: 'Username and password (or an app password).', oauth2_google: 'Google OAuth (XOAUTH2).', oauth2_microsoft: 'Microsoft OAuth (XOAUTH2).' },
      { description: 'How Catalyst signs in.' },
    ),
    smtp_host: z.string(),
    smtp_port: z.int(),
    smtp_secure: describedEnum({ tls: 'TLS from the start (usually port 465).', starttls: 'STARTTLS upgrade (usually port 587).' }, { description: 'How the SMTP connection is secured.' }),
    smtp_username: z.string(),
    imap_host: z.string(),
    imap_port: z.int(),
    imap_username: z.string(),
    folders: z.record(z.string(), z.string()).meta({ description: 'The INBOX, Sent and Junk folders, found by the connection test.', examples: [{ inbox: 'INBOX', sent: '[Gmail]/Sent Mail', junk: '[Gmail]/Spam' }] }),
    status: mailboxStatusSchema,
    status_reason: z.string().nullable().meta({ description: 'Why it is paused or in error.' }),
    ...limits,
    warmup_step: z.int().min(0).meta({ description: 'The current warm-up step.' }),
    today_cap: z.int().min(0).meta({ description: 'Today’s own cap: daily limit and warm-up, times the health multiplier.' }),
    health_score: z.int().min(0).max(100).meta({ description: 'Mailbox health, 0–100 (§8.10).' }),
    health_band: bandSchema,
    last_sent_at: timestamp('When it last sent.').nullable(),
    last_poll_at: timestamp('When it was last polled.').nullable(),
    last_poll_status: z.string().nullable().meta({ description: 'How the last poll went.' }),
    next_poll_at: timestamp('When it will be polled next.').nullable(),
    catalyst_dkim: catalystDkimSchema.nullable(),
    created_at: timestamp('When it was added.'),
    updated_at: timestamp('When it last changed.'),
  })
  .meta({ id: 'Mailbox', description: 'A sending identity. Credentials are write-only and never returned.' });
export type Mailbox = z.infer<typeof mailboxSchema>;

export const mailboxExample: Mailbox = {
  id: 'mbx_01jd3x5k8qf7tb9w2m4n6p8r0s',
  email: 'alex@getacme.com',
  sending_domain_id: 'dom_01jd3x5k8qf7tb9w2m4n6p8r0s',
  provider: 'google',
  auth: 'password',
  smtp_host: 'smtp.gmail.com',
  smtp_port: 465,
  smtp_secure: 'tls',
  smtp_username: 'alex@getacme.com',
  imap_host: 'imap.gmail.com',
  imap_port: 993,
  imap_username: 'alex@getacme.com',
  folders: { inbox: 'INBOX', sent: '[Gmail]/Sent Mail', junk: '[Gmail]/Spam' },
  status: 'active',
  status_reason: null,
  daily_limit: 40,
  hourly_limit: 12,
  min_interval_sec: 120,
  max_interval_sec: 420,
  warmup_enabled: true,
  warmup_start_volume: 10,
  warmup_daily_increment: 5,
  display_name: 'Alex Rivera',
  signature_text: 'Alex Rivera\nAcme',
  owner_user_id: null,
  warmup_step: 6,
  today_cap: 40,
  health_score: 96,
  health_band: 'healthy',
  last_sent_at: '2026-11-10T17:20:00Z',
  last_poll_at: '2026-11-10T17:30:00Z',
  last_poll_status: 'ok',
  next_poll_at: '2026-11-10T18:00:00Z',
  catalyst_dkim: null,
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-11-10T17:30:00Z',
};

export const createMailboxSchema = z
  .strictObject({
    email: z.email().max(320).meta({ description: 'The sending address. Its domain must already be added with createDomain.', examples: ['alex@getacme.com'] }),
    provider: describedEnum(
      { google: 'Google Workspace: smtp.gmail.com and imap.gmail.com.', microsoft: 'Microsoft 365: smtp.office365.com and outlook.office365.com.', other: 'Give the SMTP and IMAP hosts yourself.' },
      { description: 'The mail provider; fills in hosts, ports and folders.' },
    ),
    password: z.string().min(1).max(500).meta({ description: 'The password or app password. Write-only: stored encrypted, never returned.' }),
    smtp_host: z.string().min(1).max(255).optional().meta({ description: 'SMTP host; required for provider other.' }),
    smtp_port: z.int().min(1).max(65535).optional().meta({ description: 'SMTP port; 465 or 587.' }),
    smtp_secure: describedEnum({ tls: 'TLS from the start.', starttls: 'STARTTLS upgrade.' }, { description: 'How SMTP is secured.' }).optional(),
    smtp_username: z.string().min(1).max(320).optional().meta({ description: 'SMTP username; defaults to the email address.' }),
    imap_host: z.string().min(1).max(255).optional().meta({ description: 'IMAP host; required for provider other.' }),
    imap_port: z.int().min(1).max(65535).optional().meta({ description: 'IMAP port; defaults to 993.' }),
    imap_username: z.string().min(1).max(320).optional().meta({ description: 'IMAP username; defaults to the SMTP username.' }),
    ...z.object(limits).partial().shape,
    display_name: limits.display_name,
  })
  .meta({ id: 'CreateMailbox', description: 'A new mailbox. It stays pending until testMailboxConnection passes.' });

export const updateMailboxSchema = z
  .strictObject({
    ...limits,
    password: z.string().min(1).max(500).meta({ description: 'A new password. The mailbox goes back to pending until the connection test passes again.' }),
  })
  .partial()
  .meta({ id: 'UpdateMailbox', description: 'The fields to change. Hosts and the address cannot change; add a new mailbox instead.' });

export const pollRunSchema = z
  .object({
    id: id('poll_run'),
    trigger: describedEnum({ schedule: 'The 30-minute schedule.', manual: '“Check now” in the UI.', api: 'pollMailboxNow.', catch_up: 'On worker start, after downtime.' }, { description: 'What started the poll.' }),
    status: describedEnum({ running: 'Still running.', ok: 'Finished.', partial: 'Finished with some folders failing.', error: 'Failed.' }, { description: 'How it went.' }),
    started_at: timestamp('When it started.'),
    finished_at: timestamp('When it finished.').nullable(),
    duration_ms: z.int().nullable().meta({ description: 'How long it took.' }),
    fetched_count: z.int().meta({ description: 'Messages fetched.' }),
    matched_count: z.int().meta({ description: 'Messages matched to a thread.' }),
    ignored_count: z.int().meta({ description: 'Messages ignored (unknown senders).' }),
    error: z.string().nullable().meta({ description: 'What went wrong.' }),
  })
  .meta({ id: 'PollRun' });

export const mailboxStatsSchema = z
  .object({
    mailbox_id: id('mailbox'),
    days: z
      .array(
        z.object({
          day: z.iso.date(),
          sent: z.int(),
          new_threads: z.int(),
          replies_sent: z.int(),
          bounced_hard: z.int(),
          bounced_soft: z.int(),
          complaints: z.int(),
          inbound_replies: z.int(),
          opens_human: z.int(),
          unsubscribes: z.int(),
        }),
      )
      .meta({ description: 'One row per day with activity, oldest first.' }),
    totals: z.record(z.string(), z.int()).meta({ description: 'The same counts summed over the period.' }),
    health_inputs: z.record(z.string(), z.unknown()).meta({ description: 'The inputs of the last health recompute and the points each cost.' }),
  })
  .meta({ id: 'MailboxStats' });
