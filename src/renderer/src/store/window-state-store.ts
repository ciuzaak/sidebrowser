import { create } from 'zustand';
import type { WindowState } from '@shared/types';

interface WindowStateSlice extends WindowState {
  /** Replace all three fields wholesale from a main-side broadcast. */
  setState: (s: WindowState) => void;
}

export const useWindowStateStore = create<WindowStateSlice>((set) => ({
  docked: null,
  hidden: false,
  dimmed: false,
  setState: (s) => set(s),
}));
