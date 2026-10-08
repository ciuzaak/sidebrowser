import type { ReactElement } from 'react';
import { Minus, X } from 'lucide-react';

/**
 * M17: self-drawn caption buttons (replaces the Windows-native
 * titleBarOverlay). Minimize + Close only — a side panel has no use for
 * Maximize (the BrowserWindow is `maximizable: false`).
 */
export function WindowControls(): ReactElement {
  const base =
    'flex h-full w-8 items-center justify-center text-[var(--fg)] transition-colors duration-100 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]';
  return (
    <div className="app-no-drag flex h-9 shrink-0 self-stretch">
      <button
        type="button"
        aria-label="Minimize"
        data-testid="window-minimize"
        onClick={() => window.sidebrowser.minimizeWindow()}
        className={base + ' hover:bg-[var(--accent-tint)]'}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        aria-label="Close"
        data-testid="window-close"
        onClick={() => window.sidebrowser.closeWindow()}
        className={base + ' hover:bg-[var(--danger)] hover:text-[var(--danger-fg)]'}
      >
        <X size={14} />
      </button>
    </div>
  );
}
