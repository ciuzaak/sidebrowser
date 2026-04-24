import { app } from 'electron';

/** iOS Safari UA — re-exported from @shared/settings-defaults for back-compat. */
export { MOBILE_UA } from '@shared/settings-defaults';

/** Electron's default desktop UA. Captured lazily because app must be ready. */
export function desktopUa(): string {
  return app.userAgentFallback;
}
