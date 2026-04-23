import { describe, it, expect } from 'vitest';
import { IpcChannels } from '@shared/ipc-contract';

describe('IpcChannels', () => {
  it('exposes appPing as a namespaced string', () => {
    expect(IpcChannels.appPing).toBe('app:ping');
  });

  it('defines tab navigation channels', () => {
    expect(IpcChannels.tabNavigate).toBe('tab:navigate');
    expect(IpcChannels.tabGoBack).toBe('tab:go-back');
    expect(IpcChannels.tabGoForward).toBe('tab:go-forward');
    expect(IpcChannels.tabReload).toBe('tab:reload');
    expect(IpcChannels.tabUpdated).toBe('tab:updated');
  });

  it('defines multi-tab management channels', () => {
    expect(IpcChannels.tabCreate).toBe('tab:create');
    expect(IpcChannels.tabClose).toBe('tab:close');
    expect(IpcChannels.tabActivate).toBe('tab:activate');
    expect(IpcChannels.tabsSnapshot).toBe('tabs:snapshot');
    expect(IpcChannels.tabsRequestSnapshot).toBe('tabs:request-snapshot');
  });

  it('defines chrome layout channel', () => {
    expect(IpcChannels.chromeSetHeight).toBe('chrome:set-height');
  });

  it('all channel values follow <domain>:<action> pattern', () => {
    for (const channel of Object.values(IpcChannels)) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });
});
