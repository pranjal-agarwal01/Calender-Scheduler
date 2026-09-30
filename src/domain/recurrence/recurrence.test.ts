import { describe, expect, it } from 'vitest';
import { expandEvent, findSeriesOccurrence, occurrenceKey, resolveOccurrence } from './expand';
import { describeRule } from './describe';
import { byId, iso, makeEvent } from '../../test/makeEvent';
import { dateKeyInZone, minutesInZone } from '../time/zoned';

const range = (from: string, to: string) => [Date.parse(from), Date.parse(to)] as const;
const dates = (occurrences: { start: number }[], zone = 'UTC') => occurrences.map((o) => dateKeyInZone(o.start, zone));

describe('recurrence expansion', () => {
  it('generates daily instances only inside the visible range', () => {
    const event = makeEvent({
      id: 'daily',
      start: '2020-01-01T09:00:00.000Z',
      end: '2020-01-01T09:30:00.000Z',
      recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } },
    });
    const [from, to] = range('2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');
    const result = expandEvent(event, from, to);
    expect(result).toHaveLength(7); // six years of history are skipped, not generated
    expect(dates(result)[0]).toBe('2026-10-05');
  });

  it('respects interval and count, even when fast-forwarding', () => {
    const event = makeEvent({
      id: 'every-3-days',
      start: '2026-10-01T09:00:00.000Z',
      end: '2026-10-01T10:00:00.000Z',
      recurrence: { freq: 'daily', interval: 3, end: { type: 'count', count: 5 } },
    });
    const [from, to] = range('2026-10-06T00:00:00Z', '2026-12-01T00:00:00Z');
    expect(dates(expandEvent(event, from, to))).toEqual(['2026-10-07', '2026-10-10', '2026-10-13']);
  });

  it('supports weekly rules on several weekdays with an until date', () => {
    const event = makeEvent({
      id: 'weekly',
      start: '2026-10-07T09:00:00.000Z', // Wednesday
      end: '2026-10-07T10:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5], end: { type: 'until', until: '2026-10-16' } },
    });
    const [from, to] = range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    // Monday Oct 5 is before the start date, so the first instance is Wed Oct 7.
    expect(dates(expandEvent(event, from, to))).toEqual(['2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16']);
  });

  it('counts first-week occurrences correctly for every-other-week rules', () => {
    const event = makeEvent({
      id: 'biweekly',
      start: '2026-10-07T09:00:00.000Z', // Wednesday
      end: '2026-10-07T10:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 2, byWeekday: [1, 3], end: { type: 'count', count: 4 } },
    });
    const [from, to] = range('2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(dates(expandEvent(event, from, to))).toEqual(['2026-10-07', '2026-10-19', '2026-10-21', '2026-11-02']);
    // Same answer when the range starts later (fast-forward path).
    const [lateFrom] = range('2026-10-20T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(dates(expandEvent(event, lateFrom, to))).toEqual(['2026-10-21', '2026-11-02']);
  });

  it('clamps "monthly on the 31st" without drifting', () => {
    const event = makeEvent({
      id: 'month-end',
      start: '2026-01-31T09:00:00.000Z',
      end: '2026-01-31T10:00:00.000Z',
      recurrence: { freq: 'monthly', interval: 1, monthlyMode: 'dayOfMonth', end: { type: 'count', count: 5 } },
    });
    const [from, to] = range('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z');
    expect(dates(expandEvent(event, from, to))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('supports "every 2nd Tuesday" and "last Friday"', () => {
    const second = makeEvent({
      id: 'second-tuesday',
      start: '2026-10-13T09:00:00.000Z', // 2nd Tuesday of Oct 2026
      end: '2026-10-13T10:00:00.000Z',
      recurrence: { freq: 'monthly', interval: 1, monthlyMode: 'nthWeekday', end: { type: 'count', count: 3 } },
    });
    const last = makeEvent({
      id: 'last-friday',
      start: '2026-10-30T09:00:00.000Z',
      end: '2026-10-30T10:00:00.000Z',
      recurrence: { freq: 'monthly', interval: 1, monthlyMode: 'lastWeekday', end: { type: 'count', count: 3 } },
    });
    const [from, to] = range('2026-10-01T00:00:00Z', '2027-02-01T00:00:00Z');
    expect(dates(expandEvent(second, from, to))).toEqual(['2026-10-13', '2026-11-10', '2026-12-08']);
    expect(dates(expandEvent(last, from, to))).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
  });

  it('skips months without a 5th weekday', () => {
    const event = makeEvent({
      id: 'fifth-thursday',
      start: '2026-10-29T09:00:00.000Z', // 5th Thursday of Oct 2026
      end: '2026-10-29T10:00:00.000Z',
      recurrence: { freq: 'monthly', interval: 1, monthlyMode: 'nthWeekday', end: { type: 'count', count: 3 } },
    });
    const [from, to] = range('2026-10-01T00:00:00Z', '2027-12-01T00:00:00Z');
    expect(dates(expandEvent(event, from, to))).toEqual(['2026-10-29', '2026-12-31', '2027-04-29']);
  });

  it('keeps the wall-clock time across DST changes', () => {
    const zone = 'America/New_York';
    const event = makeEvent({
      id: 'dst',
      timeZone: zone,
      start: '2026-10-29T13:00:00.000Z', // 09:00 EDT
      end: '2026-10-29T14:00:00.000Z',
      recurrence: { freq: 'daily', interval: 1, end: { type: 'count', count: 6 } },
    });
    const [from, to] = range('2026-10-28T00:00:00Z', '2026-11-10T00:00:00Z');
    const result = expandEvent(event, from, to);
    expect(result.map((o) => minutesInZone(o.start, zone))).toEqual(Array(6).fill(9 * 60));
    // Before the switch 09:00 = 13:00Z; after it 09:00 = 14:00Z.
    expect(iso(result[0].start)).toBe('2026-10-29T13:00:00.000Z');
    expect(iso(result[5].start)).toBe('2026-11-03T14:00:00.000Z');
  });

  it('removes exdates but keeps them in the count', () => {
    const start = Date.parse('2026-10-05T09:00:00.000Z');
    const event = makeEvent({
      id: 'with-exdate',
      start: iso(start),
      end: '2026-10-05T10:00:00.000Z',
      exdates: [iso(start + 86_400_000)],
      recurrence: { freq: 'daily', interval: 1, end: { type: 'count', count: 3 } },
    });
    const [from, to] = range('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z');
    expect(dates(expandEvent(event, from, to))).toEqual(['2026-10-05', '2026-10-07']);
  });

  it('resolves occurrence ids from URLs and rejects bad ones', () => {
    const master = makeEvent({
      id: 'series',
      recurrence: { freq: 'daily', interval: 1, end: { type: 'count', count: 3 } },
    });
    const events = byId(master);
    const second = Date.parse('2026-10-06T09:00:00.000Z');
    expect(resolveOccurrence(events, occurrenceKey('series', second))?.start).toBe(second);
    expect(resolveOccurrence(events, occurrenceKey('series', second + 60_000))).toBeNull(); // not on the rule
    expect(resolveOccurrence(events, occurrenceKey('series', Date.parse('2026-10-09T09:00:00.000Z')))).toBeNull(); // past count
    expect(resolveOccurrence(events, 'nope')).toBeNull();
    expect(resolveOccurrence(events, 'series')?.start).toBe(Date.parse(master.start));
    expect(findSeriesOccurrence(master, second)).toEqual({ index: 1 });
  });

  it('describes rules in plain language', () => {
    expect(
      describeRule({ freq: 'weekly', interval: 2, byWeekday: [4, 2], end: { type: 'count', count: 10 } }, '2026-10-06'),
    ).toBe('Every 2 weeks on Tue, Thu, 10 times');
    expect(describeRule({ freq: 'monthly', interval: 1, monthlyMode: 'nthWeekday', end: { type: 'never' } }, '2026-10-13')).toBe(
      'Monthly on the second Tuesday',
    );
  });
});
