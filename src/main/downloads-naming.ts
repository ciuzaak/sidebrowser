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
