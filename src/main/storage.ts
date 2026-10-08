/**
 * Settings → Storage (M16): disk usage of the browsing partition and the two
 * cleanup actions. Measured on the owner's profile (2026-10-08): 1.14 GB —
 * Service Worker CacheStorage 376 MB (never auto-evicted; x.com alone
 * 334 MB), HTTP cache 361 MB and Code Cache 363 MB (both self-capped).
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from 'electron';
import type { StorageUsage } from '@shared/types';

/** Total size in bytes of every file under `dir` (0 when missing). */
export async function directorySize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      total += await directorySize(p);
    } else if (e.isFile()) {
      try {
        total += (await stat(p)).size;
      } catch {
        // File vanished mid-walk (cache churn) — ignore.
      }
    }
  }
  return total;
}

export async function measureStorage(partitionPath: string): Promise<StorageUsage> {
  const [total, httpCache, codeCache, serviceWorker] = await Promise.all([
    directorySize(partitionPath),
    directorySize(join(partitionPath, 'Cache')),
    directorySize(join(partitionPath, 'Code Cache')),
    directorySize(join(partitionPath, 'Service Worker')),
  ]);
  return {
    httpCache,
    codeCache,
    serviceWorker,
    other: Math.max(0, total - httpCache - codeCache - serviceWorker),
    total,
  };
}

/** Caches only — cookies, localStorage and IndexedDB stay (users stay signed in). */
export async function clearCaches(session: Session): Promise<void> {
  await session.clearCache();
  await session.clearCodeCaches({});
  await session.clearStorageData({ storages: ['cachestorage', 'serviceworkers', 'shadercache'] });
}

/** Everything: caches plus cookies and all site storage (signs out of every site). */
export async function clearAllSiteData(session: Session): Promise<void> {
  await clearCaches(session);
  await session.clearStorageData();
  await session.clearAuthCache();
}
