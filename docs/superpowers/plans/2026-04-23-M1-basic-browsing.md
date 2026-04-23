# M1：基础浏览 + 持久化登录 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M0 脚手架之上构建一个能浏览网页的**单 tab** Electron 应用：顶部有后退/前进/刷新/URL 地址栏，下方是网页内容区（WebContentsView），所有 Cookies/localStorage 存入 `persist:sidebrowser` 分区——关掉应用、重启后登录态依然在。

**Architecture:** Main 进程新增 SessionManager（封装持久化 session 构造）、ViewManager（管理一个 WebContentsView 及其生命周期/事件/bounds）、IpcRouter（集中注册 tab:* 和 chrome:* 处理器）。Renderer 用 Zustand 镜像 main 的 tab 状态，用 ResizeObserver 把 chrome 高度推给 main 来定位 WebContentsView。M1 是单 tab 架构（无 tab ID），M2 再引入 ID + 多 tab。

**Tech stack delta vs M0:** 新增 `zustand`（状态管理）、`lucide-react`（图标）、`nanoid`（备 M2 用，M1 先装上）。无其他新基础设施。

**Spec references:** `docs/superpowers/specs/2026-04-23-sidebrowser-design.md` §4（架构）、§5.3（ViewManager）、§5.4（SessionManager）、§6（IPC 契约）、§13（M1 里程碑定义）。

**What this plan does NOT build（留给 M2+）：**
- 多 tab / tab 抽屉 UI（M2）
- 手机 UA 切换 / 预设尺寸（M3）
- 鼠标离开变暗 / 贴边隐藏（M4-M5）
- 设置抽屉 UI（M6）
- 键盘快捷键（仅绑定 `Ctrl+R` 刷新作为基础，其余 M2+）

---

## Task 1: 安装 M1 新增依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 runtime deps**

```bash
pnpm add zustand@latest nanoid@latest lucide-react@latest
```

Expected: 三个包进入 `dependencies`。

- [ ] **Step 2: 验证 `pnpm install` 健康**

```bash
pnpm install
```

Expected: `Already up to date`，无报错。

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add zustand, nanoid, lucide-react for M1"
```

---

## Task 2: 扩展 shared/types.ts 定义 Tab 接口

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 替换整个 `src/shared/types.ts` 内容为：**

```ts
// Shared types used by main, preload, and renderer.

/** Active web view state, mirrored between main (source of truth) and renderer (Zustand). */
export interface Tab {
  /** For M1 always the constant "main" (single-tab). M2 switches to nanoid-generated per-tab IDs. */
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Initial empty state used before the first navigation. */
export const INITIAL_TAB: Tab = {
  id: 'main',
  url: 'about:blank',
  title: '',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(shared): add Tab interface and INITIAL_TAB"
```

---

## Task 3: 扩展 IPC 契约（tab:* 和 chrome:*）

**Files:**
- Modify: `src/shared/ipc-contract.ts`
- Modify: `tests/unit/ipc-contract.test.ts`

### Step 1: 先写/扩展失败的测试（TDD）

打开 `tests/unit/ipc-contract.test.ts`，替换整个内容为：

```ts
import { describe, it, expect } from 'vitest';
import { IpcChannels } from '@shared/ipc-contract';

describe('IpcChannels', () => {
  it('exposes appPing as a namespaced string', () => {
    expect(IpcChannels.appPing).toBe('app:ping');
  });

  it('defines tab navigation channels', () => {
    expect(IpcChannels.tabNavigate).toBe('tab:navigate');
    expect(IpcChannels.tabGoBack).toBe('tab:go-back');
    expect(IpcChannels.tabGoForward).toBe('tab:go-forward');
    expect(IpcChannels.tabReload).toBe('tab:reload');
    expect(IpcChannels.tabUpdated).toBe('tab:updated');
  });

  it('defines chrome layout channel', () => {
    expect(IpcChannels.chromeSetHeight).toBe('chrome:set-height');
  });

  it('all channel values follow <domain>:<action> pattern', () => {
    for (const channel of Object.values(IpcChannels)) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });
});
```

### Step 2: 运行测试，确认红

```bash
pnpm test
```

Expected: 5 个测试中有 4 个失败（tabNavigate 等尚未定义）。

### Step 3: 扩展 `src/shared/ipc-contract.ts` 为：

```ts
// Centralized IPC channel names and payload types.
// All main/renderer IPC must go through this module — never use string literals inline.

import type { Tab } from './types';

export const IpcChannels = {
  // Smoke-test channel kept from M0 for the preload API sanity check.
  appPing: 'app:ping',

  // M1: tab navigation (single-tab; no ID arg until M2).
  tabNavigate: 'tab:navigate',
  tabGoBack: 'tab:go-back',
  tabGoForward: 'tab:go-forward',
  tabReload: 'tab:reload',
  /** Main → renderer event. Carries the full Tab (simpler than patches for M1). */
  tabUpdated: 'tab:updated',

  // M1: renderer reports its chrome bar height so main can position the WebContentsView.
  chromeSetHeight: 'chrome:set-height',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export interface IpcContract {
  [IpcChannels.appPing]: {
    request: { message: string };
    response: { reply: string; timestamp: number };
  };
  [IpcChannels.tabNavigate]: {
    request: { url: string };
    response: void;
  };
  [IpcChannels.tabGoBack]: {
    request: void;
    response: void;
  };
  [IpcChannels.tabGoForward]: {
    request: void;
    response: void;
  };
  [IpcChannels.tabReload]: {
    request: void;
    response: void;
  };
  [IpcChannels.tabUpdated]: {
    /** Main broadcasts on navigation / title / loading state changes. */
    request: Tab;
    response: void;
  };
  [IpcChannels.chromeSetHeight]: {
    request: { heightPx: number };
    response: void;
  };
}
```

### Step 4: 跑测试，确认绿

```bash
pnpm test
```

Expected: 5/5 passed。

### Step 5: Commit

```bash
git add src/shared/ipc-contract.ts tests/unit/ipc-contract.test.ts
git commit -m "feat(shared): add tab navigation and chrome layout IPC channels"
```

---

## Task 4: URL 归一化工具函数（纯函数 + TDD）

**Files:**
- Create: `src/shared/url.ts`
- Create: `tests/unit/url.test.ts`

用户在地址栏输入 `google.com` 不带协议也要能访问；输入 `about:blank` / `chrome://...` / `http://...` 保持原样。

### Step 1: 写失败的测试

创建 `tests/unit/url.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { normalizeUrlInput } from '@shared/url';

describe('normalizeUrlInput', () => {
  it('prepends https:// to bare hostnames', () => {
    expect(normalizeUrlInput('google.com')).toBe('https://google.com');
    expect(normalizeUrlInput('example.com/path?x=1')).toBe('https://example.com/path?x=1');
  });

  it('preserves explicit http:// urls', () => {
    expect(normalizeUrlInput('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('preserves explicit https:// urls', () => {
    expect(normalizeUrlInput('https://github.com')).toBe('https://github.com');
  });

  it('preserves about: and chrome: schemes', () => {
    expect(normalizeUrlInput('about:blank')).toBe('about:blank');
    expect(normalizeUrlInput('chrome://settings')).toBe('chrome://settings');
  });

  it('treats search-like strings as DuckDuckGo queries', () => {
    expect(normalizeUrlInput('how to use electron')).toBe(
      'https://duckduckgo.com/?q=how%20to%20use%20electron',
    );
  });

  it('trims whitespace', () => {
    expect(normalizeUrlInput('  google.com  ')).toBe('https://google.com');
  });

  it('returns about:blank for empty or whitespace-only input', () => {
    expect(normalizeUrlInput('')).toBe('about:blank');
    expect(normalizeUrlInput('   ')).toBe('about:blank');
  });
});
```

### Step 2: Run to verify it fails

```bash
pnpm test
```

Expected: tests file missing the module, all 7 tests fail.

### Step 3: Implement `src/shared/url.ts`

```ts
/**
 * Normalize a user-entered address bar string into a loadable URL.
 *
 * Rules:
 * - Empty / whitespace → `about:blank`
 * - Already-qualified scheme (`http`, `https`, `about`, `chrome`, `file`, `data`) → passthrough
 * - Looks like a hostname (has a dot and no whitespace in the token) → prepend `https://`
 * - Otherwise → treat as search query, route to DuckDuckGo
 */
export function normalizeUrlInput(raw: string): string {
  const input = raw.trim();
  if (input === '') return 'about:blank';

  if (/^(https?|about|chrome|file|data):/i.test(input)) {
    return input;
  }

  const firstToken = input.split(/\s+/, 1)[0]!;
  const looksLikeHost = firstToken === input && /\.[a-z]{2,}(?:[:/?#]|$)/i.test(input);
  if (looksLikeHost) {
    return `https://${input}`;
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
}
```

### Step 4: Run tests, verify they pass

```bash
pnpm test
```

Expected: all tests pass (previous 5 + new 7 = 12).

### Step 5: Commit

```bash
git add src/shared/url.ts tests/unit/url.test.ts
git commit -m "feat(shared): add normalizeUrlInput for address bar parsing"
```

---

## Task 5: SessionManager (persist:sidebrowser)

**Files:**
- Create: `src/main/session-manager.ts`

SessionManager 是一个薄封装：启动时获取持久化分区的 session 引用，后续 ViewManager 用它创建 WebContentsView。M1 不做 Cookie 清理或自定义 header，后续里程碑再扩展。

### Step 1: Create `src/main/session-manager.ts`

```ts
import { session } from 'electron';
import type { Session } from 'electron';

/** Name of the Electron session partition that persists cookies/localStorage/IndexedDB to disk. */
export const PERSIST_PARTITION = 'persist:sidebrowser';

/**
 * Returns the singleton persistent session used by every WebContentsView in this app.
 * Must be called after `app.whenReady()`.
 */
export function getPersistentSession(): Session {
  return session.fromPartition(PERSIST_PARTITION);
}
```

### Step 2: Commit

```bash
git add src/main/session-manager.ts
git commit -m "feat(main): add SessionManager with persistent partition"
```

---

## Task 6: ViewManager (single WebContentsView lifecycle)

**Files:**
- Create: `src/main/view-manager.ts`

M1 的 ViewManager 管理**一个** WebContentsView：创建它、挂载到 BrowserWindow、监听 navigation/title/loading 事件并通过回调上报、响应 navigate/goBack/goForward/reload 指令、按 chrome 高度变化调整 bounds。

### Step 1: Create `src/main/view-manager.ts`

```ts
import { WebContentsView, type BrowserWindow } from 'electron';
import { getPersistentSession } from './session-manager';
import type { Tab } from '@shared/types';
import { INITIAL_TAB } from '@shared/types';

type TabListener = (tab: Tab) => void;

/**
 * Single-tab web view controller for M1.
 *
 * Owns exactly one WebContentsView attached to the given BrowserWindow, keeps a
 * mirrored Tab snapshot in memory, and emits changes to any subscribed listener.
 * M2 will generalize this to a map of views keyed by tab ID.
 */
export class ViewManager {
  private readonly view: WebContentsView;
  private readonly window: BrowserWindow;
  private tab: Tab = { ...INITIAL_TAB };
  private chromeHeightPx = 0;
  private listener: TabListener | null = null;

  constructor(window: BrowserWindow) {
    this.window = window;

    this.view = new WebContentsView({
      webPreferences: {
        session: getPersistentSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    window.contentView.addChildView(this.view);
    this.attachWebContentsEvents();

    // Recompute bounds when the window itself resizes.
    window.on('resize', () => this.applyBounds());
    window.once('ready-to-show', () => this.applyBounds());
  }

  /** Subscribe (single listener — renderer broadcasts via main's IPC). */
  onTabChange(listener: TabListener): void {
    this.listener = listener;
    listener(this.snapshot());
  }

  snapshot(): Tab {
    return { ...this.tab };
  }

  setChromeHeight(heightPx: number): void {
    const clamped = Math.max(0, Math.round(heightPx));
    if (clamped === this.chromeHeightPx) return;
    this.chromeHeightPx = clamped;
    this.applyBounds();
  }

  async navigate(url: string): Promise<void> {
    this.update({ url, isLoading: true });
    await this.view.webContents.loadURL(url).catch((err: unknown) => {
      // did-fail-load will also fire; swallow the promise rejection to avoid unhandled rejections.
      console.error('[sidebrowser] loadURL failed:', err);
    });
  }

  goBack(): void {
    if (this.view.webContents.navigationHistory.canGoBack()) {
      this.view.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.view.webContents.navigationHistory.canGoForward()) {
      this.view.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.view.webContents.reload();
  }

  destroy(): void {
    this.window.contentView.removeChildView(this.view);
    // Electron destroys the webContents when the parent window closes; no explicit destroy call needed.
  }

  // ---------- private ----------

  private applyBounds(): void {
    const { width, height } = this.window.getContentBounds();
    this.view.setBounds({
      x: 0,
      y: this.chromeHeightPx,
      width,
      height: Math.max(0, height - this.chromeHeightPx),
    });
  }

  private update(patch: Partial<Tab>): void {
    this.tab = { ...this.tab, ...patch };
    this.listener?.(this.snapshot());
  }

  private attachWebContentsEvents(): void {
    const wc = this.view.webContents;

    wc.on('did-start-loading', () => this.update({ isLoading: true }));
    wc.on('did-stop-loading', () =>
      this.update({
        isLoading: false,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      }),
    );

    wc.on('did-navigate', (_e, url) =>
      this.update({
        url,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      }),
    );
    wc.on('did-navigate-in-page', (_e, url) =>
      this.update({
        url,
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      }),
    );

    wc.on('page-title-updated', (_e, title) => this.update({ title }));

    // Block popups (new windows) in M1; route them into the current view instead.
    wc.setWindowOpenHandler(({ url }) => {
      void this.navigate(url);
      return { action: 'deny' };
    });
  }
}
```

### Step 2: Typecheck

```bash
pnpm typecheck
```

Expected: 0 errors. If TS complains about `WebContentsView`, verify you're on electron ≥ 30 (our 41.3 is fine).

### Step 3: Commit

```bash
git add src/main/view-manager.ts
git commit -m "feat(main): add single-tab ViewManager wrapping WebContentsView"
```

---

## Task 7: IpcRouter — 集中注册 main 侧的 IPC 处理器

**Files:**
- Create: `src/main/ipc-router.ts`

### Step 1: Create `src/main/ipc-router.ts`

```ts
import { ipcMain, type BrowserWindow } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { ViewManager } from './view-manager';

/**
 * Wires up all ipcMain handlers in one place.
 * Every handler reads/writes through the contract types so channel names and
 * payload shapes are verified at compile time.
 */
export function registerIpcRouter(window: BrowserWindow, viewManager: ViewManager): void {
  // Kept from M0 for preload sanity checks.
  ipcMain.handle(
    IpcChannels.appPing,
    (_event, payload: IpcContract[typeof IpcChannels.appPing]['request']) => {
      return {
        reply: `pong: ${payload.message}`,
        timestamp: Date.now(),
      };
    },
  );

  ipcMain.handle(
    IpcChannels.tabNavigate,
    async (_event, payload: IpcContract[typeof IpcChannels.tabNavigate]['request']) => {
      await viewManager.navigate(payload.url);
    },
  );

  ipcMain.handle(IpcChannels.tabGoBack, () => viewManager.goBack());
  ipcMain.handle(IpcChannels.tabGoForward, () => viewManager.goForward());
  ipcMain.handle(IpcChannels.tabReload, () => viewManager.reload());

  ipcMain.on(
    IpcChannels.chromeSetHeight,
    (_event, payload: IpcContract[typeof IpcChannels.chromeSetHeight]['request']) => {
      viewManager.setChromeHeight(payload.heightPx);
    },
  );

  // Main → renderer: broadcast tab state on every change.
  viewManager.onTabChange((tab) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IpcChannels.tabUpdated, tab);
    }
  });
}
```

### Step 2: Typecheck

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 3: Commit

```bash
git add src/main/ipc-router.ts
git commit -m "feat(main): add IpcRouter wiring tab and chrome channels"
```

---

## Task 8: 重写 main/index.ts 使用新子系统

**Files:**
- Modify: `src/main/index.ts`

M0 留下的 ping handler 迁移到 IpcRouter，main 本身只做 app/window/managers 的编排。

### Step 1: 替换 `src/main/index.ts` 整个文件为：

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { ViewManager } from './view-manager';
import { registerIpcRouter } from './ipc-router';

const INITIAL_URL = 'about:blank';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 393,
    height: 852,
    title: 'sidebrowser',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  const win = createWindow();
  const viewManager = new ViewManager(win);
  registerIpcRouter(win, viewManager);

  // Navigate to the initial URL once the renderer has reported its chrome height.
  // We defer by one tick so the renderer has a chance to send chrome:set-height first;
  // if it hasn't by the time we navigate, the view bounds will reflow once the renderer
  // does send the height.
  setImmediate(() => {
    void viewManager.navigate(INITIAL_URL);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      const newViewManager = new ViewManager(newWin);
      registerIpcRouter(newWin, newViewManager);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### Step 2: Typecheck

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 3: Commit

```bash
git add src/main/index.ts
git commit -m "feat(main): orchestrate ViewManager and IpcRouter on app ready"
```

---

## Task 9: Preload — 暴露导航 API + 事件订阅

**Files:**
- Modify: `src/preload/index.ts`

### Step 1: 替换 `src/preload/index.ts` 整个文件为：

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type IpcContract } from '@shared/ipc-contract';
import type { Tab } from '@shared/types';

const api = {
  // M0 smoke-test ping (kept for regression coverage; removed in a later cleanup).
  ping: (message: string): Promise<IpcContract[typeof IpcChannels.appPing]['response']> =>
    ipcRenderer.invoke(IpcChannels.appPing, { message }),

  // Navigation
  navigate: (url: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.tabNavigate, { url }),
  goBack: (): Promise<void> => ipcRenderer.invoke(IpcChannels.tabGoBack),
  goForward: (): Promise<void> => ipcRenderer.invoke(IpcChannels.tabGoForward),
  reload: (): Promise<void> => ipcRenderer.invoke(IpcChannels.tabReload),

  // Chrome layout — fire-and-forget send (no response expected)
  setChromeHeight: (heightPx: number): void => {
    ipcRenderer.send(IpcChannels.chromeSetHeight, { heightPx });
  },

  /** Subscribe to tab state updates. Returns an unsubscribe function. */
  onTabUpdated: (listener: (tab: Tab) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, tab: Tab): void => listener(tab);
    ipcRenderer.on(IpcChannels.tabUpdated, handler);
    return () => ipcRenderer.off(IpcChannels.tabUpdated, handler);
  },
};

contextBridge.exposeInMainWorld('sidebrowser', api);

export type SidebrowserApi = typeof api;
```

### Step 2: Typecheck

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 3: Commit

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose navigation API and tab-updated subscription"
```

---

## Task 10: Renderer Zustand store + useTabBridge 钩子

**Files:**
- Create: `src/renderer/src/store/tab-store.ts`
- Create: `src/renderer/src/hooks/useTab.ts`

### Step 1: Create `src/renderer/src/store/tab-store.ts`

```ts
import { create } from 'zustand';
import type { Tab } from '@shared/types';
import { INITIAL_TAB } from '@shared/types';

interface TabStore {
  tab: Tab;
  /** Overwrite the tab state wholesale (main is source of truth, renderer is a mirror). */
  setTab: (tab: Tab) => void;
}

export const useTabStore = create<TabStore>((set) => ({
  tab: { ...INITIAL_TAB },
  setTab: (tab) => set({ tab }),
}));
```

### Step 2: Create `src/renderer/src/hooks/useTabBridge.ts`

```ts
import { useEffect } from 'react';
import { useTabStore } from '../store/tab-store';

/**
 * Wires the Zustand `tab` slice to main's `tab:updated` broadcasts.
 * Call once from the top-level App component.
 */
export function useTabBridge(): void {
  const setTab = useTabStore((s) => s.setTab);

  useEffect(() => {
    const unsubscribe = window.sidebrowser.onTabUpdated((tab) => {
      setTab(tab);
    });
    return unsubscribe;
  }, [setTab]);
}
```

### Step 3: Typecheck

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 4: Commit

```bash
git add src/renderer/src/store src/renderer/src/hooks
git commit -m "feat(renderer): add Zustand tab store and main-to-renderer bridge hook"
```

---

## Task 11: TopBar component (back / forward / reload / URL input)

**Files:**
- Create: `src/renderer/src/components/TopBar.tsx`

### Step 1: Create `src/renderer/src/components/TopBar.tsx`

```tsx
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Loader2 } from 'lucide-react';
import { useTabStore } from '../store/tab-store';
import { normalizeUrlInput } from '@shared/url';

export function TopBar(): ReactElement {
  const tab = useTabStore((s) => s.tab);
  const [draft, setDraft] = useState<string>('');

  // Sync the address bar when navigation happens from outside the input (back/forward/redirect).
  useEffect(() => {
    setDraft(tab.url === 'about:blank' ? '' : tab.url);
  }, [tab.url]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const url = normalizeUrlInput(draft);
    void window.sidebrowser.navigate(url);
  };

  return (
    <div className="flex w-full items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2 py-1.5">
      <IconButton
        ariaLabel="Back"
        disabled={!tab.canGoBack}
        onClick={() => void window.sidebrowser.goBack()}
      >
        <ArrowLeft size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Forward"
        disabled={!tab.canGoForward}
        onClick={() => void window.sidebrowser.goForward()}
      >
        <ArrowRight size={16} />
      </IconButton>
      <IconButton
        ariaLabel="Reload"
        onClick={() => void window.sidebrowser.reload()}
      >
        {tab.isLoading ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
      </IconButton>

      <form onSubmit={submit} className="flex-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Enter URL or search"
          spellCheck={false}
          data-testid="address-bar"
          className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:ring-1 focus:ring-sky-500"
        />
      </form>
    </div>
  );
}

function IconButton({
  children,
  ariaLabel,
  disabled,
  onClick,
}: {
  children: ReactElement;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
```

### Step 2: Typecheck

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 3: Commit

```bash
git add src/renderer/src/components/TopBar.tsx
git commit -m "feat(renderer): add TopBar with nav buttons and address input"
```

---

## Task 12: 重写 App.tsx — 挂 TopBar + 上报 chrome 高度

**Files:**
- Modify: `src/renderer/src/App.tsx`

M0 的 "Ping main" demo UI 可以删了——ping 通道本身保留（有单测覆盖），但 UI 已被 TopBar 替代。

### Step 1: 替换 `src/renderer/src/App.tsx` 整个文件为：

```tsx
import { useEffect, useRef, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { useTabBridge } from './hooks/useTabBridge';

export function App(): ReactElement {
  useTabBridge();

  const chromeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;

    const report = (): void => {
      window.sidebrowser.setChromeHeight(el.getBoundingClientRect().height);
    };

    // Initial report + subsequent updates on size changes (e.g. window resize, DPI change).
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={chromeRef} className="shrink-0">
        <TopBar />
      </div>
      {/* The region below is where the WebContentsView is overlaid by main; we leave it empty. */}
      <div className="flex-1" />
    </div>
  );
}
```

### Step 2: Typecheck

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 3: Smoke-test dev server (manual)

```bash
pnpm dev
```

Expected:
- Window opens (393×852 by default)
- TopBar visible at the top with back/forward/reload buttons + an empty URL input
- Below TopBar: the WebContentsView shows `about:blank` (just black/empty)
- Type `https://example.com` in the address bar and press Enter → the page loads below the TopBar
- The back button becomes enabled after navigation; forward stays disabled
- Click reload → page reloads, the reload icon animates briefly into a spinner
- Open DevTools (Ctrl+Shift+I on the renderer window — note this opens DevTools for the TopBar chrome, not the WebContentsView; M1 doesn't provide a way to inspect the web page itself)

If any of these behaviors fail, stop and report BLOCKED with the observed symptom.

Kill the app (close window) before proceeding.

### Step 4: Commit

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(renderer): replace ping demo with TopBar + chrome height reporter"
```

---

## Task 13: E2E — navigation roundtrip

**Files:**
- Create: `tests/e2e/navigation.spec.ts`

### Step 1: Rebuild

```bash
pnpm build
```

Expected: 3 bundles, no errors.

### Step 2: Create `tests/e2e/navigation.spec.ts`

This test uses a short-lived local HTTP server to avoid depending on real internet.

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));

function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((res) => {
    const server = createServer((req, response) => {
      if (req.url === '/page1') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>PAGE ONE</title><p>page one</p>');
        return;
      }
      if (req.url === '/page2') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>PAGE TWO</title><p>page two</p>');
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      res({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test('address bar navigation updates URL and history', async () => {
  const { server, baseUrl } = await startTestServer();
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.cjs')],
  });

  try {
    const window = await app.firstWindow();

    // Navigate to page1 via the address bar.
    const addressBar = window.getByTestId('address-bar');
    await addressBar.fill(`${baseUrl}/page1`);
    await addressBar.press('Enter');

    // The Tab state broadcast should update the title; give the WebContentsView time to load.
    await expect
      .poll(
        async () => {
          // Title should be reflected on the window via page-title-updated → Tab → ...
          // But the renderer doesn't render the title; instead we just wait for a navigate round-trip
          // by re-reading the address bar (which useEffect syncs to tab.url).
          return (await addressBar.inputValue()).endsWith('/page1');
        },
        { timeout: 10_000 },
      )
      .toBeTruthy();

    // Navigate to page2.
    await addressBar.fill(`${baseUrl}/page2`);
    await addressBar.press('Enter');

    await expect
      .poll(
        async () => (await addressBar.inputValue()).endsWith('/page2'),
        { timeout: 10_000 },
      )
      .toBeTruthy();

    // Back button should now be enabled.
    const backButton = window.getByRole('button', { name: 'Back' });
    await expect(backButton).toBeEnabled();

    await backButton.click();
    await expect
      .poll(
        async () => (await addressBar.inputValue()).endsWith('/page1'),
        { timeout: 10_000 },
      )
      .toBeTruthy();
  } finally {
    await app.close();
    server.close();
  }
});
```

### Step 3: Run E2E

```bash
pnpm test:e2e
```

Expected: navigation test passes (plus the existing launch test from M0 — 2 tests total passing).

### Step 4: Commit

```bash
git add tests/e2e/navigation.spec.ts
git commit -m "test(e2e): add navigation roundtrip with local HTTP server"
```

---

## Task 14: E2E — cookie persistence across restart

**Files:**
- Create: `tests/e2e/persistence.spec.ts`

This is the Definition of Done check for M1 — "login to a site → close → restart → still logged in". We simulate "logged in" by setting a cookie on the first launch, closing the app, relaunching, and verifying the cookie is still sent.

### Step 1: Create `tests/e2e/persistence.spec.ts`

Use a local HTTP server that **captures** what cookies each request carried (the server is our oracle — it records the `Cookie` header per path, which we later assert on). The WebContentsView's DOM isn't queryable via Playwright's `window` locator (it's a separate surface), so observing behavior server-side is the cleanest assertion point.

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface CookieSpy {
  readonly server: Server;
  readonly baseUrl: string;
  readonly observed: Map<string, string[]>; // path → list of cookie headers seen
}

function startCookieServer(): Promise<CookieSpy> {
  return new Promise((res) => {
    const observed = new Map<string, string[]>();
    const server = createServer((req: IncomingMessage, response: ServerResponse) => {
      const path = req.url ?? '/';
      const cookie = req.headers.cookie ?? '';
      const list = observed.get(path) ?? [];
      list.push(cookie);
      observed.set(path, list);

      if (path === '/set') {
        response.setHeader(
          'Set-Cookie',
          'sidebrowser_test=persisted-value; Path=/; Max-Age=3600; SameSite=Lax',
        );
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>cookie set</title><p>cookie set</p>');
        return;
      }
      if (path === '/read') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>cookie read</title><p>cookie read</p>');
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      res({ server, baseUrl: `http://127.0.0.1:${port}`, observed });
    });
  });
}

async function launchAndNavigate(baseUrl: string, subpath: string, userDataDir: string): Promise<void> {
  const app = await electron.launch({
    args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
  });
  try {
    const window = await app.firstWindow();
    const addressBar = window.getByTestId('address-bar');
    await addressBar.fill(`${baseUrl}${subpath}`);
    await addressBar.press('Enter');

    await expect
      .poll(async () => (await addressBar.inputValue()).endsWith(subpath), { timeout: 10_000 })
      .toBeTruthy();
  } finally {
    await app.close();
  }
}

test('cookies survive app restart (persistent session)', async () => {
  const spy = await startCookieServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-e2e-'));

  try {
    // Launch 1: set the cookie.
    await launchAndNavigate(spy.baseUrl, '/set', userDataDir);

    // Launch 2: navigate to /read; the request should carry the cookie set in launch 1.
    await launchAndNavigate(spy.baseUrl, '/read', userDataDir);

    const readRequests = spy.observed.get('/read') ?? [];
    expect(readRequests.length).toBeGreaterThan(0);
    expect(readRequests[0]).toContain('sidebrowser_test=persisted-value');
  } finally {
    spy.server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
```

### Step 2: Run E2E suite

```bash
pnpm test:e2e
```

Expected: 3 tests pass total (launch smoke from M0 + navigation + persistence).

If the persistence test fails with the `observed /read` being empty or lacking the cookie:
- Check `out/main/index.cjs` contains the SessionManager wiring (grep for `persist:sidebrowser`).
- Check that `--user-data-dir` is actually being respected by Electron (log `app.getPath('userData')` if needed).
- Check that the WebContentsView is using `getPersistentSession()` (grep the bundled output).

### Step 3: Commit

```bash
git add tests/e2e/persistence.spec.ts
git commit -m "test(e2e): verify cookies persist across app restart"
```

---

## Task 15: 全量验收 + 打 tag

- [ ] **Step 1: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 2: lint**

```bash
pnpm lint
```

Expected: 0 errors. If new React hook warnings appear, resolve them (usually missing deps in `useEffect`).

- [ ] **Step 3: unit tests**

```bash
pnpm test
```

Expected: 12 passed (5 from ipc-contract + 7 from url).

- [ ] **Step 4: build**

```bash
pnpm build
```

Expected: 3 bundles, no errors.

- [ ] **Step 5: E2E tests**

```bash
pnpm test:e2e
```

Expected: 3 passed (launch / navigation / persistence).

- [ ] **Step 6: Manual smoke check**

```bash
pnpm dev
```

Do a quick human verification:
- Type `https://example.com` in the address bar → page loads
- Click back after going somewhere → works
- Click reload → page reloads
- Open a real site you're logged into (e.g., any web app), log in, close the app, reopen → still logged in

If manual login check reveals a problem that automated tests missed, stop and report — don't tag.

- [ ] **Step 7: Tag**

```bash
git tag -a m1-basic-browsing -m "M1: basic browsing + persistent login complete"
```

---

## Definition of Done

- ✅ `pnpm dev` launches a window with TopBar (back/forward/reload/URL input) and a live web view area
- ✅ User can type a URL and navigate; back/forward/reload all work
- ✅ Navigation state (URL, loading, history availability) round-trips main ↔ renderer correctly
- ✅ Cookies/localStorage persist across app restarts (verified by E2E + manual)
- ✅ `pnpm typecheck / lint / test / test:e2e / build` all green
- ✅ Git history clean, each Task has its own conventional-style commit
- ✅ `m1-basic-browsing` tag applied

**Transfer to next milestone:** M2 will add multi-tab support (tab drawer UI, tab IDs, ViewManager refactored to a map, IPC channels gain `id` parameter). M1's single-tab implementation sets up all the primitives (SessionManager, WebContentsView lifecycle, chrome height reporting, Zustand mirror) so the M2 refactor is scoped.
