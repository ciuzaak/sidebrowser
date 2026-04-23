import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 60s accommodates persistence.spec.ts (two sequential Electron launches);
  // single-launch specs finish well under this.
  timeout: 60_000,
  expect: { timeout: 5_000 },
  // Electron tests are heavy: each spec spawns its own app process. Running them
  // in parallel saturates system resources and starves individual tests of CPU,
  // causing the 30s timeout to bite even on simple specs. Serialize.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
