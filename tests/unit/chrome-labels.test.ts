import { describe, it, expect } from 'vitest';
import {
  PILL_PLACEHOLDER,
  pillLabelFor,
  schemeIconFor,
  formatTabCount,
  tabLabel,
} from '../../src/renderer/src/lib/chrome-labels';

describe('pillLabelFor', () => {
  it('placeholder for blank', () => {
    expect(pillLabelFor('')).toBe(PILL_PLACEHOLDER);
    expect(pillLabelFor('about:blank')).toBe(PILL_PLACEHOLDER);
  });
  it('host only for http(s)', () => {
    expect(pillLabelFor('https://www.bilibili.com/video/x?y=1')).toBe('www.bilibili.com');
    expect(pillLabelFor('http://192.168.1.1:8080/a')).toBe('192.168.1.1:8080');
  });
  it('falls back to the raw string when there is no host or URL is malformed', () => {
    expect(pillLabelFor('file:///C:/x.html')).toBe('file:///C:/x.html');
    expect(pillLabelFor('not a url')).toBe('not a url');
  });
});

describe('schemeIconFor', () => {
  it('search for blank, lock for https, globe otherwise', () => {
    expect(schemeIconFor('about:blank')).toBe('search');
    expect(schemeIconFor('')).toBe('search');
    expect(schemeIconFor('https://a.com')).toBe('lock');
    expect(schemeIconFor('http://a.com')).toBe('globe');
    expect(schemeIconFor('file:///x')).toBe('globe');
  });
});

describe('formatTabCount', () => {
  it('hidden below 2, number up to 99, 99+ above', () => {
    expect(formatTabCount(0)).toBeNull();
    expect(formatTabCount(1)).toBeNull();
    expect(formatTabCount(2)).toBe('2');
    expect(formatTabCount(99)).toBe('99');
    expect(formatTabCount(100)).toBe('99+');
  });
});

describe('tabLabel', () => {
  it('New Tab for blank tabs', () => {
    expect(tabLabel({ url: 'about:blank', title: 'about:blank' })).toBe('New Tab');
    expect(tabLabel({ url: '', title: '' })).toBe('New Tab');
  });
  it('title, then url', () => {
    expect(tabLabel({ url: 'https://a.com', title: ' A ' })).toBe('A');
    expect(tabLabel({ url: 'https://a.com', title: '' })).toBe('https://a.com');
  });
});
