# M6：设置抽屉 + 持久化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SettingsDrawer UI + `electron-store` 持久化 + `settings:get/update/changed` IPC 通路；main/renderer 双侧实时生效；M5 的 `DEFAULTS` 常量被 `SettingsStore` 实例取代；窗口位置/尺寸跨重启存档；`app:ready` 广播替掉 M5 "初始值 + ready-to-show 后广播覆盖" 的竞态处理。

**Architecture:**
- `src/main/clamp-settings.ts` 纯函数：`clampSettings(partial, current) → Partial<Settings>`，把数值夹到 spec §7 范围，处理 preset → width/height 归一化（以及显式改 width/height 时把 preset 推到 `'custom'`）。
- `src/main/settings-store.ts` 类：wrap `electron-store`；API `get() / update(partial) / onChanged(cb)`；backend DI 允许 Node-only 单测；内部用 clamp + 两层深合并（Settings 是嵌套对象，不能 `Object.assign` 浅 merge）。
- `src/main/window-bounds.ts` 独立模块：真实窗口 bounds 另存为 `windowBounds` key，debounce 1s + `will-quit` flush；启动恢复 + 多显示器 validity check（bounds 中心落在某 display workArea 内才用，否则主屏居中）。
- `src/main/index.ts`：SettingsStore 实例化、IPC handler 注册、`onChanged` 钩连接到 DimController.restyle + EdgeDock `config()` getter + CursorWatcher `setDelayMs` + `win.setBounds`（preset 变化）；替换 M5 里 `DEFAULTS.*` 读取点。`app:ready` 事件在 `ready-to-show` 后广播 `{ settings }`，renderer 用这个作初始状态权威。
- EdgeDock deps 的 `config: EdgeDockConfig` 改 `config: () => EdgeDockConfig`（每次 dispatch 现读现传）。CursorWatcher 新增 `setDelayMs`。DimController 新增 `restyle(dim)`（在 active 状态下强制重新 insertCSS，绕过 apply 的 idempotency 短路）。
- `src/renderer/src/store/settings-store.ts` Zustand slice；`useSettingsBridge.ts` hook：mount 时 `getSettings()` 取初始值 + 订阅 `onSettingsChanged`；`onAppReady` 收到也覆盖一次（兜底）。
- `src/renderer/src/components/SettingsDrawer.tsx`：右侧覆盖层，`position: absolute; right: 0; top: 0; bottom: 0; width: 100%`；打开时通过 IPC `view:set-suppressed` 让 ViewManager 把活跃 tab bounds 设为 `{0,0,0,0}`（v1 "覆盖" 实现：React DOM 无法 overlay 原生 WebContentsView 层，改为隐藏视图）；关闭恢复。所有 6 个 Settings section 都有控件。TopBar 加齿轮按钮。
- E2E：一条 spec 覆盖 drawer 开关 + blur slider 拖动 live 生效 + close/relaunch 设置保留 + 窗口 bounds 恢复 + restoreTabsOnLaunch=false 路径。

**Tech stack delta vs M5:** `electron-store` 新增（已在 spec §3 列为 v1 默认）。无其它新依赖。

**Spec references:** §3（electron-store）、§4.2（覆盖式抽屉）、§5.4（UA 切换）、§6（settings:get/update/changed + app:ready 通道表）、§7（Settings schema 全量）、§8.3（调整模糊强度数据流）、§9（持久化清单）、§10（隐藏状态不持久化、bounds 不在任何显示器内 snap 回主屏中心）、§13 M6、§16（常量集中）。

**M6 特定 guardrails：**
- `electron-store` 加载时带 `defaults` + 浅合并 — 升级新增字段被默认值兜住。`clampSettings` 另做第二道防线（持久化文件被手动编辑、类型外值）。
- **不引 Zod**（spec §7 明确 "v1 不引入 Zod"）：clamp 函数体即契约；类型安全由 TS strict 管。
- **Preset / width 权威**：`window.preset` 是首选尺寸驱动；用户拖动物理 resize 不更新 `Settings.window.width`——改 `windowBounds.*` 独立 key。preset 切换触发 `win.setBounds`；物理 resize 只写 windowBounds。避免两路权威打架。
- **覆盖式抽屉的 v1 实现**：打开时 ViewManager 把活跃 tab bounds 设为 `{0,0,0,0}`。React DOM 无法盖在原生 WebContentsView 上方，隐藏视图是最简方案。关闭抽屉后 `applyBounds()` 恢复。不改 chrome 高度，spec §4.2 "不挤压网页" 字面满足（WebContentsView 不重算 layout、不抖动；暂时不可见属可接受代价）。
- **live-apply 语义矩阵**（Task 7 里复刻到代码注释）：

  | Setting | Live | 消费者 | 备注 |
  |---|---|---|---|
  | `window.preset` / `width` / `height` | ✅ | `win.setBounds` + EdgeDock getter | preset 变化立即 resize |
  | `window.edgeThresholdPx` | ✅ | EdgeDock getter | 下次 dispatch 生效 |
  | `mouseLeave.delayMs` | ✅ | `watcher.setDelayMs` | 下次 leave 生效 |
  | `dim.*` | ✅ | `dim.restyle` | dim active 时立即重绘；非 active 时下次 apply 用新值 |
  | `edgeDock.enabled / animationMs / triggerStripPx` | ✅ | EdgeDock getter | enabled=false 即时 disable |
  | `lifecycle.closeAction` | ❌ | — | M7 托盘前恒为 'quit' |
  | `lifecycle.restoreTabsOnLaunch` | ❌ | bootstrap 启动期读 | 下次重启生效 |
  | `browsing.defaultIsMobile` | 仅新 tab | `ViewManager.createTab` | 已开 tab 保持其 UA |
  | `browsing.mobileUserAgent` | 仅新 tab | `ViewManager.createTab` | 同上 |

- **settings:update 是 patch + full broadcast**：IPC handler 接 `Partial<Settings>`，store merge + clamp 后返 full `Settings`，`onChanged` 向所有 renderer 广播 full `Settings`。
- **renderer 初始状态竞态**：hook 先 subscribe `onSettingsChanged`，再 invoke `getSettings()` — invoke 结果是权威；`app:ready` 作兜底（若 mount 比 ready-to-show 晚，两条路都能覆盖）。
- **窗口 bounds 恢复的 display validity check**：bounds 中心点要落在某 display workArea 内才用，否则主屏居中。启动期 EdgeDock 还没起，逻辑在 `WindowBoundsPersister.loadOrDefault` 里独立实现（不复用 EdgeDock SNAP_TO_CENTER）。
- **hidden 状态不持久化**（spec §10）：`windowBounds` 只存 x/y/width/height；任何 dock/hide/dim 状态都不写盘。EdgeDock reducer 初始永远 `DOCKED_NONE`。
- **`browsing.mobileUserAgent` 为空字符串**：clamp 里保留 current（防误清空）；其它空字段也同策略（字符串无范围，空视为无修改意图）。
- **每个 E2E spec 独立 userData 目录**（mkdtempSync），不复用 M4/M5 前提。
- **ViewManager.setSuppressed 通过 IPC** `view:set-suppressed`（R→M send）驱动，不是 renderer 直接 call 主进程方法。drawer 组件在 open state 切换时发 IPC。

**M6 Definition of Done:**
- TopBar 齿轮图标 → 打开设置抽屉；活跃 WebContentsView 被抑制到 `{0,0,0,0}`；关抽屉恢复。
- 抽屉内 blur 滑块拖动 → 当前网页（若已 dim）立即用新模糊值重绘。
- 抽屉内切 preset 到 iPhone SE → 窗口立即 resize 到 375×667，EdgeDock 用新 windowWidth 算 targetX。
- 抽屉内调 `edgeDock.animationMs` → 下次 hide/reveal 用新时长。
- 抽屉内调 `mouseLeave.delayMs` → 下次 leave 事件用新延迟。
- 关 app、重启 → 所有设置保留；tab 列表保留（`restoreTabsOnLaunch=true` 时）；窗口位置和尺寸恢复。
- `restoreTabsOnLaunch=false` 时重启 → 启动为 blank tab，已保存的 tab 列表不加载（但文件未被删，用户改回来还能看到）。
- 手动把持久化的 `windowBounds.x` 改成 `-5000` 后重启 → 窗口居中到主屏 workArea。
- 单测：`clampSettings`（≥10 case）、`SettingsStore`（≥8 case，DI fake backend）、`WindowBoundsPersister`（≥6 case）、ipc-contract.test.ts 扩展。
- E2E：≥1 个新 spec，覆盖 drawer 开关 + blur live-apply + 设置持久化 + 窗口 bounds 恢复 + `restoreTabsOnLaunch=false` 路径。
- M5 / M4 / M3 / M2 功能不倒退（EdgeDock、dim retarget、tabs、UA 切换、持久化登录）。
- `pnpm typecheck / lint / test / test:e2e / build` 全绿。
- `m6-settings-persistence` tag。

**What this plan does NOT build（推后）：**
- 托盘图标 + minimize-to-tray（M7）。
- `browsing.mobileUserAgent` 变更同步到已开 tab（v2，需 walk-all-tabs + reloadIgnoringCache）。
- 设置导入 / 导出（YAGNI）。
- 主题切换（spec 未列）。
- `Ctrl+,` 打开抽屉（spec §15 快捷键，独立小里程碑）。
- 抽屉内的高级子页（e.g. 滤镜预览缩略图）——v1 滑块 + 文字即可。

---

## Task 1: Settings 类型迁移到 @shared/types

**Files:** Modify `src/shared/types.ts`、`src/main/settings.ts`、`src/main/build-filter-css.ts`（若 import DimSettings）、`src/main/cursor-watcher.ts`（import MouseLeaveSettings）、`src/main/index.ts`、以及 ipc-contract.ts（M6 Task 4 要 import Settings）

Task 3 IPC contract + Task 4 preload 都会 import `Settings` 或 `Partial<Settings>`；renderer 也要在 Task 9 用到。先把 6 个类型（`WindowSettings / MouseLeaveSettings / DimSettings / EdgeDockSettings / LifecycleSettings / BrowsingSettings / Settings`）搬到 `@shared/types`，保留 `DEFAULTS` 在 `src/main/settings.ts`。

注意 spec §7 里 `window`/`lifecycle`/`browsing` section 在 M5 还没实装；本 Task 把 `Settings` 接口**扩到全量 spec 字段**，DEFAULTS 也一起补齐：

```ts
// @shared/types
export interface WindowSettings {
  width: number;            // 393
  height: number;           // 852
  preset: 'iphone14pro' | 'iphonese' | 'pixel7' | 'custom';
  edgeThresholdPx: number;  // 8, 0–50
}
export interface MouseLeaveSettings { delayMs: number /* 100, 0–2000 */; }
export interface DimSettings { /* M5 现状 */ }
export interface EdgeDockSettings { /* M5 现状 */ }
export interface LifecycleSettings {
  closeAction: 'quit' | 'minimize-to-tray'; // 'minimize-to-tray'
  restoreTabsOnLaunch: boolean;             // true
}
export interface BrowsingSettings {
  defaultIsMobile: boolean; // true
  mobileUserAgent: string;  // iOS Safari UA
}
export interface Settings {
  window: WindowSettings;
  mouseLeave: MouseLeaveSettings;
  dim: DimSettings;
  edgeDock: EdgeDockSettings;
  lifecycle: LifecycleSettings;
  browsing: BrowsingSettings;
}
```

```ts
// src/main/settings.ts
import type { Settings } from '@shared/types';
export * from '@shared/types'; // 保留 back-compat re-exports for the 2-3 remaining imports

export const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

export const DEFAULTS: Settings = {
  window: { width: 393, height: 852, preset: 'iphone14pro', edgeThresholdPx: 8 },
  mouseLeave: { delayMs: 100 },
  dim: { effect: 'blur', blurPx: 8, darkBrightness: 0.3, lightBrightness: 1.5, transitionMs: 150 },
  edgeDock: { enabled: true, animationMs: 200, triggerStripPx: 3 },
  lifecycle: { closeAction: 'minimize-to-tray', restoreTabsOnLaunch: true },
  browsing: { defaultIsMobile: true, mobileUserAgent: IOS_SAFARI_UA },
};
```

M5 DEFAULTS 原本只有 4 个 section；本 Task 补齐 window 的 `height`/`preset`（首选尺寸），外加全新的 `lifecycle` + `browsing`。`settings-defaults.test.ts` 扩断言。

UA 字符串可能已经在 `src/main/user-agents.ts` 里定义；若已有，就从那里 import 到 DEFAULTS，避免字符串重复。

**Tests:** 扩 `tests/unit/settings-defaults.test.ts` 断言新增 5 个字段（height, preset, closeAction, restoreTabsOnLaunch, defaultIsMobile, mobileUserAgent）。

**Commit:** `refactor(shared): migrate Settings types + extend DEFAULTS with lifecycle + browsing`

---

## Task 2: clamp-settings.ts — 纯函数 + preset 归一化 + 单测

**Files:** Create `src/main/clamp-settings.ts`、`tests/unit/clamp-settings.test.ts`

### Behavior

`clampSettings(partial: Partial<Settings>, current: Settings): Partial<Settings>` —— 输出的 partial 可以直接 merge 到 current。不复制 current 里未改动的 section；只包含需要写入的 section。

规则：

1. 数值 clamp 到范围（spec §7）：
   - `window.edgeThresholdPx` [0, 50]
   - `mouseLeave.delayMs` [0, 2000]
   - `dim.blurPx` [0, 40]
   - `dim.darkBrightness` [0, 1]
   - `dim.lightBrightness` [1, 3]
   - `dim.transitionMs` [0, 1000]
   - `edgeDock.animationMs` [0, 1000]（spec 未明示上限，1000 作保护）
   - `edgeDock.triggerStripPx` [1, 10]
   - `window.width` / `window.height`：无范围夹，由 preset 或用户自由设（但 preset='custom' 时不强制）
2. Preset 归一化：
   - 若 `partial.window.preset` 被设 & 不等于 `'custom'` → `width`/`height` 覆盖为 PRESETS[preset]
   - 若 `partial.window.width` 或 `partial.window.height` 被显式设 & `partial.window.preset` 没设 → `preset` 推到 `'custom'`
   - `partial.window.preset === 'custom'` + 没 width → preset 保留，width/height 保留 current
3. 字符串保护：`partial.browsing.mobileUserAgent === ''` → 移除此字段（保留 current，视为无修改）
4. 布尔字段不改
5. 不在 partial 里的 section 原样不出现在输出

Preset 表：

```ts
const PRESETS: Record<'iphone14pro' | 'iphonese' | 'pixel7', { width: number; height: number }> = {
  iphone14pro: { width: 393, height: 852 },
  iphonese: { width: 375, height: 667 },
  pixel7: { width: 412, height: 915 },
};
```

### TDD tests (≥10)

1. empty partial → `{}`（空对象，不碰 current）
2. `{window:{preset:'iphonese'}}` → `{window:{preset:'iphonese', width:375, height:667}}`
3. `{window:{width:400}}` （current.preset='iphone14pro'）→ `{window:{preset:'custom', width:400}}`
4. `{window:{edgeThresholdPx:100}}` → clamped 50
5. `{dim:{blurPx:-5}}` → 0
6. `{dim:{lightBrightness:0.5}}` → 1（下限）
7. `{mouseLeave:{delayMs:3000}}` → 2000
8. `{edgeDock:{triggerStripPx:0}}` → 1
9. `{browsing:{mobileUserAgent:''}}` → `{browsing:{}}` 或 `{}`（字段被删；测哪种都行，关键是 current 不被覆盖成空串）
10. `{window:{...}, dim:{...}}` 同时 → out 两个 section 都在
11. `{window:{preset:'custom'}}`（没 width）→ `{window:{preset:'custom'}}`，width/height 不写出
12. `{edgeDock:{enabled:false}}` → `{edgeDock:{enabled:false}}`（布尔原样）

**Commit:** `feat(main): add clampSettings with range enforcement + preset normalization`

---

## Task 3: settings-store.ts — electron-store wrapper + onChanged + 单测

**Files:** Create `src/main/settings-store.ts`、`tests/unit/settings-store.test.ts`、修改 `package.json` + `pnpm-lock.yaml`（新依赖）

### 新依赖

`pnpm add electron-store`。截稿时（2026-04）版本 ≥ 10.x（ESM-only；若 Electron/vite 编译出 ESM 问题，降到 8.x 系列 CJS 兼容版本——implementer 负责选 work-in-this-repo 的版本）。

### API

```ts
export interface SettingsBackend {
  get(): Settings | undefined;
  set(value: Settings): void;
}

export class SettingsStore {
  private settings: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor(private readonly backend: SettingsBackend) {
    const persisted = backend.get();
    this.settings = persisted ? mergeWithDefaults(persisted) : DEFAULTS;
  }

  get(): Settings { return this.settings; }

  update(partial: Partial<Settings>): Settings {
    const clamped = clampSettings(partial, this.settings);
    this.settings = mergeDeep(this.settings, clamped);
    this.backend.set(this.settings);
    for (const l of this.listeners) l(this.settings);
    return this.settings;
  }

  onChanged(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
}

export function createElectronBackend(): SettingsBackend {
  const Store = require('electron-store');
  const store = new Store<{ settings: Settings }>({ defaults: { settings: DEFAULTS } });
  return {
    get: () => store.get('settings'),
    set: (v) => store.set('settings', v),
  };
}
```

`mergeDeep` 两层深合并（Settings 根 + 其下 section 对象；不支持三层，v1 Settings schema 只到两层）。

`mergeWithDefaults(persisted)`：对每个 Settings section 做 `{ ...DEFAULTS[section], ...persisted[section] }`——保证升级新增字段被兜底。

### Tests（DI fake backend，≥8）

`createFakeBackend()` 返回一个 in-memory 实现。

1. 空 backend → `store.get() === DEFAULTS`（结构相等）
2. backend 里有完整 Settings → `store.get()` 与 backend 值相等
3. backend 里有 partial Settings（旧版本格式，缺 `lifecycle`）→ `store.get()` 合并了 DEFAULTS 里的 `lifecycle`
4. `update({dim:{blurPx:16}})` → `store.get().dim.blurPx === 16`；backend.set 被调 1 次
5. `update` 触发 `onChanged`，回调收到 full Settings
6. `update` 走 clamp：`update({dim:{blurPx:-5}})` → 存成 0
7. `update` 走 preset 归一化：`update({window:{preset:'iphonese'}})` → width=375
8. `onChanged` 的 unsubscribe 真的停止通知
9. 多个 listener 都被通知
10. `update({})` 空 partial → backend.set 照样调用（或者明确跳过——二选一，测哪种都行）

**Commit:** `feat(main): add SettingsStore with clamp + electron-store backend + onChanged`

---

## Task 4: IPC contract — settings + app:ready channels

**Files:** Modify `src/shared/ipc-contract.ts`、`tests/unit/ipc-contract.test.ts`

```ts
// IpcChannels 扩：
settingsGet: 'settings:get',
settingsUpdate: 'settings:update',
settingsChanged: 'settings:changed',
appReady: 'app:ready',
viewSetSuppressed: 'view:set-suppressed',  // Task 7 用，drawer 开关驱动 ViewManager
```

IpcContract entries：
- `settings:get`: `{ request: Record<string, never>; response: Settings }`
- `settings:update`: `{ request: Partial<Settings>; response: Settings }`
- `settings:changed`: `{ request: Settings; response: void }`（M→R event）
- `app:ready`: `{ request: { settings: Settings }; response: void }`（M→R event）
- `view:set-suppressed`: `{ request: { suppressed: boolean }; response: void }`（R→M send）

Import `Settings` from `@shared/types`（Task 1 完成后已可）。

**Tests:** 加 5 个 `it(...)` 或合并到已有 "defines ... channel" 组里，断言 5 个新通道键值。

**Commit:** `feat(shared): add settings + app:ready + view:set-suppressed IPC channels`

---

## Task 5: Preload — expose settings API + app:ready + view:set-suppressed

**Files:** Modify `src/preload/index.ts`

```ts
import type { Settings } from '@shared/types';

// append to api:
getSettings: (): Promise<Settings> =>
  ipcRenderer.invoke(IpcChannels.settingsGet, {}),
updateSettings: (partial: Partial<Settings>): Promise<Settings> =>
  ipcRenderer.invoke(IpcChannels.settingsUpdate, partial),
onSettingsChanged: (listener: (s: Settings) => void): (() => void) => {
  const handler = (_e: IpcRendererEvent, s: Settings): void => listener(s);
  ipcRenderer.on(IpcChannels.settingsChanged, handler);
  return () => ipcRenderer.off(IpcChannels.settingsChanged, handler);
},
onAppReady: (listener: (p: { settings: Settings }) => void): (() => void) => {
  const handler = (_e: IpcRendererEvent, p: { settings: Settings }): void => listener(p);
  ipcRenderer.on(IpcChannels.appReady, handler);
  return () => ipcRenderer.off(IpcChannels.appReady, handler);
},
setViewSuppressed: (suppressed: boolean): void => {
  ipcRenderer.send(IpcChannels.viewSetSuppressed, { suppressed });
},
```

无新单测（同 M5 preload 策略）。

**Commit:** `feat(preload): expose settings API + app:ready + view suppression`

---

## Task 6: window-bounds.ts — 窗口位置尺寸持久化 + 单测

**Files:** Create `src/main/window-bounds.ts`、`tests/unit/window-bounds.test.ts`

### API

```ts
export interface Rect { x: number; y: number; width: number; height: number; }

export interface WindowBoundsBackend {
  get(): Rect | undefined;
  set(value: Rect): void;
}

export interface ScreenAdapter {
  getAllDisplays(): { workArea: Rect }[];
  getPrimaryDisplay(): { workArea: Rect };
}

export class WindowBoundsPersister {
  private dirtyTimer: ReturnType<typeof setTimeout> | null = null;
  private latestDirty: Rect | null = null;

  constructor(
    private readonly backend: WindowBoundsBackend,
    private readonly screen: ScreenAdapter,
    private readonly setTimeoutImpl: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>,
    private readonly clearTimeoutImpl: (h: ReturnType<typeof setTimeout>) => void,
    private readonly debounceMs = 1000,
  ) {}

  /** Return persisted bounds if valid, else a centered default. */
  loadOrDefault(defaultWidth: number, defaultHeight: number): Rect {
    const persisted = this.backend.get();
    if (persisted && this.isInsideAnyDisplay(persisted)) {
      return persisted;
    }
    return this.centerOnPrimary(defaultWidth, defaultHeight);
  }

  /** Debounced save — call on every move/resize. */
  markDirty(b: Rect): void {
    this.latestDirty = b;
    if (this.dirtyTimer) this.clearTimeoutImpl(this.dirtyTimer);
    this.dirtyTimer = this.setTimeoutImpl(() => {
      if (this.latestDirty) this.backend.set(this.latestDirty);
      this.dirtyTimer = null;
    }, this.debounceMs);
  }

  /** Force immediate write and cancel pending debounce (will-quit). */
  flush(): void {
    if (this.dirtyTimer) { this.clearTimeoutImpl(this.dirtyTimer); this.dirtyTimer = null; }
    if (this.latestDirty) this.backend.set(this.latestDirty);
    this.latestDirty = null;
  }

  private isInsideAnyDisplay(b: Rect): boolean {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return this.screen.getAllDisplays().some(d =>
      cx >= d.workArea.x && cx < d.workArea.x + d.workArea.width &&
      cy >= d.workArea.y && cy < d.workArea.y + d.workArea.height);
  }

  private centerOnPrimary(w: number, h: number): Rect {
    const pa = this.screen.getPrimaryDisplay().workArea;
    return { x: pa.x + Math.round((pa.width - w) / 2), y: pa.y + Math.round((pa.height - h) / 2), width: w, height: h };
  }
}
```

### Tests（≥6）

Fake backend（Map）+ fake screen（可配置 displays）+ vi.useFakeTimers。

1. `loadOrDefault` 无持久化 → 主屏居中
2. `loadOrDefault` 有持久化 + 在主屏内 → 返回持久化
3. `loadOrDefault` 有持久化 + 中心完全离屏（e.g. x=-5000）→ 主屏居中
4. `markDirty` + `advanceTimersByTime(1000)` → backend.set 被调 1 次，参数是最后一次 markDirty 的值
5. `markDirty × 3` 间隔 <1s + `advanceTimersByTime(1000)` → backend.set 只调 1 次，值是最后一次
6. `markDirty` + `flush()` → 立即 backend.set、timer cleared
7. 多屏场景：persisted 在副屏内（中心在副屏 workArea）→ 返回持久化

**Commit:** `feat(main): add WindowBoundsPersister with debounced save + display validity check`

---

## Task 7: EdgeDock config getter + CursorWatcher setDelayMs + DimController restyle

**Files:** Modify `src/main/edge-dock.ts`、`tests/unit/edge-dock.test.ts`、`src/main/cursor-watcher.ts`、`tests/unit/cursor-watcher.test.ts`、`src/main/dim-controller.ts`、`tests/unit/dim-controller.test.ts`

三个主进程模块让 live-apply 可落地。互相独立，一个 commit 里一并改。

### 7A: EdgeDock — config 从值变 getter

```ts
// edge-dock.ts
export interface EdgeDockDeps {
  // ...其它字段不变
  config: () => EdgeDockConfig;  // ← 从 EdgeDockConfig 改成 getter
}
```

`runEffect` / `dispatch` 内部所有 `this.deps.config` 点替换为 `this.deps.config()`。`startAnim` 里读 `cfg.animationMs` 等处走现读。

### 7B: CursorWatcher — setDelayMs

```ts
// cursor-watcher.ts
setDelayMs(ms: number): void {
  // M5 行为：更新内部 delay；已 schedule 的 leaveTimer 保持当前延迟，下次 leave 才用新值。
  this.deps.settings = { ...this.deps.settings, delayMs: ms };
}
```

即用即更——后续 `tick()` 里 `setTimeout(..., this.deps.settings.delayMs)` 自然读到新值。

### 7C: DimController — restyle

```ts
// dim-controller.ts
/**
 * Force re-insert CSS on the current target with new settings.
 * No-op when inactive. Used when settings change while dim is active.
 */
async restyle(dim: DimSettings): Promise<void> {
  if (!this.state) return;
  const target = this.state.target;
  await this.state.target.removeInsertedCSS(this.state.key);
  this.state = null; // reset so apply() doesn't short-circuit on same-target idempotency
  await this.apply(target, dim);
}
```

为什么不用 `retarget(currentWc, newDim)`？`retarget` 内部调 `apply`，`apply` 对同 target 短路（`state.target === target` → return）。`restyle` 显式绕开短路。

### Tests

- `edge-dock.test.ts`：把 `mk()` 工厂里 `config: cfg` 改 `config: () => cfg`，让现有 11 测试全过；加 1 测试覆盖 "config getter 中途变化，下次 dispatch 用新值"（`let cfgBox = {...}` 形式，`config: () => cfgBox`，改 `cfgBox.animationMs`，触发 MOUSE_LEAVE 断言 effect.ms === 新值）。
- `cursor-watcher.test.ts`：如果没有，创建；加 2 测试 — `setDelayMs(50)` 后 tick leave 用 50ms 而非构造时的 100ms（vi.useFakeTimers）；`setDelayMs` 不影响已 schedule 的 timer。
- `dim-controller.test.ts`：加 3 测试 — restyle 在 inactive 时 no-op；restyle 在 active 时 removeInsertedCSS + insertCSS 都被调（可用 spy 计数）；restyle 的新 CSS rule 反映新 settings（assertBody 里 toContain `blur(16px)` 等）。

**Commit:** `refactor(main): make EdgeDock/CursorWatcher/DimController receptive to live settings`

---

## Task 8: main bootstrap — SettingsStore + IPC handlers + live-apply + app:ready + window bounds + ViewManager.setSuppressed

**Files:** Modify `src/main/index.ts`、`src/main/ipc-router.ts`、`src/main/view-manager.ts`

最重的一个 Task。

### 8A: ViewManager.setSuppressed

```ts
// view-manager.ts
private suppressed = false;

setSuppressed(v: boolean): void {
  if (this.suppressed === v) return;
  this.suppressed = v;
  this.applyBounds();
}

getActiveBoundsForTest(): { x: number; y: number; width: number; height: number } | null {
  const m = this.activeId ? this.tabs.get(this.activeId) : null;
  return m ? m.view.getBounds() : null;
}

// applyBounds() 内部若 this.suppressed → 所有 tab view bounds 设 {0,0,0,0}；否则走原逻辑
```

### 8B: ipc-router.ts — 新 handler

```ts
ipcMain.handle(IpcChannels.settingsGet, () => settingsStore.get());
ipcMain.handle(IpcChannels.settingsUpdate, (_e, partial: Partial<Settings>) =>
  settingsStore.update(partial));
ipcMain.on(IpcChannels.viewSetSuppressed, (_e, { suppressed }: { suppressed: boolean }) =>
  viewManager.setSuppressed(suppressed));
```

registerIpcRouter 的签名可能要扩展到接 settingsStore。按当前 ipc-router.ts 现状决定最小改动。

### 8C: bootstrap diff（index.ts）

```ts
import { SettingsStore, createElectronBackend } from './settings-store';
import { WindowBoundsPersister } from './window-bounds';
import { IpcChannels } from '@shared/ipc-contract';

app.whenReady().then(() => {
  const settingsStore = new SettingsStore(createElectronBackend());

  const boundsPersister = new WindowBoundsPersister(
    createBoundsBackend(), // 小工厂：electron-store 的另一 key 'windowBounds'
    screen,
    (cb, ms) => setTimeout(cb, ms),
    (h) => clearTimeout(h),
  );

  const { width, height } = settingsStore.get().window;
  const initialBounds = boundsPersister.loadOrDefault(width, height);

  const win = createWindow(initialBounds);
  const viewManager = new ViewManager(win);
  registerIpcRouter(win, viewManager, settingsStore); // 扩签名
  // 或：registerIpcRouter 内部 import settingsStore 单例（避免改签名），implementer 选

  const store = createTabStore();
  const saver = createPersistedTabSaver(store);
  // ...existing tab persistence listeners unchanged...

  // restoreTabsOnLaunch 分支
  win.webContents.once('did-finish-load', () => {
    const persisted = settingsStore.get().lifecycle.restoreTabsOnLaunch
      ? loadPersistedTabs(store)
      : null;
    seedTabs(viewManager, persisted);
  });

  // M5 watcher + dim + edgeDock construction — config 现在读 settingsStore
  const watcher = new CursorWatcher({
    getCursorPoint: () => screen.getCursorScreenPoint(),
    getWindowBounds: () => (win.isDestroyed() ? null : win.getBounds()),
    settings: settingsStore.get().mouseLeave,  // CursorWatcher 内部会 mutate via setDelayMs
  });
  const dim = new DimController();

  const edgeDock = new EdgeDock({
    setWindowX: (x) => { const b = win.getBounds(); win.setBounds({ ...b, x: Math.round(x) }); },
    getWindowBounds: () => win.getBounds(),
    applyDim: () => { const wc = viewManager.getActiveWebContents(); if (wc) void dim.apply(wc, settingsStore.get().dim); },
    clearDim: () => { void dim.clear(); },
    broadcastState: (s) => { if (!win.isDestroyed()) win.webContents.send(IpcChannels.windowState, s); },
    now: () => Date.now(),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (h) => clearInterval(h),
    config: () => {
      const s = settingsStore.get();
      return {
        edgeThresholdPx: s.window.edgeThresholdPx,
        animationMs: s.edgeDock.animationMs,
        triggerStripPx: s.edgeDock.triggerStripPx,
        windowWidth: s.window.width,
        enabled: s.edgeDock.enabled,
      };
    },
  });

  // M5 watcher/viewManager 订阅 unchanged...
  watcher.onLeave(() => edgeDock.dispatch({ type: 'MOUSE_LEAVE' }));
  watcher.onEnter(() => edgeDock.dispatch({ type: 'MOUSE_ENTER' }));
  viewManager.onSnapshot(() => {
    if (!dim.isActive) return;
    const wc = viewManager.getActiveWebContents();
    if (wc) void dim.retarget(wc, settingsStore.get().dim);
  });

  // Window bounds persistence
  const onMoveOrResize = (): void => boundsPersister.markDirty(win.getBounds());
  win.on('moved', () => {
    onMoveOrResize();
    edgeDock.dispatch({ type: 'WINDOW_MOVED', bounds: win.getBounds(), workArea: getWorkArea() });
  });
  win.on('resize', onMoveOrResize);

  // Settings live-apply
  settingsStore.onChanged((settings) => {
    // DimController restyle（active 时）
    if (dim.isActive) void dim.restyle(settings.dim);
    // CursorWatcher delay
    watcher.setDelayMs(settings.mouseLeave.delayMs);
    // Window preset 变化 → resize
    const b = win.getBounds();
    if (b.width !== settings.window.width || b.height !== settings.window.height) {
      win.setBounds({ ...b, width: settings.window.width, height: settings.window.height });
    }
    // 广播
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.settingsChanged, settings);
  });

  // app:ready + seed workArea
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.appReady, { settings: settingsStore.get() });
    }
    edgeDock.dispatch({ type: 'WINDOW_MOVED', bounds: win.getBounds(), workArea: getWorkArea() });
  });

  // screen.on('display-*') / win.once('closed') / activate / before-quit — 原有逻辑保留
  // before-quit 里新增 boundsPersister.flush()：
  app.on('before-quit', () => {
    boundsPersister.flush();
    saver.flush();
  });

  // 测试钩：扩 __sidebrowserTestHooks，加：
  //   getSettings: () => settingsStore.get()
  //   updateSettings: (p: Partial<Settings>) => settingsStore.update(p)
  //   getActiveViewBounds: () => viewManager.getActiveBoundsForTest()  // 需要 ViewManager 加一个公共 getter；E2E 用来验证 suppressed=true 时 bounds=0
  //   flushWindowBounds: () => boundsPersister.flush()                  // E2E 在 close 前显式 flush，避开依赖 before-quit 时序
});
```

`createBoundsBackend()` 的小工厂可以 inline 或单独 export；用 electron-store 的另一个 key（`windowBounds`）或另一个 Store 实例——implementer 选。推荐同一个 Store 实例、不同 key，省一份文件。

ViewManager 可能要把 createTab 的 UA 读 Settings：`const ua = settings.browsing.defaultIsMobile ? settings.browsing.mobileUserAgent : undefined`；implementer 评估当前 ViewManager.createTab 签名，决定是传入 settings 还是 inject getter。

`registerIpcRouter` 的签名扩展：当前签名 `(win, viewManager)`，新增 `settingsStore`（或让 IPC router 接 `onSettingsGet/onSettingsUpdate` 回调函数，降耦）。implementer 选最小侵入方案。

**Commit:** `feat(main): wire SettingsStore + window bounds + live-apply + app:ready`

---

## Task 9: Renderer — settings store slice + useSettingsBridge hook

**Files:** Create `src/renderer/src/store/settings-store.ts`、`src/renderer/src/hooks/useSettingsBridge.ts`；modify `src/renderer/src/App.tsx`

```ts
// settings-store.ts
import { create } from 'zustand';
import type { Settings } from '@shared/types';

interface SettingsSlice {
  settings: Settings | null;  // null 直到 app:ready / getSettings 到
  setSettings: (s: Settings) => void;
}

export const useSettingsStore = create<SettingsSlice>((set) => ({
  settings: null,
  setSettings: (s) => set({ settings: s }),
}));
```

```ts
// useSettingsBridge.ts
export function useSettingsBridge(): void {
  const setSettings = useSettingsStore((s) => s.setSettings);
  useEffect(() => {
    const unsubChanged = window.sidebrowser.onSettingsChanged(setSettings);
    const unsubReady = window.sidebrowser.onAppReady(({ settings }) => setSettings(settings));
    // Initial fetch — authoritative over both broadcasts; subscribe first to not miss a race
    void window.sidebrowser.getSettings().then(setSettings);
    return () => { unsubChanged(); unsubReady(); };
  }, [setSettings]);
}
```

App.tsx 增加调用：`useSettingsBridge();`（`useTabBridge / useWindowStateBridge` 旁）。

无新单测（E2E 覆盖）。

**Commit:** `feat(renderer): subscribe to settings + app:ready with authoritative initial fetch`

---

## Task 10: SettingsDrawer UI + TopBar gear button

**Files:** Create `src/renderer/src/components/SettingsDrawer.tsx`；modify `src/renderer/src/components/TopBar.tsx`、`src/renderer/src/App.tsx`

### 10A: TopBar 齿轮按钮

TopBar 的 IconButton 排列里加一个 `Settings` icon（`lucide-react`），`ariaLabel="Settings"`、`testId="topbar-settings-toggle"`、`active={drawerOpen}`；点击调外部传入的 `onToggleSettings`。

### 10B: App.tsx 管理 drawer state

```tsx
const [settingsOpen, setSettingsOpen] = useState(false);
const toggleSettings = () => setSettingsOpen(v => !v);
const closeSettings = () => setSettingsOpen(false);

// 发 IPC 通知 main suppress view
useEffect(() => {
  window.sidebrowser.setViewSuppressed(settingsOpen);
}, [settingsOpen]);

<TopBar ... onToggleSettings={toggleSettings} settingsOpen={settingsOpen} />
<SettingsDrawer open={settingsOpen} onClose={closeSettings} />
```

### 10C: SettingsDrawer.tsx

外层容器：

```tsx
<div
  data-testid="settings-drawer"
  className={`
    absolute inset-0 z-10 pointer-events-none
    ${open ? 'pointer-events-auto' : ''}
  `}
>
  <div className={`
    absolute right-0 top-0 bottom-0 w-full
    bg-neutral-900 shadow-xl
    transform transition-transform duration-200
    ${open ? 'translate-x-0' : 'translate-x-full'}
  `}>
    <header className="flex items-center justify-between p-3 border-b border-neutral-800">
      <h2 className="text-sm font-medium text-neutral-100">Settings</h2>
      <button aria-label="Close" onClick={onClose} data-testid="settings-drawer-close">
        <X size={16} />
      </button>
    </header>
    <div className="overflow-y-auto flex-1">
      <Section title="Window">...</Section>
      <Section title="Mouse leave">...</Section>
      <Section title="Dim">...</Section>
      <Section title="Edge dock">...</Section>
      <Section title="Lifecycle">...</Section>
      <Section title="Browsing">...</Section>
    </div>
  </div>
</div>
```

控件：

- `Radio` for `window.preset`（4 选项）
- `Slider`（input[type=range]）for `window.edgeThresholdPx` / `mouseLeave.delayMs` / `dim.blurPx` / `dim.darkBrightness` / `dim.lightBrightness` / `dim.transitionMs` / `edgeDock.animationMs` / `edgeDock.triggerStripPx`
- `Select` 或 `Radio` for `dim.effect`（4 选项）
- `Checkbox` for `edgeDock.enabled` / `lifecycle.restoreTabsOnLaunch` / `browsing.defaultIsMobile`
- `Radio` for `lifecycle.closeAction`（2 选项，标 "(M7 之前恒为 quit)"）
- `TextInput` for `browsing.mobileUserAgent`

每个控件 `onChange` 调 `window.sidebrowser.updateSettings(patch)`。Slider 拖动频繁，debounce 100ms（lodash/debounce 或自己写一个 `useDebouncedCallback`）。TextInput `onBlur` 时提交而非 `onChange`——UA 字符串长，避免每个字 invoke。

控件读 `useSettingsStore((s) => s.settings)`；`settings === null` 时 drawer body 显示 "Loading…"（app:ready 还没到；概率极低，但兜底）。

每个控件要有 `data-testid`，E2E 里靠这些选取：
- `settings-window-preset`
- `settings-dim-blur-slider`
- `settings-lifecycle-restore-tabs`
- 等等

**Commit:** `feat(renderer): add SettingsDrawer with live-updating controls for all 6 sections`

---

## Task 11: E2E — drawer 开关 + live blur + 持久化 + 窗口 bounds 恢复

**Files:** Create `tests/e2e/settings-drawer.spec.ts`

### 流程（单 test 或 2-3 test，一次 launch 复用为主）

**test 1: Drawer + live blur + persistence**

1. launch app #1（独立 userData dir）。
2. `waitForAddressBarReady`；navigate `/plain`。
3. 点 `topbar-settings-toggle` → drawer visible；`view:set-suppressed` 走一遍；查看窗口里 `getWebContentsByUrlSubstring('/plain')` 的 bounds = {0,0,0,0}（加个 test hook 读 view bounds，或者靠 CSS 打不出 blur 间接验证）。
4. 点 close → drawer hidden；view 恢复正常尺寸。
5. `fireLeaveNow` → dim active（M4 路径）。
6. 打开 drawer。
7. 改 `settings-dim-blur-slider` to 20（拖动 / fill）。
8. poll `getActiveFilter(app)` → 断言含 `blur(20px)`（M5/M4 的 getComputedStyle 读取方式）。
9. 关掉 drawer，`fireEnterNow` 清 dim，app.close()。
10. launch app #2 同 userData dir。
11. `waitForAddressBarReady`；poll `getSettings()` test hook → 断言 `dim.blurPx === 20`（持久化）。

**test 2: Window bounds restore**

1. launch app #1 新 userData dir。
2. 等 ready。
3. `setWindowBounds({ x: 500, y: 200, width: 400, height: 700 })`（走 Task 6 里已有的 EdgeDock test hook，不是 settings drawer）——或者加一个专门的 `setBoundsAndPersist` hook 让 bounds persister 走 flush 路径。
4. `app.close()`（触发 will-quit 里的 flush）。
5. launch app #2 同 userData dir。
6. poll `getWindowBounds()` → 断言 x=500、width=400。

**test 3 (optional)：`restoreTabsOnLaunch=false`**

1. launch #1，navigate `/plain2`，drawer 里取消 `settings-lifecycle-restore-tabs`。
2. close。
3. launch #2 同 userData dir：poll 第一个 tab URL 不是 `/plain2`（是 blank）。

可能因为 preload `setViewSuppressed` 和 WebContentsView 的 bounds 读取时机竞态，step 3 断言用延时 poll + 实际可见性（比如 `getActiveFilter` 可读证明 WC 活着但 bounds=0 打不出视觉模糊——这个间接验证不够，用专门 hook 读 view bounds 更直接）。implementer 在 Task 8 里就把 `getActiveViewBounds: () => viewManager.getActiveBoundsForTest()` 这个钩子加上。

**Commit:** `test(e2e): verify settings drawer + live apply + persistence + window bounds restore`

---

## Task 12: 全量验收 + spec 同步 + tag

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test` — 新增 3 个单测文件（clamp-settings / settings-store / window-bounds）+ 7 个修改（settings-defaults、ipc-contract、edge-dock、edge-dock-reducer 不动、cursor-watcher 新、dim-controller 扩）
- [ ] `pnpm build`
- [ ] `pnpm test:e2e` — 新增 1 个 spec（8 spec 全过；pre-existing Windows full-suite 偶发 flake 不是回归）
- [ ] **spec 同步：**
  - §6 IPC 表：`settings:get/update/changed`、`app:ready` 行已 spec'd，M6 落地无需改表。确认 `view:set-suppressed` 没在表里——它是 M6 新引入、实现细节（Drawer 隐藏 WebContentsView），不必 spec。或者加一行标 "internal"。按 implementer 判断——简洁起见，spec §6 只列 product-level channels。
  - §7 Settings schema：M6 已对齐 schema；无改动。
  - §8.3 示例：M5 期间 DimController 是用 `retarget`，M6 改用 `restyle`；更新示例的方法名。
  - §12 加一行 "M6 E2E：`settings-drawer.spec.ts` 同 spec 覆盖 drawer 开关 + 持久化 + 窗口 bounds 恢复；新增测试钩 `getSettings / updateSettings / getActiveViewBounds` 对应 SettingsStore 和 ViewManager 的可测入口。"
- [ ] 手动冒烟（用户负责）：
  - `pnpm dev`：打开 settings 抽屉 → 拖 blur 滑块 → 网页模糊度变化；关闭 → 恢复；
  - 改 preset 到 iPhone SE → 窗口立即变小；
  - 改 `mouseLeave.delayMs=500` → 鼠标出窗 500ms 后才 dim；
  - 改 `edgeDock.enabled=false` → 贴边后鼠标出不再推出（只 dim）；
  - 改 `restoreTabsOnLaunch=false` → 关 app 重启只有 blank tab；
  - 拖窗口到副屏位置 → 关 app 重启位置恢复；
  - M5 贴边 hide/reveal / mid-hide cancel 仍工作；
  - M4 dim retarget / M3 UA / M2 tab / M1 持久登录不倒退。
- [ ] `git tag -a m6-settings-persistence -m "M6: settings drawer + electron-store persistence + live apply + window bounds"`（**user 冒烟确认后才执行**）

---

## Definition of Done（重复 top，以便审核）

- ✅ SettingsDrawer 可开 / 关；抽屉打开时活跃 WebContentsView 被抑制到 `{0,0,0,0}`
- ✅ 6 section 控件齐全、调整立即走 IPC update
- ✅ Live apply：dim / edgeDock / mouseLeave / window preset 当场生效（dim active 时重绘）
- ✅ 持久化：close/relaunch 设置保留、窗口 bounds 恢复、`restoreTabsOnLaunch=false` 路径正确
- ✅ Bounds 离屏恢复 → snap 回主屏居中
- ✅ M2–M5 功能不倒退
- ✅ 单测 / typecheck / lint / build / test:e2e 全绿
- ✅ spec §8.3 同步；`m6-settings-persistence` tag

**Transfer to M7:** M7 做托盘图标 + `minimize-to-tray` 实装：
- 新模块 `src/main/tray-manager.ts`：创建 `Tray`，右键菜单（Show / Quit），左键 show window。
- `win.on('close')` 根据 `settings.lifecycle.closeAction` 分支：`'minimize-to-tray'` 则 `e.preventDefault()` + `win.hide()`；`'quit'` 则 `app.quit()`（当前 M5/M6 现状）。
- tray.icon 资源（app icon 的 16/32 variants）放 `resources/tray/`。
- E2E 测托盘困难（平台原生）；单测覆盖 "close event handler 分支选择"。
- 估计 4-5 个 task：Tray wrapper + close-event 分支 + icon 资源 + bootstrap 装配 + 单测。
