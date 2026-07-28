import { describe, expect, it } from 'vitest';
import {
  buildBlogProductEvidenceArchivedProductDecision,
  buildBlogProductEvidenceDuplicateMeta,
  buildBlogProductEvidenceRecheckDecision,
  buildBlogProductEvidenceRecheckGuidance,
  readBlogProductEvidenceDedupKey,
} from './blog-product-evidence-recheck';

describe('blog product evidence recheck', () => {
  it('clears product open-contract quarantine when the package now passes', () => {
    const decision = buildBlogProductEvidenceRecheckDecision({
      checkedAt: '2026-07-01T00:00:00.000Z',
      contractOk: true,
      meta: {
        failure_code: 'product_open_contract',
        quarantine_reason: 'product_open_contract',
        self_heal_blocked: true,
        product_open_contract_blockers: ['mobile_proof:stale'],
        keep_me: 'yes',
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.last_error).toBeNull();
    expect(decision.meta).toMatchObject({
      keep_me: 'yes',
      product_open_contract_recheck_result: 'pass',
      requeued_by: 'blog-product-evidence-recheck',
    });
    expect(decision.meta).not.toHaveProperty('failure_code');
    expect(decision.meta).not.toHaveProperty('quarantine_reason');
    expect(decision.meta).not.toHaveProperty('self_heal_blocked');
  });

  it('keeps blocked rows blocked with current blockers', () => {
    const decision = buildBlogProductEvidenceRecheckDecision({
      checkedAt: '2026-07-01T00:00:00.000Z',
      contractOk: false,
      blockers: ['mobile_proof:stale', 'quality_scorecard:packages_mobile'],
      meta: { previous: true },
    });

    expect(decision).toMatchObject({
      action: 'keep_blocked',
      last_error: 'product_customer_open_contract_failed:mobile_proof:stale|quality_scorecard:packages_mobile',
      meta: {
        previous: true,
        failure_code: 'product_open_contract',
        quarantine_reason: 'product_open_contract',
        self_heal_blocked: true,
        product_open_contract_blockers: ['mobile_proof:stale', 'quality_scorecard:packages_mobile'],
        product_open_contract_recheck_result: 'blocked',
      },
    });
  });

  it('defers unapproved products until their customer-visible status changes', () => {
    const decision = buildBlogProductEvidenceRecheckDecision({
      checkedAt: '2026-07-29T00:00:00.000Z',
      contractOk: false,
      productStatus: 'pending_review',
      blockers: ['product_status_not_customer_visible:pending_review'],
      meta: { previous: true },
    });

    expect(decision).toMatchObject({
      action: 'defer_unapproved_product',
      last_error: 'product_open_contract_deferred:pending_review',
      meta: {
        previous: true,
        failure_code: 'product_open_contract',
        quarantine_reason: 'product_approval_pending',
        self_heal_blocked: true,
        product_open_contract_recheck_result: 'deferred_unapproved_product',
        product_approval_pending_status: 'pending_review',
      },
    });
  });

  it('uses the product dedup key before falling back to product id', () => {
    expect(readBlogProductEvidenceDedupKey({
      product_id: 'package-id',
      meta: { product_dedup_key: ' Product|2026-09-09|5D ' },
    })).toBe('product|2026-09-09|5d');
    expect(readBlogProductEvidenceDedupKey({
      product_id: 'package-id',
      meta: {},
    })).toBe('package-id');
  });

  it('marks duplicate recheck rows as preclaim quarantined without restoring product blockers', () => {
    const meta = buildBlogProductEvidenceDuplicateMeta({
      checkedAt: '2026-07-01T00:00:00.000Z',
      duplicateKey: 'product::abc',
      duplicateKeepId: 'queued-row',
      meta: {
        failure_code: 'product_open_contract',
        product_open_contract_blockers: ['old'],
      },
    });

    expect(meta).toMatchObject({
      product_open_contract_recheck_result: 'pass',
      duplicate_product_recheck: true,
      quarantine_reason: 'duplicate_preclaim',
      self_heal_blocked: true,
      duplicate_key: 'product::abc',
      duplicate_keep_id: 'queued-row',
    });
    expect(meta).not.toHaveProperty('failure_code');
    expect(meta).not.toHaveProperty('product_open_contract_blockers');
    expect(meta).not.toHaveProperty('requeued_by');
    expect(meta).not.toHaveProperty('requeued_at');
  });

  it('skips archived product rows without restoring product blockers', () => {
    const decision = buildBlogProductEvidenceArchivedProductDecision({
      checkedAt: '2026-07-01T00:00:00.000Z',
      productStatus: 'archived',
      meta: {
        failure_code: 'product_open_contract',
        quarantine_reason: 'product_open_contract',
        product_open_contract_blockers: ['mobile_proof:stale'],
      },
    });

    expect(decision).toMatchObject({
      action: 'skip_archived_product',
      last_error: 'product_open_contract_recheck_archived_product',
      meta: {
        archived_product_recheck: true,
        quarantine_reason: 'archived_product',
        self_heal_blocked: true,
        product_open_contract_recheck_result: 'archived_product',
        product_status: 'archived',
      },
    });
    expect(decision.meta).not.toHaveProperty('failure_code');
    expect(decision.meta).not.toHaveProperty('product_open_contract_blockers');
    expect(decision.meta).not.toHaveProperty('requeued_by');
  });

  it('recommends writes only for recovered or duplicate product rows', () => {
    expect(buildBlogProductEvidenceRecheckGuidance({
      requeue: 1,
      duplicateSkipped: 2,
      archivedSkipped: 1,
      deferredUnapproved: 4,
      keepBlocked: 3,
    })).toEqual({
      write_recommended: true,
      write_reasons: [
        'requeue_recovered_product_rows',
        'skip_duplicate_product_rows',
        'skip_archived_product_rows',
        'defer_unapproved_product_rows',
      ],
      metadata_refresh_available: true,
    });

    expect(buildBlogProductEvidenceRecheckGuidance({
      requeue: 0,
      duplicateSkipped: 0,
      keepBlocked: 3,
    })).toEqual({
      write_recommended: false,
      write_reasons: [],
      metadata_refresh_available: true,
    });
  });
});
