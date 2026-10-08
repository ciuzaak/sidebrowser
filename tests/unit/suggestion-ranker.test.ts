import { describe, it, expect } from 'vitest';
import {
  rankSuggestions,
  recentEntries,
  stripScheme,
  topSites,
} from '../../src/main/suggestion-ranker';
import type { HistoryEntry } from '@shared/types';

const NOW = 1_000_000_000;
const day = 86_400_000;

const mk = (
  url: string,
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  url,
  title: '',
  favicon: null,
  firstVisitedAt: NOW - day,
  lastVisitedAt: NOW - day,
  visitCount: 1,
  ...overrides,
});

describe('stripScheme', () => {
  it('strips http:// and https:// case-insensitively', () => {
    expect(stripScheme('https://github.com')).toBe('github.com');
    expect(stripScheme('HTTP://example.org/foo')).toBe('example.org/foo');
  });
  it('passes through non-http schemes unchanged', () => {
    expect(stripScheme('about:blank')).toBe('about:blank');
  });
});

describe('rankSuggestions — empty / trivial', () => {
  it('returns [] for empty query', () => {
    expect(rankSuggestions([mk('https://a.com')], '', NOW)).toEqual([]);
    expect(rankSuggestions([mk('https://a.com')], '   ', NOW)).toEqual([]);
  });

  it('returns [] when nothing matches', () => {
    expect(rankSuggestions([mk('https://a.com')], 'zzz', NOW)).toEqual([]);
  });
});

describe('rankSuggestions — tier ordering', () => {
  it('URL prefix (tier 0) ranks above URL substring (tier 1) above title substring (tier 2)', () => {
    const entries = [
      mk('https://other.com/githubpath', { title: 'noise' }),
      mk('https://noise.org', { title: 'github official' }),
      mk('https://github.com', { title: 'GitHub' }),
    ];
    const out = rankSuggestions(entries, 'github', NOW);
    expect(out.map((s) => s.tier)).toEqual([0, 1, 2]);
    expect(out[0]?.url).toBe('https://github.com');
  });

  it('case-insensitive matching', () => {
    const entries = [mk('https://example.com', { title: 'Hello World' })];
    const out = rankSuggestions(entries, 'HELLO', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]?.tier).toBe(2);
  });
});

describe('rankSuggestions — within-tier score', () => {
  it('within tier 0, higher visitCount + more recent ranks first', () => {
    const entries = [
      mk('https://github.com/a', { visitCount: 1, lastVisitedAt: NOW - 1 * day }),
      mk('https://github.com/b', { visitCount: 10, lastVisitedAt: NOW - 1 * day }),
      mk('https://github.com/c', { visitCount: 1, lastVisitedAt: NOW - 30 * day }),
    ];
    const out = rankSuggestions(entries, 'github', NOW);
    expect(out.map((s) => s.url)).toEqual([
      'https://github.com/b',
      'https://github.com/a',
      'https://github.com/c',
    ]);
  });
});

describe('rankSuggestions — limit', () => {
  it('caps output at 8 even when more match', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      mk(`https://e${i}.com`, { visitCount: 20 - i }),
    );
    const out = rankSuggestions(entries, 'e', NOW);
    expect(out).toHaveLength(8);
  });
});

describe('recentEntries', () => {
  it('returns N most recent by lastVisitedAt desc', () => {
    const entries = [
      mk('https://a.com', { lastVisitedAt: NOW - 1 }),
      mk('https://b.com', { lastVisitedAt: NOW - 100 }),
      mk('https://c.com', { lastVisitedAt: NOW - 50 }),
    ];
    expect(recentEntries(entries, 2).map((e) => e.url)).toEqual(['https://a.com', 'https://c.com']);
  });

  it('caps at provided limit', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      mk(`https://e${i}.com`, { lastVisitedAt: i }),
    );
    expect(recentEntries(entries, 5)).toHaveLength(5);
  });
});

describe('topSites', () => {
  const e = (url: string, visitCount: number, favicon: string | null = null): HistoryEntry =>
    mk(url, { visitCount, favicon, lastVisitedAt: NOW });

  it('groups by origin and sums frecency', () => {
    const r = topSites(
      [e('https://a.com/1', 1), e('https://a.com/2', 1), e('https://b.com/', 1.5)],
      8,
      NOW,
    );
    expect(r.map((s) => s.origin)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('strips www. from the host label', () => {
    expect(topSites([e('https://www.bilibili.com/x', 1)], 8, NOW)[0]!.host).toBe('bilibili.com');
  });

  it('ignores non-http(s) and malformed URLs', () => {
    expect(topSites([e('file:///x', 5), e('nope', 5)], 8, NOW)).toEqual([]);
  });

  it('favicon comes from the highest-frecency entry that has one', () => {
    const r = topSites(
      [e('https://a.com/1', 5, null), e('https://a.com/2', 2, 'f2'), e('https://a.com/3', 1, 'f3')],
      8,
      NOW,
    );
    expect(r[0]!.favicon).toBe('f2');
  });

  it('merges http/https/www variants of a host and opens the top origin', () => {
    const r = topSites(
      [e('http://example.com/', 1), e('https://www.example.com/a', 3), e('https://example.com/b', 1)],
      8,
      NOW,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.host).toBe('example.com');
    expect(r[0]!.origin).toBe('https://www.example.com');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(`https://s${i}.com/`, 12 - i));
    expect(topSites(many, 8, NOW)).toHaveLength(8);
  });
});
