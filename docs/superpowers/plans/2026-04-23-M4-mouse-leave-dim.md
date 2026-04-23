# M4：鼠标离开 → 滤镜 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M3 基础上加"鼠标离开窗口矩形 → 100ms 后活跃 tab 的 WebContentsView 应用滤镜，回来立即解除"。4 种 effect（dark / light / blur / none）+ 可调强度。切 tab 时 dim 跟随新活跃 tab。M4 只处理 DOCKED_NONE 场景；贴边自动缩出是 M5。

**Architecture:**
- 纯函数层：`buildFilterCSS(effect, dim) → string | null` 和 `isCursorInside(cursor, bounds) → boolean`，100% 单测
- `src/main/settings.ts`：`Settings` 类型 + `DEFAULTS` 常量（只含 `dim` + `mouseLeave` 两段，值钉 spec §7）。无 store、无 IPC——M6 才做持久化和抽屉
- `src/main/dim-controller.ts`：收一个 `CssTarget { insertCSS, removeInsertedCSS }` 抽象（生产是 WebContents、单测是 `vi.fn()`），方法 `apply / clear / retarget` 等幂
- `src/main/cursor-watcher.ts`：依赖注入 `getCursorPoint / getWindowBounds`，50ms `setInterval` 轮询 + 边沿触发；leave 自带 `delayMs` 防抖（快速出进不触发）
- `ViewManager.getActiveWebContents()`：给 DimController 定位目标
- `main/index.ts` 装配：watcher.onLeave → `dim.apply(viewManager.getActiveWebContents(), DEFAULTS.dim)`；watcher.onEnter → `dim.clear()`；`viewManager.onSnapshot` 里若 activeId 变且 dim 活跃 → `dim.retarget(...)`
- E2E 通过 `SIDEBROWSER_E2E=1` 环境变量暴露 `globalThis.__sidebrowserTestHooks = { fireLeaveNow, fireEnterNow, getActiveWebContents }`，绕过真实 cursor 轮询（轮询本身有单测覆盖）

**Tech stack delta vs M3:** 无新依赖。

**Spec references:** §2（"鼠标离开"定义：物理坐标离开窗口矩形，与焦点无关）、§5.1（cursor-watcher 50ms 设计理由；DOCKED_NONE 状态转移）、§5.2（DimController insertCSS 实现、四种 effect + 设置项）、§7（Settings.dim + Settings.mouseLeave schema 默认值）、§8.2（事件链路，M4 只走 DOCKED_NONE 分支）、§12（E2E 策略：延迟 = 0 + pure-function 单测；鼠标轮询映射做成纯函数，E2E 不直接测轮询）、§13（M4 里程碑）。

**M4 特定 guardrails（M3 留下的 + spec 新 hint）：**
- `ViewManager.onSnapshot / onTabUpdated` 是 Set-based multi-listener，M4 新订阅直接 add 即可
- settings 模块不走 IPC / electron-store（M6 才做）；M4 消费者直接 `import { DEFAULTS } from './settings'`。E2E 不需要 mock 任何 store
- `webContents.insertCSS` 返回 Promise<string>（key）；必须 await 拿到 key 才能 `removeInsertedCSS(key)`。DimController 内部全程 async
- `screen.getCursorScreenPoint()` 必须在 `app.whenReady()` 之后调——CursorWatcher.start() 只在 bootstrap 末尾触发
- M4 不动 Chrome UI（TopBar / TabDrawer 形状不变）；`window:state` 广播推到 M5，那时 docked/hidden/dimmed 一起加
- 每个 E2E spec 用 `mkdtempSync(join(tmpdir(), 'sidebrowser-m4-XXX-'))` 做 userData 隔离
- `playwright.config.ts` 的 workers=1 + timeout=60_000 保持不动
- electron-vite externalize 默认规则覆盖新增 main 文件，无需改 `electron.vite.config.ts`

**M4 Definition of Done:**
- 鼠标移出窗口矩形 → ~100ms 后活跃 tab 的 `<html>` 被注入 `filter: blur(8px)` + `transition: filter 150ms ease-out`（默认 effect）
- 鼠标回到窗口内 → 立即 `removeInsertedCSS`，web 内容复原
- 快速 out-and-back（< delayMs）→ 不触发 dim
- 切换 active tab 时 dim 活跃：旧 tab 清 CSS，新 tab 注入 CSS
- Chrome UI（TopBar / TabDrawer）不受影响，任何时候都可交互
- effect='none' → 不注入 CSS（DimController state 保持空）
- 单测覆盖 `buildFilterCSS`、`isCursorInside`、`DimController`（mock target）、`CursorWatcher`（fake timers + 注入 deps）
- E2E 通过 `fireLeaveNow / fireEnterNow / getActiveWebContents` 验证 insertCSS 路径 + tab 切换 retarget
- M3 功能不倒退（多 tab、UA toggle、favicon）
- `pnpm typecheck / lint / test / test:e2e / build` 全绿
- `m4-mouse-leave-dim` tag 打上

**What this plan does NOT build（推后）：**
- 设置抽屉 UI + settings:get/update/changed IPC + electron-store 持久化（全 M6）
- 边缘贴靠自动缩出 + EdgeDock reducer + 3px trigger strip（M5）
- `window:state { docked, hidden, dimmed }` 广播（M5 引入，一起上）
- TopBar 淡出 CSS class（§8.2 描述的是贴边场景，M5 的事）
- 组合滤镜（spec 明确 v1 单选）
- 键盘快捷键统一方案（M3.5 或 M4.5 单独做）

---

## Task 1: settings.ts — DEFAULTS 钉死 spec §7

**Files:** Create `src/main/settings.ts`、`tests/unit/settings-defaults.test.ts`

只 ship `dim` + `mouseLeave` 两段，M4 消费者全部走 `import { DEFAULTS } from './settings'`。M6 会把 `DEFAULTS` 改成 `getSettings()` 异步接口 + store 持久化，但 Settings 类型形状稳定。

**Key code:**

```ts
export interface DimSettings {
  effect: 'dark' | 'light' | 'blur' | 'none';
  blurPx: number;           // 0–40
  darkBrightness: number;   // 0–1
  lightBrightness: number;  // 1–3
  transitionMs: number;     // 0–1000
}
export interface MouseLeaveSettings {
  delayMs: number;          // 0–2000
}
export interface Settings {
  dim: DimSettings;
  mouseLeave: MouseLeaveSettings;
}

export const DEFAULTS: Settings = {
  dim: { effect: 'blur', blurPx: 8, darkBrightness: 0.3, lightBrightness: 1.5, transitionMs: 150 },
  mouseLeave: { delayMs: 100 },
};
```

**TDD test（1 个足够）：** 断言 `DEFAULTS` 每字段值 === spec §7 给的默认。

**Commit:** `feat(main): add settings stub with dim + mouseLeave defaults`

---

## Task 2: buildFilterCSS 纯函数 + 单测

**Files:** Create `src/main/build-filter-css.ts`、`tests/unit/build-filter-css.test.ts`

纯函数签名 `(effect: DimSettings['effect'], dim: DimSettings) => string | null`。返回 null 表示"不注入"（effect='none' 走这里）。

**Effect → filter 映射：**

| effect | filter value |
|---|---|
| `'blur'`  | `blur({blurPx}px)` |
| `'dark'`  | `brightness({darkBrightness})` |
| `'light'` | `brightness({lightBrightness})` |
| `'none'`  | null（提前 return） |

包装：
```css
html { filter: <value>; transition: filter <transitionMs>ms ease-out; }
```
`transitionMs === 0` 时省略 `transition:` 整段（视觉上等价于 `transition: none`，但更简）。

**TDD tests（≥ 6）：**
- `blur` / 默认值 → 包含 `filter: blur(8px)`
- `dark` → 包含 `filter: brightness(0.3)`
- `light` → 包含 `filter: brightness(1.5)`
- `none` → 返回 `null`
- `transitionMs: 0` → 输出不包含 `transition` 关键字
- 自定义 `blurPx: 16` → `blur(16px)` 正确注入

**Commit:** `feat(main): add pure buildFilterCSS with 4 effect variants`

---

## Task 3: isCursorInside 纯函数 + 单测

**Files:** Create `src/main/cursor-state.ts`、`tests/unit/cursor-state.test.ts`

```ts
export function isCursorInside(
  cursor: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
    cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
  );
}
```

半开区间处理右/下边缘 off-by-one——右边第一列 pixel 判定为"外"，和大多数点击命中测试一致。

**TDD tests（≥ 5）：**
- 中心点 inside → true
- 左/上边缘（等于 bounds.x/y）→ true
- 右边第一列外（x === bounds.x + width）→ false
- 下边第一行外（同上）→ false
- 完全在外（四个方向各一 case）→ false
- 负坐标窗口（多显示器场景，bounds.x < 0）→ 逻辑正确

**Commit:** `feat(main): add pure isCursorInside predicate`

---

## Task 4: DimController + 单测

**Files:** Create `src/main/dim-controller.ts`、`tests/unit/dim-controller.test.ts`

抽象 CssTarget 让单测无需 Electron：

```ts
export interface CssTarget {
  insertCSS(rule: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
}

export class DimController {
  private state: { target: CssTarget; key: string } | null = null;

  async apply(target: CssTarget, dim: DimSettings): Promise<void> {
    const rule = buildFilterCSS(dim.effect, dim);
    if (rule === null) { await this.clear(); return; }
    // 等幂：同 target 就别重复 insert（注：M4 假设 dim 设置不在运行时变；M6 加 live-update 时再加 rule-diff 判断）
    if (this.state && this.state.target === target) return;
    if (this.state) await this.state.target.removeInsertedCSS(this.state.key);
    const key = await target.insertCSS(rule);
    this.state = { target, key };
  }

  async clear(): Promise<void> {
    if (!this.state) return;
    await this.state.target.removeInsertedCSS(this.state.key);
    this.state = null;
  }

  async retarget(newTarget: CssTarget, dim: DimSettings): Promise<void> {
    if (!this.state) return; // 未激活，retarget 是 no-op（避免鼠标还在窗口内就预先 apply）
    await this.apply(newTarget, dim);
  }

  get isActive(): boolean { return this.state !== null; }
}
```

**TDD tests（≥ 7）：**
- apply with effect=blur → insertCSS 调用 1 次，state 设好
- apply 同 target 两次 → insertCSS 只调 1 次（等幂）
- apply 后 clear → removeInsertedCSS 调用、state 清空
- apply effect='none' → insertCSS 不调用、state 保持 null
- retarget（状态活跃）→ 老 removeInsertedCSS + 新 insertCSS
- retarget（状态空闲）→ 啥都不调（silent no-op）
- 两个不同 target 连续 apply → 先清旧再建新

Mock：`const mk = (): CssTarget => ({ insertCSS: vi.fn(async (rule) => 'key-' + Math.random()), removeInsertedCSS: vi.fn(async () => undefined) })`。

**Commit:** `feat(main): add DimController with idempotent apply/clear/retarget`

---

## Task 5: ViewManager.getActiveWebContents()

**Files:** Modify `src/main/view-manager.ts`

加 getter。放在 `serializeForPersistence` 附近（同为对外读取型方法）：

```ts
getActiveWebContents(): Electron.WebContents | null {
  if (!this.activeId) return null;
  return this.tabs.get(this.activeId)?.view.webContents ?? null;
}
```

Electron `WebContents` 接口恰好包含 `insertCSS / removeInsertedCSS`，和 `CssTarget` 接口型式兼容——DimController 直接收就行，不需要 adapter。

**无新单测**（Electron 依赖）。typecheck 通过即可。

**Commit:** `feat(main): expose getActiveWebContents from ViewManager`

---

## Task 6: CursorWatcher + 单测

**Files:** Create `src/main/cursor-watcher.ts`、`tests/unit/cursor-watcher.test.ts`

依赖注入让单测完全跑在 Node：

```ts
export interface CursorWatcherDeps {
  getCursorPoint: () => { x: number; y: number };
  getWindowBounds: () => { x: number; y: number; width: number; height: number } | null;
  settings: MouseLeaveSettings;
  pollMs?: number; // default 50
}

export class CursorWatcher {
  private interval: NodeJS.Timeout | null = null;
  private leaveTimer: NodeJS.Timeout | null = null;
  private isInside = true;   // 上一帧状态
  private leaveEmitted = false; // 防止重复 emit leave
  private readonly leaveListeners = new Set<() => void>();
  private readonly enterListeners = new Set<() => void>();

  constructor(private readonly deps: CursorWatcherDeps) {}

  start(): void { /* setInterval deps.pollMs 调 this.tick */ }
  stop(): void { /* clearInterval + clearTimeout + clear listener sets 可选 */ }
  onLeave(cb: () => void): () => void { /* add/return unsubscribe */ }
  onEnter(cb: () => void): () => void { /* same */ }

  /** 测试钩：绕过轮询直接 emit。只在 SIDEBROWSER_E2E=1 时外部调用。 */
  emitLeaveNow(): void { this.fireLeave(); }
  emitEnterNow(): void { this.fireEnter(); }

  private tick(): void { /* cursor + bounds → isCursorInside → transition */ }
  private fireLeave(): void { /* call listeners, set leaveEmitted=true */ }
  private fireEnter(): void { /* call listeners if leaveEmitted, set leaveEmitted=false */ }
}
```

**Tick 逻辑（核心状态机）：**
- 取 cursor + bounds。bounds null（window 销毁）→ 忽略本 tick
- now = isCursorInside(cursor, bounds)
- 若 was inside && !now（刚从内到外）：启动 leaveTimer(delayMs)；timer fire 时调 fireLeave
- 若 !was && now（刚从外到内）：若 leaveTimer 未 fire → clearTimeout 取消（快速回来）；若已 fireLeave → fireEnter
- `wasInside = now`

**TDD tests（≥ 5，用 `vi.useFakeTimers()`）：**
- 初始 cursor 在内、start → 第一 tick 不 emit（状态无变）
- cursor 出去 → delayMs 内不 emit；delayMs 满 → emit leave 一次
- cursor 出-进 时间窗 < delayMs → 不 emit leave、不 emit enter
- cursor 出 → emit leave → 进 → emit enter 一次（成对）
- stop() 后后续 cursor 变化不触发 emit
- 订阅 / 退订 listener 能正确 add/remove

**Commit:** `feat(main): add CursorWatcher with debounced leave + edge-triggered enter`

---

## Task 7: 装配到 main/index.ts

**Files:** Modify `src/main/index.ts`

在 bootstrap（`app.whenReady().then(...)`）末尾，`seedTabs` 所在块里、`before-quit` 之前加：

```ts
import { screen } from 'electron';
import { CursorWatcher } from './cursor-watcher';
import { DimController } from './dim-controller';
import { DEFAULTS } from './settings';

// ...（bootstrap 里 saver 之后、seedTabs 之后）
const watcher = new CursorWatcher({
  getCursorPoint: () => screen.getCursorScreenPoint(),
  getWindowBounds: () => (win.isDestroyed() ? null : win.getBounds()),
  settings: DEFAULTS.mouseLeave,
});
const dim = new DimController();

watcher.onLeave(() => {
  const wc = viewManager.getActiveWebContents();
  if (wc) void dim.apply(wc, DEFAULTS.dim);
});
watcher.onEnter(() => {
  void dim.clear();
});
viewManager.onSnapshot(() => {
  if (!dim.isActive) return;
  const wc = viewManager.getActiveWebContents();
  if (wc) void dim.retarget(wc, DEFAULTS.dim);
});

watcher.start();
win.once('closed', () => watcher.stop());

if (process.env['SIDEBROWSER_E2E'] === '1') {
  (globalThis as Record<string, unknown>)['__sidebrowserTestHooks'] = {
    fireLeaveNow: () => watcher.emitLeaveNow(),
    fireEnterNow: () => watcher.emitEnterNow(),
    getActiveWebContents: () => viewManager.getActiveWebContents(),
  };
}
```

**Edge:** `app.on('activate')` 的 macOS 新窗口分支不装 watcher / dim（和 M3 一样 best-effort + 维持已有 TODO 注释）。

**Commit:** `feat(main): wire CursorWatcher + DimController into bootstrap`

---

## Task 8: E2E — dim 注入 / 解除 / 切 tab retarget

**Files:** Create `tests/e2e/mouse-leave-dim.spec.ts`

**Launch pattern:**

```ts
const app = await electron.launch({
  args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
  env: { ...process.env, SIDEBROWSER_E2E: '1' },
});
```

（`process.env` 在 playwright 进程里已被 `scripts/run.mjs` 删掉 `ELECTRON_RUN_AS_NODE`，不用显式处理）

**测试流（单个 test，一次 launch）：**

1. launch → `getChromeWindow(app)` → `waitForAddressBarReady`
2. 起本地 HTTP server 回 `/plain` → `<html><body>hi</body></html>`，`navigateActive(page, '${base}/plain')`
3. 等地址栏稳定（`expect.poll`）
4. 读初始 filter：`app.evaluate(async () => { const h = globalThis.__sidebrowserTestHooks; return await h.getActiveWebContents().executeJavaScript('document.documentElement.style.filter'); })` → 断言空字符串
5. `app.evaluate(() => globalThis.__sidebrowserTestHooks.fireLeaveNow())`
6. `expect.poll` 读 filter → 断言包含 `blur(8px)`（M4 默认 effect）
7. `fireEnterNow` → `expect.poll` → 断言 filter 空
8. **Retarget 验证：**
   - 开第二个 tab 到 `/plain` (用 `createNewTab` 模式或直接 `sidebrowser.createTab` via `page.evaluate`)
   - `fireLeaveNow` 让 dim active
   - 切回 tab1（用 TabDrawer 或 activateTab IPC）
   - `expect.poll` 断言 tab1 filter 有 blur、tab2 filter 空（需要拿到两个 wc 的引用——`__sidebrowserTestHooks` 可以再加 `getAllWebContents()` 或者走 url 识别）
   - 最简：test hook 加 `getWebContentsByUrlSubstring(s)`，返回第一个 url 含 s 的 view.webContents

**关键：** chrome 窗口 `getChromeWindow(app)` 仍然是 React renderer；我们只用它点按钮 / 导航。断言 filter 必须经 `app.evaluate` 进 main 进程，由 main 访问 WebContentsView.webContents.executeJavaScript。

**Commit:** `test(e2e): verify mouse-leave dim apply/clear/retarget`

---

## Task 9: 全量验收 + spec 同步 + tag

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`（新增 4 个单测文件：settings / build-filter-css / cursor-state / dim-controller / cursor-watcher，共 5 个）
- [ ] `pnpm build`
- [ ] `pnpm test:e2e`（新增 1 个 spec，应有 6 个 spec 全过）
- [ ] **spec 同步：** §12 末尾加一行说明 E2E 的 `SIDEBROWSER_E2E=1` + `__sidebrowserTestHooks` 测试钩机制（一两句话解释为什么 E2E 不直接测 cursor 轮询）；§6 IPC 表 M4 暂不动（`window:state` 推到 M5）
- [ ] 手动冒烟（用户负责）：
  - `pnpm dev` 起应用
  - 鼠标停窗口内 → web 内容正常
  - 鼠标移出窗口矩形 → ~100ms 后 web 内容变模糊（默认 effect='blur'）
  - 鼠标回到窗口内 → 立即清模糊
  - 快速出进（< 100ms）→ 不触发
  - 开 2 tab：tab1 让模糊生效 → 切到 tab2 → tab2 也模糊；切回 tab1 还是模糊
  - 切到地址栏输 URL → 鼠标在窗口内，不模糊
  - M3 UA toggle / favicon / 多 tab 不倒退
- [ ] `git tag -a m4-mouse-leave-dim -m "M4: mouse-leave dim + cursor watcher (DOCKED_NONE)"`

---

## Definition of Done

- ✅ `pnpm dev` 鼠标出/进窗口 → dim 正确应用/清除
- ✅ 切 tab 时 dim 跟随活跃 tab
- ✅ 快速 out-and-back 不触发 dim（防抖生效）
- ✅ Chrome UI 任何时候可交互
- ✅ M3 功能无倒退
- ✅ typecheck / lint / test / test:e2e / build 全绿
- ✅ spec §12 同步
- ✅ `m4-mouse-leave-dim` tag

**Transfer to M5:** M5 加"贴边自动缩出"。EdgeDock reducer（spec §5.1 的状态机，纯函数 `reduce(state, event) → { nextState, effects[] }`）、`computeDockedSide`（bounds vs display.workArea）、`interpolateX` 动画 16ms 插值。M4 的 CursorWatcher.onLeave / onEnter 可直接复用——追加 `WINDOW_MOVED`（`win.on('moved')`）和 `DISPLAY_CHANGED`（`screen.on('display-metrics-changed')`）事件源进 reducer。DimController M5 继续服务，但由 EdgeDock effects 驱动（HIDING 状态转移也会 apply dim）。M5 引入 `window:state { docked, hidden, dimmed }` 广播 + TopBar 淡出 CSS class（§8.2 完整链路）。
