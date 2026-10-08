/**
 * Site permission policy (M16). Electron grants every permission request when
 * no handler is installed — notifications would pop Windows toasts (anti-
 * stealth) and geolocation / camera / mic would be granted silently. We deny
 * everything except a small allowlist of harmless permissions. No prompt UI.
 *
 * Pure module (the Electron wiring lives in `installPermissionPolicy`).
 */
import type { Session } from 'electron';

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  // navigator.clipboard.writeText — copy buttons on most sites.
  'clipboard-sanitized-write',
  // Element.requestFullscreen — rendered in-window (see view-manager).
  'fullscreen',
  // Games / canvas apps.
  'pointerLock',
  // Storage Access API — embedded sign-in iframes (Google, Disqus, …).
  'storage-access',
  'top-level-storage-access',
]);

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/** Install the request + check handlers on the shared browsing session. */
export function installPermissionPolicy(session: Session): void {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isPermissionAllowed(permission));
  });
  session.setPermissionCheckHandler((_wc, permission) => isPermissionAllowed(permission));
}
