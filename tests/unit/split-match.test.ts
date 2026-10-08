import { describe, it, expect } from 'vitest';
import { splitMatch } from '../../src/renderer/src/lib/split-match';

describe('splitMatch', () => {
  it('splits on the first case-insensitive occurrence', () => {
    expect(splitMatch('Hacker News', 'news')).toEqual(['Hacker ', 'News', '']);
    expect(splitMatch('abcabc', 'B')).toEqual(['a', 'b', 'cabc']);
  });
  it('null for empty/whitespace query or no match', () => {
    expect(splitMatch('abc', '')).toBeNull();
    expect(splitMatch('abc', '   ')).toBeNull();
    expect(splitMatch('abc', 'z')).toBeNull();
  });
  it('treats regex metacharacters literally', () => {
    expect(splitMatch('a.b(c)', '.b(')).toEqual(['a', '.b(', 'c)']);
    expect(splitMatch('axbc', '.b')).toBeNull();
  });
  it('keeps indices aligned when lowercasing would change length', () => {
    expect(splitMatch('İstanbul news', 'news')).toEqual(['İstanbul ', 'news', '']);
  });
  it('trims the query', () => {
    expect(splitMatch('example.com', ' exa ')).toEqual(['', 'exa', 'mple.com']);
  });
});
