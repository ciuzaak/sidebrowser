# sidebrowser 设计文档

**日期：** 2026-04-23
**状态：** 待实现
**目标读者：** 实现本项目的开发者（含子 agent）

---

## 1. 项目定位

一款定位为"侧边浮窗"的 Electron 浏览器，用于在工作时随手瞟一眼手机版网页/平台消息。核心差异化：

1. 基础的导航栏和浏览功能，Cookie 持久化以支持平台持久登录。
2. 默认以手机尺寸比例显示；网页默认按移动端渲染；两者都可切换/调整。
3. 窗口**不贴屏幕边缘**时，鼠标离开应用 → 网页内容自动变暗/变白/变模糊（效果可选、强度可调）。
4. 窗口**贴屏幕边缘**时，鼠标离开应用 → 除上述滤镜外，窗口自动缩出屏幕，只留一条极细触发条；鼠标移到触发条上重新唤出。缩边动画可选「平滑」或「瞬间」。

平台范围：**v1 仅 Windows**。架构保留 Mac 扩展空间（平台相关代码隔离在 `src/main/platform/`）。

---

## 2. 已确认的需求细节

| 项 | 决定 |
|---|---|
| 平台 | v1 仅 Windows，后续可加 Mac |
| 浏览 UI | 多 tab，tab 以**展开菜单**形式展示（侧边窗空间窄） |
| Tab session | 所有 tab 共享 `persist:sidebrowser` 持久化分区（Cookie 共享） |
| Tab 跨会话持久化 | 是 |
| "鼠标离开"定义 | **鼠标物理坐标离开窗口矩形**（与窗口焦点无关） |
| 触发延迟 | 默认 **100ms**，设置中可调（0–2000ms） |
| 贴边支持 | 仅左右两侧；阈值默认 8px，可调 |
| 贴边后唤出机制 | **留 3px 触发条**（可调 1–10px），鼠标移到触发条上展开。**不**抢焦点 |
| 尺寸调整 | 预设（iPhone 14 Pro / iPhone SE / Pixel 7）+ 自由拖动；默认 iPhone 14 Pro（393×852）|
| 移动端切换粒度 | **每 tab 独立**切换 UA |
| 默认移动端 UA | iOS Safari（兼容性最佳） |
| 设置 UI | 右侧覆盖式抽屉 |
| 关闭按钮行为 | X 按钮即退出应用（M9 移除托盘） |

**Appearance（M9 新增）：** Chrome UI 支持 system / dark / light 三档主题（`appearance.theme`）；system 跟随 OS `nativeTheme.shouldUseDarkColors`。页面内容渲染不受影响（仍由 Dim 特效管）。

---

## 3. 技术栈

| 组件 | 选择 | 理由 |
|---|---|---|
| Electron | 33+ 稳定版 | `WebContentsView` 需 ≥ 30 |
| 语言 | TypeScript，strict mode | 状态机/IPC 多，类型安全省事 |
| 构建 | `electron-vite` | 社区最成熟的 Electron + Vite + React 模板，一步到位 |
| Renderer 框架 | React 18 | chrome UI 有 tab 抽屉、设置抽屉等，用 React 扛复杂度 |
| 状态管理 | Zustand | main↔renderer 状态镜像友好；比 Redux 轻 |
| 样式 | Tailwind CSS | 侧边窗 UI 简单，按需打包 |
| 图标 | lucide-react | — |
| 设置持久化 | `electron-store` | 单文件 JSON，够用 |
| 打包 | `electron-builder` | Windows NSIS 安装包现成 |
| 测试 | Vitest（单元/集成）+ `@playwright/test` 的 `_electron`（E2E） | — |
| 包管理 | pnpm | 快、省磁盘 |
| 原生模块 | **不引入** | 选了"3px 触发条"方案，不需要 `uiohook-napi`，省掉原生编译依赖 |

---

## 4. 架构

### 4.1 进程模型

```
┌──────────────────────────────────────────────────────────────┐
│ Main 进程 (Node.js)                                           │
│  ├── WindowManager   — BrowserWindow 生命周期、bounds          │
│  ├── ViewManager     — 每个 tab 对应一个 WebContentsView       │
│  ├── EdgeDock        — 贴边检测、隐藏/唤出状态机 + 动画         │
│  ├── DimController   — 鼠标离开时对活跃 tab 应用滤镜            │
│  ├── SessionManager  — 持久化 session、Cookies、UA 切换         │
│  ├── MobileEmulation — Chromium device emulation + CH 头改写  │
│  ├── SettingsStore   — electron-store JSON                    │
│  └── IpcRouter       — main ↔ renderer 的类型化 IPC            │
└──────────────────────────────────────────────────────────────┘
                   ↕ IPC (contextBridge)
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React + Vite) — "chrome UI" 层                      │
│  ├── TopBar            — 后退/前进/刷新/地址栏/UA 切换          │
│  ├── TabDrawer         — 展开式 tab 菜单                        │
│  ├── SettingsDrawer    — 右侧覆盖式抽屉                         │
│  └── EdgeTriggerStrip  — 隐藏时的 3px 触发热区（React 侧可视化） │
└──────────────────────────────────────────────────────────────┘
                   ↕ main 将 WebContentsView 叠放于 chrome 下方
┌──────────────────────────────────────────────────────────────┐
│ WebContentsView × N — 每 tab 一个，bounds 由 main 计算          │
│    { x: 0, y: chromeH, w: winW, h: winH - chromeH }           │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 关键边界说明

- Chrome UI（React）和网页内容（WebContentsView）不在同一个渲染表面。React `<body>` 只占顶部 chrome 区域；下方网页由 main 进程贴 WebContentsView 到窗口上。
- 当 chrome 尺寸变化（如 tab 抽屉展开），renderer 通过 `ResizeObserver` 捕获自身高度，发 IPC 通知 main，main 重算并设置 WebContentsView 的 bounds。
- **设置抽屉采用覆盖式**（盖在网页内容上方），不挤压网页——避免每次开抽屉都重算视口、抖动。

### 4.3 目录结构

```
sidebrowser/
├── package.json
├── tsconfig.json
├── vite.config.ts           # electron-vite 配置
├── tailwind.config.js
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts                 # 入口：app.ready、生命周期
│   │   ├── window-manager.ts
│   │   ├── view-manager.ts          # 每 tab 一个 WebContentsView
│   │   ├── edge-dock.ts             # 贴边自动隐藏的状态机
│   │   ├── edge-dock-reducer.ts     # 纯 reducer（单测用）
│   │   ├── dim-controller.ts
│   │   ├── session-manager.ts
│   │   ├── settings-store.ts
│   │   ├── ipc-router.ts
│   │   ├── cursor-watcher.ts        # 50ms 轮询 screen.getCursorScreenPoint
│   │   └── platform/
│   │       ├── index.ts             # 平台分发
│   │       └── windows.ts           # Windows 特有调用
│   ├── preload/
│   │   └── index.ts                 # contextBridge 暴露的 API
│   ├── renderer/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── TopBar.tsx
│   │   │   ├── TabDrawer.tsx
│   │   │   ├── SettingsDrawer.tsx
│   │   │   └── EdgeTriggerStrip.tsx
│   │   ├── hooks/
│   │   │   ├── useTabs.ts
│   │   │   ├── useSettings.ts
│   │   │   └── useWindowState.ts
│   │   ├── store/
│   │   │   └── index.ts             # Zustand
│   │   └── styles/globals.css       # tailwind base
│   └── shared/
│       ├── types.ts                 # Tab、Settings、WindowState 类型
│       └── ipc-contract.ts          # IPC 通道名 + payload 类型
└── tests/
    ├── unit/                        # main 侧纯函数/状态机
    └── e2e/                         # Playwright for Electron
```

---

## 5. 核心子系统

### 5.1 EdgeDock — 贴边隐藏状态机

**状态：**

```
DOCKED_NONE        — 窗口不靠任何边
DOCKED_LEFT        — |win.x − display.x| ≤ edgeThresholdPx
DOCKED_RIGHT       — |(win.x + win.width) − (display.x + display.width)| ≤ edgeThresholdPx
HIDING             — 正在隐藏动画中
HIDDEN_LEFT/RIGHT  — 已隐藏，只剩 triggerStripPx 在屏幕上
REVEALING          — 正在唤出动画中
```

判定所用的 `display` 为"当前窗口矩形中心点所在的 display 的 workArea"（由 `screen.getDisplayMatching(winBounds)` 获取）——多显示器下以窗口所在那块屏幕为准。

**事件源：**
- `MOUSE_LEAVE` / `MOUSE_ENTER` — 由 `cursor-watcher.ts` 每 50ms 轮询 `screen.getCursorScreenPoint()` 对比 `win.getBounds()` 产生。
- `WINDOW_MOVED` — 用户拖动后重新检测是否贴边。
- `DISPLAY_CHANGED` — `screen.display-removed` / `display-metrics-changed`。

**为什么统一用 main 轮询：**
Chrome UI 和 WebContentsView 是两个独立绘制表面，双端挂监听合流复杂；main 轮询一次就覆盖整个窗口矩形，**且隐藏时也有效**（隐藏时没有 DOM 可供监听）。50ms 轮询成本就是一次坐标对比，可忽略。

**关键状态转移：**

| 来源 | 事件 | 目标 | 附加动作 |
|---|---|---|---|
| DOCKED_NONE | MOUSE_LEAVE (delay) | DOCKED_NONE | DimController 应用滤镜 |
| DOCKED_NONE | MOUSE_ENTER | DOCKED_NONE | DimController 取消滤镜 |
| DOCKED_LEFT/RIGHT | MOUSE_LEAVE (delay) | HIDING → HIDDEN_* | 应用滤镜 + 启动隐藏动画 |
| HIDDEN_* | MOUSE_ENTER（进入 3px 触发条） | REVEALING → DOCKED_* | 取消滤镜 + 启动唤出动画 |
| DOCKED_* | WINDOW_MOVED（离边） | DOCKED_NONE | — |
| HIDING | MOUSE_ENTER | REVEALING | 取消中途隐藏，反向动画 |
| any | DISPLAY_CHANGED | DOCKED_NONE | 若 bounds 不在任何显示器内，snap 回主屏中心 |

**纯 reducer 设计：**
`edge-dock-reducer.ts` 导出 `reduce(state, event, cfg) => { nextState, effects[] }`，effects 是枚举式副作用描述，M5 共 7 种：
- `APPLY_DIM` / `CLEAR_DIM` — DimController 驱动
- `ANIM_HIDE { side, targetX, ms }` / `ANIM_REVEAL { side, targetX, ms }` — executor 启动 setInterval 插值到 `targetX`
- `ANIM_CANCEL` — 取消当前动画（mid-hide cancel 路径）
- `SNAP_TO_CENTER { workArea, windowWidth }` — 显示器变化后窗口完全离屏时回到主屏中心
- `BROADCAST_STATE { docked, hidden, dimmed }` — main→renderer 事件（走 IPC `window:state` 通道）

reducer 内部缓存最后一次知道的 `workArea`，`WINDOW_MOVED` / `DISPLAY_CHANGED` 更新；`MOUSE_LEAVE`/`MOUSE_ENTER` 使用缓存 + `cfg.windowWidth` 算 `targetX`。reducer 不知道 "当前真实 X"，由 executor 在动画起点从 `getWindowBounds()` 读取 `fromX`，实现中途取消动画可以从当前位置反向。`edge-dock.ts` 拿到 effects 后真实执行（`setBounds` 动画、DimController 调用、IPC 广播），reducer 100% 单测覆盖，不碰真实窗口。

**隐藏实现（Windows）：**
不卸载窗口，改 X 坐标出屏。左侧贴边时 `setBounds({ x: -width + triggerStripPx })`，3px 仍在屏幕上，鼠标命中时轮询能检测到。

**动画：**
Electron 的 `setBounds(bounds, animate)` 的 `animate` 参数只在 macOS 生效。Windows 上用 `setInterval(16ms)` 插值 X 坐标，ease-out-cubic 缓动，默认 200ms。设置里可选「平滑 200/150/100ms」或「瞬间（0ms）」。瞬间模式直接一次 `setBounds` 到位。

### 5.2 DimController — 滤镜控制

**实现：** `webContents.insertCSS()` 注入：

```css
html {
  filter: blur(8px) brightness(0.3);
  transition: filter 150ms ease-out;
}
```

返回的 key 存起来，取消时 `removeInsertedCSS(key)`。Chrome UI 在另一个进程，不受影响。

滤镜**只作用于活跃 tab 的 WebContentsView**——后台 tab 反正看不见。

**设置项：**

| 项 | 类型 | 默认 | 范围 |
|---|---|---|---|
| `effect` | `'dark'` / `'light'` / `'blur'` / `'none'` | `'blur'` | — |
| `blurPx` | number | 8 | 0–40 |
| `darkBrightness` | number | 0.3 | 0–1 |
| `lightBrightness` | number | 1.5 | 1–3 |
| `transitionMs` | number | 150 | 0–1000 |

v1 四选一单选；组合效果（如 blur+dark）推后。

### 5.3 ViewManager — Tab 与 WebContentsView 生命周期

**数据模型：**
```ts
interface Tab {
  id: string;           // nanoid
  title: string;
  url: string;
  favicon?: string;
  isMobile: boolean;    // 独立 UA 切换
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}
```

**活跃规则：**
- 每 tab 对应一个 `WebContentsView`，共用 `persist:sidebrowser` session。
- 只有活跃 tab 的 view 可见；其余 view **保持存活但 bounds = {0,0,0,0}**——后台 tab 不丢 JS 状态，也不占绘制。
- v1 不做睡眠/挂起。后续多 tab RAM 吃紧再加。

**WebContentsView 事件 → IPC `tab:updated` 转发：**
- `page-title-updated` → tab.title
- `page-favicon-updated` → tab.favicon
- `did-start-loading` / `did-stop-loading` → tab.isLoading
- `did-navigate` → tab.url + canGoBack/canGoForward
- `did-create-window`（新窗口请求）→ **默认在新 tab 打开**（可配置，v1 先硬编码）

**Tab 持久化：** tabs[]（id/url/isMobile）debounce 1s 写入 electron-store，启动时恢复。

### 5.4 SessionManager — Cookies 与 UA

- `session.fromPartition('persist:sidebrowser')`，Cookies/localStorage/IndexedDB 持久化到 `<userData>/Partitions/persist%3Asidebrowser/`。
- 移动端 UA（iOS Safari）：
  ```
  Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1
  ```
- 桌面 UA：Electron 默认。
- 切换：`webContents.setUserAgent(ua)` + `reloadIgnoringCache()`，保留 URL。
- 现代站点（X.com 等）通过 Client Hints (`Sec-CH-UA-Mobile`、`Sec-CH-UA-Platform`、`navigator.userAgentData.*`) 与触摸/指针媒体查询决定布局，UA 字符串只是其中一个信号。`setUserAgent` 不足以让站点切真移动版。SessionManager（`mobile-emulation.ts` 模块，M10 引入）补两件事：(a) `wc.enableDeviceEmulation({ screenPosition: 'mobile' })` 翻 Chromium 内部 mobile flag → 触摸 / `(pointer:coarse)` / `(hover:none)` / `userAgentData.mobile` 全部按移动设备表现；(b) `session.webRequest.onBeforeSendHeaders` 改 `Sec-CH-UA-Mobile/Platform/Platform-Version`。Client Hints 元数据按 UA 字符串自动推导（iPhone/iPad → iOS、Android → Android、其他 → fallback iOS），用户改 `mobileUserAgent` 时自动同步。不用 CDP `webContents.debugger`，避免与 F12 DevTools 互斥。详见 [M10 design doc](../specs/2026-04-27-mobile-emulation-clienthints-design.md)。

---

## 6. IPC 契约

`src/shared/ipc-contract.ts` 单文件定义所有通道名 + 类型，main/renderer 双侧 import。

| Domain | Channel | 方向 | 载荷 | 返回 |
|---|---|---|---|---|
| tab | `tab:create` | R→M invoke | `{url?}` | `Tab` |
| tab | `tab:close` | R→M invoke | `{id}` | void |
| tab | `tab:activate` | R→M invoke | `{id}` | void |
| tab | `tab:navigate` | R→M invoke | `{id, url}` | void |
| tab | `tab:go-back` / `go-forward` / `reload` | R→M invoke | `{id}` | void |
| tab | `tab:set-mobile` | R→M invoke | `{id, isMobile}` | void |
| tab | `tab:updated` | M→R event | `Tab` | — |
| tab | `tabs:snapshot` | M→R event | `TabsSnapshot` | — |
| settings | `settings:get` | R→M invoke | — | `Settings` |
| settings | `settings:update` | R→M invoke | `Partial<Settings>` | `Settings` |
| settings | `settings:changed` | M→R event | `Settings` | — |
| chrome | `chrome:set-height` | R→M send | `{heightPx}` | — |
| window | `window:state` | M→R event | `{docked, hidden, dimmed}` | — |
| window | `window:close` | R→M invoke | — | void |
| app | `app:ready` | M→R event | 初始 state 快照 | — |
| app | `app:quit` | R→M invoke | — | void |

**M2 broadcasts split:** `tabs:snapshot` fires on collection-wide changes (create/close/activate); `tab:updated` fires on per-tab field changes (url/title/loading/history). Carrying the full `Tab` (rather than a partial patch) keeps the renderer's Zustand store update deterministic and avoids ordering bugs when several updates batch.

`chrome:set-height` 是关键：React TopBar 用 `ResizeObserver` 监听自身高度变化，发给 main 重定位 WebContentsView。设置抽屉是覆盖式不触发此事件。

---

## 7. Settings Schema

```ts
interface Settings {
  window: {
    width: number;              // 393
    height: number;             // 852
    preset: 'iphone14pro' | 'iphonese' | 'pixel7';  // no 'custom' — M9 解耦
    edgeThresholdPx: number;    // 8,  0–50
  };
  mouseLeave: {
    delayMs: number;            // 100, 0–2000
  };
  dim: {
    effect: 'dark' | 'light' | 'blur' | 'none';  // 'blur'
    blurPx: number;             // 8,   0–40
    darkBrightness: number;     // 0.3, 0–1
    lightBrightness: number;    // 1.5, 1–3
    transitionMs: number;       // 150, 0–1000
  };
  edgeDock: {
    enabled: boolean;           // true
    animationMs: number;        // 200; 0 = 瞬间
    triggerStripPx: number;     // 3,   1–10
  };
  lifecycle: {
    // closeAction 已移除（M9 托盘移除，X 直接退出）
    restoreTabsOnLaunch: boolean;  // true
  };
  browsing: {
    defaultIsMobile: boolean;   // true
    mobileUserAgent: string;    // iPhone Safari UA
  };
  appearance: {
    theme: 'system' | 'dark' | 'light';  // 'system'；控制 chrome UI 配色
  };
}
```

**校验：** v1 不引入 Zod，靠 TypeScript 类型 + setter 里 `clamp(value, min, max)`。schema 变复杂后再上 Zod。

**持久化：** `electron-store`，带 `defaults`，加载时浅合并——升级新增字段可被默认值兜住。

---

## 8. 数据流示例

### 8.1 打开新 tab
```
React "+" 按钮 onClick
  → invoke('tab:create', { url: 'about:blank' })
    → ViewManager.createTab()
       ├─ new WebContentsView(session: 'persist:sidebrowser')
       ├─ UA = settings.browsing.defaultIsMobile ? mobileUA : undefined
       ├─ contentView.addChildView(view)
       ├─ 挂载 title/favicon/nav/loading 监听 → 'tab:updated'
       └─ activateTab(id)
    ← 返回 Tab 对象
  Zustand store.tabs.push(tab) → TabDrawer 重渲染
```

### 8.2 鼠标离开（贴右边）
```
cursor-watcher 50ms 轮询：cursor 超出 bounds
  → delay 100ms 后 dispatch(MOUSE_LEAVE)
  → EdgeDock.reduce: DOCKED_RIGHT + MOUSE_LEAVE → HIDING, effects=[APPLY_DIM, ANIM_HIDE]
  → executor:
       ├─ DimController.apply(activeView, settings.dim)  [insertCSS]
       └─ 动画循环: setBounds X 从 dockedX → (screen.width - triggerStripPx) 用时 200ms
       → onComplete: reduce(HIDING, ANIM_DONE) → HIDDEN_RIGHT
  → emit 'window:state' { docked: 'right', hidden: true, dimmed: true }
Renderer TopBar 淡出（CSS class 切换）
```

### 8.3 调整模糊强度
```
SettingsDrawer slider onChange
  → invoke('settings:update', { dim: { blurPx: 16 } })
    → SettingsStore.merge + 持久化
    → 若 DimController 正 active：DimController.restyle(newDim)
      （removeInsertedCSS(oldKey) + insertCSS(newRule) 立即生效，保持 active 态不解除）
    → broadcast 'settings:changed' 全量 Settings
  Renderer Zustand 更新 → Slider 反映 canonical 值
```

---

## 9. 持久化清单

| 数据 | 位置 | 写入时机 |
|---|---|---|
| 所有设置 | `electron-store` → `<userData>/config.json` | 每次 `settings:update` |
| Tab 列表（id/url/isMobile） | 同上 | create/close/navigate 时 debounce 1s |
| 窗口位置 & 尺寸 | 同上 | resize/move debounce 1s + `will-quit` |
| 活跃 tab id | 同上 | `tab:activate` 时 |
| Cookies / localStorage / IndexedDB | `<userData>/Partitions/persist%3Asidebrowser/` | Chromium 自动 |

用户数据目录：Windows 下 `%APPDATA%\sidebrowser\`。

---

## 10. 错误处理与边界场景

| 场景 | 处理 |
|---|---|
| 网页加载失败 | v1 用 Chromium 默认错误页 |
| 所有 tab 关光 | 自动新建一个 blank tab |
| 显示器热插拔 / 分辨率变化 | 监听 `screen.display-removed` / `display-metrics-changed`；若 bounds 不在任何显示器内，snap 回主屏中心 |
| 隐藏状态下显示器断开 | 同上 + 重置为 DOCKED_NONE |
| 设置文件损坏 | try/catch 加载，回退默认值 + 日志 |
| 动画进行中鼠标来回晃 | HIDING/REVEALING 期间忽略新事件，记末态，动画完成后再评估 |
| 持久化的 URL 非法 | 回退 `about:blank` |
| 上次是隐藏态重启 | 启动时强制可见（hidden 状态不持久化） |

---

## 11. v1 不做（YAGNI）

- Tab 挂起/休眠
- 下载 UI（用 Chromium 默认）
- PDF 自定义查看器
- 书签 / 历史记录（Cookie 足够覆盖登录需求）
- 多窗口
- 扩展程序
- 自定义右键菜单（v2 加复制粘贴）
- 页面内搜索（Ctrl+F）
- 组合式滤镜效果（v1 单选）

---

## 12. 测试策略

| 层 | 工具 | 覆盖对象 |
|---|---|---|
| 单元 | Vitest | `EdgeDock.reduce`、`computeDockedSide`、`interpolateX`、`clampSettings`、`buildFilterCSS` |
| 集成 | Vitest + 伪造 Electron API | IPC 路由 → ViewManager/SettingsStore 链路 |
| E2E | `@playwright/test` 的 `_electron` | 启动、建/关 tab、导航、切 UA、设置即时生效、hide/reveal 触发 |

**原则：**
- EdgeDock 做成纯 reducer（输入 state+event，输出 nextState+effects[]），100% 单测覆盖。副作用由外层真实执行，副作用执行器可单独集成测试。
- E2E 设 `edgeDock.animationMs=0` + `mouseLeave.delayMs=0` 跳过动画/延迟。
- 鼠标轮询的 `(cursor坐标+bounds) → 事件` 映射做成纯函数，单测即可；E2E 不直接测轮询。

**E2E 测试钩（`SIDEBROWSER_E2E=1`）：** bootstrap 里读该环境变量；为 `'1'` 时 (a) 跳过 `CursorWatcher.start()`（真实轮询会和测试里的 `fireLeaveNow / fireEnterNow` 抢态，制造 flake）；(b) 在 `globalThis.__sidebrowserTestHooks` 上挂 `{ fireLeaveNow, fireEnterNow, getActiveWebContents, getWebContentsByUrlSubstring }` 供 `app.evaluate` 调用。这样 E2E 完全走命令式事件注入，轮询+防抖由单测（`tests/unit/cursor-watcher.test.ts` 用 `vi.useFakeTimers`）覆盖。

**M5 E2E 钩（追加）：** Task 6 在同一 `__sidebrowserTestHooks` 上追加 `emitWindowMoved` / `emitDisplayChanged` / `getEdgeDockState` / `getWindowBounds` / `setWindowBounds`，使 E2E 可以绕过真实 `win.on('moved')` / `screen.on('display-*')` 事件源，直接注入几何变化。EdgeDock 动画不 mock——`edgeDock.animationMs = 200` 真跑，`expect.poll` 预算（5s / 10s）覆盖真实动画时间 + 缓冲。

**M6 E2E 钩（追加）：** `tests/e2e/settings-drawer.spec.ts` 覆盖 drawer 开关 + 持久化 + 窗口 bounds 跨重启恢复；Task 11 在 `__sidebrowserTestHooks` 上追加 `getSettings` / `updateSettings` / `getActiveViewBounds`，对应 SettingsStore 和 ViewManager 的可测入口，让 E2E 可以绕过 UI 直接读/写 canonical settings，并断言 view-suppression（drawer open 时 active view 缩成 `{0,0,0,0}`）。

**CI：** GitHub Actions Windows runner 跑 `pnpm test` + `pnpm test:e2e`。Mac runner 留到加平台时再开。

---

## 13. 里程碑

每个里程碑独立可验证，完成一个 commit（conventional commit message）。

| M | 目标 | 产出 | 验证 |
|---|---|---|---|
| M0 | 工程脚手架 | electron-vite + React + TS + Tailwind + Vitest + Playwright；`pnpm dev` 出 hello-world 窗口 | 手动启动 |
| M1 | 基础浏览 + 持久化登录 | 单 tab、URL 地址栏、前进/后退/刷新、`persist:sidebrowser` session | E2E：登录站 → 关 → 重启 → 仍登录 |
| M2 | 多 tab + tab 抽屉 | TabDrawer UI、新建/关闭/切换、tab 列表跨重启持久化 | E2E：开 3 tab → 重启 → 全在 + 活跃 tab 正确 |
| M3 | 移动端模拟 | 默认 393×852、iPhone UA 默认、每 tab 独立切换、预设尺寸 | E2E：打开 whatismybrowser.com 显示 iPhone Safari |
| M4 | 鼠标离开 → 滤镜 | cursor-watcher、DimController、设置四种 effect + 强度 | 单测 reducer；E2E 模拟鼠标出窗检查 CSS 注入 |
| M5 | 贴边自动缩 | 贴边检测、EdgeDock 状态机、动画插值、3px 触发条 | E2E：贴边 → mouseleave → 动画完 → 断言 x=-w+3；hover 触发条 → 还原 |
| M6 | 设置抽屉 UI | 右侧覆盖式抽屉、所有设置项实时生效 | E2E：改模糊值 → 立即可见变化 |
| M7 | 托盘 + 关闭行为 | Tray icon、minimize-to-tray、右键菜单 | E2E 覆盖 close-action 分支（hide vs destroy）；托盘 icon 本身手动冒烟 |
| M8 | 加固 + 打包 ✅ | 错误边界全量过、display-changed 兜底、electron-builder 打 NSIS 安装包 | 完成：NSIS installer + spec §15 shortcuts + error-boundary hardening |
| M9（v1.1） | always-on-top + single-instance + theme + settings 尺寸解耦 + tray 移除 | always-on-top、单实例保护、三档主题、preset/bounds 解耦、托盘移除 | 完成 ✅ |

**M0–M2 完成即一个"持久登录多 tab 浏览器"**，M3–M5 是侧边浮窗差异化核心，M6–M8 是打磨。

---

## 14. 风险清单

| 风险 | 级别 | 缓解 |
|---|---|---|
| 50ms cursor 轮询的闲时 CPU | 低 | 就一次坐标对比，可忽略；保险：窗口聚焦且鼠标在内时暂停轮询 |
| Windows 手写动画帧率低 | 中 | 60fps 试；不行降 30fps；一次 tick 一次 setBounds 别更密 |
| 重启时隐藏态被误恢复 | 低 | hidden 状态不持久化，启动强制可见 |
| 多信号反移动端检测（B 站/X 等） | 中 | v1 接受 + README 说明；v2 上 CDP 模拟 |
| CSS filter 重页面掉帧 | 低 | blur=8 性能可控；用户可切 dark/light（更便宜） |
| Electron ESM/CJS 构建坑 | 中 | 直接用 `electron-vite` 模板，不自拼 |
| 3px 触发条仍可见 | 低 | 可接受（类任务栏交互预期）；可改 1px |
| `window.open` 默认新 tab 是否符合用户期望 | 中 | v1 默认新 tab；设置里留 toggle 到 v2 |

---

## 15. 键盘快捷键（v1 标配）

通过 Electron `globalShortcut`（针对全局唤出类）和 `Menu` accelerator（应用内类）注册：

| 快捷键 | 动作 | 类型 |
|---|---|---|
| `Ctrl+T` | 新建 tab | 应用内 |
| `Ctrl+W` | 关闭当前 tab | 应用内 |
| `Ctrl+L` | 聚焦地址栏 | 应用内 |
| `Ctrl+R` / `F5` | 刷新 | 应用内 |
| `Alt+←` / `Alt+→` | 后退 / 前进 | 应用内 |
| `Ctrl+Tab` | 打开 tab 抽屉 | 应用内 |
| `Ctrl+,` | 打开/关闭设置抽屉 | 应用内 |
| `Ctrl+0` | 复位当前 tab 缩放至 100% | 应用内 |
| `F12` | 打开当前 tab 的 DevTools | 应用内 |

v1 **不**注册全局快捷键（避免与用户其他软件冲突）。召唤应用只能通过触发条（M9 已移除托盘图标）。

---

## 16. 代码基线

- TypeScript strict mode
- ESLint + `@electron-toolkit/eslint-config`
- Prettier + LF 换行
- 单文件超 300 行考虑拆分（尤其 main 侧子系统）
- 所有 IPC 通道名集中在 `shared/ipc-contract.ts`，禁止字符串字面量散落
- 所有平台相关代码放 `src/main/platform/`，业务层只依赖其导出的接口

---

## 17. 完成后交付物

- 可在 Windows 上 `pnpm dev` 启动开发环境
- `pnpm build` 产出带签名的（可选）NSIS 安装包
- 单元 + E2E 测试覆盖核心状态机与主要用户流程
- README 文档：功能、快捷键、已知限制（如反移动端检测场景）
- M9：无系统托盘，X 按钮直接退出；窗口始终置顶（always-on-top）；单实例保证；三档主题（appearance.theme）
