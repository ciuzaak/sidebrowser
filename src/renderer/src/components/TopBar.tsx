import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Loader2, Layers, Smartphone, Monitor, Settings } from 'lucide-react';
import { useActiveTab } from '../store/tab-store';
import { useWindowStateStore } from '../store/window-state-store';
import { normalizeUrlInput } from '@shared/url';

interface TopBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

export function TopBar({
  drawerOpen,
  onToggleDrawer,
  settingsOpen,
  onToggleSettings,
}: TopBarProps): ReactElement {
  const tab = useActiveTab();
  const hidden = useWindowStateStore((s) => s.hidden);
  const [draft, setDraft] = useState<string>('');
  const [syncedUrl, setSyncedUrl] = useState<string>(tab?.url ?? '');

  // Sync address bar when the active tab or its url changes externally.
  const currentUrl = tab?.url ?? '';
  if (currentUrl !== syncedUrl) {
    setSyncedUrl(currentUrl);
    setDraft(currentUrl === 'about:blank' ? '' : currentUrl);
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!tab) return;
    const url = normalizeUrlInput(draft);
    void window.sidebrowser.navigate(tab.id, url);
  };

  const id = tab?.id ?? '';
  const disabled = !tab;

  return (
    <div className={`flex w-full items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2 py-1.5 transition-opacity duration-200 ${hidden ? 'opacity-30' : 'opacity-100'}`}>
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

      <form onSubmit={submit} className="flex-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter URL or search"
          spellCheck={false}
          data-testid="address-bar"
          disabled={disabled}
          className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
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
        'rounded p-1 text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 ' +
        (active ? 'bg-neutral-800 text-sky-400' : '')
      }
    >
      {children}
    </button>
  );
}
