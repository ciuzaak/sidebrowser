import { useEffect, useMemo, useState, type ReactElement, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import type { HistoryEntry } from '@shared/types';
import appIconUrl from '@resources/icon.ico';
import { useActiveTab } from '../store/tab-store';
import { Favicon } from './Favicon';

const NEWTAB_RECENT_LIMIT = 12;

function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18 && hour < 23) return 'Good evening';
  return 'Hello';
}

export function NewTab(): ReactElement {
  const tab = useActiveTab();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  // Computed once at mount — page is short-lived; we don't redraw on tick.
  const greeting = useMemo(() => greetingFor(new Date().getHours()), []);

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

  const clearAll = (): void => {
    window.sidebrowser.historyClear();
    // Optimistic — main will broadcast history:changed which re-loads anyway.
    setEntries([]);
  };

  return (
    <div
      className="absolute inset-0 flex flex-col items-stretch overflow-y-auto bg-[var(--surface)] text-[var(--fg)]"
      data-testid="newtab"
    >
      <div className="flex flex-col items-center px-4 pt-12 pb-6">
        <img
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          className="mb-4 size-14 rounded-[var(--radius-lg)] shadow-[var(--shadow-card)]"
        />
        <h1 className="text-lg font-semibold tracking-tight">{greeting}</h1>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Pick up where you left off, or search above.
        </p>
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
          Recent
        </span>
        {entries.length > 0 && (
          <button
            type="button"
            data-testid="newtab-clear"
            onClick={clearAll}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
          >
            Clear
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div
          className="px-4 py-6 text-center text-sm text-[var(--fg-muted)]"
          data-testid="newtab-empty"
        >
          No recent pages yet.
        </div>
      ) : (
        <ul className="flex flex-col px-2 pb-6" data-testid="newtab-list">
          {entries.map((e) => (
            <li
              key={e.url}
              className="group flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] p-2 hover:bg-[var(--accent-tint)]"
              onMouseDown={(ev) => { ev.preventDefault(); navigate(e.url); }}
              data-testid="newtab-item"
            >
              <Favicon src={e.favicon} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{e.title || e.url}</div>
                <div className="truncate text-xs text-[var(--fg-muted)]">{e.url}</div>
              </div>
              <button
                type="button"
                aria-label="Remove from history"
                onMouseDown={(ev) => remove(ev, e.url)}
                className="rounded-[var(--radius-sm)] p-1 text-[var(--fg-faint)] opacity-0 hover:bg-[var(--accent-tint)] hover:text-[var(--fg)] focus-visible:opacity-100 group-hover:opacity-100"
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
