// Wall-clock <-> instant conversion for IANA zones.
//
// Everything else in `time/` is written against the small `ZoneCalendar` interface, so the
// business-day and sending-window maths stay independent of the library behind it. The
// implementation here uses the runtime's own Intl data, which needs no packages. The spec's stack
// table names Luxon for this job (§4.2); a Luxon-backed `ZoneCalendar` can replace this one
// without touching its callers.

export interface LocalDateTime {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface ZoneCalendar {
  /** The wall-clock reading in `zone` at `instant`. */
  toLocal(instant: Date, zone: string): LocalDateTime;
  /**
   * The instant at which `zone` shows `local`.
   * - A time skipped by a daylight-saving jump forward is moved forward by the size of the jump
   *   (02:30 becomes 03:30).
   * - A time that occurs twice (clocks going back) resolves to the first occurrence.
   */
  fromLocal(local: LocalDateTime, zone: string): Date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    // Throws RangeError for an unknown zone, which is the behaviour callers want.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

function toLocal(instant: Date, zone: string): LocalDateTime {
  const out: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

function utcMillis(local: LocalDateTime): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
}

/** Offset of `zone` from UTC at `ms`, in milliseconds (positive east of Greenwich). */
function offsetAt(ms: number, zone: string): number {
  const wholeSecond = Math.floor(ms / 1000) * 1000;
  return utcMillis(toLocal(new Date(wholeSecond), zone)) - wholeSecond;
}

function fromLocal(local: LocalDateTime, zone: string): Date {
  const asUtc = utcMillis(local);
  // Offsets a day either side bracket any transition near this wall-clock time.
  const before = asUtc - offsetAt(asUtc - 86_400_000, zone);
  const after = asUtc - offsetAt(asUtc + 86_400_000, zone);
  const isValid = (candidate: number) => offsetAt(candidate, zone) === asUtc - candidate;
  // `before` uses the earlier offset, so in an overlap it is the first occurrence.
  if (isValid(before)) return new Date(before);
  if (isValid(after)) return new Date(after);
  // Neither maps back: the wall-clock time was skipped. Keeping the earlier offset moves it
  // forward by the size of the jump.
  return new Date(before);
}

/** `ZoneCalendar` backed by the runtime's Intl time-zone data. */
export const intlZoneCalendar: ZoneCalendar = { toLocal, fromLocal };

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The calendar date `days` after `date` (negative moves back). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** `YYYY-MM-DD`, the format blackout dates are stored in. */
export function isoDate(date: LocalDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

export function parseIsoDate(value: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Not an ISO date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}
