import { describe, expect, it } from 'vitest';

import { buildRepairFirstOpenabilitySummary } from './repair-first-openability';
import {
  classifyUploadToOpenReviewReason,
  patchV3WithPackageBackedEvidence,
  sanitizeCustomerOptionalTours,
  shouldAutoApplySourceBackedPriceRepair,
} from './upload-to-open-autopilot';
import type { V3PipelineResult } from '@/lib/product-registration-v3';

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

describe('shouldAutoApplySourceBackedPriceRepair', () => {
  it('auto-applies deterministic shared price-table repairs when C12 stays clean', () => {
    expect(shouldAutoApplySourceBackedPriceRepair({
      status: 'repaired',
      reason: 'replaced split section price_dates from shared table',
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

  it('keeps source repairs in review when the deterministic price check still fails', () => {
    expect(shouldAutoApplySourceBackedPriceRepair({
      status: 'repaired',
      reason: 'source table extracted rows but dependent stores are still inconsistent',
      source: 'pdf_date_price_table',
      expectedCount: 1,
      existingCount: 13,
      addedCount: 0,
      priceDates: [{ date: '2026-08-14', price: 1749000, confirmed: false }],
    }, true)).toBe(false);
  });

  it('does not auto-apply repairs that shrink a multi-date calendar to a smaller partial table', () => {
    expect(shouldAutoApplySourceBackedPriceRepair({
      status: 'repaired',
      reason: 'partial exception table detected after shared evidence append',
      source: 'pdf_date_price_table',
      expectedCount: 3,
      existingCount: 13,
      addedCount: 0,
      priceDates: [
        { date: '2026-07-17', price: 1699000, confirmed: false },
        { date: '2026-08-07', price: 1599000, confirmed: false },
        { date: '2026-08-14', price: 1749000, confirmed: false },
      ],
    }, false)).toBe(false);
  });

  it('does not auto-apply unavailable or unrecognized source repairs', () => {
    expect(shouldAutoApplySourceBackedPriceRepair({
      status: 'unavailable',
      reason: 'source deterministic price table not recognized',
      source: 'none',
      expectedCount: 0,
      existingCount: 1,
      addedCount: 0,
    }, false)).toBe(false);
  });
});

describe('patchV3WithPackageBackedEvidence', () => {
  it('uses persisted package evidence to repair missing V3 minimum departure, terms, days, meals, and hotel', () => {
    const evidence = {
      line_start: 1,
      line_end: 1,
      char_start: 0,
      char_end: 10,
      quote: 'BX 1234',
    };
    const v3: V3PipelineResult = {
      raw_text_hash: 'hash',
      source_index: [],
      structure_plan: {
        document_type: 'single_package',
        planner_source: 'deterministic',
        expected_products: 1,
        shared_sections: [],
        product_boundaries: [{ index: 0, line_start: 1, line_end: 10, title_hint: '테스트 상품' }],
        variant_axes: [],
        price_table_location: null,
        price_mapping_strategy: 'none',
        flight_pattern: {
          outbound_codes: [],
          inbound_codes: [],
          meeting_times: [],
        },
        itinerary_boundary_pattern: null,
        option_section_locations: [],
        shopping_section_locations: [],
        confidence: 1,
        unresolved_parts: [],
      },
      ledger: {
        document: {
          type: 'single_package',
          expected_products: 1,
          variant_axes: [],
        },
        variants: [{
          variant_key: 'v1',
          grade: null,
          course: '테스트 상품',
          duration_days: 3,
          nights: 2,
          title_parts: ['테스트 상품'],
          price_calendar: [],
          flight_segments: [{
            leg: 'outbound',
            code: 'BX1234',
            dep_time: '08:00',
            arr_time: '10:00',
            evidence,
          }, {
            leg: 'inbound',
            code: 'BX4321',
            dep_time: '20:00',
            arr_time: '22:00',
            evidence,
          }],
          days: [],
          inclusions: [],
          exclusions: [],
          options: [],
          shopping: [],
          structured_facts: [],
          standard_notices: [],
          minimum_departure: null,
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
          counts: {
            attraction: 0,
            hotel: 0,
            meal: 0,
            transfer: 0,
            shopping: 0,
            optional_tour: 0,
            free_time: 0,
            notice: 0,
            price_noise: 0,
            unknown: 0,
          },
          review_required_count: 0,
          attraction_unresolved_count: 0,
          shopping_review_needed_count: 0,
          option_review_needed_count: 0,
          unknown_customer_visible_count: 0,
          auto_ignored_noise_count: 0,
          meal_structured_count: 0,
          transfer_structured_count: 0,
          hotel_structured_count: 0,
          free_time_structured_count: 0,
          review_items: [],
        },
      },
      gate_result: {
        status: 'blocked',
        customer_publishable: false,
        checks: [],
      },
      render_contract_preview: [],
    };

    const changed = patchV3WithPackageBackedEvidence(v3, {
      min_participants: 8,
      inclusions: ['왕복항공권', '호텔'],
      excludes: ['개인경비'],
      itinerary_data: {
        days: [{
          day: 1,
          regions: ['다낭'],
          meals: {
            breakfast: true,
            breakfast_note: '기내식',
            lunch: true,
            lunch_note: '현지식',
            dinner: '호텔식',
          },
          hotel: { name: '다낭 시내 호텔' },
        }],
      },
    });

    const variant = v3.ledger.variants[0];
    expect(changed).toBe(true);
    expect(variant.minimum_departure?.value).toBe(8);
    expect(variant.inclusions).toHaveLength(2);
    expect(variant.exclusions).toHaveLength(1);
    expect(variant.days[0]?.meals.lunch.raw_text).toBe('현지식');
    expect(variant.days[0]?.hotel.raw_text).toBe('다낭 시내 호텔');
    expect(v3.gate_result.checks.find(check => check.id.endsWith('.minimum_departure'))?.status).toBe('pass');
    expect(v3.gate_result.checks.find(check => check.id.endsWith('.meals_or_notice'))?.status).toBe('pass');
    expect(v3.gate_result.checks.find(check => check.id.endsWith('.hotel_or_notice'))?.status).toBe('pass');
  });
});

describe('sanitizeCustomerOptionalTours', () => {
  it('removes catalog and fee fragments from optional_tours while keeping real paid options', () => {
    const sanitized = sanitizeCustomerOptionalTours([
      { name: '최소출발' },
      { name: '차 량' },
      { name: '포 함 내 역' },
      { name: '싱글비용()', price: '$90/인' },
      { name: '전신 마사지', price: '$30/인' },
    ]);

    expect(sanitized).toEqual([expect.objectContaining({
      name: '전신 마사지',
      price: '$30/인',
      price_usd: 30,
    })]);
  });
});
