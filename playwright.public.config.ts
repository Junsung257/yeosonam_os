import { defineConfig, devices } from '@playwright/test';

/**
 * Public, read-only browser contract. The default target is production because
 * the local app does not have a portable public Supabase fixture. Set
 * E2E_BASE_URL explicitly when running against a local or staging deployment.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /public-journey\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://www.yeosonam.com',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
});
