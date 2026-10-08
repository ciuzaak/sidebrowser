import { describe, it, expect } from 'vitest';
import { IpcChannels } from '@shared/ipc-contract';

describe('IpcChannels', () => {
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
    expect(IpcChannels.tabSetMobile).toBe('tab:set-mobile');
  });

  it('defines chrome layout channel', () => {
    expect(IpcChannels.chromeSetHeight).toBe('chrome:set-height');
  });

  it('defines window state channel', () => {
    expect(IpcChannels.windowState).toBe('window:state');
  });

  it('defines settings + app:ready + view:set-suppressed channels', () => {
    expect(IpcChannels.settingsGet).toBe('settings:get');
    expect(IpcChannels.settingsUpdate).toBe('settings:update');
    expect(IpcChannels.settingsChanged).toBe('settings:changed');
    expect(IpcChannels.appReady).toBe('app:ready');
    expect(IpcChannels.viewSetSuppressed).toBe('view:set-suppressed');
  });

  it('defines history channels', () => {
    expect(IpcChannels.historyRecent).toBe('history:recent');
    expect(IpcChannels.historySuggest).toBe('history:suggest');
    expect(IpcChannels.historyRemove).toBe('history:remove');
    expect(IpcChannels.historyChanged).toBe('history:changed');
  });

  it('defines M17 chrome channels', () => {
    expect(IpcChannels.windowMinimize).toBe('window:minimize');
    expect(IpcChannels.windowClose).toBe('window:close');
    expect(IpcChannels.tabStop).toBe('tab:stop');
    expect(IpcChannels.viewSetTopInset).toBe('view:set-top-inset');
    expect(IpcChannels.viewCaptureActive).toBe('view:capture-active');
    expect(IpcChannels.historyTopSites).toBe('history:top-sites');
  });

  it('defines M16 channels', () => {
    expect(IpcChannels.tabSetMuted).toBe('tab:set-muted');
    expect(IpcChannels.findStart).toBe('find:start');
    expect(IpcChannels.findStop).toBe('find:stop');
    expect(IpcChannels.findResult).toBe('find:result');
    expect(IpcChannels.downloadsList).toBe('downloads:list');
    expect(IpcChannels.downloadsChanged).toBe('downloads:changed');
    expect(IpcChannels.storageUsage).toBe('storage:usage');
    expect(IpcChannels.storageClearCache).toBe('storage:clear-cache');
    expect(IpcChannels.storageClearSiteData).toBe('storage:clear-site-data');
  });

  it('all channel values follow <domain>:<action> pattern', () => {
    for (const channel of Object.values(IpcChannels)) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });
});
