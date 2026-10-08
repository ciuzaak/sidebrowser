import { describe, it, expect } from 'vitest';
import { hostSchemeFor, normalizeUrlInput } from '@shared/url';

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

describe('normalizeUrlInput — local / intranet hosts (M16)', () => {
  it('IPv4 literals open over http, with optional port and path', () => {
    expect(normalizeUrlInput('192.168.1.1', GOOGLE_T)).toBe('http://192.168.1.1');
    expect(normalizeUrlInput('192.168.1.1:8080/admin', GOOGLE_T)).toBe('http://192.168.1.1:8080/admin');
    expect(normalizeUrlInput('10.0.0.5/x?y=1', GOOGLE_T)).toBe('http://10.0.0.5/x?y=1');
  });

  it('localhost opens over http', () => {
    expect(normalizeUrlInput('localhost', GOOGLE_T)).toBe('http://localhost');
    expect(normalizeUrlInput('localhost:3000/app', GOOGLE_T)).toBe('http://localhost:3000/app');
  });

  it('single-label host with an explicit port opens over http', () => {
    expect(normalizeUrlInput('nas:5000', GOOGLE_T)).toBe('http://nas:5000');
  });

  it('IPv6 literals open over http', () => {
    expect(normalizeUrlInput('[::1]:8080', GOOGLE_T)).toBe('http://[::1]:8080');
  });

  it('dotted hosts with a port keep https', () => {
    expect(normalizeUrlInput('example.com:8443/x', GOOGLE_T)).toBe('https://example.com:8443/x');
  });

  it('still searches plain words, bad IPs, bad ports and non-numeric "ports"', () => {
    expect(normalizeUrlInput('electron', GOOGLE_T)).toContain('google.com/search?q=electron');
    expect(normalizeUrlInput('999.1.1.1', GOOGLE_T)).toContain('google.com/search');
    expect(normalizeUrlInput('nas:70000', GOOGLE_T)).toContain('google.com/search');
    expect(normalizeUrlInput('mailto:x', GOOGLE_T)).toContain('google.com/search');
  });
});

describe('hostSchemeFor', () => {
  it('classifies hosts', () => {
    expect(hostSchemeFor('127.0.0.1')).toBe('http');
    expect(hostSchemeFor('LOCALHOST:80')).toBe('http');
    expect(hostSchemeFor('github.com')).toBe('https');
    expect(hostSchemeFor('1.2.3')).toBeNull();
    expect(hostSchemeFor('foo')).toBeNull();
    expect(hostSchemeFor('a@b.com')).toBeNull();
    expect(hostSchemeFor('bücher.de')).toBe('https');
    expect(hostSchemeFor('例子.中国')).toBe('https');
    expect(hostSchemeFor('my_host.example.com')).toBe('https');
    expect(hostSchemeFor('xn--bcher-kva.xn--p1ai')).toBe('https');
  });
});
