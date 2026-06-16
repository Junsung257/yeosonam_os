import { describe, expect, it } from 'vitest';

import {
  buildUploadReviewRegressionReport,
} from './upload-review-regression-verifier';
import type { UploadReviewQueueFixtureRow } from './review-queue-fixture-candidates';

const RECOVERABLE_INLINE_PKG_RAW = `클락 골프 공통 요금표
출발일
6/20,21,28
999,-
1,159,-
예약시 날짜별 상품가 다시 체크 부탁드립니다.  PKG
클락 알뜰 3색골프 + 단독차량 3박5일
2026.4.1
일 자
제1일
부산 출발
제5일
부산 도착
* 상기 일정은 현지 사정으로 변경될 수 있습니다.  PKG
클락 알뜰 3색골프 + 단독차량 4박6일
2026.4.1
일 자
제1일
부산 출발
제6일
부산 도착`;

const KOREAN_RETURN_FLIGHT_CATALOG_RAW = `BX 나트랑 다이아몬드베이 골프텔 3박5일
2026.5.1
일 자
지 역
교통편
시 간
주요 행사 일정
식 사
제1일

부 산
나트랑

BX781

19:20
22:20

김해 국제공항 출발
나트랑 깜란 국제공항 도착
제2일
나트랑
전 일
호텔 조식 후 자유시간
제3일
나트랑
전 일
호텔 조식 후 자유시간
제4일
나트랑
전용차량




BX782
전 일


22:00

23:20
호텔 미팅후 / 나트랑 공항으로 이동
나트랑 깜란 국제공항 출발
제5일
부 산

06:20
김해 국제공항 도착`;

function row(overrides: Partial<UploadReviewQueueFixtureRow>): UploadReviewQueueFixtureRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-06-15T00:00:00.000Z',
    status: 'pending',
    severity: 'critical',
    error_reason: 'itinerary duplicate day number: duplicate day entries must be resolved before render. | itinerary duration overflow: product duration 5 days but itinerary has 11 days.',
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
  it('passes recovered inline PKG catalog failures when all detected codes are covered', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          raw_text_chunk: RECOVERABLE_INLINE_PKG_RAW,
        }),
      ],
    });

    expect(report.checked).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.partial).toBe(0);
    expect(report.passed).toBe(1);
    expect(report.checks[0]?.productsRecovered).toBe(2);
  });

  it('fails itinerary boundary regressions that still recover as one product', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          raw_text_chunk: `?대씫 ?뚮쑑 3?됯낏??+ ?⑤룆李⑤웾 3諛???????????遺??異쒕컻
????怨⑦봽 ?쇱슫??`,
        }),
      ],
    });

    expect(report.checked).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.checks[0]?.reason).toContain('expected a recovered multi-product catalog');
  });

  it('passes when itinerary and price disagreement blockers both recover from source evidence', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          error_reason: 'Customer landing/A4 blocked: itinerary duplicate day number: duplicate day entries must be resolved before render. | Price source audit failed: price date disagreement: source-backed dates do not overlap recovered dates',
          raw_text_chunk: RECOVERABLE_INLINE_PKG_RAW,
        }),
      ],
    });

    expect(report.passed).toBe(1);
    expect(report.partial).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.checks[0]?.coveredCodes).toContain('ITINERARY_DUPLICATE_DAY');
    expect(report.checks[0]?.coveredCodes).toContain('PRICE_DATE_DISAGREEMENT');
    expect(report.codeCounts.PRICE_DATE_DISAGREEMENT).toBe(1);
    expect(report.uncoveredCodeCounts.PRICE_DATE_DISAGREEMENT).toBeUndefined();
    expect(report.checks[0]?.reason).toContain('source-backed price/date evidence recovered');
  });

  it('does not let the umbrella customer render blocker prevent replay when specific blockers pass', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          error_reason: 'Customer landing/A4 blocked: itinerary duplicate day number: duplicate day entries must be resolved before render. | itinerary duration overflow: product duration 6 days but itinerary has 12 days.',
          raw_text_chunk: RECOVERABLE_INLINE_PKG_RAW,
        }),
      ],
    });

    expect(report.checked).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.partial).toBe(0);
    expect(report.passed).toBe(1);
    expect(report.checks[0]?.codes).toContain('CUSTOMER_RENDER_BLOCKED');
    expect(report.checks[0]?.uncoveredCodes).not.toContain('CUSTOMER_RENDER_BLOCKED');
  });

  it('skips synthetic regression upload rows in live replay strictness', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          product_title: 'CODEX-V3-E2E-검증-RETRY',
          error_reason: 'Customer landing/A4 blocked: product_prices missing | price_dates missing',
          raw_text_chunk: `상품명: CODEX-V3-E2E-검증-RETRY
가격 499000원 / 최소출발 4명
DAY 1
부산 출발`,
        }),
      ],
    });

    expect(report.checked).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.checks[0]?.reason).toContain('synthetic regression/test upload row');
  });

  it('covers flight mismatch replay when itinerary segments recover a Korean overnight return flight', () => {
    const report = buildUploadReviewRegressionReport({
      rows: [
        row({
          product_title: '특별약관적용 · 나트랑 · 3박5일 · BX781',
          error_reason: 'Customer landing/A4 blocked: flight time source mismatch: source has round-trip flight times but itinerary_data.flight_segments is missing outbound/inbound segments',
          raw_text_chunk: KOREAN_RETURN_FLIGHT_CATALOG_RAW,
        }),
      ],
    });

    expect(report.checked).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.partial).toBe(0);
    expect(report.passed).toBe(1);
    expect(report.checks[0]?.coveredCodes).toContain('FLIGHT_TIME_MISMATCH');
    expect(report.checks[0]?.uncoveredCodes).not.toContain('CUSTOMER_RENDER_BLOCKED');
  });
});
