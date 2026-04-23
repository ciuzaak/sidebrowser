import { useEffect } from 'react';
import { useWindowStateStore } from '../store/window-state-store';

/**
 * Wires Zustand window state to the main-side `window:state` broadcast.
 * Main emits this event after ready-to-show, so no initial invoke is needed.
 *
 * Call once from the top-level App component alongside useTabBridge.
 */
export function useWindowStateBridge(): void {
  const setState = useWindowStateStore((s) => s.setState);

  useEffect(() => {
    const unsub = window.sidebrowser.onWindowState(setState);
    return unsub;
  }, [setState]);
}
