import { app } from 'electron';

/** iOS Safari UA — best mobile-site compatibility per spec §5.4. */
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

/** Electron's default desktop UA. Captured lazily because app must be ready. */
export function desktopUa(): string {
  return app.userAgentFallback;
}
