/**
 * Normalize a user-entered address bar string into a loadable URL.
 *
 * Rules:
 * - Empty / whitespace → `about:blank`
 * - Already-qualified scheme (`http`, `https`, `about`, `chrome`, `file`, `data`) → passthrough
 * - Single token that looks like a host (see `hostSchemeFor`) → prepend `http://` or `https://`
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
  if (firstToken === input) {
    const scheme = hostSchemeFor(input);
    if (scheme !== null) return `${scheme}://${input}`;
  }

  return searchUrlTemplate.replace('{query}', encodeURIComponent(input));
}

/**
 * Scheme to prepend when a whitespace-free token looks like a host, else null.
 *
 * - `localhost`, IPv4 literals, `[ipv6]` literals and single-label hosts with an
 *   explicit port (`nas:8080`) are local/intranet targets → `http`.
 * - Dotted hostnames with an alphabetic TLD (`example.com`) → `https` (M1 rule).
 *
 * Anything after the host (`:port`, `/path`, `?query`, `#hash`) is allowed.
 * Exported for unit tests.
 */
export function hostSchemeFor(token: string): 'http' | 'https' | null {
  const hostPort = token.split(/[/?#]/, 1)[0]!;
  if (hostPort === '') return null;

  const v6 = /^\[[0-9a-f:.]+\](?::(\d{1,5}))?$/i.exec(hostPort);
  if (v6) return v6[1] === undefined || validPort(v6[1]) ? 'http' : null;

  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(hostPort);
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  const port = m[2];
  if (port !== undefined && !validPort(port)) return null;

  if (host === 'localhost') return 'http';
  if (isIpv4(host)) return 'http';
  if (port !== undefined && /^[a-z0-9-]+$/.test(host)) return 'http';
  // Letters / digits / '-' / '_' in any script (IDN like bücher.de), and an
  // alphabetic TLD of 2+ letters (punycode xn-- TLDs included).
  if (/\.(?:\p{L}{2,}|xn--[a-z0-9-]+)$/iu.test(host) && /^[\p{L}\p{N}._-]+$/u.test(host)) return 'https';
  return null;
}

function validPort(p: string): boolean {
  const n = Number(p);
  return n >= 1 && n <= 65535;
}

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}
