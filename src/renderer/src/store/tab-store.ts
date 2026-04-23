import { create } from 'zustand';
import type { Tab, TabsSnapshot } from '@shared/types';

interface TabsState {
  tabs: Record<string, Tab>;
  tabOrder: string[];
  activeId: string | null;
  /** Replace the entire tabs + activeId state from a main-side snapshot. */
  setSnapshot: (snapshot: TabsSnapshot) => void;
  /** Merge a single Tab into the store (id used as key). */
  upsertTab: (tab: Tab) => void;
}

export const useTabsStore = create<TabsState>((set) => ({
  tabs: {},
  tabOrder: [],
  activeId: null,
  setSnapshot: (snapshot) =>
    set(() => {
      const tabs: Record<string, Tab> = {};
      for (const t of snapshot.tabs) tabs[t.id] = t;
      return {
        tabs,
        tabOrder: snapshot.tabs.map((t) => t.id),
        activeId: snapshot.activeId,
      };
    }),
  upsertTab: (tab) =>
    set((state) => ({
      tabs: { ...state.tabs, [tab.id]: tab },
    })),
}));

/** Selector hook: active Tab or null. */
export function useActiveTab(): Tab | null {
  return useTabsStore((s) => (s.activeId ? (s.tabs[s.activeId] ?? null) : null));
}
