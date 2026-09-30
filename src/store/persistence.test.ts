import { describe, expect, it } from 'vitest';
import { loadCalendar, parsePersisted, saveCalendar, SCHEMA_VERSION, storageKey } from './persistence';
import { makeEvent } from '../test/makeEvent';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

describe('persistence', () => {
  it('round-trips a calendar with the schema version', () => {
    const storage = new MemoryStorage();
    const event = makeEvent({ id: 'a' });
    expect(saveCalendar(7, { seedAnchor: '2026-09-28', events: [event] }, storage)).toEqual({ ok: true });
    const outcome = loadCalendar(7, storage);
    expect(outcome.kind).toBe('loaded');
    if (outcome.kind === 'loaded') {
      expect(outcome.data.schemaVersion).toBe(SCHEMA_VERSION);
      expect(outcome.data.events).toEqual([event]);
      expect(outcome.data.seedAnchor).toBe('2026-09-28');
    }
  });

  it('reports empty storage', () => {
    expect(loadCalendar(1, new MemoryStorage())).toEqual({ kind: 'empty' });
  });

  it('backs up and rejects unparseable data', () => {
    const storage = new MemoryStorage();
    storage.setItem(storageKey(3), '{"schemaVersion":2,"events":[');
    const outcome = loadCalendar(3, storage);
    expect(outcome.kind).toBe('corrupt');
    expect(storage.getItem(`${storageKey(3)}.corrupt`)).toBe('{"schemaVersion":2,"events":[');
  });

  it('refuses data written by a newer schema', () => {
    expect(parsePersisted(JSON.stringify({ schemaVersion: 99, events: [] }))).toHaveProperty('error');
  });

  it('drops invalid events but keeps the valid ones', () => {
    const good = makeEvent({ id: 'good' });
    const result = parsePersisted(
      JSON.stringify({
        schemaVersion: 2,
        events: [good, { id: 'no-dates' }, { ...good, id: 'backwards', end: '2020-01-01T00:00:00.000Z' }, good, null],
      }),
    );
    expect('data' in result && result.data.events.map((e) => e.id)).toEqual(['good']);
    expect('dropped' in result && result.dropped).toBe(4); // three invalid + one duplicate id
  });

  it('repairs recoverable fields instead of dropping the event', () => {
    const result = parsePersisted(
      JSON.stringify({
        schemaVersion: 2,
        events: [{ ...makeEvent({ id: 'x' }), color: 'neon', timeZone: 'Nowhere/City', recurrence: { freq: 'hourly' } }],
      }),
    );
    if (!('data' in result)) throw new Error('expected data');
    expect(result.repaired).toBe(1);
    expect(result.data.events[0]).toMatchObject({ color: 'indigo', timeZone: 'UTC', recurrence: null });
  });

  it('migrates v1 payloads (epoch times, `attendees`) to the current schema', () => {
    const v1 = {
      version: 1,
      events: {
        a: { id: 'a', title: 'Old', start: Date.parse('2026-10-05T09:00:00Z'), end: Date.parse('2026-10-05T10:00:00Z'), attendees: [2, 3] },
      },
    };
    const result = parsePersisted(JSON.stringify(v1));
    if (!('data' in result)) throw new Error('expected data');
    expect(result.migratedFrom).toBe(1);
    expect(result.data.events[0]).toMatchObject({
      id: 'a',
      start: '2026-10-05T09:00:00.000Z',
      end: '2026-10-05T10:00:00.000Z',
      attendeeIds: [2, 3],
    });
  });
});
