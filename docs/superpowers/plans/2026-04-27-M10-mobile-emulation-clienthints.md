# M10：Mobile Emulation 增强（Client Hints + Chromium device emulation）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。Steps 用 checkbox 跟踪。

**Date:** 2026-04-27
**前置：** `m9-ux-stability` tag、`main` clean。

**Goal:** 修补 M3 留下的 mobile emulation 信号缺口——除 UA 字符串外，再翻 Chromium 内部 mobile flag（触摸/指针/媒体查询/`userAgentData.mobile`）+ 改写 `Sec-CH-UA-Mobile/Platform/Platform-Version` 头，让 X.com 等靠 Client Hints 路由布局的站点真正显示移动版。`m10-mobile-emulation-clienthints` tag 落地。

**Architecture:** 新增 `src/main/mobile-emulation.ts` 模块集中三件事：UA → Client Hints metadata 解析、`webContents.enableDeviceEmulation` 开关、`session.webRequest.onBeforeSendHeaders` 头改写。ViewManager 三处加 hook（createTab/setMobile/getMobileEmulationState lookup），`index.ts` 一次性挂载 webRequest 处理器。

> **执行后修订（M10.5，2026-04-27）：** 上述方案落地后实测 4 个 JS 信号（`userAgentData.mobile` / `(pointer:coarse)` / `(hover:none)` / `'ontouchstart' in window`）**不翻**——`enableDeviceEmulation` 只动 blink 内部 mobile flag。已升级到 hybrid CDP：保留全部基础设施 + 新加 `attachCdpEmulation` / `detachCdpEmulation`（`webContents.debugger` + 4 条 Emulation 命令），新加 `devtools-opened/closed` 监听做共存（F12 与 mobile 模式临时互斥），新加 `did-navigate` 监听重发 CDP 命令（防 fresh-frame race）。详见 design §16。

**Tech stack delta:** 无新依赖。

**Spec reference:** [docs/superpowers/specs/2026-04-27-mobile-emulation-clienthints-design.md](../specs/2026-04-27-mobile-emulation-clienthints-design.md)

**全局 guardrails：**
- **Electron 命令前 `unset ELECTRON_RUN_AS_NODE`**：用户 shell env 污染；`pnpm dev / build / test:e2e / build:installer` 前必须先 unset（或走 `scripts/run.mjs`，已 unset）。
- **Per-task commit**：每个 Task 一个 atomic commit，message 见任务末。
- **Task 4 是关键 gate**：spike 验 `enableDeviceEmulation` 是否真的翻 `userAgentData.mobile` / `(pointer:coarse)` / `(hover:none)` / `'ontouchstart' in window`。**spike 不过就 STOP**，回报用户决定走升级方案（混合 CDP），不要硬继续。
- **不动**：M0–M9 已实现的 EdgeDock / DimController / SettingsStore / 快捷键 / IPC 契约。M10 只在 ViewManager + index.ts + 新模块里打 patch。
- **Plan execution convention**（用户偏好）：每个 Task 完成后主动汇报；要偏离 plan 先问；用户负责手动冒烟；`m10-mobile-emulation-clienthints` tag 用户确认手动冒烟通过后才打。

---

## Task 1: Spec 修订（§5.4 / §11 / §4.1）

**Files:** Modify `docs/superpowers/specs/2026-04-23-sidebrowser-design.md`。

### 设计

设计文档 §13 已经把替换内容定死了。本任务只是机械搬过来。

- [ ] **Step 1: 改 §5.4**

[docs/superpowers/specs/2026-04-23-sidebrowser-design.md:269](docs/superpowers/specs/2026-04-23-sidebrowser-design.md#L269) 这一行（spec §5.4 末尾）：

```
- v1 **不用** CDP `Emulation.setDeviceMetricsOverride`——窗口本身就是手机尺寸，视口天然移动化，UA 切换对绝大多数站足够。
```

替换成：

```
- 现代站点（X.com 等）通过 Client Hints (`Sec-CH-UA-Mobile`、`Sec-CH-UA-Platform`、`navigator.userAgentData.*`) 与触摸/指针媒体查询决定布局，UA 字符串只是其中一个信号。`setUserAgent` 不足以让站点切真移动版。SessionManager（`mobile-emulation.ts` 模块，M10 引入）补两件事：(a) `wc.enableDeviceEmulation({ screenPosition: 'mobile' })` 翻 Chromium 内部 mobile flag → 触摸 / `(pointer:coarse)` / `(hover:none)` / `userAgentData.mobile` 全部按移动设备表现；(b) `session.webRequest.onBeforeSendHeaders` 改 `Sec-CH-UA-Mobile/Platform/Platform-Version`。Client Hints 元数据按 UA 字符串自动推导（iPhone/iPad → iOS、Android → Android、其他 → fallback iOS），用户改 `mobileUserAgent` 时自动同步。不用 CDP `webContents.debugger`，避免与 F12 DevTools 互斥。详见 [M10 design doc](../specs/2026-04-27-mobile-emulation-clienthints-design.md)。
```

- [ ] **Step 2: 改 §11**

[docs/superpowers/specs/2026-04-23-sidebrowser-design.md:428](docs/superpowers/specs/2026-04-23-sidebrowser-design.md#L428) 这一行：

```
- CDP `Emulation.setDeviceMetricsOverride`
```

整行删除（它前后是其他「不做」条目，删掉一行即可）。

- [ ] **Step 3: 改 §4.1 架构图**

[docs/superpowers/specs/2026-04-23-sidebrowser-design.md:74](docs/superpowers/specs/2026-04-23-sidebrowser-design.md#L74) 这一行（`SessionManager` 行）：

```
│  ├── SessionManager  — 持久化 session、Cookies、UA 切换         │
```

下方紧跟着加一行：

```
│  ├── MobileEmulation — Chromium device emulation + Client Hints 头改写 │
```

注意保持 box-drawing 字符对齐（如果新行末的 `│` 没对齐，调整空格让边框竖直对齐——参考上下文行的列宽）。

- [ ] **Step 4: typecheck / lint / test 跑一遍确认无误伤**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过。spec 文档变化不影响代码，但保险起见跑一下。

- [ ] **Step 5: Commit**

```
git add docs/superpowers/specs/2026-04-23-sidebrowser-design.md
git commit -m "docs(spec): amend §5.4/§11/§4.1 — Client Hints + device emulation per M10"
```

---

## Task 2: `parseUaForMetadata` + UaMetadata interface（TDD）

**Files:**
- Create: `src/main/mobile-emulation.ts`
- Create: `tests/unit/mobile-emulation.test.ts`

### 设计

只引入纯函数 + 接口，先把 UA 解析这块单测跑绿。`applyMobileEmulation` / `removeMobileEmulation` / `installMobileHeaderRewriter` 留在 Task 3 / 7 加。

**接口**：

```ts
export interface UaMetadata {
  /** Client Hints platform value, e.g. "iOS"、"Android"、"Windows"、"macOS"、"Linux"。出 sf-string 时用 `"${platform}"` 包引号。 */
  platform: string;
  /** Client Hints platform-version；解析失败时为空串，调用方据此决定是否发出 Sec-CH-UA-Platform-Version 头。 */
  platformVersion: string;
  /** 是否报为移动设备。决定 Sec-CH-UA-Mobile 是 ?1 还是 ?0、`navigator.userAgentData.mobile`（如调用方走 CDP 兜底时）。 */
  mobile: boolean;
}
```

**解析规则**（设计 §5 抄过来）：自上而下，第一个命中即返回。

| 优先级 | 匹配 | 输出 |
|---|---|---|
| 1 | `/iPhone\|iPad\|iPod/` | `{ platform: 'iOS', mobile: true, platformVersion: 解析 'OS (\d+)_(\d+)' 把下划线换点; 失败则 '' }` |
| 2 | `/Android/` | `{ platform: 'Android', mobile: true, platformVersion: 解析 'Android (\d+(\.\d+)?)'; 失败则 '' }` |
| 3 | `/Macintosh\|Mac OS X/`（且未命中 1） | `{ platform: 'macOS', mobile: false, platformVersion: '' }` |
| 4 | `/Windows/` | `{ platform: 'Windows', mobile: false, platformVersion: '' }` |
| 5 | `/Linux/` | `{ platform: 'Linux', mobile: false, platformVersion: '' }` |
| 6 | fallback | `{ platform: 'iOS', mobile: true, platformVersion: '' }` |

- [ ] **Step 1: 写 failing 单测**

`tests/unit/mobile-emulation.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseUaForMetadata } from '../../src/main/mobile-emulation';
import { MOBILE_UA } from '../../src/shared/settings-defaults';

describe('parseUaForMetadata', () => {
  it('parses default iPhone iOS 17.4 UA → iOS / 17.4 / mobile', () => {
    expect(parseUaForMetadata(MOBILE_UA)).toEqual({
      platform: 'iOS',
      platformVersion: '17.4',
      mobile: true,
    });
  });

  it('parses iPhone iOS 16.3 UA → iOS / 16.3 / mobile (different version)', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';
    expect(parseUaForMetadata(ua)).toEqual({
      platform: 'iOS',
      platformVersion: '16.3',
      mobile: true,
    });
  });

  it('parses iPad UA → iOS / mobile (iPad reports as iOS per Client Hints convention)', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(parseUaForMetadata(ua)).toEqual({
      platform: 'iOS',
      platformVersion: '17.4',
      mobile: true,
    });
  });

  it('parses Android 14 UA → Android / 14 / mobile', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    expect(parseUaForMetadata(ua)).toEqual({
      platform: 'Android',
      platformVersion: '14',
      mobile: true,
    });
  });

  it('parses Android with sub-version (10.0) UA → platformVersion "10.0"', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 10.0; Pixel 4) Mobile';
    expect(parseUaForMetadata(ua).platformVersion).toBe('10.0');
  });

  it('parses Windows desktop UA → Windows / "" / non-mobile', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUaForMetadata(ua)).toEqual({
      platform: 'Windows',
      platformVersion: '',
      mobile: false,
    });
  });

  it('parses macOS UA → macOS / "" / non-mobile', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(parseUaForMetadata(ua)).toEqual({
      platform: 'macOS',
      platformVersion: '',
      mobile: false,
    });
  });

  it('parses Linux UA → Linux / "" / non-mobile', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
    expect(parseUaForMetadata(ua)).toEqual({
      platform: 'Linux',
      platformVersion: '',
      mobile: false,
    });
  });

  it('falls back to iOS / mobile for empty string', () => {
    expect(parseUaForMetadata('')).toEqual({
      platform: 'iOS',
      platformVersion: '',
      mobile: true,
    });
  });

  it('falls back to iOS / mobile for unrecognized UA (KaiOS / Tizen / etc)', () => {
    expect(parseUaForMetadata('Mozilla/5.0 (KAIOS) Gecko/0.0 Firefox/0.0')).toEqual({
      platform: 'iOS',
      platformVersion: '',
      mobile: true,
    });
  });

  it('iPhone match wins over Mac OS X (UA contains both: iPhone Safari includes "like Mac OS X")', () => {
    expect(parseUaForMetadata(MOBILE_UA).platform).toBe('iOS');
  });
});
```

- [ ] **Step 2: 跑测试确认 red**

```
pnpm test mobile-emulation
```

Expected: 11 个测试全 fail，原因是 `mobile-emulation.ts` 模块不存在。

- [ ] **Step 3: 实现 `parseUaForMetadata`**

`src/main/mobile-emulation.ts`：

```ts
/**
 * Mobile emulation 模块——M10。
 *
 * 集中三件事：
 *   1. UA → Client Hints metadata 推导（parseUaForMetadata，纯函数）
 *   2. Chromium 内部 mobile flag 开关（applyMobileEmulation / removeMobileEmulation，Task 3 加）
 *   3. session-level Sec-CH-UA-* 头改写（installMobileHeaderRewriter，Task 7 加）
 *
 * 设计文档：docs/superpowers/specs/2026-04-27-mobile-emulation-clienthints-design.md
 */

export interface UaMetadata {
  platform: string;
  platformVersion: string;
  mobile: boolean;
}

/**
 * 自上而下匹配 UA 字符串，第一个命中即返回。fallback 落 iOS/mobile（理由见 spec §5）。
 * 注意：iPhone Safari UA 的 'like Mac OS X' 含 "Mac OS X" 字样，所以 iOS 必须排在
 * Macintosh 之前。
 */
export function parseUaForMetadata(ua: string): UaMetadata {
  // 1. iOS（含 iPhone / iPad / iPod；UA 同时含 "Mac OS X" 也走这条）
  if (/iPhone|iPad|iPod/.test(ua)) {
    const m = /OS (\d+)_(\d+)/.exec(ua);
    return {
      platform: 'iOS',
      platformVersion: m ? `${m[1]}.${m[2]}` : '',
      mobile: true,
    };
  }
  // 2. Android（Android UA 也常带 "Linux"，所以排在 Linux 之前）
  if (/Android/.test(ua)) {
    const m = /Android (\d+(?:\.\d+)?)/.exec(ua);
    return {
      platform: 'Android',
      platformVersion: m ? m[1] : '',
      mobile: true,
    };
  }
  // 3. macOS
  if (/Macintosh|Mac OS X/.test(ua)) {
    return { platform: 'macOS', platformVersion: '', mobile: false };
  }
  // 4. Windows
  if (/Windows/.test(ua)) {
    return { platform: 'Windows', platformVersion: '', mobile: false };
  }
  // 5. Linux
  if (/Linux/.test(ua)) {
    return { platform: 'Linux', platformVersion: '', mobile: false };
  }
  // 6. fallback：spec §5——本函数只在 mobile 路径上被调用
  return { platform: 'iOS', platformVersion: '', mobile: true };
}
```

- [ ] **Step 4: 跑测试确认 green**

```
pnpm test mobile-emulation
```

Expected: 11 个测试全 pass。

- [ ] **Step 5: typecheck / lint**

```
pnpm typecheck && pnpm lint
```

Expected: 全过。

- [ ] **Step 6: Commit**

```
git add src/main/mobile-emulation.ts tests/unit/mobile-emulation.test.ts
git commit -m "feat(main): add parseUaForMetadata for Client Hints metadata derivation"
```

---

## Task 3: `applyMobileEmulation` / `removeMobileEmulation` 包装

**Files:**
- Modify: `src/main/mobile-emulation.ts`

### 设计

两个薄封装，调 Electron 自带的 `wc.enableDeviceEmulation(...)` / `wc.disableDeviceEmulation()`。参数固定按 spec §6 那一套。**没有单测**——这俩是 Electron API 的纯穿透，单测 mock 出来跟实测无关，靠 Task 4 的实机 spike 验证。

- [ ] **Step 1: 加两个函数到 mobile-emulation.ts**

在 `parseUaForMetadata` 下方追加：

```ts
import type { WebContents } from 'electron';

/**
 * 翻 Chromium 内部 mobile flag——触摸 / (pointer:coarse) / (hover:none) /
 * userAgentData.mobile / 'ontouchstart' in window 一并按移动设备表现。
 * screenSize / viewSize 都传 0/0 让 Chromium 用真实窗口尺寸（用户调过窗口大小不冲突）。
 * deviceScaleFactor 0 = 用 OS 默认 DPR，不强行 @3x。
 *
 * 重复调用是覆盖式（最新参数生效），不会叠加。
 */
export function applyMobileEmulation(wc: WebContents): void {
  wc.enableDeviceEmulation({
    screenPosition: 'mobile',
    screenSize: { width: 0, height: 0 },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: { width: 0, height: 0 },
    scale: 1,
  });
}

/**
 * 关掉 device emulation，回到 Chromium 默认（Windows 桌面）行为。
 * 重复调用是空操作。
 */
export function removeMobileEmulation(wc: WebContents): void {
  wc.disableDeviceEmulation();
}
```

- [ ] **Step 2: typecheck**

```
pnpm typecheck
```

Expected: 全过。如果 `enableDeviceEmulation` 的类型签名跟代码不符（Electron 41 的类型会报错），按报错调整 parameters object 的 key 名称——参考 `node_modules/.pnpm/electron@41.3.0/node_modules/electron/electron.d.ts` 里 `Parameters` 接口（搜 `enableDeviceEmulation`）。**不要**改 spec/设计的语义，只调类型字面值。

- [ ] **Step 3: lint / test**

```
pnpm lint && pnpm test
```

Expected: 全过。Task 2 的 11 个测试不受影响。

- [ ] **Step 4: Commit**

```
git add src/main/mobile-emulation.ts
git commit -m "feat(main): add applyMobileEmulation/removeMobileEmulation wrappers"
```

---

## Task 4: 接到 ViewManager.createTab + **关键 spike 验证**（make-or-break gate）

**Files:** Modify `src/main/view-manager.ts`。

### 实际 spike 结论（2026-04-27 执行后回填）

预想的失败模式（信号没翻 → 升级 CDP）**没出现**——出现的是另一个失败模式：**`wc.enableDeviceEmulation` 在刚 `new` 出来还没 `loadURL` 的 WebContentsView 上同步死锁主进程**，等不存在的渲染端 ack。表现：所有 e2e（不只是新增的）都报 `getChromeWindow: chrome window (window.sidebrowser) not found within 10000ms`，主进程被冻死。

**Spike 实测路径：**
1. 按设计 §6 把 `applyMobileEmulation` 同步接到 `setUserAgent` 之后、`loadURL` 之前 → e2e 全挂
2. 把参数从 0/0 改成真实 contentBounds → 仍挂（参数无关）
3. 加 `try/catch` + 文件日志，发现 `[BEFORE]` 写入但 `[AFTER]` 没写 → 死锁定位
4. 改成 `wc.once('did-start-loading', () => applyMobileEmulation(...))` → 全部 e2e 通过 ✓

**结论：** 同步调用方式不可行；deferred 到 `did-start-loading` 是正解。设计 §6 已 amend。`applyMobileEmulation` 函数签名也加了必传 `screenSize` 参数（0/0 也死锁）。

### 设计（修订后）

把 `applyMobileEmulation` 接到 createTab，但**通过 `wc.once('did-start-loading', ...)` 监听器 defer**。仅 createTab，不动 setMobile（Task 5）。

- [ ] **Step 1: createTab 加 applyMobileEmulation 调用（deferred to did-start-loading）**

文件顶部加 import：

```ts
import { applyMobileEmulation } from './mobile-emulation';
```

`setUserAgent` 调用之后、`loadURL` 之前加：

```ts
view.webContents.setUserAgent(
  resolvedIsMobile ? defaults.mobileUserAgent : desktopUa(),
);
// M10: 翻 Chromium 内部 mobile flag。setUserAgent 只改 UA 字符串，
// 不影响 (pointer:coarse) / userAgentData.mobile / 触摸——见 M10 design doc §1。
//
// 必须 defer 到 'did-start-loading'：在 fresh webContents 上同步调
// enableDeviceEmulation 会死锁主进程（等不存在的渲染端 ack）。did-start-loading
// 在渲染进程已起来、但首个 HTTP 响应到达前触发，emulation 能赶上首屏渲染。
if (resolvedIsMobile) {
  view.webContents.once('did-start-loading', () => {
    const b = this.window.getContentBounds();
    applyMobileEmulation(view.webContents, { width: b.width, height: b.height });
  });
}
```

- [ ] **Step 2: typecheck / lint / test**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过。现有 view-manager 单测不该受影响（mock 没覆盖 enableDeviceEmulation）。如果 mock 报「method not found」，去对应 mock 文件里加一个空实现。

- [ ] **Step 3: 构建并启 dev 模式**

```
pnpm build
pnpm dev
```

Expected: sidebrowser 起来，看到默认 about:blank tab。F12 打开 DevTools 不报错。

- [ ] **Step 4: 在 about:blank tab 的 DevTools console 跑诊断**

按 F12 → Console 标签，粘贴：

```js
({
  ua: navigator.userAgent,
  uaDataMobile: navigator.userAgentData?.mobile,
  uaDataPlatform: navigator.userAgentData?.platform,
  pointerCoarse: matchMedia('(pointer: coarse)').matches,
  hoverNone: matchMedia('(hover: none)').matches,
  hasTouch: 'ontouchstart' in window,
})
```

**期望输出**（**必须全部成立才能继续**）：

```
{
  ua: '...iPhone...Safari...',
  uaDataMobile: true,           ← 关键
  uaDataPlatform: ...,          ← 这个不强求 'iOS'（Task 7 的 webRequest 才覆盖；此 spike 只看 mobile flag）
  pointerCoarse: true,          ← 关键
  hoverNone: true,              ← 关键
  hasTouch: true,               ← 关键
}
```

- [ ] **Step 5: 信号验证延后到 Task 10 手动冒烟**

E2E 跨不到 webContents 内部状态——`navigator.userAgentData.mobile` / `(pointer: coarse)` 等是否真翻成 mobile，由 Task 10 的 X.com 底部 tab 栏作为终极判据。Task 4 内只验"e2e 全绿且没死锁"，spike 成功。

如果 Task 10 X.com 仍显示 narrow desktop（mobile flag 没翻）：升级到混合 CDP 方案——保留 `enableDeviceEmulation` 用于触摸/媒体查询，再用 `webContents.debugger.attach` 调 CDP `Emulation.setUserAgentOverride` 带 `userAgentMetadata` 兜底 `userAgentData`（接受 F12 与 mobile 模式互斥）。

- [ ] **Step 6: Commit**

```
git add src/main/view-manager.ts src/main/mobile-emulation.ts
git commit -m "feat(main): wire applyMobileEmulation into createTab via did-start-loading"
```

Commit message 里说明 spike 结论：同步调用死锁、defer 到 did-start-loading、screenSize 必传。

**完成 Task 4 时主动汇报：spike 路径（同步死锁 → did-start-loading defer），e2e 通过状态。**

---

## Task 5: ViewManager.setMobile 集成

**Files:** Modify `src/main/view-manager.ts`。

### 设计

setMobile 是切换路径——既要 apply/remove emulation，也要 setUserAgent + reload。spec §8 给的顺序：apply/remove → setUserAgent → updateTab → reloadIgnoringCache。

- [ ] **Step 1: 改 setMobile**

[src/main/view-manager.ts:209-217](src/main/view-manager.ts#L209-L217) 现状：

```ts
setMobile(id: string, isMobile: boolean): void {
  const managed = this.tabs.get(id);
  if (!managed) return;
  const wc = managed.view.webContents;
  const defaults = this.getBrowsingDefaults();
  wc.setUserAgent(isMobile ? defaults.mobileUserAgent : desktopUa());
  this.updateTab(id, { isMobile, favicon: null });
  wc.reloadIgnoringCache();
}
```

文件顶部已经在 Task 4 加过 import，确认已有：

```ts
import { applyMobileEmulation, removeMobileEmulation } from './mobile-emulation';
```

如果 Task 4 时只 import 了 `applyMobileEmulation`，这里把 `removeMobileEmulation` 也加上。

替换 setMobile 函数体为：

```ts
setMobile(id: string, isMobile: boolean): void {
  const managed = this.tabs.get(id);
  if (!managed) return;
  const wc = managed.view.webContents;
  const defaults = this.getBrowsingDefaults();
  // M10: emulation 必须在 setUserAgent 之前，跟 createTab 顺序一致——保证 reload 后
  // 第一个请求带新的 UA + Client Hints state（Task 7 的 webRequest 改写依赖
  // getMobileEmulationState lookup，而 lookup 读 tab.isMobile，下面 updateTab 才改）。
  if (isMobile) applyMobileEmulation(wc); else removeMobileEmulation(wc);
  wc.setUserAgent(isMobile ? defaults.mobileUserAgent : desktopUa());
  this.updateTab(id, { isMobile, favicon: null });
  wc.reloadIgnoringCache();
}
```

- [ ] **Step 2: typecheck / lint / test**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过。

- [ ] **Step 3: 手动冒烟（开发期，不强求一定要每次跑）**

可选：`pnpm dev`，新建 tab 默认 mobile，访问 example.com，F12 console 跑 Task 4 Step 4 的诊断，确认四信号全 true。点 TopBar 的 desktop toggle，re-run 诊断，确认四信号变 false（Chromium 默认）。再切回 mobile，确认又翻成 true。

- [ ] **Step 4: Commit**

```
git add src/main/view-manager.ts
git commit -m "feat(main): wire applyMobileEmulation/removeMobileEmulation into ViewManager.setMobile"
```

---

## Task 6: ViewManager.getMobileEmulationState lookup

**Files:** Modify `src/main/view-manager.ts`。

### 设计

Task 7 的 webRequest 处理器需要根据请求来源 `webContentsId` 查到 tab 的 isMobile + 推导 metadata。在 ViewManager 上加 public method `getMobileEmulationState(wcId): UaMetadata | null`。

- [ ] **Step 1: 在 ViewManager class 加新方法**

[src/main/view-manager.ts](src/main/view-manager.ts) 文件里，找到 `getWebContentsByUrlSubstring` 方法（class 内 public 方法之一），紧挨着加：

```ts
import { applyMobileEmulation, removeMobileEmulation, parseUaForMetadata, type UaMetadata } from './mobile-emulation';
```

（替换之前 Task 4 / Task 5 已经加过的 import 行，把 `parseUaForMetadata` 和 `UaMetadata` 也加上。）

class 方法（建议放在 `getWebContentsByUrlSubstring` 上方或下方，紧邻其他 lookup 类 helper）：

```ts
/**
 * Lookup helper for installMobileHeaderRewriter (M10 Task 7).
 * 返回值语义：
 *   null       → 该 wcId 对应 desktop tab / 不是 tab（chrome renderer 自己），头不动
 *   UaMetadata → mobile tab，按这份元数据改 Sec-CH-UA-* 头
 *
 * 每次 webRequest 命中都跑一次。parse 是几个 regex，tab 数 ≤ 几个，UA 字符串
 * 可被用户在 settings 改，实时 parse 比缓存失效逻辑简单（设计 §8）。
 */
getMobileEmulationState(wcId: number): UaMetadata | null {
  for (const [, m] of this.tabs) {
    if (m.view.webContents.id === wcId) {
      if (!m.tab.isMobile) return null;
      return parseUaForMetadata(this.getBrowsingDefaults().mobileUserAgent);
    }
  }
  return null;
}
```

- [ ] **Step 2: typecheck / lint / test**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过。这个方法目前没人调（Task 8 的 index.ts 才会用），但加到 class 上不影响测试。

- [ ] **Step 3: Commit**

```
git add src/main/view-manager.ts
git commit -m "feat(main): expose getMobileEmulationState lookup for header rewriter"
```

---

## Task 7: `installMobileHeaderRewriter` + 单测

**Files:**
- Modify: `src/main/mobile-emulation.ts`
- Modify: `tests/unit/mobile-emulation.test.ts`

### 设计

把 `webRequest.onBeforeSendHeaders` 处理器封装进一个具名安装函数。**用单测，不用 e2e**：mock `Session` 的 `webRequest` 形状，断言注册的回调收到 mobile / desktop / 未知 wcId 三种 details 时分别注入正确头部 / 不动头部。

- [ ] **Step 1: 写 failing 单测**

`tests/unit/mobile-emulation.test.ts` 末尾追加（保留 Task 2 的 parseUaForMetadata 测试块）：

```ts
import { installMobileHeaderRewriter } from '../../src/main/mobile-emulation';
import type { Session } from 'electron';
import type { UaMetadata } from '../../src/main/mobile-emulation';

describe('installMobileHeaderRewriter', () => {
  // 抓 onBeforeSendHeaders 注册的 listener，让测试可以直接调用它。
  function makeFakeSession(): { session: Session; getListener: () => null | ((details: any, cb: any) => void) } {
    let listener: null | ((details: any, cb: any) => void) = null;
    const session = {
      webRequest: {
        onBeforeSendHeaders: (cb: (details: any, cb2: any) => void) => {
          listener = cb;
        },
      },
    } as unknown as Session;
    return { session, getListener: () => listener };
  }

  function mobileMeta(): UaMetadata {
    return { platform: 'iOS', platformVersion: '17.4', mobile: true };
  }

  it('注入 Sec-CH-UA-Mobile/Platform/Platform-Version when state returns metadata', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => mobileMeta());

    const cbResult = vi.fn();
    getListener()!(
      { webContentsId: 42, requestHeaders: { 'X-Existing': 'keep-me' } },
      cbResult,
    );

    expect(cbResult).toHaveBeenCalledOnce();
    const arg = cbResult.mock.calls[0][0];
    expect(arg.requestHeaders['Sec-CH-UA-Mobile']).toBe('?1');
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"iOS"');
    expect(arg.requestHeaders['Sec-CH-UA-Platform-Version']).toBe('"17.4"');
    expect(arg.requestHeaders['X-Existing']).toBe('keep-me');
  });

  it('omits Platform-Version 头 when platformVersion is empty', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => ({
      platform: 'iOS',
      platformVersion: '',
      mobile: true,
    }));

    const cbResult = vi.fn();
    getListener()!({ webContentsId: 42, requestHeaders: {} }, cbResult);

    const arg = cbResult.mock.calls[0][0];
    expect(arg.requestHeaders['Sec-CH-UA-Mobile']).toBe('?1');
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"iOS"');
    expect('Sec-CH-UA-Platform-Version' in arg.requestHeaders).toBe(false);
  });

  it('passes through (callback empty {}) when state returns null', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => null);

    const cbResult = vi.fn();
    getListener()!({ webContentsId: 99, requestHeaders: { 'User-Agent': 'X' } }, cbResult);

    expect(cbResult).toHaveBeenCalledWith({});
  });

  it('passes platform from metadata verbatim (e.g. Android)', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => ({
      platform: 'Android',
      platformVersion: '14',
      mobile: true,
    }));

    const cbResult = vi.fn();
    getListener()!({ webContentsId: 1, requestHeaders: {} }, cbResult);

    const arg = cbResult.mock.calls[0][0];
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"Android"');
    expect(arg.requestHeaders['Sec-CH-UA-Platform-Version']).toBe('"14"');
  });
});
```

注意：`vi` 来自 vitest，需要在文件顶部 import 块加：

```ts
import { describe, it, expect, vi } from 'vitest';
```

（之前 Task 2 时只 import 了 describe/it/expect，这里要补上 vi。）

- [ ] **Step 2: 跑测试确认 red**

```
pnpm test mobile-emulation
```

Expected: 4 个新测试全 fail（`installMobileHeaderRewriter is not a function`），Task 2 的 11 个测试不受影响。

- [ ] **Step 3: 实现 `installMobileHeaderRewriter`**

`src/main/mobile-emulation.ts` 末尾追加：

```ts
import type { Session } from 'electron';

/**
 * 在 persistent session 上挂一次 onBeforeSendHeaders 处理器。
 * `getMobileEmulationState` 是 ViewManager 暴露的 lookup（M10 Task 6）：
 *   - null       → 该 wcId 是 desktop tab / 不是 tab，头不动
 *   - UaMetadata → mobile tab，按元数据改 Sec-CH-UA-Mobile/Platform/Platform-Version
 *
 * 只动这三个头：Sec-CH-UA（品牌列表）让 Chromium 发真实值；User-Agent 由 wc.setUserAgent
 * 处理；Sec-CH-UA-Arch / Bitness / Model / Full-Version-List 不动（设计 §3）。
 *
 * 注册一次即可——session 是 app 全局单例，所有 tab 共享。注册时机：app.whenReady() 之后、
 * ViewManager 创建之后、第一次 createTab 之前（详见 M10 Task 8）。
 */
export function installMobileHeaderRewriter(
  session: Session,
  getMobileEmulationState: (wcId: number) => UaMetadata | null,
): void {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const meta = getMobileEmulationState(details.webContentsId);
    if (!meta) {
      callback({});
      return;
    }
    const headers = { ...details.requestHeaders };
    headers['Sec-CH-UA-Mobile']   = meta.mobile ? '?1' : '?0';
    headers['Sec-CH-UA-Platform'] = `"${meta.platform}"`;
    if (meta.platformVersion) {
      headers['Sec-CH-UA-Platform-Version'] = `"${meta.platformVersion}"`;
    }
    callback({ requestHeaders: headers });
  });
}
```

- [ ] **Step 4: 跑测试确认 green**

```
pnpm test mobile-emulation
```

Expected: 4 个新测试 + 11 个 Task 2 测试 = 15 个全 pass。

- [ ] **Step 5: typecheck / lint**

```
pnpm typecheck && pnpm lint
```

Expected: 全过。如果 lint 报「不允许 any」，把 fake session 工厂里的 `(details: any, cb: any)` 类型改成 Electron 的 `OnBeforeSendHeadersListenerDetails` / `OnBeforeSendHeadersResponse`。简单起见也可以本地用一行 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 关掉。

- [ ] **Step 6: Commit**

```
git add src/main/mobile-emulation.ts tests/unit/mobile-emulation.test.ts
git commit -m "feat(main): add installMobileHeaderRewriter for Sec-CH-UA-* injection"
```

---

## Task 8: `index.ts` wire-up

**Files:** Modify `src/main/index.ts`。

### 设计

在 ViewManager 构造完之后立即挂 webRequest 处理器。`getPersistentSession()` 在 Task 8 之前已存在（[src/main/session-manager.ts](src/main/session-manager.ts)），只需 import + 调一次。

- [ ] **Step 1: 加 import**

[src/main/index.ts](src/main/index.ts) 顶部 import 块（约第 1–24 行）找到现有的 `import { ViewManager } ...` 附近，加：

```ts
import { installMobileHeaderRewriter } from './mobile-emulation';
import { getPersistentSession } from './session-manager';
```

（注：`getPersistentSession` 现已在 view-manager 内部 import，main/index.ts 还没直接 import 过——加上即可。）

- [ ] **Step 2: 在 ViewManager 构造之后调用**

[src/main/index.ts:122-128](src/main/index.ts#L122-L128) 现状：

```ts
const viewManager = new ViewManager(win, () => {
  const s = settingsStore.get();
  return {
    defaultIsMobile: s.browsing.defaultIsMobile,
    mobileUserAgent: s.browsing.mobileUserAgent,
  };
});
registerIpcRouter(win, viewManager, settingsStore);
```

紧跟 ViewManager 构造之后、`registerIpcRouter` 之前加：

```ts
const viewManager = new ViewManager(win, () => {
  const s = settingsStore.get();
  return {
    defaultIsMobile: s.browsing.defaultIsMobile,
    mobileUserAgent: s.browsing.mobileUserAgent,
  };
});
// M10: 挂 Sec-CH-UA-* 头改写处理器，按 viewManager 的 per-tab isMobile 状态决定改不改。
// 必须在 ViewManager 之后、第一个 createTab 之前——seedTabs 在 did-finish-load 才跑，
// 这里安全。
installMobileHeaderRewriter(getPersistentSession(), (wcId) =>
  viewManager.getMobileEmulationState(wcId),
);
registerIpcRouter(win, viewManager, settingsStore);
```

注意：app.activate 路径（macOS 重新激活）也走类似的 ViewManager 构造流程（[src/main/index.ts:347-358](src/main/index.ts#L347-L358)）。**不要**在那里再挂一遍——session 是 app 全局，挂一次即可，第二次挂会得到两个并列 listener 被串行调用，造成 callback 双重 invoke 报错。spec §1 v1 仅 Windows，activate 路径 best-effort，不动。

- [ ] **Step 3: typecheck / lint / test**

```
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全过。

- [ ] **Step 4: 手动冒烟（开发期）**

`pnpm dev` → 默认 mobile tab 访问 example.com → F12 → Network 标签 → 选一个请求 → 看 Request Headers。期望出现：

```
Sec-CH-UA-Mobile: ?1
Sec-CH-UA-Platform: "iOS"
Sec-CH-UA-Platform-Version: "17.4"
```

切 desktop → reload → 同一请求的 Headers **不**应该再有上面三行（Chromium 默认不发或发 desktop 值）。

- [ ] **Step 5: Commit**

```
git add src/main/index.ts
git commit -m "feat(main): wire installMobileHeaderRewriter to persistent session"
```

---

## Task 9: E2E 测试（Sec-CH-UA-* 头）

**Files:**
- Create: `tests/e2e/mobile-clienthints.spec.ts`

### 设计

复用 [tests/e2e/mobile-ua.spec.ts](tests/e2e/mobile-ua.spec.ts) 的 server pattern——同一个 `/ua` 端点扩字段，记录每次请求的 `sec-ch-ua-mobile` / `sec-ch-ua-platform` / `sec-ch-ua-platform-version`。新建独立 spec 文件而不是改 M3 那个，保持 git history 清晰。

三个用例：
1. 默认 mobile tab → 服务端看到 `sec-ch-ua-mobile: ?1` + `sec-ch-ua-platform: "iOS"`
2. 切 desktop → reload → 服务端再次收到的请求**不**带这俩头被覆写（Chromium 默认行为下要么没有，要么是 Windows 桌面值——断言「不是 mobile」+「不是 iOS」即可）
3. （选做）重启后持久化的 desktop tab 直接发 desktop 头

第 3 个 M3 已经测过 UA 字符串持久化，Client Hints 没必要再单测重复持久化路径——decline。

- [ ] **Step 1: 写 spec**

`tests/e2e/mobile-clienthints.spec.ts`（基于 mobile-ua.spec.ts 改写）：

```ts
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { getChromeWindow, waitForAddressBarReady, navigateActive } from './helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, '../../out/main/index.cjs');

interface ChObservation {
  ua: string;
  mobile: string | undefined;
  platform: string | undefined;
  platformVersion: string | undefined;
}

interface ChServer {
  readonly server: Server;
  readonly baseUrl: string;
  readonly log: ChObservation[];
}

function startChServer(): Promise<ChServer> {
  const log: ChObservation[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/ua') {
      log.push({
        ua: String(req.headers['user-agent'] ?? ''),
        mobile: req.headers['sec-ch-ua-mobile'] as string | undefined,
        platform: req.headers['sec-ch-ua-platform'] as string | undefined,
        platformVersion: req.headers['sec-ch-ua-platform-version'] as string | undefined,
      });
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>UA</title><pre id="ua"></pre>');
      return;
    }
    if (req.url === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({ server, baseUrl: `http://127.0.0.1:${port}`, log });
    });
  });
}

test('mobile tab injects Sec-CH-UA-Mobile/Platform; desktop toggle clears them', async () => {
  const { server, baseUrl, log } = await startChServer();
  const userDataDir = mkdtempSync(join(tmpdir(), 'sidebrowser-m10-ch-'));

  try {
    const app = await electron.launch({
      args: [MAIN_PATH, `--user-data-dir=${userDataDir}`],
    });
    try {
      const page = await getChromeWindow(app);
      await waitForAddressBarReady(page);

      // ---------- Phase 1: 默认 mobile → 头注入 ----------
      await navigateActive(page, `${baseUrl}/ua`);
      await expect.poll(() => log.length >= 1, { timeout: 10_000 }).toBeTruthy();
      const mobileObs = log[log.length - 1];
      expect(mobileObs.ua).toMatch(/iPhone/);
      expect(mobileObs.mobile).toBe('?1');
      expect(mobileObs.platform).toBe('"iOS"');
      expect(mobileObs.platformVersion).toBe('"17.4"');

      // ---------- Phase 2: 切 desktop → 头不再被覆写 ----------
      const beforeToggle = log.length;
      await page.getByTestId('topbar-ua-toggle').click();
      await expect
        .poll(() => log.length > beforeToggle, { timeout: 10_000 })
        .toBeTruthy();
      const desktopObs = log[log.length - 1];
      expect(desktopObs.ua).not.toMatch(/iPhone/);
      // 切到 desktop 后，handler 的 lookup 返回 null → callback({}) 透传，
      // Chromium 自己发的 sec-ch-ua-mobile 应该是 ?0（如果发了）或缺失。
      // 关键断言：不是 ?1（说明我们的 mobile 注入已经停了）。
      expect(desktopObs.mobile).not.toBe('?1');
      // platform 不再被强行设为 "iOS"。Chromium 发什么就发什么（"Windows"），断言不是 "iOS"。
      expect(desktopObs.platform).not.toBe('"iOS"');
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑 e2e**

```
pnpm test:e2e mobile-clienthints
```

Expected: spec pass。如果失败：
- 抓 `console.log(log)` 看到底服务端收到啥头——可能是 webRequest 处理器没挂或挂晚了
- 检查 Task 8 的 `installMobileHeaderRewriter` 是否在 ViewManager 之后、createTab 之前调用

- [ ] **Step 3: 全套 e2e 不退步**

```
pnpm test:e2e
```

Expected: 所有 e2e（M3 mobile-ua 在内）全过。M3 的 mobile-ua spec 不应被影响——它只查 User-Agent 头，不查 Sec-CH-UA-*。

- [ ] **Step 4: Commit**

```
git add tests/e2e/mobile-clienthints.spec.ts
git commit -m "test(e2e): verify Sec-CH-UA-Mobile/Platform header injection on mobile tabs"
```

---

## Task 10: 全套验收 + 打 tag

**Files:** 无新增；最终验证 + 用户冒烟。

- [ ] **Step 1: 全套静态/单元/E2E**

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Expected: 全过。

- [ ] **Step 2: 用户手动冒烟（用户负责，agent 不替）**

启 `pnpm dev`，用户负责验证以下清单：

1. **核心修复**：访问 https://x.com（默认 mobile tab，已登录最好）
   - **底部 tab 栏出现**：Home / Search / Notifications / Messages / Profile（或 Bookmarks 等，依据账号状态）
   - 顶部是小头像/X Logo 的窄移动栏（不是左侧紧凑侧栏的"窄桌面版"）
2. **退化路径**：在 x.com tab 上点 TopBar 的 desktop toggle → 页面 reload → 看到桌面版（左侧大侧栏，主时间线 + 右侧推荐栏）
3. **DevTools 共存**：F12 在 mobile tab 上能正常打开，console 不报 "Another debugger is already attached" 之类的错
4. **持久化**：关 sidebrowser → 重开 → x.com tab 自动恢复并仍是 mobile（M3 已有路径，不应退步）
5. **回归**：M3 mobile-ua spec 在 e2e 已覆盖，不需要重复手测

冒烟通过的判据：以上 5 条全过。任一失败 → 不打 tag，回到失败的 Task 排查。

- [ ] **Step 3: 打 tag（用户确认 Step 2 通过后）**

```
git tag -a m10-mobile-emulation-clienthints -m "M10: mobile emulation enhanced — Client Hints + Chromium device emulation"
```

注意：tag 要 push 才会到 remote，但 push 不在本 plan 范围（用户决定何时发版）。

- [ ] **Step 4: 收尾汇报**

主动汇报：
- 哪些 commit 落地（git log oneline 列表）
- 用户冒烟结果概要（哪几条勾过）
- tag 已打但未 push（如适用）

---

---

## M10.5 后续修订（2026-04-27 执行后回填）

Task 10 的手动冒烟揭示 4 信号未翻，触发 design §15 风险表第 2 行的升级。混合 CDP 方案分 4 个 commit 落地，详见 design §16：

| Commit | 内容 |
|---|---|
| `5a3b3a0` feat(main): add attachCdpEmulation/detachCdpEmulation | 在 mobile-emulation.ts 加两个 CDP 函数；attachCdpEmulation 幂等（已 attach 跳过 attach 但仍重发命令），用 4 条 Emulation 命令 |
| `0a23124` feat(main): wire CDP emulation into ViewManager + DevTools coexistence | createTab / setMobile / setMobile-off / devtools-opened / devtools-closed 路径接 CDP |
| `22d4750` test(e2e): verify all 4 mobile signals flip + add setDeviceMetricsOverride | 加第 4 条 CDP 命令 `setDeviceMetricsOverride { mobile: true }` 翻媒体查询；加 `did-navigate` 监听重发；新建 mobile-js-signals.spec.ts 跨主进程读 4 信号断言全翻 |
| `<this commit>` docs(spec,plan): M10.5 hybrid CDP amendments | design §16 写完整方案 + §15 风险表更新；plan goal 段加 M10.5 修订说明 |

## Definition of Done

- ✅ Task 1 spec 修订（§5.4 / §11 / §4.1）已 commit
- ✅ `mobile-emulation.ts` 模块齐：parseUaForMetadata（11 单测）+ apply/remove 包装 + installMobileHeaderRewriter（4 单测）+ attachCdpEmulation/detachCdpEmulation
- ✅ ViewManager 处 hook：createTab / setMobile / getMobileEmulationState / devtools-opened / devtools-closed / did-navigate
- ✅ `index.ts` 启动顺序里挂一次 `installMobileHeaderRewriter(persistentSession, lookup)`
- ✅ E2E `mobile-clienthints.spec.ts`：Sec-CH-UA-* 头注入 / desktop 取消
- ✅ E2E `mobile-js-signals.spec.ts`（M10.5）：4 个 JS 信号 mobile→all true / desktop→all false
- ✅ 用户冒烟 5 条全过：x.com 底部 tab 栏稳定出现、desktop 切回桌面、F12 与 mobile 共存（临时互斥）、持久化恢复、M3 不退步
- ✅ `pnpm typecheck / lint / test / test:e2e / build` 全绿（215 unit + 23 e2e）
- ✅ `m10-mobile-emulation-clienthints` tag 打上（用户确认冒烟通过后）

**Transfer to next milestone:** 本里程碑收口。M10.5 hybrid CDP 已合并入 M10 同一 tag，不另起 milestone。
