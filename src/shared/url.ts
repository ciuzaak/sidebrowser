/**
 * Normalize a user-entered address bar string into a loadable URL.
 *
 * Rules:
 * - Empty / whitespace → `about:blank`
 * - Already-qualified scheme (`http`, `https`, `about`, `chrome`, `file`, `data`) → passthrough
 * - Looks like a hostname (has a dot and no whitespace in the token) → prepend `https://`
 * - Otherwise → treat as search query, route to DuckDuckGo
 */
export function normalizeUrlInput(raw: string): string {
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

  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
}
