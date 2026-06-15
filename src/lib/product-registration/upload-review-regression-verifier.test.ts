import { describe, expect, it } from 'vitest';

import {
  buildUploadReviewRegressionReport,
} from './upload-review-regression-verifier';
import type { UploadReviewQueueFixtureRow } from './review-queue-fixture-candidates';

function row(overrides: Partial<UploadReviewQueueFixtureRow>): UploadReviewQueueFixtureRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-06-15T00:00:00.000Z',
    status: 'pending',
    severity: 'critical',
    error_reason: 'Customer landing/A4 blocked: itinerary duplicate day number: duplicate day entries must be resolved before render. | itinerary duration overflow: product duration 5 days but itinerary has 11 days.',
    source_filename: 'catalog.txt',
    file_hash: 'a'.repeat(64),
    normalized_content_hash: 'b'.repeat(64),
    raw_text_chunk: '',
    parsed_draft_json: null,
    product_title: '3박5일',
    land_operator_id: null,
    ...overrides,
  };
}

describe('buildUploadReviewRegressionReport', () => {
  it('passes recovered inline PKG catalog failures when per-product day sequences are clean', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          raw_text_chunk: `공통 요금표
예약시 날짜별 상품가 다시 체크 부탁드립니다.  PKG
클락 알뜰 3색골프 + 단독차량 3박5일
일 자
제1일
부산 출발
제2일
골프 라운딩
제3일
골프 라운딩
제4일
골프 라운딩
제5일
부산 도착
* 상기 일정은 현지 사정으로 변경될 수 있습니다.  PKG
클락 알뜰 3색골프 + 단독차량 4박6일
일 자
제1일
부산 출발
제2일
골프 라운딩
제3일
골프 라운딩
제4일
골프 라운딩
제5일
골프 라운딩
제6일
부산 도착`,
        }),
      ],
    });

    expect(report.checked).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(1);
    expect(report.checks[0]?.productsRecovered).toBe(2);
  });

  it('fails itinerary boundary regressions that still recover as one product', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          raw_text_chunk: `클락 알뜰 3색골프 + 단독차량 3박5일
일 자
제1일
부산 출발
제2일
골프 라운딩`,
        }),
      ],
    });

    expect(report.checked).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.checks[0]?.reason).toContain('expected a recovered multi-product catalog');
  });
});
