import { useEffect, useState } from 'react';
import type { ThemeChoice } from '@shared/types';

export function resolveTheme(choice: ThemeChoice, systemIsDark: boolean): 'dark' | 'light' {
  if (choice === 'dark') return 'dark';
  if (choice === 'light') return 'light';
  return systemIsDark ? 'dark' : 'light';
}

/**
 * Resolves effective theme from user choice + OS hint, writes to
 * `document.documentElement.dataset.theme`, subscribes to native-theme
 * updates while mounted.
 */
export function useTheme(choice: ThemeChoice): 'dark' | 'light' {
  // null = not yet resolved from OS. Avoids FOUC on dark-OS systems where
  // the initial default of `false` would briefly paint light before the
  // first IPC resolution.
  const [systemIsDark, setSystemIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void window.sidebrowser
      .getNativeTheme()
      .then((v) => setSystemIsDark(v.shouldUseDarkColors));
    unsub = window.sidebrowser.onNativeThemeUpdated((v) => {
      setSystemIsDark(v.shouldUseDarkColors);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // Keep returning a valid ThemeChoice-resolved value even before first OS
  // read — callers that capture the return (currently none) should still see
  // a sensible value. `false` matches the CSS fallback in globals.css
  // (`var(--chrome-bg, #1a1a1a)` ← dark).
  const effective = resolveTheme(choice, systemIsDark ?? false);

  useEffect(() => {
    // Defer first dataset.theme write until OS value has resolved, so we
    // don't clobber the CSS fallback with a premature opposite value.
    if (systemIsDark === null) return;
    document.documentElement.dataset.theme = effective;
  }, [effective, systemIsDark]);

  return effective;
}
