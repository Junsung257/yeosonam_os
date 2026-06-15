import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SettlementDraft } from './settlement-calc';

const mocks = vi.hoisted(() => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

const { applySettlementApproval } = await import('./settlement-calc');

function baseDraft(overrides: Partial<SettlementDraft> = {}): SettlementDraft {
  return {
    affiliate_id: 'aff-1',
    affiliate_name: 'Partner A',
    period: '2026-05',
    qualified_booking_count: 3,
    total_amount: 300_000,
    carryover_balance: 0,
    final_total: 300_000,
    tax_deduction: 0,
    final_payout: 300_000,
    booking_ids: ['bk-1', 'bk-2', 'bk-3'],
    payout_type: 'CORPORATE',
    qualified: true,
    adjustment_amount: 10_000,
    adjustment_ids: ['adj-1'],
    ...overrides,
  };
}

function createQuery(result: unknown = { data: null, error: null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => result);
  query.upsert = vi.fn(async () => ({ error: null }));
  query.insert = vi.fn(async () => ({ error: null }));
  return query;
}

describe('applySettlementApproval idempotency', () => {
  beforeEach(() => {
    mocks.supabaseAdmin.from.mockReset();
  });

  it('skips all mutating settlement work when the period is already READY', async () => {
    const settlementQuery = createQuery({ data: { id: 'st-1', status: 'READY' }, error: null });
    const auditQuery = createQuery();

    mocks.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'settlements') return settlementQuery;
      if (table === 'audit_logs') return auditQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await applySettlementApproval(baseDraft());

    expect(settlementQuery.upsert).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin.from).not.toHaveBeenCalledWith('affiliates');
    expect(mocks.supabaseAdmin.from).not.toHaveBeenCalledWith('commission_adjustments');
    expect(auditQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SETTLEMENT_APPROVAL_REPLAY_SKIPPED',
    }));
  });

  it('skips all mutating settlement work when the period is already COMPLETED', async () => {
    const settlementQuery = createQuery({ data: { id: 'st-1', status: 'COMPLETED' }, error: null });
    const auditQuery = createQuery();

    mocks.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'settlements') return settlementQuery;
      if (table === 'audit_logs') return auditQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await applySettlementApproval(baseDraft());

    expect(settlementQuery.upsert).not.toHaveBeenCalled();
    expect(mocks.supabaseAdmin.from).not.toHaveBeenCalledWith('affiliates');
    expect(mocks.supabaseAdmin.from).not.toHaveBeenCalledWith('commission_adjustments');
    expect(auditQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SETTLEMENT_APPROVAL_REPLAY_SKIPPED',
    }));
  });


  it('creates READY settlement and increments booking_count only for a first approval', async () => {
    const existingSettlementQuery = createQuery({ data: null, error: null });
    const affiliateSelectQuery = createQuery({ data: { booking_count: 4 }, error: null });
    const affiliateUpdateQuery = createQuery();
    const adjustmentQuery = createQuery();
    const auditQuery = createQuery();

    let affiliateCalls = 0;
    mocks.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'settlements') return existingSettlementQuery;
      if (table === 'affiliates') {
        affiliateCalls += 1;
        return affiliateCalls === 1 ? affiliateSelectQuery : affiliateUpdateQuery;
      }
      if (table === 'commission_adjustments') return adjustmentQuery;
      if (table === 'audit_logs') return auditQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await applySettlementApproval(baseDraft());

    expect(existingSettlementQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliate_id: 'aff-1',
        settlement_period: '2026-05',
        status: 'READY',
      }),
      { onConflict: 'affiliate_id,settlement_period' },
    );
    expect(affiliateUpdateQuery.update).toHaveBeenCalledWith({ booking_count: 7 });
    expect(adjustmentQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'applied',
      applied_to_period: '2026-05',
    }));
    expect(adjustmentQuery.eq).toHaveBeenCalledWith('status', 'pending');
    expect(auditQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SETTLEMENT_APPROVED',
    }));
  });
});
