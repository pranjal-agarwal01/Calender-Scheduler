import { describe, expect, it } from 'vitest';
import { draftFromValues, shiftEndWithStart, valuesFromDraft, type EventFormValues } from './eventForm';
import { findConflicts } from './conflicts';
import { byId, makeEvent } from '../test/makeEvent';
import type { EventDraft } from './types';

const TZ = 'Asia/Kolkata';

const base: EventFormValues = {
  title: 'Planning',
  description: '',
  allDay: false,
  startDate: '2026-10-05',
  startTime: '09:00',
  endDate: '2026-10-05',
  endTime: '10:00',
  attendeeIds: [],
  reminderMinutes: null,
  color: 'indigo',
  repeat: 'none',
  interval: '1',
  byWeekday: [1],
  monthlyMode: 'dayOfMonth',
  endType: 'never',
  until: '2026-12-31',
  count: '10',
};

describe('event form validation', () => {
  it('builds a UTC draft from local form values', () => {
    const { draft, errors } = draftFromValues(base, TZ);
    expect(errors).toEqual({});
    expect(new Date(draft!.start).toISOString()).toBe('2026-10-05T03:30:00.000Z');
    expect(draft!.end - draft!.start).toBe(3_600_000);
  });

  it('requires a title and an end after the start', () => {
    const { draft, errors } = draftFromValues({ ...base, title: '  ', endTime: '09:00' }, TZ);
    expect(draft).toBeNull();
    expect(errors.title).toBeDefined();
    expect(errors.endTime).toBe('End must be after the start.');
  });

  it('validates recurrence inputs', () => {
    const { errors } = draftFromValues(
      { ...base, repeat: 'weekly', byWeekday: [], interval: '0', endType: 'until', until: '2026-01-01' },
      TZ,
    );
    expect(errors).toMatchObject({ byWeekday: expect.any(String), interval: expect.any(String), until: expect.any(String) });
  });

  it('treats all-day end dates as inclusive', () => {
    const { draft } = draftFromValues({ ...base, allDay: true, endDate: '2026-10-06' }, TZ);
    expect(new Date(draft!.start).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(new Date(draft!.end).toISOString()).toBe('2026-10-07T00:00:00.000Z');
  });

  it('round-trips through valuesFromDraft', () => {
    const { draft } = draftFromValues({ ...base, repeat: 'monthly', monthlyMode: 'nthWeekday', endType: 'count', count: '4' }, TZ);
    const values = valuesFromDraft(draft as EventDraft, TZ);
    expect(values).toMatchObject({ startDate: '2026-10-05', startTime: '09:00', endTime: '10:00', repeat: 'monthly', monthlyMode: 'nthWeekday', count: '4' });
  });

  it('keeps the duration when the start moves', () => {
    const next = shiftEndWithStart(base, { ...base, startTime: '11:30' }, TZ);
    expect(next).toMatchObject({ endDate: '2026-10-05', endTime: '12:30' });
  });
});

describe('conflicts', () => {
  const events = byId(
    makeEvent({ id: 'busy', organizerId: 5, attendeeIds: [7], start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T10:00:00.000Z' }),
    makeEvent({ id: 'other', organizerId: 9, start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T10:00:00.000Z' }),
    makeEvent({ id: 'holiday', organizerId: 7, allDay: true, start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' }),
  );
  const window = { start: Date.parse('2026-10-05T09:30:00Z'), end: Date.parse('2026-10-05T10:30:00Z') };

  it('reports attendees who organise or attend an overlapping event', () => {
    const conflicts = findConflicts(events, { ...window, attendeeIds: [5, 7, 3] }, { eventId: null, seriesId: null });
    expect(conflicts.map((c) => [c.attendeeId, c.occurrence.event.id])).toEqual([
      [5, 'busy'],
      [7, 'busy'],
    ]);
  });

  it('ignores the event being edited', () => {
    expect(findConflicts(events, { ...window, attendeeIds: [5] }, { eventId: 'busy', seriesId: null })).toEqual([]);
  });
});
