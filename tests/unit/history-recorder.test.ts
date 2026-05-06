import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HistoryStore } from '../../src/main/history-store';
import { HistoryRecorder } from '../../src/main/history-recorder';

const makeRecorder = () => {
  const store = new HistoryStore({ get: () => undefined, set: () => {} });
  const recorder = new HistoryRecorder(store);
  return { store, recorder };
};

describe('HistoryRecorder.recordNavigation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('records http(s) URLs and tracks pending state per tab', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('tab1', 'https://a.com');
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]?.url).toBe('https://a.com');
  });

  it('skips about:blank, chrome:, devtools:, file:, data:, empty', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'about:blank');
    recorder.recordNavigation('t', 'chrome://settings');
    recorder.recordNavigation('t', 'devtools://devtools/bundled/inspector.html');
    recorder.recordNavigation('t', 'file:///C:/x.html');
    recorder.recordNavigation('t', 'data:text/html,hi');
    recorder.recordNavigation('t', '');
    expect(store.all()).toEqual([]);
  });

  it('skipped URL clears any prior pending state for that tab (revoke would be wrong)', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=true
    recorder.recordNavigation('t', 'about:blank');       // skipped → clears pending
    recorder.revokeFailed('t');                          // no-op
    expect(store.all().some((e) => e.url === 'https://a.com')).toBe(true);
  });
});

describe('HistoryRecorder.revokeFailed', () => {
  it('removes the entry only when the last record was a fresh insert', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=true
    recorder.revokeFailed('t');
    expect(store.all()).toEqual([]);
  });

  it('keeps the entry when the last record was a revisit', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=true
    recorder.recordNavigation('t', 'https://a.com');     // wasInsert=false
    recorder.revokeFailed('t');                           // must NOT remove
    expect(store.all()).toHaveLength(1);
  });

  it('is idempotent — second call after revoke is a no-op', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.revokeFailed('t');
    recorder.revokeFailed('t');                           // pending cleared; no throw
    expect(store.all()).toEqual([]);
  });

  it('per-tab pending: revoking tab2 does not affect tab1', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t1', 'https://a.com');
    recorder.recordNavigation('t2', 'https://b.com');
    recorder.revokeFailed('t2');
    expect(store.all().map((e) => e.url)).toEqual(['https://a.com']);
  });
});

describe('HistoryRecorder.patchTitle / patchFavicon', () => {
  it('forwards non-empty title to store', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.patchTitle('https://a.com', 'Hello');
    expect(store.all()[0]?.title).toBe('Hello');
  });

  it('drops empty / whitespace title (does not overwrite existing)', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.patchTitle('https://a.com', 'Real');
    recorder.patchTitle('https://a.com', '');
    recorder.patchTitle('https://a.com', '   ');
    expect(store.all()[0]?.title).toBe('Real');
  });

  it('forwards favicon (including null) to store', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.patchFavicon('https://a.com', 'http://f.ico');
    expect(store.all()[0]?.favicon).toBe('http://f.ico');
    recorder.patchFavicon('https://a.com', null);
    expect(store.all()[0]?.favicon).toBeNull();
  });
});

describe('HistoryRecorder.forgetTab', () => {
  it('clears pending state so a later revoke is a no-op', () => {
    const { store, recorder } = makeRecorder();
    recorder.recordNavigation('t', 'https://a.com');
    recorder.forgetTab('t');
    recorder.revokeFailed('t');
    expect(store.all()).toHaveLength(1);
  });
});
