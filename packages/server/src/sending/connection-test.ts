// The mailbox connection test (spec §7.1): sign in over SMTP and IMAP, find the folders, send a
// message to the mailbox itself, find it in INBOX and read how SPF, DKIM and DMARC judged it,
// look for the copy in Sent, then delete it. A pending mailbox becomes active when it passes.

import { randomBytes } from 'node:crypto';

import { activities, mailboxes, newId, sending_domains, type Db } from '@catalyst/db';
import {
  authenticationResultsOf,
  buildMime,
  parseAuthenticationResults,
  type AuthenticationResults,
  type FolderSet,
  type ImapConnector,
  type ImapSession,
  type SmtpAccount,
  type SmtpTransport,
} from '@catalyst/email';
import { eq } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import type { SecretBox } from '../secrets.ts';
import { actorOf } from '../shared.ts';
import { liveImapAccount, liveSmtpAccount } from './accounts.ts';
import type { OAuthConfig } from './oauth.ts';
import { findMailbox, serializeMailbox, type MailboxRow } from './mailboxes.ts';

export type TestStep = 'smtp_auth' | 'imap_auth' | 'folders' | 'send' | 'receive' | 'sent_copy' | 'cleanup';
export type StepStatus = 'pass' | 'warn' | 'fail' | 'skipped';
export interface StepResult {
  step: TestStep;
  status: StepStatus;
  detail: string | null;
}

/** `sending_domains.alignment_status`: what the self-test's `Authentication-Results` said (§7.1, §8.2). */
export type AlignmentStatus = 'aligned' | 'not_aligned' | 'unknown';

export interface ConnectionTestDeps {
  smtp: SmtpTransport;
  imap: ImapConnector;
  secrets: SecretBox;
  now?: () => Date;
  /** OAuth clients, for Google and Microsoft mailboxes' access tokens (§7.1). */
  oauth?: OAuthConfig | null;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the message in INBOX: 120 s (§7.1). */
  receiveTimeoutMs?: number;
  /** How often to look for it meanwhile. */
  receivePollMs?: number;
}

const RECEIVE_TIMEOUT_MS = 120_000;
const RECEIVE_POLL_MS = 5_000;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Words for the receive step, and whether the result is good enough to pass (§7.1 step 4). */
function judge(auth: AuthenticationResults, domain: string): { status: StepStatus; detail: string; alignment: AlignmentStatus } {
  const summary = `SPF ${auth.spf}, DKIM ${auth.dkim}, DMARC ${auth.dmarc}`;
  if (auth.spf === 'unknown' && auth.dkim === 'unknown' && auth.dmarc === 'unknown') {
    return { status: 'warn', detail: 'The receiving server added no Authentication-Results header, so SPF, DKIM and DMARC could not be checked here. The DNS check still applies.', alignment: 'unknown' };
  }
  if (auth.dmarc === 'fail') {
    return { status: 'fail', detail: `${summary}. DMARC failed: recipients will reject or junk this mailbox’s mail until SPF or DKIM passes for ${domain}.`, alignment: 'not_aligned' };
  }
  if (auth.aligned) return { status: 'pass', detail: `${summary} (aligned).`, alignment: 'aligned' };
  const signer = auth.dkimDomain ? `DKIM is signed by ${auth.dkimDomain}, not ${domain}` : `No DKIM signature for ${domain} passed`;
  return { status: 'warn', detail: `${summary}. ${signer}; set up DKIM signing for ${domain} so forwarding doesn’t break DMARC.`, alignment: auth.dmarc === 'pass' ? 'not_aligned' : 'unknown' };
}

async function findIn(session: ImapSession, folder: string | null, messageId: string): Promise<number | null> {
  return folder ? session.findByMessageId(folder, messageId) : null;
}

/** Runs the checklist. Steps after a failure that they depend on are `skipped`. */
export async function testMailboxConnection(db: Db, principal: Principal, mailboxId: string, deps: ConnectionTestDeps) {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const mailbox = await findMailbox(db, principal.workspace.id, mailboxId);
  const [domain] = await db.select().from(sending_domains).where(eq(sending_domains.id, mailbox.sending_domain_id));
  const steps: StepResult[] = [];
  const record = (step: TestStep, status: StepStatus, detail: string | null = null) => steps.push({ step, status, detail });
  const patch: Partial<MailboxRow> = {};
  let alignment: AlignmentStatus | null = null;
  let session: ImapSession | null = null;

  try {
    // 1. SMTP sign-in.
    let smtpOk = false;
    let smtpAccount: SmtpAccount | null = null;
    try {
      smtpAccount = await liveSmtpAccount(db, mailbox, deps.secrets, deps.oauth, (deps.now ?? (() => new Date()))());
      await deps.smtp.verify(smtpAccount);
      smtpOk = true;
      record('smtp_auth', 'pass', `Signed in to ${mailbox.smtp_host}:${mailbox.smtp_port}.`);
    } catch (error) {
      record('smtp_auth', 'fail', `Could not sign in to ${mailbox.smtp_host}:${mailbox.smtp_port}: ${reason(error)}`);
    }

    // 2. IMAP sign-in, tried even when SMTP failed, so both problems show at once.
    try {
      session = await deps.imap.connect(await liveImapAccount(db, mailbox, deps.secrets, deps.oauth, (deps.now ?? (() => new Date()))()));
      record('imap_auth', 'pass', `Signed in to ${mailbox.imap_host}:${mailbox.imap_port}.`);
    } catch (error) {
      record('imap_auth', 'fail', `Could not sign in to ${mailbox.imap_host}:${mailbox.imap_port}: ${reason(error)}`);
    }

    // 3. Folders, by SPECIAL-USE.
    let folders: FolderSet | null = null;
    if (session) {
      try {
        folders = await session.folders();
        patch.folders = { inbox: folders.inbox, ...(folders.sent && { sent: folders.sent }), ...(folders.junk && { junk: folders.junk }) };
        const missing = [!folders.sent && 'Sent', !folders.junk && 'Junk'].filter(Boolean);
        const found = `INBOX is ${folders.inbox}, Sent is ${folders.sent ?? 'missing'}, Junk is ${folders.junk ?? 'missing'}.`;
        record('folders', missing.length ? 'warn' : 'pass', missing.length ? `${found} Without ${missing.join(' or ')}, ${missing.includes('Sent') ? 'sent mail can’t be reconciled' : 'replies filed as spam will be missed'}.` : found);
      } catch (error) {
        record('folders', 'fail', `Could not list folders: ${reason(error)}`);
      }
    } else record('folders', 'skipped');

    // 4. A message to the mailbox itself.
    const messageId = `<test.${randomBytes(8).toString('hex')}@${(domain?.domain ?? mailbox.email.split('@')[1]!).toLowerCase()}>`;
    let sent = false;
    if (smtpOk && folders) {
      const raw = await buildMime({
        from: { name: mailbox.display_name, email: mailbox.email },
        to: mailbox.email,
        subject: 'Catalyst connection test',
        text: 'This message checks that Catalyst can send and receive with this mailbox. It is deleted automatically.',
        html: null,
        messageId,
        date: now(),
      });
      try {
        const result = await deps.smtp.submit(smtpAccount!, { from: mailbox.email, to: mailbox.email }, raw);
        sent = result.kind === 'accepted';
        record('send', sent ? 'pass' : 'fail', sent ? `Sent to ${mailbox.email}.` : `The server refused it: ${result.response}`);
      } catch (error) {
        record('send', 'fail', `Sending failed: ${reason(error)}`);
      }
    } else record('send', 'skipped');

    // 5. Find it in INBOX (or Junk) within 120 s and read its Authentication-Results.
    let inbox: { folder: string; uid: number } | null = null;
    if (sent && session && folders) {
      const deadline = now().getTime() + (deps.receiveTimeoutMs ?? RECEIVE_TIMEOUT_MS);
      for (;;) {
        const inInbox = await findIn(session, folders.inbox, messageId);
        const inJunk = inInbox === null ? await findIn(session, folders.junk, messageId) : null;
        if (inInbox !== null) inbox = { folder: folders.inbox, uid: inInbox };
        else if (inJunk !== null) inbox = { folder: folders.junk!, uid: inJunk };
        if (inbox || now().getTime() >= deadline) break;
        await sleep(deps.receivePollMs ?? RECEIVE_POLL_MS);
      }
      if (inbox) {
        const raw = await session.fetchRaw(inbox.folder, inbox.uid);
        const verdict = judge(parseAuthenticationResults(raw ? authenticationResultsOf(raw) : [], domain?.domain ?? ''), domain?.domain ?? '');
        alignment = verdict.alignment;
        const junked = inbox.folder !== folders.inbox;
        record('receive', junked && verdict.status === 'pass' ? 'warn' : verdict.status, junked ? `It arrived in ${inbox.folder}, not INBOX. ${verdict.detail}` : verdict.detail);
      } else {
        record('receive', 'fail', `It did not arrive in ${folders.inbox} within ${Math.round((deps.receiveTimeoutMs ?? RECEIVE_TIMEOUT_MS) / 1000)} s.`);
      }
    } else record('receive', 'skipped');

    // 6. The copy in Sent: without one, Catalyst saves its own (§7.2 step 8).
    let sentCopy: number | null = null;
    if (sent && session && folders) {
      if (!folders.sent) {
        patch.append_to_sent = false;
        record('sent_copy', 'warn', 'There is no Sent folder, so copies of Catalyst’s mail can’t be kept there.');
      } else {
        sentCopy = await findIn(session, folders.sent, messageId);
        patch.append_to_sent = sentCopy === null;
        record('sent_copy', 'pass', sentCopy === null ? `The server keeps no copy in ${folders.sent}; Catalyst will save one for each email it sends.` : `The server keeps a copy in ${folders.sent}.`);
      }
    } else record('sent_copy', 'skipped');

    // 7. Delete the test message, wherever it landed.
    if (session && (inbox || sentCopy !== null)) {
      try {
        if (inbox) await session.remove(inbox.folder, inbox.uid);
        if (sentCopy !== null && folders?.sent) await session.remove(folders.sent, sentCopy);
        record('cleanup', 'pass', 'Deleted the test message.');
      } catch (error) {
        record('cleanup', 'warn', `Could not delete the test message (subject “Catalyst connection test”); delete it by hand. ${reason(error)}`);
      }
    } else record('cleanup', 'skipped');
  } finally {
    await session?.close().catch(() => undefined);
  }

  const passed = steps.every((step) => step.status !== 'fail');
  const at = now();
  const firstFailure = steps.find((step) => step.status === 'fail');
  const row = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(mailboxes).where(eq(mailboxes.id, mailbox.id)).for('update');
    // A pending or failed mailbox becomes active when the test passes; a paused one stays paused.
    if (passed && (current!.status === 'pending' || current!.status === 'error')) Object.assign(patch, { status: 'active', status_reason: null });
    if (!passed && current!.status === 'pending') patch.status_reason = `Connection test failed at ${firstFailure!.step}: ${firstFailure!.detail}`.slice(0, 500);
    const [updated] = await tx.update(mailboxes).set({ ...patch, updated_at: at }).where(eq(mailboxes.id, mailbox.id)).returning();
    if (alignment && domain) await tx.update(sending_domains).set({ alignment_status: alignment }).where(eq(sending_domains.id, domain.id));
    await tx.insert(activities).values({
      id: newId('activity'),
      workspace_id: principal.workspace.id,
      type: 'mailbox.connection_tested',
      ...actorOf(principal),
      data: { mailbox_id: mailbox.id, passed, failed_steps: steps.filter((step) => step.status === 'fail').map((step) => step.step), activated: updated!.status === 'active' && current!.status !== 'active' },
      occurred_at: at,
    });
    return updated!;
  });
  return { passed, steps, mailbox: serializeMailbox(row) };
}
