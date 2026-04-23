import { useEffect } from 'react';
import { useTabsStore } from '../store/tab-store';

/**
 * Wires Zustand state to the two main-side broadcast events:
 *   - tabs:snapshot  → wholesale replace (on create/close/activate)
 *   - tab:updated    → merge one tab by id (on url/title/loading/history change)
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
    return () => {
      unsubSnapshot();
      unsubUpdated();
    };
  }, [setSnapshot, upsertTab]);
}
