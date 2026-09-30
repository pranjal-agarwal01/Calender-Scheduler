import { create } from 'zustand';

/**
 * Text for the aria-live region. Screen readers only announce *changes*, so
 * repeating the same sentence (e.g. two identical moves) alternates a
 * zero-width suffix to force a re-announcement.
 */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

interface AnnouncerState {
  polite: string;
  assertive: string;
  announce: (message: string, politeness?: 'polite' | 'assertive') => void;
}

export const useAnnouncer = create<AnnouncerState>((set, get) => ({
  polite: '',
  assertive: '',
  announce: (message, politeness = 'polite') => {
    // Identical text would not be re-announced, so alternate an invisible suffix.
    const text = get()[politeness] === message ? message + ZERO_WIDTH_SPACE : message;
    set({ [politeness]: text } as Pick<AnnouncerState, 'polite'>);
  },
}));

export const announce = (message: string, politeness?: 'polite' | 'assertive') =>
  useAnnouncer.getState().announce(message, politeness);
