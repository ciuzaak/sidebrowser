import { describe, it, expect } from 'vitest';
import { IpcChannels } from '@shared/ipc-contract';

describe('IpcChannels', () => {
  it('exposes appPing as a namespaced string', () => {
    expect(IpcChannels.appPing).toBe('app:ping');
  });

  it('all channel values follow <domain>:<action> pattern', () => {
    for (const channel of Object.values(IpcChannels)) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });
});
