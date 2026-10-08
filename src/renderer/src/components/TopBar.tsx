import { forwardRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Layers,
  Lock,
  Monitor,
  RotateCw,
  Search,
  Settings,
  Smartphone,
  X,
} from 'lucide-react';
import { useActiveTab, useTabsStore } from '../store/tab-store';
import { useWindowStateStore } from '../store/window-state-store';
import {
  PILL_PLACEHOLDER,
  formatTabCount,
  pillLabelFor,
  schemeIconFor,
  type SchemeIcon,
} from '../lib/chrome-labels';
import { WindowControls } from './WindowControls';

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

/**
 * M17 layout: [Tabs+badge] [Settings] [Back] [Forward?] [AddressPill] [Min][Close].
 * Forward renders only when the tab can go forward; Reload/Stop and the
 * mobile/desktop toggle live inside the pill. `data-loading` on the root is
 * the E2E load-completion fence and drives the CSS load bar.
 */
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
  const tabCount = useTabsStore((s) => s.tabOrder.length);
  const hidden = useWindowStateStore((s) => s.hidden);

  const id = tab?.id ?? '';
  const disabled = !tab;
  const url = tab?.url ?? '';
  const label = pillLabelFor(url);
  const isPlaceholder = label === PILL_PLACEHOLDER;
  const loading = tab?.isLoading === true;
  // The startup about:blank load would flash the bar over NewTab; a real
  // navigation away from blank sets the new URL first, so it still shows.
  const showLoadBar = loading && !isPlaceholder;
  const badge = formatTabCount(tabCount);

  return (
    <div
      data-testid="topbar"
      data-loading={loading ? 'true' : 'false'}
      className={
        'app-drag relative flex h-9 w-full items-center gap-1 pl-2 ' +
        'border-b border-[var(--border)] ' +
        `transition-opacity duration-200 ${hidden ? 'opacity-30' : 'opacity-100'}`
      }
      style={{
        background:
          'linear-gradient(180deg, var(--surface-chrome-top) 0%, var(--surface-chrome-bot) 100%)',
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
        {badge !== null && (
          <span
            data-testid="topbar-tab-count"
            className={
              'absolute -right-0.5 -top-0.5 flex h-[13px] min-w-[13px] items-center justify-center ' +
              'rounded-full bg-[var(--accent)] px-[3px] text-[9px] font-semibold leading-none ' +
              'text-[var(--accent-fg)]'
            }
          >
            {badge}
          </span>
        )}
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
      {tab?.canGoForward === true && (
        <IconButton ariaLabel="Forward" onClick={() => id && void window.sidebrowser.goForward(id)}>
          <ArrowRight size={16} />
        </IconButton>
      )}

      <div
        className={
          'app-no-drag ml-0.5 mr-1 flex h-[26px] min-w-0 flex-1 items-center gap-0.5 px-[3px] ' +
          'rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] ' +
          'transition-colors duration-100 hover:border-[var(--accent)] focus-within:border-[var(--accent)] ' +
          (disabled ? 'opacity-50' : '')
        }
      >
        <PillButton
          ariaLabel={tab?.isMobile ? 'Switch to desktop' : 'Switch to mobile'}
          testId="topbar-ua-toggle"
          disabled={disabled}
          active={tab?.isMobile}
          onClick={() => id && void window.sidebrowser.setMobile(id, !tab?.isMobile)}
        >
          {tab?.isMobile ? <Smartphone size={13} /> : <Monitor size={13} />}
        </PillButton>
        <button
          ref={searchPillRef}
          type="button"
          data-testid="search-pill"
          aria-label="Search or enter URL"
          aria-expanded={searchOpen}
          disabled={disabled}
          onClick={onOpenSearch}
          className={
            'flex h-full min-w-0 flex-1 items-center gap-1.5 px-1 text-left text-xs outline-none ' +
            (isPlaceholder ? 'text-[var(--fg-muted)]' : 'text-[var(--fg)]')
          }
        >
          <SchemeGlyph kind={schemeIconFor(url)} />
          <span className="truncate">{label}</span>
        </button>
        <PillButton
          ariaLabel={loading ? 'Stop' : 'Reload'}
          disabled={disabled}
          onClick={() => {
            if (!id) return;
            void (loading ? window.sidebrowser.stop(id) : window.sidebrowser.reload(id));
          }}
        >
          {loading ? <X size={13} /> : <RotateCw size={13} />}
        </PillButton>
      </div>

      <WindowControls />
      <span className="load-bar" data-loading={showLoadBar ? 'true' : 'false'} aria-hidden />
    </div>
  );
}

function SchemeGlyph({ kind }: { kind: SchemeIcon }): ReactElement {
  const cls = 'shrink-0 text-[var(--fg-muted)]';
  if (kind === 'lock') return <Lock size={11} className={cls} aria-hidden />;
  if (kind === 'globe') return <Globe size={11} className={cls} aria-hidden />;
  return <Search size={12} className={cls} aria-hidden />;
}

interface IconButtonProps {
  children: ReactNode;
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
        'app-no-drag relative flex h-[26px] w-[26px] shrink-0 items-center justify-center ' +
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

function PillButton({
  children,
  ariaLabel,
  testId,
  disabled,
  active,
  onClick,
}: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ' +
        'text-[var(--fg-muted)] transition-colors duration-100 ' +
        'hover:bg-[var(--accent-tint)] hover:text-[var(--fg)] ' +
        'disabled:cursor-not-allowed disabled:hover:bg-transparent ' +
        (active ? 'bg-[var(--accent-tint)] text-[var(--accent-text)] ' : '') +
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
      }
    >
      {children}
    </button>
  );
}
