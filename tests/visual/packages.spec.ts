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

import { test, expect, type Page } from '@playwright/test';
import { dynamicMasks, textHash, waitForStable, snapshotName, getMainContainer } from './helpers';
import fs from 'node:fs';
import path from 'node:path';

interface Fixture { id: string; title: string; product: string }
const fixturesPath = path.join(__dirname, 'fixtures.json');
const fixtures: Fixture[] = fs.existsSync(fixturesPath)
  ? JSON.parse(fs.readFileSync(fixturesPath, 'utf8'))
  : [];
const fixtureIds = csvSet(process.env.VISUAL_FIXTURE_IDS);
const fixtureProducts = csvSet(process.env.VISUAL_FIXTURE_PRODUCTS);
const selectedFixtures = fixtures.filter((fx) => {
  if (!fixtureIds && !fixtureProducts) return true;
  return Boolean(fixtureIds?.has(fx.id) || fixtureProducts?.has(fx.product));
});
let availablePackageIds: Set<string> | null = null;

function csvSet(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

async function gotoFixtureOrSkip(page: Page, fx: Fixture): Promise<void> {
  test.skip(
    availablePackageIds !== null && !availablePackageIds.has(fx.id),
    `visual fixture is not available in the current package data: ${fx.product}`,
  );

  const response = await page.goto(`/packages/${fx.id}`);
  const hasMain = await page
    .locator('main, [data-testid="main-content"], div.min-h-screen')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const notFound = response?.status() === 404 || !hasMain || await page.getByText('NOT_FOUND', { exact: true }).count() > 0;
  test.skip(notFound, `visual fixture is not available in the current package data: ${fx.product}`);
}

if (fixtures.length === 0) {
  test.skip('fixtures.json 없음 — scripts/sync-visual-fixtures.js 실행 필요', () => {});
}

if (fixtures.length > 0 && selectedFixtures.length === 0) {
  test.skip('VISUAL_FIXTURE_IDS/VISUAL_FIXTURE_PRODUCTS matched no fixtures', () => {});
}

test.beforeAll(async ({ request }) => {
  const response = await request.get('/api/packages/search');
  if (!response.ok()) return;

  const body = await response.json().catch(() => null) as { packages?: Array<{ id?: string }> } | null;
  if (!Array.isArray(body?.packages)) return;

  availablePackageIds = new Set(
    body.packages
      .map((pkg) => pkg.id)
      .filter((id): id is string => Boolean(id)),
  );
});

for (const fx of selectedFixtures) {
  test.describe(`${fx.title} (${fx.product})`, () => {
    test('모바일 랜딩 — 시각 회귀', async ({ page }) => {
      await gotoFixtureOrSkip(page, fx);
      await waitForStable(page);
      const masks = await dynamicMasks(page);
      await expect(page).toHaveScreenshot(snapshotName(fx.product, 'mobile'), { mask: masks, fullPage: true });
    });

    test('모바일 랜딩 — 텍스트 회귀 (innerText hash)', async ({ page }) => {
      await gotoFixtureOrSkip(page, fx);
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
