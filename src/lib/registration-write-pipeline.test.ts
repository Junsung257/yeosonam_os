import { describe, it, expect } from 'vitest';
import { prepareRegistrationWrite, mapProductsStatusFromL1 } from './registration-write-pipeline';

describe('mapProductsStatusFromL1', () => {
  it('L1 BLOCK → REVIEW_NEEDED', () => {
    expect(
      mapProductsStatusFromL1({ reasons: ['x'], warnings: [], codes: [] }, 'pending_review'),
    ).toBe('REVIEW_NEEDED');
  });

  it('L1 WARN only → draft', () => {
    expect(
      mapProductsStatusFromL1({ reasons: [], warnings: ['y'], codes: [] }, 'pending_review'),
    ).toBe('draft');
  });

  it('approved → approved', () => {
    expect(mapProductsStatusFromL1({ reasons: [], warnings: [], codes: [] }, 'approved')).toBe(
      'approved',
    );
  });
});

describe('prepareRegistrationWrite', () => {
  it('parser_version에 postProcess 태그를 붙인다', () => {
    const r = prepareRegistrationWrite({
      row: {
        title: '테스트 상품',
        inclusions: ['호텔'],
        excludes: ['개인경비'],
        notices_parsed: [
          { type: 'CRITICAL', text: '필수' },
          { type: 'PAYMENT', text: '결제' },
          { type: 'POLICY', text: '정책' },
          { type: 'INFO', text: '안내' },
        ],
        itinerary_data: {
          days: [{ day: 1, schedule: [{ activity: '시내 관광' }] }],
        },
      },
      rawText: 'DAY1 시내 관광',
      shortCode: 'TST-XXX-05-01',
      confidence: 0.95,
    });
    expect(String(r.row.parser_version ?? '')).toContain('2026-05-22-v1');
    expect(r.l1.reasons).toEqual([]);
    expect(r.travelPackageStatus).toMatch(/approved|pending_review/);
  });
});
