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
const financeCenterService = readFileSync(
  join(process.cwd(), 'src/lib/finance-center-service.ts'),
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

  it('preserves legacy confirmations as versioned period snapshots', () => {
    expect(migration).toContain("'legacy_booking_confirmation'");
    expect(migration).toContain("'migrated_from', 'bookings.settlement_confirmed_at'");
    expect(migration).toContain('ON CONFLICT (settlement_period_id, booking_id) DO NOTHING');
  });
});
