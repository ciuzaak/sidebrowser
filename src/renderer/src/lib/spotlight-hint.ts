import { normalizeUrlInput } from '@shared/url';

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Footer hint describing what Enter will do in the Spotlight (M17). */
export function spotlightHint(
  draft: string,
  highlightedUrl: string | null,
  searchTemplate: string,
  engineName: string,
): string {
  if (highlightedUrl !== null) return `Open ${hostOf(highlightedUrl)}`;
  if (draft.trim() === '') return 'Type a URL or search';
  const url = normalizeUrlInput(draft, searchTemplate);
  const searchPrefix = searchTemplate.split('{query}')[0] ?? '';
  if (searchPrefix !== '' && url.startsWith(searchPrefix)) return `Search ${engineName}`;
  return `Open ${hostOf(url)}`;
}

/** Resolve with `fallback` if `p` rejects or takes longer than `ms`. */
export function withTimeout<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}
