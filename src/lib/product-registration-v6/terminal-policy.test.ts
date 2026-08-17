import { describe, expect, it } from 'vitest';

import { evaluateProductRegistrationV6Policy } from './terminal-policy';

function canonical(input: { outcome?: 'verified' | 'degraded' | 'blocked'; prices?: unknown[] } = {}) {
  const outcome = input.outcome ?? 'verified';
  const prices = (input.prices ?? [{ date: '2026-10-01', amount: 599000, currency: 'KRW' }]).map(raw => {
    const price = raw as Record<string, unknown>;
    return {
      ...price,
      evidence: price.evidence ?? { quote: `${String(price.date ?? price.label ?? '적용 범위')}\n${Number(price.amount).toLocaleString('en-US')}원` },
    };
  });
  return {
    sections: [{
      priceYearEvidence: { validated: true, year: 2026 as number | null, source: 'document_text' },
      completeness: {
        publicationOutcome: outcome,
        degradedReasons: outcome === 'degraded' ? ['flight_times: 운항 시간 최종 확인'] : [],
        blockers: outcome === 'blocked' ? ['price: 판매가 누락'] : [],
      },
      v3: {
        ledger: {
          variants: [{
            price_calendar: prices,
            standard_notices: [{ category: 'cancellation_terms', raw_text: '취소료는 특별약관에 따릅니다.' }],
          }],
        },
      },
    }],
  };
}

describe('product registration V6 terminal policy', () => {
  it('publishes a fully verified product', () => {
    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: canonical() });
    expect(result.terminalOutcome).toBe('published_verified');
  });

  it('publishes a safe degraded product without hiding the reason', () => {
    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: canonical({ outcome: 'degraded' }) });
    expect(result.terminalOutcome).toBe('published_degraded');
    expect(result.degradedReasons).toHaveLength(1);
  });

  it('keeps an expired ticketing offer as a degraded consultation product', () => {
    const payload = canonical() as Record<string, any>;
    payload.sections[0].v3.ledger.variants[0].ticketing_condition = {
      kind: 'fixed_deadline',
      status: 'expired',
      deadline: '2026-08-14',
      customerNotice: '발권기한 경과 · 현재 좌석과 요금 상담 확인',
      consultationOnly: true,
      marketingEligible: false,
      evidence: { quote: '8/14까지 발권조건' },
    };
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: payload,
      sourceTexts: ['8/28 출발 899,000원 · 8/14까지 발권조건'],
    });

    expect(result.terminalOutcome).toBe('published_degraded');
    expect(result.blockers).toEqual([]);
    expect(result.degradedReasons.some(reason => reason.includes('TICKETING_DEADLINE_EXPIRED_RECONFIRMATION_REQUIRED'))).toBe(true);
  });

  it('degrades an unresolved ticketing sentence instead of discarding price and departure', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical(),
      sourceTexts: ['10/1 출발 599,000원 · 발권 세부조건은 별도 안내'],
    });

    expect(result.terminalOutcome).toBe('published_degraded');
    expect(result.degradedReasons.some(reason => reason.includes('TICKETING_CONDITION_UNRESOLVED'))).toBe(true);
  });

  it('blocks a price not tied to a departure scope', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({ prices: [{ amount: 599000, currency: 'KRW' }] }),
    });
    expect(result.terminalOutcome).toBe('blocked_action_required');
    expect(result.blockers.some(reason => reason.includes('출발일'))).toBe(true);
  });

  it('discards a source section only when the original source has no sale-price candidate', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({ prices: [] }),
      sourceTexts: ['다낭 3박 5일\n판매가는 별도 문의\n호텔 동급 예정'],
    });
    expect(result.terminalOutcome).toBe('discarded_source_incomplete');
    expect(result.blockers.some(reason => reason.includes('SOURCE_SALE_PRICE_ABSENT'))).toBe(true);
  });

  it('keeps a parser miss blocked when the original source contains a sale-price candidate', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({ prices: [] }),
      sourceTexts: ['다낭 3박 5일\n성인 판매가 899,000원\n호텔 동급 예정'],
    });
    expect(result.terminalOutcome).toBe('blocked_action_required');
    expect(result.sourceSalePriceDispositions[0]?.disposition.state).toBe('source_price_requires_resolution');
  });

  it('accepts numeric weekday and validated date-range price scopes', () => {
    const weekday = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({ prices: [{ weekday: 0, amount: 599000, currency: 'KRW' }] }),
    });
    const range = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({ prices: [{ date_range: { start: '2026-10-01', end: '2026-10-31' }, amount: 599000, currency: 'KRW' }] }),
    });
    expect(weekday.blockers.some(reason => reason.includes('출발일'))).toBe(false);
    expect(range.blockers.some(reason => reason.includes('출발일'))).toBe(false);
  });

  it('blocks two different sale prices for the same exact commercial scope', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [
          { date: '2026-08-14', amount: 1_039_000, currency: 'KRW' },
          { date: '2026-08-14', amount: 1_149_000, currency: 'KRW' },
        ],
      }),
    });

    expect(result.blockers.some(reason => reason.includes('PRICE_SCOPE_CONFLICT'))).toBe(true);
    expect(result.terminalOutcome).toBe('blocked_action_required');
  });

  it('allows the same date to carry separately evidenced traveler-count tiers', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [
          { date: '2026-08-14', amount: 1_039_000, currency: 'KRW', min_travelers: 8, max_travelers: 9 },
          { date: '2026-08-14', amount: 949_000, currency: 'KRW', min_travelers: 10 },
        ],
      }),
    });

    expect(result.blockers.some(reason => reason.includes('PRICE_SCOPE_CONFLICT'))).toBe(false);
  });

  it('allows one adult sale price with source-bound occupancy-specific child prices', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [{
          date: '2026-08-14',
          label: '성인',
          amount: 1_339_000,
          currency: 'KRW',
          passenger_prices: [
            {
              passenger_type: 'child',
              occupancy_type: 'without_bed',
              label: '아동 노베드',
              amount: 979_000,
              currency: 'KRW',
              evidence: { quote: '아동 노베드 979,000원' },
            },
            {
              passenger_type: 'child',
              occupancy_type: 'with_bed',
              label: '아동 엑베적용',
              amount: 1_059_000,
              currency: 'KRW',
              evidence: { quote: '아동 엑베적용 1,059,000원' },
            },
          ],
        }],
      }),
    });

    expect(result.blockers.some(reason => reason.includes('PRICE_SCOPE_CONFLICT'))).toBe(false);
    expect(result.terminalOutcome).toBe('published_verified');
  });

  it('blocks a price whose evidence points only to a generic heading', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [{
          date: '2026-10-01',
          amount: 599000,
          currency: 'KRW',
          evidence: { quote: '상품가' },
        }],
      }),
    });

    expect(result.terminalOutcome).toBe('blocked_action_required');
    expect(result.blockers.some(reason => reason.includes('evidence'))).toBe(true);
  });

  it('does not infer a missing currency', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({ prices: [{ date: '2026-10-01', amount: 599000 }] }),
    });

    expect(result.blockers.some(reason => reason.includes('통화'))).toBe(true);
  });

  it('accepts an explicit supplier shorthand price as exact amount evidence', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [{
          date: '2026-10-01',
          amount: 599000,
          currency: 'KRW',
          evidence: { quote: '10/1 599,-' },
        }],
      }),
    });

    expect(result.blockers.some(reason => reason.includes('evidence'))).toBe(false);
  });

  it('replays a table price after a comma-terminated date on the preceding line', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [{
          date: '2026-08-15',
          amount: 999000,
          currency: 'KRW',
          evidence: { quote: '4/29, 5/2, 8/1, 8/12\n8/13, 8/15,\n999,000' },
        }],
      }),
    });

    expect(result.blockers.some(reason => reason.includes('evidence'))).toBe(false);
  });

  it('replays a compact thousands price only with explicit table-cell scale lineage', () => {
    const accepted = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [{
          date: '2026-08-14',
          amount: 1_059_000,
          currency: 'KRW',
          evidence: {
            quote: '8/14\n1,059',
            extraction_method: 'document_ir_table_cell',
            source_amount_scale: 1000,
          },
        }],
      }),
    });
    const blocked = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [{
          date: '2026-08-14',
          amount: 1_059_000,
          currency: 'KRW',
          evidence: { quote: '8/14\n1,059', extraction_method: 'document_ir_table_cell' },
        }],
      }),
    });

    expect(accepted.blockers.some(reason => reason.includes('evidence'))).toBe(false);
    expect(blocked.blockers.some(reason => reason.includes('evidence'))).toBe(true);
  });

  it('replays a three-digit thousands price only with explicit table-cell scale lineage', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical({
        prices: [{
          date: '2026-08-14',
          amount: 859_000,
          currency: 'KRW',
          evidence: {
            quote: '8/14\n859',
            extraction_method: 'document_ir_table_cell',
            source_amount_scale: 1000,
          },
        }],
      }),
    });

    expect(result.blockers.some(reason => reason.includes('evidence'))).toBe(false);
  });

  it('blocks a calendar year that was inferred without source evidence', () => {
    const payload = canonical();
    payload.sections[0]!.priceYearEvidence = { validated: false, year: null, source: 'missing' };
    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: payload });

    expect(result.blockers.some(reason => reason.includes('출발 연도'))).toBe(true);
  });

  it('accepts a lineage-bound nearest-future date and rejects missing resolution lineage', () => {
    const reference = {
      referenceDate: '2026-08-14',
      timezone: 'Asia/Seoul' as const,
      policyVersion: 'source-departure-date-policy-4',
      rollingInferenceEligible: true,
    };
    const payload = canonical() as Record<string, any>;
    payload.sections[0].priceYearEvidence = {
      validated: true,
      year: 2026,
      source: 'nearest_future_policy',
      referenceDate: reference.referenceDate,
      timezone: reference.timezone,
      policyVersion: reference.policyVersion,
    };
    payload.sections[0].departureDatePolicy = {
      referenceDate: reference.referenceDate,
      timezone: reference.timezone,
      policyVersion: reference.policyVersion,
      blockers: [],
    };
    payload.sections[0].v3.ledger.variants[0].price_calendar[0].date_resolution = {
      authority: 'nearest_future_policy',
      reference_date: reference.referenceDate,
      timezone: reference.timezone,
      policy_version: reference.policyVersion,
      disposition: 'future',
    };
    const accepted = evaluateProductRegistrationV6Policy({
      canonicalPayload: payload,
      departureDateReference: reference,
    });
    expect(accepted.blockers.some(reason => reason.includes('DEPARTURE_DATE_'))).toBe(false);

    delete payload.sections[0].v3.ledger.variants[0].price_calendar[0].date_resolution;
    const blocked = evaluateProductRegistrationV6Policy({
      canonicalPayload: payload,
      departureDateReference: reference,
    });
    expect(blocked.blockers.some(reason => reason.includes('DEPARTURE_DATE_RESOLUTION_LINEAGE_MISSING'))).toBe(true);
  });

  it('blocks a missing cancellation policy', () => {
    const payload = canonical();
    payload.sections[0]!.v3.ledger.variants[0]!.standard_notices = [];
    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: payload });
    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING'))).toBe(true);
  });

  it('accepts an approved, customer-visible cancellation policy snapshot', () => {
    const payload = canonical();
    payload.sections[0]!.v3.ledger.variants[0]!.standard_notices = [];
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: payload,
      cancellationCoverage: [{
        revisionId: 'revision-1',
        catalogProductId: 'product-1',
        covered: true,
        policyHash: 'a'.repeat(64),
      }],
    });

    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING'))).toBe(false);
    expect(result.terminalOutcome).toBe('published_verified');
  });

  it('blocks when the frozen policy has no customer-visible cancellation notice', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical(),
      cancellationCoverage: [{
        revisionId: 'revision-1',
        catalogProductId: 'product-1',
        covered: false,
        policyHash: 'b'.repeat(64),
      }],
    });

    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING:product-1'))).toBe(true);
  });

  it('blocks contradictory source cancellation terms instead of applying the standard fallback', () => {
    const decision = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical(),
      cancellationCoverage: [{
        revisionId: 'revision-1',
        catalogProductId: 'package-1',
        covered: false,
        policyHash: 'a'.repeat(64),
        conflict: true,
        conflictReasons: ['SOURCE_CANCELLATION_RATE_CONFLICT:7D:30,50'],
      }],
    });

    expect(decision.outcome).toBe('blocked');
    expect(decision.blockers).toContain(
      'CANCELLATION_POLICY_CONFLICT:package-1:SOURCE_CANCELLATION_RATE_CONFLICT:7D:30,50',
    );
  });

  it('blocks contradictory final customer guide-tip notices even when completeness says degraded', () => {
    const payload = canonical({ outcome: 'degraded' }) as Record<string, any>;
    payload.sections[0].v3.ledger.variants[0].standard_notices.push(
      { template_key: 'guide.tip_included', review_status: 'auto_clean' },
      { template_key: 'guide.tip_amount_local_payment', review_status: 'auto_clean' },
    );

    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: payload });

    expect(result.terminalOutcome).toBe('blocked_action_required');
    expect(result.blockers).toContain(
      'sections[0].variants[0]:CUSTOMER_FACT_CONTRADICTION:GUIDE_TIP_INCLUDED_AND_LOCAL_PAYMENT',
    );
  });

  it('blocks contradictory guide-tip facts even when the local-payment notice was suppressed', () => {
    const payload = canonical({ outcome: 'verified' }) as Record<string, any>;
    payload.sections[0].v3.ledger.variants[0].structured_facts = [
      { category: 'guide_tip', review_status: 'auto_clean', values: { included: true, amount: null } },
      { category: 'guide_tip', review_status: 'review_needed', values: { included: false, amount: null } },
    ];
    payload.sections[0].v3.ledger.variants[0].standard_notices = [
      { template_key: 'guide.tip_included', review_status: 'auto_clean' },
    ];

    const result = evaluateProductRegistrationV6Policy({ canonicalPayload: payload });

    expect(result.terminalOutcome).toBe('blocked_action_required');
    expect(result.blockers).toContain(
      'sections[0].variants[0]:CUSTOMER_FACT_CONTRADICTION:GUIDE_TIP_INCLUDED_AND_LOCAL_PAYMENT',
    );
  });

  it('does not mistake an unrelated refund notice for cancellation terms', () => {
    const payload = canonical();
    payload.sections[0]!.v3.ledger.variants[0]!.standard_notices = [{
      category: 'meal_refund',
      raw_text: '티업 시간 때문에 이용하지 못한 조식 비용은 환불되지 않습니다.',
    }];
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: payload,
      termsTypes: ['refund'],
      sourceTexts: ['티업 시간 때문에 이용하지 못한 조식 비용은 환불되지 않습니다.'],
    });

    expect(result.blockers.some(reason => reason.includes('CANCELLATION_POLICY_MISSING'))).toBe(true);
  });

  it('blocks tenant or source lineage mismatches', () => {
    const result = evaluateProductRegistrationV6Policy({
      canonicalPayload: canonical(),
      tenantId: 'tenant-a',
      sourceTenantId: 'tenant-b',
      sourceHash: 'a',
      expectedSourceHash: 'b',
    });
    expect(result.blockers.some(reason => reason.includes('SOURCE_HASH_MISMATCH'))).toBe(true);
    expect(result.blockers.some(reason => reason.includes('TENANT_LINEAGE_MISMATCH'))).toBe(true);
  });
});
