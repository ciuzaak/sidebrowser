import { useEffect, useState, type ReactElement, type MouseEvent } from 'react';
import { Globe, X } from 'lucide-react';
import type { HistoryEntry } from '@shared/types';
import { useActiveTab } from '../store/tab-store';
import { Favicon } from './Favicon';

const NEWTAB_RECENT_LIMIT = 12;

export function NewTab(): ReactElement {
  const tab = useActiveTab();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void window.sidebrowser
        .historyRecent(NEWTAB_RECENT_LIMIT)
        .then((es) => { if (!cancelled) setEntries(es); })
        .catch((err: unknown) => { console.error('[sidebrowser] NewTab historyRecent failed', err); });
    };
    load();
    const off = window.sidebrowser.onHistoryChanged(load);
    return () => { cancelled = true; off(); };
  }, []);

  const navigate = (url: string): void => {
    if (!tab) return;
    void window.sidebrowser.navigate(tab.id, url);
  };

  const remove = (e: MouseEvent, url: string): void => {
    e.stopPropagation();
    e.preventDefault();
    window.sidebrowser.historyRemove(url);
    // Optimistic local update — onHistoryChanged broadcast will reconcile shortly.
    setEntries((prev) => prev.filter((entry) => entry.url !== url));
  };

  return (
    <div
      className="absolute inset-0 flex flex-col items-center bg-[var(--chrome-bg)] text-[var(--chrome-fg)] overflow-y-auto"
      data-testid="newtab"
    >
      <Globe size={64} aria-hidden="true" className="mt-12 mb-8 text-[var(--chrome-muted)]" />
      {entries.length === 0 ? (
        <div className="text-sm text-[var(--chrome-muted)]" data-testid="newtab-empty">
          No recent pages yet
        </div>
      ) : (
        <ul className="w-full max-w-md px-4 space-y-1" data-testid="newtab-list">
          {entries.map((e) => (
            <li
              key={e.url}
              className="group flex items-center gap-2 rounded p-2 hover:bg-[var(--chrome-hover)] cursor-pointer"
              onMouseDown={(ev) => { ev.preventDefault(); navigate(e.url); }}
              data-testid="newtab-item"
            >
              <Favicon src={e.favicon} />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{e.title || e.url}</div>
                <div className="text-xs text-[var(--chrome-muted)] truncate">{e.url}</div>
              </div>
              <button
                type="button"
                aria-label="Remove from history"
                onMouseDown={(ev) => remove(ev, e.url)}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-[var(--chrome-muted)] hover:text-[var(--chrome-fg)] p-1"
                data-testid="newtab-remove"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
