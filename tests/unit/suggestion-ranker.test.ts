import { describe, it, expect } from 'vitest';
import {
  rankSuggestions,
  recentEntries,
  stripScheme,
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
