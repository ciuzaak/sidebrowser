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
import { useWindowStateStore } from './store/window-state-store';
import { useTheme } from './theme/useTheme';
import { computeChromeDimStyle } from './lib/chrome-dim';

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
  // M13 simplified: any "close drawer" intent (outside-click, tab-wc focus,
  // explicit selection) also ends any active Ctrl+Tab cycle. Ctrl release
  // detection on Windows/Electron is unreliable, so user-driven dismissal
  // is the fallback that always works.
  const closeDrawer = useCallback(() => {
    setUserDrawerOpen(false);
    window.sidebrowser.endCycle();
  }, []);
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
  // auto-reactivation on close) closes the SettingsDrawer. Guard the
  // hydration tick: only close when transitioning between two non-null ids
  // (a real user-initiated switch). null → first-id (snapshot hydration) and
  // first-id → null (transient) both no-op, so settings opened before tabs
  // hydrate stays open. setState-in-effect is unavoidable: we react to a
  // store change owned outside this component to drive a sibling state.
  const activeId = useTabsStore((s) => s.activeId);
  const prevActiveIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    const prev = prevActiveIdRef.current;
    prevActiveIdRef.current = activeId;
    if (prev === null || activeId === null) return;
    if (prev === activeId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (settingsOpen) closeSettings();
  }, [activeId, settingsOpen, closeSettings]);

  // M6 + M12: ViewManager suppression. SettingsDrawer / AddressSuggestions /
  // NewTab render OVER the page area in renderer DOM, so the underlying
  // WebContentsView has to shrink to {0,0,0,0}. TabDrawer lives in the chrome
  // bar (above the page area) — NOT in the suppression set; otherwise the
  // page would go blank while the drawer is open. Outside-click on the page
  // area is handled by the chrome:tab-focused signal below instead.
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
        case 'toggle-settings-drawer':
          toggleSettings();
          return;
      }
    });
  }, [toggleSettings]);

  // M13 hotfix: tab WebContents focus → close all chrome drawers. Page-area
  // clicks can't be detected via DOM events (WebContentsView is in another
  // process), so main signals via IPC. closeDrawer also ends any active
  // Ctrl+Tab cycle (see its definition).
  useEffect(() => {
    return window.sidebrowser.onTabFocused(() => {
      closeDrawer();
      closeSettings();
    });
  }, [closeDrawer, closeSettings]);

  // M13: chrome dim — re-use the existing windowState.dimmed signal driven
  // by EdgeDock. Settings hydrate within a frame; while null, render
  // un-dimmed (avoids a brief flash of stale filter on cold start).
  const dimmed = useWindowStateStore((s) => s.dimmed);
  const { rootStyle, overlayStyle } = settings
    ? computeChromeDimStyle(dimmed, settings.dim)
    : { rootStyle: {}, overlayStyle: null };

  return (
    <div data-testid="chrome-root" className="flex h-full w-full flex-col" style={rootStyle}>
      {overlayStyle && <div data-testid="chrome-dim-overlay" style={overlayStyle} />}
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
