import { useState } from 'react';
import type { User } from '../../domain/types';

const BG = ['bg-indigo-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-violet-500'];

export function Avatar({ user, id, size = 28 }: { user?: User; id?: number; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = user ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}` : '?';
  const color = BG[(user?.id ?? id ?? 0) % BG.length];
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (user?.image && !broken) {
    return (
      <img
        src={user.image}
        alt=""
        style={style}
        className="shrink-0 rounded-full bg-slate-100 object-cover"
        onError={() => setBroken(true)}
        loading="lazy"
      />
    );
  }
  return (
    <span aria-hidden="true" style={style} className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${color}`}>
      {initials}
    </span>
  );
}
