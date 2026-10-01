import { memo, useId, useMemo } from 'react';
import { browserTimeZone } from '../../domain/time/zoned';
import { formatZoneOffset } from '../../domain/time/format';
import { Icon } from '../ui/Icon';

const COMMON = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
];

function allZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return COMMON; // very old browsers
  }
}

/** Display time zone. Changing it only changes how UTC times are shown. Memoised: ~400 options. */
export const TimezoneSelect = memo(function TimezoneSelect({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const id = useId();
  const local = browserTimeZone();
  const groups = useMemo(() => {
    const now = Date.now();
    const label = (zone: string) => `${zone.replace(/_/g, ' ')} (${formatZoneOffset(zone, now)})`;
    const common = [...new Set([local, ...COMMON, value])];
    const rest = allZones().filter((z) => !common.includes(z));
    return { common: common.map((z) => ({ z, l: label(z) })), rest: rest.map((z) => ({ z, l: label(z) })) };
  }, [local, value]);

  return (
    <div className="relative flex items-center">
      <label htmlFor={id} className="sr-only">
        Time zone
      </label>
      <Icon name="globe" size={16} className="pointer-events-none absolute left-2.5 text-slate-500" />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 max-w-[11rem] appearance-none truncate rounded-lg border border-slate-300 bg-white pl-8 pr-7 text-sm text-slate-700 hover:bg-slate-50 lg:max-w-[15rem]"
      >
        <optgroup label="Common">
          {groups.common.map(({ z, l }) => (
            <option key={z} value={z}>
              {z === local ? `${l} · local` : l}
            </option>
          ))}
        </optgroup>
        <optgroup label="All time zones">
          {groups.rest.map(({ z, l }) => (
            <option key={z} value={z}>
              {l}
            </option>
          ))}
        </optgroup>
      </select>
      <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2 text-slate-500" />
    </div>
  );
});
