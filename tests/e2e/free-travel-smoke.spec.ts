import { test, expect } from '@playwright/test';

/**
 * 자유여행 플래너 정적 스모크 (OTA·LLM 미호출)
 * 실행: dev 서버 기동 후 `npm run test:e2e`
 */
test.describe('free-travel 페이지', () => {
  test('견적 받기 CTA와 플래너 칩이 보인다', async ({ page }) => {
    await page.goto('/free-travel', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /항공\s*\+\s*호텔/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('button', { name: '견적 받기' })).toBeVisible();
    await expect(page.getByText('누구와 가시나요?', { exact: false })).toBeVisible();
    await expect(page.getByText('호텔 예산은 어느 정도인가요?', { exact: false })).toBeVisible();
    await expect(page.getByText('여행 속도는 어떻게 원하시나요?', { exact: false })).toBeVisible();
  });
});
