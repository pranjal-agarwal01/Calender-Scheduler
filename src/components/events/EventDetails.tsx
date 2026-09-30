import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/Spinner';
import { useCalendarStore } from '../../store/calendarStore';
import { useUsersStore, userName } from '../../store/usersStore';
import { useUiStore } from '../../store/uiStore';
import { resolveOccurrence } from '../../domain/recurrence/expand';
import { draftFromOccurrence } from '../../domain/recurrence/edit';
import { describeRule } from '../../domain/recurrence/describe';
import { describeWhen } from '../../domain/describeWhen';
import { dateKeyInZone } from '../../domain/time/zoned';
import { formatZoneOffset } from '../../domain/time/format';
import { REMINDER_OPTIONS } from '../../config';
import { EVENT_COLOR_CLASSES } from '../calendar/eventColors';
import type { Occurrence } from '../../domain/types';
import { toApiError } from '../../api/apiError';

interface EventDetailsProps {
  eventId: string;
  timeZone: string;
  search: string;
  onDelete: (occurrence: Occurrence) => Promise<boolean>;
}

/**
 * Route component for /events/:eventId. Because the id comes from the URL,
 * a refresh reopens the same event; unknown ids show "Event not found".
 */
export function EventDetails({ eventId, timeZone, search, onDelete }: EventDetailsProps) {
  const navigate = useNavigate();
  const loadState = useCalendarStore((s) => s.loadState);
  const events = useCalendarStore((s) => s.events);
  const occurrence = useMemo(() => resolveOccurrence(events, eventId), [events, eventId]);
  const close = () => navigate(`/calendar?${search}`);

  if (loadState !== 'ready') {
    return (
      <Modal title="Loading event…" onClose={close} size="sm">
        <div className="flex items-center gap-3 py-4 text-slate-600">
          <Spinner /> Loading your calendar…
        </div>
      </Modal>
    );
  }

  if (!occurrence) {
    return (
      <Modal
        title="Event not found"
        onClose={close}
        size="sm"
        footer={
          <Button variant="primary" onClick={close}>
            Back to calendar
          </Button>
        }
      >
        <div className="flex items-start gap-3 text-sm text-slate-600">
          <Icon name="calendar" className="mt-0.5 shrink-0 text-slate-400" />
          <p>
            There is no event with the id <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-800">{eventId}</code>. It may have
            been deleted, or the link is incorrect.
          </p>
        </div>
      </Modal>
    );
  }

  return <DetailsContent occurrence={occurrence} timeZone={timeZone} onClose={close} onDelete={onDelete} />;
}

function DetailsContent({
  occurrence,
  timeZone,
  onClose,
  onDelete,
}: {
  occurrence: Occurrence;
  timeZone: string;
  onClose: () => void;
  onDelete: (occurrence: Occurrence) => Promise<boolean>;
}) {
  const { event } = occurrence;
  const events = useCalendarStore((s) => s.events);
  const pending = useCalendarStore((s) => s.pendingIds[event.id] === true);
  const users = useUsersStore((s) => s.byId);
  const openEditor = useUiStore((s) => s.openEditor);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const master = occurrence.seriesId ? events[occurrence.seriesId] : undefined;
  const people = useMemo(() => [event.organizerId, ...event.attendeeIds], [event.organizerId, event.attendeeIds]);

  useEffect(() => {
    useUsersStore.getState().ensure(people);
  }, [people]);

  const handleDelete = async () => {
    if (deletingRef.current) return; // one request, however many clicks
    deletingRef.current = true;
    setDeleting(true);
    try {
      if (await onDelete(occurrence)) onClose();
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const handleEdit = () => {
    openEditor({ mode: 'edit', occurrence, draft: draftFromOccurrence(occurrence, events) });
    onClose();
  };

  const reminder = REMINDER_OPTIONS.find((o) => o.value === event.reminderMinutes)?.label ?? `${event.reminderMinutes} minutes before`;
  const zone = master?.allDay || event.allDay ? 'UTC' : (master ?? event).timeZone;

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <span className={`h-3 w-3 shrink-0 rounded-full ${EVENT_COLOR_CLASSES[event.color].dot}`} aria-hidden="true" />
          <span className="truncate">{event.title}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon="trash" onClick={handleDelete} loading={deleting} className="mr-auto text-rose-700 hover:bg-rose-50">
            Delete
          </Button>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="edit" onClick={handleEdit}>
            Edit
          </Button>
        </>
      }
    >
      <dl className="space-y-3 text-sm">
        <Row icon="clock" label="When">
          <p className="text-slate-800">{describeWhen(occurrence.start, occurrence.end, occurrence.allDay, timeZone)}</p>
          {!occurrence.allDay && (
            <p className="text-xs text-slate-500">
              Shown in {timeZone} ({formatZoneOffset(timeZone, occurrence.start)})
            </p>
          )}
        </Row>
        {master?.recurrence && (
          <Row icon="repeat" label="Repeats">
            <p className="text-slate-800">{describeRule(master.recurrence, dateKeyInZone(Date.parse(master.start), zone))}</p>
            {!occurrence.isInstance && <p className="text-xs text-slate-500">This occurrence was changed individually.</p>}
          </Row>
        )}
        <Row icon="users" label="People">
          <ul className="space-y-1.5">
            {people.map((id, index) => (
              <PersonRow key={id} id={id} role={index === 0 ? 'Organizer' : undefined} name={userName(users[id], id)} />
            ))}
          </ul>
        </Row>
        {event.reminderMinutes !== null && (
          <Row icon="bell" label="Reminder">
            <p className="text-slate-800">{reminder}</p>
          </Row>
        )}
        {event.description && (
          <Row icon="text" label="Description">
            <p className="whitespace-pre-wrap text-slate-700">{event.description}</p>
          </Row>
        )}
        <Row icon={pending ? 'cloud' : 'check'} label="Sync">
          <p className="text-slate-600">{pending ? 'Saving to server…' : 'Saved'}</p>
        </Row>
      </dl>
      <p className="mt-4 text-xs text-slate-400">
        Tip: focus the event in the calendar and press <kbd className="rounded border px-1">M</kbd> to move it with the arrow keys.
      </p>
    </Modal>
  );
}

function Row({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="pt-0.5">
        <Icon name={icon} size={18} className="text-slate-400" />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/** Attendee row; expanding it fetches the full profile with GET /users/{id}. */
function PersonRow({ id, name, role }: { id: number; name: string; role?: string }) {
  const user = useUsersStore((s) => s.byId[id]);
  const detailed = useUsersStore((s) => s.detailed[id] === true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setOpen((v) => !v);
    if (!detailed) {
      useUsersStore
        .getState()
        .loadDetails(id)
        .catch((e: unknown) => setError(toApiError(e).message));
    }
  };

  return (
    <li>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-slate-50">
        <Avatar user={user} id={id} size={26} />
        <span className="min-w-0 flex-1 truncate text-slate-800">{name}</span>
        {role && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{role}</span>}
        <Icon name="chevronDown" size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="ml-9 mt-1 space-y-0.5 text-xs text-slate-600">
          {error ? (
            <p className="text-rose-600">{error}</p>
          ) : !detailed ? (
            <p className="flex items-center gap-2">
              <Spinner size={12} /> Loading profile…
            </p>
          ) : (
            <>
              {user?.email && <p>{user.email}</p>}
              {user?.phone && <p>{user.phone}</p>}
              {user?.company?.title && (
                <p>
                  {user.company.title}
                  {user.company.name ? `, ${user.company.name}` : ''}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
