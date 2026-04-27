/**
 * Normalize a user-entered address bar string into a loadable URL.
 *
 * Rules:
 * - Empty / whitespace → `about:blank`
 * - Already-qualified scheme (`http`, `https`, `about`, `chrome`, `file`, `data`) → passthrough
 * - Looks like a hostname (has a dot and no whitespace in the token) → prepend `https://`
 * - Otherwise → treat as search query, substitute into `searchUrlTemplate`
 *   (caller resolves the active engine's template from `Settings.search`).
 *
 * `searchUrlTemplate` MUST contain `{query}`. The caller's contract guarantees
 * this — `clampSearch` rejects any engine whose template lacks the placeholder.
 * url.ts is a pure string-transform layer and does not re-validate.
 */
export function normalizeUrlInput(raw: string, searchUrlTemplate: string): string {
  const input = raw.trim();
  if (input === '') return 'about:blank';

  if (/^(https?|about|chrome|file|data):/i.test(input)) {
    return input;
  }

  const firstToken = input.split(/\s+/, 1)[0]!;
  const looksLikeHost = firstToken === input && /\.[a-z]{2,}(?:[:/?#]|$)/i.test(input);
  if (looksLikeHost) {
    return `https://${input}`;
  }

  return searchUrlTemplate.replace('{query}', encodeURIComponent(input));
}
