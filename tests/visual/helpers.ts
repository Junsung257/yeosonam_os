/**
 * 시각/텍스트 회귀 테스트 공통 헬퍼
 *
 * 핵심 기능:
 * 1. maskDynamic() — 날짜/랜덤 ID 같은 동적 영역을 검은 박스로 가림 (Flaky test 방지)
 * 2. getNormalizedText() — innerText 추출 + 공백 정규화 + SHA-256 해시
 * 3. waitForStable() — ISR/hydration 안정화 대기
 */

import crypto from 'node:crypto';
import type { Page, Locator } from '@playwright/test';

// ── 1. Dynamic data masking ──────────────────────────────────────────────
// 브라우저가 렌더링할 때마다 달라지는 영역 (현재 날짜, 타이머 등)을 가려
// 스냅샷 비교가 flaky 해지지 않도록 함.
export async function dynamicMasks(page: Page): Promise<Locator[]> {
  const selectors = [
    '[data-dynamic="true"]',          // 커스텀 마스킹 마커
    '[data-testid="current-date"]',   // 현재 날짜 표시 요소
    '.timer',                          // 타이머
    '.relative-time',                  // "3분 전" 류
    '[data-exchange-rate]',            // 환율 표시
  ];
  const masks: Locator[] = [];
  for (const s of selectors) {
    const loc = page.locator(s);
    if (await loc.count() > 0) masks.push(loc);
  }
  return masks;
}

// ── 2. 텍스트 해시 회귀 ───────────────────────────────────────────────────
/**
 * innerText 추출 → 공백/줄바꿈 정규화 → SHA-256 해시.
 * Next.js hydration class name 같은 HTML 노이즈 제거.
 *
 * 사용:
 * ```typescript
 * const hash = await textHash(page.locator('main'));
 * expect(hash).toBe('abc123...'); // 저장된 베이스라인과 비교
 * ```
 */
export async function textHash(target: Locator | Page): Promise<string> {
  // Page → body 전체 Locator로 변환 / Locator는 그대로 사용
  const loc: Locator = isPage(target) ? target.locator('body') : target;
  const raw = await loc.innerText();
  const normalized = normalizeText(raw);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function isPage(target: Locator | Page): target is Page {
  return typeof (target as Page).goto === 'function';
}

export function normalizeText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')           // 연속 공백 → 단일 공백
    .replace(/[\r\n]+/g, '\n')      // CR/LF 통일
    .replace(/\n\s+/g, '\n')        // 줄 시작 공백 제거
    .trim();
}

// ── 3. ISR / hydration 안정화 대기 ───────────────────────────────────────
/** DOM이 hydration 완료 + 주요 데이터 로드 완료할 때까지 대기 */
export async function waitForStable(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });
  try {
    await page.waitForSelector('main, [data-testid="main-content"]', { state: 'attached', timeout: 60_000 });
  } catch (e) {
    // 진단용: 실패 시 URL, 제목, body 처음 2000자를 로그로 남김
    const url = page.url();
    const title = await page.title().catch(() => '(no title)');
    const html = await page.content().catch(() => '(no content)');
    console.error('─── waitForStable FAILED ───');
    console.error('URL:', url);
    console.error('Title:', title);
    console.error('HTML (first 2000 chars):', html.substring(0, 2000));
    console.error('──────────────────────────');
    throw e;
  }
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

// ── 4. 베이스라인 관리 ───────────────────────────────────────────────────
/** 스크린샷 이름 규칙: `<product>-<viewport>` */
export function snapshotName(product: string, viewport: 'mobile' | 'desktop'): string {
  return `${product}-${viewport}.png`;
}
