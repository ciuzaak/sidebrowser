# M3：移动端模拟 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M2 多 tab 基础上加"每 tab 独立 UA 切换"——新 tab 默认 iOS Safari UA（站点按移动端渲染），TopBar 暴露 desktop/mobile 切换按钮，切换调 `setUserAgent + reloadIgnoringCache`。同步加 favicon 显示（page-favicon-updated → Tab.favicon → TabDrawer 渲染）。`isMobile` 跨重启持久化。

**Architecture:**
- 新 `src/main/user-agents.ts` 导出 mobile/desktop UA 常量（mobile = iOS Safari per spec §5.4；desktop = `null` 用 Electron 默认）
- `Tab` 接口加 `isMobile: boolean` 和 `favicon: string | null`，`makeEmptyTab(id, url, isMobile)` 接受可选 isMobile（默认 true）
- `ViewManager.createTab(url?, id?, isMobile?)`：构造时 `view.webContents.setUserAgent(uaFor(isMobile))`，注册 `page-favicon-updated` 监听
- `ViewManager.setMobile(id, isMobile)`：`setUserAgent(uaFor(...)) + reloadIgnoringCache()`，更新 Tab → 触发 tab:updated → renderer 切按钮态
- 新 IPC `tab:set-mobile` (R→M invoke `{id, isMobile}` → void)
- TabPersistence 的 `PersistedTab` 加 `isMobile`（sanitize 默认 true）
- TopBar 加 Smartphone/Monitor 切换图标（lucide-react）
- TabDrawer 在每行左侧渲染 favicon（有则 `<img>`，无则保留空位防抖）

**Tech stack delta vs M2:** 无新依赖。

**Spec references:** `docs/superpowers/specs/2026-04-23-sidebrowser-design.md` §2（每 tab 独立 UA 决定）、§5.3（Tab 数据模型 isMobile/favicon）、§5.4（SessionManager UA 切换 contract）、§6（IPC 契约——M3 需补回 `tab:set-mobile` 行）、§7（Settings.browsing.mobileUserAgent，但 M3 不引入 settings 抽屉，UA 常量先硬编码）、§13（M3 里程碑）。

**M3 specific guardrails（M2 留下的、本计划必须沿用）：**
- `ViewManager.onSnapshot/onTabUpdated` 是 multi-listener Set 模式——任何新订阅者直接 add 即可，不会覆盖
- Snapshot race 已用 `tabs:request-snapshot` IPC 关掉——renderer 在 `useTabBridge` 里订阅完会主动 invoke 一次。M3 不需要再防这个
- React 19 `react-hooks/set-state-in-effect`——TopBar 已用 sentinel-guard 模式（参考 commit `1cedcad`）。新增 TopBar 状态不要塞 useEffect
- E2E 必用 `tests/e2e/helpers.ts` 的 `getChromeWindow(app)`，不能 `app.firstWindow()`（M1 引入 WebContentsView 后会竞态）
- `playwright.config.ts` 已设 `workers: 1` + `timeout: 60_000`——M3 别动这俩
- 每个 spec 用 `mkdtempSync(join(tmpdir(), 'sidebrowser-m3-XXX-'))` 做 userData 隔离
- Build 配置：electron-vite externalize 列表已排除 ESM-only 包（electron-store / nanoid）。M3 如需引入新 ESM 包，确认 `package.json` 的 `"type"` 并按需加到 `electron.vite.config.ts` 的 `externalizeDepsPlugin({ exclude: [...] })`

**M3 Definition of Done:**
- 新 tab 默认 mobile UA：导航到 `https://www.whatsmyua.info/` 显示 iPhone Safari
- TopBar 有 mobile/desktop 切换图标（默认高亮 mobile），点击切换 → 页面 reload → UA 真的变了
- TabDrawer 每行左侧显示 favicon（example.com 这种带 favicon 的站点）
- 重启后 isMobile 状态保留（mobile tab 重启仍是 mobile）
- M2 不倒退：3 tab 持久化、登录持久化、地址栏 / drawer 交互都正常
- `pnpm typecheck / lint / test / test:e2e / build` 全绿
- `m3-mobile-emulation` tag 打上

**What this plan does NOT build（推后）：**
- 设置抽屉（M6）——UA 字符串硬编码在 user-agents.ts，不读 settings
- 窗口尺寸预设切换 UI（M6 settings drawer 一道做）
- 键盘快捷键 `Ctrl+T/W/Tab/L` 等（M3.5 或 M4 单独做）
- TabDrawer a11y 重构（M2 review I-1 推 M3）——这个 M3 plan 也推到 M3.5/M4 收尾，因为 M3 重点是功能不是 a11y polish
- Favicon 缓存（每次都用 IPC 传 URL 字符串，绝对路径或 data URL；不持久化，重启重新拉）
- UA 字符串能被用户自定义（M6）

---

## Task 1: shared/types.ts — 加 isMobile + favicon

**Files:** Modify `src/shared/types.ts`

把 `Tab` 加 `isMobile: boolean` 和 `favicon: string | null`。`makeEmptyTab` 多接一个 `isMobile` 参数（默认 true，符合 spec §2 默认 mobile）。`TabsSnapshot` 形状不变。

**Key code:**

```ts
export interface Tab {
  id: string;
  url: string;
  title: string;
  /** True = mobile UA + viewport behaviour; false = desktop. Per-tab independent (spec §2). */
  isMobile: boolean;
  /** Favicon URL (http(s) or data:) populated by `page-favicon-updated`. null = none received yet. */
  favicon: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export function makeEmptyTab(id: string, url: string, isMobile: boolean = true): Tab {
  return { id, url, title: '', isMobile, favicon: null, isLoading: false, canGoBack: false, canGoForward: false };
}
```

**Verify:** `pnpm typecheck` 会报 `view-manager.ts` 的 `makeEmptyTab` 调用缺参（M3 Task 5 修），其它 consumer（tab-store、TabDrawer 等）能向后兼容（新字段是新增不是删除）。

**Commit:** `feat(shared): add isMobile and favicon fields to Tab`

---

## Task 2: IPC contract — tab:set-mobile + 测试

**Files:** Modify `src/shared/ipc-contract.ts`、`tests/unit/ipc-contract.test.ts`

TDD: 先扩展测试（确认 red）→ 加 channel + IpcContract 入口 → 确认 green。

**Test addition (放进 `defines multi-tab management channels` 这个 describe 里):**

```ts
expect(IpcChannels.tabSetMobile).toBe('tab:set-mobile');
```

**Contract addition:** 在 `IpcChannels` 加 `tabSetMobile: 'tab:set-mobile'`。在 `IpcContract` 加：

```ts
[IpcChannels.tabSetMobile]: {
  request: { id: string; isMobile: boolean };
  response: void;
};
```

**Commit:** `feat(shared): add tab:set-mobile IPC channel`

---

## Task 3: user-agents.ts — UA 常量集中

**Files:** Create `src/main/user-agents.ts`

集中 UA 字符串。Mobile = iOS Safari (spec §5.4 给的精确字符串)。Desktop = `null` 表示恢复 Electron 默认（`webContents.setUserAgent('')` 清空，或者用 `app.userAgentFallback`——选 `null` 走 Electron 默认更稳）。

**Key code:**

```ts
import { app } from 'electron';

/** iOS Safari UA — best mobile-site compatibility per spec §5.4. */
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

/** Electron's default desktop UA. Captured lazily because app must be ready. */
export function desktopUa(): string {
  return app.userAgentFallback;
}

export function uaFor(isMobile: boolean): string {
  return isMobile ? MOBILE_UA : desktopUa();
}
```

**Commit:** `feat(main): add user-agents module with mobile/desktop UA constants`

---

## Task 4: tab-persistence — PersistedTab.isMobile

**Files:** Modify `src/main/tab-persistence.ts`、`tests/unit/tab-persistence.test.ts`

PersistedTab 加 `isMobile: boolean`（favicon 不持久化——下次启动重新拉）。`sanitizePersisted` 把 `isMobile` 当 boolean 存，缺失或类型不对默认 `true`（spec §2 默认 mobile）。

**Key changes:**

```ts
export interface PersistedTab {
  id: string;
  url: string;
  isMobile: boolean;
}

// 在 sanitizePersisted 的 entry 校验里：
const isMobile = typeof e.isMobile === 'boolean' ? e.isMobile : true;
cleaned.push({ id: e.id, url: e.url, isMobile });
```

**TDD test additions（at least 2）：**
- "preserves isMobile when present"
- "defaults missing isMobile to true (M2 forward-compat)"

**Commit:** `feat(main): persist isMobile per tab with default-true fallback`

---

## Task 5: ViewManager — setMobile + favicon listener + UA-on-create

**Files:** Modify `src/main/view-manager.ts`

四处改动：
1. `createTab(url, id?, isMobile = true)` 多接一个参数；构造完 `view.webContents.setUserAgent(uaFor(isMobile))` 在 `loadURL` 之前调用
2. `attachWebContentsEvents` 加 `page-favicon-updated` → `updateTab(id, { favicon: favicons[0] ?? null })`（Electron 给的是数组，取第一个）
3. 新方法 `setMobile(id: string, isMobile: boolean): void`：取 managed → `wc.setUserAgent(uaFor(isMobile))` → `updateTab(id, { isMobile, favicon: null })`（清旧 favicon，下次 page-favicon-updated 会重填）→ `wc.reloadIgnoringCache()`
4. `serializeForPersistence` 加 `isMobile`：`{ id, url, isMobile: m.tab.isMobile }`

**Verification edge:** `desktopUa()` 内部调 `app.userAgentFallback`，必须在 `app.whenReady()` 之后才能调。`createTab` 是在 `seedTabs` 里调的（whenReady 之内 + did-finish-load 之后），安全。但如果有任何在 whenReady 之外的调用路径要保护好。

**Commit:** `feat(main): add per-tab UA control and favicon event listener to ViewManager`

---

## Task 6: IpcRouter — handle tab:set-mobile

**Files:** Modify `src/main/ipc-router.ts`

在已有 tab 管理 handlers 后面加：

```ts
ipcMain.removeHandler(IpcChannels.tabSetMobile);
ipcMain.handle(
  IpcChannels.tabSetMobile,
  (_event, payload: IpcContract[typeof IpcChannels.tabSetMobile]['request']) => {
    viewManager.setMobile(payload.id, payload.isMobile);
  },
);
```

**Commit:** `feat(main): wire tab:set-mobile IPC handler`

---

## Task 7: main/index.ts — seedTabs 恢复 isMobile

**Files:** Modify `src/main/index.ts`

`seedTabs` 的恢复循环改成传 isMobile：

```ts
for (const pt of persisted.tabs) {
  viewManager.createTab(pt.url, pt.id, pt.isMobile);
}
```

无 persistence 的初始 blank tab 走默认（mobile=true）。

**Commit:** `fix(main): restore isMobile when seeding tabs from persistence`

---

## Task 8: Preload — setMobile API

**Files:** Modify `src/preload/index.ts`

加一个方法到 `api`：

```ts
setMobile: (id: string, isMobile: boolean): Promise<void> =>
  ipcRenderer.invoke(IpcChannels.tabSetMobile, { id, isMobile }),
```

**Commit:** `feat(preload): expose setMobile API`

---

## Task 9: TopBar — UA toggle button

**Files:** Modify `src/renderer/src/components/TopBar.tsx`

在 IconButton 行（Layers / Back / Forward / Reload）后面、在地址栏 form 之前加一个新的 IconButton。用 lucide-react 的 `Smartphone` 和 `Monitor` 图标。

**Pattern:**

```tsx
import { Smartphone, Monitor, /* existing icons */ } from 'lucide-react';

// 在 form 前面：
<IconButton
  ariaLabel={tab?.isMobile ? 'Switch to desktop' : 'Switch to mobile'}
  testId="topbar-ua-toggle"
  disabled={disabled}
  active={tab?.isMobile}
  onClick={() => id && void window.sidebrowser.setMobile(id, !tab?.isMobile)}
>
  {tab?.isMobile ? <Smartphone size={16} /> : <Monitor size={16} />}
</IconButton>
```

`active` 高亮表示"当前是 mobile"。aria-label 反映的是"点了之后会切到什么"，更对得上点击意图。

**Commit:** `feat(renderer): add UA toggle button to TopBar`

---

## Task 10: TabDrawer — render favicon

**Files:** Modify `src/renderer/src/components/TabDrawer.tsx`

每行 label 前加 favicon `<img>`。有 favicon 用 `<img>`，无则留同尺寸空位（防止 hover 抖动）。tab-drawer-item 内部布局改一下。

**Pattern:**

```tsx
<button ...>
  {tab.favicon ? (
    <img src={tab.favicon} alt="" width={14} height={14} className="shrink-0 rounded-sm" />
  ) : (
    <span className="inline-block h-[14px] w-[14px] shrink-0" aria-hidden />
  )}
  <span className="flex-1 truncate">{label}</span>
  <span role="button" ...>...</span>
</button>
```

**注意：** `<img>` 的 src 是远端 URL，渲染进程会发请求拉。这是 chrome UI（renderer），跟 WebContentsView 的 session 不同——chrome 用默认 session，不带 cookie，应该能拉到大部分公开 favicon。如果某些站点 favicon 拉不到（CORS / 鉴权），UI 会显示破图——可以在 img 上加 `onError` 隐藏：

```tsx
onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
```

**Commit:** `feat(renderer): show favicon in TabDrawer rows`

---

## Task 11: E2E — UA 切换 + isMobile 持久化

**Files:** Create `tests/e2e/mobile-ua.spec.ts`

测试 2 件事：
1. 默认 mobile UA：新 tab 导航到本地 server `/ua`，server 回写 `req.headers['user-agent']` 进 HTML，断言含 `iPhone`
2. 切到 desktop 后 reload：点 `topbar-ua-toggle`，断言 UA 不再含 `iPhone`
3. 重启验证：mobile tab → 切 desktop → 关 → 重启 → 仍是 desktop UA（验持久化）

**Pattern (借 multi-tab.spec.ts 的 helpers):**

```ts
const server = createServer((req, res) => {
  if (req.url === '/ua') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>UA</title><pre id="ua">${req.headers['user-agent']}</pre>`);
  } else { res.statusCode = 404; res.end(); }
});
// ...
// 拿活跃 tab 的 webContents UA，需要从 chrome 窗口跨进程不好做。
// 改方案：从 server 的 `observed` map 读最近一次 /ua 请求的 UA。
```

具体 server 端记 `lastUa` 字段，测试断言 `expect(spy.lastUa).toMatch(/iPhone/)` 等。

**关键：** chrome 窗口 `getChromeWindow(app)` 拿到的是 React renderer，不是 WebContentsView。不能直接 `page.evaluate(() => navigator.userAgent)` 拿到目标 tab 的 UA。所以走"server 端记 UA"路线最稳。

**Verify drawer button click:** `await page.getByTestId('topbar-ua-toggle').click()` 触发 setMobile → reloadIgnoringCache → server 收到第二次 /ua 请求 → 断言 UA 变了。

**Commit:** `test(e2e): verify per-tab UA toggle and persistence`

---

## Task 12: 全量验收 + 打 tag

按 M2 Task 15 同样套路：

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e`
- [ ] **更新 spec §6**：把 `tab:set-mobile` 行加回 IPC 表（M2 收尾时移除了，M3 加回）。Payload `{id, isMobile}`，return `void`。
- [ ] 手动冒烟（用户负责）：
  - 启 `pnpm dev`
  - 默认开 about:blank tab，TopBar 看到 Smartphone 图标高亮（mobile 默认）
  - 输 `https://www.whatsmyua.info/` → 加载完显示 iPhone Safari UA + 移动版页面
  - 点 Smartphone 图标 → 变 Monitor → 页面 reload → UA 显示 desktop 字符串
  - 切回 mobile → reload → 又是 iPhone
  - 关 app → 重启 → tab 还在，UA 仍是上次的（验持久化）
  - example.com 一类带 favicon 的站点 → drawer 里 tab 行左侧显示 favicon
- [ ] `git tag -a m3-mobile-emulation -m "M3: per-tab mobile UA toggle + favicon"`

---

## Definition of Done

- ✅ `pnpm dev` 多 tab + UA 切换 + favicon 全可用
- ✅ Per-tab UA toggle 按钮在 TopBar，切换后页面真 reload
- ✅ TabDrawer 显示 favicon
- ✅ isMobile 跨重启持久化
- ✅ M2 功能不倒退（多 tab、登录、地址栏）
- ✅ 全套 typecheck/lint/test/test:e2e/build 绿
- ✅ Spec §6 同步加回 `tab:set-mobile` 行
- ✅ `m3-mobile-emulation` tag

**Transfer to next milestone:** M4 加"鼠标离开 → 滤镜"——cursor-watcher 50ms 轮询、DimController（webContents.insertCSS）、4 种 effect（dark/light/blur/none）+ 强度。M3 已经把 ViewManager 的 per-tab webContents 操作打通了（setUserAgent + reload），M4 的 insertCSS 走类似路径，只对 active tab 生效。
