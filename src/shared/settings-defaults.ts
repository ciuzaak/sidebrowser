import type { Settings, SearchEngine } from './types';

/**
 * iOS Safari UA. Kept in shared so both main (at DEFAULTS construction) and
 * renderer (for reset-to-default UI) can reference it without crossing the
 * main/renderer import boundary.
 */
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

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

export const BUILTIN_SEARCH_ENGINE_IDS: ReadonlySet<string> = new Set(
  BUILTIN_SEARCH_ENGINES.map((e) => e.id),
);

export const DEFAULTS: Settings = {
  window: { width: 393, height: 852, preset: 'iphone14pro', edgeThresholdPx: 8 },
  mouseLeave: { delayMs: 100 },
  dim: {
    effect: 'blur',
    blurPx: 8,
    darkBrightness: 0.3,
    lightBrightness: 1.5,
    transitionMs: 150,
  },
  edgeDock: { enabled: true, animationMs: 200, triggerStripPx: 3 },
  lifecycle: { restoreTabsOnLaunch: true },
  browsing: { defaultIsMobile: true, mobileUserAgent: MOBILE_UA },
  appearance: { theme: 'system' },
  search: {
    engines: [...BUILTIN_SEARCH_ENGINES],
    activeId: 'google',
  },
};
