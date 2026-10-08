import { describe, it, expect, vi } from 'vitest';
import { spotlightHint, withTimeout } from '../../src/renderer/src/lib/spotlight-hint';

const TPL = 'https://www.google.com/search?q={query}';

describe('spotlightHint', () => {
  it('empty draft', () => {
    expect(spotlightHint('', null, TPL, 'Google')).toBe('Type a URL or search');
  });
  it('highlighted suggestion wins', () => {
    expect(spotlightHint('foo', 'https://news.ycombinator.com/x', TPL, 'Google')).toBe(
      'Open news.ycombinator.com',
    );
  });
  it('search vs open', () => {
    expect(spotlightHint('hello world', null, TPL, 'Google')).toBe('Search Google');
    expect(spotlightHint('example.com', null, TPL, 'Google')).toBe('Open example.com');
  });
});

describe('withTimeout', () => {
  it('resolves with the value when fast', async () => {
    await expect(withTimeout(Promise.resolve('x'), 50, null)).resolves.toBe('x');
  });
  it('falls back on timeout', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<string>(() => {}), 150, null);
    vi.advanceTimersByTime(150);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
  });
  it('falls back on rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 50, null)).resolves.toBeNull();
  });
});
