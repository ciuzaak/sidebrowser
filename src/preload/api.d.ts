import type { SidebrowserApi } from './index';

declare global {
  interface Window {
    sidebrowser: SidebrowserApi;
  }
}

export {};
