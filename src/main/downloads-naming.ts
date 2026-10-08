import { join, extname } from 'node:path';

/** Characters Windows forbids in file names, plus control characters. */
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\x00-\x1f]/g;

/** Make a download's suggested file name safe for the local file system. */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(INVALID, '_').replace(/[. ]+$/, '').trim();
  return cleaned === '' ? 'download' : cleaned.slice(0, 200);
}

/**
 * Windows shortcut / shell-handler types. Merely landing in a folder that
 * Explorer then lists (e.g. via "Show in folder") can make Windows fetch an
 * attacker-controlled UNC path and leak NTLM credentials — never saved.
 */
const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.scf', '.url', '.lnk', '.library-ms', '.search-ms', '.searchconnector-ms',
  '.settingcontent-ms', '.appref-ms',
]);

/** Executables / scripts: saved, but never launched from the drawer. */
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle', '.bat', '.cmd', '.com', '.scr',
  '.pif', '.cpl', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.jar',
  '.reg', '.msc', '.application', '.gadget', '.inf', '.dll', '.sys',
]);

export type DownloadKind = 'blocked' | 'executable' | 'normal';

/** M16: classify a download by its (sanitized) file name. */
export function classifyDownload(name: string): DownloadKind {
  const ext = extname(sanitizeFilename(name)).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) return 'blocked';
  if (EXECUTABLE_EXTENSIONS.has(ext)) return 'executable';
  return 'normal';
}

/**
 * First free path in `dir` for `name`: `name.ext`, `name (1).ext`, `name (2).ext`, …
 * `exists` is injected so the function stays pure/testable.
 */
export function uniqueFilename(
  dir: string,
  name: string,
  exists: (path: string) => boolean,
): string {
  const safe = sanitizeFilename(name);
  const ext = extname(safe);
  const base = ext ? safe.slice(0, -ext.length) : safe;
  let candidate = join(dir, safe);
  for (let n = 1; exists(candidate) && n < 10_000; n++) {
    candidate = join(dir, `${base} (${n})${ext}`);
  }
  return candidate;
}
