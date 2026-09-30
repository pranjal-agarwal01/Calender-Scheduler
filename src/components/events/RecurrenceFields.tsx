import type { EventFormValues, FormErrors } from '../../domain/eventForm';
import type { MonthlyMode, Weekday } from '../../domain/types';
import { describeMonthlyMode, isLastWeekdayOfMonth, nthOfMonth, WEEKDAY_NAMES, WEEKDAY_SHORT, WEEKDAYS_MONDAY_FIRST } from '../../domain/recurrence/describe';
import { isValidDateKey } from '../../domain/time/dateKey';
import { inputClass } from './formStyles';
import { FieldError } from './FieldError';

interface Props {
  values: EventFormValues;
  errors: FormErrors;
  onChange: (patch: Partial<EventFormValues>) => void;
}

const UNIT: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month' };

/** Interval, weekdays (weekly), day rule (monthly) and how the series ends. */
export function RecurrenceFields({ values, errors, onChange }: Props) {
  if (values.repeat === 'none') return null;
  const startKey = isValidDateKey(values.startDate) ? values.startDate : null;
  const monthlyModes: MonthlyMode[] = ['dayOfMonth', 'nthWeekday'];
  if (startKey && (isLastWeekdayOfMonth(startKey) || nthOfMonth(startKey) === 5)) monthlyModes.push('lastWeekday');

  return (
    <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Repeat options</legend>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="rec-interval">Every</label>
        <input
          id="rec-interval"
          type="number"
          min={1}
          max={99}
          inputMode="numeric"
          value={values.interval}
          aria-invalid={!!errors.interval}
          aria-describedby={errors.interval ? 'rec-interval-error' : undefined}
          onChange={(e) => onChange({ interval: e.target.value })}
          className={`${inputClass(!!errors.interval)} w-20`}
        />
        <span>
          {UNIT[values.repeat]}
          {values.interval === '1' ? '' : 's'}
        </span>
        <FieldError id="rec-interval-error" message={errors.interval} />
      </div>

      {values.repeat === 'weekly' && (
        <div>
          <div role="group" aria-label="Repeat on" className="flex flex-wrap gap-1.5" aria-describedby={errors.byWeekday ? 'rec-days-error' : undefined}>
            {WEEKDAYS_MONDAY_FIRST.map((day: Weekday) => {
              const on = values.byWeekday.includes(day);
              return (
                <button
                  key={day}
                  id={day === 1 ? 'rec-days' : undefined}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_NAMES[day]}
                  onClick={() =>
                    onChange({ byWeekday: on ? values.byWeekday.filter((d) => d !== day) : [...values.byWeekday, day] })
                  }
                  className={`h-9 w-11 rounded-lg text-xs font-semibold transition-colors ${
                    on ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {WEEKDAY_SHORT[day]}
                </button>
              );
            })}
          </div>
          <FieldError id="rec-days-error" message={errors.byWeekday} />
        </div>
      )}

      {values.repeat === 'monthly' && startKey && (
        <div role="radiogroup" aria-label="Monthly on" className="space-y-1 text-sm">
          {monthlyModes.map((mode) => (
            <label key={mode} className="flex items-center gap-2">
              <input
                type="radio"
                name="monthlyMode"
                checked={values.monthlyMode === mode}
                onChange={() => onChange({ monthlyMode: mode })}
                className="accent-brand-600"
              />
              Monthly {describeMonthlyMode(mode, startKey)}
              {mode === 'dayOfMonth' && Number(startKey.slice(8)) > 28 && (
                <span className="text-xs text-slate-500">(last day in shorter months)</span>
              )}
            </label>
          ))}
        </div>
      )}

      <div className="space-y-1.5 text-sm" role="radiogroup" aria-label="Ends">
        <span className="block font-medium text-slate-700">Ends</span>
        <label className="flex items-center gap-2">
          <input type="radio" name="endType" checked={values.endType === 'never'} onChange={() => onChange({ endType: 'never' })} className="accent-brand-600" />
          Never
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <input type="radio" name="endType" checked={values.endType === 'until'} onChange={() => onChange({ endType: 'until' })} className="accent-brand-600" />
            On
          </label>
          <input
            id="rec-until"
            type="date"
            aria-label="End date"
            value={values.until}
            disabled={values.endType !== 'until'}
            aria-invalid={!!errors.until}
            aria-describedby={errors.until ? 'rec-until-error' : undefined}
            onChange={(e) => onChange({ until: e.target.value })}
            className={`${inputClass(!!errors.until)} w-40 disabled:opacity-50`}
          />
          <FieldError id="rec-until-error" message={errors.until} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <input type="radio" name="endType" checked={values.endType === 'count'} onChange={() => onChange({ endType: 'count' })} className="accent-brand-600" />
            After
          </label>
          <input
            id="rec-count"
            type="number"
            min={1}
            max={999}
            aria-label="Number of occurrences"
            value={values.count}
            disabled={values.endType !== 'count'}
            aria-invalid={!!errors.count}
            aria-describedby={errors.count ? 'rec-count-error' : undefined}
            onChange={(e) => onChange({ count: e.target.value })}
            className={`${inputClass(!!errors.count)} w-20 disabled:opacity-50`}
          />
          <span>occurrences</span>
          <FieldError id="rec-count-error" message={errors.count} />
        </div>
      </div>
    </fieldset>
  );
}
