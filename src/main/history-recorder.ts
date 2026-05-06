/**
 * HistoryRecorder — translates ViewManager webContents events to HistoryStore
 * calls + manages the "is this navigation a fresh insert → can a load failure
 * revoke it" decision.
 *
 * Why this is a separate module:
 *  - ViewManager doesn't import HistoryStore directly (keeps the event wiring
 *    layer thin);
 *  - Recording strategy is unit-testable without constructing a WebContents;
 *  - Future filters (blacklist / privacy schemes) only touch this file.
 */

import type { HistoryStore } from './history-store';

const RECORDABLE_SCHEME = /^https?:/i;

interface PendingNavigation {
  url: string;
  wasInsert: boolean;
}

export class HistoryRecorder {
  private readonly store: HistoryStore;
  private readonly pending = new Map<string, PendingNavigation>();

  constructor(store: HistoryStore) { this.store = store; }

  /**
   * Called by ViewManager on webContents `did-navigate`. Filters non-http(s)
   * URLs (about:blank, chrome:, file:, data:, empty). Tracks per-tab
   * "is this a fresh insert" so revokeFailed can decide.
   */
  recordNavigation(tabId: string, url: string): void {
    if (!RECORDABLE_SCHEME.test(url)) {
      this.pending.delete(tabId);
      return;
    }
    const wasInsert = this.store.upsert(url, Date.now());
    this.pending.set(tabId, { url, wasInsert });
  }

  /** Called on `page-title-updated`. Empty / whitespace skipped at store level. */
  patchTitle(url: string, title: string): void {
    this.store.patchTitle(url, title);
  }

  /** Called on `page-favicon-updated` with the chosen favicon (or null). */
  patchFavicon(url: string, favicon: string | null): void {
    this.store.patchFavicon(url, favicon);
  }

  /**
   * Called on top-frame `did-fail-load` (errorCode != -3 ABORTED). Removes
   * the entry only if it was created by the most recent recordNavigation —
   * a previously-existing entry stays because the user has visited that page
   * successfully before.
   */
  revokeFailed(tabId: string): void {
    const pending = this.pending.get(tabId);
    if (!pending) return;
    if (pending.wasInsert) this.store.remove(pending.url);
    this.pending.delete(tabId);
  }

  /** Called on `closeTab` so a stale tabId can't leak into a future revoke. */
  forgetTab(tabId: string): void {
    this.pending.delete(tabId);
  }
}
