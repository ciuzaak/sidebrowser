import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { TabDrawer } from './components/TabDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTabBridge } from './hooks/useTabBridge';
import { useWindowStateBridge } from './hooks/useWindowStateBridge';
import { useSettingsStore } from './store/settings-store';
import { useTheme } from './theme/useTheme';

export function App(): ReactElement {
  useTabBridge();
  useWindowStateBridge();
  useSettingsBridge();

  const settings = useSettingsStore((s) => s.settings);
  useTheme(settings?.appearance.theme ?? 'system');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chromeRef = useRef<HTMLDivElement | null>(null);

  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleSettings = useCallback(() => setSettingsOpen((v) => !v), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;

    const report = (): void => {
      window.sidebrowser.setChromeHeight(el.getBoundingClientRect().height);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drawer coordinates with main's ViewManager to hide the active WebContentsView
  // while the Settings UI is visible — React DOM cannot stack above the native
  // view layer (spec §4.2 / plan Task 10). Fires on every open/close transition.
  useEffect(() => {
    window.sidebrowser.setViewSuppressed(settingsOpen);
  }, [settingsOpen]);

  // Spec §15: dispatch renderer-bound shortcut actions from the hidden
  // Application Menu. The main-side accelerator fires → IPC broadcast →
  // this switch maps the action to local state. `toggleDrawer` and
  // `toggleSettings` are useCallback-stable (no deps), so depending on them
  // is safe. Address-bar focus goes via a DOM selector to avoid plumbing a
  // ref through TopBar (YAGNI per plan §Task 3).
  useEffect(() => {
    return window.sidebrowser.onShortcut((action) => {
      switch (action) {
        case 'focus-address-bar': {
          const input = document.querySelector<HTMLInputElement>('[data-testid="address-bar"]');
          input?.focus();
          input?.select();
          return;
        }
        case 'toggle-tab-drawer':
          toggleDrawer();
          return;
        case 'toggle-settings-drawer':
          toggleSettings();
          return;
      }
    });
  }, [toggleDrawer, toggleSettings]);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={chromeRef} className="shrink-0">
        <TopBar
          drawerOpen={drawerOpen}
          onToggleDrawer={toggleDrawer}
          settingsOpen={settingsOpen}
          onToggleSettings={toggleSettings}
        />
        <TabDrawer open={drawerOpen} onSelect={closeDrawer} />
      </div>
      {/* WebContentsView is overlaid by main below the chrome area. */}
      <div className="relative flex-1">
        <SettingsDrawer open={settingsOpen} onClose={closeSettings} />
      </div>
    </div>
  );
}
