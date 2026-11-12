// SMTP submission (spec §7.1, §7.2 step 6): one pooled connection per mailbox, and every answer
// sorted into what the send path does next.

import { createTransport, type Transporter } from 'nodemailer';

export interface SmtpAccount {
  /** Identifies the pool; one per mailbox. */
  key: string;
  host: string;
  port: number;
  secure: 'tls' | 'starttls';
  username: string;
  auth: { type: 'password'; password: string } | { type: 'oauth2'; accessToken: string };
  /**
   * Catalyst signs DKIM itself, for a generic host that doesn't (§7.1, `mailboxes.catalyst_dkim`):
   * `d=` the From domain, `s=` the selector, with the PEM private key.
   */
  dkim?: { domainName: string; keySelector: string; privateKey: string } | null;
}

export type SubmitResult =
  | { kind: 'accepted'; response: string }
  /** 4xx: try again later with backoff (§7.2: 1, 5, 15, 60, 240 min). */
  | { kind: 'temporary'; response: string }
  /** The provider's rate or quota limit: pause the mailbox until tomorrow and cut its limit. */
  | { kind: 'quota'; response: string }
  /** 5.1.x: the recipient doesn't exist; a hard bounce. */
  | { kind: 'recipient_rejected'; response: string; status: string | null }
  /** The credentials were refused. */
  | { kind: 'auth_failed'; response: string }
  /** Any other permanent refusal, such as a policy block. */
  | { kind: 'rejected'; response: string; status: string | null };

export interface SmtpTransport {
  submit(account: SmtpAccount, envelope: { from: string; to: string }, raw: Buffer): Promise<SubmitResult>;
  /** Signs in and disconnects; throws when it can't (the connection test, §7.1). */
  verify(account: SmtpAccount): Promise<void>;
  close(): Promise<void>;
}

const ENHANCED = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/;

/** Sorts an SMTP reply (or a connection error) into what happens next (§7.2 step 6). */
export function classifySmtpReply(input: { code?: number | null; response?: string | null; errorCode?: string | null }): SubmitResult {
  const response = input.response?.trim() || input.errorCode || 'no response';
  const code = input.code ?? (Number(/^(\d{3})/.exec(response)?.[1]) || null);
  const enhanced = ENHANCED.exec(response)?.[0] ?? null;
  if (code !== null && code >= 200 && code < 300) return { kind: 'accepted', response };
  if (code === 535 || code === 534 || input.errorCode === 'EAUTH') return { kind: 'auth_failed', response };
  // Rate and quota limits: 421, 4.7.x throttling, and Gmail's 5.4.5 daily quota.
  if (code === 421 || enhanced?.startsWith('4.7.') || enhanced === '5.4.5' || /quota|rate limit|too many messages|daily (user )?sending/i.test(response)) {
    return { kind: 'quota', response };
  }
  if (code !== null && code >= 500) {
    if (enhanced?.startsWith('5.1.') || code === 550 && /no such user|user unknown|does not exist|recipient.*(rejected|unknown)/i.test(response)) {
      return { kind: 'recipient_rejected', response, status: enhanced };
    }
    return { kind: 'rejected', response, status: enhanced };
  }
  // 4xx, and network trouble with no reply at all, are worth another try.
  return { kind: 'temporary', response };
}

interface NodemailerError {
  responseCode?: number;
  response?: string;
  code?: string;
  message?: string;
}

/** The live transport, on Nodemailer: pooled, TLS or STARTTLS, password or XOAUTH2, and DKIM signing when asked. */
export function nodemailerTransport(options: { connectionTimeoutMs?: number; /** Tests only: talk to a local server without TLS. */ allowPlaintext?: boolean } = {}): SmtpTransport {
  const pools = new Map<string, Transporter>();
  const transportFor = (account: SmtpAccount, pooled: boolean): Transporter =>
    createTransport({
      host: account.host,
      port: account.port,
      secure: account.secure === 'tls' && !options.allowPlaintext,
      requireTLS: account.secure === 'starttls' && !options.allowPlaintext,
      ignoreTLS: options.allowPlaintext ?? false,
      pool: pooled,
      maxConnections: 1,
      connectionTimeout: options.connectionTimeoutMs ?? 30_000,
      auth: account.auth.type === 'password' ? { user: account.username, pass: account.auth.password } : { type: 'OAuth2', user: account.username, accessToken: account.auth.accessToken },
    });
  return {
    async submit(account, envelope, raw) {
      let transport = pools.get(account.key);
      if (!transport) {
        transport = transportFor(account, true);
        pools.set(account.key, transport);
      }
      try {
        const info = await transport.sendMail({ envelope: { from: envelope.from, to: [envelope.to] }, raw, ...(account.dkim && { dkim: account.dkim }) });
        return classifySmtpReply({ response: info.response });
      } catch (error) {
        const failure = error as NodemailerError;
        return classifySmtpReply({ code: failure.responseCode ?? null, response: failure.response ?? failure.message ?? null, errorCode: failure.code ?? null });
      }
    },
    async verify(account) {
      const transport = transportFor(account, false);
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
    },
    async close() {
      for (const transport of pools.values()) transport.close();
      pools.clear();
    },
  };
}

/** Transactional mail from Catalyst itself (§4.5 `SYSTEM_SMTP_URL`): alerts, digests, invites. Never a sending mailbox. */
export interface SystemMailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** The system mailer from an `smtp://` or `smtps://` URL, sending as `from`. */
export function systemMailer(url: string, from: string): SystemMailer {
  const transport = createTransport(url);
  return {
    async send(message) {
      await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text, xMailer: false });
    },
  };
}
