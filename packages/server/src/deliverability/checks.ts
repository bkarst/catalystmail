// The outside checks on a sending domain (spec §4.4, §8.9, §8.10): its DNS once a day and the
// domain blocklists every 6 hours. A new listing pauses every mailbox on the domain at once.

import { checkBlocklists, type BlocklistDns, type DomainDns } from '@catalyst/email';
import { activities, mailboxes, newId, sending_domains, type Db } from '@catalyst/db';
import { eq } from 'drizzle-orm';

import { checkDomain } from '../sending/domains.ts';
import { logTrip, pauseForBreaker } from './rollup.ts';

export async function blocklistCheck(db: Db, deps: { dns: BlocklistDns; spamhausDqsKey?: string | null }, now: Date): Promise<{ checked: number; listed: number; delisted: number }> {
  const result = { checked: 0, listed: 0, delisted: 0 };
  for (const domain of await db.select().from(sending_domains)) {
    const check = await checkBlocklists(deps.dns, domain.domain, { spamhausDqsKey: deps.spamhausDqsKey ?? null });
    // Delisting needs every list to answer; a refused or failed query keeps a listing standing.
    const listed = check.listed || (domain.blocklisted && check.results.some((entry) => entry.status === 'unknown'));
    await db.transaction(async (tx) => {
      await tx.update(sending_domains).set({ blocklisted: listed, blocklist_details: check.results.map((entry) => ({ ...entry, checked_at: now.toISOString() })) }).where(eq(sending_domains.id, domain.id));
      if (listed && !domain.blocklisted) {
        result.listed += 1;
        const lists = check.results.filter((entry) => entry.status === 'listed').map((entry) => entry.list);
        let paused = 0;
        for (const mailbox of await tx.select().from(mailboxes).where(eq(mailboxes.sending_domain_id, domain.id))) {
          if (await pauseForBreaker(tx, mailbox, `${domain.domain} is on a blocklist (${lists.join(', ')})`, now)) paused += 1;
        }
        await logTrip(tx, domain.workspace_id, { signal: 'blocklist', level: 'pause', scope: 'domain' }, { domain_id: domain.id, domain: domain.domain, lists, mailboxes_paused: paused }, now);
      }
      if (!listed && domain.blocklisted) {
        result.delisted += 1;
        // Its mailboxes stay paused until a person resumes them, having read why (§8.9).
        await tx.insert(activities).values({ id: newId('activity'), workspace_id: domain.workspace_id, type: 'domain.delisted', actor_type: 'system', data: { domain_id: domain.id, domain: domain.domain }, occurred_at: now });
      }
    });
    result.checked += 1;
  }
  return result;
}

const RECORDS = ['spf_status', 'dkim_status', 'dmarc_status', 'mx_status', 'tracking_status'] as const;

/** `deliverability.dns_check`, daily: every domain's DNS again, with a change logged per record. */
export async function dailyDnsCheck(db: Db, deps: { domainDns: DomainDns; trackingTarget: string | null }, now: Date): Promise<{ checked: number; changed: number; failed: number }> {
  const result = { checked: 0, changed: 0, failed: 0 };
  for (const before of await db.select().from(sending_domains)) {
    try {
      await checkDomain(db, before.workspace_id, before.id, deps, now);
    } catch (error) {
      result.failed += 1;
      console.error(`[dns_check] ${before.domain} failed`, error);
      continue;
    }
    result.checked += 1;
    const [after] = await db.select().from(sending_domains).where(eq(sending_domains.id, before.id));
    const changes = RECORDS.filter((record) => before[record] !== null && before[record] !== after![record]).map((record) => ({ record: record.replace('_status', ''), from: before[record], to: after![record] }));
    if (changes.length > 0) {
      result.changed += 1;
      await db.insert(activities).values({ id: newId('activity'), workspace_id: before.workspace_id, type: 'domain.dns_changed', actor_type: 'system', data: { domain_id: before.id, domain: before.domain, changes }, occurred_at: now });
    }
  }
  return result;
}
