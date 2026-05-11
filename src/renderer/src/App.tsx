import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { TabDrawer } from './components/TabDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { NewTab } from './components/NewTab';
import { SearchSpotlight } from './components/SearchSpotlight';
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
  // M14: Spotlight (replaces the inline AddressSuggestions dropdown).
  const [searchOpen, setSearchOpen] = useState(false);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  // M13: refs for the toggle buttons so the drawers can ignore mousedown on
  // their own toggle (otherwise click-to-close would re-open immediately).
  const tabsToggleRef = useRef<HTMLButtonElement | null>(null);
  const settingsToggleRef = useRef<HTMLButtonElement | null>(null);
  // M14: ref for the SearchPill so the SearchSpotlight can ignore mousedown on it.
  const searchPillRef = useRef<HTMLButtonElement | null>(null);

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
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

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
    // closeSettings / closeSearch are cascading setStates — intentional. We
    // can't merge them into a single setter (different state slices). The
    // rule fires once per offending if-statement; disable below each.
    if (settingsOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      closeSettings();
    }
    if (searchOpen) {
      closeSearch();
    }
  }, [activeId, settingsOpen, searchOpen, closeSettings, closeSearch]);

  // M6 + M12 + M14: ViewManager suppression. SettingsDrawer, NewTab, and the
  // new SearchSpotlight all render OVER the page area in renderer DOM, so the
  // underlying WebContentsView has to shrink to {0,0,0,0}. TabDrawer lives
  // in the chrome bar (above the page area) — NOT in the suppression set;
  // otherwise the page would go blank while the drawer is open.
  const suppressed = settingsOpen || searchOpen || isNewTab;
  useEffect(() => {
    window.sidebrowser.setViewSuppressed(suppressed);
  }, [suppressed]);

  // Spec §15 + M14: dispatch renderer-bound shortcut actions from the hidden
  // Application Menu. focus-address-bar now opens the Spotlight instead of
  // focusing an inline input (which no longer exists).
  useEffect(() => {
    return window.sidebrowser.onShortcut((action) => {
      switch (action) {
        case 'focus-address-bar': {
          openSearch();
          return;
        }
        case 'toggle-settings-drawer':
          toggleSettings();
          return;
      }
    });
  }, [openSearch, toggleSettings]);

  // M13 hotfix: tab WebContents focus → close all chrome drawers. Page-area
  // clicks can't be detected via DOM events (WebContentsView is in another
  // process), so main signals via IPC. closeDrawer also ends any active
  // Ctrl+Tab cycle (see its definition).
  useEffect(() => {
    return window.sidebrowser.onTabFocused(() => {
      closeDrawer();
      closeSettings();
      closeSearch();
    });
  }, [closeDrawer, closeSettings, closeSearch]);

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
          searchOpen={searchOpen}
          onOpenSearch={openSearch}
          tabsToggleRef={tabsToggleRef}
          settingsToggleRef={settingsToggleRef}
          searchPillRef={searchPillRef}
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
        <SearchSpotlight
          open={searchOpen}
          onClose={closeSearch}
          pillRef={searchPillRef}
        />
      </div>
    </div>
  );
}
