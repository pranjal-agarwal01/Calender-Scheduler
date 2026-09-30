export function inputClass(invalid = false): string {
  return `h-10 rounded-lg border bg-white px-3 text-sm text-slate-800 outline-none transition-colors focus:ring-2 ${
    invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
  }`;
}
