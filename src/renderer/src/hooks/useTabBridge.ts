import { useEffect } from 'react';
import { useTabStore } from '../store/tab-store';

/**
 * Wires the Zustand `tab` slice to main's `tab:updated` broadcasts.
 * Call once from the top-level App component.
 */
export function useTabBridge(): void {
  const setTab = useTabStore((s) => s.setTab);

  useEffect(() => {
    const unsubscribe = window.sidebrowser.onTabUpdated((tab) => {
      setTab(tab);
    });
    return unsubscribe;
  }, [setTab]);
}
