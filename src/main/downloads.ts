/**
 * DownloadsManager (M16). Saves every download straight into the Downloads
 * folder under a unique name (no Save dialog — it would open behind our
 * always-on-top window) and keeps a session-lifetime list for the renderer's
 * Downloads drawer. Shortcut / shell-handler types are refused outright;
 * executables are saved but never launched from the drawer.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import type { DownloadItem, Session } from 'electron';
import type { DownloadInfo } from '@shared/types';
import { classifyDownload, sanitizeFilename, uniqueFilename } from './downloads-naming';

const NOTIFY_THROTTLE_MS = 250;

interface Tracked {
  info: DownloadInfo;
  item: DownloadItem;
}

export interface DownloadsManagerDeps {
  /** Target directory (Downloads; overridable in E2E). */
  getDirectory: () => string;
  /** Fired (throttled) whenever the list or any progress changes. */
  onChanged: () => void;
  /** Electron shell bits, injected for testability. */
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => void;
}

export class DownloadsManager {
  private readonly items = new Map<string, Tracked>();
  private seq = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DownloadsManagerDeps) {}

  install(session: Session): void {
    session.on('will-download', (event, item, webContents) => {
      const kind = classifyDownload(item.getFilename());
      if (kind === 'blocked') {
        // Never write NTLM-leaking shortcut / shell-handler files to disk.
        event.preventDefault();
        const id = `dl-${++this.seq}`;
        this.items.set(id, {
          item,
          info: {
            id,
            filename: sanitizeFilename(item.getFilename()),
            path: '',
            url: item.getURL(),
            state: 'blocked',
            receivedBytes: 0,
            totalBytes: item.getTotalBytes(),
            startedAt: Date.now(),
            webContentsId: webContents?.id ?? null,
            executable: false,
          },
        });
        this.notifyNow();
        return;
      }
      const dir = this.deps.getDirectory();
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // setSavePath below will surface the failure as an interrupted download.
      }
      const reserved = new Set(
        [...this.items.values()].filter((t) => t.info.state === 'progressing').map((t) => t.info.path),
      );
      const path = uniqueFilename(dir, item.getFilename(), (p) => reserved.has(p) || existsSync(p));
      item.setSavePath(path);

      const id = `dl-${++this.seq}`;
      const info: DownloadInfo = {
        id,
        filename: basename(path),
        path,
        url: item.getURL(),
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        startedAt: Date.now(),
        webContentsId: webContents?.id ?? null,
        executable: kind === 'executable',
      };
      this.items.set(id, { info, item });

      item.on('updated', (_e, state) => {
        info.receivedBytes = item.getReceivedBytes();
        info.totalBytes = item.getTotalBytes();
        // Chromium may auto-resume an interrupted download — follow it back.
        info.state = state === 'interrupted' ? 'interrupted' : 'progressing';
        this.scheduleNotify();
      });
      item.once('done', (_e, state) => {
        info.receivedBytes = item.getReceivedBytes();
        info.state = state;
        this.notifyNow();
      });
      this.notifyNow();
    });
  }

  /** Most recent first. */
  list(): DownloadInfo[] {
    return [...this.items.values()].map((t) => ({ ...t.info })).reverse();
  }

  /** Open a finished, non-executable file with its default app. */
  open(id: string): void {
    const t = this.items.get(id);
    if (t?.info.state === 'completed' && !t.info.executable) void this.deps.openPath(t.info.path);
  }

  showInFolder(id: string): void {
    const t = this.items.get(id);
    if (t && t.info.path !== '') this.deps.showItemInFolder(t.info.path);
  }

  cancel(id: string): void {
    const t = this.items.get(id);
    if (t?.info.state === 'progressing' || t?.info.state === 'interrupted') t.item.cancel();
  }

  /** Remove finished entries (completed / cancelled / interrupted) from the list. */
  clear(): void {
    for (const [id, t] of this.items) {
      if (t.info.state !== 'progressing') this.items.delete(id);
    }
    this.notifyNow();
  }

  /** webContents that started a download still in progress (not to be unloaded). */
  busyWebContentsIds(): Set<number> {
    const ids = new Set<number>();
    for (const t of this.items.values()) {
      if (t.info.state === 'progressing' && t.info.webContentsId !== null) ids.add(t.info.webContentsId);
    }
    return ids;
  }

  private scheduleNotify(): void {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.deps.onChanged();
    }, NOTIFY_THROTTLE_MS);
  }

  private notifyNow(): void {
    if (this.notifyTimer !== null) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.deps.onChanged();
  }
}
