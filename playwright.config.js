const { defineConfig } = require('@playwright/test');
const useExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1';
const configuredWorkers = process.env.PLAYWRIGHT_WORKERS
  ? Number(process.env.PLAYWRIGHT_WORKERS)
  : undefined;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 1,
  workers: Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : undefined,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4002',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: './scripts/playwright-web-server.sh',
        port: 4002,
        timeout: 120_000,
        reuseExistingServer: true,
      },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
