import { describe, it, expect } from 'vitest';
import { sanitizePersisted } from '../../src/main/tab-persistence';

describe('sanitizePersisted', () => {
  it('returns null when input is missing or malformed', () => {
    expect(sanitizePersisted(null)).toBeNull();
    expect(sanitizePersisted(undefined)).toBeNull();
    expect(sanitizePersisted({})).toBeNull();
    expect(sanitizePersisted({ tabs: 'nope' })).toBeNull();
  });

  it('filters out tabs with non-string ids or illegal urls', () => {
    const result = sanitizePersisted({
      tabs: [
        { id: 'a', url: 'https://example.com' },
        { id: 'b', url: 'javascript:alert(1)' }, // dropped
        { id: 42, url: 'https://y.com' },        // dropped (id non-string)
        { id: 'c', url: 'about:blank' },
      ],
      activeId: 'c',
    });
    expect(result).toEqual({
      tabs: [
        { id: 'a', url: 'https://example.com', isMobile: true },
        { id: 'c', url: 'about:blank', isMobile: true },
      ],
      activeId: 'c',
    });
  });

  it('resets activeId to first tab if stored activeId does not match any tab', () => {
    const result = sanitizePersisted({
      tabs: [{ id: 'a', url: 'https://example.com' }],
      activeId: 'stale-id',
    });
    expect(result?.activeId).toBe('a');
  });

  it('returns null if sanitized tab list is empty', () => {
    const result = sanitizePersisted({
      tabs: [{ id: 'a', url: 'javascript:bad' }],
      activeId: 'a',
    });
    expect(result).toBeNull();
  });

  it('accepts file:// URLs but rejects data: URLs (M8: data: dropped from whitelist)', () => {
    // M8 tightened SAFE_SCHEME to exclude `data:` — aligns persistence with
    // the new ViewManager-level sanitizeUrl guard whose whitelist is
    // http/https/file/about only.
    const result = sanitizePersisted({
      tabs: [
        { id: 'a', url: 'file:///C:/x.html' },
        { id: 'b', url: 'data:text/html,<p>hi</p>' }, // dropped
      ],
      activeId: 'a',
    });
    expect(result?.tabs).toEqual([
      { id: 'a', url: 'file:///C:/x.html', isMobile: true },
    ]);
  });

  it('drops tabs with empty-string id and ignores empty-string activeId', () => {
    const result = sanitizePersisted({
      tabs: [
        { id: '', url: 'https://x.com' },
        { id: 'a', url: 'https://example.com' },
      ],
      activeId: '',
    });
    expect(result).toEqual({
      tabs: [{ id: 'a', url: 'https://example.com', isMobile: true }],
      activeId: 'a',
    });
  });

  it('preserves isMobile when present', () => {
    const result = sanitizePersisted({
      tabs: [{ id: 'a', url: 'https://a.com', isMobile: false }],
      activeId: 'a',
    });
    expect(result).toEqual({
      tabs: [{ id: 'a', url: 'https://a.com', isMobile: false }],
      activeId: 'a',
    });
  });

  it('defaults missing isMobile to true (M2 forward-compat)', () => {
    const result = sanitizePersisted({
      tabs: [
        { id: 'a', url: 'https://a.com' },
        { id: 'b', url: 'https://b.com', isMobile: 'yes' }, // non-boolean should default
      ],
      activeId: 'a',
    });
    expect(result).toEqual({
      tabs: [
        { id: 'a', url: 'https://a.com', isMobile: true },
        { id: 'b', url: 'https://b.com', isMobile: true },
      ],
      activeId: 'a',
    });
  });
});
