/**
 * Playwright 설정 — Visual Regression + Text Regression 테스트용
 *
 * 실행:
 *   npm run test:visual              # 스냅샷 비교
 *   npm run test:visual -- --update  # 베이스라인 갱신
 *
 * 테스트 범위:
 *   - tests/visual/*.spec.ts — 상품 상세 페이지 렌더링
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  // 로컬 dev server는 첫 페이지 컴파일 + Supabase 네트워크 왕복으로 느림 → 넉넉히
  timeout: 120_000,
  use: {
    baseURL: process.env.VISUAL_TEST_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 로케일 고정 (날짜 포맷 일관성)
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // 페이지 이동 타임아웃 (Supabase 콜드 + ISR 첫 빌드 감안)
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  expect: {
    // 시각 회귀 허용 오차: 0.2% 픽셀 차이까지는 통과 (폰트 rendering subpixel 등)
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
    },
    // 텍스트 해시 비교 기본 타임아웃
    timeout: 10_000,
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  // 로컬에서는 dev server 자동 기동
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
