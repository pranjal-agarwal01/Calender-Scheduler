import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { AttendeePicker } from './AttendeePicker';
import { RecurrenceFields } from './RecurrenceFields';
import { ConflictNotice } from './ConflictNotice';
import { inputClass } from './formStyles';
import { FieldError } from './FieldError';
import { draftFromValues, shiftEndWithStart, valuesFromDraft, type EventFormValues, type FormField } from '../../domain/eventForm';
import { describeRule } from '../../domain/recurrence/describe';
import { EVENT_COLORS, type EventDraft, type Occurrence, type Weekday } from '../../domain/types';
import { weekdayOf } from '../../domain/time/dateKey';
import { formatZoneOffset } from '../../domain/time/format';
import { EVENT_COLOR_CLASSES } from '../calendar/eventColors';
import { useUiStore, type EditorState } from '../../store/uiStore';
import { REMINDER_OPTIONS } from '../../config';

const FIELD_IDS: Record<FormField, string> = {
  title: 'ev-title',
  startDate: 'ev-start-date',
  startTime: 'ev-start-time',
  endDate: 'ev-end-date',
  endTime: 'ev-end-time',
  interval: 'rec-interval',
  byWeekday: 'rec-days',
  until: 'rec-until',
  count: 'rec-count',
};
const FIELD_ORDER: FormField[] = ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'interval', 'byWeekday', 'until', 'count'];

interface EventEditorProps {
  editor: EditorState;
  timeZone: string;
  onCreate: (draft: EventDraft) => boolean;
  onUpdate: (occurrence: Occurrence, draft: EventDraft) => Promise<boolean>;
}

/**
 * Create/edit form. Validation runs on every change but errors only show
 * after the first submit attempt (or once a field was touched), and the
 * first invalid field receives focus. Save is guarded against double submits.
 */
export function EventEditor({ editor, timeZone, onCreate, onUpdate }: EventEditorProps) {
  const closeEditor = useUiStore((s) => s.closeEditor);
  const titleRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<EventFormValues>(() => valuesFromDraft(editor.draft, timeZone));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const { draft, errors } = useMemo(() => draftFromValues(values, timeZone), [values, timeZone]);
  const visibleErrors = showErrors ? errors : {};

  const update = (patch: Partial<EventFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const updateStart = (patch: Partial<EventFormValues>) => setValues((v) => shiftEndWithStart(v, { ...v, ...patch }, timeZone));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return; // double-click / double-Enter guard: only one save
    if (!draft) {
      setShowErrors(true);
      const first = FIELD_ORDER.find((f) => errors[f]);
      if (first) document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const ok = editor.mode === 'create' ? onCreate(draft) : await onUpdate(editor.occurrence, draft);
      if (ok) closeEditor();
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const recurrencePreview =
    draft?.recurrence && values.startDate ? describeRule(draft.recurrence, values.startDate) : null;

  const exclude =
    editor.mode === 'edit'
      ? { eventId: editor.occurrence.event.id, seriesId: editor.occurrence.seriesId }
      : { eventId: null, seriesId: null };

  return (
    <Modal
      title={editor.mode === 'create' ? 'New event' : 'Edit event'}
      onClose={closeEditor}
      initialFocusRef={titleRef}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={closeEditor}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="event-form" loading={saving} icon="check">
            Save
          </Button>
        </>
      }
    >
      <form id="event-form" noValidate onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="ev-title" className="sr-only">
            Title
          </label>
          <input
            ref={titleRef}
            id="ev-title"
            value={values.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Add title"
            aria-required="true"
            aria-invalid={!!visibleErrors.title}
            aria-describedby={visibleErrors.title ? 'ev-title-error' : undefined}
            className={`w-full border-0 border-b-2 bg-transparent px-0 py-1.5 text-xl font-medium outline-none placeholder:text-slate-400 ${
              visibleErrors.title ? 'border-rose-400' : 'border-slate-200 focus:border-brand-500'
            }`}
          />
          <FieldError id="ev-title-error" message={visibleErrors.title} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Icon name="clock" size={16} className="text-slate-400" /> When
            </span>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                role="switch"
                checked={values.allDay}
                onChange={(e) => update({ allDay: e.target.checked })}
                className="h-4 w-4 accent-brand-600"
              />
              All day
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1 text-xs text-slate-500">Starts</legend>
              <input
                id="ev-start-date"
                type="date"
                aria-label="Start date"
                value={values.startDate}
                onChange={(e) => {
                  const startDate = e.target.value;
                  const patch: Partial<EventFormValues> = { startDate };
                  // Keep a weekly rule's default day in sync with the start date while untouched.
                  if (values.repeat === 'weekly' && values.byWeekday.length === 1 && startDate) {
                    patch.byWeekday = [weekdayOf(startDate) as Weekday];
                  }
                  updateStart(patch);
                }}
                aria-invalid={!!visibleErrors.startDate}
                className={`${inputClass(!!visibleErrors.startDate)} min-w-0 flex-1`}
              />
              {!values.allDay && (
                <input
                  id="ev-start-time"
                  type="time"
                  step={900}
                  aria-label="Start time"
                  value={values.startTime}
                  onChange={(e) => updateStart({ startTime: e.target.value })}
                  aria-invalid={!!visibleErrors.startTime}
                  className={`${inputClass(!!visibleErrors.startTime)} w-32`}
                />
              )}
              <FieldError id="ev-start-error" message={visibleErrors.startDate ?? visibleErrors.startTime} />
            </fieldset>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1 text-xs text-slate-500">Ends</legend>
              <input
                id="ev-end-date"
                type="date"
                aria-label="End date"
                value={values.endDate}
                onChange={(e) => update({ endDate: e.target.value })}
                aria-invalid={!!visibleErrors.endDate}
                aria-describedby={visibleErrors.endDate ? 'ev-end-error' : undefined}
                className={`${inputClass(!!visibleErrors.endDate)} min-w-0 flex-1`}
              />
              {!values.allDay && (
                <input
                  id="ev-end-time"
                  type="time"
                  step={900}
                  aria-label="End time"
                  value={values.endTime}
                  onChange={(e) => update({ endTime: e.target.value })}
                  aria-invalid={!!visibleErrors.endTime}
                  aria-describedby={visibleErrors.endTime ? 'ev-end-error' : undefined}
                  className={`${inputClass(!!visibleErrors.endTime)} w-32`}
                />
              )}
              <FieldError id="ev-end-error" message={visibleErrors.endDate ?? visibleErrors.endTime} />
            </fieldset>
          </div>
          {!values.allDay && (
            <p className="text-xs text-slate-500">
              Times are in {timeZone} ({formatZoneOffset(timeZone)}) and stored in UTC.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="ev-repeat" className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Icon name="repeat" size={16} className="text-slate-400" /> Repeat
          </label>
          <select
            id="ev-repeat"
            value={values.repeat}
            onChange={(e) => update({ repeat: e.target.value as EventFormValues['repeat'] })}
            className={`${inputClass()} w-full`}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <RecurrenceFields values={values} errors={visibleErrors} onChange={update} />
          {recurrencePreview && (
            <p className="text-xs text-slate-600" aria-live="polite">
              {recurrencePreview}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <AttendeePicker label="Attendees" value={values.attendeeIds} onChange={(attendeeIds) => update({ attendeeIds })} />
          <ConflictNotice draft={draft} attendeeIds={values.attendeeIds} exclude={exclude} timeZone={timeZone} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ev-reminder" className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
              <Icon name="bell" size={16} className="text-slate-400" /> Reminder
            </label>
            <select
              id="ev-reminder"
              value={values.reminderMinutes ?? ''}
              onChange={(e) => update({ reminderMinutes: e.target.value === '' ? null : Number(e.target.value) })}
              className={`${inputClass()} w-full`}
            >
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Colour</legend>
            <div className="flex h-10 items-center gap-2" role="radiogroup" aria-label="Colour">
              {EVENT_COLORS.map((color) => (
                <label key={color} className="relative cursor-pointer" title={EVENT_COLOR_CLASSES[color].label}>
                  <input
                    type="radio"
                    name="color"
                    value={color}
                    checked={values.color === color}
                    onChange={() => update({ color })}
                    className="peer sr-only"
                    aria-label={EVENT_COLOR_CLASSES[color].label}
                  />
                  <span
                    className={`block h-6 w-6 rounded-full ${EVENT_COLOR_CLASSES[color].swatch} ring-offset-2 peer-checked:ring-2 peer-checked:ring-slate-700 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500`}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div>
          <label htmlFor="ev-description" className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Icon name="text" size={16} className="text-slate-400" /> Description
          </label>
          <textarea
            id="ev-description"
            rows={3}
            value={values.description}
            onChange={(e) => update({ description: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </form>
    </Modal>
  );
}
