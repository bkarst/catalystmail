// Threads and messages (spec §5.3–§5.8, §6.7).

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';

export const threadStageSchema = describedEnum(
  {
    queued: 'Enrolled; nothing sent yet.',
    sent: 'The first email was accepted by the mail server.',
    received: 'Delivery is proven (an open, click or reply) or inferred (no bounce within the grace period).',
    responded: 'The contact replied.',
    goal_achieved: 'A goal was reached; see achieved_goal_id and stage_label.',
  },
  { id: 'ThreadStage', description: 'Progress on the status ladder (§5.3). Never goes backwards on its own.' },
);

export const threadStateSchema = describedEnum(
  {
    active: 'Automation is running; next_action says what happens next.',
    pending_approval: 'A draft is waiting for a person to approve it.',
    needs_human: 'An escalation is open; automation is held.',
    paused: 'Paused by a person, or the agent was paused because a person took over.',
    completed: 'The final goal was reached.',
    exhausted: 'The follow-ups ran out with no reply. A reply reopens it.',
    closed_lost: 'Not interested, wrong person, or closed by a person. A reply reopens it for a person to decide.',
    bounced: 'The contact’s address hard-bounced.',
    unsubscribed: 'The contact opted out or complained. Nothing is ever sent again.',
    stopped: 'Stopped by hand, or the campaign was archived, or the contact deleted, suppressed or marked do-not-contact.',
  },
  { id: 'ThreadState', description: 'The thread’s operational condition (§5.4), separate from its stage.' },
);

export const nextActionTypeSchema = describedEnum(
  {
    none: 'Nothing is due: the thread is held or finished.',
    send_initial: 'The initial email goes out next.',
    send_reply: 'A reply goes out next.',
    send_follow_up: 'A follow-up goes out next.',
    await_reply: 'Waiting for the contact, with no more follow-ups before the finish rule.',
  },
  { id: 'NextActionType', description: 'What happens next on the thread (§5.5).' },
);

export const openStatusSchema = describedEnum(
  {
    not_tracked: 'Opens are not tracked for these emails.',
    unopened: 'Tracked; no open seen.',
    machine_only: 'Only privacy proxies or security scanners fetched it: delivered, but maybe not read.',
    opened: 'Opened by a person, or a reply or click shows it was read.',
  },
  { id: 'OpenStatus', description: 'Whether the emails were opened (§5.8). A signal, never exact.' },
);

export const threadSchema = z
  .object({
    id: id('thread'),
    campaign: z.object({ id: id('campaign'), name: z.string() }).meta({ description: 'The campaign.' }),
    contact: z
      .object({ id: id('contact'), email: z.string(), name: z.string().nullable(), company: z.string().nullable() })
      .meta({ description: 'The contact, in brief.' }),
    mailbox_id: id('mailbox', 'The mailbox it sends from; set at the first send.').nullable(),
    stage: threadStageSchema,
    stage_rank: z.int().min(0).meta({ description: '0 queued, 1 sent, 2 received, 3 responded, 3+k goal k.' }),
    stage_label: z.string().meta({ description: 'The stage as shown, e.g. "Call booked achieved".', examples: ['Responded'] }),
    achieved_goal_id: id('goal', 'The highest goal reached.').nullable(),
    manual_floor_rank: z.int().min(0).meta({ description: 'A stage set by hand without evidence; the stage never shows lower.' }),
    state: threadStateSchema,
    state_reason: z.string().nullable().meta({ description: 'Why it is in that state, e.g. contact_deleted, no_reply, human_took_over.' }),
    next_action: z
      .object({
        type: nextActionTypeSchema,
        at: timestamp('When it is due.').nullable(),
        message_id: id('message', 'The scheduled email, when there is one.').nullable(),
        throttle_reason: z.string().nullable().meta({ description: 'Which limit pushed it back (§8.3.5), e.g. domain_ramp or window.' }),
      })
      .meta({ description: 'What happens next (§5.5).' }),
    follow_up: z
      .object({
        sequence_id: id('sequence', 'The sequence for the current stage.').nullable(),
        step_position: z.int().nullable().meta({ description: 'The next step to send.' }),
        stopped: z.boolean().meta({ description: 'A person stopped follow-ups on this thread.' }),
        waiting_since: timestamp('When the current wait for the contact began.').nullable(),
        sent: z.int().min(0).meta({ description: 'Follow-ups sent so far.' }),
        check_in_at: timestamp('A check-in the contact asked for (§5.10 rule 5): it replaces the sequence until it is written. Set with scheduleCheckIn.').nullable(),
      })
      .meta({ description: 'Follow-up progress (§5.10).' }),
    open: z
      .object({
        status: openStatusSchema,
        count: z.int().min(0),
        first_opened_at: timestamp('First human open.').nullable(),
        last_opened_at: timestamp('Last human open.').nullable(),
        clicked: z.boolean(),
      })
      .meta({ description: 'Open and click tracking, across the thread’s emails.' }),
    classification: z
      .object({
        intent: z.string().nullable().meta({ description: 'Jev’s top intent for the conversation (§10.4).' }),
        intent_p: z.number().nullable().meta({ description: 'Its probability.' }),
        sentiment: z.string().nullable(),
        temperature: z.number().nullable().meta({ description: '0 cold, 1 curious, 2 evaluating, 3 ready to buy.' }),
        fallback: z.boolean().meta({ description: 'The last classification came from Claude alone, so nothing auto-sends.' }),
      })
      .meta({ description: 'The latest conversation classification.' }),
    ai_paused: z.boolean().meta({ description: 'A person took over; the agent writes nothing.' }),
    manually_paused: z.boolean().meta({ description: 'A person paused the thread.' }),
    closed_reason: z.string().nullable().meta({ description: 'Why it was last closed.' }),
    closed_at: timestamp('When it was last closed.').nullable(),
    subject: z.string().nullable().meta({ description: 'The conversation’s subject.' }),
    summary: z.string().nullable().meta({ description: 'The AI summary of the conversation.' }),
    assigned_user_id: id('user', 'The person handling it.').nullable(),
    open_escalations: z.int().min(0).meta({ description: 'Open escalations; any puts the thread in needs_human.' }),
    ai_replies_sent: z.int().min(0),
    first_sent_at: timestamp('First email accepted.').nullable(),
    received_at: timestamp('Delivery proven or inferred.').nullable(),
    responded_at: timestamp('First reply.').nullable(),
    completed_at: timestamp('Final goal reached.').nullable(),
    last_message_at: timestamp('Latest email either way.').nullable(),
    last_inbound_at: timestamp('Latest email from the contact.').nullable(),
    last_outbound_at: timestamp('Latest email to the contact.').nullable(),
    created_at: timestamp('When the contact was enrolled.'),
    updated_at: timestamp('When the thread last changed.'),
  })
  .meta({ id: 'Thread', description: 'One conversation between one mailbox and one contact in one campaign.' });
export type Thread = z.infer<typeof threadSchema>;

export const threadExample: Thread = {
  id: 'thr_01jd3x5k8qf7tb9w2m4n6p8r0s',
  campaign: { id: 'cmp_01jd3x5k8qf7tb9w2m4n6p8r0s', name: 'Agency outreach Q4' },
  contact: { id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s', email: 'priya@globex.com', name: 'Priya Natarajan', company: 'Globex' },
  mailbox_id: 'mbx_01jd3x5k8qf7tb9w2m4n6p8r0s',
  stage: 'responded',
  stage_rank: 3,
  stage_label: 'Responded',
  achieved_goal_id: null,
  manual_floor_rank: 0,
  state: 'needs_human',
  state_reason: null,
  next_action: { type: 'none', at: null, message_id: null, throttle_reason: null },
  follow_up: { sequence_id: 'seq_01jd3x5k8qf7tb9w2m4n6p8r0s', step_position: 1, stopped: false, waiting_since: null, sent: 2, check_in_at: null },
  open: { status: 'opened', count: 3, first_opened_at: '2026-10-28T16:40:00Z', last_opened_at: '2026-11-10T17:50:00Z', clicked: false },
  classification: { intent: 'question', intent_p: 0.86, sentiment: 'positive', temperature: 2, fallback: false },
  ai_paused: false,
  manually_paused: false,
  closed_reason: null,
  closed_at: null,
  subject: 'Quick question about Globex onboarding',
  summary: 'Priya asked whether we support SAML SSO and SCIM.',
  assigned_user_id: null,
  open_escalations: 1,
  ai_replies_sent: 0,
  first_sent_at: '2026-10-28T16:14:00Z',
  received_at: '2026-10-28T16:40:00Z',
  responded_at: '2026-11-10T17:52:00Z',
  completed_at: null,
  last_message_at: '2026-11-10T17:52:00Z',
  last_inbound_at: '2026-11-10T17:52:00Z',
  last_outbound_at: '2026-11-06T18:12:00Z',
  created_at: '2026-10-27T22:02:00Z',
  updated_at: '2026-11-10T17:53:00Z',
};

export const lintFindingSchema = z
  .object({
    rule: z.string().meta({ description: 'The rule, e.g. `spam_phrase` or `missing_unsubscribe`.' }),
    severity: describedEnum({ blocker: 'Stops sending.', warning: 'Worth fixing.' }, { description: 'How serious it is.' }),
    message: z.string().meta({ description: 'What is wrong, in words.' }),
  })
  .meta({ id: 'LintFinding', description: 'One content linter finding (§8.7).' });

export const messageSchema = z
  .object({
    id: id('message'),
    thread_id: id('thread').nullable(),
    direction: describedEnum({ outbound: 'Sent to the contact.', inbound: 'Received from the contact or someone else.' }, { description: 'Which way it went.' }),
    status: describedEnum(
      {
        draft: 'Not yet submitted for sending.',
        pending_approval: 'Waiting for a person to approve it.',
        scheduled: 'Due to be sent at scheduled_for.',
        sending: 'Being handed to the mail server.',
        sent: 'Accepted by the mail server.',
        bounced: 'Bounced.',
        failed: 'Retries ran out.',
        cancelled: 'Cancelled before sending.',
        superseded: 'Replaced, because a newer reply arrived before it was sent.',
        send_unknown: 'Sending was interrupted; being checked against the Sent folder.',
        received: 'An inbound email.',
      },
      { id: 'MessageStatus', description: 'Where the message stands (§5.7).' },
    ),
    author: describedEnum(
      {
        template: 'A campaign template.',
        ai: 'The AI agent.',
        human_app: 'A person, in Catalyst.',
        human_external: 'A person, from their own mail client.',
        contact: 'The contact.',
        third_party: 'Someone else on the thread.',
        system: 'Catalyst itself, or a mail server (bounces).',
      },
      { id: 'MessageAuthor', description: 'Who wrote it.' },
    ),
    match_method: describedEnum(
      { headers: 'In-Reply-To or References named an email in the thread.', subject_sender: 'Same sender and subject.', sender_fallback: 'Same sender, recent thread ("matched by sender").', dsn_original: 'A bounce or complaint about an email in the thread.', manual: 'A person attached it.' },
      { id: 'MatchMethod', description: 'Inbound: how it was matched to its thread (§7.4).' },
    ).nullable(),
    step_id: id('step', 'The campaign step it was sent for.').nullable(),
    variant_id: id('variant', 'The A/B variant it used.').nullable(),
    subject: z.string(),
    from_email: z.string(),
    from_name: z.string().nullable(),
    to_emails: z.array(z.unknown()).meta({ description: 'Recipients.' }),
    body_text: z.string().nullable().meta({ description: 'The plain-text body.' }),
    stripped_text: z.string().nullable().meta({ description: 'Inbound: the reply without quoted history or signature.' }),
    snippet: z.string().nullable(),
    has_attachments: z.boolean(),
    scheduled_for: timestamp('When it is due to send.').nullable(),
    sent_at: timestamp('When the mail server accepted it.').nullable(),
    received_at: timestamp('When it arrived.').nullable(),
    inbound_kind: z.string().nullable().meta({ description: 'Inbound: human_reply, auto_reply, out_of_office, bounce_hard, … (§7.5).' }),
    open_count: z.int().min(0),
    human_open: z.boolean().meta({ description: 'A person opened it (not a proxy or scanner).' }),
    error: z.string().nullable(),
    lint: z.array(lintFindingSchema).nullable().meta({ description: 'Outbound: the content linter’s findings when it was written or last edited; null for inbound mail.' }),
    approved_at: timestamp('When a person approved it to send.').nullable(),
    created_at: timestamp('When it was stored.'),
    updated_at: timestamp('When it last changed.'),
  })
  .meta({ id: 'Message', description: 'One email in a thread.' });
export type Message = z.infer<typeof messageSchema>;

export const messageExample: Message = {
  id: 'msg_01jd3x5k8qf7tb9w2m4n6p8r0s',
  thread_id: threadExample.id,
  direction: 'inbound',
  status: 'received',
  author: 'contact',
  match_method: 'headers',
  step_id: null,
  variant_id: null,
  subject: 'Re: Quick question about Globex onboarding',
  from_email: 'priya@globex.com',
  from_name: 'Priya Natarajan',
  to_emails: ['alex@getacme.com'],
  body_text: 'Looks interesting. Do you support SAML SSO and SCIM?\n\nOn Tue, Alex wrote: …',
  stripped_text: 'Looks interesting. Do you support SAML SSO and SCIM?',
  snippet: 'Looks interesting. Do you support SAML SSO and SCIM?',
  has_attachments: false,
  scheduled_for: null,
  sent_at: null,
  received_at: '2026-11-10T17:52:00Z',
  inbound_kind: 'human_reply',
  open_count: 0,
  human_open: false,
  error: null,
  lint: null,
  approved_at: null,
  created_at: '2026-11-10T17:53:00Z',
  updated_at: '2026-11-10T17:53:00Z',
};

/** A person's reply waiting in drafts. */
export const draftExample: Message = {
  ...messageExample,
  id: 'msg_01jd3x9m2kq5vb8w7n3p6r4t1y',
  direction: 'outbound',
  status: 'draft',
  author: 'human_app',
  match_method: null,
  subject: 'Re: Quick question about Globex',
  from_email: 'alex@getacme.com',
  from_name: 'Alex Rivera',
  to_emails: ['priya@globex.com'],
  body_text: 'Hi Priya,\n\nYes to both: SAML SSO and SCIM are on every plan.\n\nAlex',
  stripped_text: null,
  snippet: 'Hi Priya, Yes to both: SAML SSO and SCIM are on every plan.',
  received_at: null,
  inbound_kind: null,
  lint: [],
  created_at: '2026-11-10T18:05:00Z',
  updated_at: '2026-11-10T18:05:00Z',
};
