import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { parseCalendarParams, serializeCalendarState, type CalendarUrlState } from '../domain/urlState';
import { browserTimeZone } from '../domain/time/zoned';

/**
 * View, date, time zone and attendee filter live in the URL so they survive
 * refreshes and can be shared. Invalid values are replaced (history.replace)
 * with safe defaults.
 */
export function useCalendarUrlState() {
  const [params, setParams] = useSearchParams();
  const parsed = useMemo(() => parseCalendarParams(params, browserTimeZone()), [params]);

  useEffect(() => {
    if (!parsed.isCanonical) setParams(parsed.canonical, { replace: true });
  }, [parsed, setParams]);

  const update = useCallback(
    (patch: Partial<CalendarUrlState>, options: { replace?: boolean } = {}) => {
      setParams(serializeCalendarState({ ...parsed.state, ...patch }), { replace: options.replace ?? false });
    },
    [parsed.state, setParams],
  );

  return { state: parsed.state, search: parsed.canonical.toString(), update };
}
