import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useUsersStore, userName } from '../../store/usersStore';
import { useAttendeeSearch } from '../../hooks/useAttendeeSearch';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import type { User } from '../../domain/types';

interface AttendeePickerProps {
  label: string;
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  /** People flagged as busy get a warning badge on their chip. */
  busyIds?: Set<number>;
  compact?: boolean;
}

/**
 * Searchable multi-select following the WAI-ARIA combobox + listbox pattern:
 * the input keeps focus, the active option is conveyed with
 * aria-activedescendant, Enter toggles, Backspace removes the last chip,
 * Escape closes the list (without closing the surrounding dialog).
 */
export function AttendeePicker({ label, value, onChange, placeholder = 'Search people…', busyIds, compact }: AttendeePickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const byId = useUsersStore((s) => s.byId);
  const initialIds = useUsersStore((s) => s.initialIds);
  const listState = useUsersStore((s) => s.listState);
  const search = useAttendeeSearch(query);

  useEffect(() => {
    void useUsersStore.getState().loadInitial();
  }, []);
  useEffect(() => {
    useUsersStore.getState().ensure(value);
  }, [value]);

  const options: User[] = useMemo(() => {
    if (query.trim()) return search.results;
    return initialIds.map((uid) => byId[uid]).filter(Boolean);
  }, [query, search.results, initialIds, byId]);

  useEffect(() => setActiveIndex(0), [query]);

  // Close when focus/clicks leave the widget.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const selected = new Set(value);
  const toggle = (user: User) => {
    onChange(selected.has(user.id) ? value.filter((v) => v !== user.id) : [...value, user.id]);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        else setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Enter':
        if (open && options[activeIndex]) {
          e.preventDefault();
          toggle(options[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation(); // close the list, not the dialog
          setOpen(false);
        }
        break;
      case 'Backspace':
        if (!query && value.length) onChange(value.slice(0, -1));
        break;
    }
  };

  const activeOption = open ? options[activeIndex] : undefined;
  const statusText =
    query.trim() && search.status === 'loading'
      ? 'Searching…'
      : search.status === 'error'
        ? search.error
        : open && options.length === 0
          ? query.trim()
            ? `No people match “${query.trim()}”.`
            : listState === 'loading'
              ? 'Loading people…'
              : 'No people available.'
          : null;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={`${id}-input`} className={compact ? 'sr-only' : 'mb-1 block text-sm font-medium text-slate-700'}>
        {label}
      </label>
      <div
        className="flex min-h-10 flex-wrap items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((uid) => {
          const user = byId[uid];
          const busy = busyIds?.has(uid);
          return (
            <span
              key={uid}
              className={`inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1 text-xs font-medium ${
                busy ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <Avatar user={user} id={uid} size={20} />
              <span className="truncate">{userName(user, uid)}</span>
              {busy && <Icon name="alert" size={12} className="text-amber-600" aria-label="busy" />}
              <button
                type="button"
                className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label={`Remove ${userName(user, uid)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((v) => v !== uid));
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${id}-opt-${activeOption.id}` : undefined}
          autoComplete="off"
          value={query}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-7 min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-slate-400"
        />
        {query && search.status === 'loading' && <Spinner size={14} className="text-slate-400" />}
      </div>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-60 overflow-y-auto py-1">
            {options.map((user, index) => {
              const isSelected = selected.has(user.id);
              return (
                <li
                  key={user.id}
                  id={`${id}-opt-${user.id}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                  onClick={() => toggle(user)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${index === activeIndex ? 'bg-brand-50' : ''}`}
                >
                  <Avatar user={user} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{userName(user)}</span>
                    <span className="block truncate text-xs text-slate-500">{user.email}</span>
                  </span>
                  {isSelected && <Icon name="check" size={16} className="text-brand-600" />}
                </li>
              );
            })}
          </ul>
          {statusText && (
            <p className="px-3 py-2 text-sm text-slate-500" role="status">
              {statusText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
