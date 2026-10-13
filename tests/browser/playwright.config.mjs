import { defineConfig } from '@playwright/test';

// One project per engine: the sandbox and the content-security-policy behave differently in each, which is the point.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  globalSetup: './global-setup.mjs',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
