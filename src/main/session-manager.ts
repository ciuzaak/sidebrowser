import { session } from 'electron';
import type { Session } from 'electron';

/** Name of the Electron session partition that persists cookies/localStorage/IndexedDB to disk. */
export const PERSIST_PARTITION = 'persist:sidebrowser';

/**
 * Returns the singleton persistent session used by every WebContentsView in this app.
 * Must be called after `app.whenReady()`.
 */
export function getPersistentSession(): Session {
  return session.fromPartition(PERSIST_PARTITION);
}
