import { useEffect, useState } from 'react';
import type { DownloadInfo } from '@shared/types';

/**
 * M16: live downloads list (most recent first). Fetches once on mount, then
 * mirrors main's throttled `downloads:changed` broadcasts.
 */
export function useDownloads(): DownloadInfo[] {
  const [list, setList] = useState<DownloadInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.sidebrowser.downloadsList().then((l) => {
      if (!cancelled) setList(l);
    });
    const off = window.sidebrowser.onDownloadsChanged(setList);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return list;
}

/** Aggregate for the TopBar button: count, any in progress, overall percent. */
export function summarizeDownloads(list: readonly DownloadInfo[]): {
  count: number;
  active: boolean;
  progress: number | null;
} {
  const active = list.filter((d) => d.state === 'progressing');
  const total = active.reduce((n, d) => n + d.totalBytes, 0);
  const received = active.reduce((n, d) => n + d.receivedBytes, 0);
  return {
    count: list.length,
    active: active.length > 0,
    progress: active.length > 0 && total > 0 && active.every((d) => d.totalBytes > 0)
      ? Math.min(100, Math.round((received / total) * 100))
      : null,
  };
}
