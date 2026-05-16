import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_VISIBLE_STATUSES,
  SCORING_ELIGIBLE_STATUSES,
  isCustomerVisibleStatus,
} from '@/lib/visibility-status';

/**
 * 박제 사유 (2026-05-16):
 *   - 노출 화이트리스트와 점수 화이트리스트가 어휘 불일치(예: 'available' 한쪽만 포함)로
 *     노출은 되는데 점수가 안 만들어지거나 그 반대 사고가 반복.
 *   - SSOT 가 한 곳에서만 살아있는지 회귀 fixture 로 박는다.
 */
describe('visibility-status SSOT', () => {
  it('exposes the customer-visible whitelist as a non-empty readonly tuple', () => {
    expect(CUSTOMER_VISIBLE_STATUSES.length).toBeGreaterThan(0);
  });

  it('includes the canonical happy-path statuses', () => {
    for (const s of ['active', 'approved', 'selling', 'available']) {
      expect(CUSTOMER_VISIBLE_STATUSES).toContain(s);
    }
  });

  it('excludes any review/draft/archive vocabulary', () => {
    for (const s of ['pending_review', 'draft', 'REVIEW_NEEDED', 'archived', 'blocked', 'expired']) {
      expect(CUSTOMER_VISIBLE_STATUSES).not.toContain(s as never);
    }
  });

  it('keeps scoring eligibility in lock-step with customer visibility', () => {
    expect([...SCORING_ELIGIBLE_STATUSES].sort()).toEqual(
      [...CUSTOMER_VISIBLE_STATUSES].sort(),
    );
  });

  it('isCustomerVisibleStatus rejects nullish and unknown values', () => {
    expect(isCustomerVisibleStatus(null)).toBe(false);
    expect(isCustomerVisibleStatus(undefined)).toBe(false);
    expect(isCustomerVisibleStatus('')).toBe(false);
    expect(isCustomerVisibleStatus('pending_review')).toBe(false);
    expect(isCustomerVisibleStatus('archived')).toBe(false);
  });

  it('isCustomerVisibleStatus accepts every entry in the whitelist', () => {
    for (const s of CUSTOMER_VISIBLE_STATUSES) {
      expect(isCustomerVisibleStatus(s)).toBe(true);
    }
  });
});
