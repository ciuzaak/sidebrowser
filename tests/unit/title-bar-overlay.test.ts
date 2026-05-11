import { describe, it, expect } from 'vitest';
import { resolveTitleBarOverlay } from '../../src/main/title-bar-overlay';

describe('resolveTitleBarOverlay', () => {
  it('returns dark token pair for dark theme', () => {
    expect(resolveTitleBarOverlay('dark')).toEqual({
      color: '#25272d',
      symbolColor: '#c8ccd4',
    });
  });

  it('returns light token pair for light theme', () => {
    expect(resolveTitleBarOverlay('light')).toEqual({
      color: '#fbfbfc',
      symbolColor: '#3a3a3c',
    });
  });
});
