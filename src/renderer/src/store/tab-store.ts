import { create } from 'zustand';
import type { Tab } from '@shared/types';
import { INITIAL_TAB } from '@shared/types';

interface TabStore {
  tab: Tab;
  /** Overwrite the tab state wholesale (main is source of truth, renderer is a mirror). */
  setTab: (tab: Tab) => void;
}

export const useTabStore = create<TabStore>((set) => ({
  tab: { ...INITIAL_TAB },
  setTab: (tab) => set({ tab }),
}));
