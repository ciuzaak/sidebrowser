/**
 * HistoryStore — main 进程的浏览历史持久化层（M12）。
 *
 * 设计参照 settings-store.ts：
 *  - Backend 接口可注入，单测里用 fake；真实 backend 包 electron-store。
 *  - 构造时同步 load + sanitize，下游能立即读。
 *  - 写操作 1000ms debounce 后落盘；flush() 立即写（quit 前调）。
 *  - LRU 上限 500 条；超出删 lastVisitedAt 最小的一条。
 *  - onChanged 监听器 16ms 节流：连续 page-title-updated / page-favicon-updated
 *    在同一 frame 内合并为一次广播，避免 IPC 风暴。
 */

import { createRequire } from 'node:module';
import type { HistoryEntry } from '@shared/types';

const SAFE_SCHEME = /^https?:/i;
const CAPACITY = 500;
const DEBOUNCE_MS = 1000;
const NOTIFY_THROTTLE_MS = 16;

export interface HistoryStoreBackend {
  get(): { entries: HistoryEntry[] } | undefined;
  set(value: { entries: HistoryEntry[] }): void;
}

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

/**
 * Validate a raw blob from the backend. Drops entries with non-string url,
 * illegal scheme, missing fields, or visitCount < 1. Exported for unit testing.
 */
export function sanitizePersistedHistory(raw: unknown): HistoryEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { entries?: unknown };
  if (!Array.isArray(obj.entries)) return [];

  const cleaned: HistoryEntry[] = [];
  for (const e of obj.entries) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Partial<HistoryEntry>;
    if (typeof x.url !== 'string' || !SAFE_SCHEME.test(x.url)) continue;
    if (typeof x.title !== 'string') continue;
    if (x.favicon !== null && typeof x.favicon !== 'string') continue;
    if (typeof x.firstVisitedAt !== 'number' || typeof x.lastVisitedAt !== 'number') continue;
    if (typeof x.visitCount !== 'number' || x.visitCount < 1) continue;
    cleaned.push({
      url: x.url,
      title: x.title,
      favicon: x.favicon,
      firstVisitedAt: x.firstVisitedAt,
      lastVisitedAt: x.lastVisitedAt,
      visitCount: x.visitCount,
    });
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// HistoryStore
// ---------------------------------------------------------------------------

export class HistoryStore {
  private readonly entries = new Map<string, HistoryEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly backend: HistoryStoreBackend;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(backend: HistoryStoreBackend) {
    this.backend = backend;
    for (const e of sanitizePersistedHistory(backend.get())) {
      this.entries.set(e.url, e);
    }
  }

  /** 插入或更新；返回 true 表示是新插入（recorder 据此决定能否 revoke）。 */
  upsert(url: string, now: number): boolean {
    const existing = this.entries.get(url);
    if (existing) {
      existing.visitCount += 1;
      existing.lastVisitedAt = now;
      this.markDirty();
      return false;
    }
    this.entries.set(url, {
      url,
      title: '',
      favicon: null,
      firstVisitedAt: now,
      lastVisitedAt: now,
      visitCount: 1,
    });
    this.evictIfOverCap();
    this.markDirty();
    return true;
  }

  patchTitle(url: string, title: string): void {
    if (title.trim() === '') return;
    const e = this.entries.get(url);
    if (!e) return;
    if (e.title === title) return;
    e.title = title;
    this.markDirty();
  }

  patchFavicon(url: string, favicon: string | null): void {
    const e = this.entries.get(url);
    if (!e) return;
    if (e.favicon === favicon) return;
    e.favicon = favicon;
    this.markDirty();
  }

  remove(url: string): void {
    if (!this.entries.delete(url)) return;
    this.markDirty();
  }

  /** 最近 N 条，按 lastVisitedAt 倒序。 */
  recent(limit: number): HistoryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  /** 全量快照（autocomplete 用；规模 ≤500，每次浅复制 ok）。 */
  all(): HistoryEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  onChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** quit 前调；立即落盘并清掉 debounce 计时器。 */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.commitToBackend();
  }

  /**
   * E2E test helper. Replaces all entries wholesale + commits to backend
   * synchronously + schedules a notify so subscribers refresh. NOT for
   * production use — production paths go through upsert/patch which preserve
   * LRU + dedup invariants.
   */
  seed(entries: HistoryEntry[]): void {
    this.entries.clear();
    for (const e of entries) this.entries.set(e.url, { ...e });
    this.commitToBackend();
    this.scheduleNotify();
  }

  // ---------- private ----------

  private markDirty(): void {
    this.scheduleSave();
    this.scheduleNotify();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.commitToBackend();
    }, DEBOUNCE_MS);
  }

  private commitToBackend(): void {
    try {
      this.backend.set({ entries: [...this.entries.values()] });
    } catch (err) {
      console.error('[sidebrowser] history persist failed:', err);
    }
  }

  private scheduleNotify(): void {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const l of this.listeners) {
        try { l(); } catch (err) { console.error('[sidebrowser] history listener threw:', err); }
      }
    }, NOTIFY_THROTTLE_MS);
  }

  private evictIfOverCap(): void {
    if (this.entries.size <= CAPACITY) return;
    let oldestUrl: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [url, e] of this.entries) {
      if (e.lastVisitedAt < oldestTs) {
        oldestTs = e.lastVisitedAt;
        oldestUrl = url;
      }
    }
    if (oldestUrl !== null) this.entries.delete(oldestUrl);
  }
}

// ---------------------------------------------------------------------------
// Electron backend factory
// ---------------------------------------------------------------------------

interface ElectronStoreInstance {
  get(key: 'history'): { entries: HistoryEntry[] } | undefined;
  set(key: 'history', value: { entries: HistoryEntry[] }): void;
}

/**
 * Real backend — wraps `electron-store` under name `'sidebrowser-history'`
 * and key `'history'`. Mirrors the lazy-require pattern in
 * `settings-store.createElectronBackend` so this module stays Node-only-importable.
 *
 * Falls back to an in-memory backend if construction throws (corrupt JSON
 * before electron-store's clearInvalidConfig kicks in, FS permission errors,
 * etc.). The next successful save will overwrite a recovered file.
 */
export function createElectronHistoryBackend(): HistoryStoreBackend {
  const requireCjs = createRequire(import.meta.url);
  let store: ElectronStoreInstance | null = null;
  try {
    const StoreModule = requireCjs('electron-store') as
      | { default: new (opts?: unknown) => ElectronStoreInstance }
      | (new (opts?: unknown) => ElectronStoreInstance);
    const StoreCtor = typeof StoreModule === 'function' ? StoreModule : StoreModule.default;
    store = new StoreCtor({ name: 'sidebrowser-history' }) as ElectronStoreInstance;
  } catch (err) {
    console.error('[sidebrowser] history-store construction failed; in-memory fallback:', err);
  }
  if (store === null) {
    let memory: { entries: HistoryEntry[] } | undefined;
    return {
      get: () => memory,
      set: (v) => { memory = v; },
    };
  }
  return {
    get: () => store!.get('history'),
    set: (v) => { store!.set('history', v); },
  };
}
