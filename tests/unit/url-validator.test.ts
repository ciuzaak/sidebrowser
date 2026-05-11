import { describe, it, expect } from 'vitest';
import { sanitizeUrl } from '../../src/main/url-validator';

/**
 * sanitizeUrl is the whitelist-only URL guard applied at the ViewManager
 * boundary (createTab + navigate) and indirectly at the seedTabs replay
 * path. Spec §10: persisted/injected URLs with non-whitelisted schemes must
 * fall back to `about:blank` rather than being loaded.
 *
 * Whitelist: http, https, file, about. Everything else (javascript:, data:,
 * chrome://, malformed strings, empty string) resolves to `'about:blank'`.
 */
describe('sanitizeUrl', () => {
  it('passes through http:// URLs verbatim', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('passes through https:// URLs verbatim', () => {
    expect(sanitizeUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    );
  });

  it('passes through about:blank verbatim', () => {
    expect(sanitizeUrl('about:blank')).toBe('about:blank');
  });

  it('passes through file:// URLs verbatim', () => {
    expect(sanitizeUrl('file:///C:/Users/test/index.html')).toBe(
      'file:///C:/Users/test/index.html',
    );
  });

  it('maps javascript: URLs to about:blank', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('about:blank');
  });

  it('maps data: URLs to about:blank', () => {
    expect(sanitizeUrl('data:text/html,<h1>hi</h1>')).toBe('about:blank');
  });

  it('maps chrome:// URLs to about:blank', () => {
    expect(sanitizeUrl('chrome://settings')).toBe('about:blank');
  });

  it('maps malformed URL strings to about:blank', () => {
    expect(sanitizeUrl('not a url at all')).toBe('about:blank');
  });

  it('maps the empty string to about:blank', () => {
    expect(sanitizeUrl('')).toBe('about:blank');
  });

  // M13: view-source: scheme allow-list (codex review fix).

  it('passes through view-source:https://... verbatim', () => {
    expect(sanitizeUrl('view-source:https://example.com/page')).toBe(
      'view-source:https://example.com/page',
    );
  });

  it('passes through view-source:http://... verbatim', () => {
    expect(sanitizeUrl('view-source:http://example.com')).toBe(
      'view-source:http://example.com',
    );
  });

  it('passes through view-source:file://... verbatim', () => {
    expect(sanitizeUrl('view-source:file:///C:/x.html')).toBe(
      'view-source:file:///C:/x.html',
    );
  });

  it('blocks view-source:javascript:... (inner scheme not whitelisted)', () => {
    expect(sanitizeUrl('view-source:javascript:alert(1)')).toBe('about:blank');
  });

  it('blocks view-source: with malformed inner URL', () => {
    expect(sanitizeUrl('view-source:not a url')).toBe('about:blank');
  });

  it('blocks view-source:data:... (inner scheme not whitelisted)', () => {
    expect(sanitizeUrl('view-source:data:text/html,<h1>x</h1>')).toBe(
      'about:blank',
    );
  });
});
