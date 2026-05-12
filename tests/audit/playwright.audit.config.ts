import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: __dirname,
  testMatch: /audit-all-pages\.spec\.ts/,
  fullyParallel: false,
  workers: 4,
  retries: 0,
  timeout: 60_000,
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  reporter: [['list', { printSteps: false }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    storageState: path.join(__dirname, 'auth.json'),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
