# Mobile Emulation 增强（Client Hints + Chromium device emulation）— 设计文档

**日期：** 2026-04-27
**状态：** 待实现
**目标读者：** 实现本变更的开发者（含子 agent）
**关联 spec：** `2026-04-23-sidebrowser-design.md`（本文修订其 §5.4 与 §11）

---

## 1. 背景与问题

M3 落地的 per-tab UA 切换调用 `webContents.setUserAgent(MOBILE_UA)`，把 iPhone iOS 17.4 Safari 的 UA 字符串塞进 `User-Agent` 头和 `navigator.userAgent`。spec §5.4 当时的判断是「窗口本身就是手机尺寸 + UA 切换对绝大多数站够用」，并明确把 CDP 设备模拟列为 §11 非目标。

实测在 sidebrowser 里打开 `x.com`：UA 字符串是 iPhone Safari ✓，但布局是「窄桌面版」（左侧紧凑侧栏）而**不是**真移动版（底部 tab 栏）。在页面 DevTools 里查 navigator 状态：

| 信号 | 实际值 | 真 iPhone Safari |
|---|---|---|
| `navigator.userAgent` | iPhone Safari ✓ | iPhone Safari |
| `navigator.userAgentData.mobile` | `false` | `true` |
| `navigator.userAgentData.platform` | `"Windows"` | `"iOS"` |
| `(pointer: coarse)` | `false` | `true` |
| `(hover: none)` | `false` | `true` |
| `'ontouchstart' in window` | `false` | `true` |

X.com 等现代站点用 Client Hints (`Sec-CH-UA-Mobile`、`Sec-CH-UA-Platform`、`navigator.userAgentData.*`) 和指针/触摸媒体查询决定布局，UA 字符串只是其中一个信号。`webContents.setUserAgent` 不影响 Client Hints 也不翻 Chromium 内部 mobile flag——所以 X 看到的是「UA 说 iPhone、但 userAgentData 说 Windows 桌面、没有触摸、能 hover」这种自相矛盾的设备指纹，回退到「narrow desktop」布局。

本变更修正 spec §5.4 的早期假设：**`setUserAgent` 不足以让现代站点真正按移动版渲染**。

## 2. 目标

修复后的成功标准（按 brainstorming 决策——通用模拟，不是仅 X.com 特化）：

- 默认开 sidebrowser → 访问 `x.com` → 看到底部 tab 栏（Home / Search / Notifications / Messages / Profile）+ 顶部小头像/X Logo 的真移动版布局
- 在 mobile 模式下，任意页面 JS 查询 `navigator.userAgentData.mobile` 返回 `true`、`navigator.userAgentData.platform` 返回 `"iOS"`（默认 UA 时）/ `"Android"`（用户改成 Android UA 时）
- 在 mobile 模式下，CSS `(pointer: coarse)` 和 `(hover: none)` 媒体查询为 true
- 在 mobile 模式下，`'ontouchstart' in window` 为 true
- 出站请求带 `Sec-CH-UA-Mobile: ?1` + `Sec-CH-UA-Platform: "<推导出的平台>"`
- 切 desktop 模式后以上信号全部恢复 Chromium 默认（Windows 桌面）
- F12 打开 DevTools 不报 debugger attach 冲突，能正常用

## 3. 非目标

- 自定义 brand 列表（`Sec-CH-UA` 头、`userAgentData.brands`）—— 让 Chromium 发真实 Chromium 品牌信息，伪造容易露馅且 X 不查这些
- 完整 Sec-CH-UA-Arch / Bitness / Model / Full-Version-List 头伪造 —— 极少站点检查，YAGNI
- 用户在 settings 抽屉里手动选 platform / platformVersion / brands —— v1 自动推导（见 §6）覆盖默认 + 自定义 UA 两个场景已足够
- macOS / Linux 平台覆盖 —— spec §1 v1 仅 Windows
- iframe / 子 webContents 的独立 isMobile —— 所有 tab 共享 persistent session，但 emulation 是 per-wc，子 frame 自动跟 parent 走

## 4. 架构

新增独立模块 `src/main/mobile-emulation.ts`，集中：UA 元数据解析、Chromium 设备模拟开关、Client Hints 头改写。理由：

- spec §4.1 里 SessionManager 是「Cookies + UA 切换」的概念槽位，mobile-emulation 是它的延伸，但 UA 切换又跟 ViewManager 的 per-tab 状态强耦合——独立模块比塞进任一已有文件更清晰
- 解析器是纯函数，便于单测
- ViewManager / index.ts 只调几个具名 API，不需要懂 Client Hints 头细节

模块导出：

```
src/main/mobile-emulation.ts
├── interface UaMetadata { platform: string; platformVersion: string; mobile: boolean }
├── parseUaForMetadata(ua: string): UaMetadata                                     ← 纯函数，单测
├── applyMobileEmulation(wc: WebContents): void                                    ← 调 wc.enableDeviceEmulation(...)
├── removeMobileEmulation(wc: WebContents): void                                   ← 调 wc.disableDeviceEmulation()
└── installMobileHeaderRewriter(
      session: Session,
      getMobileEmulationState: (wcId: number) => UaMetadata | null,
    ): void                                                                       ← 一次性 webRequest.onBeforeSendHeaders 注册
```

## 5. `parseUaForMetadata` 契约

输入是 UA 字符串，输出 `UaMetadata`。匹配规则（自上而下，第一个命中即返回）：

| 优先级 | 匹配 | 输出 |
|---|---|---|
| 1 | `/iPhone\|iPad\|iPod/` | `{ platform: 'iOS', mobile: true, platformVersion: 解析 'OS (\d+)_(\d+)' 把下划线换点; 失败则 '' }` |
| 2 | `/Android/` | `{ platform: 'Android', mobile: true, platformVersion: 解析 'Android (\d+(\.\d+)?)'; 失败则 '' }` |
| 3 | `/Macintosh\|Mac OS X/`（且未命中 1） | `{ platform: 'macOS', mobile: false, platformVersion: '' }` |
| 4 | `/Windows/` | `{ platform: 'Windows', mobile: false, platformVersion: '' }` |
| 5 | `/Linux/` | `{ platform: 'Linux', mobile: false, platformVersion: '' }` |
| 6 | fallback（包括空串） | `{ platform: 'iOS', mobile: true, platformVersion: '' }` |

fallback 落到 mobile 而不是 desktop 的理由：本函数只在「该 tab 处于 mobile 模式」的代码路径上被调（ViewManager.getMobileEmulationState 已保证），desktop 路径直接返回 `null` 不调本函数。fallback 是为了"用户填了奇怪 UA 字符串"这种边缘情况——既然用户开的是 mobile 模式，元数据缺省给 mobile=true 比给 desktop 更接近其意图。

`brands` 字段统一**不返回**（接口里不存在）。理由见 §3。

单测样例：

```
默认 iPhone iOS 17.4 UA               → { platform: 'iOS',     platformVersion: '17.4', mobile: true }
'... Android 14; SM-G998B ...'        → { platform: 'Android', platformVersion: '14',   mobile: true }
'Mozilla/5.0 (Windows NT 10.0; ...)'  → { platform: 'Windows', platformVersion: '',     mobile: false }
'Mozilla/5.0 (Macintosh; ...)'        → { platform: 'macOS',   platformVersion: '',     mobile: false }
''                                    → { platform: 'iOS',     platformVersion: '',     mobile: true }
'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) ...' → platformVersion '16.3'
```

## 6. `applyMobileEmulation` / `removeMobileEmulation` 契约

```ts
applyMobileEmulation(wc: WebContents, screenSize: { width: number; height: number }): void
```

调 Electron 的 `wc.enableDeviceEmulation(parameters)`：

```ts
{
  screenPosition: 'mobile',                       // 翻 Chromium 内部 mobile flag → (pointer:coarse) / (hover:none) / touch / userAgentData.mobile
  screenSize,                                     // caller 传 host 窗口的 contentBounds（不传 0/0——见下方 spike 实测）
  viewPosition:  { x: 0, y: 0 },
  deviceScaleFactor: 0,                           // 0 = 用 OS 默认 DPR，不强行 @3x
  viewSize:      screenSize,                      // 与 screenSize 一致，使页面 layout viewport 与设备屏幕一致
  scale:         1,
}
```

```ts
removeMobileEmulation(wc: WebContents): void
```

调 `wc.disableDeviceEmulation()`，无参数。

### 6.1 调用时机（M10 Task 4 spike 实测后修订）

**初版设计**写的是「`createTab` 在 `setUserAgent` 之后、`loadURL` 之前同步调 `applyMobileEmulation`」。**实测发现这条路径会同步死锁主进程**——刚 `new` 出来还没 `loadURL` 的 WebContentsView 上的 `enableDeviceEmulation` 是同步 IPC，等不存在的渲染端 ack。chrome 窗口本身能起来（preload 已注入），但主进程冻住后 playwright 的所有跨进程操作都超时，所有 e2e 都报 `getChromeWindow` 10s timeout。

**修订后的调用时机：**

| 路径 | 调用方式 |
|---|---|
| `ViewManager.createTab`（`resolvedIsMobile === true`） | 注册 `wc.once('did-start-loading', () => applyMobileEmulation(...))`——渲染进程已 spawn，首个 HTTP 响应到达前触发，emulation 赶上首屏 layout 决策 |
| `ViewManager.setMobile(id, true)` | 直接同步调 `applyMobileEmulation`——wc 已 navigate 过，渲染端是活的；接 `setUserAgent` → `reloadIgnoringCache` |
| `ViewManager.setMobile(id, false)` | 直接同步调 `removeMobileEmulation`；接 `setUserAgent` → `reloadIgnoringCache` |
| `closeTab` | 不需显式 remove —— `webContents.close` 自动清理 |

**caller 责任**：保证 wc 处于"渲染进程已起来"状态再调 `applyMobileEmulation`。`mobile-emulation.ts` 的 jsdoc 把这个约束写进函数注释。

### 6.2 spike 实测的 0/0 参数也死锁

初版设计还提议 `screenSize: { width: 0, height: 0 }` 让 Chromium 用真实窗口尺寸。**实测下也复现死锁**——参数无关，是 IPC 时机问题。统一改成 caller 传 host 窗口的 contentBounds。

**幂等性：** `enableDeviceEmulation` 重复调用是覆盖式（最新参数生效）；`disableDeviceEmulation` 重复调用空操作。外层不需要判当前状态。

### 6.3 信号验证状态

E2E 跨不到 webContents 内部状态——目标信号 (`navigator.userAgentData.mobile` / `(pointer: coarse)` / `(hover: none)` / `'ontouchstart' in window`) 是否真翻成 mobile，由 Task 10 的手动冒烟（X.com 底部 tab 栏）作为终极判据。

## 7. `installMobileHeaderRewriter` 契约

```ts
installMobileHeaderRewriter(
  session: Session,
  getMobileEmulationState: (wcId: number) => UaMetadata | null,
): void
```

`getMobileEmulationState` 是 ViewManager 暴露的查询入口（见 §8）。返回值语义：
- `null` → 该 wcId 对应 desktop 模式 / 不是 tab（chrome renderer 自己），头不动
- `UaMetadata` → mobile 模式，按这份元数据改头

实现：

```ts
session.webRequest.onBeforeSendHeaders((details, callback) => {
  const meta = getMobileEmulationState(details.webContentsId);
  if (!meta) {
    callback({});
    return;
  }
  const headers = { ...details.requestHeaders };
  headers['Sec-CH-UA-Mobile']   = meta.mobile ? '?1' : '?0';
  headers['Sec-CH-UA-Platform'] = `"${meta.platform}"`;       // sf-string 必须带引号
  if (meta.platformVersion) {
    headers['Sec-CH-UA-Platform-Version'] = `"${meta.platformVersion}"`;
  }
  callback({ requestHeaders: headers });
});
```

只改这三个头。`Sec-CH-UA`（品牌列表）、`User-Agent`（已被 `wc.setUserAgent` 处理）、其他 Client Hints 头一律不动（理由见 §3）。

**注册时机：** `app.whenReady()` 之后、ViewManager 创建之后立即调一次（lookup 闭包要捕获 viewManager）。在 `index.ts` 的 SettingsStore + ViewManager 构造之后、第一次 createTab 之前。

**性能：** 每个出站请求都跑一次回调。lookup + 浅拷贝 headers 都是 O(很小)，可忽略。`onBeforeSendHeaders` 必须 callback 才放行，不要丢失任何路径下的 callback。

## 8. ViewManager 改动

[src/main/view-manager.ts](src/main/view-manager.ts) 三处加东西：

1. `createTab`：在 `view.webContents.setUserAgent(...)` 之后、`view.webContents.loadURL(...)` 之前，加：
   ```ts
   if (resolvedIsMobile) applyMobileEmulation(view.webContents);
   ```

2. `setMobile(id, isMobile)`：分支调 apply/remove。完整顺序：
   ```ts
   if (isMobile) applyMobileEmulation(wc); else removeMobileEmulation(wc);
   wc.setUserAgent(isMobile ? defaults.mobileUserAgent : desktopUa());
   this.updateTab(id, { isMobile, favicon: null });
   wc.reloadIgnoringCache();
   ```

3. 新方法 `getMobileEmulationState(wcId: number): UaMetadata | null`：
   ```ts
   for (const [, m] of this.tabs) {
     if (m.view.webContents.id === wcId) {
       if (!m.tab.isMobile) return null;
       return parseUaForMetadata(this.getBrowsingDefaults().mobileUserAgent);
     }
   }
   return null;
   ```
   每次请求重新 parse UA：parse 是几个 regex，tab 数 ≤ 几个，UA 字符串可被用户在 settings 改，实时 parse 比缓存失效逻辑简单。如果 perf 真成瓶颈再加缓存。

## 9. `index.ts` 改动

```ts
// 在 const viewManager = new ViewManager(...) 之后立即调用
import { installMobileHeaderRewriter } from './mobile-emulation';
import { getPersistentSession } from './session-manager';

installMobileHeaderRewriter(
  getPersistentSession(),
  (wcId) => viewManager.getMobileEmulationState(wcId),
);
```

只加这两行 + 一个 import 块。其他启动流程不动。

## 10. 数据流图

```
切换 mobile/desktop（点 TopBar UA toggle）
   ↓
IPC tab:set-mobile → ViewManager.setMobile(id, isMobile)
   ↓
   ├─ applyMobileEmulation(wc) / removeMobileEmulation(wc)        ← Chromium 内部 mobile flag (touch/pointer/hover/userAgentData)
   ├─ wc.setUserAgent(...)                                        ← User-Agent 头 + navigator.userAgent
   └─ wc.reloadIgnoringCache()
       ↓
       页面发出 HTTP 请求
           ↓
       session.webRequest.onBeforeSendHeaders((details, cb) => ...)
           ↓
       ViewManager.getMobileEmulationState(details.webContentsId)
           ↓
           tab 是 mobile？ parse UA → UaMetadata，注入 Sec-CH-UA-Mobile/Platform/Platform-Version
           tab 是 desktop？ 返回 null，头不动
```

## 11. 持久化 / 设置

不改任何持久化字段：
- `PersistedTab.isMobile` 既有
- `settings.browsing.mobileUserAgent` 既有
- `settings.browsing.defaultIsMobile` 既有

Client Hints metadata 是 UA 的派生属性，不存盘。

## 12. 测试策略

| 层 | 用例 |
|---|---|
| 单元 (Vitest) | `parseUaForMetadata`：iPhone / iPad / Android / Windows / macOS / Linux / 空串 / 乱串 / iOS 版本号解析 8+ 个 case |
| 集成 (Vitest) | mock `webRequest` 的 details 结构 + 测试 callback 是否注入正确头部。两路：mobile tab 注入 / desktop tab 透传 |
| E2E (Playwright `_electron`) | 复用 M3 的 `/ua` 端点扩成 `/headers`（返回 `req.headers` JSON）。三个用例：(1) 默认 mobile tab → 服务端看到 `sec-ch-ua-mobile: ?1` + `sec-ch-ua-platform: "iOS"`；(2) 切 desktop → reload → 服务端不再看到那俩头被覆写；(3) 改 settings.browsing.mobileUserAgent 为 Android UA → reload → 服务端看到 `sec-ch-ua-platform: "Android"` |
| 手动冒烟（用户负责） | 启 `pnpm dev` → 访问 `x.com` → **底部 tab 栏出现**；F12 开 DevTools 不报 attach 冲突；切 desktop 后 reload → 桌面布局回来 |

E2E **不直接断言** `(pointer: coarse)` / `userAgentData.mobile`：那是 webContents 内部状态，从 chrome renderer 进程跨不过去查。spike（plan Task 1）会手动验过。

## 13. Spec 修订

写 plan 之前要改 `2026-04-23-sidebrowser-design.md`：

1. **§5.4** 替换最后一段：

   > 旧： v1 **不用** CDP `Emulation.setDeviceMetricsOverride`——窗口本身就是手机尺寸，视口天然移动化，UA 切换对绝大多数站足够。

   > 新： 现代站点（X.com 等）通过 Client Hints (`Sec-CH-UA-Mobile`、`Sec-CH-UA-Platform`、`navigator.userAgentData.*`) 与触摸/指针媒体查询决定布局，UA 字符串只是其中一个信号。所以单纯 `setUserAgent` 不足以让站点切真移动版。SessionManager（`mobile-emulation.ts` 模块）补两件事：(a) `wc.enableDeviceEmulation({ screenPosition: 'mobile' })` 翻 Chromium 内部 mobile flag → 触摸 / `(pointer:coarse)` / `(hover:none)` / `userAgentData.mobile` 全部按移动设备表现；(b) `session.webRequest.onBeforeSendHeaders` 改 `Sec-CH-UA-Mobile/Platform/Platform-Version`。Client Hints 元数据按 UA 字符串自动推导（iPhone/iPad → iOS、Android → Android、其他 → fallback iOS），用户改 `mobileUserAgent` 时自动同步。不用 CDP `webContents.debugger`，避免与 F12 DevTools 互斥。

2. **§11 不做** 删除 "CDP `Emulation.setDeviceMetricsOverride`" 这条。

3. **§4.1 架构图** 在 SessionManager 行下加：
   ```
   ├── MobileEmulation   — Chromium device emulation + Client Hints 头改写
   ```

4. 不需要碰 §6（IPC 契约不变）、§7（settings shape 不变）、§13（里程碑表保留 M3 现状，本变更作为 M3 增量在 M10 落地）。

## 14. 里程碑命名

建议起名 **M10-mobile-emulation-clienthints**（沿用 M0–M9 的编号）。Plan 文件 `docs/superpowers/plans/2026-04-27-M10-mobile-emulation-clienthints.md`，tag `m10-mobile-emulation-clienthints`。

## 15. 风险 / 回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| ~~`enableDeviceEmulation` 在 Electron 41 下不翻信号~~（spike 后已知不是这个问题） | — | 实测 spike 揭示真实问题是 IPC 同步死锁，已通过 `did-start-loading` defer 解决（§6.1） |
| ~~`enableDeviceEmulation` 翻了内部 mobile flag 但 X.com 仍按 narrow-desktop 渲染~~ | — | M10 落地后实测：4 信号全 false，X.com 客户端 hydration 后退回桌面版。已升级到混合 CDP（§16），4 信号全 true |
| webRequest 改头被某些站的 CSP / Strict-Transport 等机制干扰 | 部分站仍走桌面版 | onBeforeSendHeaders 是请求出站前改，不影响 CSP（CSP 是响应方向）。如果遇到问题，逐站排查 |
| 用户自定义 UA 是某种没匹配的字符串（如 KaiOS / Tizen） | platform 落 fallback iOS，可能与 UA 不一致 | fallback 至少保 mobile=true，多数站点的"narrow desktop" vs "real mobile"分流主要看 mobile bit，platform 不一致一般不致命。极端站点出问题时建议用户改回支持的 UA |
| 集成 / E2E 测试在 CI 上的 webRequest mock 不真实 | 测试通过 ≠ 真实环境工作 | 手动冒烟（X.com）作为最后一道关，由用户在合并前跑 |
| `did-start-loading` defer 的 race：`once` 监听器附加 vs `loadURL` 发出 | 理论上若 loadURL 在 once 注册前就发了 did-start-loading，emulation 永远不上 | 实测安全——同步代码块内 `once` 先注册再 `loadURL`，事件总在下一 tick 才发 |
| F12 与 CDP debugger 互斥：用户开 F12 时 mobile emulation 失效 | mobile tab 上开 F12 调试时，userAgentData / 触摸 / 媒体查询会回到桌面默认；UA 字符串 + Sec-CH-UA-* 头不受影响 | 用户关闭 F12 后 ViewManager 自动重 attach（`devtools-closed` 事件）。当前页面已渲染过的 frame 需要手动 reload 才能让新 frame 重新评估 mobile 信号 |
| CDP `setTouchEmulationEnabled` 后 `'ontouchstart' in window` 在 fresh 导航中不生效 | 第一次 navigation 后 hasTouch 可能仍为 false（race：CDP 命令未完成时 render frame 已创建） | `did-navigate` 监听器幂等地重发 CDP 命令；下次 navigation 的 frame 创建前 CDP state 已就绪。E2E 加 1.5s settle wait 复现真实用户输入 URL 的延迟 |

## 16. M10.5 Hybrid CDP 升级

M10 落地后实测发现 §15 风险表第 2 行触发：`enableDeviceEmulation({ screenPosition: 'mobile' })` 只翻 blink 内部 mobile flag（影响 viewport meta 解析、滚动等），但**不**翻 JS 侧的 4 个 mobile 信号——`navigator.userAgentData.mobile` / `(pointer:coarse)` / `(hover:none)` / `'ontouchstart' in window` 全是 desktop 默认值。X.com 等站点服务端看 UA + Sec-CH-UA-* 给出移动 HTML，但客户端 hydration 时基于这 4 个信号重新评估，发现是桌面 → re-render 成桌面，导致"有时移动、有时桌面"的不稳定。

升级方案保留 M10 全部基础设施（UA 字符串 + webRequest 头改写 + `enableDeviceEmulation`），叠加 4 条 CDP 命令：

```ts
wc.debugger.attach('1.3');
wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
  userAgent: ua, platform,
  userAgentMetadata: { brands: [], fullVersionList: [], platform, platformVersion, mobile: true, /* ... */ },
});
wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 0, mobile: true,
});  // ← 翻 (pointer:coarse) / (hover:none) 媒体查询
wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
  enabled: true, maxTouchPoints: 1,
});  // ← 翻 'ontouchstart' in window（需 frame 创建前到位）
```

新增 API：`attachCdpEmulation(wc, metadata, ua, screenSize)` / `detachCdpEmulation(wc)`，幂等。

### 16.1 调用时机

| 场景 | 时机 |
|---|---|
| createTab + isMobile | `did-start-loading` once handler（同 M10）：`applyMobileEmulation` + `attachCdpEmulation` |
| setMobile(true) | 同步：apply + attach + setUserAgent + reloadIgnoringCache |
| setMobile(false) | 同步：detach CDP + remove emulation + setUserAgent + reloadIgnoringCache |
| 每次 `did-navigate` | 重发 CDP 命令（idempotent）—— `'ontouchstart' in window` 在 window 对象创建时一次性确定，跨进程导航需新 frame 创建前 CDP state 就绪 |
| `devtools-opened` | `detachCdpEmulation`：F12 接管 CDP 通道 |
| `devtools-closed` | 如 tab 仍 mobile，重 attach；当前页 frame 需手动 reload 才能恢复 4 信号 |

### 16.2 DevTools 共存代价

`webContents.debugger` 与 F12 是同一 CDP 通道，单客户端。互斥的代价已通过事件监听把"硬冲突"软化为"打开 F12 → emulation 临时降级到 M10 基础（UA 字符串 + Sec-CH-UA-* 头还在）"。关闭 F12 后自动恢复，但当前页面需要 reload 才能让新 frame 重新评估 4 信号。

### 16.3 验证

E2E `tests/e2e/mobile-js-signals.spec.ts`：通过 `__sidebrowserTestHooks.getActiveWebContents()` + `wc.executeJavaScript` 跨主进程读取 4 个信号，断言 mobile 全 true / desktop 全 false。这是 M10 设计阶段做不到的内部状态验证（chrome renderer 跨不到 WebContentsView 进程），M10.5 通过 main-process bridge 解决。

---

## Definition of Done

- ✅ `mobile-emulation.ts` 模块实现 + 单测全绿（15 单测）
- ✅ ViewManager 改动 + createTab/setMobile/devtools-opened/devtools-closed/did-navigate 路径覆盖
- ✅ `installMobileHeaderRewriter` 在 index.ts 启动顺序中正确挂载
- ✅ M10 E2E（mobile-clienthints）：Sec-CH-UA-* 头注入与 desktop 取消
- ✅ M10.5 E2E（mobile-js-signals）：4 个 JS 信号 mobile→all true / desktop→all false
- ✅ 手动冒烟（用户负责）：x.com 底部 tab 栏稳定出现（不再 flake）、切 desktop 恢复桌面、F12 与 mobile 临时互斥但能共存
- ✅ Spec §5.4 / §11 / §4.1 / §16 修订
- ✅ `pnpm typecheck / lint / test / test:e2e / build` 全绿（215 unit + 23 e2e）
- ✅ `m10-mobile-emulation-clienthints` tag 打上（用户确认手动冒烟通过后）
