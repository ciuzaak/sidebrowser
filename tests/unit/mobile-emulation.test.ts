import { describe, it, expect, vi } from 'vitest';
import {
  parseUaForMetadata,
  installMobileHeaderRewriter,
  type UaMetadata,
} from '../../src/main/mobile-emulation';
import type { Session } from 'electron';
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

  it('iPhone match wins over Mac OS X (UA contains both: iPhone Safari includes "like Mac OS X")', () => {
    expect(parseUaForMetadata(MOBILE_UA).platform).toBe('iOS');
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

const mobileMeta = (): UaMetadata => ({
  platform: 'iOS',
  platformVersion: '17.4',
  mobile: true,
});

describe('installMobileHeaderRewriter', () => {
  it('injects Sec-CH-UA-Mobile / Platform / Platform-Version when state returns metadata', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => mobileMeta());

    const cbResult = vi.fn();
    getListener()!(
      { webContentsId: 42, requestHeaders: { 'X-Existing': 'keep-me' } },
      cbResult,
    );

    expect(cbResult).toHaveBeenCalledOnce();
    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    expect(arg.requestHeaders['Sec-CH-UA-Mobile']).toBe('?1');
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"iOS"');
    expect(arg.requestHeaders['Sec-CH-UA-Platform-Version']).toBe('"17.4"');
    expect(arg.requestHeaders['X-Existing']).toBe('keep-me');
  });

  it('omits Platform-Version header when platformVersion is empty', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => ({
      platform: 'iOS',
      platformVersion: '',
      mobile: true,
    }));

    const cbResult = vi.fn();
    getListener()!({ webContentsId: 42, requestHeaders: {} }, cbResult);

    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    expect(arg.requestHeaders['Sec-CH-UA-Mobile']).toBe('?1');
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"iOS"');
    expect('Sec-CH-UA-Platform-Version' in arg.requestHeaders).toBe(false);
  });

  it('passes through (callback empty {}) when state returns null', () => {
    const { session, getListener } = makeFakeSession();
    installMobileHeaderRewriter(session, () => null);

    const cbResult = vi.fn();
    getListener()!(
      { webContentsId: 99, requestHeaders: { 'User-Agent': 'X' } },
      cbResult,
    );

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

    const arg = cbResult.mock.calls[0]![0] as { requestHeaders: Record<string, string> };
    expect(arg.requestHeaders['Sec-CH-UA-Platform']).toBe('"Android"');
    expect(arg.requestHeaders['Sec-CH-UA-Platform-Version']).toBe('"14"');
  });
});
