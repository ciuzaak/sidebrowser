/**
 * Mobile emulation 模块 — M10。
 *
 * 集中三件事：
 *   1. UA → Client Hints metadata 推导（parseUaForMetadata，纯函数）
 *   2. Chromium 内部 mobile flag 开关（applyMobileEmulation / removeMobileEmulation）
 *   3. session-level Sec-CH-UA-* 头改写（installMobileHeaderRewriter，Task 7 加）
 *
 * 设计文档：docs/superpowers/specs/2026-04-27-mobile-emulation-clienthints-design.md
 */
import type { Session, WebContents } from 'electron';

export interface UaMetadata {
  /** Client Hints platform value, e.g. "iOS"、"Android"、"Windows"、"macOS"、"Linux"。出 sf-string 时用 `"${platform}"` 包引号。 */
  platform: string;
  /** Client Hints platform-version；解析失败时为空串，调用方据此决定是否发出 Sec-CH-UA-Platform-Version 头。 */
  platformVersion: string;
  /** 是否报为移动设备。决定 Sec-CH-UA-Mobile 是 ?1 还是 ?0、`navigator.userAgentData.mobile`（如调用方走 CDP 兜底时）。 */
  mobile: boolean;
}

/**
 * 自上而下匹配 UA 字符串，第一个命中即返回。fallback 落 iOS/mobile（理由见 spec §5）。
 * 注意：iPhone Safari UA 的 'like Mac OS X' 含 "Mac OS X" 字样，所以 iOS 必须排在
 * Macintosh 之前；Android UA 也常带 "Linux"，所以 Android 排在 Linux 之前。
 */
export function parseUaForMetadata(ua: string): UaMetadata {
  if (/iPhone|iPad|iPod/.test(ua)) {
    const m = /OS (\d+)_(\d+)/.exec(ua);
    return {
      platform: 'iOS',
      platformVersion: m ? `${m[1]}.${m[2]}` : '',
      mobile: true,
    };
  }
  if (/Android/.test(ua)) {
    const m = /Android (\d+(?:\.\d+)?)/.exec(ua);
    return {
      platform: 'Android',
      platformVersion: m ? m[1] : '',
      mobile: true,
    };
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    return { platform: 'macOS', platformVersion: '', mobile: false };
  }
  if (/Windows/.test(ua)) {
    return { platform: 'Windows', platformVersion: '', mobile: false };
  }
  if (/Linux/.test(ua)) {
    return { platform: 'Linux', platformVersion: '', mobile: false };
  }
  return { platform: 'iOS', platformVersion: '', mobile: true };
}

/**
 * 翻 Chromium 内部 mobile flag —— 触摸 / (pointer:coarse) / (hover:none) /
 * userAgentData.mobile / 'ontouchstart' in window 一并按移动设备表现。
 *
 * **调用约束（M10 plan Task 4 spike 实测）：** caller 必须保证 `wc` 处于"渲染进程
 * 已起来"状态，否则 enableDeviceEmulation 会同步死锁主进程等不存在的渲染端 ack。
 * 安全的调用点：
 *   - `wc.once('did-start-loading', ...)` 之后（渲染进程已 spawn，首个 HTTP 响应
 *     之前——首屏 layout 就能用上 mobile flag）
 *   - `wc.once('did-finish-load', ...)` 之后（更晚但更稳，需要紧跟一次 reload）
 *   - 已经加载过页面的 wc（任何已 navigate 过的 wc，例如 setMobile toggle 路径）
 * 不安全：刚 `new WebContentsView(...)` 出来、loadURL 还没调用的 wc。
 *
 * `screenSize` 传 host 窗口的 contentBounds（不传 0/0——0/0 在 Electron 41 下也
 * 复现死锁）。`viewSize` 同步用相同值。`deviceScaleFactor: 0` = 用 OS 默认 DPR。
 *
 * 重复调用是覆盖式（最新参数生效），不会叠加。
 */
export function applyMobileEmulation(
  wc: WebContents,
  screenSize: { width: number; height: number },
): void {
  wc.enableDeviceEmulation({
    screenPosition: 'mobile',
    screenSize,
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    viewSize: screenSize,
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

/**
 * 在 persistent session 上挂一次 onBeforeSendHeaders 处理器。
 * `getMobileEmulationState` 是 ViewManager 暴露的 lookup（M10 Task 6）：
 *   - null       → 该 wcId 是 desktop tab / 不是 tab，头不动
 *   - UaMetadata → mobile tab，按元数据改 Sec-CH-UA-Mobile/Platform/Platform-Version
 *
 * 只动这三个头。Sec-CH-UA（品牌列表）让 Chromium 发真实值；User-Agent 由
 * wc.setUserAgent 处理；Sec-CH-UA-Arch / Bitness / Model / Full-Version-List
 * 不动（design §3）。
 *
 * 注册一次即可——session 是 app 全局单例，所有 tab 共享。注册时机：app.whenReady()
 * 之后、ViewManager 创建之后、第一次 createTab 之前（详见 M10 Task 8）。
 */
export function installMobileHeaderRewriter(
  session: Session,
  getMobileEmulationState: (wcId: number) => UaMetadata | null,
): void {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    // webContentsId 不存在的请求（例如某些 service worker / preload-阶段请求）
    // 没法关联到 tab，直接放行不动头。
    const wcId = details.webContentsId;
    const meta = wcId === undefined ? null : getMobileEmulationState(wcId);
    if (!meta) {
      callback({});
      return;
    }
    const headers = { ...details.requestHeaders };
    headers['Sec-CH-UA-Mobile'] = meta.mobile ? '?1' : '?0';
    headers['Sec-CH-UA-Platform'] = `"${meta.platform}"`;
    if (meta.platformVersion) {
      headers['Sec-CH-UA-Platform-Version'] = `"${meta.platformVersion}"`;
    }
    callback({ requestHeaders: headers });
  });
}
