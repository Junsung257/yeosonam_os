import { describe, expect, it } from 'vitest';
import { calculateProductRegistrationTrustScore } from './product-registration-trust-score';

describe('product registration trust score', () => {
  it('returns 100 only when every customer delivery gate is clean', () => {
    const result = calculateProductRegistrationTrustScore({
      expectedProductCount: 4,
      actualProductCount: 4,
      savedProductCount: 4,
      priceRowsSaved: 80,
      itineraryDaysCount: 5,
      standardNoticeCount: 8,
      structuredFactCount: 20,
      v3Status: 'ready_to_publish',
      rawNoticeLeakRisk: false,
      unmatchedActivitiesCount: 0,
      highRiskReviewNeededCount: 0,
      renderAuditStatus: 'pass',
    });

    expect(result.score).toBe(100);
    expect(result.publishable).toBe(true);
    expect(result.grade).toBe('perfect');
  });

  it('blocks when product count mismatches even if other fields look good', () => {
    const result = calculateProductRegistrationTrustScore({
      expectedProductCount: 4,
      actualProductCount: 3,
      savedProductCount: 3,
      priceRowsSaved: 80,
      itineraryDaysCount: 5,
      standardNoticeCount: 8,
      structuredFactCount: 20,
      v3Status: 'ready_to_publish',
      rawNoticeLeakRisk: false,
    });

    expect(result.score).toBe(0);
    expect(result.publishable).toBe(false);
    expect(result.blockers.map(issue => issue.code)).toContain('product_count.mismatch');
  });

  it('marks unmatched attractions as review instead of critical failure', () => {
    const result = calculateProductRegistrationTrustScore({
      expectedProductCount: 1,
      actualProductCount: 1,
      savedProductCount: 1,
      priceRowsSaved: 12,
      itineraryDaysCount: 4,
      standardNoticeCount: 4,
      structuredFactCount: 10,
      v3Status: 'ready_to_publish',
      rawNoticeLeakRisk: false,
      unmatchedActivitiesCount: 3,
      renderAuditStatus: 'pass',
    });

    expect(result.score).toBeLessThan(100);
    expect(result.blockers).toHaveLength(0);
    expect(result.warnings.map(issue => issue.code)).toContain('attraction.unmatched');
  });
});
