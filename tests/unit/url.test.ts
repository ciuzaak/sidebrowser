import { describe, it, expect } from 'vitest';
import { normalizeUrlInput } from '@shared/url';

describe('normalizeUrlInput', () => {
  it('prepends https:// to bare hostnames', () => {
    expect(normalizeUrlInput('google.com')).toBe('https://google.com');
    expect(normalizeUrlInput('example.com/path?x=1')).toBe('https://example.com/path?x=1');
  });

  it('preserves explicit http:// urls', () => {
    expect(normalizeUrlInput('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('preserves explicit https:// urls', () => {
    expect(normalizeUrlInput('https://github.com')).toBe('https://github.com');
  });

  it('preserves about: and chrome: schemes', () => {
    expect(normalizeUrlInput('about:blank')).toBe('about:blank');
    expect(normalizeUrlInput('chrome://settings')).toBe('chrome://settings');
  });

  it('treats search-like strings as DuckDuckGo queries', () => {
    expect(normalizeUrlInput('how to use electron')).toBe(
      'https://duckduckgo.com/?q=how%20to%20use%20electron',
    );
  });

  it('trims whitespace', () => {
    expect(normalizeUrlInput('  google.com  ')).toBe('https://google.com');
  });

  it('returns about:blank for empty or whitespace-only input', () => {
    expect(normalizeUrlInput('')).toBe('about:blank');
    expect(normalizeUrlInput('   ')).toBe('about:blank');
  });
});
