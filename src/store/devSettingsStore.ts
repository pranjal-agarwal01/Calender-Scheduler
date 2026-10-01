import { create } from 'zustand';

/**
 * Knobs for demoing failure handling: how often the fake sync API fails, and
 * whether every DummyJSON request gets `?delay=3000` (slow-response testing).
 */
interface DevSettings {
  failureRate: number;
  slowNetwork: boolean;
  setFailureRate: (rate: number) => void;
  setSlowNetwork: (on: boolean) => void;
}

const STORAGE_KEY = 'cal.dev.v1';
const DEFAULT_FAILURE_RATE = 0.2;

function load(): Pick<DevSettings, 'failureRate' | 'slowNetwork'> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<DevSettings>;
    return {
      failureRate:
        typeof parsed.failureRate === 'number' && parsed.failureRate >= 0 && parsed.failureRate <= 1
          ? parsed.failureRate
          : DEFAULT_FAILURE_RATE,
      slowNetwork: parsed.slowNetwork === true,
    };
  } catch {
    return { failureRate: DEFAULT_FAILURE_RATE, slowNetwork: false };
  }
}

function persist(state: Pick<DevSettings, 'failureRate' | 'slowNetwork'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* non-critical */
  }
}

export const useDevSettings = create<DevSettings>((set, get) => ({
  ...(typeof localStorage === 'undefined' ? { failureRate: DEFAULT_FAILURE_RATE, slowNetwork: false } : load()),
  setFailureRate: (failureRate) => {
    set({ failureRate });
    persist({ failureRate, slowNetwork: get().slowNetwork });
  },
  setSlowNetwork: (slowNetwork) => {
    set({ slowNetwork });
    persist({ failureRate: get().failureRate, slowNetwork });
  },
}));
