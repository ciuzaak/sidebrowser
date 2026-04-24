# M9 — UX & Stability Fixes 设计文档

**日期：** 2026-04-24
**状态：** 待实现
**前置：** `m8-v1-release` tag、`main` clean、v1.0.0 已发
**目标读者：** 实现本项目的开发者（含子 agent）

---

## 1. 背景

v1 上手后发现 5 个面向用户的短板。本 spec 在一个 milestone 内一并收敛，作为 v1.1 的核心内容。

| # | 问题 | 优先级 |
|---|---|---|
| 1 | edge-dock 窗口未置顶：被全屏应用遮挡后无法呼出 | P0 |
| 2 | 多实例并发时只有第一实例能正确持久化 cookies | P0 |
| 3 | 设置里的 Width/Height 数值与外部拖拽窗口不同步，改任意设置时窗口会回弹到预设尺寸 | P1 |
| 4 | 托盘菜单多余，minimize-to-tray 行为与"关窗即退出"的直觉不符 | P2 |
| 5 | Chrome UI 硬编码深色，缺 system / dark / light 主题切换 | P2 |

全部改动范围小、彼此独立，适合合并为一个 spec + 一份实施计划（与 M8 打包粒度一致）。

---

## 2. 决议摘要

| 项 | 决定 |
|---|---|
| P0.1 置顶 | `alwaysOnTop: true` + `setAlwaysOnTop(true, 'screen-saver')` |
| P0.2 多实例 | 强制单实例；第二实例激活第一实例后立即退出 |
| P1 尺寸解耦 | UI 删 Width/Height；preset 删 `custom`；仅 preset 切换触发 resize |
| P2.1 托盘 | 整个托盘子系统删除；X 按钮 = 退出 |
| P2.2 主题 | 新增 `appearance.theme: system \| dark \| light`（默认 system）；CSS 变量 + `nativeTheme` 订阅 |

---

## 3. §1 — Edge-dock 始终置顶

### 3.1 问题

当用户切到另一个全屏窗口（浏览器 F11、全屏视频、borderless 游戏）后，再把鼠标移回屏幕边缘触发条时，sidebrowser 窗口虽被 CursorWatcher 检出 MOUSE_ENTER 并驱动 EdgeDock reveal，但窗口在 Z-order 上仍压在全屏应用之下，用户看不到。

### 3.2 修复

在 [src/main/index.ts](src/main/index.ts) 创建 BrowserWindow 时新增：

```ts
new BrowserWindow({
  …,
  alwaysOnTop: true,
  …
});

// 创建后显式提升到 fullscreen 覆盖级：
win.setAlwaysOnTop(true, 'screen-saver');
```

`'screen-saver'` 是 Electron 定义的最高 always-on-top level，Windows 下映射到 `HWND_TOPMOST` 的最顶层 Z-band，能覆盖 borderless fullscreen。

### 3.3 不解决

Exclusive fullscreen（DirectX 独占全屏、部分 DRM 视频播放器）会绕过 Windows 的 Z-order，仍会遮挡 sidebrowser。这是 OS 限制，本 spec 不尝试 hack。README 新增一行说明。

### 3.4 测试

- 无自动化：全屏 interop 在 Playwright Electron 里不可稳定复现。
- 手动冒烟列入 Task 7 定义（Chrome F11 场景 + 系统视频播放器全屏场景）。

---

## 4. §2 — 单实例锁

### 4.1 问题

当前 [src/main/index.ts](src/main/index.ts) 无 `requestSingleInstanceLock()`。多实例并发时两套进程共用 `persist:sidebrowser` session partition 与 `window-bounds` / `config.json` 文件，cookies SQLite 层有锁但 Electron 的 session 缓存层不对并发写做保证，产生"只有第一实例看起来保住登录态"的症状。

### 4.2 修复

app 启动最早期（`app.whenReady()` 之前）：

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // 若 EdgeDock 处于 HIDDEN_LEFT/RIGHT，用 M5 已暴露的 forceReveal 路径回到 DOCKED_* 可见态
  edgeDockExecutor.forceRevealIfHidden();
});
```

第二实例命中 → 立即 `app.quit()`。

### 4.3 Edge-dock 联动

若第一实例窗口当前处于 HIDDEN_LEFT/RIGHT，裸 `win.show() + focus()` 只会亮一条 3px 触发条——这不符合"用户双击启动就想看到窗口"的预期。

**实现决策**：在 EdgeDock executor 新增 `forceRevealIfHidden()` 方法：读取当前 reducer state；若是 HIDDEN_LEFT 或 HIDDEN_RIGHT，派发与 MOUSE_ENTER 相同的 reveal 动作；其它状态 no-op。内部复用现有 reveal 动画路径，不新增动画逻辑。方法签名：`forceRevealIfHidden(): void`。

### 4.4 YAGNI

- 不加 `--new-instance` CLI flag。真需要多窗口的用户可等 v2 的"多窗口同一实例"设计。
- 不做 session partition 隔离（与"强制单实例"冲突）。

### 4.5 测试

- 单测：mock `app.requestSingleInstanceLock()` 返回 `false` → 断言 `app.quit` 被调。
- 单测：模拟 `second-instance` 事件 → 断言 `win.show` / `win.focus` 被调 + EdgeDock reveal 路径被触发。
- E2E：不加——Playwright Electron 默认就是单实例启动，自动化没法触发 second-instance。

---

## 5. §3 — Settings 尺寸解耦

### 5.1 问题

现状：
- [src/renderer/src/components/SettingsDrawer.tsx:85-102](src/renderer/src/components/SettingsDrawer.tsx#L85-L102) 暴露 Width / Height NumberInput。
- [src/main/index.ts:247-265](src/main/index.ts#L247-L265) 的 `settingsStore.onChanged` listener 只要 `previous.window.width !== next.window.width` 或 `height` 任一变化就 `win.setBounds(...)`。
- 用户外部拖拽窗口边框后，`window-bounds` store 被 resize 事件驱动更新，但 `settings.window.{width,height}` **不更新**（它是 preset 驱动的）。
- 用户随后改任何设置 → listener 观测到 `settings.window.width/height` 跟 preset 对应的规范值一致、跟运行时实际窗口 bounds 不一致 → `setBounds` 把窗口拉回规范尺寸。

从用户视角：外部拖拽的自定义大小被"任何一次设置修改"悄悄清掉。

### 5.2 修复

**UI 层** ([src/renderer/src/components/SettingsDrawer.tsx](src/renderer/src/components/SettingsDrawer.tsx))：
- 删除 `<Row label="Width">…</Row>` 与 `<Row label="Height">…</Row>` 两行。
- Preset `<select>` 移除 `<option value="custom">Custom</option>`。
- Edge threshold slider 保留。

**Schema** ([src/shared/types.ts](src/shared/types.ts))：
- `WindowSettings.preset` 类型缩为 `'iphone14pro' | 'iphonese' | 'pixel7'`（去掉 `'custom'`）。
- `width` / `height` 字段**保留**——`clampSettings` 需要它们作为 preset 的 downstream 值；它们不再由 UI 驱动，只由 preset 映射。

**Clamp-settings** ([src/main/clamp-settings.ts](src/main/clamp-settings.ts))：
- 迁移逻辑：若传入 `partial.preset === 'custom'`，强制写回 `'iphone14pro'`（默认值），`console.info('[settings] migrating custom preset → iphone14pro')`。
- 现存的 "preset 非 custom → overwrite width/height" 保留。
- 移除 "width/height present without preset → coerce preset='custom'" 分支（既然 custom 不再合法）。

**Main-side bounds apply** ([src/main/index.ts:247-265](src/main/index.ts#L247-L265))：
- 比较字段从 `width !== width || height !== height` 改成 `preset !== preset`。
- 即：只有用户在设置里切 preset 时才 `setBounds` 到新 preset 的规范尺寸；edge threshold / dim / mouse-leave 等其它 settings 变化不再碰窗口 bounds。
- 用户外部拖拽保持独立，`window-bounds` store 逻辑不动。

### 5.3 迁移语义

- 用户旧配置里 `preset === 'custom'` → clampSettings 下一次读到就强制写回 `'iphone14pro'`。
- 外部拖拽尺寸不受影响——它存在 `window-bounds` store，与 `settings.window` 解耦。用户下次显式切 preset 前，窗口保持当前拖拽尺寸。
- `settings.window.width/height` 的字段值此后永远等于 preset 的规范值——不代表实际窗口大小。实际窗口大小以 `window-bounds` 为准。

### 5.4 测试

**单测** ([tests/unit/clamp-settings.test.ts](tests/unit/clamp-settings.test.ts))：
- 新增 case：`clampSettings({ window: { preset: 'custom' } }, defaults)` → `preset === 'iphone14pro'`, `width === 393`, `height === 852`。
- 新增 case：老数据里 `{ preset: 'custom', width: 400, height: 800 }` → 清洗为 iphone14pro 规范值，不保留 400/800。
- 移除：`width/height present without preset → preset='custom'` case（该分支已不存在）。

**E2E** ([tests/e2e/settings-drawer.spec.ts](tests/e2e/settings-drawer.spec.ts))：
- 改：断言 `settings-window-width` / `settings-window-height` testid **不存在**。
- 新增：切 preset iphone14pro → pixel7 → 断言窗口 bounds 变为 412×915（或 clamp 后合法近似值）。
- 新增：切任意非-preset 设置（例：edge threshold 从 8 → 12）→ 断言窗口 bounds **不变**。

---

## 6. §4 — 移除托盘

### 6.1 问题

M7 引入了托盘 + `closeAction` 设置（`minimize-to-tray` / `quit`）。实际使用中：
- 用户点 X 习惯性期望"关掉"，minimize-to-tray 反直觉。
- 托盘菜单只有 Show / Quit，没有真正的价值。
- 托盘图标本身是 placeholder，视觉上扣分。

### 6.2 删除清单

**代码文件**：
- `src/main/tray-manager.ts` — 删。
- `src/main/close-action-resolver.ts` — 删。
- `tests/unit/tray-manager.test.ts` — 删。
- `tests/unit/close-action-resolver.test.ts`（若存在）— 删。
- `tests/e2e/tray-close-action.spec.ts` — 删。

**资源**：
- `resources/tray/*.png` — 删。
- `scripts/generate-tray-icons.mjs` — 删。
- [electron-builder.yml](electron-builder.yml) 的 `extraResources` 里引用 tray 资源的条目 — 删（若删后 extraResources 空则整段删）。

**Schema / 引用**：
- [src/shared/types.ts](src/shared/types.ts)：`LifecycleSettings.closeAction` 字段删。若 `lifecycle` section 只有此字段，整段删。
- [src/main/settings.ts](src/main/settings.ts) 的 defaults 对应删。
- [src/main/clamp-settings.ts](src/main/clamp-settings.ts) 对 lifecycle 的 clamp 逻辑删。
- [src/renderer/src/components/SettingsDrawer.tsx](src/renderer/src/components/SettingsDrawer.tsx) 的"Close action" Row 删；若整个 Lifecycle Section 只有这个字段，整段删。
- [src/main/index.ts](src/main/index.ts)：TrayManager 实例化删；`win.on('close', …)` 中依赖 `resolveCloseAction` 的分支删，恢复 Electron 默认 close → destroy 流程。
- [src/shared/ipc-contract.ts](src/shared/ipc-contract.ts)：若有 tray 相关 IPC 渠道名，删。

### 6.3 行为

- X 按钮 → Electron 默认 close 事件 → 窗口 destroy → `window-all-closed` → app 退出（Windows/Linux 标准行为）。
- 无托盘图标。
- 无"最小化到托盘"概念。

### 6.4 迁移

- 用户旧 `config.json` 里的 `lifecycle.closeAction` 字段被 `clampSettings` 自然忽略（schema 不再认该字段，electron-store 的非严格合并把它丢弃）。
- 无 console 日志——静默丢弃陌生字段是 electron-store 既有行为，不值得加 warn。

### 6.5 测试

- 删除上述 3 个测试文件。
- 现有 `tests/e2e/persistence.spec.ts` 等可能引用 closeAction 设置——检查并改：默认就是"关窗即退出"，不再需要显式设 `closeAction: 'quit'`。

### 6.6 README

[README.md](README.md)：
- 已知限制里"tray icon 是 placeholder"删。
- 如有"最小化到托盘"描述删。
- 新增一行"关闭窗口即退出应用（无系统托盘）"到功能/行为段。

---

## 7. §5 — 主题 system/dark/light

### 7.1 目标

Chrome UI（TopBar / SettingsDrawer / TabDrawer / AddressBar 等 sidebrowser 自家 UI）支持三档主题切换：
- **system**（默认）：跟随 OS 主题。
- **dark**：始终深色。
- **light**：始终浅色。

**不改变**：WebContentsView 里的网页内容渲染——那归 Dim 特效管，两套系统正交。

### 7.2 Schema 新增

[src/shared/types.ts](src/shared/types.ts)：

```ts
export type ThemeChoice = 'system' | 'dark' | 'light';

export interface AppearanceSettings {
  theme: ThemeChoice;
}

export interface Settings {
  window: WindowSettings;
  mouseLeave: MouseLeaveSettings;
  dim: DimSettings;
  edgeDock: EdgeDockSettings;
  mobile: MobileSettings;
  appearance: AppearanceSettings;  // 新增
}
```

[src/main/settings.ts](src/main/settings.ts) defaults：

```ts
appearance: { theme: 'system' }
```

clampSettings 对 `theme` 做白名单校验（非法值 → `'system'`）。

### 7.3 CSS 变量骨架

[src/renderer/src/styles/globals.css](src/renderer/src/styles/globals.css)：

```css
:root[data-theme='dark'] {
  --chrome-bg: #1a1a1a;
  --chrome-fg: #f5f5f5;
  --chrome-border: #2d2d2d;
  --chrome-hover: #262626;
  --chrome-muted: #737373;
  --chrome-input-bg: #262626;
  --chrome-drawer-bg: #1a1a1a;
  --chrome-accent: #0ea5e9;  /* sky-500 */
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

html, body { background: var(--chrome-bg); color: var(--chrome-fg); }
```

最终 hex 在实施时微调，接受"标准浅灰 + sky-500 accent"起点。

### 7.4 组件替换

当前 chrome UI 硬编码 Tailwind 色（`bg-neutral-900` / `text-neutral-100` / `border-neutral-800` / `bg-neutral-800` / `hover:bg-neutral-800` / `text-neutral-300` / `text-neutral-500` 等），需按语义替换成 CSS 变量：

| 原 class | 替换为 |
|---|---|
| `bg-neutral-900` | `bg-[var(--chrome-bg)]` |
| `bg-neutral-950` 或 drawer bg | `bg-[var(--chrome-drawer-bg)]` |
| `bg-neutral-800`（input / control） | `bg-[var(--chrome-input-bg)]` |
| `text-neutral-100` | `text-[var(--chrome-fg)]` |
| `text-neutral-300` | `text-[var(--chrome-fg)]` + `opacity-80` |
| `text-neutral-500` | `text-[var(--chrome-muted)]` |
| `border-neutral-800` | `border-[var(--chrome-border)]` |
| `hover:bg-neutral-800` | `hover:bg-[var(--chrome-hover)]` |

实现者批量 grep + 一次审视替换，不要漏。

**Scope**：只替换 chrome UI 组件（TopBar、AddressBar、TabDrawer、SettingsDrawer、Section/Row/NumberInput/Slider 等）。WebContentsView 与 Dim overlay 的颜色逻辑保持原样。

### 7.5 Main → Renderer 主题推送

新 IPC 渠道 [src/shared/ipc-contract.ts](src/shared/ipc-contract.ts)：

```ts
nativeThemeUpdated: 'chrome:native-theme'        // M→R event
nativeThemeGet: 'chrome:native-theme:get'        // R→M invoke，初值查询
```

M→R event 载荷 `{ shouldUseDarkColors: boolean }`；R→M invoke 同 return。

[src/main/index.ts](src/main/index.ts) 的 `app.whenReady` 内新增：

```ts
import { nativeTheme } from 'electron';

nativeTheme.on('updated', () => {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannels.nativeThemeUpdated, {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    });
  }
});

ipcMain.handle(IpcChannels.nativeThemeGet, () => ({
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
}));
```

[src/preload/index.ts](src/preload/index.ts) 暴露 `onNativeThemeUpdated(cb)` 与 `getNativeTheme()`。

### 7.6 Renderer 主题解析

新增 `src/renderer/src/theme/useTheme.ts` 或类似：

```ts
function resolveTheme(choice: ThemeChoice, systemIsDark: boolean): 'dark' | 'light' {
  if (choice === 'dark') return 'dark';
  if (choice === 'light') return 'light';
  return systemIsDark ? 'dark' : 'light';
}
```

App.tsx 订阅 `settings.appearance.theme` + native-theme IPC，合成 `effectiveTheme`，effect 里 `document.documentElement.dataset.theme = effectiveTheme`。

### 7.7 Settings UI

SettingsDrawer 新增一个 Section：

```tsx
<Section title="Appearance">
  <Row label="Theme">
    <select
      data-testid="settings-theme"
      value={settings.appearance.theme}
      onChange={(e) => void update({ appearance: { theme: e.target.value as ThemeChoice } })}
    >
      <option value="system">System</option>
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    </select>
  </Row>
</Section>
```

样式上这个 `<select>` 本身也要用主题变量。

### 7.8 测试

**单测** (`tests/unit/theme-resolver.test.ts`)：≥4 case
- `resolveTheme('dark', true)` → `'dark'`
- `resolveTheme('dark', false)` → `'dark'`
- `resolveTheme('light', true)` → `'light'`
- `resolveTheme('system', true)` → `'dark'`
- `resolveTheme('system', false)` → `'light'`

**单测** (`tests/unit/clamp-settings.test.ts` 追加)：非法 theme 值 → 清洗为 `'system'`。

**E2E** (`tests/e2e/theme.spec.ts`)：
- 切 theme system → dark → light，断言 `<html data-theme="...">` 对应变化。
- 可选：断言 TopBar 某个元素的 computed backgroundColor 跟主题变量一致。

---

## 8. 文件改动汇总

| 路径 | 动作 |
|---|---|
| `src/main/index.ts` | 修改（alwaysOnTop / 单实例锁 / 主题 IPC / 删托盘 / 改 bounds listener） |
| `src/main/tray-manager.ts` | **删** |
| `src/main/close-action-resolver.ts` | **删** |
| `src/main/clamp-settings.ts` | 修改（custom preset 迁移、删 lifecycle、加 theme 校验） |
| `src/main/settings.ts` | 修改（删 lifecycle、加 appearance.theme） |
| `src/shared/types.ts` | 修改（删 closeAction、加 AppearanceSettings、preset 去 custom） |
| `src/shared/ipc-contract.ts` | 修改（删 tray-related channel、加 native-theme channel） |
| `src/preload/index.ts` | 修改（加 onNativeThemeUpdated / getNativeTheme） |
| `src/renderer/src/App.tsx` | 修改（theme effect 订阅 + `data-theme` 设置） |
| `src/renderer/src/theme/useTheme.ts` | 新增 |
| `src/renderer/src/components/SettingsDrawer.tsx` | 修改（删 width/height/custom/closeAction、加 Theme Section、替换颜色 class） |
| `src/renderer/src/components/TopBar.tsx` 等 chrome UI | 修改（颜色 class → CSS 变量） |
| `src/renderer/src/styles/globals.css` | 修改（新增 CSS 变量、dark/light 两套） |
| `tests/unit/tray-manager.test.ts` | **删** |
| `tests/unit/close-action-resolver.test.ts` | **删**（若存在） |
| `tests/unit/clamp-settings.test.ts` | 修改（加 custom 迁移 / theme 校验；删 custom 相关 case） |
| `tests/unit/single-instance.test.ts` | 新增 |
| `tests/unit/theme-resolver.test.ts` | 新增 |
| `tests/e2e/tray-close-action.spec.ts` | **删** |
| `tests/e2e/settings-drawer.spec.ts` | 修改（删 width/height 断言、加 preset resize / 非 preset 不 resize） |
| `tests/e2e/theme.spec.ts` | 新增 |
| `tests/e2e/persistence.spec.ts` 等 | 审视是否引用 closeAction，按需清理 |
| `resources/tray/` | **删整个目录** |
| `scripts/generate-tray-icons.mjs` | **删** |
| `electron-builder.yml` | 修改（extraResources 清理 tray 条目） |
| `README.md` | 修改（删 tray placeholder 一行、加 always-on-top 限制与主题说明） |

---

## 9. 验收 (Definition of Done)

- `pnpm typecheck / lint / test / build / test:e2e` 全绿。
- 装/跑：打开 Chrome F11 全屏 → 移鼠标到 sidebrowser 所在屏幕边缘 → sidebrowser 正确 reveal 覆盖在 Chrome 全屏之上。
- 装/跑：启动 sidebrowser A 实例 → 再启 B 实例 → B 立即退出、A 窗口被调到前台（若隐藏则恢复可见）。
- 装/跑：设置抽屉无 Width/Height 输入；preset dropdown 只有三项；切 preset 触发 resize；调 edge threshold 不 resize；外部拖拽改变的尺寸在切其它设置后依然保留。
- 装/跑：无系统托盘图标；X 按钮关窗即退出。
- 装/跑：设置里 Theme 三档；system 跟随 OS 切换；dark / light 立刻生效。
- README 更新已知限制段（exclusive fullscreen 遮挡、单实例、无托盘、主题三档）。
- `package.json` version → `1.1.0`。
- `m9-ux-stability` tag（用户冒烟确认后打）。

---

## 10. 不做 (Out of Scope)

- 多窗口 / 多会话 profile 隔离（v2）。
- WebContentsView 内页面内容的主题联动（依然归 Dim 特效）。
- 正式 app / tray 设计稿（托盘既然删了自然无关）。
- macOS 适配（仍 v1.1+ 继续推）。
- GitHub Actions CI（v1.1 之后考虑）。
- Auto-updater / 代码签名。
- 内置页内搜索、下载管理、书签、tab 拖拽等。
- 触发条宽度 / 主题 accent 色自定义（当前 accent 硬编码 sky-500，真要自定义再开 spec）。

---

## 11. 与 spec 主文档的关系

本 spec 是 [2026-04-23-sidebrowser-design.md](2026-04-23-sidebrowser-design.md) 的 **增量补丁**，不取代主 spec。主 spec 中以下条目需在实施后同步：
- §2 已确认需求表 "关闭按钮行为" 改为 "默认退出，无托盘"。
- §13 milestone 表新增 M9 行。
- §15 / §17 内托盘相关描述清理。
- 新增一段"主题"描述到 §2 或 §10。
