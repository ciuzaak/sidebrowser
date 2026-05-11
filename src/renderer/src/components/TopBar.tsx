import { forwardRef, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Loader2, Layers, Smartphone, Monitor, Settings } from 'lucide-react';
import { useActiveTab } from '../store/tab-store';
import { useWindowStateStore } from '../store/window-state-store';
import { useSettingsStore } from '../store/settings-store';
import { normalizeUrlInput } from '@shared/url';
import { AddressSuggestions, type AddressSuggestionsHandle } from './AddressSuggestions';

/**
 * M14: reserve width on the right of the chrome row so the address bar
 * doesn't slide under the Windows-native titleBarOverlay (the min/max/close
 * buttons). The overlay is ~135 px wide on Win10/11; 138 px gives a small
 * margin.
 */
const TITLEBAR_OVERLAY_PX = 138;

interface TopBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Called whenever the dropdown's open state changes; App lifts this for view-suppression. */
  onSuggestionsOpenChange: (open: boolean) => void;
  /** M13: ref attached to the tabs toggle button so TabDrawer can ignore mousedown on it. */
  tabsToggleRef: RefObject<HTMLButtonElement | null>;
  /** M13: ref attached to the settings toggle button so SettingsDrawer can ignore mousedown on it. */
  settingsToggleRef: RefObject<HTMLButtonElement | null>;
}

export function TopBar({
  drawerOpen,
  onToggleDrawer,
  settingsOpen,
  onToggleSettings,
  onSuggestionsOpenChange,
  tabsToggleRef,
  settingsToggleRef,
}: TopBarProps): ReactElement {
  const tab = useActiveTab();
  const hidden = useWindowStateStore((s) => s.hidden);
  const settings = useSettingsStore((s) => s.settings);
  const [draft, setDraft] = useState<string>('');
  const [syncedUrl, setSyncedUrl] = useState<string>(tab?.url ?? '');
  const [focused, setFocused] = useState<boolean>(false);
  const [syncedTabId, setSyncedTabId] = useState<string | null>(tab?.id ?? null);
  const suggestionsRef = useRef<AddressSuggestionsHandle | null>(null);

  // Sync address bar when the active tab or its url changes externally.
  const currentUrl = tab?.url ?? '';
  if (currentUrl !== syncedUrl) {
    setSyncedUrl(currentUrl);
    setDraft(currentUrl === 'about:blank' ? '' : currentUrl);
  }

  const setOpen = (open: boolean): void => {
    setFocused(open);
    onSuggestionsOpenChange(open);
  };

  // M12: when active tab changes, force-close the suggestions dropdown so the
  // lifted suggestionsOpen flag in App.tsx doesn't strand `true` and keep the
  // WebContentsView suppressed after the user navigates the new tab.
  const currentTabId = tab?.id ?? null;
  if (currentTabId !== syncedTabId) {
    setSyncedTabId(currentTabId);
    if (focused) setOpen(false);
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!tab) return;
    const picked = suggestionsRef.current?.currentUrl() ?? null;
    let url: string;
    if (picked !== null) {
      // User picked from the dropdown — bypass search-engine template entirely.
      url = picked;
    } else {
      const search = settings?.search;
      const tpl =
        search?.engines.find((eng) => eng.id === search.activeId)?.urlTemplate ??
        'https://www.google.com/search?q={query}';
      url = normalizeUrlInput(draft, tpl);
    }
    setOpen(false);
    void window.sidebrowser.navigate(tab.id, url);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionsRef.current?.moveDown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionsRef.current?.moveUp();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      // Keep focus + draft; user can keep typing.
    }
  };

  const handlePick = (url: string): void => {
    if (!tab) return;
    setOpen(false);
    void window.sidebrowser.navigate(tab.id, url);
  };

  const id = tab?.id ?? '';
  const disabled = !tab;

  return (
    <div
      className={
        'app-drag flex h-9 w-full items-center gap-1 px-2 ' +
        'border-b border-[var(--border)] ' +
        `transition-opacity duration-200 ${hidden ? 'opacity-30' : 'opacity-100'}`
      }
      style={{
        background:
          'linear-gradient(180deg, var(--surface-chrome-top) 0%, var(--surface-chrome-bot) 100%)',
        paddingRight: TITLEBAR_OVERLAY_PX,
      }}
    >
      <IconButton
        ref={tabsToggleRef}
        ariaLabel="Toggle tabs"
        testId="topbar-tabs-toggle"
        active={drawerOpen}
        onClick={onToggleDrawer}
      >
        <Layers size={16} />
      </IconButton>
      <IconButton
        ref={settingsToggleRef}
        ariaLabel="Open settings"
        testId="topbar-settings-toggle"
        active={settingsOpen}
        onClick={onToggleSettings}
      >
        <Settings size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Back"
        disabled={disabled || !tab?.canGoBack}
        onClick={() => id && void window.sidebrowser.goBack(id)}
      >
        <ArrowLeft size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Forward"
        disabled={disabled || !tab?.canGoForward}
        onClick={() => id && void window.sidebrowser.goForward(id)}
      >
        <ArrowRight size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Reload"
        disabled={disabled}
        onClick={() => id && void window.sidebrowser.reload(id)}
      >
        {tab?.isLoading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
      </IconButton>
      <IconButton
        ariaLabel={tab?.isMobile ? 'Switch to desktop' : 'Switch to mobile'}
        testId="topbar-ua-toggle"
        disabled={disabled}
        active={tab?.isMobile}
        onClick={() => id && void window.sidebrowser.setMobile(id, !tab?.isMobile)}
      >
        {tab?.isMobile ? <Smartphone size={16} /> : <Monitor size={16} />}
      </IconButton>

      <form onSubmit={submit} className="app-no-drag relative flex-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Enter URL or search"
          spellCheck={false}
          data-testid="address-bar"
          disabled={disabled}
          className={
            'app-no-drag h-[26px] w-full rounded-[var(--radius-md)] px-2 text-sm ' +
            'bg-[var(--surface-sunken)] text-[var(--fg)] placeholder-[var(--fg-muted)] ' +
            'border border-[var(--border)] outline-none ' +
            'focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent ' +
            'disabled:opacity-50'
          }
        />
        <AddressSuggestions
          ref={suggestionsRef}
          query={draft}
          open={focused && !disabled}
          onPick={handlePick}
        />
      </form>
    </div>
  );
}

interface IconButtonProps {
  children: ReactElement;
  ariaLabel: string;
  testId?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, ariaLabel, testId, disabled, active, onClick },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={
        'app-no-drag flex h-[26px] w-[26px] items-center justify-center ' +
        'rounded-[var(--radius-sm)] text-[var(--fg)] transition-colors duration-100 ' +
        'hover:bg-[var(--accent-tint)] ' +
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ' +
        (active ? 'bg-[var(--accent-tint)] text-[var(--accent-text)] ' : '') +
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
      }
    >
      {children}
    </button>
  );
});
