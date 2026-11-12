// Classifying open-pixel fetches and link clicks (spec §9.2): a person, a privacy proxy, a security
// scanner, or the sender looking at their own email. Opens are a signal, never exact. The rules
// are versioned data, updated with releases; each event records the version that classified it.

import { isbot } from 'isbot';

export const OPEN_RULES_VERSION = '2026-11.1';

export type OpenSource = 'human' | 'privacy_proxy' | 'security_scanner' | 'sender_self' | 'unknown';

export interface FetchSignals {
  userAgent: string | null;
  /** The client's IP address, used for range checks only; it is stored hashed. */
  ip: string | null;
  method: 'GET' | 'HEAD';
  /** Seconds between the email being sent and this fetch. */
  secondsSinceSent: number | null;
  /** For clicks: other links of the same email fetched within the same few seconds. */
  burstOfLinks?: boolean;
}

export interface OpenClassification {
  source: OpenSource;
  /** Which rule decided, for the event log. */
  rule: string;
  rulesVersion: string;
}

/** Mail providers' image proxies that fetch when a person opens the email (Gmail, Yahoo). */
const HUMAN_PROXIES = [/GoogleImageProxy/i, /YahooMailProxy/i, /Yahoo!? ?Mail/i];
/** Security gateways and link scanners that fetch on delivery, before anyone reads it. */
const SCANNERS = [/Mimecast/i, /Proofpoint/i, /Barracuda/i, /SafeLinks|Safe Links/i, /BingPreview/i, /Forcepoint/i, /Trend ?Micro/i, /Cisco/i, /Symantec|Messagelabs/i, /urlscan/i, /python-requests|curl\/|wget\//i];
/** Desktop and mobile mail clients that load images when a person opens an email. */
const MAIL_CLIENTS = [/Thunderbird/i, /Microsoft Outlook|ms-office|Outlook-Express/i, /AppleWebKit.*Mobile/i, /iPhone|iPad/i, /Android/i, /Macintosh.*AppleWebKit/i, /Windows NT/i];

/** Apple's Private Relay / Mail Privacy Protection egress lives in 17.0.0.0/8 (Apple's own block). */
const isAppleRange = (ip: string | null) => ip !== null && /^17\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);

export function classifyFetch(signals: FetchSignals): OpenClassification {
  const result = (source: OpenSource, rule: string): OpenClassification => ({ source, rule, rulesVersion: OPEN_RULES_VERSION });
  const userAgent = signals.userAgent?.trim() ?? '';
  const seconds = signals.secondsSinceSent;

  // Within a minute of sending it is the sender's own provider or webmail, not the recipient.
  if (seconds !== null && seconds >= 0 && seconds < 60 && !isAppleRange(signals.ip)) {
    if (HUMAN_PROXIES.some((pattern) => pattern.test(userAgent))) return result('sender_self', 'proxy_within_60s_of_send');
  }
  if (signals.method === 'HEAD') return result('security_scanner', 'head_request');
  if (SCANNERS.some((pattern) => pattern.test(userAgent))) return result('security_scanner', 'scanner_user_agent');
  if (signals.burstOfLinks) return result('security_scanner', 'every_link_at_once');
  if (seconds !== null && seconds >= 0 && seconds < 10) return result('security_scanner', 'fetched_within_10s_of_send');

  if (HUMAN_PROXIES.some((pattern) => pattern.test(userAgent))) return result('human', 'provider_image_proxy');
  // Apple Mail Privacy Protection fetches every image on delivery with a bare user agent.
  if (isAppleRange(signals.ip) || userAgent === 'Mozilla/5.0' || userAgent === '') return result('privacy_proxy', isAppleRange(signals.ip) ? 'apple_proxy_range' : 'generic_user_agent');
  if (isbot(userAgent)) return result('security_scanner', 'bot_user_agent');
  if (MAIL_CLIENTS.some((pattern) => pattern.test(userAgent))) return result('human', 'mail_client');
  return result('unknown', 'no_rule_matched');
}

/** The 43-byte transparent GIF the pixel answers with. */
export const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
