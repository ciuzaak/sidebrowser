import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { StorageUsage } from '@shared/types';
import { formatBytes } from '../lib/format-bytes';

type Action = 'cache' | 'all';

const CONFIRM_WINDOW_MS = 4000;

/**
 * M16 Settings → Storage. Usage breakdown of the browsing partition plus two
 * cleanups: "Clear cache" keeps cookies / site storage (stay signed in);
 * "Clear all site data" needs a second click within 4 s and signs out.
 */
export function StorageSection({
  Section,
}: {
  Section: (props: { title: string; children: ReactNode }) => ReactElement;
}): ReactElement {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setUsage(await window.sidebrowser.storageUsage());
    } catch (err) {
      console.error('[sidebrowser] storageUsage failed', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.sidebrowser
      .storageUsage()
      .then((u) => { if (!cancelled) setUsage(u); })
      .catch((err: unknown) => { console.error('[sidebrowser] storageUsage failed', err); });
    return () => {
      cancelled = true;
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  const run = async (action: Action): Promise<void> => {
    setBusy(action);
    setDone(null);
    try {
      if (action === 'cache') await window.sidebrowser.storageClearCache();
      else await window.sidebrowser.storageClearSiteData();
      setDone(action === 'cache' ? 'Cache cleared' : 'All site data cleared — open tabs reloaded');
    } catch (err) {
      console.error('[sidebrowser] storage clear failed', err);
      setDone('Clearing failed — try again');
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const onClearAll = (): void => {
    if (!confirmAll) {
      setConfirmAll(true);
      confirmTimer.current = window.setTimeout(() => setConfirmAll(false), CONFIRM_WINDOW_MS);
      return;
    }
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    setConfirmAll(false);
    void run('all');
  };

  const row = (label: string, bytes: number | undefined, testId?: string): ReactElement => (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--fg)]">{label}</span>
      <span className="tabular-nums text-xs text-[var(--fg-muted)]" data-testid={testId}>
        {bytes === undefined ? '…' : formatBytes(bytes)}
      </span>
    </div>
  );

  const btn =
    'flex-1 rounded-[var(--radius-md)] border px-2 py-1 text-xs transition-colors duration-100 disabled:opacity-50';

  return (
    <Section title="Storage">
      {row('Site offline storage', usage?.serviceWorker)}
      {row('Page cache', usage?.httpCache)}
      {row('Script cache', usage?.codeCache)}
      {row('Cookies & other site data', usage?.other)}
      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-sm font-medium">
        <span className="text-[var(--fg)]">Total</span>
        <span className="tabular-nums text-xs text-[var(--fg)]" data-testid="settings-storage-total">
          {usage === null ? '…' : formatBytes(usage.total)}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="settings-clear-cache"
          disabled={busy !== null}
          onClick={() => void run('cache')}
          className={`${btn} border-[var(--border)] text-[var(--fg)] hover:bg-[var(--accent-tint)]`}
          title="Keeps cookies and site data — you stay signed in"
        >
          {busy === 'cache' ? 'Clearing…' : 'Clear cache'}
        </button>
        <button
          type="button"
          data-testid="settings-clear-site-data"
          disabled={busy !== null}
          onClick={onClearAll}
          className={`${btn} ${confirmAll ? 'border-[var(--danger)] bg-[var(--danger)] text-[var(--danger-fg)]' : 'border-[var(--border)] text-[var(--danger)] hover:bg-[var(--accent-tint)]'}`}
          title="Also clears cookies — signs you out of every site"
        >
          {busy === 'all' ? 'Clearing…' : confirmAll ? 'Click again to confirm' : 'Clear all site data…'}
        </button>
      </div>
      <p className="text-[11px] text-[var(--fg-muted)]" data-testid="settings-storage-note">
        {done ?? 'Clear cache keeps you signed in. Clear all site data signs you out of every site.'}
      </p>
    </Section>
  );
}
