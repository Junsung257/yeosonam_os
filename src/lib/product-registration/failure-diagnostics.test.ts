import { describe, expect, it } from 'vitest';
import {
  classifyProductRegistrationFailure,
  summarizeProductRegistrationFailures,
} from './failure-diagnostics';

describe('product registration failure diagnostics', () => {
  it('classifies source-backed price date disagreements as stable blocker codes', () => {
    const diagnostics = classifyProductRegistrationFailure(
      'Price source audit failed: price date disagreement: source-backed dates do not overlap recovered dates',
    );

    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      'PRICE_DATE_DISAGREEMENT',
    ]));
    expect(diagnostics[0]?.severity).toBe('critical');
  });

  it('classifies stacked or incomplete flight time blockers', () => {
    const diagnostics = classifyProductRegistrationFailure(
      'flight time source mismatch: source has round-trip flight times but saved segments are incomplete',
    );

    expect(diagnostics.map(diagnostic => diagnostic.code)).toContain('FLIGHT_TIME_MISMATCH');
  });

  it('summarizes repeated upload blockers for API responses and review queues', () => {
    const summary = summarizeProductRegistrationFailures([
      'Customer landing/A4 blocked: product_prices missing | itinerary missing',
      'Destination resolution failed: destination_code:UNK:큐슈',
    ]);

    expect(summary.hasCritical).toBe(true);
    expect(summary.codes).toEqual(expect.arrayContaining([
      'CUSTOMER_RENDER_BLOCKED',
      'PRICE_ROWS_MISSING',
      'ITINERARY_MISSING',
      'DESTINATION_UNRESOLVED',
    ]));
    expect(summary.nextAction).toMatch(/price/i);
  });

  it('classifies Korean customer render and price blockers', () => {
    const summary = summarizeProductRegistrationFailures([
      '고객용 랜딩/A4 생성 불가: 가격 행 없음 | 출발일별 가격(price_dates) 없음',
    ]);

    expect(summary.codes).toEqual(expect.arrayContaining([
      'CUSTOMER_RENDER_BLOCKED',
      'PRICE_ROWS_MISSING',
      'PRICE_DATES_MISSING',
    ]));
  });

  it('classifies infrastructure and persistence failures separately from parser blockers', () => {
    const summary = summarizeProductRegistrationFailures([
      'Supabase가 구성되지 않았습니다.',
      '`after` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context',
      'travel_packages 저장 실패: new row for relation "travel_packages" violates check constraint "travel_packages_itinerary_data_structure_check"',
    ]);

    expect(summary.codes).toEqual(expect.arrayContaining([
      'SUPABASE_NOT_CONFIGURED',
      'REQUEST_SCOPE_ERROR',
      'PERSISTENCE_CONSTRAINT_FAILED',
    ]));
  });
});
