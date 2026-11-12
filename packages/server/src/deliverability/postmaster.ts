// Google Postmaster Tools (spec §8.10), v2 API: `deliverability.postmaster_sync` pulls, for each
// connected domain, the last week's Gmail user-reported spam rate and SPF/DKIM/DMARC success
// rates (`domainStats:query`, daily) and the sender compliance status (`complianceStatus`). The
// rollup counts the latest spam rate with the complaints and a failing compliance status with
// failing authentication. Google shows nothing for low-volume domains: that is "no data", which
// counts as neutral, not as good.

import { activities, newId, sending_domains, type Db } from '@catalyst/db';
import { and, eq } from 'drizzle-orm';

import type { SecretBox } from '../secrets.ts';
import { renewIfDue, type OAuthConfig } from '../sending/oauth.ts';

const BASE = 'https://gmailpostmastertools.googleapis.com/v2';
const DAYS = 7;

/** Calls to the Postmaster Tools API with an access token; injectable, so tests never reach Google. */
export interface PostmasterHttp {
  request(method: 'GET' | 'POST', url: string, accessToken: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
}

export const fetchPostmasterHttp: PostmasterHttp = {
  async request(method, url, accessToken, body) {
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
    return { status: response.status, body: ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  },
};

interface DayStats {
  day: string;
  spam_rate: number | null;
  spf: number | null;
  dkim: number | null;
  dmarc: number | null;
}

export interface PostmasterData {
  synced_at: string;
  /** The latest day's user-reported spam rate, as a fraction; null with no data. */
  spam_rate: number | null;
  auth: { spf: number | null; dkim: number | null; dmarc: number | null };
  days: DayStats[];
  no_data: boolean;
  compliance: { status: 'compliant' | 'needs_work' | null; needs_work: string[]; deliverability: string | null };
  /** Why the last sync didn't work, if it didn't. */
  error: string | null;
}

type GoogleDate = { year: number; month: number; day: number };
const googleDate = (date: Date): GoogleDate => ({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
const isoDay = (date: GoogleDate) => `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
const numberOf = (value: Record<string, unknown> | undefined): number | null => {
  const raw = value?.doubleValue ?? value?.floatValue ?? value?.intValue;
  return raw === undefined || raw === null ? null : Number(raw);
};

const METRICS = [
  { name: 'spam_rate', baseMetric: { standardMetric: 'SPAM_RATE' } },
  { name: 'spf', baseMetric: { standardMetric: 'AUTH_SUCCESS_RATE' }, filter: 'auth_type = "spf"' },
  { name: 'dkim', baseMetric: { standardMetric: 'AUTH_SUCCESS_RATE' }, filter: 'auth_type = "dkim"' },
  { name: 'dmarc', baseMetric: { standardMetric: 'AUTH_SUCCESS_RATE' }, filter: 'auth_type = "dmarc"' },
] as const;

/** One domain's week from Postmaster Tools. */
async function fetchDomain(http: PostmasterHttp, domain: string, accessToken: string, now: Date): Promise<Omit<PostmasterData, 'synced_at'>> {
  const name = `domains/${domain}`;
  // Full days only: yesterday and the six before it, in UTC as Google reports them.
  const end = new Date(now.getTime() - 86_400_000);
  const start = new Date(end.getTime() - (DAYS - 1) * 86_400_000);
  const stats = await http.request('POST', `${BASE}/${name}/domainStats:query`, accessToken, {
    metricDefinitions: METRICS,
    timeQuery: { dateRanges: { dateRanges: [{ start: googleDate(start), end: googleDate(end) }] } },
    aggregationGranularity: 'DAILY',
    pageSize: 200,
  });
  if (stats.status === 403 || stats.status === 404) {
    return { spam_rate: null, auth: { spf: null, dkim: null, dmarc: null }, days: [], no_data: true, compliance: { status: null, needs_work: [], deliverability: null }, error: `The Google account has no access to ${domain} in Postmaster Tools (${stats.status}). Verify the domain there with this account.` };
  }
  if (stats.status !== 200) throw new Error(`Postmaster Tools answered ${stats.status} to domainStats:query.`);

  const byDay = new Map<string, DayStats>();
  for (const stat of (stats.body.domainStats as { metric?: string; name?: string; date?: GoogleDate; value?: Record<string, unknown> }[] | undefined) ?? []) {
    if (!stat.date) continue;
    const day = isoDay(stat.date);
    const entry = byDay.get(day) ?? { day, spam_rate: null, spf: null, dkim: null, dmarc: null };
    const metric = (stat.metric ?? stat.name ?? '') as keyof Omit<DayStats, 'day'>;
    if (metric in entry) entry[metric] = numberOf(stat.value);
    byDay.set(day, entry);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const latest = [...days].reverse().find((entry) => entry.spam_rate !== null) ?? days.at(-1) ?? null;

  const status = await http.request('GET', `${BASE}/${name}/complianceStatus`, accessToken);
  const data = status.status === 200 ? (status.body.complianceData as { rowData?: { requirement: string; status?: { status?: string } }[]; deliverabilityStatusVerdict?: { reason?: string } } | undefined) : undefined;
  const rows = data?.rowData ?? [];
  const needsWork = rows.filter((row) => row.status?.status === 'NEEDS_WORK').map((row) => row.requirement);
  return {
    spam_rate: latest?.spam_rate ?? null,
    auth: { spf: latest?.spf ?? null, dkim: latest?.dkim ?? null, dmarc: latest?.dmarc ?? null },
    days,
    no_data: days.length === 0,
    compliance: { status: rows.length === 0 ? null : needsWork.length > 0 ? 'needs_work' : 'compliant', needs_work: needsWork, deliverability: data?.deliverabilityStatusVerdict?.reason ?? null },
    error: null,
  };
}

/** `deliverability.postmaster_sync`, daily, and right after a domain connects. */
export async function syncPostmaster(db: Db, deps: { secrets: SecretBox; oauth: OAuthConfig | null | undefined; http: PostmasterHttp }, now: Date, domainId?: string): Promise<{ synced: number; noData: number; failed: number }> {
  const result = { synced: 0, noData: 0, failed: 0 };
  const connected = await db.select().from(sending_domains).where(and(eq(sending_domains.postmaster_connected, true), ...(domainId ? [eq(sending_domains.id, domainId)] : [])));
  for (const domain of connected) {
    try {
      if (!domain.postmaster_credentials_enc) throw new Error('No Google token is kept for this domain; connect it again.');
      const token = await renewIfDue('google', domain.postmaster_credentials_enc, deps.secrets, deps.oauth, now);
      if (token.kind === 'refused') {
        if (token.reason === 'invalid_grant') {
          // Google withdrew access: the domain is shown as disconnected, and a person connects it again.
          await db.update(sending_domains).set({ postmaster_connected: false, postmaster_credentials_enc: null, postmaster_data: { ...((domain.postmaster_data as object) ?? {}), error: 'Google no longer accepts Catalyst’s access. Connect Postmaster Tools again.' } }).where(eq(sending_domains.id, domain.id));
          await db.insert(activities).values({ id: newId('activity'), workspace_id: domain.workspace_id, type: 'domain.postmaster_disconnected', actor_type: 'system', data: { domain_id: domain.id, domain: domain.domain, reason: 'invalid_grant' }, occurred_at: now });
        }
        throw new Error(`Refreshing the Google token failed: ${token.reason}`);
      }
      if (token.sealed) await db.update(sending_domains).set({ postmaster_credentials_enc: token.sealed, postmaster_credentials_key_version: deps.secrets.activeVersion }).where(eq(sending_domains.id, domain.id));
      const data: PostmasterData = { synced_at: now.toISOString(), ...(await fetchDomain(deps.http, domain.domain, token.accessToken, now)) };
      await db.update(sending_domains).set({ postmaster_data: data }).where(eq(sending_domains.id, domain.id));
      if (data.no_data) result.noData += 1;
      else result.synced += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[postmaster_sync] ${domain.domain} failed`, error);
    }
  }
  return result;
}

/** §8.10: "Gmail compliance status failing" costs what failing authentication does. */
export const gmailNonCompliant = (data: unknown): boolean => (data as Partial<PostmasterData> | null)?.compliance?.status === 'needs_work';
