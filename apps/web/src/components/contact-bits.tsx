// How a contact's name and email status read (spec §15.11): ✓ valid, ⚠ risky, role or catch-all,
// ✕ invalid or bounced, ⦸ suppressed or unsubscribed, ? not checked; each with its reason as a title.

import type { Schemas } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';

type Contact = Schemas['Contact'];

export const contactName = (contact: Pick<Contact, 'first_name' | 'last_name' | 'email'>) => [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;

const VERIFICATION: Record<string, { mark: string; tone: string; reason: string }> = {
  valid: { mark: '✓', tone: 'text-emerald-600', reason: 'Valid: passed syntax and mail-server checks.' },
  risky: { mark: '⚠', tone: 'text-amber-600', reason: 'Risky: deliverable, but risky, such as a role account.' },
  catch_all: { mark: '⚠', tone: 'text-amber-600', reason: 'Catch-all: the domain accepts every address, so this one can’t be confirmed.' },
  invalid: { mark: '✕', tone: 'text-rose-600', reason: 'Invalid: failed verification. Never emailed.' },
  bounced: { mark: '✕', tone: 'text-rose-600', reason: 'Bounced: a real send hard-bounced. Never emailed again.' },
  unverified: { mark: '?', tone: 'text-zinc-500 dark:text-zinc-400', reason: 'Not checked yet.' },
};

export function EmailStatus({ contact }: { contact: Pick<Contact, 'email_verification' | 'subscription_status' | 'email_flags' | 'do_not_contact'> }) {
  const blocked = contact.subscription_status !== 'subscribed' || contact.do_not_contact;
  const entry = blocked
    ? { mark: '⦸', tone: 'text-zinc-500 dark:text-zinc-400', reason: contact.do_not_contact ? 'Do not contact.' : contact.subscription_status === 'complained' ? 'Reported an email as spam. Never emailed again.' : 'Unsubscribed. Never emailed again.' }
    : (VERIFICATION[contact.email_verification] ?? VERIFICATION.unverified!);
  const flags = contact.email_flags.length ? ` Flags: ${contact.email_flags.join(', ')}.` : '';
  return (
    <span title={entry.reason + flags} className={cn('inline-block w-4 text-center', entry.tone)}>
      <span aria-hidden>{entry.mark}</span>
      <span className="sr-only">{entry.reason + flags}</span>
    </span>
  );
}
