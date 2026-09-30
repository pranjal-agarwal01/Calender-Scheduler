import { useToastStore, type ToastKind } from '../../store/toastStore';
import { Icon, type IconName } from './Icon';

const STYLES: Record<ToastKind, { icon: IconName; ring: string; iconColor: string }> = {
  info: { icon: 'info', ring: 'border-slate-200', iconColor: 'text-brand-600' },
  success: { icon: 'check', ring: 'border-emerald-200', iconColor: 'text-emerald-600' },
  warning: { icon: 'alert', ring: 'border-amber-300', iconColor: 'text-amber-600' },
  error: { icon: 'alert', ring: 'border-rose-300', iconColor: 'text-rose-600' },
};

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0">
      {toasts.map((t) => {
        const style = STYLES[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3 pr-2 shadow-lg ${style.ring}`}
          >
            <Icon name={style.icon} className={`mt-0.5 shrink-0 ${style.iconColor}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{t.title}</p>
              {t.message && <p className="mt-0.5 text-sm text-slate-600">{t.message}</p>}
            </div>
            {t.action && (
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={() => dismiss(t.id)}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
