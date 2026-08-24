import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const migrationSql = read('supabase/migrations/20260823235214_clobe_cash_settlement_commands.sql');
const mixedOutflowSql = read('supabase/migrations/20260824033911_clobe_mixed_outflow_allocations.sql');
const allocationPrivilegeSql = read('supabase/migrations/20260824052738_restrict_bank_transaction_allocation_rpc.sql');
const correctionSql = read('supabase/migrations/20260823235147_correct_clobe_refund_outflow_600500.sql');
const bookingDrawerSource = read('src/components/BookingDrawer.tsx');
const bookingDetailSource = read('src/app/admin/bookings/[id]/BookingDetailClient.tsx');
const bookingDetailPageSource = read('src/app/admin/bookings/[id]/page.tsx');
const settlementKeySource = read('src/lib/settlement-import/booking-settlement-keys.ts');
const importerSource = read('src/lib/settlement-import/bank-transaction-importer.ts');
const bankTransactionRouteSource = read('src/app/api/bank-transactions/route.ts');
const vercelConfig = JSON.parse(read('vercel.json')) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};

describe('Clobe cash settlement operating contract', () => {
  it('keeps cash finalization separate from the ordinary booking lifecycle', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.finalize_clobe_booking_settlement');
    expect(migrationSql).toContain("settlement_mode = 'cash'");
    expect(migrationSql).toContain("'already_in_state', v_already_in_state");
    expect(migrationSql).not.toContain("status = 'completed'");
    expect(migrationSql).not.toContain("status = CASE WHEN status = 'completed'");
  });

  it('uses one command id per operator action so finalize can run again after unfinalize', () => {
    expect(bookingDrawerSource).toContain('settlement-finalize:${bookingId}:${crypto.randomUUID()}');
    expect(bookingDrawerSource).toContain('settlement-unfinalize:${bookingId}:${crypto.randomUUID()}');
  });

  it('quarantines old/new memo coexistence and renames the key atomically', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION public.apply_clobe_memo_booking_correction');
    expect(migrationSql).toContain('another active Clobe transaction still uses the previous memo key');
    expect(settlementKeySource).toContain('transactionId: string');
    expect(settlementKeySource).toContain(".neq('status', 'cancelled')");
  });

  it('keeps Clobe sync manual until the operator changes the policy', () => {
    expect(vercelConfig.crons?.some(cron => cron.path === '/api/cron/clobe-bank-sync')).toBe(false);
  });

  it('corrects the approved 600500 withdrawal with compensating evidence', () => {
    expect(correctionSql).toContain("external_transaction_id = '96537209'");
    expect(correctionSql).toContain("SET status = 'reversed'");
    expect(correctionSql).toContain('public.update_booking_ledger');
    expect(correctionSql).toContain('public.match_bank_transaction_allocations');
    expect(correctionSql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('keeps one provider outflow while allowing exact payout/refund allocations', () => {
    expect(mixedOutflowSql).toContain('CREATE OR REPLACE FUNCTION public.match_clobe_outflow_allocations');
    expect(mixedOutflowSql).toContain('CREATE OR REPLACE FUNCTION public.reverse_clobe_outflow_allocations');
    expect(mixedOutflowSql).toContain("allocation_type NOT IN ('payout', 'refund')");
    expect(mixedOutflowSql).toContain('v_total <> ABS(COALESCE(v_tx.amount, 0))');
    expect(mixedOutflowSql).toContain("COALESCE(v_tx.match_status, 'unmatched')");
    expect(mixedOutflowSql).toContain('cross-tenant Clobe allocation is forbidden');
    expect(mixedOutflowSql).toContain('v_command.request_json IS DISTINCT FROM v_request');
    expect(mixedOutflowSql).toContain('finalized booking cannot receive a new Clobe allocation');
    expect(mixedOutflowSql).toContain('finalized booking must be unfinalized before reversing Clobe allocation');
    expect(mixedOutflowSql).toContain("'clobe_outflow_allocations_reversed'");
    expect(mixedOutflowSql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('carries refund purpose evidence from memo parsing into one-click approval', () => {
    expect(importerSource).toContain('purpose_tags: input.parsed?.purposeTags ?? []');
    expect(importerSource).toContain('purpose_tags: parsed.purposeTags');
    expect(bankTransactionRouteSource).toContain("purposeTags.includes('환불')");
    expect(bankTransactionRouteSource).toContain("value.allocationType !== 'payout'");
    expect(bankTransactionRouteSource).toContain('Number.isSafeInteger(item.amount)');
    expect(bankTransactionRouteSource).toContain("action === 'confirm_clobe_outflow_allocations'");
    expect(bankTransactionRouteSource).toContain(".from('bank_transaction_allocations')");
  });

  it('keeps an existing normal booking behind an explicit Clobe deposit approval', () => {
    expect(settlementKeySource).toContain('suggestedBookingId: ambiguous ? null : best.row.id');
    expect(importerSource).toContain('suggested_booking_id: input.suggestedBookingId ?? null');
    expect(bankTransactionRouteSource).toContain("action === 'confirm_clobe_deposit'");
    expect(bankTransactionRouteSource).toContain('suggestedBookingId !== confirmedBookingId');
    expect(bankTransactionRouteSource).toContain('booking.tenant_id !== row.tenant_id');
    expect(bankTransactionRouteSource).toContain('booking.settlement_confirmed_at');
  });

  it('removes direct browser-role access to financial allocation commands', () => {
    expect(allocationPrivilegeSql).toContain('match_bank_transaction_allocations');
    expect(allocationPrivilegeSql).toContain('FROM PUBLIC, anon, authenticated');
    expect(allocationPrivilegeSql).toContain('TO service_role');
    expect(mixedOutflowSql).toContain('FROM PUBLIC, anon, authenticated');
    expect(mixedOutflowSql).toContain('TO service_role');
  });

  it('does not rename a representative booking when one Clobe row has mixed allocations', () => {
    expect(importerSource).toContain('memoCorrectionRequiresReview');
    expect(importerSource).toContain('multi_allocation_clobe_memo_change_requires_review');
    expect(importerSource).toContain('rows.length > 1');
  });

  it('keeps the direct booking detail route on the Clobe cash-settlement workflow', () => {
    expect(bookingDetailPageSource).toContain('clobe_settlement_booking: Boolean(clobeKeyResult.data)');
    expect(bookingDetailSource).toContain('if (booking.clobe_settlement_booking)');
    expect(bookingDetailSource).toContain('모든 입금자 합산');
    expect(bookingDetailSource).toContain('입금자명과 지급·환불 대상을 원거래별로 보관합니다.');
    expect(bookingDetailSource).toContain('/settlement/finalize');
    expect(bookingDetailSource).toContain('최종정산 확정 · 수익');
  });
});
