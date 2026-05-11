/**
 * safe-external.ts — Pure scheme guard for `shell.openExternal` (M13).
 *
 * `shell.openExternal` hands the URL to the OS's default protocol handler,
 * so we must refuse anything page-controlled context-menu params could
 * abuse — `javascript:`, `file:`, custom schemes like `steam:`, malformed
 * URLs. Only `http:` / `https:` are allowed.
 *
 * Kept as a separate pure module so unit tests can cover the matrix without
 * importing Electron.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
