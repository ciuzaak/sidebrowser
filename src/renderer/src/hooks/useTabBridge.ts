import { useEffect } from 'react';
import { useTabsStore } from '../store/tab-store';

/**
 * Wires Zustand state to the two main-side broadcast events:
 *   - tabs:snapshot  → wholesale replace (on create/close/activate)
 *   - tab:updated    → merge one tab by id (on url/title/loading/history change)
 *
 * After subscribing, explicitly requests the current snapshot via IPC to close
 * the broadcast-vs-useEffect race: on app launch, main's seed-tabs snapshot
 * may fire before this useEffect commits, in which case the broadcast is dropped.
 *
 * Call once from the top-level App component.
 */
export function useTabBridge(): void {
  const setSnapshot = useTabsStore((s) => s.setSnapshot);
  const upsertTab = useTabsStore((s) => s.upsertTab);

  useEffect(() => {
    const unsubSnapshot = window.sidebrowser.onTabsSnapshot((snapshot) => {
      setSnapshot(snapshot);
    });
    const unsubUpdated = window.sidebrowser.onTabUpdated((tab) => {
      upsertTab(tab);
    });
    void window.sidebrowser.requestTabsSnapshot().then(setSnapshot);
    return () => {
      unsubSnapshot();
      unsubUpdated();
    };
  }, [setSnapshot, upsertTab]);
}
