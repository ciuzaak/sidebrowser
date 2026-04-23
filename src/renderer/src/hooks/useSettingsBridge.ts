import { useEffect } from 'react';
import { useSettingsStore } from '../store/settings-store';

/**
 * Wires Zustand settings store to main-side broadcasts:
 *   - app:ready         → one-shot initial Settings on ready-to-show
 *   - settings:changed  → all subsequent updates (user + live-apply)
 *
 * After subscribing, explicitly invokes `settings:get` to close the
 * broadcast-vs-useEffect race — same pattern as useTabBridge. On app
 * launch, main may emit `app:ready` before this effect commits, in
 * which case the broadcast would be dropped; the explicit invoke
 * guarantees hydration either way.
 *
 * The invoke result is authoritative; broadcasts are idempotent
 * follow-ups carrying the same full Settings shape.
 *
 * Call once from the top-level App component.
 */
export function useSettingsBridge(): void {
  const setSettings = useSettingsStore((s) => s.setSettings);

  useEffect(() => {
    const unsubReady = window.sidebrowser.onAppReady((p) => setSettings(p.settings));
    const unsubChanged = window.sidebrowser.onSettingsChanged(setSettings);
    void window.sidebrowser.getSettings().then(setSettings);
    return () => {
      unsubReady();
      unsubChanged();
    };
  }, [setSettings]);
}
