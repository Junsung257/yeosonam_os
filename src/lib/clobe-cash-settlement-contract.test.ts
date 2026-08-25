import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const migrationSql = read('supabase/migrations/20260823235214_clobe_cash_settlement_commands.sql');
const hardeningSql = read('supabase/migrations/20260824221515_harden_clobe_sync_reconciliation_and_finalization.sql');
const mixedOutflowSql = read('supabase/migrations/20260824033911_clobe_mixed_outflow_allocations.sql');
const allocationPrivilegeSql = read('supabase/migrations/20260824052738_restrict_bank_transaction_allocation_rpc.sql');
const correctionSql = read('supabase/migrations/20260823235147_correct_clobe_refund_outflow_600500.sql');
const pendingOutflowReviewSql = read('supabase/migrations/20260825123855_enforce_clobe_unassigned_outflow_review.sql');
const bookingDrawerSource = read('src/components/BookingDrawer.tsx');
const bookingDetailSource = read('src/app/admin/bookings/[id]/BookingDetailClient.tsx');
const bookingDetailPageSource = read('src/app/admin/bookings/[id]/page.tsx');
const settlementKeySource = read('src/lib/settlement-import/booking-settlement-keys.ts');
const importerSource = read('src/lib/settlement-import/bank-transaction-importer.ts');
const bankTransactionRouteSource = read('src/app/api/bank-transactions/route.ts');
const clobeSyncRouteSource = read('src/app/api/bank-transactions/sync-clobe/route.ts');
const agentActionExecutorSource = read('src/lib/agent-action-executor.ts');
const financePeriodsRouteSource = read('src/app/api/admin/finance/periods/route.ts');
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

  it('blocks final settlement until every provider-key transaction is exactly allocated', () => {
    expect(hardeningSql).toContain('every Clobe transaction must be fully allocated before final settlement');
    expect(hardeningSql).toContain('provider-key transaction is not allocated to this booking');
    expect(hardeningSql).toContain('latest Clobe memo has not been applied to every transaction');
    expect(hardeningSql).toContain('unresolved non-booking allocation blocks Clobe final settlement');
    expect(hardeningSql).toContain('allocation ledger evidence blocks Clobe final settlement');
    expect(hardeningSql).toContain('clobe_booking_settlement_snapshots');
    expect(hardeningSql).toContain('Clobe settlement snapshots are append-only');
    expect(hardeningSql).toContain('Clobe allocation has unresolved memo-key or review state');
    expect(hardeningSql).toContain('open Clobe memo-change review blocks final settlement');
    expect(hardeningSql).toContain("c.request_json ->> 'action' = 'match'");
    expect(hardeningSql).toContain("current_a.idempotency_key NOT LIKE c.idempotency_key || ':%'");
  });

  it('blocks legacy and AI paths from bypassing the Clobe final-settlement command', () => {
    expect(hardeningSql).toContain('CREATE OR REPLACE FUNCTION public.guard_clobe_booking_settlement_mutation');
    expect(hardeningSql).toContain('trg_guard_clobe_booking_settlement_mutation');
    expect(hardeningSql).toContain("set_config('yeosonam.clobe_settlement_booking_id'");
    expect(agentActionExecutorSource).toContain('Clobe 예약은 일괄·AI 확정할 수 없습니다');
    expect(financePeriodsRouteSource).toContain('clobe_individual_finalize_required');
  });

  it('uses a durable account lease for every live Clobe sync', () => {
    expect(hardeningSql).toContain('CREATE OR REPLACE FUNCTION public.begin_clobe_sync_run');
    expect(hardeningSql).toContain('CREATE OR REPLACE FUNCTION public.checkpoint_clobe_sync_run');
    expect(hardeningSql).toContain('CREATE OR REPLACE FUNCTION public.complete_clobe_sync_run');
    expect(hardeningSql).toContain('Clobe sync is already running for this account');
    expect(hardeningSql).toContain("COALESCE(p_tenant_id::TEXT, 'platform')");
    expect(clobeSyncRouteSource).toContain('p_tenant_id: settlementTenantId');
    expect(clobeSyncRouteSource).toContain("(row.account_number ?? '').replace(/\\D/g, '') === normalizedAccount");
    expect(clobeSyncRouteSource).toContain('Clobe sync account mismatch');
  });

  it('repairs the production deposit classifier without mojibake', () => {
    expect(hardeningSql).toContain("v_tx.transaction_type = '입금'");
    expect(hardeningSql).not.toContain('?낃툑');
    expect(hardeningSql).toContain('SECURITY DEFINER');
    expect(hardeningSql).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('moves a provider-key inflow out of non-booking only through a compensating command', () => {
    expect(hardeningSql).toContain('CREATE OR REPLACE FUNCTION public.reclassify_clobe_nonbooking_inflow_to_booking');
    expect(hardeningSql).toContain("SET status = 'reversed'");
    expect(hardeningSql).toContain("p_source := 'clobe_nonbooking_reclassification'");
    expect(hardeningSql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('reconciles a late canonical provider memo without deleting classification evidence', () => {
    expect(hardeningSql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_clobe_provider_memo_allocation');
    expect(hardeningSql).toContain("v_status := 'reclassified_booking'");
    expect(hardeningSql).toContain("v_status := 'released_for_review'");
    expect(hardeningSql).toContain("'requires_outflow_approval', TRUE");
    expect(hardeningSql).toContain("a.target_type IN ('booking', 'customer_refund')");
    expect(importerSource).toContain('releasableNonBookingClassification');
    expect(importerSource).toContain("supabaseAdmin.rpc('reconcile_clobe_provider_memo_allocation'");
    expect(hardeningSql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('keeps only unapproved travel outflows in review after provider evidence refresh', () => {
    const refreshStart = importerSource.indexOf('async function updateProcessedDuplicateFromMemo');
    const refreshEnd = importerSource.indexOf('async function resolveClobeMemoReviewEvents');
    const processedEvidenceRefresh = importerSource.slice(refreshStart, refreshEnd);
    expect(processedEvidenceRefresh).toContain('Match state and approval evidence belong to the atomic DB command');
    expect(processedEvidenceRefresh).not.toContain('match_status:');
    expect(processedEvidenceRefresh).not.toContain('matched_by:');
    expect(processedEvidenceRefresh).not.toContain('matched_at:');
    expect(pendingOutflowReviewSql).toContain('CREATE TRIGGER trg_enforce_pending_clobe_outflow_review');
    expect(pendingOutflowReviewSql).toContain('CREATE TRIGGER trg_enforce_clobe_outflow_review_from_allocation');
    expect(pendingOutflowReviewSql).toContain("NEW.settlement_scope = 'travel'");
    expect(pendingOutflowReviewSql).toContain("NEW.match_status := 'review'");
    expect(pendingOutflowReviewSql).toContain('NEW.matched_by := NULL');
    expect(pendingOutflowReviewSql).toContain("OLD.match_status IN ('manual', 'auto')");
    expect(pendingOutflowReviewSql).toContain("a.target_type = 'unassigned'");
    expect(pendingOutflowReviewSql).toContain("a.allocation_type = 'unassigned'");
    expect(pendingOutflowReviewSql).not.toContain('provider_is_unclassified');
    expect(pendingOutflowReviewSql).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('permits the dedicated Clobe command sources in the append-only ledger', () => {
    expect(hardeningSql).toContain('DROP CONSTRAINT IF EXISTS ledger_entries_source_check');
    expect(hardeningSql).toContain("'clobe_provider_memo_reconciliation'");
    expect(hardeningSql).toContain("'clobe_outflow_allocation'");
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
    expect(importerSource).toContain('Prime the latest provider evidence for every changed canonical row');
    expect(settlementKeySource).toContain('renamed settlement key lookup failed');
  });

  it('merges only a provably empty duplicate Clobe placeholder', () => {
    expect(hardeningSql).toContain('corrected memo key belongs to a non-empty booking; manual review is required');
    expect(hardeningSql).toContain("finance_exclusion_reason = 'empty Clobe placeholder merged after provider memo correction'");
    expect(hardeningSql).toContain("'merged_empty_booking_id'");
    expect(hardeningSql).toContain('latest provider memo key does not match requested correction');
    expect(hardeningSql).toContain('cross-tenant Clobe memo correction is forbidden');
    expect(hardeningSql).not.toMatch(/\bDELETE\s+FROM\b/i);
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
    expect(hardeningSql).toContain('match_clobe_outflow_allocations_v1');
    expect(hardeningSql).toContain('replaced_by_command');
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
    expect(hardeningSql).toContain('existing Clobe deposit allocation lacks ledger evidence');
  });

  it('removes direct browser-role access to financial allocation commands', () => {
    expect(allocationPrivilegeSql).toContain('match_bank_transaction_allocations');
    expect(allocationPrivilegeSql).toContain('FROM PUBLIC, anon, authenticated');
    expect(allocationPrivilegeSql).toContain('TO service_role');
    expect(mixedOutflowSql).toContain('FROM PUBLIC, anon, authenticated');
    expect(mixedOutflowSql).toContain('TO service_role');
    expect(hardeningSql).toContain('cross-tenant legacy repair is forbidden');
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
