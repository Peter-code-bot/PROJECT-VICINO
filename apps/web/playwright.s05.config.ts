import { defineConfig } from '@playwright/test';

// Isolated component regressions: no seed, stored session, env file or server.
export default defineConfig({
  testDir: './tests',
  testMatch: ['phases-location.spec.ts', 'mapkit-recovery.spec.ts'],
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/s05-regressions',
  use: { channel: 'chrome', baseURL: 'http://localhost:3000' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: 'ipad', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
  ],
});
