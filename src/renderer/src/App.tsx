import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { TabDrawer } from './components/TabDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { NewTab } from './components/NewTab';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTabBridge } from './hooks/useTabBridge';
import { useWindowStateBridge } from './hooks/useWindowStateBridge';
import { useSettingsStore } from './store/settings-store';
import { useActiveTab, useTabsStore } from './store/tab-store';
import { useTheme } from './theme/useTheme';

export function App(): ReactElement {
  useTabBridge();
  useWindowStateBridge();
  useSettingsBridge();

  const settings = useSettingsStore((s) => s.settings);
  useTheme(settings?.appearance.theme ?? 'system');

  const activeTab = useActiveTab();
  const isNewTab = activeTab?.url === 'about:blank';

  // M13: drawer is open if the user toggled it OR the Ctrl+Tab cycle is active.
  // Cycle ownership is centralized in main; renderer only mirrors via IPC.
  const cycling = useTabsStore((s) => s.cycling);
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const drawerOpen = userDrawerOpen || cycling;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  // M13: refs for the toggle buttons so the drawers can ignore mousedown on
  // their own toggle (otherwise click-to-close would re-open immediately).
  const tabsToggleRef = useRef<HTMLButtonElement | null>(null);
  const settingsToggleRef = useRef<HTMLButtonElement | null>(null);

  const toggleDrawer = useCallback(() => setUserDrawerOpen((v) => !v), []);
  const closeDrawer = useCallback(() => setUserDrawerOpen(false), []);
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

  // M13: switching to a different tab (drawer click, Ctrl+Tab cycle, main-side
  // auto-reactivation on close) closes the SettingsDrawer. Guard the first
  // hydration tick (null → first id) so an open drawer set before tabs hydrate
  // is not auto-closed.
  const activeId = useTabsStore((s) => s.activeId);
  const prevActiveIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return;
    prevActiveIdRef.current = activeId;
    if (settingsOpen) closeSettings();
  }, [activeId, settingsOpen, closeSettings]);

  // M6 + M12 + M13: ViewManager suppression with four sources OR'd together.
  // SettingsDrawer / AddressSuggestions / NewTab / TabDrawer all need the
  // WebContentsView hidden so the renderer-layer overlay can paint above.
  // M13 added drawer to the source set so outside-click on the page area lands
  // in the renderer DOM instead of being swallowed by the native view.
  const suppressed = settingsOpen || suggestionsOpen || isNewTab || drawerOpen;
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
        case 'toggle-settings-drawer':
          toggleSettings();
          return;
      }
    });
  }, [toggleSettings]);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={chromeRef} className="shrink-0">
        <TopBar
          drawerOpen={drawerOpen}
          onToggleDrawer={toggleDrawer}
          settingsOpen={settingsOpen}
          onToggleSettings={toggleSettings}
          onSuggestionsOpenChange={setSuggestionsOpen}
          tabsToggleRef={tabsToggleRef}
          settingsToggleRef={settingsToggleRef}
        />
        <TabDrawer
          open={drawerOpen}
          onSelect={closeDrawer}
          onOutsideClose={closeDrawer}
          toggleRef={tabsToggleRef}
        />
      </div>
      <div className="relative flex-1">
        {isNewTab && <NewTab />}
        <SettingsDrawer
          open={settingsOpen}
          onClose={closeSettings}
          toggleRef={settingsToggleRef}
        />
      </div>
    </div>
  );
}
