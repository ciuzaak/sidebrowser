/**
 * Mobile emulation 模块 — M10。
 *
 * 集中三件事：
 *   1. UA → Client Hints metadata 推导（parseUaForMetadata，纯函数）
 *   2. Chromium 内部 mobile flag 开关（applyMobileEmulation / removeMobileEmulation，Task 3 加）
 *   3. session-level Sec-CH-UA-* 头改写（installMobileHeaderRewriter，Task 7 加）
 *
 * 设计文档：docs/superpowers/specs/2026-04-27-mobile-emulation-clienthints-design.md
 */

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
