import { describe, expect, it } from 'vitest';

import { buildRepairFirstOpenabilitySummary } from './repair-first-openability';
import {
  buildPackageDerivedV3Result,
  classifyUploadToOpenReviewReason,
  detectSourceTicketingDeadline,
  filterResolvedUploadToOpenReasons,
  filterCustomerOpenPriceDates,
  missingPriceDatesFromScorecard,
  patchV3WithPackageBackedEvidence,
  reconcileV3DraftWithLiveEntityQueueClear,
  repairMojibakeAttractionNamesInItinerary,
  repairNonLodgingHotelNamesInItinerary,
  repairOvernightArrivalDaySplit,
  repairDurationToSavedItineraryDays,
  repairEmptyItineraryDaySchedules,
  repairCustomerVisibleCopyPayload,
  repairOptionalTourScheduleDuplicates,
  repairOptionalToursForCustomerDisplay,
  repairPolicyLeakInItinerarySchedule,
  repairProductTitleScheduleNoise,
  repairSupplierNoticeTerms,
  sanitizeCustomerOptionalTours,
  sanitizeCustomerVisibleTitle,
  shouldAutoApplySourceBackedPriceRepair,
} from './upload-to-open-autopilot';

describe('classifyUploadToOpenReviewReason', () => {
  it('treats mobile proof gaps as retryable proof work, not unusable products', () => {
    const action = classifyUploadToOpenReviewReason('mobile_proof: actual customer mobile browser proof did not include the lp surface');

    expect(action.canBeMadeUsable).toBe(true);
    expect(action.category).toBe('proof_retry_required');
  });

  it('treats unsafe price evidence gaps as possibly unusable until source is reinforced', () => {
    const action = classifyUploadToOpenReviewReason('quality_scorecard_price_repair_requires_review:product_prices_not_safely_rebuildable');

    expect(action.canBeMadeUsable).toBe(false);
    expect(action.category).toBe('possibly_unusable_source');
  });

  it('routes V3 notice blockers to notice regeneration instead of generic blocking', () => {
    const action = classifyUploadToOpenReviewReason('v3:customer notice draft blocked');

    expect(action.canBeMadeUsable).toBe(true);
    expect(action.category).toBe('v3_notice_required');
  });
});

describe('filterResolvedUploadToOpenReasons', () => {
  it('removes resolved source-backed price repair blockers when the final customer open contract passes', () => {
    const reasons = filterResolvedUploadToOpenReasons({
      reasons: [
        'price_dates_repair_requires_review:filled 1 missing source-backed departure dates',
        'mobile_proof:actual /packages mobile browser proof status is fail',
      ],
      customerOpenContractOk: true,
      mobileProofOk: true,
      sourceVerifyStatus: 'clean',
      finalQualityScorecard: {
        customerOpenCandidate: true,
        blockers: [],
        domains: [
          { id: 'price_dates', label: '가격/날짜 저장 일치', score: 100, status: 'pass', blockers: [], evidence: [] },
        ],
      } as never,
    });

    expect(reasons).toEqual(['mobile_proof:actual /packages mobile browser proof status is fail']);
  });

  it('keeps price repair blockers when the final scorecard still has price failures', () => {
    const reasons = filterResolvedUploadToOpenReasons({
      reasons: ['price_dates_repair_requires_review:filled 1 missing source-backed departure dates'],
      customerOpenContractOk: false,
      mobileProofOk: true,
      sourceVerifyStatus: 'clean',
      finalQualityScorecard: {
        customerOpenCandidate: false,
        blockers: ['price_dates: C12 mismatch'],
        domains: [
          { id: 'price_dates', label: '가격/날짜 저장 일치', score: 0, status: 'fail', blockers: ['C12 mismatch'], evidence: [] },
        ],
      } as never,
    });

    expect(reasons).toEqual(['price_dates_repair_requires_review:filled 1 missing source-backed departure dates']);
  });
});

describe('source-backed price and package evidence policies', () => {
  it('auto-applies whitelisted source-backed price repairs when deterministic checks are clean', () => {
    expect(shouldAutoApplySourceBackedPriceRepair({
      status: 'repaired',
      reason: 'shared vertical date table',
      source: 'product_price_vertical_date_table',
      expectedCount: 2,
      existingCount: 1,
      addedCount: 1,
      priceDates: [
        { date: '2026-09-30', price: 1429000, confirmed: false },
        { date: '2026-10-07', price: 1439000, confirmed: false },
      ],
    }, false)).toBe(true);
  });

  it('keeps deterministic price repairs in review when C12 still fails', () => {
    expect(shouldAutoApplySourceBackedPriceRepair({
      status: 'repaired',
      reason: 'shared table but inconsistent stores',
      source: 'pdf_date_price_table',
      expectedCount: 1,
      existingCount: 13,
      addedCount: 0,
      priceDates: [{ date: '2026-08-14', price: 1749000, confirmed: false }],
    }, true)).toBe(false);
  });

  it('removes non-customer option noise from optional tours', () => {
    expect(sanitizeCustomerOptionalTours([
      { name: '선택관광 아일랜드 호핑투어', price: '$80/인' },
      { name: '쇼핑 3회', price: null },
    ])).toEqual([
      expect.objectContaining({ name: '선택관광 아일랜드 호핑투어' }),
    ]);
  });

  it('uses saved package facts to patch missing V3 minimum departure and terms', () => {
    const v3 = {
      structure_plan: {
        document_type: 'single_package',
        planner_source: 'deterministic',
        expected_products: 1,
        shared_sections: [],
        product_boundaries: [{ index: 0, line_start: 1, line_end: 10, title_hint: '테스트 상품' }],
        variant_axes: [],
        price_table_location: null,
        price_mapping_strategy: 'none',
        flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
        itinerary_boundary_pattern: null,
        option_section_locations: [],
        shopping_section_locations: [],
        confidence: 1,
        unresolved_parts: [],
      },
      ledger: {
        variants: [{
          variant_key: 'v1',
          minimum_departure: null,
          inclusions: [],
          exclusions: [],
          days: [],
          price_calendar: [],
          flight_segments: [],
          options: [],
          shopping: [],
          standard_notices: [],
          structured_facts: [],
          evidence_coverage: {},
        }],
      },
      match_summary: {
        attraction_matched_count: 0,
        attraction_unmatched_count: 0,
        option_review_count: 0,
        shopping_count: 0,
        unmatched: [],
        entity_summary: {
          counts: {},
          review_required_count: 0,
          attraction_unresolved_count: 0,
          shopping_review_needed_count: 0,
          option_review_needed_count: 0,
          unknown_customer_visible_count: 0,
          review_items: [],
        },
      },
      gate_result: { status: 'blocked', customer_publishable: false, checks: [] },
      render_contract_preview: [],
    };

    const changed = patchV3WithPackageBackedEvidence(v3 as never, {
      min_participants: 4,
      inclusions: ['왕복 항공권'],
      excludes: ['개인경비'],
      itinerary_data: { days: [] },
    });

    const variant = (v3.ledger.variants[0] as {
      minimum_departure: { value: number } | null;
      inclusions: Array<{ value: string }>;
      exclusions: Array<{ value: string }>;
    });
    expect(changed).toBe(true);
    expect(variant.minimum_departure?.value).toBe(4);
    expect(variant.inclusions[0]?.value).toBe('왕복 항공권');
    expect(variant.exclusions[0]?.value).toBe('개인경비');
  });
});

describe('repair-first openability summary', () => {
  it('marks a clean package as openable when no repair was needed', () => {
    const summary = buildRepairFirstOpenabilitySummary({
      reasons: [],
      repairs: [],
      reviewActions: [],
    });

    expect(summary.state).toBe('openable');
    expect(summary.can_be_made_usable).toBe(true);
  });

  it('marks a repaired clean package as auto_fixed_openable', () => {
    const summary = buildRepairFirstOpenabilitySummary({
      reasons: [],
      repairs: ['price_dates:existing_source_backed_dates_synced_to_dependent_stores'],
      reviewActions: [],
    });

    expect(summary.state).toBe('auto_fixed_openable');
    expect(summary.automatic_repair_attempted).toBe(true);
  });

  it('keeps unresolved unsafe source evidence in human source review', () => {
    const action = classifyUploadToOpenReviewReason('quality_scorecard_price_repair_requires_review:product_prices_not_safely_rebuildable');
    const summary = buildRepairFirstOpenabilitySummary({
      reasons: [action.reason],
      repairs: ['raw_text:shared_price_evidence_appended'],
      reviewActions: [action],
    });

    expect(summary.state).toBe('needs_human_source_review');
    expect(summary.human_source_review_required).toBe(true);
    expect(summary.can_be_made_usable).toBe(false);
  });
});

describe('filterCustomerOpenPriceDates', () => {
  it('keeps only KST-upcoming departure dates for customer-open price stores', () => {
    const result = filterCustomerOpenPriceDates([
      { date: '2026-06-29', price: 700000, confirmed: false },
      { date: '2026-06-30', price: 710000, confirmed: false },
      { date: '2026-07-01', price: 720000, confirmed: false },
    ], '2026-06-30');

    expect(result.map(row => row.date)).toEqual(['2026-06-30', '2026-07-01']);
  });
});

describe('missingPriceDatesFromScorecard', () => {
  it('extracts source-backed missing C12 price dates for repair', () => {
    const rows = missingPriceDatesFromScorecard({
      blockers: [
        'price_dates: C12: \uB0A0\uC9DC\uBCC4 \uAC00\uACA9 \uBD88\uC77C\uCE58 2026-07-03:\uC5C6\uC74C!=979000 / 2026-09-02:\uC5C6\uC74C!=949000',
      ],
      domains: [],
      averageScore: 0,
      minScore: 0,
      customerOpenCandidate: false,
      generatedAt: '2026-06-30T00:00:00.000Z',
      thresholds: { domainMin: 95, averageMin: 97 },
    });

    expect(rows).toEqual([
      { date: '2026-07-03', price: 979000, confirmed: false },
      { date: '2026-09-02', price: 949000, confirmed: false },
    ]);
  });
});

describe('detectSourceTicketingDeadline', () => {
  it('detects expired Korean raw ticketing conditions before customer proof work', () => {
    const result = detectSourceTicketingDeadline({
      rawText: '\uC2DC\uC988\uC624\uCE74 \uB2E4\uC0C9 \uACE8\uD504 **6/28\uC77C\uC774\uB0B4 \uBC1C\uAD8C\uC870\uAC74',
      today: '2026-06-30',
    });

    expect(result).toEqual({
      deadline: '2026-06-28',
      expired: true,
      source: 'raw_text',
    });
  });

  it('prefers explicit ticketing_deadline when available', () => {
    const result = detectSourceTicketingDeadline({
      ticketingDeadline: '2026-07-01',
      rawText: '\uC2DC\uC988\uC624\uCE74 **6/28\uC77C\uC774\uB0B4 \uBC1C\uAD8C\uC870\uAC74',
      today: '2026-06-30',
    });

    expect(result).toEqual({
      deadline: '2026-07-01',
      expired: false,
      source: 'ticketing_deadline',
    });
  });
});

describe('sanitizeCustomerVisibleTitle', () => {
  it('removes supplier-only ticketing and commission tokens from customer titles', () => {
    expect(sanitizeCustomerVisibleTitle('▶[26728 오전발권] 하계 실속노풀PKG - 컴10%')).toBe('하계 실속노풀패키지');
  });

  it('keeps normal customer titles unchanged', () => {
    expect(sanitizeCustomerVisibleTitle('방콕 파타야 3박 5일 실속 패키지')).toBe('방콕 파타야 3박 5일 실속 패키지');
  });
});

describe('repairPolicyLeakInItinerarySchedule', () => {
  it('removes pure policy rows and keeps the actual golf schedule after stripping refund fragments', () => {
    const result = repairPolicyLeakInItinerarySchedule({
      days: [
        {
          day: 1,
          schedule: [
            {
              activity: '\uCE90\uC2AC\uB809\uC2A4CC 18H \uB77C\uC6B4\uB529 (\uB2E8, \uC77C\uBAB0\uAE4C\uC9C0\uB9CC \uB77C\uC6B4\uB529 \uAC00\uB2A5\uD569\uB2C8\uB2E4. \uD658\uBD88X)',
              landing_sentence: '\uCE90\uC2AC\uB809\uC2A4CC 18H \uB77C\uC6B4\uB529 \uC77C\uC815\uC744 \uC9C4\uD589\uD569\uB2C8\uB2E4.',
            },
            {
              activity: '\uC0C1\uAE30 \uC77C\uC815\uC740 \uD604\uC9C0 \uC0AC\uC815, \uCC9C\uC7AC\uC9C0\uBCC0\uC73C\uB85C \uC778\uD574 \uBCC0\uACBD\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
              landing_sentence: '\uC0C1\uAE30 \uC77C\uC815\uC740 \uD604\uC9C0 \uC0AC\uC815, \uCC9C\uC7AC\uC9C0\uBCC0\uC73C\uB85C \uC778\uD574 \uBCC0\uACBD\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
            },
          ],
        },
      ],
    });

    const days = (result.itineraryData as { days: Array<{ schedule: Array<{ activity: string }> }> }).days;
    expect(result.repaired).toBe(true);
    expect(result.removed).toHaveLength(1);
    expect(result.sanitized).toEqual([
      {
        before: '\uCE90\uC2AC\uB809\uC2A4CC 18H \uB77C\uC6B4\uB529 (\uB2E8, \uC77C\uBAB0\uAE4C\uC9C0\uB9CC \uB77C\uC6B4\uB529 \uAC00\uB2A5\uD569\uB2C8\uB2E4. \uD658\uBD88X)',
        after: '\uCE90\uC2AC\uB809\uC2A4CC 18H \uB77C\uC6B4\uB529',
      },
    ]);
    expect(days[0].schedule.map(item => item.activity)).toEqual(['\uCE90\uC2AC\uB809\uC2A4CC 18H \uB77C\uC6B4\uB529']);
  });

  it('removes customer-invisible price condition and X-only schedule fragments', () => {
    const result = repairPolicyLeakInItinerarySchedule({
      days: [
        {
          day: 3,
          schedule: [
            { activity: '\uC120\uD3EC\uD568\uC2DC 1\uC778 5\uB9CC\uC6D0 (\uC2A4\uB178\uD074\uB9C1 \uC7A5\uBE44, \uAD6C\uBA85\uC870\uB07C\uB80C\uD0C8\uD53C \uD3EC\uD568)' },
            { activity: '\uC138\uBD80 \uD638\uD154 \uD734\uC2DD \uBC0F \uC790\uC720\uC2DC\uAC04' },
            { activity: 'X' },
          ],
        },
      ],
    });

    const days = (result.itineraryData as { days: Array<{ schedule: Array<{ activity: string }> }> }).days;
    expect(result.repaired).toBe(true);
    expect(result.removed).toHaveLength(2);
    expect(days[0].schedule.map(item => item.activity)).toEqual(['\uC138\uBD80 \uD638\uD154 \uD734\uC2DD \uBC0F \uC790\uC720\uC2DC\uAC04']);
  });
});

describe('repairNonLodgingHotelNamesInItinerary', () => {
  it('replaces same-as-above and facility text hotel fields with the previous real hotel', () => {
    const result = repairNonLodgingHotelNamesInItinerary({
      days: [
        { day: 1, hotel: { name: '\uBB34\uC5C9\uD0C4 \uB7ED\uC154\uB9AC (4\uC131)' }, schedule: [] },
        { day: 2, hotel: { name: '\uC624\uC804 \uD638\uD154 \uBD80\uB300\uC2DC\uC124 \uC774\uC6A9' }, schedule: [] },
        { day: 3, hotel: { name: '\uC0C1 \uB3D9' }, schedule: [] },
      ],
    });

    const days = (result.itineraryData as { days: Array<{ hotel: { name: string } | null }> }).days;
    expect(result.repaired).toBe(true);
    expect(days.map(day => day.hotel?.name ?? null)).toEqual([
      '\uBB34\uC5C9\uD0C4 \uB7ED\uC154\uB9AC (4\uC131)',
      '\uBB34\uC5C9\uD0C4 \uB7ED\uC154\uB9AC (4\uC131)',
      '\uBB34\uC5C9\uD0C4 \uB7ED\uC154\uB9AC (4\uC131)',
    ]);
  });
});

describe('repairOptionalTourScheduleDuplicates', () => {
  it('repairs customer-visible copy across itinerary, inclusions, and optional tours', () => {
    const result = repairCustomerVisibleCopyPayload({
      itinerary_data: {
        highlights: {
          inclusions: ['\uD2B9\uC2DD \u2013 \uBC14\uB098\uC0B0 \uC815\uC0B0 \uB808\uC2A4\uD1A0\uB791\uC5D0\uC11C \uC800\uB141\uC2DD\uC0AC(\uB9E5\uC8FCOR\uC74C\uB8CC 1\uC794)'],
        },
        evidence: { quote: '\uBC14\uB098\uC0B0 \uC815\uC0B0 \uC6D0\uBB38 \uADFC\uAC70' },
      },
      inclusions: ['\uD2B9\uC2DD \u2013 \uBC14\uB098\uC0B0 \uC815\uC0B0 \uB808\uC2A4\uD1A0\uB791\uC5D0\uC11C \uC800\uB141\uC2DD\uC0AC(\uB9E5\uC8FCOR\uC74C\uB8CC 1\uC794)'],
      excludes: [],
      optional_tours: [{ name: '\uD2B9\uC2DD \u2013 \uBC14\uB098\uC0B0 \uC815\uC0B0 \uB808\uC2A4\uD1A0\uB791\uC5D0\uC11C \uC800\uB141\uC2DD\uC0AC(\uB9E5\uC8FCOR\uC74C\uB8CC 1\uC794)' }],
      customer_notes: null,
      notices_parsed: null,
      hero_tagline: null,
    });

    expect(result.repaired).toBe(true);
    expect(result.updates.inclusions).toEqual([
      '\uD2B9\uC2DD \u2013 \uBC14\uB098\uC0B0 \uC815\uC0C1 \uB808\uC2A4\uD1A0\uB791\uC5D0\uC11C \uC800\uB141\uC2DD\uC0AC(\uB9E5\uC8FC \uB610\uB294 \uC74C\uB8CC 1\uC794)',
    ]);
    expect(result.updates.optional_tours).toEqual([]);
    expect(JSON.stringify(result.updates.itinerary_data)).toContain('\uBC14\uB098\uC0B0 \uC815\uC0C1');
    expect(JSON.stringify(result.updates.itinerary_data)).toContain('\uBC14\uB098\uC0B0 \uC815\uC0B0 \uC6D0\uBB38 \uADFC\uAC70');
  });

  it('normalizes supplier optional-tour labels and removes shopping entries from customer options', () => {
    const result = repairOptionalToursForCustomerDisplay([
      { name: '\uC1FC\uD551 3\uD68C', region: '\uD544\uB9AC\uD540' },
      { name: '\uCD94\uCC9C\uC120\uD0DD\uAD00\uAD11 : \uCCB4\uD5D8\uB2E4\uC774\uBE59', price: '$$120/\uC778' },
      { name: '\uCD94\uCC9C\uC120\uD0DD\uAD00\uAD11 : \uC544\uC77C\uB79C\uB4DC \uD638\uD551\uD22C\uC5B4', price: '$$80/\uC778' },
      { name: '\uD544\uB9AC\uD540 \uAE30\uB150\uD488 \uBC0F \uD1A0\uC0B0\uD488 \uAD00\uAD11 (\uC1FC\uD551 3\uD68C)', region: '\uD544\uB9AC\uD540' },
    ]);

    const tours = result.optionalTours as Array<{ name: string; price?: string }>;
    expect(result.repaired).toBe(true);
    expect(result.removed).toHaveLength(2);
    expect(tours).toEqual([
      { name: '\uCCB4\uD5D8\uB2E4\uC774\uBE59', price: '$120/\uC778' },
      { name: '\uC544\uC77C\uB79C\uB4DC \uD638\uD551\uD22C\uC5B4', price: '$80/\uC778' },
    ]);
  });

  it('keeps optional tours in the optional_tours section and removes duplicate schedule rows', () => {
    const result = repairOptionalTourScheduleDuplicates(
      {
        days: [
          {
            day: 2,
            schedule: [
              { type: 'normal', entity_kind: 'attraction_visit', activity: '\uAFB8\uB530 \uD574\uBCC0 \uC790\uC720\uC2DC\uAC04' },
              { type: 'normal', entity_kind: 'optional_tour', activity: '\uCD94\uCC9C \uC120\uD0DD\uAD00\uAD11: \uC9D0\uBC14\uB780 \uC528\uD478\uB4DC($50)' },
              { type: 'normal', activity: '\uC120\uD0DD\uAD00\uAD11 \uC2E0\uCCAD \uD6C4 \uBC1C\uB9AC \uC990\uAE30\uAE30' },
            ],
          },
        ],
      },
      [{ name: '\uC9D0\uBC14\uB780 \uC528\uD478\uB4DC', price_usd: 50 }],
    );

    const schedule = (result.itineraryData as { days: Array<{ schedule: Array<{ activity: string }> }> }).days[0].schedule;
    expect(result.repaired).toBe(true);
    expect(result.removed).toHaveLength(2);
    expect(schedule.map(item => item.activity)).toEqual(['\uAFB8\uB530 \uD574\uBCC0 \uC790\uC720\uC2DC\uAC04']);
  });
});

describe('repairSupplierNoticeTerms', () => {
  it('rewrites supplier-facing notice terms into customer-facing wording', () => {
    const result = repairSupplierNoticeTerms([
      {
        type: 'POLICY',
        title: '\uD604\uC9C0 \uADDC\uC815 \uBC0F \uC774\uC6A9 \uC548\uB0B4',
        text: '\u2022 \uD638\uD154 \uB8F8\uBC30\uC815(\uD2B8\uC708OR\uB354\uBE14\uBCA0\uB4DC+\uC5D1\uC2A4\uD2B8\uB77C\uBCA0\uB4DC)\uC740 \uAC1C\uB7F0\uD2F0 \uBD88\uAC00\uD569\uB2C8\uB2E4.\n\u2022 3\uC778\uC2E4 \uAC00\uB2A5\uC5EC\uBD80\uB294 \uCD9C\uBC1C 5~7\uC77C \uC804\uCBE4 \uD638\uD154 \uCEE8\uD38C \uD655\uC778 \uAC00\uB2A5\uD569\uB2C8\uB2E4. \uBD88\uAC00\uC2DC \uC2F1\uAE00\uCC28\uC9C0 \uBC1C\uC0DD\uB429\uB2C8\uB2E4.',
      },
    ]);

    const notices = result.noticesParsed as Array<{ text: string }>;
    expect(result.repaired).toBe(true);
    expect(notices[0].text).toContain('\uAC1D\uC2E4 \uBC30\uC815');
    expect(notices[0].text).toContain('\uBCF4\uC7A5');
    expect(notices[0].text).toContain('\uD655\uC815');
    expect(notices[0].text).not.toContain('\uAC1C\uB7F0\uD2F0');
    expect(notices[0].text).not.toContain('\uCEE8\uD38C');
  });
});

describe('repairProductTitleScheduleNoise', () => {
  it('removes synthetic product-title rows from itinerary schedules', () => {
    const result = repairProductTitleScheduleNoise(
      {
        days: [
          {
            day: 6,
            schedule: [
              {
                activity: '[\uB178\uB178\uB178] \uC11C\uC548(\uBCD1\uB9C8\uC6A9,\uD654\uCCAD\uC9C0),\uD654\uC0B0 4\uBC15 6\uC77C',
                entity_kind: 'attraction_visit',
                attraction_names: ['\uBCD1\uB9C8\uC6A9', '\uD654\uCCAD\uC9C0', '\uD654\uC0B0'],
              },
              {
                activity: '\uBD80\uC0B0 \uAE40\uD574\uAD6D\uC81C\uACF5\uD56D \uB3C4\uCC29',
                entity_kind: 'flight',
                attraction_names: [],
              },
            ],
          },
        ],
      },
      '\uB178\uB178\uB178] \uC11C\uC548(\uBCD1\uB9C8\uC6A9,\uD654\uCCAD\uC9C0),\uD654\uC0B0 4\uBC15 6\uC77C',
    );

    const schedule = (result.itineraryData as { days: Array<{ schedule: Array<{ activity: string }> }> }).days[0].schedule;
    expect(result.repaired).toBe(true);
    expect(result.removed).toHaveLength(1);
    expect(schedule.map(item => item.activity)).toEqual(['\uBD80\uC0B0 \uAE40\uD574\uAD6D\uC81C\uACF5\uD56D \uB3C4\uCC29']);
  });
});

describe('reconcileV3DraftWithLiveEntityQueueClear', () => {
  it('turns stale entity gate failures into ready_to_publish when the live queue is clear', () => {
    const result = reconcileV3DraftWithLiveEntityQueueClear({
      gateResult: {
        status: 'needs_review',
        customer_publishable: false,
        checks: [
          { id: 'attraction_unmatched_queue_clear', status: 'fail', severity: 'high', message: '1 unmatched attraction events require review' },
          { id: 'option_review_queue_clear', status: 'warn', severity: 'info', message: '3 option events require review' },
        ],
      },
      matchSummary: {
        attraction_unmatched_count: 1,
        option_review_count: 3,
        unmatched: [{ raw_text: '공강지공원', day_number: 4 }],
        entity_summary: {
          attraction_unresolved_count: 1,
          shopping_review_needed_count: 0,
          option_review_needed_count: 0,
          unknown_customer_visible_count: 0,
        },
      },
    });

    expect(result.changed).toBe(true);
    expect((result.gateResult as { status?: string }).status).toBe('ready_to_publish');
    expect((result.gateResult as { customer_publishable?: boolean }).customer_publishable).toBe(true);
    expect((result.matchSummary as { attraction_unmatched_count?: number }).attraction_unmatched_count).toBe(0);
    expect((result.matchSummary as { unmatched?: unknown[] }).unmatched).toEqual([]);
  });

  it('does not reconcile non-entity critical failures', () => {
    const result = reconcileV3DraftWithLiveEntityQueueClear({
      gateResult: {
        status: 'blocked',
        customer_publishable: false,
        checks: [
          { id: 'v1.high_risk_structured_fact_values', status: 'fail', severity: 'critical', message: 'missing values' },
          { id: 'attraction_unmatched_queue_clear', status: 'fail', severity: 'high', message: '1 unmatched attraction events require review' },
        ],
      },
      matchSummary: { attraction_unmatched_count: 1, unmatched: [] },
    });

    expect(result.changed).toBe(false);
  });
});

describe('repairMojibakeAttractionNamesInItinerary', () => {
  it('repairs mojibake attraction names only when the activity contains a clear source-backed name', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          schedule: [
            {
              activity: '베트남에서 가장 유명한 다딴라 폭포 (레일바이크 탑승)',
              attraction_names: ['????? ?????'],
            },
            {
              activity: '달랏에서 가장 큰 사원인 죽림사 (케이블카)',
              attraction_names: ['죽림사'],
            },
          ],
        },
      ],
    };

    const result = repairMojibakeAttractionNamesInItinerary(itinerary);

    expect(result.repaired).toBe(true);
    expect(result.replacements).toEqual([
      {
        before: '????? ?????',
        after: '다딴라 폭포',
        activity: '베트남에서 가장 유명한 다딴라 폭포 (레일바이크 탑승)',
      },
    ]);
    expect((result.itineraryData as typeof itinerary).days[0].schedule[0].attraction_names).toEqual(['다딴라 폭포']);
    expect((result.itineraryData as typeof itinerary).days[0].schedule[1].attraction_names).toEqual(['죽림사']);
  });

  it('does not invent a replacement when the activity lacks a clear attraction phrase', () => {
    const itinerary = {
      days: [
        {
          day: 2,
          schedule: [
            {
              activity: '현지 사정에 따라 일정이 변경될 수 있습니다.',
              attraction_names: ['????'],
            },
          ],
        },
      ],
    };

    const result = repairMojibakeAttractionNamesInItinerary(itinerary);

    expect(result.repaired).toBe(false);
    expect(result.itineraryData).toBe(itinerary);
  });

  it('uses source-backed attraction_query when the visible activity is descriptive', () => {
    const itinerary = {
      days: [
        {
          day: 2,
          schedule: [
            {
              activity: '\uBABD\uD658\uC801\uC778 \uD48D\uACBD\uC758 \uAE34\uB9B0\uD638\uC218',
              attraction_query: '\uAE34\uB9B0 \uD638\uC218',
              attraction_names: ['????'],
            },
          ],
        },
      ],
    };

    const result = repairMojibakeAttractionNamesInItinerary(itinerary);

    expect(result.repaired).toBe(true);
    expect((result.itineraryData as typeof itinerary).days[0].schedule[0].attraction_names).toEqual(['\uAE34\uB9B0 \uD638\uC218']);
  });

  it('normalizes Datanla Falls mojibake names without keeping ride/action words', () => {
    const itinerary = {
      days: [
        {
          day: 3,
          schedule: [
            {
              activity: '\uBCA0\uD2B8\uB0A8\uC5D0\uC11C \uAC00\uC7A5 \uC720\uBA85\uD55C \uB2E4\uB534\uB780 \uD3ED\uD3EC \uB808\uC77C\uBC14\uC774\uD06C \uD0D1\uC2B9',
              attraction_names: ['????? ?????'],
            },
          ],
        },
      ],
    };

    const result = repairMojibakeAttractionNamesInItinerary(itinerary);

    expect(result.repaired).toBe(true);
    expect((result.itineraryData as typeof itinerary).days[0].schedule[0].attraction_names).toEqual(['\uB2E4\uB534\uB77C \uD3ED\uD3EC']);
  });

  it('repairs cable-car mojibake names from activity context', () => {
    const itinerary = {
      days: [
        {
          day: 2,
          schedule: [
            {
              activity: '\uC138\uACC4\uC5D0\uC11C \uB450 \uBC88\uC9F8\uB85C \uAE34 \uC57D 8KM\uC758 \uD574\uC0C1\uCF00\uC774\uBE14\uCE74 \uC655\uBCF5 \uD2F0\uCF13 \uD3EC\uD568',
              attraction_names: ['??? ?? ????'],
            },
          ],
        },
      ],
    };

    const result = repairMojibakeAttractionNamesInItinerary(itinerary);

    expect(result.repaired).toBe(true);
    expect((result.itineraryData as typeof itinerary).days[0].schedule[0].attraction_names).toEqual(['\uD63C\uB610\uC12C \uD574\uC0C1 \uCF00\uC774\uBE14\uCE74']);
  });

  it('repairs Linh Ung/Yeongheungsa mojibake names from sea Guanyin context', () => {
    const itinerary = {
      days: [
        {
          day: 4,
          schedule: [
            {
              activity: '\uBCA0\uD2B8\uB0A8 \uCD5C\uB300 \uD574\uC218\uAD00\uC74C\uC0C1\uC774 \uC788\uB294 \uC601\uD765\uC0AC',
              attraction_names: ['??? ????'],
            },
          ],
        },
      ],
    };

    const result = repairMojibakeAttractionNamesInItinerary(itinerary);

    expect(result.repaired).toBe(true);
    expect((result.itineraryData as typeof itinerary).days[0].schedule[0].attraction_names).toEqual(['\uC601\uD765\uC0AC']);
  });
});

describe('repairOvernightArrivalDaySplit', () => {
  it('moves next-morning arrival into a new final itinerary day when duration expects one more day', () => {
    const result = repairOvernightArrivalDaySplit(
      {
        days: [
          { day: 1, schedule: [] },
          { day: 2, schedule: [] },
          { day: 3, schedule: [] },
          {
            day: 4,
            schedule: [
              { type: 'normal', activity: '\uACF5\uD56D\uC73C\uB85C \uAC1C\uBCC4\uC774\uB3D9' },
              { type: 'flight', time: '23:10', activity: '\uD478\uAFB8\uC625 \uAD6D\uC81C \uACF5\uD56D \uCD9C\uBC1C' },
              { type: 'flight', time: '06:40', activity: '\uBD80\uC0B0 \uAE40\uD574\uAD6D\uC81C\uACF5\uD56D \uB3C4\uCC29' },
            ],
          },
        ],
      },
      5,
    );

    const days = (result.itineraryData as { days: Array<{ schedule: Array<{ activity: string }> }> }).days;
    expect(result.repaired).toBe(true);
    expect(days).toHaveLength(5);
    expect(days[3].schedule.map(item => item.activity)).toEqual([
      '\uACF5\uD56D\uC73C\uB85C \uAC1C\uBCC4\uC774\uB3D9',
      '\uD478\uAFB8\uC625 \uAD6D\uC81C \uACF5\uD56D \uCD9C\uBC1C',
    ]);
    expect(days[4].schedule.map(item => item.activity)).toEqual(['\uBD80\uC0B0 \uAE40\uD574\uAD6D\uC81C\uACF5\uD56D \uB3C4\uCC29']);
  });
});

describe('repairDurationToSavedItineraryDays', () => {
  it('aligns mixed-night price-table packages to the saved customer itinerary day count', () => {
    const result = repairDurationToSavedItineraryDays({
      duration: 6,
      title: '\uC694\uAE08\uD45C] \uBCF4\uD640 \uD5E4\uB09C 3\uBC15/4\uBC15',
      display_title: null,
      raw_text: 'PKG [7C \uBD80\uC0B0-\uBCF4\uD640] \uD5E4\uB09C\uB9AC\uC870\uD2B8 \uC138\uBBF8\uD329 3\uBC15/4\uBC15',
      itinerary_data: { days: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }] },
    });

    expect(result).toEqual({
      duration: 5,
      repaired: true,
      reason: 'mixed_night_price_table_uses_saved_itinerary_day_count',
    });
  });

  it('does not mask larger duration mismatches without a narrow mixed-night cue', () => {
    const result = repairDurationToSavedItineraryDays({
      duration: 7,
      title: '\uB2E8\uC77C \uD328\uD0A4\uC9C0',
      display_title: null,
      raw_text: '\uC77C\uC815\uD45C',
      itinerary_data: { days: [{ day: 1 }, { day: 2 }, { day: 3 }] },
    });

    expect(result.repaired).toBe(false);
    expect(result.duration).toBe(7);
  });
});

describe('repairEmptyItineraryDaySchedules', () => {
  it('fills empty customer itinerary days with a safe free-time sentence', () => {
    const result = repairEmptyItineraryDaySchedules({
      destination: '\uBCF4\uD640',
      itineraryData: {
        days: [
          { day: 1, regions: ['\uBCF4\uD640'], hotel: { name: '\uD5E4\uB09C \uB9AC\uC870\uD2B8' }, schedule: [{ activity: '\uACF5\uD56D \uB3C4\uCC29' }] },
          { day: 2, regions: ['\uBCF4\uD640'], hotel: { name: '\uD5E4\uB09C \uB9AC\uC870\uD2B8' }, schedule: [] },
        ],
      },
    });

    const days = (result.itineraryData as { days: Array<{ schedule: Array<{ activity: string; type: string; entity_kind: string }> }> }).days;
    expect(result.repaired).toBe(true);
    expect(result.filledDays).toEqual([2]);
    expect(days[1].schedule).toEqual([
      expect.objectContaining({
        activity: '\uBCF4\uD640 \uD638\uD154 \uD734\uC2DD \uBC0F \uC790\uC720\uC2DC\uAC04',
        type: 'free_time',
        entity_kind: 'free_time',
      }),
    ]);
  });
});

describe('buildPackageDerivedV3Result', () => {
  it('rebuilds a ready V3 ledger from saved customer-visible package structure', () => {
    const base = {
      raw_text_hash: 'raw',
      source_index: [],
      structure_plan: {
        document_type: 'catalog',
        planner_source: 'deterministic',
        expected_products: 1,
        shared_sections: [],
        product_boundaries: [{ index: 0, line_start: 1, line_end: 1, title_hint: 'catalog header' }],
        variant_axes: [],
        price_table_location: null,
        price_mapping_strategy: 'single_table',
        flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
        itinerary_boundary_pattern: null,
        option_section_locations: [{ line_start: 10, line_end: 12, label: 'optional' }],
        shopping_section_locations: [{ line_start: 13, line_end: 14, label: 'shopping' }],
        confidence: 0.4,
        unresolved_parts: [],
      },
      ledger: {
        document: { type: 'catalog', expected_products: 1, variant_axes: [] },
        variants: [{
          variant_key: 'v1',
          grade: null,
          course: 'catalog header',
          duration_days: 4,
          nights: 3,
          title_parts: ['catalog header'],
          price_calendar: [],
          flight_segments: [],
          days: [],
          inclusions: [],
          exclusions: [],
          options: [],
          shopping: [],
          structured_facts: [],
          standard_notices: [],
          minimum_departure: null,
          evidence_coverage: {
            price: false,
            flight: false,
            itinerary: false,
            minimum_departure: false,
            inclusions: false,
            exclusions: false,
            meals: false,
            hotel: false,
            options: false,
            shopping: false,
          },
        }],
      },
      match_summary: {
        attraction_matched_count: 0,
        attraction_unmatched_count: 0,
        option_review_count: 0,
        shopping_count: 0,
        unmatched: [],
        entity_summary: {
          counts: {},
          review_required_count: 0,
          attraction_unresolved_count: 0,
          shopping_review_needed_count: 0,
          option_review_needed_count: 0,
          unknown_customer_visible_count: 0,
          review_items: [],
        },
      },
      gate_result: { status: 'blocked', customer_publishable: false, checks: [] },
      render_contract_preview: [],
    } as never;

    const result = buildPackageDerivedV3Result({
      base,
      attractions: [],
      pkg: {
        id: 'pkg-1',
        title: '부산출발 장가계 3박4일',
        internal_code: 'PUS-ETC-DYG-04-TEST',
        destination: '장가계',
        status: 'pending_review',
        audit_status: 'blocked',
        audit_report: null,
        updated_at: null,
        raw_text: 'catalog header only',
        airline: 'BX',
        duration: 4,
        nights: 3,
        min_participants: 4,
        price: 799000,
        display_title: null,
        hero_tagline: null,
        trip_style: null,
        itinerary_data: {
          flight_segments: [
            { leg: 'unknown', flight_no: 'BX999', dep_time: '15:00', arr_time: '17:00' },
          ],
          days: [
            {
              day: 1,
              schedule: [
                { type: 'flight', time: '09:00', transport: 'BX371', activity: '부산 김해국제공항 출발' },
                { type: 'flight', time: '11:20', transport: 'BX371', activity: '장가계 국제공항 도착' },
                { type: 'normal', entity_kind: 'transfer', activity: '가이드 미팅 후 호텔 이동' },
              ],
              meals: { breakfast: false, lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '호텔식' },
              hotel: { name: '풀만호텔 또는 동급' },
            },
            {
              day: 2,
              schedule: [{ type: 'normal', entity_kind: 'transfer', activity: '전용차량으로 관광지 이동' }],
              meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '현지식' },
              hotel: { name: '풀만호텔 또는 동급' },
            },
            {
              day: 3,
              schedule: [{ type: 'normal', entity_kind: 'transfer', activity: '전용차량 일정 진행' }],
              meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '현지식' },
              hotel: { name: '풀만호텔 또는 동급' },
            },
            {
              day: 4,
              schedule: [
                { type: 'flight', time: '12:20', transport: 'BX372', activity: '장가계 국제공항 출발' },
                { type: 'flight', time: '14:40', transport: 'BX372', activity: '부산 김해국제공항 도착' },
              ],
              meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
              hotel: { name: '기내박 없음' },
            },
          ],
        },
        accommodations: [],
        inclusions: ['왕복항공료', '호텔', '식사', '기사/가이드팁'],
        excludes: ['개인경비', '매너팁'],
        optional_tours: [],
        price_dates: [{ date: '2026-09-01', price: 799000 }],
        price_list: null,
        departure_days: null,
        surcharges: null,
      },
    });

    expect(result).not.toBeNull();
    expect(result?.result.gate_result.status).toBe('ready_to_publish');
    const variant = result!.result.ledger.variants[0];
    expect(variant.days).toHaveLength(4);
    expect(variant.price_calendar).toHaveLength(1);
    expect(variant.flight_segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ leg: 'unknown', code: 'BX999', dep_time: '15:00', arr_time: '17:00' }),
      expect.objectContaining({ leg: 'outbound', code: 'BX371', dep_time: '09:00', arr_time: '11:20' }),
      expect.objectContaining({ leg: 'inbound', code: 'BX372', dep_time: '12:20', arr_time: '14:40' }),
    ]));
    expect(variant.standard_notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'optional_tour', template_key: 'optional.none', review_status: 'auto_clean' }),
      expect.objectContaining({ category: 'shopping_visit', review_status: 'auto_clean' }),
    ]));
  });

  it('keeps saved itinerary days that have meals/hotel but no schedule events', () => {
    const base = {
      raw_text_hash: 'raw',
      source_index: [],
      structure_plan: {
        document_type: 'catalog',
        planner_source: 'deterministic',
        expected_products: 1,
        shared_sections: [],
        product_boundaries: [],
        variant_axes: [],
        price_table_location: null,
        price_mapping_strategy: 'single_table',
        flight_pattern: { outbound_codes: [], inbound_codes: [], meeting_times: [] },
        itinerary_boundary_pattern: null,
        option_section_locations: [],
        shopping_section_locations: [],
        confidence: 0.4,
        unresolved_parts: [],
      },
      ledger: {
        document: { type: 'catalog', expected_products: 1, variant_axes: [] },
        variants: [{
          variant_key: 'v1',
          duration_days: 3,
          nights: 2,
          title_parts: ['saved package'],
          price_calendar: [],
          flight_segments: [],
          days: [],
          inclusions: [],
          exclusions: [],
          options: [],
          shopping: [],
          structured_facts: [],
          standard_notices: [],
          minimum_departure: null,
          evidence_coverage: {
            price: false,
            flight: false,
            itinerary: false,
            minimum_departure: false,
            inclusions: false,
            exclusions: false,
            meals: false,
            hotel: false,
            options: false,
            shopping: false,
          },
        }],
      },
      match_summary: {
        attraction_matched_count: 0,
        attraction_unmatched_count: 0,
        option_review_count: 0,
        shopping_count: 0,
        unmatched: [],
        entity_summary: { counts: {}, review_required_count: 0, review_items: [] },
      },
      gate_result: { status: 'blocked', customer_publishable: false, checks: [] },
      render_contract_preview: [],
    } as never;

    const result = buildPackageDerivedV3Result({
      base,
      attractions: [],
      pkg: {
        id: 'pkg-empty-day',
        title: 'Saved customer package',
        internal_code: 'PKG-EMPTY-DAY',
        destination: 'Okinawa',
        status: 'pending',
        audit_status: 'blocked',
        audit_report: null,
        updated_at: null,
        raw_text: 'saved package\nBX002\n12:00\n14:00\nInbound departure\nInbound arrival',
        airline: 'BX',
        duration: 3,
        nights: 2,
        min_participants: 2,
        price: 500000,
        display_title: null,
        hero_tagline: null,
        trip_style: '2 nights 3 days',
        itinerary_data: {
          days: [
            {
              day: 1,
              schedule: [
                { type: 'flight', time: '09:00', transport: 'BX001', activity: 'Outbound departure' },
                { type: 'flight', time: '11:00', transport: 'BX001', activity: 'Outbound arrival' },
              ],
              meals: { lunch: true, lunch_note: 'local meal', dinner: true, dinner_note: 'hotel dinner' },
              hotel: { name: 'Sample Resort' },
            },
            {
              day: 2,
              schedule: [],
              meals: { breakfast: true, breakfast_note: 'hotel breakfast', lunch: true, lunch_note: 'local meal', dinner: true, dinner_note: 'hotel dinner' },
              hotel: { name: 'Sample Resort' },
            },
            {
              day: 3,
              schedule: [
                { type: 'flight', time: '12:00', transport: 'BX002', activity: 'Inbound departure' },
                { type: 'flight', time: null, transport: 'BX002', activity: 'Inbound arrival' },
              ],
              meals: { breakfast: true, breakfast_note: 'hotel breakfast' },
              hotel: { name: 'No overnight stay' },
            },
          ],
        },
        accommodations: [],
        inclusions: ['flight', 'hotel', 'meals'],
        excludes: ['personal expenses'],
        optional_tours: [],
        price_dates: [{ date: '2026-09-01', price: 500000 }],
        price_list: null,
        departure_days: null,
        surcharges: null,
      },
    });

    expect(result).not.toBeNull();
    expect(result?.result.gate_result.status).toBe('ready_to_publish');
    expect(result?.result.ledger.variants[0].days.map(day => day.day)).toEqual([1, 2, 3]);
    expect(result?.result.ledger.variants[0].days[1].events).toEqual([]);
    expect(result?.result.ledger.variants[0].days[1].hotel).toEqual({ name: 'Sample Resort' });
  });
});
