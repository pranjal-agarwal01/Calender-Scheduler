import type { EventColor } from '../../domain/types';

/** Literal class strings (Tailwind only generates classes it can see in the source). */
export const EVENT_COLOR_CLASSES: Record<EventColor, { block: string; chip: string; dot: string; swatch: string; label: string }> = {
  indigo: {
    block: 'bg-indigo-50 border-indigo-500 text-indigo-950 hover:bg-indigo-100',
    chip: 'bg-indigo-500 text-white',
    dot: 'bg-indigo-500',
    swatch: 'bg-indigo-500',
    label: 'Indigo',
  },
  sky: {
    block: 'bg-sky-50 border-sky-500 text-sky-950 hover:bg-sky-100',
    chip: 'bg-sky-500 text-white',
    dot: 'bg-sky-500',
    swatch: 'bg-sky-500',
    label: 'Sky',
  },
  emerald: {
    block: 'bg-emerald-50 border-emerald-500 text-emerald-950 hover:bg-emerald-100',
    chip: 'bg-emerald-600 text-white',
    dot: 'bg-emerald-500',
    swatch: 'bg-emerald-500',
    label: 'Emerald',
  },
  amber: {
    block: 'bg-amber-50 border-amber-500 text-amber-950 hover:bg-amber-100',
    chip: 'bg-amber-500 text-amber-950',
    dot: 'bg-amber-500',
    swatch: 'bg-amber-500',
    label: 'Amber',
  },
  rose: {
    block: 'bg-rose-50 border-rose-500 text-rose-950 hover:bg-rose-100',
    chip: 'bg-rose-500 text-white',
    dot: 'bg-rose-500',
    swatch: 'bg-rose-500',
    label: 'Rose',
  },
  violet: {
    block: 'bg-violet-50 border-violet-500 text-violet-950 hover:bg-violet-100',
    chip: 'bg-violet-500 text-white',
    dot: 'bg-violet-500',
    swatch: 'bg-violet-500',
    label: 'Violet',
  },
  slate: {
    block: 'bg-slate-100 border-slate-400 text-slate-700 hover:bg-slate-200',
    chip: 'bg-slate-500 text-white',
    dot: 'bg-slate-400',
    swatch: 'bg-slate-400',
    label: 'Grey',
  },
};
