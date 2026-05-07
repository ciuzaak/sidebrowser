import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Loader2, Layers, Smartphone, Monitor, Settings } from 'lucide-react';
import { useActiveTab } from '../store/tab-store';
import { useWindowStateStore } from '../store/window-state-store';
import { useSettingsStore } from '../store/settings-store';
import { normalizeUrlInput } from '@shared/url';
import { AddressSuggestions, type AddressSuggestionsHandle } from './AddressSuggestions';

interface TopBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Called whenever the dropdown's open state changes; App lifts this for view-suppression. */
  onSuggestionsOpenChange: (open: boolean) => void;
}

export function TopBar({
  drawerOpen,
  onToggleDrawer,
  settingsOpen,
  onToggleSettings,
  onSuggestionsOpenChange,
}: TopBarProps): ReactElement {
  const tab = useActiveTab();
  const hidden = useWindowStateStore((s) => s.hidden);
  const settings = useSettingsStore((s) => s.settings);
  const [draft, setDraft] = useState<string>('');
  const [syncedUrl, setSyncedUrl] = useState<string>(tab?.url ?? '');
  const [focused, setFocused] = useState<boolean>(false);
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
    } else if (e.key === 'Tab') {
      // Tab leaves the input; the input's onBlur will close the dropdown.
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
    <div className={`flex w-full items-center gap-1 border-b border-[var(--chrome-border)] bg-[var(--chrome-bg)] px-2 py-1.5 transition-opacity duration-200 ${hidden ? 'opacity-30' : 'opacity-100'}`}>
      <IconButton
        ariaLabel="Toggle tabs"
        testId="topbar-tabs-toggle"
        active={drawerOpen}
        onClick={onToggleDrawer}
      >
        <Layers size={16} />
      </IconButton>
      <IconButton
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

      <form onSubmit={submit} className="relative flex-1">
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
          className="w-full rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] placeholder-[var(--chrome-muted)] outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
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

function IconButton({
  children,
  ariaLabel,
  testId,
  disabled,
  active,
  onClick,
}: {
  children: ReactElement;
  ariaLabel: string;
  testId?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={
        'rounded p-1 text-[var(--chrome-fg)] hover:bg-[var(--chrome-hover)] disabled:cursor-not-allowed disabled:opacity-40 ' +
        (active ? 'bg-[var(--chrome-hover)] text-sky-400' : '')
      }
    >
      {children}
    </button>
  );
}
