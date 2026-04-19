/**
 * 상품 상세 페이지 Visual + Text 회귀 테스트
 *
 * 테스트 대상: 대표 5개 상품 (쿠알라 2건, 타이베이, 서안, 장가계)
 *
 * 실행 전제:
 *   1. 로컬 dev server가 localhost:3000에서 돌고 있음 (playwright.config의 webServer 자동 기동)
 *   2. 테스트 대상 상품 ID는 tests/visual/fixtures.json 에 정의
 *   3. 첫 실행 시: `npx playwright test --update-snapshots` 로 베이스라인 생성
 */

import { test, expect } from '@playwright/test';
import { dynamicMasks, textHash, waitForStable, snapshotName, getMainContainer } from './helpers';
import fs from 'node:fs';
import path from 'node:path';

interface Fixture { id: string; title: string; product: string }
const fixturesPath = path.join(__dirname, 'fixtures.json');
const fixtures: Fixture[] = fs.existsSync(fixturesPath)
  ? JSON.parse(fs.readFileSync(fixturesPath, 'utf8'))
  : [];

if (fixtures.length === 0) {
  test.skip('fixtures.json 없음 — scripts/sync-visual-fixtures.js 실행 필요', () => {});
}

for (const fx of fixtures) {
  test.describe(`${fx.title} (${fx.product})`, () => {
    test('모바일 랜딩 — 시각 회귀', async ({ page }) => {
      await page.goto(`/packages/${fx.id}`);
      await waitForStable(page);
      const masks = await dynamicMasks(page);
      await expect(page).toHaveScreenshot(snapshotName(fx.product, 'mobile'), { mask: masks, fullPage: true });
    });

    test('모바일 랜딩 — 텍스트 회귀 (innerText hash)', async ({ page }) => {
      await page.goto(`/packages/${fx.id}`);
      await waitForStable(page);
      const hash = await textHash(getMainContainer(page));

      // 베이스라인 파일
      const baselinePath = path.join(__dirname, 'baselines', `${fx.product}-text.hash`);
      if (!fs.existsSync(baselinePath) || process.env.UPDATE_BASELINE === '1') {
        fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
        fs.writeFileSync(baselinePath, hash);
        test.info().annotations.push({ type: 'baseline', description: `새 베이스라인 생성: ${hash}` });
        return;
      }
      const expected = fs.readFileSync(baselinePath, 'utf8').trim();
      expect(hash, `텍스트 해시 불일치. 상품: ${fx.title}`).toBe(expected);
    });
  });
}
