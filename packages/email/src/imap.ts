// Reading a mailbox over IMAP (spec §7.1, §7.3): folders by SPECIAL-USE, incremental UID fetches of
// headers only, full messages fetched with BODY.PEEK so no flag ever changes, APPEND to Sent and a
// Message-ID search for reconciliation. ImapFlow sits behind a small interface so polling can be
// tested without a server.

import { ImapFlow, type FetchMessageObject } from 'imapflow';

export interface ImapAccount {
  host: string;
  port: number;
  username: string;
  auth: { type: 'password'; password: string } | { type: 'oauth2'; accessToken: string };
}

export interface FolderSet {
  inbox: string;
  sent: string | null;
  junk: string | null;
}

/** What the header-only pass knows about a message (§7.3 step 2.2). */
export interface HeaderSummary {
  uid: number;
  internalDate: Date | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string | null;
  to: string[];
  subject: string;
  contentType: string | null;
}

export interface ImapSession {
  folders(): Promise<FolderSet>;
  /** Selects a folder read-only and reports its UIDVALIDITY. */
  open(path: string): Promise<{ uidValidity: bigint; uidNext: number }>;
  /** Headers of messages with a UID above `afterUid`, oldest first. */
  headersAfter(path: string, afterUid: number): AsyncIterable<HeaderSummary>;
  /** Headers of messages since a date, after a UIDVALIDITY change resets the folder (§7.3 step 2.1). */
  headersSince(path: string, since: Date): AsyncIterable<HeaderSummary>;
  /** The full message, fetched with BODY.PEEK[] so `\Seen` is untouched. */
  fetchRaw(path: string, uid: number): Promise<Buffer | null>;
  append(path: string, raw: Buffer, flags: string[]): Promise<void>;
  /** The UID of the message with this Message-ID, if the folder has it. */
  findByMessageId(path: string, messageId: string): Promise<number | null>;
  /** Deletes one message by UID (the connection test's own message only). */
  remove(path: string, uid: number): Promise<void>;
  close(): Promise<void>;
}

export interface ImapConnector {
  connect(account: ImapAccount): Promise<ImapSession>;
}

const HEADER_FIELDS = ['message-id', 'in-reply-to', 'references', 'from', 'to', 'cc', 'subject', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'x-auto-response-suppress', 'content-type', 'list-id'];

function headerValue(block: string, name: string): string | null {
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  return new RegExp(`^${name}:[ \\t]*(.*)$`, 'im').exec(unfolded)?.[1]?.trim() ?? null;
}

const messageIds = (value: string | null) => (value?.match(/<[^<>\s]+>/g) ?? []);
const address = (value: string | null) => /<([^>]+)>/.exec(value ?? '')?.[1]?.toLowerCase() ?? value?.trim().toLowerCase() ?? null;

function summarize(message: FetchMessageObject): HeaderSummary {
  const block = message.headers?.toString('utf8') ?? '';
  return {
    uid: message.uid,
    internalDate: message.internalDate ? new Date(message.internalDate) : null,
    messageId: messageIds(headerValue(block, 'Message-ID'))[0] ?? message.envelope?.messageId ?? null,
    inReplyTo: messageIds(headerValue(block, 'In-Reply-To'))[0] ?? null,
    references: messageIds(headerValue(block, 'References')),
    from: address(headerValue(block, 'From')),
    to: (headerValue(block, 'To') ?? '').split(',').map((entry) => address(entry)).filter((entry): entry is string => Boolean(entry)),
    subject: message.envelope?.subject ?? headerValue(block, 'Subject') ?? '',
    contentType: headerValue(block, 'Content-Type'),
  };
}

/** The live connector, on ImapFlow: TLS on 993 unless `allowPlaintext` (tests only). */
export function imapflowConnector(options: { allowPlaintext?: boolean } = {}): ImapConnector {
  return {
    async connect(account) {
      const client = new ImapFlow({
        host: account.host,
        port: account.port,
        secure: !options.allowPlaintext,
        ...(options.allowPlaintext && { doSTARTTLS: false }),
        auth: account.auth.type === 'password' ? { user: account.username, pass: account.auth.password } : { user: account.username, accessToken: account.auth.accessToken },
        logger: false,
        disableAutoIdle: true,
      });
      await client.connect();

      async function* fetchHeaders(path: string, range: string | { since: Date }): AsyncIterable<HeaderSummary> {
        // Headers are small: read them all, then let go of the folder before the caller asks for
        // whole messages, which needs the same lock.
        const summaries: HeaderSummary[] = [];
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          const query = typeof range === 'string' ? range : ((await client.search({ since: range.since }, { uid: true })) || []).join(',');
          if (query) {
            for await (const message of client.fetch(query, { uid: true, envelope: true, internalDate: true, headers: HEADER_FIELDS }, { uid: true })) summaries.push(summarize(message));
          }
        } finally {
          lock.release();
        }
        yield* summaries.sort((a, b) => a.uid - b.uid);
      }

      return {
        async folders() {
          const list = await client.list();
          const by = (use: string) => list.find((folder) => folder.specialUse === use)?.path ?? null;
          return { inbox: by('\\Inbox') ?? 'INBOX', sent: by('\\Sent'), junk: by('\\Junk') };
        },
        async open(path) {
          const mailbox = await client.mailboxOpen(path, { readOnly: true });
          return { uidValidity: BigInt(mailbox.uidValidity), uidNext: mailbox.uidNext };
        },
        headersAfter: (path, afterUid) => fetchHeaders(path, `${afterUid + 1}:*`),
        headersSince: (path, since) => fetchHeaders(path, { since }),
        async fetchRaw(path, uid) {
          const lock = await client.getMailboxLock(path, { readOnly: true });
          try {
            // `source` is fetched with BODY.PEEK[], which leaves \Seen alone (§7.3 step 2.3).
            const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
            return message ? message.source ?? null : null;
          } finally {
            lock.release();
          }
        },
        async append(path, raw, flags) {
          await client.append(path, raw, flags);
        },
        async findByMessageId(path, messageId) {
          const lock = await client.getMailboxLock(path, { readOnly: true });
          try {
            const uids = (await client.search({ header: { 'message-id': messageId } }, { uid: true })) || [];
            return uids[0] ?? null;
          } finally {
            lock.release();
          }
        },
        async remove(path, uid) {
          const lock = await client.getMailboxLock(path);
          try {
            await client.messageDelete(String(uid), { uid: true });
          } finally {
            lock.release();
          }
        },
        async close() {
          await client.logout().catch(() => client.close());
        },
      };
    },
  };
}
