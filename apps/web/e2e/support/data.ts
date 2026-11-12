// Test data for the end-to-end suite, written straight to the database in DATABASE_URL. Each
// Playwright worker keeps one of these running (`node e2e/support/data.ts`, see fixtures.ts) and
// sends it commands, one JSON line each ({"id", "command", "args"}); it answers each with a JSON line
// ({"id", "result"} or {"id", "error"}) and exits when its input closes. The commands:
//
//   seed                             a fresh workspace (see below): its ids and the owner's sign-in
//   reply <workspace> <thread>       a new reply on a thread, with its message.received activity
//   import <import>                  processes a committed import, as the worker's import.process job does
//   enroll <workspace> <campaign> <n>  n new contacts in the campaign, waiting for their first email
//   list <workspace> <name> <n>      a static list of n new contacts
//   dns <workspace> <domain>         the real DNS check, against a resolver scripted to pass
//   evaluate <thread>                re-derives a thread, as the worker's thread.evaluate job does
//   suppress <workspace> <email>     a do-not-contact suppression for the address
//   bounces <workspace> <mailbox>    a week with 6% hard bounces, then the rollup that trips the breaker
//
// The suite runs no worker (its schedules would reach real DNS and mail servers), so where a test
// needs a job done, it asks for that one job here.
//
// Each test seeds its own workspace, so tests never share state and can run in parallel. The
// workspace "Acme" has one sending domain (its DNS checked and passing) with one mailbox, and an
// active campaign "Agency outreach Q4" (goals "Call booked" then "Paid", a first email and one
// follow-up, open tracking on) with three conversations:
//   - Priya Natarajan (Globex) asked about SAML SSO and SCIM: a knowledge-gap escalation, and a
//     goal confirmation for "Call booked";
//   - Dana Wu (Northwind) asked about pricing; the agent's draft reply waits for approval;
//   - Ken Ito (Fabrikam) got the first email; a reply from him matched no thread (an escalation).

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

import { activities, ai_runs, campaign_goals, campaign_mailboxes, campaign_step_variants, campaign_steps, campaigns, companies, contacts, createDb, emailHash, escalations, follow_up_sequences, list_members, lists, mailbox_daily_stats, mailboxes, messages, newId, sending_domains, suppressions, threads, users, workspaces } from '@catalyst/db';
import { MemoryQueue } from '@catalyst/jobs';
import { checkDomain, evaluateThread, openToken, processImport, rollupWorkspaceNow, unsubscribeToken } from '@catalyst/server';
import { storageFromEnv } from '@catalyst/storage';
import { eq } from 'drizzle-orm';

const { db, pool } = createDb(process.env.DATABASE_URL!);

const COMMANDS: Record<string, (...args: string[]) => Promise<unknown>> = {
  seed,
  reply,
  import: runImport,
  enroll,
  list,
  dns,
  evaluate: async (threadId: string) => evaluateThread(db, threadId, { now: new Date() }).then(() => ({})),
  bounces,
  suppress: async (workspaceId: string, email: string) => {
    await db.insert(suppressions).values({ id: newId('suppression'), workspace_id: workspaceId, email, email_hash: emailHash(email), reason: 'do_not_contact', source: 'manual', note: 'Asked by phone never to be emailed' });
    return {};
  },
};

const lines = createInterface({ input: process.stdin });
const running: Promise<void>[] = [];
lines.on('line', (line) => {
  const { id, command, args } = JSON.parse(line) as { id: number; command: string; args: string[] };
  running.push(
    (async () => {
      try {
        const handler = COMMANDS[command];
        if (!handler) throw new Error(`Unknown command ${command}`);
        process.stdout.write(`${JSON.stringify({ id, result: await handler(...args) })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) })}\n`);
      }
    })(),
  );
});
lines.on('close', () => void Promise.allSettled(running).then(() => pool.end()));

/** New, verified contacts at Initech: Lead1 Initech <lead1.…@initech.example>, … */
async function newLeads(workspaceId: string, count: number): Promise<string[]> {
  const batch = randomBytes(3).toString('hex');
  const ids: string[] = [];
  for (let index = 1; index <= count; index++) {
    const id = newId('contact');
    await db.insert(contacts).values({ id, workspace_id: workspaceId, email: `lead${index}.${batch}@initech.example`, first_name: `Lead${index}`, last_name: 'Initech', title: 'Head of Operations', email_verification: 'valid', timezone: 'America/New_York' });
    ids.push(id);
  }
  return ids;
}

/** `count` more contacts in a campaign, each with a thread waiting for its first email. */
async function enroll(workspaceId: string, campaignId: string, count: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign || campaign.workspace_id !== workspaceId) throw new Error(`No campaign ${campaignId} in ${workspaceId}`);
  const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.workspace_id, workspaceId));
  const ids: string[] = [];
  for (const contactId of await newLeads(workspaceId, Number(count))) {
    const threadId = newId('thread');
    await db.insert(threads).values({ id: threadId, workspace_id: workspaceId, campaign_id: campaignId, contact_id: contactId, mailbox_id: mailbox!.id });
    await evaluateThread(db, threadId, { now: new Date() });
    ids.push(threadId);
  }
  return { threads: ids };
}

/** A static list of `count` new contacts, for enrolling into a campaign. */
async function list(workspaceId: string, name: string, count: string) {
  const id = newId('list');
  await db.insert(lists).values({ id, workspace_id: workspaceId, name, kind: 'static' });
  const members = await newLeads(workspaceId, Number(count));
  await db.insert(list_members).values(members.map((contactId) => ({ list_id: id, contact_id: contactId })));
  return { listId: id, contacts: members };
}

/**
 * Runs the real DNS check on a domain against a scripted resolver that answers with Google
 * Workspace's records (spec §19.9 E2E-01's "mock DNS resolver"), so the domain is ready to send.
 */
async function dns(workspaceId: string, domainId: string) {
  const [domain] = await db.select().from(sending_domains).where(eq(sending_domains.id, domainId));
  if (!domain || domain.workspace_id !== workspaceId) throw new Error(`No domain ${domainId} in ${workspaceId}`);
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dkim = `v=DKIM1; k=rsa; p=${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`;
  const name = domain.domain;
  const resolver = {
    resolveTxt: async (host: string) => (host === name ? ['v=spf1 include:_spf.google.com ~all'] : host === `_dmarc.${name}` ? ['v=DMARC1; p=quarantine; rua=mailto:dmarc@' + name] : host === `google._domainkey.${name}` ? [dkim] : []),
    resolveMx: async (host: string) => (host === name ? ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'] : []),
    resolveCname: async (host: string) => (domain.tracking_host && host === domain.tracking_host ? [new URL(process.env.E2E_APP_URL!).hostname] : []),
  };
  const checked = await checkDomain(db, workspaceId, domainId, { domainDns: resolver, trackingTarget: new URL(process.env.E2E_APP_URL!).hostname }, new Date());
  return { ready: checked.checks?.ready ?? false };
}

/**
 * Yesterday's stats for a mailbox with 6 hard bounces in 100 sends, then the hourly rollup the
 * worker would run: over 4% trips the mailbox's bounce breaker, which pauses it (§8.9).
 */
async function bounces(workspaceId: string, mailboxId: string) {
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await db.insert(mailbox_daily_stats).values({ mailbox_id: mailboxId, day, sent: 100, new_threads: 100, bounced_hard: 6 });
  const result = await rollupWorkspaceNow(db, workspaceId, new Date());
  const [mailbox] = await db.select({ status: mailboxes.status, reason: mailboxes.status_reason }).from(mailboxes).where(eq(mailboxes.id, mailboxId));
  return { trips: result.trips, ...mailbox };
}

/** What the worker would do with a committed import; the jobs it queues (address checks) don't run. */
async function runImport(importId: string) {
  const outcome = await processImport(db, importId, { storage: storageFromEnv({ ...process.env, STORAGE_DIR: process.env.E2E_STORAGE_DIR, S3_BUCKET: '' }), jobs: new MemoryQueue() }, new Date());
  return { outcome };
}

async function seed() {
  const now = Date.now();
  const H = 3_600_000;
  const D = 24 * H;
  const at = (ms: number) => new Date(now - ms);
  const token = randomBytes(5).toString('hex');

  const workspaceId = newId('workspace');
  await db.insert(workspaces).values({ id: workspaceId, name: 'Acme', physical_address: '500 Howard St, San Francisco, CA 94105', default_timezone: 'America/Los_Angeles' });
  const owner = { id: newId('user'), email: `alex.${token}@getacme.example`, name: 'Alex Rivera', password: 'correct horse battery staple' };
  await db.insert(users).values({ id: owner.id, workspace_id: workspaceId, email: owner.email, name: owner.name, role: 'owner' });

  const domainId = newId('domain');
  await db.insert(sending_domains).values({ id: domainId, workspace_id: workspaceId, domain: 'getacme.example' });
  const mailboxId = newId('mailbox');
  await db.insert(mailboxes).values({ id: mailboxId, workspace_id: workspaceId, sending_domain_id: domainId, email: 'alex@getacme.example', display_name: 'Alex Rivera', signature_text: 'Alex', auth: 'password', status: 'active', smtp_host: 'smtp.getacme.example', smtp_port: 465, smtp_secure: 'tls', smtp_username: 'alex', imap_host: 'imap.getacme.example', imap_username: 'alex', credentials_enc: Buffer.from('x'), credentials_key_version: 1, folders: {}, warmup_enabled: false });

  const campaignId = newId('campaign');
  await db.insert(campaigns).values({ id: campaignId, workspace_id: workspaceId, name: 'Agency outreach Q4', objective: 'Book discovery calls with ops leaders.', status: 'active', persona: {}, sending_window: { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59' } });
  await db.insert(campaign_mailboxes).values({ campaign_id: campaignId, mailbox_id: mailboxId });
  const goals = { call: newId('goal'), paid: newId('goal') };
  await db.insert(campaign_goals).values([
    { id: goals.call, campaign_id: campaignId, position: 1, key: 'call', name: 'Call booked', success_criteria: 'Books a call', playbook: 'Offer the booking link.' },
    { id: goals.paid, campaign_id: campaignId, position: 2, key: 'paid', name: 'Paid', success_criteria: 'Pays', playbook: 'Send the invoice.' },
  ]);
  const initialStep = newId('step');
  await db.insert(campaign_steps).values({ id: initialStep, campaign_id: campaignId, position: 1 });
  await db.insert(campaign_step_variants).values({ id: newId('variant'), step_id: initialStep, label: 'A', subject_template: 'Quick question about {{company}} onboarding', body_template: 'Hi, how do you onboard today?' });
  const sequenceId = newId('sequence');
  await db.insert(follow_up_sequences).values({ id: sequenceId, campaign_id: campaignId, name: 'No reply to the first email', stages: ['sent', 'received'] });
  const followStep = newId('step');
  await db.insert(campaign_steps).values({ id: followStep, campaign_id: campaignId, sequence_id: sequenceId, position: 1 });
  await db.insert(campaign_step_variants).values({ id: newId('variant'), step_id: followStep, label: 'A', body_template: 'Bumping this up.' });

  async function person(first: string, last: string, company: string, domain: string) {
    const companyId = newId('company');
    await db.insert(companies).values({ id: companyId, workspace_id: workspaceId, name: company, domain });
    const id = newId('contact');
    await db.insert(contacts).values({ id, workspace_id: workspaceId, email: `${first.toLowerCase()}@${domain}`, first_name: first, last_name: last, title: 'VP Operations', company_id: companyId, email_verification: 'valid', timezone: 'America/Los_Angeles', city: 'Portland' });
    return { id, companyId };
  }
  // Outbound bodies end the way finished ones do: the signature, then the compliance footer with this
  // message's unsubscribe link and the workspace's address (§8.8).
  const appHost = new URL(process.env.E2E_APP_URL!).hostname;
  const email = (threadId: string, values: Partial<typeof messages.$inferInsert>) => {
    const id = newId('message');
    const outbound = (values.direction ?? 'outbound') === 'outbound';
    const footer = `Alex\n\nIf you'd rather not hear from me, just reply 'no thanks' or click here: https://${appHost}/u/${unsubscribeToken(id, process.env.E2E_TRACKING_SECRET!)} · 500 Howard St, San Francisco, CA 94105`;
    return db
      .insert(messages)
      .values({ id, workspace_id: workspaceId, thread_id: threadId, mailbox_id: mailboxId, direction: 'outbound', status: 'sent', author: 'template', message_id_header: `<${id}@getacme.example>`, from_email: 'alex@getacme.example', from_name: 'Alex Rivera', to_emails: [], subject: 'Quick question', ...values, ...(outbound && values.body_text && { body_text: `${values.body_text}\n\n${footer}` }), ...(outbound && (values.status ?? 'sent') === 'sent' && { tracking_token: openToken(id, process.env.E2E_TRACKING_SECRET!) }) })
      .returning();
  };

  // Priya asked something the agent couldn't answer.
  const priya = await person('Priya', 'Natarajan', 'Globex', 'globex.example');
  const priyaThread = newId('thread');
  await db.insert(threads).values({ id: priyaThread, workspace_id: workspaceId, campaign_id: campaignId, contact_id: priya.id, mailbox_id: mailboxId, subject: 'Quick question about Globex onboarding', first_sent_at: at(12 * D), created_at: at(13 * D), ai_summary: 'Priya asked whether we support SAML SSO and SCIM; a hard requirement for Globex.' });
  const [priyaFirst] = await email(priyaThread, { step_id: initialStep, subject: 'Quick question about Globex onboarding', to_emails: ['priya@globex.example'], body_text: 'Hi Priya,\n\nHow does Globex onboard new ops hires today?', sent_at: at(12 * D), created_at: at(12 * D), open_count: 3, human_open: true });
  await email(priyaThread, { step_id: followStep, subject: 'Re: Quick question about Globex onboarding', to_emails: ['priya@globex.example'], body_text: 'Hi Priya, bumping this up in case it got buried.', sent_at: at(9 * D), created_at: at(9 * D) });
  const [priyaReply] = await email(priyaThread, { direction: 'inbound', status: 'received', author: 'contact', from_email: 'priya@globex.example', from_name: 'Priya Natarajan', to_emails: ['alex@getacme.example'], subject: 'Re: Quick question about Globex onboarding', body_text: 'Looks interesting. Do you support SAML SSO and SCIM? That’s a hard requirement for us.\n\nOn Tue, Alex wrote:\n> Hi Priya, bumping this up', stripped_text: 'Looks interesting. Do you support SAML SSO and SCIM? That’s a hard requirement for us.', inbound_kind: 'human_reply', match_method: 'headers', received_at: at(3 * H), created_at: at(3 * H) });
  const classify = (p: number, intent: string, ago: number, goal: number) =>
    db.insert(ai_runs).values({ id: newId('ai_run'), workspace_id: workspaceId, thread_id: priyaThread, trigger_message_id: priyaReply!.id, task: 'classify_conversation', provider: 'typesafe', model: 'jev-1.13.0', prompt_version: 'conversation.v1', status: 'ok', latency_ms: 300, output: { intent: { type: 'choice', choice: intent, confidence: p, probabilities: { [intent]: p } }, sentiment: { type: 'score', score: 1, confidence: 0.8, probabilities: {} }, temperature: { type: 'score', score: 2, confidence: 0.7, probabilities: {} }, goal_call: { type: 'noul', noul: goal }, goal_paid: { type: 'noul', noul: 0.04 }, esc_knowledge_gap: { type: 'noul', noul: 0.82 } }, created_at: at(ago) });
  await classify(0.6, 'interested', 8 * D, 0.1);
  await classify(0.86, 'question', 3 * H, 0.55);
  await db.update(threads).set({ latest_intent: 'question', latest_intent_p: '0.860', latest_sentiment: 'positive', temperature: '2.00' }).where(eq(threads.id, priyaThread));
  await db.insert(escalations).values([
    { id: newId('escalation'), workspace_id: workspaceId, thread_id: priyaThread, trigger_message_id: priyaReply!.id, reason: 'knowledge_gap', reasons: ['knowledge_gap'], priority: 'high', title: 'Asked about SAML SSO and SCIM', explanation: 'Priya asked whether we support SAML SSO and SCIM. No knowledge item covers SSO, so I didn’t guess.', questions: [{ text: 'Do you support SAML SSO?', why_unanswerable: 'No knowledge item mentions SSO' }, { text: 'Do you support SCIM?', why_unanswerable: 'No knowledge item mentions SCIM' }], due_at: new Date(now + 3 * H), created_at: at(3 * H) },
    { id: newId('escalation'), workspace_id: workspaceId, thread_id: priyaThread, trigger_message_id: priyaReply!.id, reason: 'goal_confirmation', reasons: ['goal_confirmation'], priority: 'normal', title: 'Did Priya Natarajan reach “Call booked”?', explanation: 'The agent thinks so (55%): “Looks interesting.”', goal_id: goals.call, goal_p: '0.550', due_at: new Date(now + D), created_at: at(3 * H) },
  ]);

  // Dana asked about pricing; the agent's reply waits for approval.
  const dana = await person('Dana', 'Wu', 'Northwind', 'northwind.example');
  const danaThread = newId('thread');
  await db.insert(threads).values({ id: danaThread, workspace_id: workspaceId, campaign_id: campaignId, contact_id: dana.id, mailbox_id: mailboxId, subject: 'Quick question about Northwind onboarding', first_sent_at: at(6 * D), created_at: at(7 * D) });
  await email(danaThread, { step_id: initialStep, subject: 'Quick question about Northwind onboarding', to_emails: ['dana@northwind.example'], body_text: 'Hi Dana,\n\nHow does Northwind onboard new ops hires today?', sent_at: at(6 * D), created_at: at(6 * D), open_count: 1, human_open: true });
  const [danaReply] = await email(danaThread, { direction: 'inbound', status: 'received', author: 'contact', from_email: 'dana@northwind.example', from_name: 'Dana Wu', to_emails: ['alex@getacme.example'], subject: 'Re: Quick question about Northwind onboarding', body_text: 'Happy to chat. What does pricing look like for 40 seats?', stripped_text: 'Happy to chat. What does pricing look like for 40 seats?', inbound_kind: 'human_reply', match_method: 'headers', received_at: at(5 * H), created_at: at(5 * H) });
  const [draft] = await email(danaThread, { author: 'ai', status: 'pending_approval', subject: 'Re: Quick question about Northwind onboarding', to_emails: ['dana@northwind.example'], body_text: 'Hi Dana,\n\nFor 40 seats it’s $30 a seat a month on the Team plan. Worth a 20-minute call to see if it fits? Here’s my calendar: https://cal.example/alex', lint_report: [{ rule: 'link_count', severity: 'warning', message: 'One link is fine; keep it to one.' }], in_reply_to_header: danaReply!.message_id_header, created_at: at(4 * H) });

  // Ken got the first email; his reply matched no thread.
  const ken = await person('Ken', 'Ito', 'Fabrikam', 'fabrikam.example');
  const kenThread = newId('thread');
  await db.insert(threads).values({ id: kenThread, workspace_id: workspaceId, campaign_id: campaignId, contact_id: ken.id, mailbox_id: mailboxId, subject: 'Quick question about Fabrikam onboarding', first_sent_at: at(2 * D), created_at: at(3 * D) });
  const [kenFirst] = await email(kenThread, { step_id: initialStep, subject: 'Quick question about Fabrikam onboarding', to_emails: ['ken@fabrikam.example'], body_text: 'Hi Ken,\n\nHow does Fabrikam onboard new ops hires today?', sent_at: at(2 * D), created_at: at(2 * D) });
  await db.insert(messages).values({ id: newId('message'), workspace_id: workspaceId, thread_id: null, mailbox_id: mailboxId, direction: 'inbound', status: 'received', author: 'contact', message_id_header: `<${newId('message')}@fabrikam.example>`, from_email: 'ken@fabrikam.example', from_name: 'Ken Ito', to_emails: ['alex@getacme.example'], subject: 'onboarding', body_text: 'Saw your note. Can you send a deck?', stripped_text: 'Saw your note. Can you send a deck?', inbound_kind: 'human_reply', received_at: at(1 * H), created_at: at(1 * H) });
  await db.insert(escalations).values({ id: newId('escalation'), workspace_id: workspaceId, thread_id: null, reason: 'unmatched_reply', reasons: ['unmatched_reply'], priority: 'normal', title: 'Ken Ito wrote, matching no thread', explanation: 'A reply from a known contact matched no thread. Attach it or ignore it.', due_at: new Date(now + D), created_at: at(1 * H) });

  for (const id of [priyaThread, danaThread, kenThread]) await evaluateThread(db, id, { now: new Date() });
  await dns(workspaceId, domainId);
  await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, thread_id: priyaThread, contact_id: priya.id, campaign_id: campaignId, type: 'escalation.created', actor_type: 'system', data: { reason: 'knowledge_gap', priority: 'high' }, occurred_at: at(3 * H) });

  return {
    workspaceId,
    owner,
    domainId,
    mailboxId,
    campaignId,
    goals,
    contacts: { priya: priya.id, dana: dana.id, ken: ken.id },
    companies: { globex: priya.companyId, northwind: dana.companyId, fabrikam: ken.companyId },
    threads: { priya: priyaThread, dana: danaThread, ken: kenThread },
    draftId: draft!.id,
    messages: { priyaFirst: priyaFirst!.id, kenFirst: kenFirst!.id },
  };
}

/** A new reply on a thread, as inbound processing would record it, so the live stream announces it. */
async function reply(workspaceId: string, threadId: string) {
  const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
  if (!thread || thread.workspace_id !== workspaceId) throw new Error(`No thread ${threadId} in ${workspaceId}`);
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, thread.contact_id));
  const id = newId('message');
  await db.insert(messages).values({ id, workspace_id: workspaceId, thread_id: threadId, mailbox_id: thread.mailbox_id!, direction: 'inbound', status: 'received', author: 'contact', message_id_header: `<${id}@example.org>`, from_email: contact!.email, to_emails: ['alex@getacme.example'], subject: `Re: ${thread.subject}`, body_text: 'One more thing: can we start next week?', stripped_text: 'One more thing: can we start next week?', inbound_kind: 'human_reply', match_method: 'headers', received_at: new Date() });
  await evaluateThread(db, threadId, { now: new Date() });
  await db.insert(activities).values({ id: newId('activity'), workspace_id: workspaceId, thread_id: threadId, contact_id: thread.contact_id, campaign_id: thread.campaign_id, type: 'message.received', actor_type: 'system', data: { message_id: id } });
  return { messageId: id };
}
