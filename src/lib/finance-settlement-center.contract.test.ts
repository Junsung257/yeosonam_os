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
const periodApi = readFileSync(
  join(process.cwd(), 'src/app/api/admin/finance/periods/route.ts'),
  'utf8',
);
const legacyClose = readFileSync(
  join(process.cwd(), 'src/components/admin/MonthlySettlementCloseCard.tsx'),
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

  it('prevents one Clobe 4128 statement row from reaching two bookings or exceeding its amount', () => {
    expect(allocationGuardMigration).toContain('v_booking_count > 1');
    expect(allocationGuardMigration).toContain('v_allocated_total > v_transaction.amount');
    expect(allocationGuardMigration).toContain("v_transaction.account_number <> '100038454128'");
    expect(allocationGuardMigration).toContain('trg_clobe_4128_allocation_integrity');
  });

  it('does not use native confirm for financial close', () => {
    expect(legacyClose).not.toContain('window.confirm');
    expect(legacyClose).toContain('role="dialog"');
    expect(legacyClose).toContain('aria-modal="true"');
  });

  it('preserves legacy confirmations as versioned period snapshots', () => {
    expect(migration).toContain("'legacy_booking_confirmation'");
    expect(migration).toContain("'migrated_from', 'bookings.settlement_confirmed_at'");
    expect(migration).toContain('ON CONFLICT (settlement_period_id, booking_id) DO NOTHING');
  });
});
