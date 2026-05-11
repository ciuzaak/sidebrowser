import { forwardRef, type ReactElement, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Loader2, Layers, Smartphone, Monitor, Settings, Search } from 'lucide-react';
import { useActiveTab } from '../store/tab-store';
import { useWindowStateStore } from '../store/window-state-store';

/**
 * M14: reserve width on the right of the chrome row so the SearchPill
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
  /** Spotlight-open state lifted to App so view-suppression can react. */
  searchOpen: boolean;
  onOpenSearch: () => void;
  /** M13: ref attached to the tabs toggle button so TabDrawer can ignore mousedown on it. */
  tabsToggleRef: RefObject<HTMLButtonElement | null>;
  /** M13: ref attached to the settings toggle button so SettingsDrawer can ignore mousedown on it. */
  settingsToggleRef: RefObject<HTMLButtonElement | null>;
  /** Ref to the SearchPill so the SearchSpotlight can ignore mousedown on it (avoid reopen-on-close). */
  searchPillRef: RefObject<HTMLButtonElement | null>;
}

export function TopBar({
  drawerOpen,
  onToggleDrawer,
  settingsOpen,
  onToggleSettings,
  searchOpen,
  onOpenSearch,
  tabsToggleRef,
  settingsToggleRef,
  searchPillRef,
}: TopBarProps): ReactElement {
  const tab = useActiveTab();
  const hidden = useWindowStateStore((s) => s.hidden);

  const id = tab?.id ?? '';
  const disabled = !tab;

  // Compact label inside the pill. Empty / about:blank shows a placeholder.
  // For real URLs, show host only (e.g. "apple.com" instead of the full URL)
  // so narrow windows still display something meaningful.
  const pillLabel = ((): string => {
    const url = tab?.url ?? '';
    if (url === '' || url === 'about:blank') return 'Search or enter URL';
    try {
      const u = new URL(url);
      return u.host || url;
    } catch {
      return url;
    }
  })();
  const pillIsPlaceholder = pillLabel === 'Search or enter URL';

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

      <button
        ref={searchPillRef}
        type="button"
        data-testid="search-pill"
        aria-label="Search or enter URL"
        aria-expanded={searchOpen}
        disabled={disabled}
        onClick={onOpenSearch}
        className={
          'app-no-drag flex h-[26px] min-w-0 flex-1 items-center gap-1.5 ' +
          'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] ' +
          'px-2 text-xs text-left transition-colors duration-100 ' +
          'hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 ' +
          'focus-visible:outline-[var(--accent)] disabled:opacity-50 ' +
          (pillIsPlaceholder ? 'text-[var(--fg-muted)] ' : 'text-[var(--fg)] ')
        }
      >
        <Search size={12} className="shrink-0 text-[var(--fg-muted)]" aria-hidden />
        <span className="truncate">{pillLabel}</span>
      </button>
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
