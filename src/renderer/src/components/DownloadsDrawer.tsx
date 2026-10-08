import { useEffect, useRef, type ReactElement, type RefObject } from 'react';
import { File, FolderOpen, X } from 'lucide-react';
import type { DownloadInfo } from '@shared/types';
import { downloadPercent, formatBytes } from '../lib/format-bytes';

interface Props {
  open: boolean;
  downloads: DownloadInfo[];
  /** Mousedown outside the drawer and outside its toggle. */
  onOutsideClose: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
}

function statusLine(d: DownloadInfo): string {
  switch (d.state) {
    case 'progressing': {
      const pct = downloadPercent(d.receivedBytes, d.totalBytes);
      return pct === null
        ? formatBytes(d.receivedBytes)
        : `${pct}% · ${formatBytes(d.receivedBytes)} of ${formatBytes(d.totalBytes)}`;
    }
    case 'completed':
      return formatBytes(d.receivedBytes);
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Failed';
  }
}

/**
 * M16 Downloads drawer — sits in the top overlay stack like the TabDrawer.
 * Files go straight to the Downloads folder; this lists the session's items
 * with progress and open / show-in-folder / cancel actions.
 */
export function DownloadsDrawer({ open, downloads, onOutsideClose, toggleRef }: Props): ReactElement | null {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (target === null) return;
      if (ref.current?.contains(target)) return;
      if (toggleRef.current?.contains(target)) return;
      onOutsideClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onOutsideClose, toggleRef]);

  if (!open) return null;
  const hasFinished = downloads.some((d) => d.state !== 'progressing');
  const action =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-faint)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]';

  return (
    <div
      ref={ref}
      data-testid="downloads-drawer"
      className="flex max-h-[50vh] flex-col overflow-y-auto border-b border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-elevated)]"
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">Downloads</span>
        {hasFinished && (
          <button
            type="button"
            data-testid="downloads-clear"
            onClick={() => window.sidebrowser.downloadsClear()}
            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--accent-tint)] hover:text-[var(--fg)]"
          >
            Clear
          </button>
        )}
      </div>
      {downloads.length === 0 ? (
        <div className="px-3 pb-3 text-sm text-[var(--fg-muted)]">No downloads yet.</div>
      ) : (
        <ul className="pb-1">
          {downloads.map((d) => {
            const pct = downloadPercent(d.receivedBytes, d.totalBytes);
            return (
              <li
                key={d.id}
                data-testid="download-item"
                data-state={d.state}
                className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--accent-tint)]"
              >
                <File size={16} className="shrink-0 text-[var(--fg-muted)]" aria-hidden />
                <button
                  type="button"
                  disabled={d.state !== 'completed'}
                  onClick={() => window.sidebrowser.downloadsOpen(d.id)}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                  title={d.path}
                >
                  <div
                    className={`truncate text-sm ${d.state === 'cancelled' || d.state === 'interrupted' ? 'text-[var(--fg-muted)] line-through' : 'text-[var(--fg)]'}`}
                  >
                    {d.filename}
                  </div>
                  <div className="truncate text-[11px] text-[var(--fg-muted)]" data-testid="download-status">
                    {statusLine(d)}
                  </div>
                  {d.state === 'progressing' && (
                    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                      <div
                        className="h-full bg-[var(--accent)] transition-[width] duration-200"
                        style={{ width: `${pct ?? 30}%` }}
                      />
                    </div>
                  )}
                </button>
                {d.state === 'progressing' ? (
                  <button type="button" aria-label="Cancel download" onClick={() => window.sidebrowser.downloadsCancel(d.id)} className={action}>
                    <X size={14} />
                  </button>
                ) : (
                  <button type="button" aria-label="Show in folder" data-testid="download-show" onClick={() => window.sidebrowser.downloadsShowInFolder(d.id)} className={action}>
                    <FolderOpen size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
