import { describe, expect, it } from 'vitest';
import {
  evaluateV3CustomerNoticeGate,
  hasSupplierRemarkRawLeakRisk,
  hasUnsafeCustomerNoticeMutation,
  isCustomerSafeNotice,
} from './customer-payload';
import { buildStandardNoticeDraft } from './standard-notices';
import type { LatestV3DraftForPackage } from './customer-payload';

function makeDraft(status: 'ready_to_publish' | 'needs_review' | 'blocked'): LatestV3DraftForPackage {
  const autoNotice = buildStandardNoticeDraft({
    source_text: '?ш텒 留뚮즺?쇱? ?낃뎅??湲곗? 6媛쒖썡 ?댁긽 ?⑥븘 ?덉뼱???⑸땲??',
    category: 'passport_validity',
    values: { months: 6 },
    evidence: [{
      line_start: 1,
      line_end: 1,
      char_start: 0,
      char_end: 31,
      quote: '?ш텒 留뚮즺?쇱? ?낃뎅??湲곗? 6媛쒖썡 ?댁긽 ?⑥븘 ?덉뼱???⑸땲??',
    }],
  });
  const reviewNotice = buildStandardNoticeDraft({
    source_text: '?깃?李⑥? 蹂꾨룄 臾몄쓽',
    category: 'single_room_surcharge',
    values: { amount: null, currency: null },
    evidence: [{
      line_start: 2,
      line_end: 2,
      char_start: 0,
      char_end: 10,
      quote: '?깃?李⑥? 蹂꾨룄 臾몄쓽',
    }],
  });
  return {
    id: `draft-${status}`,
    package_id: 'pkg-1',
    status,
    created_at: '2026-06-02T00:00:00.000Z',
    gate_result: {
      status,
      customer_publishable: status === 'ready_to_publish',
      checks: status === 'ready_to_publish'
        ? []
        : [{ id: 'notice.high_risk_notice_values', status: 'fail', severity: 'high', message: 'missing notice value' }],
    },
    ledger: {
      document: { type: 'single_package', expected_products: 1, variant_axes: [] },
      variants: [{
        variant_key: 'default',
        grade: null,
        course: null,
        duration_days: null,
        nights: null,
        title_parts: [],
        price_calendar: [],
        flight_segments: [],
        days: [],
        inclusions: [],
        exclusions: [],
        options: [],
        shopping: [],
        structured_facts: [],
        standard_notices: [autoNotice!, reviewNotice!],
        minimum_departure: null,
        evidence_coverage: {},
      }],
    },
  };
}

describe('V3 customer payload gate', () => {
  it('blocks customer approval when the latest V3 draft is blocked or needs review', () => {
    expect(evaluateV3CustomerNoticeGate('pkg-1', makeDraft('blocked')).blocksApproval).toBe(true);
    expect(evaluateV3CustomerNoticeGate('pkg-1', makeDraft('needs_review')).blocksApproval).toBe(true);
  });

  it('reports failed V3 evidence checks as missing evidence, not positive pass wording', () => {
    const draft = makeDraft('blocked');
    draft.gate_result = {
      status: 'blocked',
      customer_publishable: false,
      checks: [
        { id: 'default.days', status: 'fail', severity: 'critical', message: 'variant has itinerary days' },
        { id: 'default.minimum_departure', status: 'fail', severity: 'high', message: 'minimum departure evidence exists' },
        { id: 'default.hotel_or_notice', status: 'fail', severity: 'medium', message: 'hotel evidence exists' },
      ],
    };

    const gate = evaluateV3CustomerNoticeGate('pkg-1', draft);

    expect(gate.blocksApproval).toBe(true);
    expect(gate.blockReasons).toEqual([
      'itinerary days missing',
      'minimum departure evidence missing',
      'hotel evidence missing or explicit hotel notice required',
    ]);
    expect(gate.blockReasons.join('\n')).not.toContain('evidence exists');
    expect(gate.blockReasons.join('\n')).not.toContain('variant has');
  });

  it('saves only publishable Yeosonam standard notices to customer fields', () => {
    const gate = evaluateV3CustomerNoticeGate('pkg-1', makeDraft('ready_to_publish'));

    expect(gate.blocksApproval).toBe(false);
    expect(gate.payload?.notices_parsed).toHaveLength(1);
    expect(gate.payload?.notices_parsed[0].template_key).toBe('passport.validity_months');
    expect(gate.payload?.customer_notes).toContain('6');
    expect(gate.payload?.customer_notes).not.toContain('?깃?李⑥? 蹂꾨룄 臾몄쓽');
  });
});
describe('supplier REMARK leak guard', () => {
  it('flags supplier REMARK-like customer text when standard notice metadata is missing', () => {
    expect(hasSupplierRemarkRawLeakRisk({
      notices_parsed: [{ title: 'REMARK', text: '랜드사 안내: 여권 6개월 이상 남아 있어야 합니다.' }],
      customer_notes: '',
    })).toBe(true);

    expect(hasSupplierRemarkRawLeakRisk({
      notices_parsed: [{
        text: '여권 유효기간은 출국일 기준 6개월 이상 남아 있어야 합니다.',
        category: 'passport_validity',
        template_key: 'passport.validity_months',
        review_status: 'auto_clean',
      }],
      customer_notes: '여권 유효기간은 출국일 기준 6개월 이상 남아 있어야 합니다.',
    })).toBe(false);
  });

  it('allows only standard notice metadata for manual customer notice mutations', () => {
    const safeNotice = {
      type: 'CRITICAL',
      title: '주의사항',
      text: '여권 유효기간은 출국일 기준 6개월 이상 남아 있어야 합니다.',
      category: 'passport_validity',
      values: { months: 6 },
      template_key: 'passport.validity_months',
      review_status: 'auto_clean',
      source_line: 12,
    };

    expect(isCustomerSafeNotice(safeNotice)).toBe(true);
    expect(hasUnsafeCustomerNoticeMutation({
      notices_parsed: [safeNotice],
      customer_notes: '여권 유효기간은 출국일 기준 6개월 이상 남아 있어야 합니다.',
    })).toBe(false);

    expect(hasUnsafeCustomerNoticeMutation({
      notices_parsed: [{ title: 'REMARK', text: '랜드사 REMARK: 싱글차지 별도 문의' }],
    })).toBe(true);
  });
});
