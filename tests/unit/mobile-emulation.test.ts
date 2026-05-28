import { describe, it, expect, vi } from 'vitest';
import {
  parseUaForMetadata,
  installMobileHeaderRewriter,
  buildChromiumBrands,
  formatBrandList,
  type MobileRequestIdentity,
} from '../../src/main/mobile-emulation';
import type { Session } from 'electron';
import { MOBILE_UA } from '../../src/shared/settings-defaults';

describe('parseUaForMetadata', () => {
  it('parses default Android 14 UA (MOBILE_UA) → Android / 14 / mobile', () => {
    expect(parseUaForMetadata(MOBILE_UA)).toEqual({
      platform: 'Android',
      platformVersion: '14',
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
    const ua = 'Mozilla/5.0 (Linux; Android 10.0; Pixel 4) Mobile';
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
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
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

  it('iPhone match wins over Mac OS X (iPhone Safari UA includes "like Mac OS X")', () => {
    const iphoneUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(parseUaForMetadata(iphoneUa).platform).toBe('iOS');
  });
});

describe('buildChromiumBrands', () => {
  it('derives the major from the UA string (Chrome/NNN) so UA and Sec-CH-UA never skew', () => {
    const { brands, fullVersionList } = buildChromiumBrands(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36',
    );
    expect(brands).toEqual([
      { brand: 'Chromium', version: '146' },
      { brand: 'Google Chrome', version: '146' },
      { brand: 'Not-A.Brand', version: '24' },
    ]);
    // full-version-list major must equal the UA major (no UA/CH version skew).
    for (const b of fullVersionList) {
      if (b.brand !== 'Not-A.Brand') expect(b.version.split('.')[0]).toBe('146');
    }
  });

  it('tracks a different UA major (e.g. a future Chrome 160), not a hardcoded value', () => {
    const { brands } = buildChromiumBrands(
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/160.0.0.0 Mobile Safari/537.36',
    );
    expect(brands[0]).toEqual({ brand: 'Chromium', version: '160' });
    expect(brands[1]).toEqual({ brand: 'Google Chrome', version: '160' });
  });

  it('never returns empty brands (empty brands on Chromium is itself a bot signal)', () => {
    expect(buildChromiumBrands('').brands.length).toBeGreaterThan(0);
  });
});

interface FakeRequestDetails {
  webContentsId: number;
  requestHeaders: Record<string, string>;
}
type CapturedListener = (
  details: FakeRequestDetails,
  cb: (resp: { cancel?: boolean; requestHeaders?: Record<string, string> }) => void,
) => void;

/** Build a Session-shaped fake whose webRequest.onBeforeSendHeaders captures
 *  the listener so tests can invoke it directly. */
function makeFakeSession(): { session: Session; getListener: () => CapturedListener | null } {
  let listener: CapturedListener | null = null;
  const session = {
    webRequest: {
      onBeforeSendHeaders: (cb: CapturedListener) => {
        listener = cb;
      },
    },
  } as unknown as Session;
  return { session, getListener: () => listener };
}

const ANDROID_UA = MOBILE_UA; // default mobile UA is Android Chrome
// Computed the same way the rewriter does — brands derive from the UA string's
// Chrome major, so this is deterministic under Vitest (no Electron engine).
const EXPECTED_SEC_CH_UA = formatBrandList(buildChromiumBrands(ANDROID_UA).brands);

const mobileIdentity = (): MobileRequestIdentity => ({
  userAgent: ANDROID_UA,
  metadata: { platform: 'Android', platformVersion: '14', mobile: true },
});

describe('installMobileHeaderRewriter', () => {
  it('injects User-Agent + Sec-CH-UA + Mobile/Platform/Platform-Version; preserves other headers', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => mobileIdentity());

    const cbResult = vi.fn();
    getListener()!(
      { webContentsId: 42, requestHeaders: { 'X-Existing': 'keep-me' } },
      cbResult,
    );

    expect(cbResult).toHaveBeenCalledOnce();
    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    expect(arg.requestHeaders['User-Agent']).toBe(ANDROID_UA);
    expect(arg.requestHeaders['Sec-CH-UA']).toBe(EXPECTED_SEC_CH_UA);
    expect(arg.requestHeaders['Sec-CH-UA-Mobile']).toBe('?1');
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"Android"');
    expect(arg.requestHeaders['Sec-CH-UA-Platform-Version']).toBe('"14"');
    expect(arg.requestHeaders['X-Existing']).toBe('keep-me');
  });

  it('omits Platform-Version header when platformVersion is empty', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => ({
      userAgent: ANDROID_UA,
      metadata: { platform: 'Android', platformVersion: '', mobile: true },
    }));

    const cbResult = vi.fn();
    getListener()!({ webContentsId: 42, requestHeaders: {} }, cbResult);

    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    expect(arg.requestHeaders['Sec-CH-UA-Mobile']).toBe('?1');
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"Android"');
    expect('Sec-CH-UA-Platform-Version' in arg.requestHeaders).toBe(false);
  });

  it('passes through (callback empty {}) when identity returns null', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => null);

    const cbResult = vi.fn();
    getListener()!(
      { webContentsId: 99, requestHeaders: { 'User-Agent': 'X' } },
      cbResult,
    );

    expect(cbResult).toHaveBeenCalledWith({});
  });

  // The Cloudflare/OOPIF fix relies on OVERWRITING Chromium's own (lowercase)
  // headers rather than adding case-variant duplicates. Lock that in.
  it('replaces existing lowercase user-agent / sec-ch-ua case-insensitively (no duplicate keys)', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => mobileIdentity());

    const cbResult = vi.fn();
    getListener()!(
      { webContentsId: 1, requestHeaders: { 'user-agent': 'desktop-electron', 'sec-ch-ua': 'old' } },
      cbResult,
    );

    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    const keys = Object.keys(arg.requestHeaders);
    expect(keys.filter((k) => k.toLowerCase() === 'user-agent')).toEqual(['User-Agent']);
    expect(keys.filter((k) => k.toLowerCase() === 'sec-ch-ua')).toEqual(['Sec-CH-UA']);
    expect(arg.requestHeaders['User-Agent']).toBe(ANDROID_UA);
    expect(arg.requestHeaders['Sec-CH-UA']).toBe(EXPECTED_SEC_CH_UA);
  });

  it('threads a non-default (iOS) identity verbatim', () => {
    const { session, getListener } = makeFakeSession();
    const iosUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    installMobileHeaderRewriter(session, () => ({
      userAgent: iosUa,
      metadata: { platform: 'iOS', platformVersion: '17.4', mobile: true },
    }));

    const cbResult = vi.fn();
    getListener()!({ webContentsId: 1, requestHeaders: {} }, cbResult);

    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    expect(arg.requestHeaders['User-Agent']).toBe(iosUa);
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"iOS"');
    expect(arg.requestHeaders['Sec-CH-UA-Platform-Version']).toBe('"17.4"');
  });

  it('deletes a stale Sec-CH-UA-Platform-Version (any case) when platformVersion is empty', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => ({
      userAgent: ANDROID_UA,
      metadata: { platform: 'Android', platformVersion: '', mobile: true },
    }));

    const cbResult = vi.fn();
    getListener()!(
      { webContentsId: 1, requestHeaders: { 'sec-ch-ua-platform-version': '"19.0.0"' } },
      cbResult,
    );

    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    const keys = Object.keys(arg.requestHeaders);
    expect(keys.some((k) => k.toLowerCase() === 'sec-ch-ua-platform-version')).toBe(false);
  });

  // High-entropy hints leak desktop/Electron values from an OOPIF if untouched.
  // Rewrite them to mobile-consistent values, but ONLY when already present
  // (a real browser sends them only after Accept-CH).
  it('rewrites high-entropy CH headers to mobile values only when present', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => mobileIdentity());

    const cbResult = vi.fn();
    getListener()!(
      {
        webContentsId: 1,
        requestHeaders: {
          'sec-ch-ua-full-version-list': '"Chromium";v="146.0.0.0-desktop"',
          'sec-ch-ua-arch': '"x86"',
          'sec-ch-ua-bitness': '"64"',
          // sec-ch-ua-model intentionally absent → must NOT be added
        },
      },
      cbResult,
    );

    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    expect(arg.requestHeaders['Sec-CH-UA-Full-Version-List']).toBe(
      formatBrandList(buildChromiumBrands(ANDROID_UA).fullVersionList),
    );
    expect(arg.requestHeaders['Sec-CH-UA-Arch']).toBe('""');
    expect(arg.requestHeaders['Sec-CH-UA-Bitness']).toBe('""');
    const keys = Object.keys(arg.requestHeaders);
    expect(keys.some((k) => k.toLowerCase() === 'sec-ch-ua-model')).toBe(false);
  });
});
