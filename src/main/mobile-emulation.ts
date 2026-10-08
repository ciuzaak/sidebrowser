/**
 * Mobile emulation 模块 — M10 / M10.5（hybrid CDP）。
 *
 * 集中四件事：
 *   1. UA → Client Hints metadata 推导（parseUaForMetadata，纯函数）
 *   2. Chromium 内部 mobile flag 开关（applyMobileEmulation / removeMobileEmulation）
 *   3. session-level Sec-CH-UA-* 头改写（installMobileHeaderRewriter）
 *   4. CDP debugger-based emulation（attachCdpEmulation / detachCdpEmulation）
 *      —— 翻 enableDeviceEmulation 不动的 JS 信号：navigator.userAgentData、
 *      (pointer:coarse) / (hover:none) 媒体查询、'ontouchstart' in window、触摸事件
 *
 * 设计文档：docs/superpowers/specs/2026-04-27-mobile-emulation-clienthints-design.md
 */
import type { Session, WebContents } from 'electron';
import { mobileZoomMetrics } from './mobile-zoom';

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

/** Client Hints brand entry — `{ brand, version }` 对，CDP userAgentMetadata 与
 *  navigator.userAgentData.brands / getHighEntropyValues 同构。 */
export interface UaBrand {
  brand: string;
  version: string;
}

/**
 * 造 Client Hints 品牌列表（brands + fullVersionList），镜像真 Chrome 上报的形态。
 * 纯函数，便于单测。
 *
 * **major 取自传入的 UA 字符串（`Chrome/(\d+)`）而非 `process.versions.chrome`：**
 * 这样 UA 字符串、`Sec-CH-UA` brands、`Sec-CH-UA-Full-Version-List` 的主版本号
 * **永远一致**——UA 与 Client Hints 版本错位（version skew）本身就是 bot 信号。
 * Electron 升级 Chromium 或用户自定义 UA 时，品牌自动跟随 UA，不会出现「UA 写死
 * 146、CH 报引擎新版本」这种矛盾。fullVersionList 的完整构建号在「UA major == 引擎
 * major」时取引擎真实值（`process.versions.chrome`），否则退化为 `${major}.0.0.0`，
 * 始终保证内部自洽。
 *
 * **为什么不能留空 `[]`：** Chromium 引擎却报零品牌本身就是自动化/伪造的强信号——
 * Cloudflare Turnstile 直接调 `navigator.userAgentData.getHighEntropyValues(['brands',
 * 'fullVersionList'])` 读这个。空品牌 + Android-Chrome UA 自相矛盾，验证永不放行。
 *
 * GREASE 品牌（`Not-A.Brand`/`24`）是随版本变化的占位，服务端不依赖其具体值。
 */
export function buildChromiumBrands(ua: string): {
  brands: UaBrand[];
  fullVersionList: UaBrand[];
} {
  const uaMajor = /Chrome\/(\d+)/.exec(ua)?.[1] || '';
  const engineFull = process.versions.chrome || ''; // undefined outside Electron (Vitest)
  const engineMajor = engineFull.split('.')[0] || '';
  const major = uaMajor || engineMajor || '0';
  // 仅当引擎主版本与 UA 主版本一致时用引擎真实构建号，否则退化以保证 UA/CH 不矛盾。
  const full = engineFull && engineMajor === major ? engineFull : `${major}.0.0.0`;
  const GREASE = 'Not-A.Brand';
  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: GREASE, version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full },
      { brand: GREASE, version: '24.0.0.0' },
    ],
  };
}

/**
 * Format a brand list into the `Sec-CH-UA` header's structured-header value,
 * e.g. `"Chromium";v="146", "Google Chrome";v="146", "Not-A.Brand";v="24"`.
 * Used to force a consistent brand header on cross-origin OOPIF requests (see
 * installMobileHeaderRewriter).
 */
export function formatBrandList(brands: UaBrand[]): string {
  return brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
}

/**
 * `navigator.platform` 的 JS 字符串（≠ Client Hints platform token）。真浏览器这里
 * 上报一个固定串，且**不等于** CH platform：Android Chrome → "Linux armv8l"、
 * iPhone → "iPhone"。若在 Android UA 下把它留成宿主真实值（"Win32"）就是指纹矛盾。
 * 默认落 Android（与 fallback=mobile 一致）。
 */
export function navigatorPlatformFor(chPlatform: string): string {
  switch (chPlatform) {
    case 'Android': return 'Linux armv8l';
    case 'iOS':     return 'iPhone';
    case 'macOS':   return 'MacIntel';
    case 'Windows': return 'Win32';
    case 'Linux':   return 'Linux x86_64';
    default:        return 'Linux armv8l';
  }
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
 * `screenSize` 传**实际 webview 尺寸**——host 窗口 contentBounds 减去 chrome
 * (TopBar + TabBar) 高度。**不要**传整窗 contentBounds：模拟视口比实际渲染区
 * 高一截会让 `position: fixed; bottom: 0` 元素掉到可视区外（M10 现场：x.com
 * mobile 底部 nav 永远不可见，把窗口拉长 chromeHeight 那点才会露出来）。
 * height 必须 ≥1，0 在 Electron 41 下复现死锁（spec §6.2）。`viewSize` 同步
 * 用相同值。`deviceScaleFactor: 0` = 用 OS 默认 DPR。
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
 * CDP-based 移动模拟，补足 enableDeviceEmulation 不动的 JS 信号——
 * `navigator.userAgentData.mobile/platform/platformVersion`、`(pointer: coarse)` /
 * `(hover: none)` 媒体查询、`'ontouchstart' in window`、touch 事件。
 *
 * 跟 `webContents.debugger` 通道共用同一个 CDP session——同一时间只能挂一个客户端，
 * 跟 F12 DevTools **互斥**。共存策略由 caller 通过 `devtools-opened` /
 * `devtools-closed` 事件管理（M10.5 设计 §16）。
 *
 * `screenSize` 给 `setDeviceMetricsOverride` 用——CDP 这条要求显式 width/height +
 * `mobile: true`，是翻 `(pointer:coarse)` / `(hover:none)` 媒体查询的关键命令
 * （Puppeteer iPhone emulation 同款 4 命令组合）。
 *
 * 失败模式（`debugger.attach` 抛错）：通常是已经被另一个客户端挂着（例如 F12 已开）。
 * 函数会吞 attach 失败、记录在 console.error；caller 不需要做 try/catch。
 *
 * 重复 attach 是 no-op（先检查 `isAttached()`）。CDP 命令是异步 promise，
 * 函数返回 awaitable promise；caller 可以 `void`（fire-and-forget）或 `await`。
 */
export async function attachCdpEmulation(
  wc: WebContents,
  metadata: UaMetadata,
  ua: string,
  screenSize: { width: number; height: number },
  /** M16: tab zoom factor (1 = 100%); see mobile-zoom.ts for how it maps to CDP. */
  zoom = 1,
): Promise<void> {
  // 幂等：已 attach 则跳过 attach 但仍重发命令（caller 在 did-navigate 上重调本函数
  // 保证每次 fresh JS context 都看到 touch 状态——'ontouchstart' in window 在 window
  // 对象创建时定下来，CDP 命令必须在 frame 渲染前到位才生效）。
  if (!wc.debugger.isAttached()) {
    try {
      wc.debugger.attach('1.3');
    } catch (err) {
      console.error('[sidebrowser] attachCdpEmulation: debugger.attach failed:', err);
      return;
    }
  }
  try {
    // 品牌列表必须非空且与 UA 主版本一致——空 brands / 版本错位都是 bot 信号
    // （Cloudflare Turnstile 读 getHighEntropyValues），见 buildChromiumBrands。
    // 从 ua 派生，保证主框架（CDP）与 OOPIF（header rewriter）品牌完全一致。
    const { brands, fullVersionList } = buildChromiumBrands(ua);
    await wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: ua,
      // navigator.platform —— 固定 JS 串，≠ CH platform（Android→"Linux armv8l"）。
      platform: navigatorPlatformFor(metadata.platform),
      userAgentMetadata: {
        brands,
        fullVersionList,
        platform: metadata.platform,
        platformVersion: metadata.platformVersion,
        // mobile 设备的 architecture/bitness/model 在真 Chrome 上为空，不像桌面
        // 报 x86/64；显式置空覆盖 CDP 默认（实测 desktop 默认填 bitness:"64"）。
        architecture: '',
        model: '',
        mobile: metadata.mobile,
        bitness: '',
      },
    });
    // M16: zoom ≠ 1 narrows the layout viewport and scales the output back up
    // to the real view size (`dontSetVisibleSize` keeps the visible size real,
    // otherwise the scaled output is clipped). zoom = 1 sends exactly the
    // pre-M16 parameters.
    const m = mobileZoomMetrics(screenSize.width, screenSize.height, zoom);
    await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: m.width,
      height: m.height,
      deviceScaleFactor: 0,
      mobile: true,
      ...(m.scale !== 1 ? { scale: m.scale, dontSetVisibleSize: true } : {}),
    });
    await wc.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
  } catch (err) {
    console.error('[sidebrowser] attachCdpEmulation: sendCommand failed:', err);
    // 命令失败时仍保留 attach（部分生效好过完全失效）
  }
}

/**
 * 解除 CDP debugger attach；CDP 设的所有 override 自动失效。
 * 重复 detach 是 no-op。wc 已 close 时静默吞错。
 */
export function detachCdpEmulation(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  if (!wc.debugger.isAttached()) return;
  try {
    wc.debugger.detach();
  } catch (err) {
    console.error('[sidebrowser] detachCdpEmulation: debugger.detach failed:', err);
  }
}

/**
 * 一个 mobile tab 请求要呈现的完整身份。`installMobileHeaderRewriter` 用它把
 * **每一个**出站请求（含跨域 OOPIF）改写成一致的移动身份。
 */
export interface MobileRequestIdentity {
  /** 该 tab 的移动 UA 字符串，写进 User-Agent 头。 */
  userAgent: string;
  /** Client Hints 元数据，驱动 Sec-CH-UA-Mobile/Platform/Platform-Version。 */
  metadata: UaMetadata;
}

/** 大小写不敏感地删头：删掉所有同名变体（'sec-ch-ua' 与 'Sec-CH-UA' 都删）。
 *  返回是否删掉了至少一个，供 rewriteIfPresent 判断「原本是否存在」。 */
function deleteHeader(headers: Record<string, string>, name: string): boolean {
  let found = false;
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) {
      delete headers[k];
      found = true;
    }
  }
  return found;
}

/** 大小写不敏感地设头：先删掉任何已存在的同名变体（避免双键并存），再写规范名。 */
function setHeader(headers: Record<string, string>, name: string, value: string): void {
  deleteHeader(headers, name);
  headers[name] = value;
}

/** 仅当该头原本已存在时才改写（保留「服务端 Accept-CH 请求过才发」的语义；不存在
 *  就不主动添加，未被请求却发送高熵 Client Hints 本身反常）。 */
function rewriteIfPresent(headers: Record<string, string>, name: string, value: string): void {
  if (deleteHeader(headers, name)) headers[name] = value;
}

/**
 * 在 persistent session 上挂一次 onBeforeSendHeaders 处理器。
 * `getMobileIdentity` 是 ViewManager 暴露的 lookup：
 *   - null                  → 该 wcId 是 desktop tab / 不是 tab，头不动
 *   - MobileRequestIdentity → mobile tab，改写下列头
 *
 * **为什么要改 User-Agent + Sec-CH-UA（M15 Cloudflare 修复）：**
 * Cloudflare Turnstile 验证跑在一个跨域 **out-of-process iframe（OOPIF，
 * `challenges.cloudflare.com`）** 里。`wc.setUserAgent` 与挂在主 target 上的 CDP
 * `Emulation.setUserAgentOverride` **都到不了**这个独立 target——它回退到 app 全局
 * 默认 UA（桌面 Electron）。于是「装着 cf_clearance 的页面是安卓手机、但跑验证的
 * iframe 是 Windows 桌面 Electron」，Cloudflare 判定环境矛盾、clearance 永不认可，
 * 移动模式下验证无限循环（desktop 模式两边都是桌面 Electron 故一致、能过）。
 *
 * onBeforeSendHeaders 是 session 级、对所有 frame（含 OOPIF）生效，且 OOPIF 的
 * 子帧请求带的是宿主 webContentsId，故这里能统一兜住：把 User-Agent + 完整
 * Sec-CH-UA 品牌列表也改写成移动身份，让顶框架与 Turnstile iframe 完全一致。
 * 实测：grok.com 由此从 403 cf-mitigated 变 200。
 *
 * Sec-CH-UA 品牌串由 `buildChromiumBrands(id.userAgent)` 从 UA 派生，与 CDP override
 * 同源（同一条 UA），保证主框架（CDP 驱动）与 OOPIF（本改写驱动）品牌一致，且 UA 与
 * Client Hints 主版本号不会错位。高熵头（Full-Version-List/Arch/Bitness/Model）仅在
 * 服务端 Accept-CH 请求后才会出现，故只「存在则改写」成与主框架一致的移动值，避免
 * OOPIF 泄露桌面/Electron 高熵值。
 *
 * 注册一次即可——session 是 app 全局单例，所有 tab 共享。注册时机：app.whenReady()
 * 之后、ViewManager 创建之后、第一次 createTab 之前。
 */
export function installMobileHeaderRewriter(
  session: Session,
  getMobileIdentity: (wcId: number) => MobileRequestIdentity | null,
): void {
  // M16: every request of every tab passes through here on the main thread —
  // memoise the UA-derived brand strings (they only change when the user edits
  // the mobile UA) instead of rebuilding them per request.
  let brandCache: { ua: string; brands: string; fullVersionList: string } | null = null;
  const brandsFor = (ua: string): { brands: string; fullVersionList: string } => {
    if (brandCache?.ua !== ua) {
      const b = buildChromiumBrands(ua);
      brandCache = { ua, brands: formatBrandList(b.brands), fullVersionList: formatBrandList(b.fullVersionList) };
    }
    return brandCache;
  };
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    // webContentsId 不存在的请求（例如某些 service worker / preload-阶段请求）
    // 没法关联到 tab，直接放行不动头。
    const wcId = details.webContentsId;
    const id = wcId === undefined ? null : getMobileIdentity(wcId);
    if (!id) {
      callback({});
      return;
    }
    // 品牌从该 tab 的 UA 派生（与 CDP 主框架一致），按 UA 缓存。
    const { brands, fullVersionList } = brandsFor(id.userAgent);
    const headers = { ...details.requestHeaders };
    setHeader(headers, 'User-Agent', id.userAgent);
    setHeader(headers, 'Sec-CH-UA', brands);
    setHeader(headers, 'Sec-CH-UA-Mobile', id.metadata.mobile ? '?1' : '?0');
    setHeader(headers, 'Sec-CH-UA-Platform', `"${id.metadata.platform}"`);
    if (id.metadata.platformVersion) {
      setHeader(headers, 'Sec-CH-UA-Platform-Version', `"${id.metadata.platformVersion}"`);
    } else {
      // 无版本时主动删除残留值（OOPIF 可能带桌面 Sec-CH-UA-Platform-Version），
      // 否则会与改写后的 platform 矛盾。
      deleteHeader(headers, 'Sec-CH-UA-Platform-Version');
    }
    // 高熵 Client Hints：仅在已存在（被 Accept-CH 请求过）时改写成移动一致值。
    // mobile 的 arch/bitness/model 在真 Chrome 上为空（sf-string `""`）。
    rewriteIfPresent(headers, 'Sec-CH-UA-Full-Version-List', fullVersionList);
    rewriteIfPresent(headers, 'Sec-CH-UA-Arch', '""');
    rewriteIfPresent(headers, 'Sec-CH-UA-Bitness', '""');
    rewriteIfPresent(headers, 'Sec-CH-UA-Model', '""');
    callback({ requestHeaders: headers });
  });
}
