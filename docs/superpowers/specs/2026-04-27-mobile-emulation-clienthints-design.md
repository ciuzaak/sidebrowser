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
applyMobileEmulation(wc: WebContents): void
```

调 Electron 的 `wc.enableDeviceEmulation(parameters)`：

```ts
{
  screenPosition: 'mobile',                       // 翻 Chromium 内部 mobile flag → (pointer:coarse) / (hover:none) / touch / userAgentData.mobile
  screenSize:    { width: 0, height: 0 },         // 0/0 让 Chromium 用真实窗口尺寸（用户调过窗口大小不冲突）
  viewPosition:  { x: 0, y: 0 },
  deviceScaleFactor: 0,                           // 0 = 用 OS 默认 DPR，不强行 @3x
  viewSize:      { width: 0, height: 0 },         // 0 = 不覆盖
  scale:         1,
}
```

**关键设计点：** screenSize / viewSize 都传 0/0。窗口本身就是 393×852 移动尺寸，不需要再绑死虚拟屏幕。我们要的就是 mobile flag 翻 true，让媒体查询、`userAgentData.mobile`、触摸事件跟着翻；物理像素和视口让 Chromium 自然处理。这也避免「用户拖窗口改尺寸 → 模拟参数没同步 → 视口错位」类同步问题。

**实测验证项（plan Task 1 spike，不是设计假设）：** 上面这套 0/0 参数下，`navigator.userAgentData.mobile` 是否真的翻 `true`、`(pointer: coarse)` / `(hover: none)` / `'ontouchstart' in window` 是否变 true。如果 Electron 的 `enableDeviceEmulation` 只在显式传屏幕尺寸时才翻 mobile flag，退化为传当前 `wc.getOwnerBrowserWindow()?.getContentBounds()` 的真实尺寸。如果传真实尺寸也不翻 userAgentData/媒体查询，则升级到混合方案：保留 `enableDeviceEmulation` 用于触摸/媒体查询，再用 CDP `webContents.debugger` 调 `Emulation.setUserAgentOverride` 带 `userAgentMetadata` 兜底 `userAgentData`（接受 F12 与 mobile 模式互斥的代价）。

```ts
removeMobileEmulation(wc: WebContents): void
```

调 `wc.disableDeviceEmulation()`，无参数。

**调用时机：**
- `ViewManager.createTab`：`setUserAgent` 之后、`loadURL` 之前，如果 `resolvedIsMobile === true` 调 `applyMobileEmulation`；否则什么都不调（Chromium 默认就是 desktop）
- `ViewManager.setMobile(id, true)`：`applyMobileEmulation` → `setUserAgent` → `reloadIgnoringCache`
- `ViewManager.setMobile(id, false)`：`removeMobileEmulation` → `setUserAgent` → `reloadIgnoringCache`
- `closeTab` 不需显式 remove —— `webContents.close` 自动清理

**幂等性：** `enableDeviceEmulation` 重复调用是覆盖式（最新参数生效）；`disableDeviceEmulation` 重复调用空操作。外层不需要判当前状态。

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
| `enableDeviceEmulation` 在 Electron 41 下不翻 `userAgentData.mobile` / 媒体查询 | Approach A 不够，X 仍显示桌面版 | Plan Task 1 spike 提前验。失败则升级到混合方案（A + CDP 仅用于 setUserAgentOverride 兜底 userAgentData），接受 F12 与 mobile 模式互斥 |
| webRequest 改头被某些站的 CSP / Strict-Transport 等机制干扰 | 部分站仍走桌面版 | onBeforeSendHeaders 是请求出站前改，不影响 CSP（CSP 是响应方向）。如果遇到问题，逐站排查 |
| 用户自定义 UA 是某种没匹配的字符串（如 KaiOS / Tizen） | platform 落 fallback iOS，可能与 UA 不一致 | fallback 至少保 mobile=true，多数站点的"narrow desktop" vs "real mobile"分流主要看 mobile bit，platform 不一致一般不致命。极端站点出问题时建议用户改回支持的 UA |
| 集成 / E2E 测试在 CI 上的 webRequest mock 不真实 | 测试通过 ≠ 真实环境工作 | 手动冒烟（X.com）作为最后一道关，由用户在合并前跑 |

---

## Definition of Done

- ✅ `mobile-emulation.ts` 模块实现 + 单测全绿
- ✅ ViewManager 三处改动 + 集成测试覆盖 createTab/setMobile 路径
- ✅ `installMobileHeaderRewriter` 在 index.ts 启动顺序中正确挂载
- ✅ E2E 三个用例（默认 mobile 头 / 切 desktop / 改 UA 推导平台）全绿
- ✅ 手动冒烟（用户负责）：x.com 底部 tab 栏出现、切 desktop 恢复桌面、F12 不冲突
- ✅ Spec §5.4 / §11 / §4.1 同步修订
- ✅ `pnpm typecheck / lint / test / test:e2e / build` 全绿
- ✅ `m10-mobile-emulation-clienthints` tag 打上（用户确认手动冒烟通过后）
