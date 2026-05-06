/**
 * Suggestion ranker — pure functions.
 *
 * `rankSuggestions(entries, query, now)`: address-bar autocomplete; three-tier
 * (URL prefix → URL substring → title substring) + frecency desc within tier.
 * `recentEntries(entries, limit)`: empty-query path (focus but no input);
 * just lastVisitedAt-desc top N.
 *
 * Module-isolated so the algorithm is unit-testable without IO / event flow.
 */

import type { HistoryEntry, Suggestion } from '@shared/types';

export const SUGGEST_LIMIT = 8;
const DAY_MS = 86_400_000;

/** Lowercase the URL after stripping `http://` or `https://`, for prefix matching. */
export function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

interface Scored {
  entry: HistoryEntry;
  tier: 0 | 1 | 2;
  score: number;
}

function frecency(entry: HistoryEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastVisitedAt) / DAY_MS);
  return entry.visitCount / (1 + ageDays / 7);
}

export function rankSuggestions(
  entries: HistoryEntry[],
  query: string,
  now: number,
): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const scored: Scored[] = [];
  for (const e of entries) {
    const urlLc = e.url.toLowerCase();
    const urlNoScheme = stripScheme(urlLc);
    const titleLc = e.title.toLowerCase();
    let tier: 0 | 1 | 2;
    if (urlNoScheme.startsWith(q) || urlLc.startsWith(q)) {
      tier = 0;
    } else if (urlLc.includes(q)) {
      tier = 1;
    } else if (titleLc !== '' && titleLc.includes(q)) {
      tier = 2;
    } else {
      continue;
    }
    scored.push({ entry: e, tier, score: frecency(e, now) });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.score - a.score;
  });

  return scored.slice(0, SUGGEST_LIMIT).map(({ entry, tier }) => ({
    url: entry.url,
    title: entry.title,
    favicon: entry.favicon,
    tier,
  }));
}

export function recentEntries(entries: HistoryEntry[], limit: number): HistoryEntry[] {
  return [...entries]
    .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
    .slice(0, limit);
}
