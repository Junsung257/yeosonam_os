import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  `${process.cwd()}/supabase/migrations/20260903185516_product_registration_human_review_v1.sql`,
  'utf8',
);

describe('product registration human review migration', () => {
  it('keeps source lineage, two receipts, and the review-completed outbox', () => {
    expect(migration).toContain('product_review_cases');
    expect(migration).toContain('product_review_sessions');
    expect(migration).toContain('product_review_receipts');
    expect(migration).toContain('product_review_events');
    expect(migration).toContain('unique (case_id, reviewer_slot)');
    expect(migration).toContain('unique (case_id, reviewer_id)');
    expect(migration).toContain("policy_version text not null check (policy_version = 'product-registration-v6-review-1')");
    expect(migration).toContain("packet->>'contractVersion' = 'human-review-v1'");
    expect(migration).not.toContain('min(r.reviewer_id)');
    expect(migration).toContain("event_type text not null check (event_type = 'review_completed')");
    expect(migration).toContain("'product-review:' || v_case_id::text || ':' || v_new.id::text");
  });

  it('uses service-role RPCs and denies table access to client roles', () => {
    expect(migration).toContain('alter table internal_product_registration.product_review_cases force row level security');
    expect(migration).toContain('alter table internal_product_registration.product_review_receipts force row level security');
    expect(migration).toContain('revoke all on table internal_product_registration.product_review_cases from public, anon, authenticated, service_role');
    expect(migration).toContain('grant execute on function public.submit_product_registration_review_receipt(jsonb) to service_role');
    expect(migration).not.toContain('grant select on table internal_product_registration.product_review_receipts to anon');
  });

  it('fails closed on lineage mismatch and keeps review history immutable', () => {
    expect(migration).toContain('PRODUCT_REVIEW_CASE_PACKET_LINEAGE_MISMATCH');
    expect(migration).toContain('PRODUCT_REVIEW_RECEIPT_LINEAGE_MISMATCH');
    expect(migration).toContain('PRODUCT_REVIEW_CASE_NOT_REVIEWABLE');
    expect(migration).toContain('PRODUCT_REVIEW_SLOT_IN_PROGRESS');
    expect(migration).toContain('PRODUCT_REGISTRATION_REVIEW_HISTORY_IMMUTABLE');
    expect(migration).toContain('completed_at = case when v_next_status');
  });
});
