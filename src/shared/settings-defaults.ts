import type { Settings, SearchEngine } from './types';

/**
 * Default mobile UA — Android Chrome.
 *
 * An iOS Safari UA painted over a Chromium engine produces an *impossible*
 * device fingerprint: real Safari has no `navigator.userAgentData` and never
 * sends `Sec-CH-UA` headers, yet our Chromium engine leaks both (plus
 * `window.chrome`, `navigator.vendor = "Google Inc."`). Cloudflare's bot
 * detection cross-checks these and rejects the contradiction → mobile-mode
 * challenges loop forever. Android Chrome matches the actual Blink engine, so
 * the JS + Client-Hints signals stay internally consistent and Cloudflare
 * passes. The Chrome major version tracks the bundled Chromium (Electron 41 →
 * Chromium 146); revisit on Electron upgrades to avoid a UA/engine skew.
 *
 * Kept in shared so both main (at DEFAULTS construction) and renderer (for
 * reset-to-default UI) can reference it without crossing the main/renderer
 * import boundary.
 */
export const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36';

/**
 * 内置搜索引擎表（spec §3.2）。顺序即 SettingsDrawer 列表显示顺序。
 * Google 排第一，因为是默认 active engine。`as const` 保证 readonly + 字符串字面量
 * 类型推断；构造 DEFAULTS 时浅拷贝成可变数组以匹配 `SearchEngine[]` 签名。
 */
export const BUILTIN_SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: 'google',     name: 'Google',     urlTemplate: 'https://www.google.com/search?q={query}', builtin: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q={query}',       builtin: true },
  { id: 'bing',       name: 'Bing',       urlTemplate: 'https://www.bing.com/search?q={query}',   builtin: true },
  { id: 'baidu',      name: '百度',        urlTemplate: 'https://www.baidu.com/s?wd={query}',      builtin: true },
] as const;

/** M16: allowed values for `lifecycle.discardAfterMin` (0 = never unload). */
export const DISCARD_AFTER_OPTIONS: readonly number[] = [0, 15, 30, 60];

export const BUILTIN_SEARCH_ENGINE_IDS: ReadonlySet<string> = new Set(
  BUILTIN_SEARCH_ENGINES.map((e) => e.id),
);

export const DEFAULTS: Settings = {
  window: { width: 393, height: 852, preset: 'iphone14pro', edgeThresholdPx: 8, alwaysOnTop: true },
  mouseLeave: { delayMs: 100 },
  dim: {
    effect: 'blur',
    blurPx: 8,
    darkBrightness: 0.3,
    // M13: lightBrightness now means white-overlay opacity in [0, 1]
    // (previously was a filter brightness multiplier in [1, 3]).
    lightBrightness: 0.5,
    transitionMs: 150,
  },
  edgeDock: { enabled: true, animationMs: 200, triggerStripPx: 3 },
  lifecycle: { restoreTabsOnLaunch: true, discardAfterMin: 30 },
  browsing: { defaultIsMobile: true, mobileUserAgent: MOBILE_UA, muteWhenHidden: true },
  appearance: { theme: 'system' },
  search: {
    engines: [...BUILTIN_SEARCH_ENGINES],
    activeId: 'google',
  },
};
