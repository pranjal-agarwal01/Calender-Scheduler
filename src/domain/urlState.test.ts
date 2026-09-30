import { describe, expect, it } from 'vitest';
import { parseCalendarParams } from './urlState';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const parse = (query: string) => parseCalendarParams(new URLSearchParams(query), 'Asia/Kolkata', NOW);

describe('calendar URL state', () => {
  it('reads valid values', () => {
    const { state, isCanonical } = parse('view=month&date=2026-10-05&tz=Europe%2FLondon&attendees=3,1');
    expect(state).toEqual({ view: 'month', date: '2026-10-05', timeZone: 'Europe/London', attendeeIds: [1, 3] });
    expect(isCanonical).toBe(false); // attendees get sorted
  });

  it('falls back safely on bad values', () => {
    const { state, canonical } = parse('view=year&date=2026-02-31&tz=Not%2FAZone&attendees=abc,-4,2,2');
    expect(state).toEqual({ view: 'week', date: '2026-10-07', timeZone: 'Asia/Kolkata', attendeeIds: [2] });
    expect(canonical.toString()).toBe('view=week&date=2026-10-07&tz=Asia%2FKolkata&attendees=2');
  });

  it('fills defaults for an empty query', () => {
    expect(parse('').state).toEqual({ view: 'week', date: '2026-10-07', timeZone: 'Asia/Kolkata', attendeeIds: [] });
  });
});
