import { describe, expect, it } from 'vitest';

import { buildRepairFirstOpenabilitySummary } from './repair-first-openability';
import { classifyUploadToOpenReviewReason } from './upload-to-open-autopilot';

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
