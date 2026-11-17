import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: { command: 'npm run e2e:server', url: 'http://localhost:3100/api/v1/health', timeout: 180_000 },
});
