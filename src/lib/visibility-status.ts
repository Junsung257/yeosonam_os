/**
 * 상품 상태 SSOT — 고객 노출/점수 계산 화이트리스트
 *
 * 박제 사유 (2026-05-16):
 *   - 어휘 불일치로 사일런트 미노출 사고 반복.
 *   - 코드 80+ 곳에 `['active','approved']` 하드코드. 'available' 도입 시 노출도 점수도 못 받음.
 *   - 모바일 상세 (RecommendationCard / 점수 cron / page.tsx 게이트) 가 같은 어휘를 봐야 한다.
 *
 * 운영 어휘 (DB 실측 기준):
 *   - active / approved / selling / available  → 고객 노출 + 점수 계산
 *   - pending_review / draft / REVIEW_NEEDED  → 어드민 승인 대기
 *   - archived / blocked / expired             → 비노출
 *
 * 새 상태 추가 시: 이 파일만 고치면 노출·점수·검색이 동시에 따라온다.
 */

export const CUSTOMER_VISIBLE_STATUSES = [
  'active',
  'approved',
  'selling',
  'available',
] as const;

export type CustomerVisibleStatus = (typeof CUSTOMER_VISIBLE_STATUSES)[number];

const CUSTOMER_VISIBLE_SET: ReadonlySet<string> = new Set(CUSTOMER_VISIBLE_STATUSES);

export function isCustomerVisibleStatus(status: string | null | undefined): boolean {
  return !!status && CUSTOMER_VISIBLE_SET.has(status);
}

/**
 * 점수 계산 대상 — 고객 노출과 동일 어휘. (노출되면 점수도 있어야 비교 가능)
 * `recomputeAllScores` / `recommendBestPackages` 에서 사용.
 */
export const SCORING_ELIGIBLE_STATUSES = CUSTOMER_VISIBLE_STATUSES;
