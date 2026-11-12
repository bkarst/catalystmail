import assert from 'node:assert/strict';
import fc from 'fast-check';
import { describe, it } from 'vitest';

import {
  addBusinessDays,
  addWait,
  DEFAULT_SENDING_WINDOW,
  fitIntoWindow,
  isInsideWindow,
  isWaitAtLeast24Hours,
  randomBetween,
  windowOpeningAfterDate,
} from './schedule.ts';
import { intlZoneCalendar as calendar, isoWeekday } from './zone.ts';

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const BERLIN = 'Europe/Berlin';
const SYDNEY = 'Australia/Sydney';

const at = (year: number, month: number, day: number, hour = 0, minute = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
  second: 0,
});
const iso = (date: Date) => date.toISOString();

describe('zone calendar', () => {
  it('converts an instant to wall-clock time', () => {
    assert.deepEqual(calendar.toLocal(new Date('2026-07-01T16:30:00Z'), NY), at(2026, 7, 1, 12, 30));
    assert.deepEqual(calendar.toLocal(new Date('2026-01-01T03:00:00Z'), LA), at(2025, 12, 31, 19, 0));
  });

  it('round-trips ordinary times in several zones', () => {
    for (const zone of [NY, LA, BERLIN, SYDNEY, 'Asia/Kolkata', 'UTC']) {
      for (const instant of ['2026-01-15T10:20:00Z', '2026-06-30T23:59:00Z', '2026-11-10T17:52:00Z']) {
        const local = calendar.toLocal(new Date(instant), zone);
        assert.equal(iso(calendar.fromLocal(local, zone)), iso(new Date(instant)), `${zone} ${instant}`);
      }
    }
  });

  it('moves a skipped wall-clock time forward by the size of the jump', () => {
    // New York springs forward 02:00 -> 03:00 on 8 March 2026.
    assert.equal(iso(calendar.fromLocal(at(2026, 3, 8, 2, 30), NY)), '2026-03-08T07:30:00.000Z');
    // Berlin on 29 March 2026.
    assert.equal(iso(calendar.fromLocal(at(2026, 3, 29, 2, 30), BERLIN)), '2026-03-29T01:30:00.000Z');
    // Sydney on 4 October 2026.
    assert.equal(iso(calendar.fromLocal(at(2026, 10, 4, 2, 30), SYDNEY)), '2026-10-03T16:30:00.000Z');
  });

  it('resolves a repeated wall-clock time to its first occurrence', () => {
    // New York falls back 02:00 -> 01:00 on 1 November 2026; the first 01:30 is still EDT.
    assert.equal(iso(calendar.fromLocal(at(2026, 11, 1, 1, 30), NY)), '2026-11-01T05:30:00.000Z');
    // Berlin on 25 October 2026; the first 02:30 is still CEST.
    assert.equal(iso(calendar.fromLocal(at(2026, 10, 25, 2, 30), BERLIN)), '2026-10-25T00:30:00.000Z');
    // Sydney on 5 April 2026; the first 02:30 is still AEDT.
    assert.equal(iso(calendar.fromLocal(at(2026, 4, 5, 2, 30), SYDNEY)), '2026-04-04T15:30:00.000Z');
  });

  it('rejects an unknown zone', () => {
    assert.throws(() => calendar.toLocal(new Date(), 'Mars/Olympus_Mons'), RangeError);
  });

  it('numbers weekdays Monday 1 to Sunday 7', () => {
    assert.equal(isoWeekday({ year: 2026, month: 11, day: 9 }), 1);
    assert.equal(isoWeekday({ year: 2026, month: 11, day: 15 }), 7);
  });
});

describe('addWait', () => {
  const ctx = { zone: LA, calendar };

  it('reproduces the follow-up dates in the spec example (§22.E)', () => {
    // Initial email Wed 28 Oct 09:14 PDT; +3 business days is Mon 2 Nov, same wall-clock time (now PST).
    const initial = new Date('2026-10-28T16:14:00Z');
    const followUp1 = addWait(initial, { amount: 3, unit: 'business_days' }, ctx);
    assert.deepEqual(calendar.toLocal(followUp1, LA), at(2026, 11, 2, 9, 14));
    // +4 business days from Mon 2 Nov is Fri 6 Nov; +7 from there is Tue 17 Nov.
    const followUp2 = addWait(followUp1, { amount: 4, unit: 'business_days' }, ctx);
    assert.deepEqual(calendar.toLocal(followUp2, LA), at(2026, 11, 6, 9, 14));
    const followUp3 = addWait(followUp2, { amount: 7, unit: 'business_days' }, ctx);
    assert.deepEqual(calendar.toLocal(followUp3, LA), at(2026, 11, 17, 9, 14));
  });

  it('counts the first business day after a weekend anchor', () => {
    const saturday = calendar.fromLocal(at(2026, 11, 14, 10, 0), LA);
    assert.deepEqual(
      calendar.toLocal(addWait(saturday, { amount: 1, unit: 'business_days' }, ctx), LA),
      at(2026, 11, 16, 10, 0),
    );
  });

  it('skips blackout dates', () => {
    const wednesday = calendar.fromLocal(at(2026, 11, 25, 9, 0), LA);
    const due = addWait(wednesday, { amount: 1, unit: 'business_days' }, { ...ctx, blackoutDates: ['2026-11-26', '2026-11-27'] });
    assert.deepEqual(calendar.toLocal(due, LA), at(2026, 11, 30, 9, 0));
  });

  it('keeps wall-clock time for day waits across a daylight-saving change, but not for hour waits', () => {
    const beforeChange = calendar.fromLocal(at(2026, 10, 31, 9, 0), NY);
    const oneDay = addWait(beforeChange, { amount: 1, unit: 'days' }, { zone: NY, calendar });
    assert.deepEqual(calendar.toLocal(oneDay, NY), at(2026, 11, 1, 9, 0));
    assert.equal(oneDay.getTime() - beforeChange.getTime(), 25 * 3_600_000);

    const twentyFourHours = addWait(beforeChange, { amount: 24, unit: 'hours' }, { zone: NY, calendar });
    assert.deepEqual(calendar.toLocal(twentyFourHours, NY), at(2026, 11, 1, 8, 0));
  });

  it('is exact to the millisecond and rejects bad amounts', () => {
    const anchor = new Date('2026-11-10T17:52:13.456Z');
    assert.equal(iso(addWait(anchor, { amount: 2, unit: 'days' }, ctx)), '2026-11-12T17:52:13.456Z');
    assert.throws(() => addWait(anchor, { amount: -1, unit: 'days' }, ctx), RangeError);
    assert.throws(() => addWait(anchor, { amount: 1.5, unit: 'hours' }, ctx), RangeError);
  });

  it('adds business days to a plain date', () => {
    assert.deepEqual(addBusinessDays({ year: 2026, month: 11, day: 13 }, 1), { year: 2026, month: 11, day: 16 });
    assert.deepEqual(addBusinessDays({ year: 2026, month: 11, day: 13 }, 0), { year: 2026, month: 11, day: 13 });
  });

  it('knows which waits are at least 24 hours', () => {
    assert.equal(isWaitAtLeast24Hours({ amount: 24, unit: 'hours' }), true);
    assert.equal(isWaitAtLeast24Hours({ amount: 23, unit: 'hours' }), false);
    assert.equal(isWaitAtLeast24Hours({ amount: 1, unit: 'days' }), true);
    assert.equal(isWaitAtLeast24Hours({ amount: 1, unit: 'business_days' }), true);
    assert.equal(isWaitAtLeast24Hours({ amount: 0, unit: 'business_days' }), false);
  });
});

describe('sending window', () => {
  const ctx = { zone: NY, calendar };
  const window = DEFAULT_SENDING_WINDOW;
  const local = (instant: Date) => calendar.toLocal(instant, NY);

  it('leaves a time inside the window alone', () => {
    const tuesdayMorning = calendar.fromLocal(at(2026, 11, 10, 10, 15), NY);
    assert.equal(isInsideWindow(tuesdayMorning, window, ctx), true);
    assert.equal(fitIntoWindow(tuesdayMorning, window, ctx), tuesdayMorning);
  });

  it('treats the start as open and the end as closed', () => {
    assert.equal(isInsideWindow(calendar.fromLocal(at(2026, 11, 10, 8, 30), NY), window, ctx), true);
    assert.equal(isInsideWindow(calendar.fromLocal(at(2026, 11, 10, 8, 29), NY), window, ctx), false);
    assert.equal(isInsideWindow(calendar.fromLocal(at(2026, 11, 10, 17, 30), NY), window, ctx), false);
  });

  it('moves an early time to the same day and a late time to the next open day', () => {
    assert.deepEqual(local(fitIntoWindow(calendar.fromLocal(at(2026, 11, 10, 6, 0), NY), window, ctx)), at(2026, 11, 10, 8, 30));
    assert.deepEqual(local(fitIntoWindow(calendar.fromLocal(at(2026, 11, 10, 18, 0), NY), window, ctx)), at(2026, 11, 11, 8, 30));
  });

  it('skips weekends and blackout dates', () => {
    const fridayEvening = calendar.fromLocal(at(2026, 11, 13, 19, 0), NY);
    assert.deepEqual(local(fitIntoWindow(fridayEvening, window, ctx)), at(2026, 11, 16, 8, 30));
    const withBlackout = { ...ctx, blackoutDates: new Set(['2026-11-16']) };
    assert.deepEqual(local(fitIntoWindow(fridayEvening, window, withBlackout)), at(2026, 11, 17, 8, 30));
    assert.equal(isInsideWindow(calendar.fromLocal(at(2026, 11, 16, 10, 0), NY), window, withBlackout), false);
  });

  it('uses the contact zone, so the same instant can be open in one zone and closed in another', () => {
    const instant = new Date('2026-11-10T14:00:00Z'); // 09:00 New York, 06:00 Los Angeles
    assert.equal(isInsideWindow(instant, window, { zone: NY, calendar }), true);
    assert.equal(isInsideWindow(instant, window, { zone: LA, calendar }), false);
  });

  it('opens at the right instant on the day the clocks change', () => {
    // Sunday-only window on the US spring-forward day: 08:30 EDT is 12:30 UTC, not 13:30.
    const sundayOnly = { days: [7], start: '08:30', end: '17:30' };
    const saturday = calendar.fromLocal(at(2026, 3, 7, 12, 0), NY);
    assert.equal(iso(fitIntoWindow(saturday, sundayOnly, ctx)), '2026-03-08T12:30:00.000Z');
  });

  it('puts an out-of-office follow-up at the opening one business day after the return date', () => {
    assert.deepEqual(local(windowOpeningAfterDate('2026-11-13', 1, window, ctx)), at(2026, 11, 16, 8, 30));
    assert.deepEqual(local(windowOpeningAfterDate('2026-11-11', 1, window, ctx)), at(2026, 11, 12, 8, 30));
  });

  it('rejects a window with no open days', () => {
    assert.throws(() => fitIntoWindow(new Date(), { days: [], start: '08:30', end: '17:30' }, ctx), RangeError);
  });
});

describe('randomBetween', () => {
  it('stays inside its bounds at both ends of the RNG range', () => {
    assert.equal(randomBetween(() => 0, 120_000, 420_000), 120_000);
    assert.equal(randomBetween(() => 0.999999999, 120_000, 420_000), 420_000);
  });
});

describe('scheduling properties (§19.3 property 6)', () => {
  const zone = fc.constantFrom(NY, LA, BERLIN, SYDNEY, 'Asia/Kolkata', 'UTC', 'Australia/Lord_Howe');
  const instant = fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 11, 31) }).map((value) => new Date(value));
  const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const window = fc
    .record({
      days: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
      start: fc.integer({ min: 0, max: 22 * 60 }),
      length: fc.integer({ min: 15, max: 12 * 60 }),
    })
    .map(({ days, start, length }) => ({ days, start: clock(start), end: clock(Math.min(start + length, 23 * 60 + 59)) }));

  it('fits any instant into any window: never earlier than asked, always inside', () => {
    fc.assert(
      fc.property(instant, zone, window, (at, zoneName, sendingWindow) => {
        const ctx = { zone: zoneName, calendar };
        const fitted = fitIntoWindow(at, sendingWindow, ctx);
        assert.ok(fitted.getTime() >= at.getTime(), `${fitted.toISOString()} is before ${at.toISOString()}`);
        assert.ok(isInsideWindow(fitted, sendingWindow, ctx), `${fitted.toISOString()} is outside the window`);
        if (isInsideWindow(at, sendingWindow, ctx)) assert.equal(fitted.getTime(), at.getTime());
      }),
      { numRuns: 1000 },
    );
  });

  it('lands business-day waits on a business day, later than the anchor', () => {
    fc.assert(
      fc.property(instant, zone, fc.integer({ min: 1, max: 15 }), (anchor, zoneName, amount) => {
        const due = addWait(anchor, { amount, unit: 'business_days' }, { zone: zoneName, calendar });
        assert.ok(due.getTime() > anchor.getTime());
        assert.ok(isoWeekday(calendar.toLocal(due, zoneName)) <= 5);
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips wall-clock time through any zone', () => {
    fc.assert(
      fc.property(instant, zone, (at, zoneName) => {
        const wholeSecond = new Date(Math.floor(at.getTime() / 1000) * 1000);
        const back = calendar.fromLocal(calendar.toLocal(wholeSecond, zoneName), zoneName);
        // In the repeated hour after clocks go back, the first occurrence is returned.
        assert.ok(back.getTime() === wholeSecond.getTime() || wholeSecond.getTime() - back.getTime() <= 3_600_000);
        assert.deepEqual(calendar.toLocal(back, zoneName), calendar.toLocal(wholeSecond, zoneName));
      }),
      { numRuns: 1000 },
    );
  });
});
