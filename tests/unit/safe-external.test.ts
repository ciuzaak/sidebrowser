import { describe, it, expect } from 'vitest';
import { isSafeExternalUrl } from '../../src/main/safe-external';

/**
 * Scheme guard for `shell.openExternal`. Only http/https URLs may be handed
 * to the OS protocol handler — context-menu params are page-controlled, so
 * anything else (javascript:, file:, custom schemes like steam:, malformed
 * input) must be rejected.
 */
describe('isSafeExternalUrl', () => {
  it('accepts http://', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
  });

  it('accepts https://', () => {
    expect(isSafeExternalUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('rejects javascript:', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects file://', () => {
    expect(isSafeExternalUrl('file:///C:/Windows/notepad.exe')).toBe(false);
  });

  it('rejects custom schemes (e.g. steam:)', () => {
    expect(isSafeExternalUrl('steam://run/440')).toBe(false);
  });

  it('rejects data:', () => {
    expect(isSafeExternalUrl('data:text/html,<h1>x</h1>')).toBe(false);
  });

  it('rejects malformed URL strings', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isSafeExternalUrl('')).toBe(false);
  });

  it('rejects view-source: even when inner is http (use new-tab path for that)', () => {
    expect(isSafeExternalUrl('view-source:https://example.com')).toBe(false);
  });
});
