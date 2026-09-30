import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';
import { TimezoneSelect } from './TimezoneSelect';
import { SyncIndicator } from './SyncIndicator';
import { useHistory } from '../../hooks/useHistory';
import type { CalendarModel } from '../../hooks/useCalendar';
import type { AuthUser } from '../../domain/types';

interface AppHeaderProps {
  calendar: CalendarModel;
  user: AuthUser;
  onToggleSidebar: () => void;
  onLogout: () => void;
  onOpenDevTools: () => void;
  onOpenShortcuts: () => void;
}

export function AppHeader({ calendar, user, onToggleSidebar, onLogout, onOpenDevTools, onOpenShortcuts }: AppHeaderProps) {
  const history = useHistory();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-slate-200 bg-white px-3 py-2">
      <IconButton label="Toggle sidebar" icon="menu" onClick={onToggleSidebar} />
      <div className="mr-2 hidden items-center gap-2 sm:flex">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Icon name="calendar" size={18} />
        </span>
        <span className="text-lg font-semibold text-slate-800">Calendar</span>
      </div>

      <Button size="sm" onClick={calendar.goToday} title="Today (T)">
        Today
      </Button>
      <div className="flex items-center">
        <IconButton label={`Previous ${calendar.view} (P)`} icon="chevronLeft" onClick={calendar.goPrev} />
        <IconButton label={`Next ${calendar.view} (N)`} icon="chevronRight" onClick={calendar.goNext} />
      </div>
      <h1 className="min-w-0 truncate text-lg font-medium text-slate-800" aria-live="polite">
        {calendar.title}
      </h1>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SyncIndicator />
        <div className="flex items-center rounded-lg border border-slate-200 p-0.5">
          <IconButton
            label={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
            icon="undo"
            disabled={!history.canUndo}
            onClick={history.undo}
            className="h-8 w-8"
          />
          <IconButton
            label={history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'}
            icon="redo"
            disabled={!history.canRedo}
            onClick={history.redo}
            className="h-8 w-8"
          />
        </div>
        <TimezoneSelect value={calendar.timeZone} onChange={calendar.setTimeZone} />
        <div role="group" aria-label="View" className="flex rounded-lg border border-slate-300 p-0.5">
          {(['week', 'month'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={calendar.view === view}
              onClick={() => calendar.setView(view)}
              className={`h-8 rounded-md px-3 text-sm font-medium capitalize ${
                calendar.view === view ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {view}
            </button>
          ))}
        </div>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Account menu for ${user.firstName} ${user.lastName}`}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full p-0.5 hover:bg-slate-100"
          >
            <Avatar user={user} size={32} />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
              <div className="border-b border-slate-100 px-4 py-2">
                <p className="truncate text-sm font-semibold text-slate-800">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-xs text-slate-500">@{user.username}</p>
              </div>
              <MenuItem icon="keyboard" onClick={() => (setMenuOpen(false), onOpenShortcuts())}>
                Keyboard shortcuts
              </MenuItem>
              <MenuItem icon="settings" onClick={() => (setMenuOpen(false), onOpenDevTools())}>
                Developer tools
              </MenuItem>
              <MenuItem icon="logout" onClick={onLogout}>
                Log out
              </MenuItem>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({ icon, onClick, children }: { icon: 'keyboard' | 'settings' | 'logout'; onClick: () => void; children: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
      <Icon name={icon} size={16} className="text-slate-500" />
      {children}
    </button>
  );
}
