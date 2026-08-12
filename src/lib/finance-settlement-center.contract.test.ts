import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260805103325_finance_settlement_center_v2.sql'),
  'utf8',
);
const reopenMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260805105024_finance_period_reopen_booking_state.sql'),
  'utf8',
);
const allocationGuardMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260805105558_clobe_4128_allocation_guard.sql'),
  'utf8',
);
const v3Migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260806002511_finance_settlement_center_v3_revalidation.sql'),
  'utf8',
);
const nonTravelConservationMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260806045208_finance_non_travel_allocation_conservation.sql'),
  'utf8',
);
const fingerprintIntegrityMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260811113000_finance_review_fingerprint_integrity.sql'),
  'utf8',
);
const resolvedFingerprintBackfillMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260811121000_finance_review_fingerprint_v4_resolved_backfill.sql'),
  'utf8',
);
const financeCenterService = readFileSync(
  join(process.cwd(), 'src/lib/finance-center-service.ts'),
  'utf8',
);
const financeSettlementV3Service = readFileSync(
  join(process.cwd(), 'src/lib/finance-settlement-v3-service.ts'),
  'utf8',
);
const periodApi = readFileSync(
  join(process.cwd(), 'src/app/api/admin/finance/periods/route.ts'),
  'utf8',
);
const legacyClose = readFileSync(
  join(process.cwd(), 'src/components/admin/MonthlySettlementCloseCard.tsx'),
  'utf8',
);
const legacyCloseApi = readFileSync(
  join(process.cwd(), 'src/app/api/payments/monthly-settlement-close/route.ts'),
  'utf8',
);
const classificationApi = readFileSync(
  join(process.cwd(), 'src/app/api/admin/finance/classifications/route.ts'),
  'utf8',
);
const classificationBatchMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260811224328_finance_classification_batch_workflow.sql'),
  'utf8',
);
const classificationBatchApi = readFileSync(
  join(process.cwd(), 'src/app/api/admin/finance/classifications/batch/route.ts'),
  'utf8',
);
const accountRealityApi = readFileSync(
  join(process.cwd(), 'src/app/api/bank-transactions/account-reality/route.ts'),
  'utf8',
);
const integrationsApi = readFileSync(
  join(process.cwd(), 'src/app/api/admin/integrations/route.ts'),
  'utf8',
);
const paymentsPage = readFileSync(
  join(process.cwd(), 'src/app/admin/payments/PaymentsPageClient.tsx'),
  'utf8',
);

describe('finance settlement center contracts', () => {
  it('serializes close and keeps one current revision per departure month', () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('finance-close:'");
    expect(migration).toContain('uq_settlement_periods_current_month');
    expect(migration).toContain('settlement period is locked; reopen it before closing a new revision');
  });

  it('makes period items immutable and server-only', () => {
    expect(migration).toContain('trg_settlement_period_items_immutable');
    expect(migration).toContain('settlement period items are immutable');
    expect(migration).toContain('ALTER TABLE public.settlement_period_items ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON public.settlement_period_items FROM anon, authenticated');
  });

  it('requires complete conditional-close responsibility and super-admin reopen', () => {
    expect(migration).toContain('conditional close exceptions require assignee, reason, and due date');
    expect(periodApi).toContain('requireSuperAdminRequest');
    expect(periodApi).toContain('exceptionOwner');
    expect(periodApi).toContain('exceptionDueDate');
  });

  it('returns reopened bookings to preview without mutating the immutable snapshot', () => {
    expect(reopenMigration).toContain('settlement_confirmed_at = NULL');
    expect(reopenMigration).toContain('settlement_period_items item');
    expect(reopenMigration).not.toContain('UPDATE public.settlement_period_items');
    expect(reopenMigration).toContain('before_value');
  });

  it('replaces the one-booking guard with exact, atomic multi-purpose allocation', () => {
    expect(allocationGuardMigration).toContain('v_booking_count > 1');
    expect(v3Migration).toContain('DROP TRIGGER IF EXISTS trg_clobe_4128_allocation_integrity');
    expect(v3Migration).toContain('save_bank_transaction_breakdown');
    expect(v3Migration).toContain('confirmed allocation total (%) must equal source amount (%)');
    expect(v3Migration).toContain("pg_advisory_xact_lock(hashtextextended('finance-breakdown:'");
  });

  it('does not use native confirm for financial close', () => {
    expect(legacyClose).not.toContain('window.confirm');
    expect(legacyClose).toContain('role="dialog"');
    expect(legacyClose).toContain('aria-modal="true"');
  });

  it('blocks the legacy close write path from bypassing booking reviews', () => {
    expect(legacyCloseApi).toContain('status: 409');
    expect(legacyCloseApi).toContain('예약별 확인을 마친 뒤 월 마감');
    expect(legacyCloseApi).not.toContain(".rpc('close_settlement_period'");
  });

  it('keeps split company allocations visible and reclassifies them atomically', () => {
    expect(classificationApi).toContain(".from('bank_transaction_allocations')");
    expect(classificationApi).toContain('nonBookingAllocations');
    expect(classificationApi).toContain(".rpc('save_bank_transaction_breakdown'");
    expect(classificationApi).toContain('allocationId');
  });

  it('saves company classifications as one stale-safe idempotent batch', () => {
    expect(classificationApi).toContain('batchEligible');
    expect(classificationApi).toContain('allocations.length === 1');
    expect(classificationApi).toContain('Number(allocation.allocated_amount) === Number(transaction.amount)');
    expect(classificationBatchMigration).toContain('save_finance_classification_batch');
    expect(classificationBatchMigration).toContain('pg_advisory_xact_lock');
    expect(classificationBatchMigration).toContain('stale finance classification');
    expect(classificationBatchMigration).toContain('duplicate transaction ids');
    expect(classificationBatchMigration).toContain('allocation.allocated_amount = transaction.amount');
    expect(classificationBatchMigration).toContain('allocation.booking_id IS NULL');
    expect(classificationBatchMigration).toContain("expense classification requires a withdrawal");
    expect(classificationBatchMigration).toContain('finance_classification_batch_runs');
    expect(classificationBatchMigration).toContain('REVOKE ALL ON FUNCTION public.save_finance_classification_batch');
    expect(classificationBatchMigration).toContain('TO service_role');
    expect(classificationBatchApi).toContain("request.headers.get('Idempotency-Key')");
    expect(classificationBatchApi).toContain('expectedClassification');
  });

  it('conserves every non-travel transaction without overwriting manual splits', () => {
    expect(nonTravelConservationMigration).toContain('sync_non_travel_classification_allocations');
    expect(nonTravelConservationMigration).toContain("p_classification = 'review'");
    expect(nonTravelConservationMigration).toContain("THEN 'unassigned'");
    expect(nonTravelConservationMigration).toContain('summary.allocated_amount < summary.source_amount');
    expect(nonTravelConservationMigration).toContain("allocation.metadata->>'origin' = 'finance_classification_auto'");
    expect(nonTravelConservationMigration).toContain("allocation.created_by = 'system:finance_classification'");
    expect(nonTravelConservationMigration).toContain("matched_by = COALESCE(transaction.matched_by, 'system:finance_classification')");
    expect(nonTravelConservationMigration).toContain('allocated_amount <> source_amount');
    expect(financeCenterService).toContain(".rpc('sync_non_travel_classification_allocations'");
    expect(classificationApi).toContain(".rpc('sync_non_travel_classification_allocations'");
  });

  it('reads Clobe travel keys from persisted metadata instead of a nonexistent bank column', () => {
    expect(financeSettlementV3Service).toContain('clobeSettlementKeyFromSourceMetadata');
    expect(financeSettlementV3Service).toContain('memo, source_metadata');
    expect(financeSettlementV3Service).not.toContain('memo, settlement_key');
  });

  it('preserves legacy confirmations as versioned period snapshots', () => {
    expect(migration).toContain("'legacy_booking_confirmation'");
    expect(migration).toContain("'migrated_from', 'bookings.settlement_confirmed_at'");
    expect(migration).toContain('ON CONFLICT (settlement_period_id, booking_id) DO NOTHING');
  });

  it('keeps no-op Clobe refreshes from invalidating owner settlement decisions', () => {
    expect(fingerprintIntegrityMigration).toContain("'v4'");
    expect(fingerprintIntegrityMigration).not.toContain("COALESCE(t.updated_at::text, '')");
    expect(fingerprintIntegrityMigration).toContain('v_current.review_fingerprint = v_fingerprint');
    expect(fingerprintIntegrityMigration).toContain("v_current.status = 'pending'");
    expect(fingerprintIntegrityMigration).toContain('finance_booking_review_live_snapshots');
    expect(financeSettlementV3Service).toContain(".rpc('finance_booking_review_live_snapshots'");
    expect(financeSettlementV3Service).toContain('params.liveSnapshot?.review_fingerprint');
    expect(resolvedFingerprintBackfillMigration).toContain('review.review_fingerprint IS DISTINCT FROM live.review_fingerprint');
    expect(resolvedFingerprintBackfillMigration).not.toContain("SET status = 'pending'");
  });

  it('reconciles cancelled bookings instead of leaving hidden pending reviews', () => {
    expect(fingerprintIntegrityMigration).toContain("WHERE status = 'cancelled'");
    expect(fingerprintIntegrityMigration).toContain("SET status = 'customer_cancelled'");
    expect(fingerprintIntegrityMigration).toContain('finance_excluded = true');
  });

  it('uses one complete booking reserve population across finance tabs', () => {
    expect(accountRealityApi).toContain(".from('bookings')");
    expect(accountRealityApi).toContain(".limit(5000)");
    expect(accountRealityApi).not.toContain('const bookingIds =');
    expect(accountRealityApi).toContain(".from('settlement_periods')");
    expect(accountRealityApi).toContain(".from('settlement_period_items')");
    expect(accountRealityApi).toContain('confirmedSettlementItems');
    expect(accountRealityApi).toContain('confirmedBookingIds');
  });

  it('keeps connection dates and focused work counts semantically consistent', () => {
    expect(integrationsApi).toContain('connected_at: row?.created_at ?? null');
    expect(integrationsApi).not.toContain('connected_at: row?.updated_at ?? null');
    expect(classificationApi).toContain('batchEligibleReview');
    expect(paymentsPage).toContain('opsQueueSummary && !focusMode');
  });
});
