import { describe, expect, it } from 'vitest';
import { planDelete, planEdit, draftFromOccurrence, type PlanContext } from './edit';
import { expandAll, expandEvent } from './expand';
import type { EventChange } from '../changes';
import type { EventsById } from '../types';
import { byId, iso, makeEvent } from '../../test/makeEvent';
import { dateKeyInZone, minutesInZone } from '../time/zoned';

const HOUR = 3_600_000;
const DAY = 86_400_000;

let counter = 0;
const ctx: PlanContext = { now: '2026-10-01T00:00:00.000Z', newId: () => `new-${++counter}`, organizerId: 7 };

function apply(events: EventsById, changes: EventChange[]): EventsById {
  const next = { ...events };
  for (const change of changes) {
    if (change.after) next[change.id] = change.after;
    else delete next[change.id];
  }
  return next;
}

const october = [Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-11-01T00:00:00Z')] as const;

function visible(events: EventsById) {
  return expandAll(events, ...october).map((o) => ({
    date: dateKeyInZone(o.start, 'UTC'),
    minutes: minutesInZone(o.start, 'UTC'),
    title: o.event.title,
  }));
}

const series = () =>
  makeEvent({
    id: 'standup',
    title: 'Standup',
    start: '2026-10-05T09:00:00.000Z',
    end: '2026-10-05T09:30:00.000Z',
    recurrence: { freq: 'daily', interval: 1, end: { type: 'count', count: 5 } },
  });

describe('recurring edits', () => {
  it('"this event" creates an override and hides the original instance', () => {
    const events = byId(series());
    const [, second] = expandEvent(events.standup, ...october);
    const draft = { ...draftFromOccurrence(second, events), start: second.start + HOUR, end: second.end + HOUR };
    const next = apply(events, planEdit(events, second, draft, 'this', ctx));

    expect(visible(next).map((o) => o.minutes)).toEqual([540, 600, 540, 540, 540]);
    const override = Object.values(next).find((e) => e.recurringEventId === 'standup');
    expect(override?.originalStart).toBe(iso(second.originalStart));
    expect(next.standup.exdates).toEqual([iso(second.originalStart)]);
  });

  it('"this and following" splits the series and keeps the total count', () => {
    const events = byId(series());
    const third = expandEvent(events.standup, ...october)[2];
    const draft = { ...draftFromOccurrence(third, events), title: 'Sync', start: third.start + HOUR, end: third.end + HOUR };
    const next = apply(events, planEdit(events, third, draft, 'following', ctx));

    expect(visible(next)).toEqual([
      { date: '2026-10-05', minutes: 540, title: 'Standup' },
      { date: '2026-10-06', minutes: 540, title: 'Standup' },
      { date: '2026-10-07', minutes: 600, title: 'Sync' },
      { date: '2026-10-08', minutes: 600, title: 'Sync' },
      { date: '2026-10-09', minutes: 600, title: 'Sync' },
    ]);
    expect(next.standup.recurrence?.end).toEqual({ type: 'count', count: 2 });
  });

  it('"all events" moves the whole series by the dragged delta', () => {
    const events = byId(series());
    const second = expandEvent(events.standup, ...october)[1];
    const draft = { ...draftFromOccurrence(second, events), start: second.start + 2 * HOUR, end: second.end + 2 * HOUR };
    const next = apply(events, planEdit(events, second, draft, 'all', ctx));

    expect(visible(next).map((o) => o.minutes)).toEqual([660, 660, 660, 660, 660]);
    expect(visible(next)[0].date).toBe('2026-10-05');
  });

  it('"all events" keeps exdates attached to their (moved) instances', () => {
    const base = series();
    const events = byId({ ...base, exdates: [iso(Date.parse(base.start) + DAY)] });
    const first = expandEvent(events.standup, ...october)[0];
    const draft = { ...draftFromOccurrence(first, events), start: first.start + DAY, end: first.end + DAY };
    const next = apply(events, planEdit(events, first, draft, 'all', ctx));
    // Series moved one day later; the excluded instance moved with it.
    expect(visible(next).map((o) => o.date)).toEqual(['2026-10-06', '2026-10-08', '2026-10-09', '2026-10-10']);
  });

  it('title-only "all" edits keep the series time', () => {
    const events = byId(series());
    const third = expandEvent(events.standup, ...october)[2];
    const draft = { ...draftFromOccurrence(third, events), title: 'Daily' };
    const next = apply(events, planEdit(events, third, draft, 'all', ctx));
    expect(visible(next).every((o) => o.title === 'Daily' && o.minutes === 540)).toBe(true);
  });

  it('deletes one, following, or all instances', () => {
    const events = byId(series());
    const occurrences = expandEvent(events.standup, ...october);

    const afterThis = apply(events, planDelete(events, occurrences[1], 'this', ctx));
    expect(visible(afterThis)).toHaveLength(4);

    const afterFollowing = apply(events, planDelete(events, occurrences[3], 'following', ctx));
    expect(visible(afterFollowing).map((o) => o.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);

    const afterAll = apply(events, planDelete(events, occurrences[3], 'all', ctx));
    expect(afterAll).toEqual({});
  });

  it('"following" on the first occurrence behaves like "all"', () => {
    const events = byId(series());
    const first = expandEvent(events.standup, ...october)[0];
    const changes = planDelete(events, first, 'following', ctx);
    expect(changes).toEqual([{ id: 'standup', before: events.standup, after: null }]);
  });
});
