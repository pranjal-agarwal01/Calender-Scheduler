import { describe, expect, it } from 'vitest';
import { todoToEvent, type Todo } from './seed';
import { dateKeyInZone, minutesInZone } from './time/zoned';

const todos: Todo[] = Array.from({ length: 254 }, (_, i) => ({ id: i + 1, todo: `Todo ${i + 1}`, completed: i % 7 === 0, userId: (i % 30) + 1 }));
const NOW = '2026-09-30T00:00:00.000Z';

describe('seed mapping', () => {
  it('is deterministic: same todo -> same times on every run', () => {
    const a = todos.map((t) => todoToEvent(t, '2026-09-28', 'Asia/Kolkata', NOW));
    const b = todos.map((t) => todoToEvent(t, '2026-09-28', 'Asia/Kolkata', NOW));
    expect(a).toEqual(b);
    expect(a[0].id).toBe('todo-1');
    expect(a[0].remoteId).toBe(1);
  });

  it('places events on weekdays between 08:00 and 18:00 and spreads them within a day', () => {
    const events = todos.map((t) => todoToEvent(t, '2026-09-28', 'UTC', NOW));
    const byDay = new Map<string, number[]>();
    for (const e of events) {
      const start = Date.parse(e.start);
      const day = dateKeyInZone(start, 'UTC');
      expect(new Date(start).getUTCDay()).not.toBe(0);
      expect(new Date(start).getUTCDay()).not.toBe(6);
      const minutes = minutesInZone(start, 'UTC');
      expect(minutes).toBeGreaterThanOrEqual(8 * 60);
      expect(minutes).toBeLessThan(18 * 60);
      byDay.set(day, [...(byDay.get(day) ?? []), Math.floor(minutes / 60)]);
    }
    // Events sharing a day should mostly start in different hours.
    for (const hours of byDay.values()) expect(new Set(hours).size).toBeGreaterThanOrEqual(Math.min(hours.length, 4));
  });
});
