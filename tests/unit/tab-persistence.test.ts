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
        { id: 'a', url: 'https://example.com', isMobile: true, title: '', favicon: null, history: null },
        { id: 'c', url: 'about:blank', isMobile: true, title: '', favicon: null, history: null },
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
      { id: 'a', url: 'file:///C:/x.html', isMobile: true, title: '', favicon: null, history: null },
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
      tabs: [{ id: 'a', url: 'https://example.com', isMobile: true, title: '', favicon: null, history: null }],
      activeId: 'a',
    });
  });

  it('preserves isMobile when present', () => {
    const result = sanitizePersisted({
      tabs: [{ id: 'a', url: 'https://a.com', isMobile: false, title: '', favicon: null, history: null }],
      activeId: 'a',
    });
    expect(result).toEqual({
      tabs: [{ id: 'a', url: 'https://a.com', isMobile: false, title: '', favicon: null, history: null }],
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
        { id: 'a', url: 'https://a.com', isMobile: true, title: '', favicon: null, history: null },
        { id: 'b', url: 'https://b.com', isMobile: true, title: '', favicon: null, history: null },
      ],
      activeId: 'a',
    });
  });
});

describe('sanitizePersisted — M16 fields', () => {
  it('keeps title, favicon and a valid history snapshot', () => {
    const out = sanitizePersisted({
      tabs: [{
        id: 'a',
        url: 'https://a.com/2',
        isMobile: false,
        title: 'Two',
        favicon: 'https://a.com/f.ico',
        history: { entries: [{ url: 'https://a.com/1', title: 'One', pageState: 'ps' }, { url: 'https://a.com/2', title: 'Two' }], index: 1 },
      }],
      activeId: 'a',
    });
    expect(out?.tabs[0]).toEqual({
      id: 'a',
      url: 'https://a.com/2',
      isMobile: false,
      title: 'Two',
      favicon: 'https://a.com/f.ico',
      history: { entries: [{ url: 'https://a.com/1', title: 'One', pageState: 'ps' }, { url: 'https://a.com/2', title: 'Two' }], index: 1 },
    });
  });

  it('drops malformed history but keeps the tab', () => {
    for (const history of [{ entries: 'x', index: 0 }, { entries: [{ url: 1 }], index: 0 }, { entries: [], index: 0 }, { entries: [{ url: 'https://a.com' }], index: 0.5 }]) {
      const out = sanitizePersisted({ tabs: [{ id: 'a', url: 'https://a.com', isMobile: true, history }], activeId: 'a' });
      expect(out?.tabs[0]?.history).toBeNull();
    }
  });

  it('loads pre-M16 files (no title/favicon/history)', () => {
    const out = sanitizePersisted({ tabs: [{ id: 'a', url: 'https://a.com', isMobile: true }], activeId: 'a' });
    expect(out?.tabs[0]).toEqual({ id: 'a', url: 'https://a.com', isMobile: true, title: '', favicon: null, history: null });
  });
});

