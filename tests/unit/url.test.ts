import { describe, it, expect } from 'vitest';
import { normalizeUrlInput } from '@shared/url';

const GOOGLE_T = 'https://www.google.com/search?q={query}';
const DDG_T = 'https://duckduckgo.com/?q={query}';
const BAIDU_T = 'https://www.baidu.com/s?wd={query}';

describe('normalizeUrlInput', () => {
  it('prepends https:// to bare hostnames', () => {
    expect(normalizeUrlInput('google.com', GOOGLE_T)).toBe('https://google.com');
    expect(normalizeUrlInput('example.com/path?x=1', GOOGLE_T)).toBe('https://example.com/path?x=1');
  });

  it('preserves explicit http:// urls', () => {
    expect(normalizeUrlInput('http://localhost:3000', GOOGLE_T)).toBe('http://localhost:3000');
  });

  it('preserves explicit https:// urls', () => {
    expect(normalizeUrlInput('https://github.com', GOOGLE_T)).toBe('https://github.com');
  });

  it('preserves about: and chrome: schemes', () => {
    expect(normalizeUrlInput('about:blank', GOOGLE_T)).toBe('about:blank');
    expect(normalizeUrlInput('chrome://settings', GOOGLE_T)).toBe('chrome://settings');
  });

  it('routes search-like input through google template', () => {
    expect(normalizeUrlInput('how to use electron', GOOGLE_T)).toBe(
      'https://www.google.com/search?q=how%20to%20use%20electron',
    );
  });

  it('routes search-like input through duckduckgo template', () => {
    expect(normalizeUrlInput('hello world', DDG_T)).toBe(
      'https://duckduckgo.com/?q=hello%20world',
    );
  });

  it('routes search-like input through baidu template (CJK encoded)', () => {
    expect(normalizeUrlInput('电子', BAIDU_T)).toBe(
      `https://www.baidu.com/s?wd=${encodeURIComponent('电子')}`,
    );
  });

  it('routes search-like input through a custom template', () => {
    const tpl = 'https://stackoverflow.com/search?q={query}';
    expect(normalizeUrlInput('vitest setup', tpl)).toBe(
      'https://stackoverflow.com/search?q=vitest%20setup',
    );
  });

  it('trims whitespace', () => {
    expect(normalizeUrlInput('  google.com  ', GOOGLE_T)).toBe('https://google.com');
  });

  it('returns about:blank for empty or whitespace-only input', () => {
    expect(normalizeUrlInput('', GOOGLE_T)).toBe('about:blank');
    expect(normalizeUrlInput('   ', GOOGLE_T)).toBe('about:blank');
  });
});
