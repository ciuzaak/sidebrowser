# M9：UX & Stability — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。Steps 用 checkbox 跟踪。

**Date:** 2026-04-24
**前置：** `m8-v1-release` tag、`main` clean、v1.0.0 已发。

**Goal:** v1.1 UX & 稳定性加固。edge-dock 始终置顶 + 单实例锁 + settings 尺寸解耦 + 托盘删除 + 主题（system/dark/light）全部收敛，`m9-ux-stability` tag 落地。

**Architecture:** 一次性 5 项独立改动合并为一个 milestone。每项改动只改相关子系统，互不阻塞。

**Tech stack delta:** 无新运行时依赖。

**Spec reference:** [docs/superpowers/specs/2026-04-24-m9-ux-stability-design.md](../specs/2026-04-24-m9-ux-stability-design.md)

**全局 guardrails：**
- **Electron 命令前 `unset ELECTRON_RUN_AS_NODE`**：用户 shell env 污染；`pnpm dev / build / test:e2e / build:installer` 前必须先 unset（或走 `scripts/run.mjs`）。
- **Per-task commit**：每个 Task 一个 atomic commit，message 见任务末。
- **不动**：M0–M8 已实现的 ViewManager / DimController / EdgeDock reducer / SettingsStore / 快捷键 / NSIS 配置。M9 只在缝隙打 patch。
- **Plan execution convention**（用户偏好）：每个 Task 完成后主动汇报；要偏离 plan 先问；用户负责手动冒烟；`m9-ux-stability` tag 用户确认后才打。

---

## Task 1: Edge-dock 始终置顶（P0 §3）

**Files:** Modify `src/main/index.ts`。

### 设计

BrowserWindow 构造时加 `alwaysOnTop: true`。窗口创建后立即 `win.setAlwaysOnTop(true, 'screen-saver')` 提到最顶 Z-band，覆盖 borderless fullscreen。

- [ ] **Step 1: 改 createWindow 构造参数**

[src/main/index.ts:29-51](src/main/index.ts#L29-L51) 的 `createWindow` 内 BrowserWindow 构造块加一行：

```ts
const win = new BrowserWindow({
  x: initialBounds.x,
  y: initialBounds.y,
  width: initialBounds.width,
  height: initialBounds.height,
  title: 'sidebrowser',
  alwaysOnTop: true,                    // ← 新增
  webPreferences: {
    preload: join(__dirname, '../preload/index.cjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  },
});
win.setAlwaysOnTop(true, 'screen-saver');   // ← 新增；提到最顶 Z-band
```

- [ ] **Step 2: typecheck / lint / test 全绿**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过。现有测试不依赖 `alwaysOnTop` 状态，不会受影响。

- [ ] **Step 3: Commit**

```
git add src/main/index.ts
git commit -m "feat(main): set window alwaysOnTop (screen-saver level) so edge-dock beats borderless fullscreen"
```

**验证（后置，Task 9 手动冒烟）**：Chrome F11 全屏 → 鼠标移到 sidebrowser 所屏边缘 → 窗口 reveal 盖在 Chrome 之上。

---

## Task 2: 单实例锁 + EdgeDock.forceRevealIfHidden（P0 §4）

**Files:** Modify `src/main/edge-dock.ts`、`src/main/index.ts`；新增 `tests/unit/edge-dock-force-reveal.test.ts`、`tests/unit/single-instance.test.ts`。

### 2a. EdgeDock 新增 forceRevealIfHidden

[src/main/edge-dock.ts](src/main/edge-dock.ts) `EdgeDock` class 内新增 public method：

```ts
/**
 * 从 HIDDEN_LEFT / HIDDEN_RIGHT 状态强制回到 DOCKED_* 可见态。
 * 其它状态 no-op。用于第二实例激活第一实例时的"双击即可见"。
 */
forceRevealIfHidden(): void {
  const k = this.state.kind;
  if (k === 'HIDDEN_LEFT' || k === 'HIDDEN_RIGHT') {
    this.dispatch({ type: 'MOUSE_ENTER' });
  }
}
```

（MOUSE_ENTER 在 HIDDEN_* 下驱动 REVEALING → DOCKED_*，这是 reducer 已存在路径，见 [src/main/edge-dock-reducer.ts](src/main/edge-dock-reducer.ts) spec §5.1 状态表。）

- [ ] **Step 1: 写 forceRevealIfHidden 单测（failing）**

`tests/unit/edge-dock-force-reveal.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { EdgeDock } from '@main/edge-dock';

function makeDeps(overrides = {}) {
  return {
    setWindowX: vi.fn(),
    getWindowBounds: vi.fn(() => ({ x: 0, y: 0, width: 393, height: 852 })),
    applyDim: vi.fn(),
    clearDim: vi.fn(),
    broadcastState: vi.fn(),
    now: vi.fn(() => 0),
    setInterval: vi.fn(() => 1 as any),
    clearInterval: vi.fn(),
    config: () => ({
      edgeThresholdPx: 8, animationMs: 0, triggerStripPx: 3, windowWidth: 393, enabled: true,
    }),
    ...overrides,
  };
}

describe('EdgeDock.forceRevealIfHidden', () => {
  it('no-op in DOCKED_NONE', () => {
    const deps = makeDeps();
    const dock = new EdgeDock(deps);
    dock.forceRevealIfHidden();
    expect(deps.broadcastState).not.toHaveBeenCalled();
  });

  it('drives reveal when HIDDEN_LEFT', () => {
    const deps = makeDeps();
    const dock = new EdgeDock(deps);
    // Drive into HIDDEN_LEFT: WINDOW_MOVED flush-left + MOUSE_LEAVE + ANIM_DONE
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    dock.dispatch({ type: 'WINDOW_MOVED', bounds: { x: 0, y: 0, width: 393, height: 852 }, workArea });
    dock.dispatch({ type: 'MOUSE_LEAVE' });
    dock.dispatch({ type: 'ANIM_DONE' });
    expect(dock.getState().kind).toBe('HIDDEN_LEFT');
    deps.broadcastState.mockClear();
    dock.forceRevealIfHidden();
    expect(['REVEALING', 'DOCKED_LEFT']).toContain(dock.getState().kind);
  });
});
```

Run: `pnpm test tests/unit/edge-dock-force-reveal.test.ts` → 两个 case 中至少 "drives reveal" 会 fail（方法不存在）。

- [ ] **Step 2: 实现 forceRevealIfHidden** 按上面代码落到 `src/main/edge-dock.ts`。

Run: `pnpm test tests/unit/edge-dock-force-reveal.test.ts` → 全过。

### 2b. index.ts 启动期加单实例锁

- [ ] **Step 3: 写 single-instance 单测（failing）**

实现决策：把 "second-instance 命中 → 调一组 ops" 的逻辑抽到纯函数 `handleSecondInstance(deps)` 里，便于单测；index.ts 里 `app.on('second-instance', () => handleSecondInstance(...))`。

`tests/unit/single-instance.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleSecondInstance } from '@main/single-instance';

describe('handleSecondInstance', () => {
  it('no-op when window destroyed', () => {
    const deps = {
      isDestroyed: () => true,
      isMinimized: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      forceRevealIfHidden: vi.fn(),
    };
    handleSecondInstance(deps);
    expect(deps.show).not.toHaveBeenCalled();
    expect(deps.focus).not.toHaveBeenCalled();
  });

  it('shows + focuses + reveals when visible window', () => {
    const deps = {
      isDestroyed: () => false,
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      forceRevealIfHidden: vi.fn(),
    };
    handleSecondInstance(deps);
    expect(deps.restore).not.toHaveBeenCalled();
    expect(deps.show).toHaveBeenCalledOnce();
    expect(deps.focus).toHaveBeenCalledOnce();
    expect(deps.forceRevealIfHidden).toHaveBeenCalledOnce();
  });

  it('restores first when minimized', () => {
    const deps = {
      isDestroyed: () => false,
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      forceRevealIfHidden: vi.fn(),
    };
    handleSecondInstance(deps);
    expect(deps.restore).toHaveBeenCalledOnce();
    expect(deps.show).toHaveBeenCalledOnce();
    expect(deps.focus).toHaveBeenCalledOnce();
  });
});
```

Run: `pnpm test tests/unit/single-instance.test.ts` → fail（模块不存在）。

- [ ] **Step 4: 实现 src/main/single-instance.ts**

```ts
/**
 * Pure handler for the `second-instance` Electron event. Extracted so the
 * routing logic can be tested without spinning up Electron.
 */
export interface SecondInstanceDeps {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
  forceRevealIfHidden: () => void;
}

export function handleSecondInstance(deps: SecondInstanceDeps): void {
  if (deps.isDestroyed()) return;
  if (deps.isMinimized()) deps.restore();
  deps.show();
  deps.focus();
  deps.forceRevealIfHidden();
}
```

Run: `pnpm test tests/unit/single-instance.test.ts` → 三个 case 全过。

- [ ] **Step 5: index.ts 接入单实例锁**

[src/main/index.ts](src/main/index.ts) 最顶部 import 下加：

```ts
import { handleSecondInstance } from './single-instance';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  // 停止继续执行；其余 app.whenReady 不会触发，因为 quit 是异步的
  // 但用 process.exit 更保险
  process.exit(0);
}
```

位置：所有现有 imports 之后、`let isQuitting = false` 之前。

然后在 `app.whenReady().then(() => { … })` 内，`edgeDock` 实例化完成之后（约 [src/main/index.ts:206](src/main/index.ts#L206) 之后）加：

```ts
app.on('second-instance', () => {
  handleSecondInstance({
    isDestroyed: () => win.isDestroyed(),
    isMinimized: () => win.isMinimized(),
    restore: () => win.restore(),
    show: () => win.show(),
    focus: () => win.focus(),
    forceRevealIfHidden: () => edgeDock.forceRevealIfHidden(),
  });
});
```

- [ ] **Step 6: Typecheck / lint / test 全绿**

Run: `pnpm typecheck && pnpm lint && pnpm test`。

- [ ] **Step 7: Commit**

```
git add src/main/edge-dock.ts src/main/single-instance.ts src/main/index.ts tests/unit/edge-dock-force-reveal.test.ts tests/unit/single-instance.test.ts
git commit -m "feat(main): enforce single-instance lock; second launch activates first window and reveals if hidden"
```

**验证（Task 9 手动冒烟）**：启动 A → 再启 B → B 立即退出，A 被拉到前台；若 A 当前 HIDDEN_LEFT → 自动 reveal。

---

## Task 3: 移除托盘子系统（P2 §6）

**Files:**
- **删除**：`src/main/tray-manager.ts`、`src/main/close-action-resolver.ts`、`tests/unit/tray-manager.test.ts`、`tests/unit/close-action-resolver.test.ts`、`tests/e2e/tray-close-action.spec.ts`、整个 `resources/tray/` 目录、`scripts/generate-tray-icons.mjs`。
- **Modify**：`src/main/index.ts`、`src/shared/types.ts`、`src/main/clamp-settings.ts`、`src/main/settings.ts`、`src/renderer/src/components/SettingsDrawer.tsx`、`electron-builder.yml`、`tests/unit/settings-defaults.test.ts`、`tests/e2e/display-stress.spec.ts`（若引用 closeAction）。

### 设计

整个托盘系统删除。X 按钮走 Electron 默认 close → destroy → `window-all-closed` → `app.quit()`。`LifecycleSettings` 中仅保留 `restoreTabsOnLaunch`，`closeAction` 字段彻底移除。

- [ ] **Step 1: 删文件**

```
rm src/main/tray-manager.ts
rm src/main/close-action-resolver.ts
rm tests/unit/tray-manager.test.ts
rm tests/unit/close-action-resolver.test.ts
rm tests/e2e/tray-close-action.spec.ts
rm scripts/generate-tray-icons.mjs
rm -rf resources/tray
```

- [ ] **Step 2: 改 src/shared/types.ts**

[src/shared/types.ts:80-83](src/shared/types.ts#L80-L83) `LifecycleSettings` 改成：

```ts
export interface LifecycleSettings {
  restoreTabsOnLaunch: boolean;
}
```

（`closeAction` 字段删除；保留 section 因为 `restoreTabsOnLaunch` 还在。）

- [ ] **Step 3: 改 src/main/settings.ts**

[src/main/settings.ts:37](src/main/settings.ts#L37) defaults 改成：

```ts
lifecycle: { restoreTabsOnLaunch: true },
```

- [ ] **Step 4: 改 src/main/clamp-settings.ts**

[src/main/clamp-settings.ts:146-155](src/main/clamp-settings.ts#L146-L155) `clampLifecycle` 改成：

```ts
function clampLifecycle(
  partial: Partial<LifecycleSettings>,
): Partial<LifecycleSettings> {
  const out: Partial<LifecycleSettings> = {};
  if (partial.restoreTabsOnLaunch !== undefined) {
    out.restoreTabsOnLaunch = partial.restoreTabsOnLaunch;
  }
  return out;
}
```

- [ ] **Step 5: 改 src/main/index.ts**

删除这些：
- import `{ TrayManager, createElectronTrayBackend }` 行（[src/main/index.ts:23](src/main/index.ts#L23)）。
- import `{ resolveCloseAction }` 行（[src/main/index.ts:24](src/main/index.ts#L24)）。
- `resolveTrayIconPath` 函数（[src/main/index.ts:102-106](src/main/index.ts#L102-L106)）。
- `win.on('close', (e) => { ... })` 整块（[src/main/index.ts:228-240](src/main/index.ts#L228-L240)）。Electron 默认 close 流程够用，不再拦截。
- TrayManager 实例化 + destroy（[src/main/index.ts:353-360](src/main/index.ts#L353-L360) + `tray.destroy()` 在 before-quit [src/main/index.ts:366](src/main/index.ts#L366)）。
- 测试钩 `setCloseAction`（[src/main/index.ts:317-318](src/main/index.ts#L317-L318)）。
- `requestWindowClose` / `getIsWindowVisible` 测试钩（[src/main/index.ts:315-316](src/main/index.ts#L315-L316)）— 先 grep 下其它 spec 有没有用这俩；没被用到则删，被用到则保留（display-stress 用 `getIsWindowVisible`，保留）。
- 删 `let isQuitting = false` + `isQuitting = true` 的 before-quit 内赋值——两者不再被读。

改完后 before-quit 保留：

```ts
app.on('before-quit', () => {
  boundsPersister.flush();
  saver.flush();
});
```

- [ ] **Step 6: 改 src/renderer/src/components/SettingsDrawer.tsx**

grep `closeAction` 找到 Lifecycle section → 如果整段仅由 closeAction 和 `restoreTabsOnLaunch` 组成，则只删 `closeAction` 那个 Row（其它 section 保留）。

- [ ] **Step 7: 改 electron-builder.yml**

打开 `electron-builder.yml`，从 `extraResources` 里删除所有引用 `resources/tray/` 的条目。若 `extraResources` 因此变空或只剩空数组，整段删除亦可（electron-builder 对缺席字段静默）。

- [ ] **Step 8: 清理其它测试引用**

```
pnpm --silent test:unit 2>&1 | head -80
```

若 `tests/unit/settings-defaults.test.ts` 里有断言 `closeAction` 字段的 case，删除那些断言。

```
pnpm --silent test:e2e --list 2>&1 | grep -E 'closeAction|tray' || true
```

若 `tests/e2e/display-stress.spec.ts` 或 `persistence.spec.ts` 里用到 `setCloseAction` / `lifecycle.closeAction` → 删掉相应调用（M9 默认即 quit，无需显式设）。

- [ ] **Step 9: Typecheck / lint / test / build 全绿**

```
pnpm typecheck && pnpm lint && pnpm test && unset ELECTRON_RUN_AS_NODE && pnpm build
```

Expected: 全过。`.ts` / `.d.ts` 不再引用已删除的模块；settings 单测更新后全通过。

- [ ] **Step 10: E2E 过一遍（tray 相关 spec 已删，不应新增失败）**

```
unset ELECTRON_RUN_AS_NODE && pnpm test:e2e
```

Expected: 全绿。如有遗漏的 closeAction 引用 → 回到 Step 8 清理。

- [ ] **Step 11: Commit**

```
git add -A
git commit -m "feat(main): remove tray subsystem; X button = app quit (no minimize-to-tray)"
```

---

## Task 4: Settings 尺寸解耦（P1 §5）

**Files:** Modify `src/shared/types.ts`、`src/main/clamp-settings.ts`、`src/main/index.ts`、`src/renderer/src/components/SettingsDrawer.tsx`、`tests/unit/clamp-settings.test.ts`、`tests/e2e/settings-drawer.spec.ts`。

### 设计

UI 删 Width / Height / Custom preset。主进程 bounds listener 改成只在 `previous.window.preset !== next.window.preset` 时 `setBounds`。schema 层 `'custom'` 移出 union，clampSettings 做 `'custom' → 'iphone14pro'` 迁移。

- [ ] **Step 1: 写 clamp-settings 迁移 + 新分支单测（failing）**

[tests/unit/clamp-settings.test.ts](tests/unit/clamp-settings.test.ts) 里新增（或改既有 preset 分组）：

```ts
describe('clampWindow — M9 migration', () => {
  it('migrates preset=custom → iphone14pro with canonical dims', () => {
    const out = clampSettings(
      { window: { preset: 'custom' as any } },
      DEFAULTS,
    );
    expect(out.window).toEqual({ preset: 'iphone14pro', width: 393, height: 852 });
  });

  it('migrates preset=custom alongside stale width/height', () => {
    const out = clampSettings(
      { window: { preset: 'custom' as any, width: 400, height: 800 } },
      DEFAULTS,
    );
    expect(out.window).toEqual({ preset: 'iphone14pro', width: 393, height: 852 });
  });

  it('does NOT coerce width/height without preset to custom anymore', () => {
    const out = clampSettings(
      { window: { width: 400, height: 800 } },
      DEFAULTS,
    );
    // width/height alone now no-op (preset is the only writable knob; UI path can't emit this).
    // Legacy config surface still accepts them but they're dropped.
    expect(out.window).toEqual({});
  });
});
```

**注意**：若 `tests/unit/clamp-settings.test.ts` 里原本存在 "width/height → preset=custom coercion" 的 case，**删除**它（该分支已不存在）。

Run: `pnpm test tests/unit/clamp-settings.test.ts` → 新 case fail（迁移 & 新无-op 分支未实现）。

- [ ] **Step 2: 改 types.ts**

[src/shared/types.ts:58](src/shared/types.ts#L58) `WindowSettings.preset` 改成：

```ts
preset: 'iphone14pro' | 'iphonese' | 'pixel7';
```

（移除 `'custom'`）。

- [ ] **Step 3: 改 clamp-settings.ts**

[src/main/clamp-settings.ts:55-62](src/main/clamp-settings.ts#L55-L62) `PRESETS` 的 `Exclude<WindowSettings['preset'], 'custom'>` 因 union 缩减而失去意义，简化为：

```ts
const PRESETS: Record<WindowSettings['preset'], { width: number; height: number }> = {
  iphone14pro: { width: 393, height: 852 },
  iphonese: { width: 375, height: 667 },
  pixel7: { width: 412, height: 915 },
};
```

[src/main/clamp-settings.ts:72-101](src/main/clamp-settings.ts#L72-L101) `clampWindow` 改成：

```ts
function clampWindow(
  partial: Partial<WindowSettings>,
): Partial<WindowSettings> {
  const out: Partial<WindowSettings> = {};

  if (partial.preset !== undefined) {
    // M9 migration: old configs may carry preset='custom'; coerce to default.
    const safePreset: WindowSettings['preset'] =
      (partial.preset as string) === 'custom'
        ? 'iphone14pro'
        : (partial.preset as WindowSettings['preset']);
    if ((partial.preset as string) === 'custom') {
      console.info('[settings] migrating custom preset → iphone14pro');
    }
    const dims = PRESETS[safePreset];
    out.preset = safePreset;
    out.width = dims.width;
    out.height = dims.height;
  }
  // Width/height without preset → dropped (no longer a coerce trigger).

  if (partial.edgeThresholdPx !== undefined) {
    out.edgeThresholdPx = clamp(partial.edgeThresholdPx, 0, 50);
  }

  return out;
}
```

Run: `pnpm test tests/unit/clamp-settings.test.ts` → 全过。

- [ ] **Step 4: 改主进程 bounds listener**

[src/main/index.ts:247-265](src/main/index.ts#L247-L265) 把：

```ts
settingsStore.onChanged((settings) => {
  if (dim.isActive) void dim.restyle(settings.dim);
  watcher.setDelayMs(settings.mouseLeave.delayMs);
  const b = win.getBounds();
  if (b.width !== settings.window.width || b.height !== settings.window.height) {
    win.setBounds({ ...b, width: settings.window.width, height: settings.window.height });
  }
  ...
});
```

改成（`settingsStore.onChanged` 提供 previous / next 两参——若当前 API 只给 next，需同时在 [src/main/settings-store.ts](src/main/settings-store.ts) 的 `onChanged` 签名扩展为 `(next, previous) => void`；先读一下确认）：

**实现者先读** [src/main/settings-store.ts](src/main/settings-store.ts) 的 `onChanged` 现签名。两种情况：

**情况 A（只给 next）**：在 index.ts 里维护一个 outer `lastPreset`：

```ts
let lastPreset = settingsStore.get().window.preset;
settingsStore.onChanged((settings) => {
  if (dim.isActive) void dim.restyle(settings.dim);
  watcher.setDelayMs(settings.mouseLeave.delayMs);
  if (settings.window.preset !== lastPreset) {
    lastPreset = settings.window.preset;
    const b = win.getBounds();
    if (b.width !== settings.window.width || b.height !== settings.window.height) {
      win.setBounds({ ...b, width: settings.window.width, height: settings.window.height });
    }
  }
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannels.settingsChanged, settings);
  }
});
```

**情况 B（已给 prev + next）**：

```ts
settingsStore.onChanged((settings, previous) => {
  if (dim.isActive) void dim.restyle(settings.dim);
  watcher.setDelayMs(settings.mouseLeave.delayMs);
  if (settings.window.preset !== previous.window.preset) {
    const b = win.getBounds();
    win.setBounds({ ...b, width: settings.window.width, height: settings.window.height });
  }
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannels.settingsChanged, settings);
  }
});
```

选择情况 A（outer closure 变量）更改动小——`settingsStore` API 不变。

- [ ] **Step 5: 改 SettingsDrawer.tsx**

[src/renderer/src/components/SettingsDrawer.tsx:70-102](src/renderer/src/components/SettingsDrawer.tsx#L70-L102) Window Section 改成：

```tsx
<Section title="Window">
  <Row label="Preset">
    <select
      data-testid="settings-window-preset"
      value={settings.window.preset}
      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
        void update({ window: { preset: e.target.value as WindowPreset } })
      }
      className="..."
    >
      <option value="iphone14pro">iPhone 14 Pro (393x852)</option>
      <option value="iphonese">iPhone SE (375x667)</option>
      <option value="pixel7">Pixel 7 (412x915)</option>
    </select>
  </Row>
  <Slider
    label="Edge threshold"
    unit="px"
    testId="settings-window-edge-threshold"
    value={settings.window.edgeThresholdPx}
    min={0}
    max={50}
    step={1}
    onChange={(n) => void update({ window: { edgeThresholdPx: n } })}
  />
</Section>
```

（删除 Width/Height 两个 Row；删除 `<option value="custom">`。）

Row 内的 className 保持原样——Task 7 才碰配色。

- [ ] **Step 6: 改 E2E spec**

[tests/e2e/settings-drawer.spec.ts](tests/e2e/settings-drawer.spec.ts) 里：

- 原 "Width/Height NumberInput 可改" 相关 case：改成断言这两个 testid **不存在**：
  ```ts
  await expect(page.getByTestId('settings-window-width')).toHaveCount(0);
  await expect(page.getByTestId('settings-window-height')).toHaveCount(0);
  ```
- 新增 case "切 preset 触发 resize"：用测试钩 `updateSettings` 或 UI select 切到 pixel7，等 16ms，断言 `window.getBounds()` 的 width/height 近似 412×915。
- 新增 case "切非-preset 设置不 resize"：读当前 bounds；UI 把 edge threshold 从 8 改到 12；再读 bounds；应相等（允许 ±2px 边界 tolerance）。

如果现有 e2e spec 中有 "width input onChange → 窗口缩放" 的 case，删掉它。

- [ ] **Step 7: Typecheck / lint / test / e2e 全绿**

```
pnpm typecheck && pnpm lint && pnpm test
unset ELECTRON_RUN_AS_NODE && pnpm build && pnpm test:e2e tests/e2e/settings-drawer.spec.ts
```

- [ ] **Step 8: Commit**

```
git add src/shared/types.ts src/main/clamp-settings.ts src/main/index.ts src/renderer/src/components/SettingsDrawer.tsx tests/unit/clamp-settings.test.ts tests/e2e/settings-drawer.spec.ts
git commit -m "feat(settings): decouple window dimensions from settings; drop custom preset + width/height UI"
```

---

## Task 5: 主题 schema + CSS 变量骨架（P2 §7.1–7.3）

**Files:** Modify `src/shared/types.ts`、`src/main/settings.ts`、`src/main/clamp-settings.ts`、`src/renderer/src/styles/globals.css`、`tests/unit/clamp-settings.test.ts`、`tests/unit/settings-defaults.test.ts`。

### 设计

Schema 新增 `appearance.theme: 'system' | 'dark' | 'light'`（默认 `'system'`）。globals.css 定义 `:root[data-theme='dark'|'light']` 两套 CSS 变量。本 Task 只加基础设施，不改组件（Task 7 才替换颜色 class）。

- [ ] **Step 1: 写 clamp-settings theme 校验单测（failing）**

[tests/unit/clamp-settings.test.ts](tests/unit/clamp-settings.test.ts) 新增：

```ts
describe('clampAppearance', () => {
  it('accepts valid theme values', () => {
    expect(clampSettings({ appearance: { theme: 'system' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'system' } });
    expect(clampSettings({ appearance: { theme: 'dark' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'dark' } });
    expect(clampSettings({ appearance: { theme: 'light' } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'light' } });
  });

  it('falls back invalid theme → system', () => {
    expect(clampSettings({ appearance: { theme: 'sepia' as any } }, DEFAULTS))
      .toEqual({ appearance: { theme: 'system' } });
  });
});
```

Run: `pnpm test tests/unit/clamp-settings.test.ts` → 新 case fail。

- [ ] **Step 2: 改 types.ts — 加 AppearanceSettings**

[src/shared/types.ts](src/shared/types.ts) 在 `Settings` interface 之前加：

```ts
export type ThemeChoice = 'system' | 'dark' | 'light';

export interface AppearanceSettings {
  theme: ThemeChoice;
}
```

`Settings` interface 末尾加一行：

```ts
export interface Settings {
  window: WindowSettings;
  mouseLeave: MouseLeaveSettings;
  dim: DimSettings;
  edgeDock: EdgeDockSettings;
  lifecycle: LifecycleSettings;
  browsing: BrowsingSettings;
  appearance: AppearanceSettings;   // ← 新增
}
```

`SettingsPatch` 同步加：

```ts
export type SettingsPatch = {
  ...
  appearance?: Partial<AppearanceSettings>;
};
```

- [ ] **Step 3: 改 settings.ts — defaults 加 appearance**

[src/main/settings.ts](src/main/settings.ts)：

```ts
// 加到 re-export 行：
export type { ..., AppearanceSettings, ThemeChoice } from '@shared/types';

export const DEFAULTS: Settings = {
  ...
  browsing: { defaultIsMobile: true, mobileUserAgent: MOBILE_UA },
  appearance: { theme: 'system' },   // ← 新增
};
```

- [ ] **Step 4: 改 clamp-settings.ts — 加 clampAppearance**

[src/main/clamp-settings.ts](src/main/clamp-settings.ts) import 行加 `AppearanceSettings`；在其它 section clampers 之后加：

```ts
function clampAppearance(
  partial: Partial<AppearanceSettings>,
): Partial<AppearanceSettings> {
  const out: Partial<AppearanceSettings> = {};
  if (partial.theme !== undefined) {
    out.theme =
      partial.theme === 'dark' || partial.theme === 'light' || partial.theme === 'system'
        ? partial.theme
        : 'system';
  }
  return out;
}
```

`clampSettings` 主函数末尾加：

```ts
if (partial.appearance !== undefined) {
  out.appearance = clampAppearance(partial.appearance);
}
```

Run: `pnpm test tests/unit/clamp-settings.test.ts` → 全过。

- [ ] **Step 5: 改 globals.css — 加 CSS 变量骨架**

[src/renderer/src/styles/globals.css](src/renderer/src/styles/globals.css) 全文替换为（或在现有内容基础上追加 `:root[data-theme='…']` 两段）：

```css
:root[data-theme='dark'] {
  --chrome-bg: #1a1a1a;
  --chrome-fg: #f5f5f5;
  --chrome-border: #2d2d2d;
  --chrome-hover: #262626;
  --chrome-muted: #a3a3a3;
  --chrome-input-bg: #262626;
  --chrome-drawer-bg: #1a1a1a;
  --chrome-accent: #0ea5e9;
}

:root[data-theme='light'] {
  --chrome-bg: #ffffff;
  --chrome-fg: #171717;
  --chrome-border: #e5e5e5;
  --chrome-hover: #f5f5f5;
  --chrome-muted: #737373;
  --chrome-input-bg: #f5f5f5;
  --chrome-drawer-bg: #ffffff;
  --chrome-accent: #0ea5e9;
}

/* Default (before useTheme sets data-theme) — fall back to dark. */
html, body {
  background: var(--chrome-bg, #1a1a1a);
  color: var(--chrome-fg, #f5f5f5);
}
```

保留现有 `html/body/#root` 的字体和 margin 重置规则（prepend 或 merge）。

- [ ] **Step 6: 改 settings-defaults 单测**

[tests/unit/settings-defaults.test.ts](tests/unit/settings-defaults.test.ts) 新增断言 defaults 含 `appearance: { theme: 'system' }`。

- [ ] **Step 7: Typecheck / lint / test 全绿**

```
pnpm typecheck && pnpm lint && pnpm test
```

- [ ] **Step 8: Commit**

```
git add src/shared/types.ts src/main/settings.ts src/main/clamp-settings.ts src/renderer/src/styles/globals.css tests/unit/clamp-settings.test.ts tests/unit/settings-defaults.test.ts
git commit -m "feat(settings): add appearance.theme schema + CSS variable skeleton (scaffolding for M9 themes)"
```

---

## Task 6: 主题 IPC + renderer 解析 hook（P2 §7.5–7.6）

**Files:** Modify `src/shared/ipc-contract.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`；新增 `src/renderer/src/theme/useTheme.ts`、`tests/unit/theme-resolver.test.ts`。

### 设计

主进程订阅 `nativeTheme.on('updated')` → 新 IPC channel `chrome:native-theme` 推 `{ shouldUseDarkColors }` 给 renderer。Renderer 合成 `effectiveTheme`（`resolveTheme(choice, systemIsDark)`）→ 写 `<html data-theme="…">`。

- [ ] **Step 1: 写 resolveTheme 单测（failing）**

`tests/unit/theme-resolver.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { resolveTheme } from '@renderer/theme/useTheme';

describe('resolveTheme', () => {
  it('choice=dark → dark regardless of system', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('choice=light → light regardless of system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('choice=system → follows systemIsDark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
```

Run: `pnpm test tests/unit/theme-resolver.test.ts` → fail（模块不存在）。

- [ ] **Step 2: 实现 useTheme.ts**

`src/renderer/src/theme/useTheme.ts`：

```ts
import { useEffect, useState } from 'react';
import type { ThemeChoice } from '@shared/types';

export function resolveTheme(choice: ThemeChoice, systemIsDark: boolean): 'dark' | 'light' {
  if (choice === 'dark') return 'dark';
  if (choice === 'light') return 'light';
  return systemIsDark ? 'dark' : 'light';
}

/**
 * Subscribe to native-theme updates from main + react to settings.appearance.theme.
 * Writes `document.documentElement.dataset.theme` on each resolve.
 */
export function useTheme(choice: ThemeChoice): 'dark' | 'light' {
  const [systemIsDark, setSystemIsDark] = useState<boolean>(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    void window.sidebrowser
      .getNativeTheme()
      .then((v: { shouldUseDarkColors: boolean }) => setSystemIsDark(v.shouldUseDarkColors));
    unsub = window.sidebrowser.onNativeThemeUpdated((v: { shouldUseDarkColors: boolean }) => {
      setSystemIsDark(v.shouldUseDarkColors);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const effective = resolveTheme(choice, systemIsDark);

  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);

  return effective;
}
```

Run: `pnpm test tests/unit/theme-resolver.test.ts` → pass。

- [ ] **Step 3: 加 IPC channels**

[src/shared/ipc-contract.ts](src/shared/ipc-contract.ts) `IpcChannels` 末尾加：

```ts
nativeThemeUpdated: 'chrome:native-theme',
nativeThemeGet: 'chrome:native-theme:get',
```

`IpcContract` interface 加两条：

```ts
[IpcChannels.nativeThemeUpdated]: {
  request: { shouldUseDarkColors: boolean };
  response: void;
};
[IpcChannels.nativeThemeGet]: {
  request: Record<string, never>;
  response: { shouldUseDarkColors: boolean };
};
```

- [ ] **Step 4: 主进程订阅 nativeTheme + handle**

[src/main/index.ts](src/main/index.ts) 顶部 import 加 `nativeTheme`（与 `app` / `BrowserWindow` / `screen` 一行）：

```ts
import { app, BrowserWindow, screen, nativeTheme, ipcMain } from 'electron';
```

`app.whenReady().then(() => { … })` 内，`edgeDock` 实例化完成后、app.on('second-instance') 附近加：

```ts
ipcMain.handle(IpcChannels.nativeThemeGet, () => ({
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
}));

nativeTheme.on('updated', () => {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannels.nativeThemeUpdated, {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    });
  }
});
```

- [ ] **Step 5: 改 preload**

[src/preload/index.ts](src/preload/index.ts) 的 `sidebrowser` 暴露对象加两个方法：

```ts
getNativeTheme: (): Promise<{ shouldUseDarkColors: boolean }> =>
  ipcRenderer.invoke(IpcChannels.nativeThemeGet, {}),

onNativeThemeUpdated: (
  cb: (v: { shouldUseDarkColors: boolean }) => void,
): (() => void) => {
  const handler = (_e: unknown, v: { shouldUseDarkColors: boolean }): void => cb(v);
  ipcRenderer.on(IpcChannels.nativeThemeUpdated, handler);
  return () => { ipcRenderer.removeListener(IpcChannels.nativeThemeUpdated, handler); };
},
```

同时 preload 的 TypeScript 类型声明（`src/preload/index.d.ts` 或 inline Window interface）加对应方法。

- [ ] **Step 6: App.tsx 接入 useTheme**

[src/renderer/src/App.tsx](src/renderer/src/App.tsx) 顶部 import：

```ts
import { useTheme } from './theme/useTheme';
```

组件顶层（现有 settings 已取的位置）加一行：

```ts
useTheme(settings.appearance.theme);
```

（`useTheme` 内部自己处理 document.documentElement.dataset.theme 写入 + nativeTheme 订阅。）

- [ ] **Step 7: Typecheck / lint / test 全绿**

```
pnpm typecheck && pnpm lint && pnpm test
```

- [ ] **Step 8: Commit**

```
git add src/shared/ipc-contract.ts src/main/index.ts src/preload/ src/renderer/src/theme/ src/renderer/src/App.tsx tests/unit/theme-resolver.test.ts
git commit -m "feat(renderer): wire native-theme IPC + useTheme hook setting document data-theme attr"
```

---

## Task 7: Chrome UI 颜色 class → CSS 变量（P2 §7.4）

**Files:** Modify 所有 renderer chrome UI 组件（TopBar / AddressBar / TabDrawer / SettingsDrawer / Section / Row / NumberInput / Slider / 等）。

### 设计

把硬编码的 Tailwind neutral 系色值替换为 CSS 变量驱动的 `[var(--chrome-*)]` arbitrary value。保持布局 / spacing / typography 不变——本 Task 只动颜色。

### 替换规则

| 原 class | 替换为 |
|---|---|
| `bg-neutral-900` | `bg-[var(--chrome-bg)]` |
| `bg-neutral-950` | `bg-[var(--chrome-drawer-bg)]` |
| `bg-neutral-800`（input / control 背景） | `bg-[var(--chrome-input-bg)]` |
| `hover:bg-neutral-800` | `hover:bg-[var(--chrome-hover)]` |
| `text-neutral-100` | `text-[var(--chrome-fg)]` |
| `text-neutral-300` | `text-[var(--chrome-fg)]/80` 或 `text-[var(--chrome-fg)]` + `opacity-80` |
| `text-neutral-400` / `text-neutral-500` | `text-[var(--chrome-muted)]` |
| `border-neutral-700` / `border-neutral-800` | `border-[var(--chrome-border)]` |
| `focus:ring-sky-500` / `accent-sky-500` | **保留不动**（accent 两套主题通用） |

- [ ] **Step 1: Grep 找出所有 neutral-N 使用点**

```
grep -rn "neutral-[0-9]" src/renderer/src/components src/renderer/src/App.tsx src/renderer/src/main.tsx
```

- [ ] **Step 2: 逐文件替换**

按上表在每个命中文件里替换。建议顺序：
1. `TopBar.tsx` / `AddressBar.tsx`（最简单）
2. `TabDrawer.tsx`
3. `SettingsDrawer.tsx`（最多命中）
4. 内部的 Section/Row/NumberInput/Slider 若是独立文件一并改。

**不动**：WebContentsView 相关代码、Dim overlay CSS、Tailwind config（不用扩 theme），只改组件内联 class。

- [ ] **Step 3: dev 启动目测 dark + light**

```
unset ELECTRON_RUN_AS_NODE && pnpm dev
```

在控制台手动：

```js
document.documentElement.dataset.theme = 'dark';  // 应看到现有深色外观
document.documentElement.dataset.theme = 'light'; // 应看到浅色外观
```

目测所有组件颜色合理、文字可读、边框有对比度、hover 效果明显。浅色下 accent（sky-500 蓝）足够可见。

- [ ] **Step 4: Typecheck / lint / test 全绿**

```
pnpm typecheck && pnpm lint && pnpm test
```

- [ ] **Step 5: Commit**

```
git add src/renderer/src/
git commit -m "refactor(renderer): migrate chrome UI neutral palette to CSS variables for theme switching"
```

---

## Task 8: 主题 Settings UI + E2E（P2 §7.7）

**Files:** Modify `src/renderer/src/components/SettingsDrawer.tsx`；新增 `tests/e2e/theme.spec.ts`。

### 设计

SettingsDrawer 加一个 Appearance Section。E2E 覆盖"切 theme → `<html data-theme>` 切换"。

- [ ] **Step 1: SettingsDrawer 加 Appearance Section**

[src/renderer/src/components/SettingsDrawer.tsx](src/renderer/src/components/SettingsDrawer.tsx) 顶部 import 加：

```ts
import type { ThemeChoice } from '@shared/types';
```

在 Window Section 之前（或 Mouse leave 之后，你看序号顺序）插入：

```tsx
<Section title="Appearance">
  <Row label="Theme">
    <select
      data-testid="settings-theme"
      value={settings.appearance.theme}
      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
        void update({ appearance: { theme: e.target.value as ThemeChoice } })
      }
      className="rounded bg-[var(--chrome-input-bg)] px-2 py-1 text-sm text-[var(--chrome-fg)] outline-none focus:ring-1 focus:ring-sky-500"
    >
      <option value="system">System</option>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    </select>
  </Row>
</Section>
```

（style 直接用 Task 7 已迁移好的变量。）

- [ ] **Step 2: 新 E2E spec**

`tests/e2e/theme.spec.ts`：

```ts
import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch';

test.describe('M9 Theme switch', () => {
  test('切换 theme 会更新 <html data-theme>', async () => {
    const { win, close } = await launchApp();
    try {
      // 初始：默认 'system'，resolved theme 取决于 OS — 只断言属性存在且是 dark/light 之一。
      const initial = await win.evaluate(() => document.documentElement.dataset.theme);
      expect(['dark', 'light']).toContain(initial);

      // 切 dark
      await win.evaluate(() => {
        return window.sidebrowser.updateSettings({ appearance: { theme: 'dark' } });
      });
      // 短等让 React effect 跑
      await win.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

      // 切 light
      await win.evaluate(() => {
        return window.sidebrowser.updateSettings({ appearance: { theme: 'light' } });
      });
      await win.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    } finally {
      await close();
    }
  });
});
```

如果 `launchApp` helper 的签名 / 导出方式在 repo 里不同，实现者**先看 [tests/e2e/settings-drawer.spec.ts](tests/e2e/settings-drawer.spec.ts) 等现有 spec** 照着改。

- [ ] **Step 3: Typecheck / lint / test / e2e 全绿**

```
pnpm typecheck && pnpm lint && pnpm test
unset ELECTRON_RUN_AS_NODE && pnpm build && pnpm test:e2e tests/e2e/theme.spec.ts
```

- [ ] **Step 4: Commit**

```
git add src/renderer/src/components/SettingsDrawer.tsx tests/e2e/theme.spec.ts
git commit -m "feat(renderer): add Appearance section to settings drawer + e2e theme switch coverage"
```

---

## Task 9: 全量验收 + version bump + README + 主 spec 同步 + tag

- [ ] **Step 1: 主 spec 同步**

[docs/superpowers/specs/2026-04-23-sidebrowser-design.md](../specs/2026-04-23-sidebrowser-design.md)：
- §2 表 "关闭按钮行为" 改成 `X 按钮即退出；无托盘（v1.1 移除）`。
- §13 milestone 表加 M9 行：`M9（v1.1） | always-on-top + single-instance + theme + settings 解耦 + tray 删除 | 完成`。
- §15 / §17 中若有托盘 / minimize-to-tray 描述清理。
- §2 或 §7 加一段 Appearance：`Chrome UI 支持 system / dark / light 三档主题；跟随 OS 或固定。页面内容不受影响（仍归 Dim 管）`。

- [ ] **Step 2: README 更新**

[README.md](README.md)：
- 已知限制段：删 "tray icon 是 placeholder" 一行；加：
  - "关闭窗口即退出应用（无系统托盘）。"
  - "总在最前——对 exclusive fullscreen（独占全屏的游戏 / 部分 DRM 视频）仍会被覆盖，OS 限制，无解。"
- 功能段加一行主题切换。
- Shortcut 表不动（spec §15 未变）。

- [ ] **Step 3: package.json version bump**

```
1.0.0 → 1.1.0
```

Commit 单独一条：

```
git add package.json
git commit -m "chore(release): bump version to 1.1.0 for M9 release"
```

- [ ] **Step 4: 全量自动化验收**

```
pnpm typecheck
pnpm lint
pnpm test
unset ELECTRON_RUN_AS_NODE && pnpm build
unset ELECTRON_RUN_AS_NODE && pnpm test:e2e
unset ELECTRON_RUN_AS_NODE && pnpm build:installer
ls release/
```

Expected：全绿；`release/sidebrowser-Setup-1.1.0.exe` 产出。

- [ ] **Step 5: 提交 docs / README**

```
git add docs/superpowers/specs/2026-04-23-sidebrowser-design.md README.md
git commit -m "docs(spec+readme): sync M9 changes — theme, always-on-top caveat, tray removal"
```

- [ ] **Step 6: 用户手动冒烟（user 负责）**

交给用户装 `release/sidebrowser-Setup-1.1.0.exe` 到新 Windows 用户目录，按以下清单过一遍：

- [ ] 启动窗口可见，边缘 dock / reveal 正常。
- [ ] Chrome F11 全屏 → 鼠标移到 sidebrowser 所在屏幕边缘 → sidebrowser 正确 reveal 覆盖在 Chrome 全屏之上。
- [ ] 启动 A 实例 → 再双击启动 B → B 无感退出，A 窗口被拉到前台；若 A 此时 HIDDEN_LEFT → 自动变 DOCKED_LEFT 可见。
- [ ] 设置抽屉无 Width/Height 输入；preset dropdown 只有 3 项；切 preset → 窗口变到对应尺寸；改 edge threshold → 窗口**不**变。
- [ ] 外部拖拽窗口改大小 → 关窗重开 → 尺寸保持（`window-bounds` 存活）。
- [ ] 无系统托盘图标；X 按钮关窗即退出。
- [ ] 设置 Theme = System → 切 OS 主题 → sidebrowser chrome UI 跟着切；Theme = Dark → chrome UI 固定深色；Theme = Light → chrome UI 固定浅色。
- [ ] 登录一个站（例如 GitHub）→ 关 → 开 → 仍登录（cookies 持久）。

- [ ] **Step 7: 用户冒烟通过后打 tag**

**⚠️ 用户确认后才执行：**

```
git tag -a m9-ux-stability -m "M9: v1.1 — alwaysOnTop + single-instance lock + settings decouple + tray removal + theme"
```

---

## Post-M9

v1.1 ship。v1.2+ 候选（不在本 plan 范围）：
- GitHub Actions CI（Windows runner）+ release artifact upload。
- 正式 app / tray 设计稿（tray 已删，仅 app icon）。
- macOS 支持（`src/main/platform/darwin.ts`）。
- 主题 accent 色自定义 / 整套配色 JSON 可导入。
- 多窗口同一实例（non-single-instance 的替代）。
- Auto-updater + 代码签名。

---

## Self-review Notes

本 plan 对照 spec 逐段检查：

- spec §3（alwaysOnTop） ↔ Task 1 ✓
- spec §4（单实例锁 + forceRevealIfHidden） ↔ Task 2 ✓
- spec §5（settings 尺寸解耦） ↔ Task 4 ✓
- spec §6（托盘删除） ↔ Task 3 ✓
- spec §7（主题 schema / CSS / IPC / 组件 / UI） ↔ Tasks 5–8 ✓
- spec §8（文件改动汇总） ↔ 各 Task Files 列表 ✓
- spec §9（DoD） ↔ Task 9 Step 4 + Step 6 ✓
- spec §10（out of scope） ↔ plan Post-M9 ✓
- spec §11（同步主文档） ↔ Task 9 Step 1 ✓

Placeholders: 无 TBD / TODO / "implement later"。

Type consistency: `forceRevealIfHidden(): void` 在 Task 2a 定义，Task 2b 的 `SecondInstanceDeps` 与 index.ts 接入同名同签；`ThemeChoice`、`AppearanceSettings` 在 Task 5 定义后 Task 6/8 引用一致；`resolveTheme(choice, systemIsDark)` 签名 Task 6 定义并在单测中使用一致。
