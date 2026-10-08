import { describe, it, expect } from 'vitest';
import {
  buildHistorySnapshot,
  snapshotNavState,
  withoutPageState,
  MAX_HISTORY_ENTRIES,
  MAX_PAGE_STATE,
} from '../../src/main/tab-history';

const e = (url: string, pageState?: string): { url: string; title: string; pageState?: string } =>
  ({ url, title: url.slice(-1), ...(pageState !== undefined ? { pageState } : {}) });

describe('buildHistorySnapshot', () => {
  it('keeps entries and the active index', () => {
    const snap = buildHistorySnapshot([e('https://a.com/1'), e('https://a.com/2'), e('https://a.com/3')], 1);
    expect(snap).toEqual({
      entries: [
        { url: 'https://a.com/1', title: '1' },
        { url: 'https://a.com/2', title: '2' },
        { url: 'https://a.com/3', title: '3' },
      ],
      index: 1,
    });
  });

  it('drops unsafe entries and shifts the index', () => {
    const snap = buildHistorySnapshot([e('javascript:alert(1)'), e('https://a.com/2'), e('https://a.com/3')], 2);
    expect(snap?.entries.map((x) => x.url)).toEqual(['https://a.com/2', 'https://a.com/3']);
    expect(snap?.index).toBe(1);
  });

  it('returns null when the active entry is unsafe or out of range', () => {
    expect(buildHistorySnapshot([e('https://a.com'), e('data:text/html,x')], 1)).toBeNull();
    expect(buildHistorySnapshot([e('https://a.com')], 3)).toBeNull();
    expect(buildHistorySnapshot([], 0)).toBeNull();
  });

  it('caps long histories around the active entry (mostly back history)', () => {
    const raw = Array.from({ length: 40 }, (_, i) => e(`https://a.com/${i}`));
    const snap = buildHistorySnapshot(raw, 30)!;
    expect(snap.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(snap.entries[snap.index]!.url).toBe('https://a.com/30');
    expect(snap.entries.at(-1)!.url).toBe('https://a.com/35');
  });

  it('drops oversized page state but keeps the entry', () => {
    const snap = buildHistorySnapshot([e('https://a.com', 'x'.repeat(MAX_PAGE_STATE + 1)), e('https://b.com', 'ok')], 1)!;
    expect(snap.entries[0]).toEqual({ url: 'https://a.com', title: 'm' });
    expect(snap.entries[1]!.pageState).toBe('ok');
  });
});

describe('snapshotNavState / withoutPageState', () => {
  it('derives back/forward', () => {
    const snap = buildHistorySnapshot([e('https://a.com/1', 's'), e('https://a.com/2')], 0)!;
    expect(snapshotNavState(snap)).toEqual({ canGoBack: false, canGoForward: true });
    expect(snapshotNavState(null)).toEqual({ canGoBack: false, canGoForward: false });
    expect(withoutPageState(snap).entries[0]).toEqual({ url: 'https://a.com/1', title: '1' });
  });
});
