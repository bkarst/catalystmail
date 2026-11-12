// Domain reputation and mailbox health scores, their bands, and the circuit breakers
// (§8.9, §8.10). Scores are measured, never overridden.

import { HOUR_MS, type Band } from '../types.ts';

export interface RateWindow {
  sends: number;
  hardBounces: number;
  /** ARF reports plus replies classified as complaints. */
  complaints: number;
}

export interface RateWindows {
  last7Days: RateWindow;
  last30Days: RateWindow;
}

const MIN_SENDS_FOR_RATE = 50;
const MIN_EVENTS_AT_LOW_VOLUME = 3;

/**
 * An event rate under the small-volume rules: 7 days when it has 50 sends, else 30 days. With
 * fewer than 50 sends in 30 days the rate counts only once there are at least 3 events, so one
 * bounce on day two can't sink a new domain.
 */
export function eventRate(windows: RateWindows, pick: (window: RateWindow) => number): number {
  const { last7Days, last30Days } = windows;
  if (last7Days.sends >= MIN_SENDS_FOR_RATE) return pick(last7Days) / last7Days.sends;
  if (last30Days.sends >= MIN_SENDS_FOR_RATE) return pick(last30Days) / last30Days.sends;
  if (last30Days.sends === 0 || pick(last30Days) < MIN_EVENTS_AT_LOW_VOLUME) return 0;
  return pick(last30Days) / last30Days.sends;
}

/** Points lost to a rate: the full weight at `fullAt` or above, proportionally less below it. */
const ratePoints = (weight: number, rate: number, fullAt: number) => Math.round(weight * Math.min(1, rate / fullAt));
const flagPoints = (weight: number, flag: boolean) => (flag ? weight : 0);

export function bandForScore(score: number): Band {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'at_risk';
  if (score >= 40) return 'critical';
  return 'paused';
}

export interface DomainReputationInputs extends RateWindows {
  /** Gmail user-reported spam rate from Postmaster Tools; null when Google reports no data (neutral). */
  gmailSpamRate: number | null;
  /** The domain or a sending IP is on a major blocklist. */
  blocklisted: boolean;
  /** SPF, DKIM or DMARC failing, or Gmail's compliance status failing. */
  authenticationFailing: boolean;
  /** Replies found in Junk folders in the last 7 days. */
  junkReplies: number;
  /** Human-open rate now against its 30-day baseline; null when opens aren't tracked. */
  humanOpenRate: { recent: number; baseline: number; sends: number } | null;
}

export interface Score<Points> {
  score: number;
  band: Band;
  /** Points each input cost; they add up to 100 − score unless the score hit the floor of 0. */
  points: Points;
  hardBounceRate: number;
  complaintRate: number;
}

export type DomainPoints = Record<
  'hardBounces' | 'complaints' | 'blocklist' | 'authentication' | 'junkReplies' | 'openRate',
  number
>;

export function domainReputation(inputs: DomainReputationInputs): Score<DomainPoints> {
  const hardBounceRate = eventRate(inputs, (window) => window.hardBounces);
  const complaintRate = Math.max(eventRate(inputs, (window) => window.complaints), inputs.gmailSpamRate ?? 0);
  const open = inputs.humanOpenRate;
  const points: DomainPoints = {
    hardBounces: ratePoints(40, hardBounceRate, 0.05),
    complaints: ratePoints(30, complaintRate, 0.003),
    blocklist: flagPoints(30, inputs.blocklisted),
    authentication: flagPoints(20, inputs.authenticationFailing),
    junkReplies: flagPoints(10, inputs.junkReplies >= 2),
    openRate: flagPoints(10, open !== null && open.sends >= 200 && open.recent < open.baseline / 2),
  };
  return finish(points, hardBounceRate, complaintRate);
}

export interface MailboxHealthInputs extends RateWindows {
  /** A provider rate or quota error in the last 7 days. */
  providerQuotaError: boolean;
  /** Send or poll errors in the last 24 hours. */
  recentErrors: boolean;
}

export type MailboxPoints = Record<'hardBounces' | 'complaints' | 'providerQuota' | 'recentErrors', number>;

export function mailboxHealth(inputs: MailboxHealthInputs): Score<MailboxPoints> {
  const hardBounceRate = eventRate(inputs, (window) => window.hardBounces);
  const complaintRate = eventRate(inputs, (window) => window.complaints);
  const points: MailboxPoints = {
    hardBounces: ratePoints(40, hardBounceRate, 0.05),
    complaints: ratePoints(30, complaintRate, 0.003),
    providerQuota: flagPoints(20, inputs.providerQuotaError),
    recentErrors: flagPoints(10, inputs.recentErrors),
  };
  return finish(points, hardBounceRate, complaintRate);
}

function finish<Points extends Record<string, number>>(points: Points, hardBounceRate: number, complaintRate: number): Score<Points> {
  const lost = Object.values(points).reduce((sum, value) => sum + value, 0);
  const score = Math.max(0, 100 - lost);
  return { score, band: bandForScore(score), points, hardBounceRate, complaintRate };
}

const SEVERITY: Record<Band, number> = { healthy: 0, at_risk: 1, critical: 2, paused: 3 };
const HOURS_TO_IMPROVE = 24;

export interface BandState {
  band: Band;
  /** When the score first sat in a better range than `band`; null when it isn't. */
  improvingSince: Date | null;
}

/**
 * No flapping: a band gets worse immediately, but only improves after the score has stayed in the
 * better range for 24 hours.
 */
export function nextBand(current: BandState, score: number, now: Date): BandState & { changed: boolean } {
  const target = bandForScore(score);
  if (SEVERITY[target] > SEVERITY[current.band]) return { band: target, improvingSince: null, changed: true };
  if (target === current.band) return { band: current.band, improvingSince: null, changed: false };
  const since = current.improvingSince ?? now;
  if (now.getTime() - since.getTime() >= HOURS_TO_IMPROVE * HOUR_MS) return { band: target, improvingSince: null, changed: true };
  return { band: current.band, improvingSince: since, changed: false };
}

export type BreakerSignal =
  | 'hard_bounce_rate'
  | 'campaign_early_bounces'
  | 'complaint_rate'
  | 'blocklist'
  | 'authentication'
  | 'provider_quota'
  | 'open_rate_collapse'
  | 'junk_replies';

export interface BreakerTrip {
  signal: BreakerSignal;
  level: 'warn' | 'pause';
  /** What a pause stops. `domain_first_touches` still allows replies. */
  scope: 'mailbox' | 'campaign' | 'domain' | 'domain_first_touches';
}

/** Per-mailbox breakers over a rolling 7 days. Rates are compared in whole numbers. */
export function mailboxBreakers(input: { sends: number; hardBounces: number; complaints: number; providerQuotaError: boolean }): BreakerTrip[] {
  const trips: BreakerTrip[] = [];
  if (input.sends >= MIN_SENDS_FOR_RATE) {
    if (input.hardBounces * 100 >= input.sends * 4) trips.push({ signal: 'hard_bounce_rate', level: 'pause', scope: 'mailbox' });
    else if (input.hardBounces * 100 >= input.sends * 2) trips.push({ signal: 'hard_bounce_rate', level: 'warn', scope: 'mailbox' });
  }
  if (input.sends > 0 && input.complaints > 0) {
    if (input.complaints * 1000 >= input.sends * 3) trips.push({ signal: 'complaint_rate', level: 'pause', scope: 'mailbox' });
    else if (input.complaints * 1000 >= input.sends) trips.push({ signal: 'complaint_rate', level: 'warn', scope: 'mailbox' });
  }
  if (input.providerQuotaError) trips.push({ signal: 'provider_quota', level: 'pause', scope: 'mailbox' });
  return trips;
}

/** Hard bounces in a campaign's first 50 sends: 3 warn, 5 pause the campaign ("check your list"). */
export function campaignBreaker(hardBouncesInFirst50Sends: number): BreakerTrip | null {
  if (hardBouncesInFirst50Sends >= 5) return { signal: 'campaign_early_bounces', level: 'pause', scope: 'campaign' };
  if (hardBouncesInFirst50Sends >= 3) return { signal: 'campaign_early_bounces', level: 'warn', scope: 'campaign' };
  return null;
}

export function domainBreakers(input: {
  blocklisted: boolean;
  authenticationFailing: boolean;
  junkReplies: number;
  /** Human-open rate over the latest sends against what it used to be. */
  humanOpenRate: { recent: number; previous: number; sends: number } | null;
}): BreakerTrip[] {
  const trips: BreakerTrip[] = [];
  if (input.blocklisted) trips.push({ signal: 'blocklist', level: 'pause', scope: 'domain' });
  if (input.authenticationFailing) trips.push({ signal: 'authentication', level: 'pause', scope: 'domain_first_touches' });
  const open = input.humanOpenRate;
  if (open && open.sends >= 200 && open.recent < 0.05 && open.previous > 0.2) {
    trips.push({ signal: 'open_rate_collapse', level: 'warn', scope: 'domain' });
  }
  if (input.junkReplies >= 2) trips.push({ signal: 'junk_replies', level: 'warn', scope: 'domain' });
  return trips;
}

/** A provider rate or quota error cuts the mailbox's daily limit by 20% (§7.2). */
export function limitAfterQuotaError(dailyLimit: number): number {
  return Math.max(1, Math.floor((dailyLimit * 80) / 100));
}
