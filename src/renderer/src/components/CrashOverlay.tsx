import type { ReactElement } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import type { Tab } from '@shared/types';

interface Props {
  tab: Tab;
  /** Hung page: hide the overlay (App then shows the page again). */
  onWait: () => void;
}

/**
 * M16: shown over the page area when the active tab's renderer crashed or
 * stopped responding (the native view is suppressed meanwhile). Reload
 * restarts the page; for a hung page "Wait" dismisses the overlay (App stops
 * suppressing the view) until the state changes again.
 */
export function CrashOverlay({ tab, onWait }: Props): ReactElement | null {
  if (tab.crashed === null) return null;

  const hung = tab.crashed === 'unresponsive';
  return (
    <div
      data-testid="crash-overlay"
      className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-3 bg-[var(--surface)] px-6 text-center"
    >
      <TriangleAlert size={32} className="text-[var(--fg-muted)]" aria-hidden />
      <div>
        <h2 className="text-base font-semibold text-[var(--fg)]">
          {hung ? 'This page isn’t responding' : 'This page crashed'}
        </h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {hung ? 'You can wait for it or reload it.' : 'Reload to try again.'}
        </p>
      </div>
      <div className="flex gap-2">
        {hung && (
          <button
            type="button"
            onClick={onWait}
            className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--fg)] hover:bg-[var(--accent-tint)]"
          >
            Wait
          </button>
        )}
        <button
          type="button"
          data-testid="crash-reload"
          onClick={() => void window.sidebrowser.reload(tab.id)}
          className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1 text-sm text-[var(--accent-fg)] hover:opacity-90"
        >
          <RotateCw size={14} aria-hidden />
          Reload
        </button>
      </div>
    </div>
  );
}
