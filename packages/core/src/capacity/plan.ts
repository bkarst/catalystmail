// The daily capacity plan (§8.3.3): how many emails each domain, mailbox and campaign may send
// today. Every figure is a whole number of emails.

import type { Band, SendingPriority } from '../types.ts';

/** Volume multiplier per reputation or health band, in percent (§8.3.2). */
export const BAND_MULTIPLIER_PERCENT: Record<Band, number> = { healthy: 100, at_risk: 75, critical: 50, paused: 0 };
export const PRIORITY_WEIGHT: Record<SendingPriority, number> = { high: 3, normal: 2, low: 1 };
export const REPLY_RESERVE_PERCENT = 15;
export const REPLY_OVERFLOW_PERCENT = 10;

const floorPercent = (value: number, percent: number) => Math.floor((value * percent) / 100);
const ceilPercent = (value: number, percent: number) => Math.floor((value * percent + 99) / 100);

export interface Share {
  id: string;
  /** A non-negative whole number. */
  weight: number;
}

/**
 * Splits `total` in proportion to the weights so that the parts add up exactly: every share is
 * rounded down, then the leftover goes out one at a time to the largest fractional parts. Ties go
 * to the larger share, then to the lower (older) ID.
 */
export function largestRemainder(total: number, shares: readonly Share[]): Map<string, number> {
  const result = new Map<string, number>(shares.map((share) => [share.id, 0]));
  const weightTotal = shares.reduce((sum, share) => sum + share.weight, 0);
  if (total <= 0 || weightTotal <= 0) return result;

  // All shares have the denominator `weightTotal`, so remainders compare as plain integers.
  const parts = shares.map((share) => {
    const scaled = BigInt(total) * BigInt(share.weight);
    return { ...share, whole: Number(scaled / BigInt(weightTotal)), remainder: scaled % BigInt(weightTotal) };
  });
  let leftover = total - parts.reduce((sum, part) => sum + part.whole, 0);
  const byClaim = [...parts].sort(
    (a, b) =>
      (a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1) ||
      b.weight - a.weight ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const part of byClaim) {
    const extra = leftover > 0 && part.weight > 0 ? 1 : 0;
    leftover -= extra;
    result.set(part.id, part.whole + extra);
  }
  return result;
}

export interface CapacityDomain {
  id: string;
  /** The ramp plan's cap at the current step (see `rampCap`). */
  rampCap: number;
  /** A temporary admin override that replaces the ramp cap (§8.3.6). */
  capOverride?: number | null;
  band: Band;
  /** SPF, DKIM or DMARC started failing (§8.9): no first touches until a person resumes them. */
  firstTouchesPaused?: boolean;
}

/** An active mailbox. Paused or errored mailboxes are left out of the plan. */
export interface CapacityMailbox {
  id: string;
  domainId: string;
  dailyLimit: number;
  warmupEnabled: boolean;
  warmupStartVolume: number;
  warmupDailyIncrement: number;
  warmupStep: number;
  band: Band;
  followUpsDueToday: number;
}

/** An active campaign with threads waiting for their first email. */
export interface CapacityCampaign {
  id: string;
  priority: SendingPriority;
  dailyNewThreadsLimit: number;
  mailboxes: readonly { mailboxId: string; weight: number }[];
}

export type MailboxLimit = 'domain_ramp' | 'domain_reputation' | 'domain_auth' | 'mailbox_cap' | 'mailbox_health';
export type CampaignLimit = MailboxLimit | 'campaign_share' | 'campaign_limit';

export interface MailboxPlan {
  mailboxId: string;
  domainId: string;
  /** The mailbox's own cap: daily limit and warm-up, times its health multiplier. */
  cap: number;
  /** Its share of the domain's capacity. Follow-ups and first touches never exceed alloc − replyReserve. */
  alloc: number;
  replyReserve: number;
  /** How far replies may go past `alloc` once the reserve and unused allocation are gone. */
  replyOverflow: number;
  /** The most replies this mailbox may send today. */
  replyLimit: number;
  /** Follow-ups that fit today; the rest roll over. */
  followUps: number;
  firstTouchPool: number;
  limitedBy: MailboxLimit;
  campaigns: { campaignId: string; alloc: number }[];
}

export interface CampaignPlan {
  campaignId: string;
  alloc: number;
  limitedBy: CampaignLimit;
}

export interface CapacityPlan {
  domains: { domainId: string; cap: number; alloc: number }[];
  mailboxes: MailboxPlan[];
  campaigns: CampaignPlan[];
}

function warmupCap(mailbox: CapacityMailbox): number {
  if (!mailbox.warmupEnabled) return mailbox.dailyLimit;
  return Math.min(mailbox.dailyLimit, mailbox.warmupStartVolume + mailbox.warmupDailyIncrement * mailbox.warmupStep);
}

export function planCapacity(input: {
  domains: readonly CapacityDomain[];
  mailboxes: readonly CapacityMailbox[];
  campaigns: readonly CapacityCampaign[];
}): CapacityPlan {
  const plan: CapacityPlan = { domains: [], mailboxes: [], campaigns: [] };

  for (const domain of input.domains) {
    const mailboxes = input.mailboxes.filter((mailbox) => mailbox.domainId === domain.id);
    const domainCap = floorPercent(domain.capOverride ?? domain.rampCap, BAND_MULTIPLIER_PERCENT[domain.band]);
    const caps = mailboxes.map((mailbox) => ({
      id: mailbox.id,
      weight: floorPercent(warmupCap(mailbox), BAND_MULTIPLIER_PERCENT[mailbox.band]),
    }));
    const capTotal = caps.reduce((sum, cap) => sum + cap.weight, 0);
    const domainBinds = domainCap < capTotal;
    const allocs = domainBinds ? largestRemainder(domainCap, caps) : new Map(caps.map((cap) => [cap.id, cap.weight]));

    for (const mailbox of mailboxes) {
      const cap = caps.find((entry) => entry.id === mailbox.id)!.weight;
      const alloc = allocs.get(mailbox.id)!;
      const replyReserve = ceilPercent(alloc, REPLY_RESERVE_PERCENT);
      const replyOverflow = ceilPercent(alloc, REPLY_OVERFLOW_PERCENT);
      const outreach = alloc - replyReserve;
      const followUps = Math.min(mailbox.followUpsDueToday, outreach);
      // A Paused band stops first touches and follow-ups but not replies (§8.3.2). The spec gives
      // no number for that case; replies are then bounded by the mailbox's own warm-up cap.
      const repliesOnly = domain.band === 'paused' || mailbox.band === 'paused';
      plan.mailboxes.push({
        mailboxId: mailbox.id,
        domainId: domain.id,
        cap,
        alloc,
        replyReserve,
        replyOverflow,
        replyLimit: repliesOnly ? warmupCap(mailbox) : alloc + replyOverflow,
        followUps,
        // Failing authentication stops first touches only; follow-ups and replies still go (§8.9).
        firstTouchPool: domain.firstTouchesPaused ? 0 : Math.max(0, outreach - mailbox.followUpsDueToday),
        limitedBy: domain.firstTouchesPaused
          ? 'domain_auth'
          : domainBinds
            ? domain.band === 'healthy' ? 'domain_ramp' : 'domain_reputation'
            : mailbox.band === 'healthy' ? 'mailbox_cap' : 'mailbox_health',
        campaigns: [],
      });
    }
    plan.domains.push({
      domainId: domain.id,
      cap: domainCap,
      alloc: mailboxes.reduce((sum, mailbox) => sum + allocs.get(mailbox.id)!, 0),
    });
  }

  // Split each mailbox's first-touch pool between the campaigns that use it.
  const weightOn = (campaign: CapacityCampaign, mailboxId: string) => {
    const link = campaign.mailboxes.find((entry) => entry.mailboxId === mailboxId);
    return link ? PRIORITY_WEIGHT[campaign.priority] * link.weight : 0;
  };
  for (const mailbox of plan.mailboxes) {
    const shares = input.campaigns
      .map((campaign) => ({ id: campaign.id, weight: weightOn(campaign, mailbox.mailboxId) }))
      .filter((share) => share.weight > 0);
    const split = largestRemainder(mailbox.firstTouchPool, shares);
    mailbox.campaigns = shares.map((share) => ({ campaignId: share.id, alloc: split.get(share.id)! }));
  }

  // Cap each campaign at its daily limit across all of its mailboxes.
  for (const campaign of input.campaigns) {
    const entries = plan.mailboxes.flatMap((mailbox) =>
      mailbox.campaigns.filter((entry) => entry.campaignId === campaign.id).map((entry) => ({ mailbox, entry })),
    );
    const uncapped = entries.reduce((sum, { entry }) => sum + entry.alloc, 0);
    const capped = uncapped > campaign.dailyNewThreadsLimit;
    if (capped) {
      const reduced = largestRemainder(
        campaign.dailyNewThreadsLimit,
        entries.map(({ mailbox, entry }) => ({ id: mailbox.mailboxId, weight: entry.alloc })),
      );
      for (const { mailbox, entry } of entries) entry.alloc = reduced.get(mailbox.mailboxId)!;
    }

    // A campaign is limited by sharing when another campaign with at least its weight uses one of
    // its mailboxes; otherwise by whatever limits the mailbox that gives it the most.
    const outweighed = entries.some(({ mailbox }) =>
      input.campaigns.some(
        (other) =>
          other.id !== campaign.id &&
          weightOn(other, mailbox.mailboxId) > 0 &&
          weightOn(other, mailbox.mailboxId) >= weightOn(campaign, mailbox.mailboxId),
      ),
    );
    const main = [...entries].sort((a, b) => b.entry.alloc - a.entry.alloc)[0];
    plan.campaigns.push({
      campaignId: campaign.id,
      alloc: Math.min(uncapped, campaign.dailyNewThreadsLimit),
      limitedBy: capped ? 'campaign_limit' : outweighed ? 'campaign_share' : (main?.mailbox.limitedBy ?? 'mailbox_cap'),
    });
  }

  return plan;
}
