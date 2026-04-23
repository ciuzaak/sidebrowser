import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Loader2 } from 'lucide-react';
import { useTabStore } from '../store/tab-store';
import { normalizeUrlInput } from '@shared/url';

export function TopBar(): ReactElement {
  const tab = useTabStore((s) => s.tab);
  const [draft, setDraft] = useState<string>('');

  // Sync the address bar when navigation happens from outside the input (back/forward/redirect).
  useEffect(() => {
    setDraft(tab.url === 'about:blank' ? '' : tab.url);
  }, [tab.url]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const url = normalizeUrlInput(draft);
    void window.sidebrowser.navigate(url);
  };

  return (
    <div className="flex w-full items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2 py-1.5">
      <IconButton
        ariaLabel="Back"
        disabled={!tab.canGoBack}
        onClick={() => void window.sidebrowser.goBack()}
      >
        <ArrowLeft size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Forward"
        disabled={!tab.canGoForward}
        onClick={() => void window.sidebrowser.goForward()}
      >
        <ArrowRight size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Reload"
        onClick={() => void window.sidebrowser.reload()}
      >
        {tab.isLoading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
      </IconButton>

      <form onSubmit={submit} className="flex-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter URL or search"
          spellCheck={false}
          data-testid="address-bar"
          className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:ring-1 focus:ring-sky-500"
        />
      </form>
    </div>
  );
}

function IconButton({
  children,
  ariaLabel,
  disabled,
  onClick,
}: {
  children: ReactElement;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
