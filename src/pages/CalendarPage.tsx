import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppHeader } from '../components/layout/AppHeader';
import { Sidebar } from '../components/layout/Sidebar';
import { WeekView, type CreateRequest } from '../components/calendar/WeekView';
import { MonthView } from '../components/calendar/MonthView';
import { EventEditor } from '../components/events/EventEditor';
import { EventDetails } from '../components/events/EventDetails';
import { ScopeDialog } from '../components/events/ScopeDialog';
import { DevPanel } from '../components/dev/DevPanel';
import { ShortcutsDialog } from '../components/dev/ShortcutsDialog';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { Icon } from '../components/ui/Icon';
import { useCalendar } from '../hooks/useCalendar';
import { useEventActions } from '../hooks/useEventActions';
import { useHistory } from '../hooks/useHistory';
import { useNow } from '../hooks/useNow';
import { useReminders } from '../hooks/useReminders';
import { useAuthStore } from '../store/authStore';
import { useCalendarStore } from '../store/calendarStore';
import { useUsersStore } from '../store/usersStore';
import { useUiStore } from '../store/uiStore';
import { todayKey, zonedToUtc } from '../domain/time/zoned';
import { parseDateKey } from '../domain/time/dateKey';
import type { AuthUser, EventDraft, Occurrence } from '../domain/types';
import { DEFAULT_EVENT_MINUTES, SNAP_MINUTES } from '../config';

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/** Layout route for /calendar and /events/:eventId (the details dialog opens on top). */
export function CalendarPage() {
  const user = useAuthStore((s) => s.user) as AuthUser;
  const calendar = useCalendar();
  const { timeZone } = calendar;
  const navigate = useNavigate();
  const { eventId } = useParams();
  const loadState = useCalendarStore((s) => s.loadState);
  const loadError = useCalendarStore((s) => s.loadError);
  const seedAnchor = useCalendarStore((s) => s.seedAnchor);
  const editor = useUiStore((s) => s.editor);
  const editorVersion = useUiStore((s) => s.editorVersion);
  const scopePrompt = useUiStore((s) => s.scopePrompt);
  const openEditor = useUiStore((s) => s.openEditor);
  const actions = useEventActions(timeZone);
  const now = useNow();
  const today = todayKey(timeZone, now);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [devOpen, setDevOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useHistory({ shortcuts: true });
  useReminders(user.id, timeZone);

  // Load (or seed) this user's calendar; drop it on logout / tab-synced logout.
  useEffect(() => {
    void useCalendarStore.getState().load(user.id, timeZone);
    void useUsersStore.getState().loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the zone only matters for first-time seeding
  }, [user.id]);
  useEffect(
    () => () => {
      useCalendarStore.getState().unload();
      useUiStore.setState({ editor: null, keyboardMove: null });
      useUiStore.getState().answerScope(null);
    },
    [],
  );

  const openOccurrence = useCallback(
    (occurrence: Occurrence) => navigate(`/events/${encodeURIComponent(occurrence.key)}?${calendar.search}`),
    [navigate, calendar.search],
  );

  const openCreate = useCallback(
    (request?: CreateRequest) => {
      let start: number;
      let end: number;
      if (request) {
        ({ start, end } = request);
      } else {
        // Toolbar "Create": next free quarter hour today, or 9:00 on the viewed date.
        const baseDay = calendar.date === today || !parseDateKey(calendar.date) ? today : calendar.date;
        const minutes = baseDay === today ? Math.ceil(((now - zonedToUtc(today, 0, timeZone)) / 60_000 + 1) / SNAP_MINUTES) * SNAP_MINUTES : 9 * 60;
        start = zonedToUtc(baseDay, Math.min(minutes, 23 * 60), timeZone);
        end = start + DEFAULT_EVENT_MINUTES * 60_000;
      }
      const draft: EventDraft = {
        title: '',
        description: '',
        start,
        end,
        allDay: request?.allDay ?? false,
        timeZone,
        attendeeIds: [],
        reminderMinutes: null,
        color: 'indigo',
        recurrence: null,
      };
      openEditor({ mode: 'create', draft });
    },
    [calendar.date, now, openEditor, timeZone, today],
  );

  const handleDelete = useCallback((occurrence: Occurrence) => void actions.deleteOccurrence(occurrence), [actions]);
  const { goPrev, goNext, goToday } = calendar;
  const handleNavigate = useCallback((direction: -1 | 1) => (direction < 0 ? goPrev() : goNext()), [goPrev, goNext]);

  // Global single-key shortcuts (ignored while typing or when a dialog is open).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const ui = useUiStore.getState();
      if (ui.editor || ui.scopePrompt || ui.keyboardMove || document.querySelector('[aria-modal="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 't') goToday();
      else if (key === 'n' || key === 'j') goNext();
      else if (key === 'p' || key === 'k') goPrev();
      else if (key === 'c') openCreate();
      else if (e.key === '?') setShortcutsOpen(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goToday, goNext, goPrev, openCreate]);

  const logout = () => {
    useAuthStore.getState().logout();
  };

  const selectedKey = eventId ?? null;
  const month = parseDateKey(calendar.date)?.month ?? 1;

  return (
    <div className="flex h-full flex-col">
      <a
        href="#calendar-main"
        className="sr-only z-50 rounded-md bg-brand-600 px-3 py-2 text-white focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        Skip to calendar
      </a>
      <AppHeader
        calendar={calendar}
        user={user}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onLogout={logout}
        onOpenDevTools={() => setDevOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <>
            <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" aria-hidden="true" onClick={() => setSidebarOpen(false)} />
            <div className="fixed inset-y-0 left-0 z-40 shadow-xl lg:static lg:z-auto lg:shadow-none">
              <Sidebar calendar={calendar} today={today} onCreate={() => openCreate()} />
            </div>
          </>
        )}
        <main id="calendar-main" tabIndex={-1} className="relative min-w-0 flex-1 outline-none" aria-busy={loadState === 'loading'}>
          {loadState === 'ready' ? (
            calendar.view === 'week' ? (
              <WeekView
                days={calendar.days}
                timeZone={timeZone}
                occurrences={calendar.occurrences}
                selectedKey={selectedKey}
                today={today}
                now={now}
                onOpen={openOccurrence}
                onCreate={openCreate}
                onTimeChange={actions.commitTimeChange}
                onDelete={handleDelete}
                onNavigate={handleNavigate}
              />
            ) : (
              <MonthView
                days={calendar.days}
                month={month}
                timeZone={timeZone}
                occurrences={calendar.occurrences}
                selectedKey={selectedKey}
                today={today}
                onOpen={openOccurrence}
                onCreate={openCreate}
                onTimeChange={actions.commitTimeChange}
                onDelete={handleDelete}
                onShowWeek={calendar.showWeekOf}
              />
            )
          ) : loadState === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Icon name="cloudOff" size={32} className="text-rose-500" />
              <p className="font-medium text-slate-800">Couldn't load your calendar</p>
              <p className="max-w-sm text-sm text-slate-500">{loadError}</p>
              <Button variant="primary" onClick={() => void useCalendarStore.getState().load(user.id, timeZone, { force: true })}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center gap-3 text-slate-500" role="status">
              <Spinner /> Loading your calendar…
            </div>
          )}
        </main>
      </div>

      {editor && (
        <EventEditor
          key={editorVersion}
          editor={editor}
          timeZone={timeZone}
          onCreate={actions.createEvent}
          onUpdate={(occurrence, draft) => actions.updateOccurrence(occurrence, draft, 'Edit')}
        />
      )}
      {eventId !== undefined && <EventDetails timeZone={timeZone} search={calendar.search} onDelete={actions.deleteOccurrence} />}
      {scopePrompt && <ScopeDialog />}
      {devOpen && <DevPanel onClose={() => setDevOpen(false)} timeZone={timeZone} anchor={seedAnchor ?? today} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
