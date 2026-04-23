import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { TabDrawer } from './components/TabDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTabBridge } from './hooks/useTabBridge';
import { useWindowStateBridge } from './hooks/useWindowStateBridge';

export function App(): ReactElement {
  useTabBridge();
  useWindowStateBridge();
  useSettingsBridge();

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
