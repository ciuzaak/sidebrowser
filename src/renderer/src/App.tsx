import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { TabDrawer } from './components/TabDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { NewTab } from './components/NewTab';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTabBridge } from './hooks/useTabBridge';
import { useWindowStateBridge } from './hooks/useWindowStateBridge';
import { useSettingsStore } from './store/settings-store';
import { useActiveTab } from './store/tab-store';
import { useTheme } from './theme/useTheme';

export function App(): ReactElement {
  useTabBridge();
  useWindowStateBridge();
  useSettingsBridge();

  const settings = useSettingsStore((s) => s.settings);
  useTheme(settings?.appearance.theme ?? 'system');

  const activeTab = useActiveTab();
  const isNewTab = activeTab?.url === 'about:blank';

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
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

  // M6 + M12: ViewManager suppression with three sources OR'd together.
  // SettingsDrawer / AddressSuggestions / NewTab all need the WebContentsView
  // hidden so the renderer-layer overlay can paint above. A single useEffect
  // computes the union and pushes it; the individual sources don't fight.
  const suppressed = settingsOpen || suggestionsOpen || isNewTab;
  useEffect(() => {
    window.sidebrowser.setViewSuppressed(suppressed);
  }, [suppressed]);

  // Spec §15: dispatch renderer-bound shortcut actions from the hidden
  // Application Menu. Same pattern as before — the address-bar focus action
  // calls `.focus()` which will trigger TopBar's onFocus and open the dropdown
  // automatically (Q2 option B).
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
          onSuggestionsOpenChange={setSuggestionsOpen}
        />
        <TabDrawer open={drawerOpen} onSelect={closeDrawer} />
      </div>
      <div className="relative flex-1">
        {isNewTab && <NewTab />}
        <SettingsDrawer open={settingsOpen} onClose={closeSettings} />
      </div>
    </div>
  );
}
