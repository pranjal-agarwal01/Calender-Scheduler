import { useEffect } from 'react';
import { useCalendarStore } from '../store/calendarStore';
import { toast } from '../store/toastStore';
import { announce } from '../store/announcerStore';
import { expandEvent } from '../domain/recurrence/expand';
import { formatTime } from '../domain/time/format';

const FIRED_KEY = 'cal.reminders.fired';
const CHECK_EVERY_MS = 30_000;
const GRACE_MS = 2 * 60_000;

/**
 * In-app reminders for events the current user organises or attends.
 * Checks every 30s; each (occurrence, reminder time) fires once per browser session.
 */
export function useReminders(userId: number, timeZone: string) {
  useEffect(() => {
    let fired: Set<string>;
    try {
      fired = new Set(JSON.parse(sessionStorage.getItem(FIRED_KEY) ?? '[]') as string[]);
    } catch {
      fired = new Set();
    }

    const check = () => {
      const { events, loadState } = useCalendarStore.getState();
      if (loadState !== 'ready') return;
      const now = Date.now();
      let changed = false;
      for (const event of Object.values(events)) {
        if (event.reminderMinutes === null) continue;
        if (event.organizerId !== userId && !event.attendeeIds.includes(userId)) continue;
        const lead = event.reminderMinutes * 60_000;
        for (const occurrence of expandEvent(event, now - GRACE_MS, now + lead + CHECK_EVERY_MS)) {
          const remindAt = occurrence.start - lead;
          const id = `${occurrence.key}@${remindAt}`;
          if (remindAt > now || now - remindAt > GRACE_MS || fired.has(id)) continue;
          fired.add(id);
          changed = true;
          const when = occurrence.start <= now ? 'Starting now' : `Starts at ${formatTime(occurrence.start, timeZone)}`;
          toast({ kind: 'info', title: `Reminder: ${event.title}`, message: when }, 10_000);
          announce(`Reminder: ${event.title}. ${when}.`);
        }
      }
      if (changed) {
        try {
          sessionStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-200)));
        } catch {
          /* non-critical */
        }
      }
    };

    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [userId, timeZone]);
}
