// How a mailbox signs in to its SMTP and IMAP servers, from its sealed credentials (§7.1, §16).

import type { Executor, mailboxes } from '@catalyst/db';
import type { ImapAccount, SmtpAccount } from '@catalyst/email';

import type { SecretBox } from '../secrets.ts';
import { dkimSigningFor } from './mailboxes.ts';
import { freshAccessToken, type OAuthConfig } from './oauth.ts';

type MailboxRow = typeof mailboxes.$inferSelect;
type Auth = { type: 'password'; password: string } | { type: 'oauth2'; accessToken: string };

function authOf(mailbox: MailboxRow, secrets: SecretBox): Auth {
  const credentials = JSON.parse(secrets.open(mailbox.credentials_enc)) as { password?: string; access_token?: string };
  return credentials.password !== undefined ? { type: 'password', password: credentials.password } : { type: 'oauth2', accessToken: credentials.access_token ?? '' };
}

export function smtpAccountFor(mailbox: MailboxRow, secrets: SecretBox): SmtpAccount {
  return {
    key: mailbox.id,
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_secure as 'tls' | 'starttls',
    username: mailbox.smtp_username,
    auth: authOf(mailbox, secrets),
    dkim: dkimSigningFor(mailbox, secrets),
  };
}

/** The SMTP account as it signs in right now: an OAuth mailbox gets a fresh access token first. */
export async function liveSmtpAccount(db: Executor, mailbox: MailboxRow, secrets: SecretBox, oauth: OAuthConfig | null | undefined, now: Date): Promise<SmtpAccount> {
  const account = smtpAccountFor(mailbox, secrets);
  return mailbox.auth === 'password' ? account : { ...account, auth: { type: 'oauth2', accessToken: await freshAccessToken(db, mailbox, secrets, oauth, now) } };
}

/** The IMAP account as it signs in right now. */
export async function liveImapAccount(db: Executor, mailbox: MailboxRow, secrets: SecretBox, oauth: OAuthConfig | null | undefined, now: Date): Promise<ImapAccount> {
  const account = imapAccountFor(mailbox, secrets);
  return mailbox.auth === 'password' ? account : { ...account, auth: { type: 'oauth2', accessToken: await freshAccessToken(db, mailbox, secrets, oauth, now) } };
}

export function imapAccountFor(mailbox: MailboxRow, secrets: SecretBox): ImapAccount {
  return { host: mailbox.imap_host, port: mailbox.imap_port, username: mailbox.imap_username, auth: authOf(mailbox, secrets) };
}
