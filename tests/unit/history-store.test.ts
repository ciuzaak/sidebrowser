import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HistoryStore,
  type HistoryStoreBackend,
  sanitizePersistedHistory,
} from '../../src/main/history-store';
import type { HistoryEntry } from '@shared/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FakeBackend extends HistoryStoreBackend {
  setCount: number;
  lastSet: { entries: HistoryEntry[] } | undefined;
  seed(value: { entries: HistoryEntry[] } | undefined): void;
}

function createFakeBackend(initial?: { entries: HistoryEntry[] }): FakeBackend {
  let data = initial ? structuredClone(initial) : undefined;
  const backend: FakeBackend = {
    setCount: 0,
    lastSet: undefined,
    get: () => (data === undefined ? undefined : structuredClone(data)),
    set: (value) => {
      data = structuredClone(value);
      backend.lastSet = structuredClone(value);
      backend.setCount += 1;
    },
    seed: (value) => { data = value === undefined ? undefined : structuredClone(value); },
  };
  return backend;
}

const entry = (
  url: string,
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  url,
  title: '',
  favicon: null,
  firstVisitedAt: 1_000_000,
  lastVisitedAt: 1_000_000,
  visitCount: 1,
  ...overrides,
});

// ---------------------------------------------------------------------------
// sanitizePersistedHistory
// ---------------------------------------------------------------------------

describe('sanitizePersistedHistory', () => {
  it('returns empty array for missing / malformed input', () => {
    expect(sanitizePersistedHistory(null)).toEqual([]);
    expect(sanitizePersistedHistory(undefined)).toEqual([]);
    expect(sanitizePersistedHistory({})).toEqual([]);
    expect(sanitizePersistedHistory({ entries: 'nope' })).toEqual([]);
  });

  it('drops entries with non-string url, illegal scheme, or visitCount < 1', () => {
    const cleaned = sanitizePersistedHistory({
      entries: [
        entry('https://a.com'),
        entry('javascript:bad'),
        { ...entry('https://b.com'), url: 42 as unknown as string },
        { ...entry('https://c.com'), visitCount: 0 },
        entry('http://d.com'),
      ],
    });
    expect(cleaned.map((e) => e.url)).toEqual(['https://a.com', 'http://d.com']);
  });

  it('preserves all valid fields verbatim', () => {
    const e = entry('https://x.com', { title: 'X', visitCount: 5, favicon: 'f' });
    const cleaned = sanitizePersistedHistory({ entries: [e] });
    expect(cleaned[0]).toEqual(e);
  });
});

// ---------------------------------------------------------------------------
// HistoryStore — basic CRUD
// ---------------------------------------------------------------------------

describe('HistoryStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts empty when backend has no data', () => {
    const store = new HistoryStore(createFakeBackend());
    expect(store.recent(10)).toEqual([]);
    expect(store.all()).toEqual([]);
  });

  it('hydrates from backend on construction', () => {
    const seeded = createFakeBackend({ entries: [entry('https://a.com')] });
    const store = new HistoryStore(seeded);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]?.url).toBe('https://a.com');
  });

  it('upsert returns true on insert, false on update; counts and timestamps mutate correctly', () => {
    const store = new HistoryStore(createFakeBackend());
    expect(store.upsert('https://a.com', 1000)).toBe(true);
    expect(store.upsert('https://a.com', 5000)).toBe(false);

    const e = store.all()[0]!;
    expect(e.visitCount).toBe(2);
    expect(e.firstVisitedAt).toBe(1000);
    expect(e.lastVisitedAt).toBe(5000);
  });

  it('patchTitle skips empty / whitespace; non-empty overwrites', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.patchTitle('https://a.com', '');
    store.patchTitle('https://a.com', '   ');
    expect(store.all()[0]?.title).toBe('');
    store.patchTitle('https://a.com', 'Hello');
    expect(store.all()[0]?.title).toBe('Hello');
  });

  it('patchFavicon overwrites including with null', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.patchFavicon('https://a.com', 'http://f.ico');
    expect(store.all()[0]?.favicon).toBe('http://f.ico');
    store.patchFavicon('https://a.com', null);
    expect(store.all()[0]?.favicon).toBeNull();
  });

  it('remove deletes; missing url is silent no-op', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.remove('https://a.com');
    store.remove('https://nope.com');
    expect(store.all()).toEqual([]);
  });

  it('recent(N) returns N most recent by lastVisitedAt desc', () => {
    const store = new HistoryStore(createFakeBackend());
    store.upsert('https://a.com', 1000);
    store.upsert('https://b.com', 3000);
    store.upsert('https://c.com', 2000);
    expect(store.recent(2).map((e) => e.url)).toEqual(['https://b.com', 'https://c.com']);
  });

  it('evicts the oldest entry once capacity 500 is exceeded', () => {
    const store = new HistoryStore(createFakeBackend());
    for (let i = 0; i < 500; i++) store.upsert(`https://e${i}.com`, 1000 + i);
    expect(store.all()).toHaveLength(500);

    store.upsert('https://new.com', 999_999);
    expect(store.all()).toHaveLength(500);
    expect(store.all().some((e) => e.url === 'https://e0.com')).toBe(false);
    expect(store.all().some((e) => e.url === 'https://new.com')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HistoryStore — debounce + onChanged + seed
// ---------------------------------------------------------------------------

describe('HistoryStore persistence', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('debounces backend.set: 3 rapid upserts → 1 write after 1000ms', () => {
    const backend = createFakeBackend();
    const store = new HistoryStore(backend);
    store.upsert('https://a.com', 1000);
    store.upsert('https://b.com', 2000);
    store.upsert('https://c.com', 3000);
    expect(backend.setCount).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(backend.setCount).toBe(1);
    expect(backend.lastSet?.entries.map((e) => e.url).sort()).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('flush() forces an immediate write and cancels the timer', () => {
    const backend = createFakeBackend();
    const store = new HistoryStore(backend);
    store.upsert('https://a.com', 1000);
    store.flush();
    expect(backend.setCount).toBe(1);

    vi.advanceTimersByTime(2000);
    expect(backend.setCount).toBe(1);
  });

  it('seed() replaces entries wholesale, writes to backend immediately, and notifies', () => {
    const backend = createFakeBackend();
    const store = new HistoryStore(backend);
    store.upsert('https://old.com', 1000);
    const cb = vi.fn();
    store.onChanged(cb);

    store.seed([entry('https://new.com', { visitCount: 5 })]);
    expect(backend.lastSet?.entries.map((e) => e.url)).toEqual(['https://new.com']);
    expect(store.all().map((e) => e.url)).toEqual(['https://new.com']);

    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('seed() cancels a pending saveTimer so backend.set is called exactly once', () => {
    const backend = createFakeBackend();
    const store = new HistoryStore(backend);
    store.upsert('https://old.com', 1000);     // arms saveTimer
    expect(backend.setCount).toBe(0);

    store.seed([entry('https://new.com')]);     // immediate commit; should cancel pending timer
    expect(backend.setCount).toBe(1);

    vi.advanceTimersByTime(2000);
    expect(backend.setCount).toBe(1);           // pending timer was cancelled — no extra write
  });

  it('seed() cancels a pending notifyTimer so the new notify schedule actually fires', () => {
    const store = new HistoryStore(createFakeBackend());
    const cb = vi.fn();
    store.onChanged(cb);

    store.upsert('https://old.com', 1000);     // arms notifyTimer (16ms throttle)
    // Don't advance time — leave notifyTimer pending.
    store.seed([entry('https://new.com')]);

    // Advance to trigger the notify scheduled by seed (which should have
    // cancelled the prior pending one and rescheduled cleanly).
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onChanged fires on mutation; same-frame mutations coalesce to one notification', () => {
    const store = new HistoryStore(createFakeBackend());
    const cb = vi.fn();
    const off = store.onChanged(cb);

    store.upsert('https://a.com', 1000);
    store.upsert('https://b.com', 2000);
    store.patchTitle('https://a.com', 'Hello');
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    store.upsert('https://c.com', 3000);
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
