import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>, durationMs?: number) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast, durationMs) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { ...toast, id }].slice(-MAX_TOASTS) });
    const ttl = durationMs ?? (toast.kind === 'error' ? 8000 : 4500);
    if (ttl > 0) setTimeout(() => get().dismiss(id), ttl);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (t: Omit<Toast, 'id'>, durationMs?: number) => useToastStore.getState().push(t, durationMs);
