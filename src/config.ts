/** Grid snapping for drag create/move/resize and keyboard moves (minutes). */
export const SNAP_MINUTES = 15;

/** Height of one hour in the week grid (px). */
export const HOUR_HEIGHT = 48;

/** Default length of an event created by a single click (minutes). */
export const DEFAULT_EVENT_MINUTES = 60;

/** Pointer travel (px) before a press on an event becomes a drag instead of a click. */
export const DRAG_THRESHOLD_PX = 4;

/** Scroll the week grid to this hour on first render. */
export const INITIAL_SCROLL_HOUR = 7;

/** Month view: event rows shown per week before "+N more". */
export const MONTH_VISIBLE_LANES = 3;

/** Week view: all-day rows shown before the "+N" expander. */
export const ALL_DAY_VISIBLE_LANES = 3;

/** Weeks start on Monday (ISO). */
export const WEEK_STARTS_ON = 1;

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'At start time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

export const EXPIRY_OPTIONS = [
  { value: 1, label: '1 minute (test token refresh)' },
  { value: 2, label: '2 minutes (test token refresh)' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];
