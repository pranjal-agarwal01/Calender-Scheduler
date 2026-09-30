import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, isValidDateKey, parseDateKey, startOfWeek, weekdayOf } from './dateKey';
import { dateKeyInZone, isValidTimeZone, minutesInZone, offsetAt, toWallTime, wallTimeToUtc, zonedToUtc } from './zoned';

describe('dateKey', () => {
  it('validates impossible dates', () => {
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2028-02-29')).toBe(true);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('garbage')).toBe(false);
    expect(parseDateKey('2026-10-05')).toEqual({ year: 2026, month: 10, day: 5 });
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('clamps month arithmetic at month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('computes weekdays and Monday week starts', () => {
    expect(weekdayOf('2026-10-05')).toBe(1); // Monday
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05'); // Sunday -> previous Monday
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05');
  });
});

describe('zoned time', () => {
  const NY = 'America/New_York';

  it('converts wall time to UTC with correct offsets', () => {
    expect(new Date(wallTimeToUtc(2026, 10, 5, 9, 0, 'Asia/Kolkata')).toISOString()).toBe('2026-10-05T03:30:00.000Z');
    expect(new Date(wallTimeToUtc(2026, 7, 1, 9, 0, NY)).toISOString()).toBe('2026-07-01T13:00:00.000Z'); // EDT
    expect(new Date(wallTimeToUtc(2026, 12, 1, 9, 0, NY)).toISOString()).toBe('2026-12-01T14:00:00.000Z'); // EST
  });

  it('pushes non-existent spring-forward times forward', () => {
    // 2026-03-08 02:30 does not exist in New York; clocks jump 02:00 -> 03:00.
    const ms = wallTimeToUtc(2026, 3, 8, 2, 30, NY);
    expect(toWallTime(ms, NY)).toMatchObject({ hour: 3, minute: 30 });
  });

  it('picks the earlier instant for ambiguous fall-back times', () => {
    // 2026-11-01 01:30 happens twice in New York; first is EDT (UTC-4).
    const ms = wallTimeToUtc(2026, 11, 1, 1, 30, NY);
    expect(new Date(ms).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('round-trips wall times', () => {
    const ms = zonedToUtc('2026-10-05', 9 * 60 + 15, 'Europe/London');
    expect(dateKeyInZone(ms, 'Europe/London')).toBe('2026-10-05');
    expect(minutesInZone(ms, 'Europe/London')).toBe(9 * 60 + 15);
    expect(offsetAt(ms, 'Asia/Kolkata')).toBe(330 * 60_000);
  });

  it('normalises minute overflow into the next day', () => {
    const ms = zonedToUtc('2026-10-05', 25 * 60, 'UTC');
    expect(new Date(ms).toISOString()).toBe('2026-10-06T01:00:00.000Z');
  });

  it('validates time zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
