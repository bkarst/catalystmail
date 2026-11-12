// Business-day and sending-window maths (§5.10 waits, §8.4 windows). Pure: every function takes
// the zone, the blackout dates and the calendar as arguments.

import { HOUR_MS, type Rng, type Wait } from '../types.ts';
import {
  addDays,
  isoDate,
  isoWeekday,
  parseIsoDate,
  type LocalDate,
  type LocalDateTime,
  type ZoneCalendar,
} from './zone.ts';

export interface ZoneContext {
  /** IANA zone the wait or window is measured in: the contact's, or the campaign fallback. */
  zone: string;
  /** `YYYY-MM-DD` dates on which nothing is sent and which don't count as business days. */
  blackoutDates?: Iterable<string>;
  calendar: ZoneCalendar;
}

export interface SendingWindow {
  /** ISO weekdays that are open: 1 = Monday … 7 = Sunday. */
  days: readonly number[];
  /** `HH:MM`, inclusive. */
  start: string;
  /** `HH:MM`, exclusive. */
  end: string;
}

/** Mon–Fri 08:30–17:30 (§8.4). */
export const DEFAULT_SENDING_WINDOW: SendingWindow = { days: [1, 2, 3, 4, 5], start: '08:30', end: '17:30' };

const BUSINESS_DAYS: readonly number[] = [1, 2, 3, 4, 5];

function blackoutSet(ctx: ZoneContext): ReadonlySet<string> {
  return ctx.blackoutDates instanceof Set ? ctx.blackoutDates : new Set(ctx.blackoutDates ?? []);
}

function isBusinessDay(date: LocalDate, blackout: ReadonlySet<string>): boolean {
  return BUSINESS_DAYS.includes(isoWeekday(date)) && !blackout.has(isoDate(date));
}

/** The date `count` business days after `date`. Weekends and blackout dates are not counted. */
export function addBusinessDays(date: LocalDate, count: number, blackoutDates: Iterable<string> = []): LocalDate {
  const blackout = blackoutDates instanceof Set ? (blackoutDates as ReadonlySet<string>) : new Set(blackoutDates);
  let current = date;
  let remaining = count;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current, blackout)) remaining -= 1;
  }
  return current;
}

/**
 * `anchor` plus a follow-up wait (§5.10).
 * - hours: elapsed time.
 * - days: calendar days in the zone, keeping the wall-clock time across daylight-saving changes.
 * - business_days: as days, counting only Mon–Fri that aren't blackout dates.
 */
export function addWait(anchor: Date, wait: Wait, ctx: ZoneContext): Date {
  if (!Number.isInteger(wait.amount) || wait.amount < 0) {
    throw new RangeError(`Wait amount must be a non-negative integer, got ${wait.amount}`);
  }
  if (wait.unit === 'hours') return new Date(anchor.getTime() + wait.amount * HOUR_MS);

  const local = ctx.calendar.toLocal(anchor, ctx.zone);
  const date =
    wait.unit === 'days' ? addDays(local, wait.amount) : addBusinessDays(local, wait.amount, blackoutSet(ctx));
  const shifted = ctx.calendar.fromLocal({ ...local, ...date }, ctx.zone);
  // Keep the anchor's sub-second part so repeated evaluation gives the identical instant.
  return new Date(shifted.getTime() + (anchor.getTime() % 1000));
}

/** A wait's length for validation: every follow-up wait must be at least 24 hours (§8.3.4). */
export function isWaitAtLeast24Hours(wait: Wait): boolean {
  return wait.unit === 'hours' ? wait.amount >= 24 : wait.amount >= 1;
}

function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Not an HH:MM time: ${value}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function minutesOfDay(time: { hour: number; minute: number }): number {
  return time.hour * 60 + time.minute;
}

function isOpenDay(date: LocalDate, window: SendingWindow, blackout: ReadonlySet<string>): boolean {
  return window.days.includes(isoWeekday(date)) && !blackout.has(isoDate(date));
}

export function isInsideWindow(instant: Date, window: SendingWindow, ctx: ZoneContext): boolean {
  const local = ctx.calendar.toLocal(instant, ctx.zone);
  if (!isOpenDay(local, window, blackoutSet(ctx))) return false;
  const now = minutesOfDay(local);
  return now >= minutesOfDay(parseClock(window.start)) && now < minutesOfDay(parseClock(window.end));
}

/**
 * The first moment at or after `instant` that falls inside the sending window. Returns `instant`
 * itself when it is already inside, otherwise the next window opening.
 */
export function fitIntoWindow(instant: Date, window: SendingWindow, ctx: ZoneContext): Date {
  if (window.days.length === 0) throw new RangeError('Sending window has no open days');
  if (isInsideWindow(instant, window, ctx)) return instant;

  const blackout = blackoutSet(ctx);
  const local = ctx.calendar.toLocal(instant, ctx.zone);
  const start = parseClock(window.start);
  // Today still counts if the window hasn't opened yet.
  let date: LocalDate = minutesOfDay(local) < minutesOfDay(start) ? local : addDays(local, 1);
  for (let scanned = 0; scanned < 3660; scanned += 1) {
    if (isOpenDay(date, window, blackout)) {
      const opening: LocalDateTime = { ...date, hour: start.hour, minute: start.minute, second: 0 };
      const candidate = ctx.calendar.fromLocal(opening, ctx.zone);
      if (candidate.getTime() < instant.getTime()) {
        // The clocks went back and the first occurrence of the opening time has already passed.
        const repeated = firstOpenMinuteAfter(instant, window, ctx);
        if (repeated) return repeated;
      } else if (isInsideWindow(candidate, window, ctx)) {
        return candidate;
      }
      // Otherwise a jump forward swallowed this day's whole window; try the next day.
    }
    date = addDays(date, 1);
  }
  throw new RangeError('No open sending day within ten years; check the blackout dates');
}

/** The first whole minute after `instant`, within three hours, that is inside the window. */
function firstOpenMinuteAfter(instant: Date, window: SendingWindow, ctx: ZoneContext): Date | null {
  const firstMinute = Math.floor(instant.getTime() / 60_000) * 60_000 + 60_000;
  for (let step = 0; step < 180; step += 1) {
    const candidate = new Date(firstMinute + step * 60_000);
    if (isInsideWindow(candidate, window, ctx)) return candidate;
  }
  return null;
}

/**
 * The opening of the first sending day strictly after `date` plus `businessDays`. Used for an
 * out-of-office reply: the next action moves to the return date plus one business day (§5.5).
 */
export function windowOpeningAfterDate(
  isoReturnDate: string,
  businessDays: number,
  window: SendingWindow,
  ctx: ZoneContext,
): Date {
  const target = addBusinessDays(parseIsoDate(isoReturnDate), businessDays, blackoutSet(ctx));
  const start = parseClock(window.start);
  const opening = ctx.calendar.fromLocal({ ...target, hour: start.hour, minute: start.minute, second: 0 }, ctx.zone);
  return fitIntoWindow(opening, window, ctx);
}

/** A whole number of milliseconds in [min, max], drawn from the injected RNG. */
export function randomBetween(rng: Rng, minMs: number, maxMs: number): number {
  if (maxMs < minMs) throw new RangeError('maxMs must be at least minMs');
  return minMs + Math.floor(rng() * (maxMs - minMs + 1));
}
