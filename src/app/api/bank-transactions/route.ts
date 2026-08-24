/**
 * bank_transactions API
 *
 * GET   — 전체 입출금 내역 조회 (최신순 200건)
 * PUT   — 원클릭 일괄 자동 매칭
 * PATCH — action 분기: match / fee / undo / multi
 * POST  — 과거 내역 일괄 등록 / 미리보기
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { creditMileageForBooking } from '@/lib/mileage-service';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getAdminContext } from '@/lib/admin-context';
import {
  matchPaymentToBookings,
  applyDuplicateNameGuard,
  classifyMatch,
  calcPaymentStatus,
  getBalance,
  AUTO_THRESHOLD,
  BookingCandidate,
} from '@/lib/payment-matcher';
import { learnAlias } from '@/lib/slack-ingest';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  buildBankTransactionFingerprint,
  scoreBankTransactionSimilarity,
} from '@/lib/bank-transaction-fingerprint';
import {
  parseTravelSettlementMemo,
  resolveSettlementMemoBooking,
  type ParsedTravelSettlementMemo,
} from '@/lib/settlement-import';

// 매칭 성공 후 counterparty_name ↔ customer 매핑 학습 (best-effort)
async function learnAliasForMatch(bookingId: string, counterpartyName: string | undefined | null) {
  if (!counterpartyName) return;
  try {
    const { data: bk } = await supabaseAdmin
      .from('bookings')
      .select('lead_customer_id')
      .eq('id', bookingId)
      .maybeSingle();
    const bkRow = bk as { lead_customer_id: string | null } | null;
    const customerId = bkRow?.lead_customer_id;
    if (!customerId) return;
    await learnAlias({ customerId, alias: counterpartyName, source: 'manual_match' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[bank-transactions] alias 학습 실패 (무시):', msg);
  }
}

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

interface BankTxRow {
  id: string;
  amount: number;
  transaction_type: '입금' | '출금';
  is_refund: boolean;
  counterparty_name: string | null;
  match_status: string | null;
  booking_id: string | null;
  source?: string | null;
  external_provider?: string | null;
}

interface ExistingBankTxCandidate {
  id: string;
  amount: number;
  transaction_type: string;
  counterparty_name: string | null;
  received_at: string;
  booking_id: string | null;
  match_status: string | null;
  source?: string | null;
  memo?: string | null;
  source_metadata?: Record<string, unknown> | null;
}

interface BookingWithCustomer {
  id: string;
  booking_no: string;
  package_title: string;
  total_price: number;
  total_cost: number;
  paid_amount: number;
  total_paid_out: number;
  departure_date: string;
  status: string;
  payment_status: string;
  customer_name?: string;
}

interface BankTransactionAllocationRow {
  id: string;
  booking_id: string;
  ledger_account: 'paid_amount' | 'total_paid_out';
  allocated_amount: number;
  ledger_delta: number;
  allocation_type: 'deposit' | 'refund' | 'payout';
  idempotency_key: string;
}

function isClobeSource(row: { source?: string | null; external_provider?: string | null } | null): boolean {
  return row?.source === 'clobe_mcp' || row?.source === 'clobe_api' || row?.external_provider === 'clobe';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getProtectedClobeTransactionIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from('bank_transactions')
    .select('id, source, external_provider')
    .in('id', ids);
  if (error) throw error;
  return new Set(((data ?? []) as Array<{ id: string; source: string | null; external_provider: string | null }>)
    .filter(isClobeSource)
    .map(row => row.id));
}

// ─── 공통 유틸 ────────────────────────────────────────────────────────────────

function nameSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const an = a.replace(/\s+/g, '');
  const bn = b.replace(/\s+/g, '');
  if (an === bn) return 1.0;
  if (an.includes(bn) || bn.includes(an)) return 0.7;
  if (an[0] === bn[0]) return 0.3;
  return 0;
}

async function findExistingBankTransaction(input: {
  tenantId?: string | null;
  receivedAt: string;
  txType: string;
  amount: number;
  counterpartyName: string;
  memo?: string;
  fingerprint: string;
}): Promise<{ kind: 'exact' | 'probable' | null; row: ExistingBankTxCandidate | null; confidence: number }> {
  const exact = await supabaseAdmin
    .from('bank_transactions')
    .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo')
    .eq('transaction_fingerprint', input.fingerprint)
    .maybeSingle();

  if (exact.data) {
    return { kind: 'exact', row: exact.data as ExistingBankTxCandidate, confidence: 1 };
  }

  const center = new Date(input.receivedAt);
  if (Number.isNaN(center.getTime())) return { kind: null, row: null, confidence: 0 };

  const from = new Date(center.getTime() - 60 * 60_000).toISOString();
  const to = new Date(center.getTime() + 60 * 60_000).toISOString();
  let query = supabaseAdmin
    .from('bank_transactions')
    .select('id, amount, transaction_type, counterparty_name, received_at, booking_id, match_status, source, memo')
    .eq('transaction_type', input.txType)
    .eq('amount', input.amount)
    .gte('received_at', from)
    .lte('received_at', to)
    .neq('status', 'excluded')
    .limit(20);

  if (input.tenantId) query = query.eq('tenant_id', input.tenantId) as typeof query;
  else query = query.is('tenant_id', null) as typeof query;

  const { data } = await query;
  let best: ExistingBankTxCandidate | null = null;
  let bestScore = 0;
  for (const row of (data ?? []) as ExistingBankTxCandidate[]) {
    const score = scoreBankTransactionSimilarity(row, input);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }

  return { kind: null, row: bestScore >= 0.65 ? best : null, confidence: bestScore };
}

async function attachBulkImportEvidence(existingId: string, input: {
  fingerprint: string;
  row: BulkRow;
  eventId: string;
}) {
  const { data: existing } = await supabaseAdmin
    .from('bank_transactions')
    .select('source_metadata')
    .eq('id', existingId)
    .maybeSingle();
  const previousMetadata = ((existing as { source_metadata?: Record<string, unknown> } | null)?.source_metadata ?? {}) as Record<string, unknown>;

  await supabaseAdmin
    .from('bank_transactions')
    .update({
      transaction_fingerprint: input.fingerprint,
      source_metadata: {
        ...previousMetadata,
        bulk_import: {
          event_id: input.eventId,
          received_at: input.row.receivedAt,
          account_number: input.row.accountNumber ?? null,
          counterparty_name: input.row.counterpartyName,
          memo: input.row.memo,
          original_line: input.row.originalLine ?? null,
          row_index: input.row.rowIndex ?? null,
          imported_at: new Date().toISOString(),
        },
      },
    } as Record<string, unknown>)
    .eq('id', existingId);
}

interface BookingRow {
  id: string;
  booking_no: string;
  package_title: string;
  total_price: number;
  total_cost: number;
  paid_amount: number;
  total_paid_out: number;
  departure_date: string;
  status: string;
  payment_status: string;
  customers?: { name: string } | Array<{ name: string }> | null;
}

async function loadActiveBookings(): Promise<BookingCandidate[]> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select(`
      id, booking_no, package_title,
      total_price, total_cost, paid_amount, total_paid_out,
      departure_date, status, payment_status, actual_payer_name,
      customers!lead_customer_id(name)
    `)
    .in('status', ['pending', 'confirmed']);

  return (data || []).map((b: BookingRow) => ({
    ...b,
    customer_name: (b.customers as { name?: string } | null)?.name,
  }));
}

// Phase 2a — JS fallback 제거.
//   기존: RPC 미존재 시 bookings.paid_amount 를 JS 에서 직접 UPDATE (ledger 우회 → drift 유발).
//   이제: resync 는 ledger 가 함께 보정되는 resync_paid_amounts_with_ledger RPC 만 호출.
//        RPC 에러 시 사용자에게 명시적으로 알리고 fallback 안 함.

/**
 * 예약 원장 갱신 — update_booking_ledger RPC 호출 + 타임라인 로그
 *
 * Race condition 방지:
 *   기존: SELECT paid_amount → JS에서 +amount → UPDATE (lost update 가능)
 *   신규: UPDATE ... SET paid_amount = paid_amount + x (atomic, row-lock 내장)
 *
 * delta = +1 적용 / -1 롤백 (매칭 취소 시 부호 반전)
 */
async function applyToBooking(
  bookingId: string,
  txType: '입금' | '출금',
  amount: number,
  isRefund: boolean,
  delta: number = 1,
  meta?: { counterpartyName?: string; bankTxId?: string; createdBy?: string },
) {
  const sign = delta;

  let paidDelta = 0;
  let payoutDelta = 0;

  if (txType === '입금' && !isRefund) {
    paidDelta = amount * sign;
  } else if (isRefund) {
    paidDelta = -amount * sign;
  } else {
    payoutDelta = amount * sign;
  }

  // Phase 2a — ledger 이중쓰기 인자.
  //   bankTxId 가 주어지면 idempotency_key 로 사용 (재시도 시 ledger 중복 INSERT 방지).
  //   delta=-1 (롤백) 인 경우 ':rollback' 접미를 붙여 별도 entry 로 기록.
  const baseIdem = meta?.bankTxId ? `bktx:${meta.bankTxId}` : null;
  const idem = baseIdem
    ? (delta < 0 ? `${baseIdem}:rollback` : baseIdem)
    : null;

  const { data, error: rpcErr } = await supabaseAdmin.rpc('update_booking_ledger', {
    p_booking_id: bookingId,
    p_paid_delta: paidDelta,
    p_payout_delta: payoutDelta,
    p_source: 'bank_tx_manual_match',
    p_source_ref_id: meta?.bankTxId ?? null,
    p_idempotency_key: idem,
    p_memo: delta < 0
      ? `bank-tx unmatch (${txType}${isRefund ? ' refund' : ''})`
      : `bank-tx match (${txType}${isRefund ? ' refund' : ''})`,
    p_created_by: meta?.createdBy ?? null,
  });

  if (rpcErr) {
    console.error('[applyToBooking] RPC 실패:', bookingId, rpcErr.message);
    throw new Error(`원장 반영 실패: ${sanitizeDbError(rpcErr)}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const newStatus: string | null =
    (row as Record<string, unknown>)?.auto_status_changed ? ((row as Record<string, unknown>)?.booking_status as string | null ?? null) : null;

  // ── 타임라인 자동 로그 (적용 시에만) ──────────────────────────────────────
  if (delta === 1) {
    const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
    const counterparty = meta?.counterpartyName ?? '—';

    let logTitle = '';
    let logContent = '';

    if (txType === '입금' && !isRefund) {
      logTitle   = '💰 입금 자동 매칭';
      logContent = `${dateStr}: ${counterparty}로부터 ${amount.toLocaleString()}원 입금 내역이 자동 매칭되었습니다.`;
      if (newStatus === 'completed') logContent += ' — 완납 처리되었습니다.';
      else if (newStatus === 'confirmed') logContent += ' — 예약 확정으로 자동 전환되었습니다.';
    } else if (txType === '출금' && !isRefund) {
      logTitle   = '🏢 랜드사 송금 매칭';
      logContent = `${dateStr}: 랜드사(${counterparty})로 ${amount.toLocaleString()}원 송금 내역이 자동 매칭되었습니다.`;
    } else if (isRefund) {
      logTitle   = '↩️ 환불 처리';
      logContent = `${dateStr}: ${counterparty} ${amount.toLocaleString()}원 환불 처리가 매칭되었습니다.`;
    }

    if (logTitle) {
      // message_logs 테이블 없을 경우 조용히 건너뜀 (PGRST205 방어)
      try {
        await supabaseAdmin
          .from('message_logs')
          .insert({
            booking_id: bookingId,
            log_type:   'system',
            event_type: txType === '입금' ? 'DEPOSIT_CONFIRMED' : 'PAYMENT_OUT',
            title:      logTitle,
            content:    logContent,
            is_mock:    false,
            created_by: '🤖 시스템',
          } satisfies Record<string, unknown>);
      } catch {
        // 테이블 미존재 시 무시
      }
    }
  }
}

async function matchTransactionAllocations(params: {
  transactionId: string;
  allocations: { bookingId: string; amount: number; ledgerDelta?: number }[];
  confidence?: number;
  actor: string;
  notes?: string;
}) {
  const { data, error } = await supabaseAdmin.rpc('match_bank_transaction_allocations', {
    p_transaction_id: params.transactionId,
    p_allocations: params.allocations,
    p_match_confidence: params.confidence ?? 1,
    p_matched_by: params.actor,
    p_notes: params.notes ?? null,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    const status = code === 'P0002' ? 404 : 400;
    throw Object.assign(new Error(sanitizeDbError(error)), { status });
  }
  return data;
}

async function reverseAllocationsForTransaction(transactionId: string, actor: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('bank_transaction_allocations')
    .select('id, booking_id, ledger_account, allocated_amount, ledger_delta, allocation_type, idempotency_key')
    .eq('bank_transaction_id', transactionId)
    .eq('status', 'active');

  if (error) {
    // 새 마이그레이션 전 데이터/환경에서는 기존 롤백 경로로 fallback.
    console.warn('[reverse allocations] allocation 조회 실패:', sanitizeDbError(error));
    return 0;
  }

  const rows = (data ?? []) as BankTransactionAllocationRow[];
  for (const row of rows) {
    const reverseDelta = -Number(row.ledger_delta);
    const { error: rpcErr } = await supabaseAdmin.rpc('update_booking_ledger', {
      p_booking_id: row.booking_id,
      p_paid_delta: row.ledger_account === 'paid_amount' ? reverseDelta : 0,
      p_payout_delta: row.ledger_account === 'total_paid_out' ? reverseDelta : 0,
      p_source: 'bank_tx_manual_match',
      p_source_ref_id: transactionId,
      p_idempotency_key: `${row.idempotency_key}:rollback`,
      p_memo: `bank transaction allocation rollback (${row.allocation_type})`,
      p_created_by: actor,
    });
    if (rpcErr) throw new Error(`배정 롤백 실패: ${sanitizeDbError(rpcErr)}`);
  }

  if (rows.length > 0) {
    const { error: updateErr } = await supabaseAdmin
      .from('bank_transaction_allocations')
      .update({ status: 'reversed', reversed_at: new Date().toISOString() })
      .eq('bank_transaction_id', transactionId)
      .eq('status', 'active');
    if (updateErr) throw new Error(`배정 상태 변경 실패: ${sanitizeDbError(updateErr)}`);
  }

  return rows.length;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });

  const { searchParams } = new URL(request.url);
  const summaryOnly  = searchParams.get('summary') === '1';
  const statusFilter = searchParams.get('status') ?? 'active';   // active | excluded | all
  const aggregate    = searchParams.get('aggregate');             // 'monthly'
  const months       = parseInt(searchParams.get('months') || '6', 10);
  const bookingId    = searchParams.get('booking_id');            // 예약별 입금 필터
  const matchStatus  = searchParams.get('match_status');          // 'unmatched' → 전체 기간 미매칭 조회
  const requestedScope = searchParams.get('scope');
  const sourceFilter = searchParams.get('source');
  if (bookingId && !UUID_PATTERN.test(bookingId)) {
    return NextResponse.json(
      { error: 'booking_id 형식이 올바르지 않습니다.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  let bookingAllocations: Array<{
    bank_transaction_id: string;
    booking_id: string;
    allocated_amount: number;
    ledger_delta: number;
    allocation_type: 'deposit' | 'refund' | 'payout';
  }> = [];
  if (bookingId) {
    const { data: allocationRows, error: allocationError } = await supabaseAdmin
      .from('bank_transaction_allocations')
      .select('bank_transaction_id, booking_id, allocated_amount, ledger_delta, allocation_type')
      .eq('booking_id', bookingId)
      .eq('status', 'active');
    if (allocationError) {
      return NextResponse.json({ error: allocationError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
    bookingAllocations = (allocationRows ?? []) as typeof bookingAllocations;
  }
  const settlementScope = requestedScope === 'all'
    ? null
    : requestedScope === 'non_travel' ? 'non_travel' : 'travel';

  // ── 월별 집계 (Recharts 차트 데이터용) ────────────────────────────────────
  if (aggregate === 'monthly') {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    let monthlyQuery = supabaseAdmin
      .from('bank_transactions')
      .select('transaction_type, amount, received_at')
      .neq('status', 'excluded')
      .gte('received_at', cutoff.toISOString())
      .order('received_at', { ascending: true })
      .limit(5000);
    if (settlementScope) monthlyQuery = monthlyQuery.eq('settlement_scope', settlementScope) as typeof monthlyQuery;
    if (sourceFilter) monthlyQuery = monthlyQuery.eq('source', sourceFilter) as typeof monthlyQuery;

    const { data: txs } = await monthlyQuery;

    const map = new Map<string, { income: number; expense: number }>();
    for (const tx of (txs || []) as Array<Record<string, unknown>>) {
      const key = (tx.received_at as string).slice(0, 7);
      if (!map.has(key)) map.set(key, { income: 0, expense: 0 });
      const e = map.get(key)!;
      if (tx.transaction_type === '입금') e.income += (tx.amount as number);
      else e.expense += (tx.amount as number);
    }
    const chartData = Array.from(map.entries())
      .map(([month, { income, expense }]) => ({ month, income, expense, net: income - expense }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({ chartData }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── 미매칭 전체 기간 조회 (limit 없음) ────────────────────────────────────
  if (matchStatus === 'unmatched') {
    if (summaryOnly) {
      let countQuery = supabaseAdmin
        .from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .in('match_status', ['unmatched'])
        .neq('status', 'excluded');
      if (settlementScope) countQuery = countQuery.eq('settlement_scope', settlementScope) as typeof countQuery;
      if (sourceFilter) countQuery = countQuery.eq('source', sourceFilter) as typeof countQuery;

      const { count, error: countError } = await countQuery;

      if (countError) return NextResponse.json({ error: countError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
      return NextResponse.json({ count: count ?? 0, transactions: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    let unmatchedQuery = supabaseAdmin
      .from('bank_transactions')
      .select(`
        *,
        bookings!booking_id (
          id, booking_no, package_title,
          total_price, paid_amount, total_paid_out, departure_date,
          customers!lead_customer_id(name)
        )
      `)
      .in('match_status', ['unmatched'])
      .neq('status', 'excluded')
      .order('received_at', { ascending: false });
    if (settlementScope) unmatchedQuery = unmatchedQuery.eq('settlement_scope', settlementScope) as typeof unmatchedQuery;
    if (sourceFilter) unmatchedQuery = unmatchedQuery.eq('source', sourceFilter) as typeof unmatchedQuery;

    const { data: unmatchedData, error: unmatchedError } = await unmatchedQuery;

    if (unmatchedError) return NextResponse.json({ error: unmatchedError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ transactions: unmatchedData || [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── 일반 트랜잭션 목록 ─────────────────────────────────────────────────────
  let query = supabaseAdmin
    .from('bank_transactions')
    .select(`
      *,
      bookings!booking_id (
        id, booking_no, package_title,
        total_price, paid_amount, total_paid_out, departure_date,
        customers!lead_customer_id(name)
      )
    `)
    .order('received_at', { ascending: false })
    .limit(500);

  if (statusFilter === 'excluded') {
    query = query.eq('status', 'excluded') as typeof query;
  } else if (statusFilter === 'all') {
    // 필터 없음
  } else {
    // 기본: active (excluded 제외)
    query = query.neq('status', 'excluded') as typeof query;
    if (settlementScope) query = query.eq('settlement_scope', settlementScope) as typeof query;
  }

  if (statusFilter === 'all' && settlementScope) {
    query = query.eq('settlement_scope', settlementScope) as typeof query;
  }

  if (bookingId) {
    const allocationTransactionIds = [...new Set(bookingAllocations.map(row => row.bank_transaction_id))];
    query = allocationTransactionIds.length > 0
      ? query.or(`booking_id.eq.${bookingId},id.in.(${allocationTransactionIds.join(',')})`) as typeof query
      : query.eq('booking_id', bookingId) as typeof query;
  }
  if (sourceFilter) query = query.eq('source', sourceFilter) as typeof query;

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  const allocationByTransactionId = new Map(
    bookingAllocations.map(row => [row.bank_transaction_id, row]),
  );
  const transactions = (data ?? []).map(row => ({
    ...row,
    booking_allocation: allocationByTransactionId.get((row as { id: string }).id) ?? null,
  }));
  return NextResponse.json({ transactions }, { headers: { 'Cache-Control': 'no-store' } });
}

// ─── PUT: 원클릭 일괄 자동 매칭 ──────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  try {
    const actor = getAdminContext(request).actor;
    // 미매칭 건 전체 로드
    const { data: unmatched } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, counterparty_name, is_refund, source, external_provider')
      .eq('match_status', 'unmatched');

    if (!unmatched || unmatched.length === 0) {
      return NextResponse.json({ matched: 0, skipped: 0 });
    }

    const bookings = await loadActiveBookings();
    let matched = 0;
    let skipped = 0;

    for (const tx of unmatched as BankTxRow[]) {
      if (isClobeSource(tx)) { skipped++; continue; }
      if (tx.transaction_type !== '입금') { skipped++; continue; }

      const candidates = matchPaymentToBookings({
        amount: tx.amount,
        senderName: tx.counterparty_name,
        bookings,
      });
      const guarded = applyDuplicateNameGuard(candidates);
      const best = guarded[0];
      if (!best || best.confidence < AUTO_THRESHOLD) { skipped++; continue; }

      await matchTransactionAllocations({
        transactionId: tx.id,
        allocations: [{ bookingId: best.booking.id, amount: tx.amount }],
        confidence: best.confidence,
        actor: actor === 'admin' ? 'auto' : actor,
        notes: 'auto payment match',
      });
      matched++;
    }

    return NextResponse.json({ matched, skipped });
  } catch (e) {
    const status = typeof e === 'object' && e !== null && 'status' in e
      ? Number((e as { status?: number }).status) || 500
      : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '처리 실패' }, { status });
  }
}

// ─── PATCH: action 분기 ───────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action = 'match', transactionId } = body;
    const actor = getAdminContext(request).actor;

    // Clobe transactions are controlled exclusively by the Clobe memo flow.
    // Keep generic fee/manual/multi-match commands from creating a second
    // booking or bypassing the memo correction rules.
    if (transactionId && ['fee', 'multi', 'match'].includes(action)) {
      const { data: sourceRow, error: sourceError } = await supabaseAdmin
        .from('bank_transactions')
        .select('source, external_provider')
        .eq('id', transactionId)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (isClobeSource(sourceRow)) {
        return NextResponse.json(
          { error: 'Clobe 거래는 일반 매칭·수수료 처리가 금지되어 있습니다. Clobe 메모를 수정한 뒤 동기화하거나 Clobe 승인 버튼을 사용하세요.' },
          { status: 409 },
        );
      }
    }

    // Existing normal bookings are never auto-linked from a Clobe memo.
    // The importer stores one unambiguous candidate and this explicit command
    // applies the deposit only after the operator confirms that exact booking.
    if (action === 'confirm_clobe_deposit') {
      if (typeof transactionId !== 'string' || !transactionId) {
        return NextResponse.json({ error: 'transactionId 필요' }, { status: 400 });
      }
      const confirmedBookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
      if (!UUID_PATTERN.test(confirmedBookingId)) {
        return NextResponse.json({ error: '확인한 예약 ID가 필요합니다.' }, { status: 400 });
      }

      const { data: tx, error: txError } = await supabaseAdmin
        .from('bank_transactions')
        .select('id, tenant_id, source, external_provider, transaction_type, amount, booking_id, match_status, status, source_metadata')
        .eq('id', transactionId)
        .maybeSingle();
      if (txError) throw txError;
      const row = tx as {
        id: string;
        tenant_id?: string | null;
        source?: string | null;
        external_provider?: string | null;
        transaction_type: string;
        amount: number;
        booking_id?: string | null;
        match_status?: string | null;
        status?: string | null;
        source_metadata?: Record<string, unknown> | null;
      } | null;
      if (!row) return NextResponse.json({ error: '거래를 찾을 수 없습니다' }, { status: 404 });
      if (!isClobeSource(row) || row.transaction_type !== '입금') {
        return NextResponse.json({ error: 'Clobe 여행 입금만 승인할 수 있습니다.' }, { status: 400 });
      }
      if (row.status === 'excluded') return NextResponse.json({ error: '제외된 거래입니다.' }, { status: 409 });
      if (row.booking_id || row.match_status === 'auto' || row.match_status === 'manual') {
        return NextResponse.json({ success: true, alreadyMatched: true, bookingId: row.booking_id });
      }

      const clobeSourceKey = row.source === 'clobe_api' ? 'clobe_api' : 'clobe_mcp';
      const clobeMetadata = row.source_metadata?.[clobeSourceKey];
      const suggestedBookingId = clobeMetadata && typeof clobeMetadata === 'object'
        ? (clobeMetadata as { suggested_booking_id?: unknown }).suggested_booking_id
        : null;
      if (suggestedBookingId !== confirmedBookingId) {
        return NextResponse.json(
          { error: '동기화가 제안한 예약과 확인한 예약이 다릅니다. 새로고침 후 다시 검토하세요.' },
          { status: 409 },
        );
      }

      const { data: suggestedBooking, error: bookingError } = await supabaseAdmin
        .from('bookings')
        .select('id, tenant_id, is_deleted, settlement_confirmed_at')
        .eq('id', confirmedBookingId)
        .maybeSingle();
      if (bookingError) throw bookingError;
      const booking = suggestedBooking as {
        id: string;
        tenant_id?: string | null;
        is_deleted?: boolean | null;
        settlement_confirmed_at?: string | null;
      } | null;
      if (!booking || booking.is_deleted) {
        return NextResponse.json({ error: '연결할 예약을 찾을 수 없습니다.' }, { status: 404 });
      }
      if (booking.tenant_id !== row.tenant_id) {
        return NextResponse.json({ error: '다른 테넌트 예약에는 입금을 연결할 수 없습니다.' }, { status: 409 });
      }
      if (booking.settlement_confirmed_at) {
        return NextResponse.json({ error: '최종 정산된 예약은 정산을 다시 열기 전 입금을 연결할 수 없습니다.' }, { status: 409 });
      }

      const transactionAmount = Math.abs(Number(row.amount));
      if (!Number.isSafeInteger(transactionAmount) || transactionAmount <= 0 || transactionAmount > 2147483647) {
        return NextResponse.json({ error: '입금 금액이 올바르지 않습니다.' }, { status: 409 });
      }
      const result = await matchTransactionAllocations({
        transactionId,
        allocations: [{ bookingId: confirmedBookingId, amount: transactionAmount }],
        confidence: 1,
        actor,
        notes: 'operator approved existing booking suggested by Clobe memo',
      });

      const previousMetadata = row.source_metadata ?? {};
      const currentClobeMetadata = (previousMetadata[clobeSourceKey] ?? {}) as Record<string, unknown>;
      const { error: metadataError } = await supabaseAdmin
        .from('bank_transactions')
        .update({
          source_metadata: {
            ...previousMetadata,
            [clobeSourceKey]: {
              ...currentClobeMetadata,
              existing_booking_approved_at: new Date().toISOString(),
              existing_booking_approved_by: actor,
            },
          },
        } as Record<string, unknown>)
        .eq('id', transactionId);
      if (metadataError) {
        console.warn('[Clobe deposit] approval metadata update failed:', sanitizeDbError(metadataError));
      }

      return NextResponse.json({ success: true, bookingId: confirmedBookingId, result });
    }

    // Clobe outflow approval. The provider row remains one immutable bank
    // transaction, while the command can allocate it as supplier payout(s)
    // and/or customer refund(s). A purpose suffix such as `_환불` supplies the
    // default for the one-click path; mixed cases use the explicit allocations
    // command below.
    if (action === 'confirm_clobe_outflow' || action === 'confirm_clobe_outflow_allocations') {
      if (typeof transactionId !== 'string' || !transactionId) {
        return NextResponse.json({ error: 'transactionId 필요' }, { status: 400 });
      }
      const { data: tx, error: txError } = await supabaseAdmin
        .from('bank_transactions')
        .select('id, source, external_provider, transaction_type, is_refund, amount, memo, booking_id, match_status, status, source_metadata')
        .eq('id', transactionId)
        .maybeSingle();
      if (txError) throw txError;
      const row = tx as {
        id: string;
        source?: string | null;
        external_provider?: string | null;
        transaction_type: string;
        is_refund?: boolean | null;
        amount: number;
        memo?: string | null;
        booking_id?: string | null;
        match_status?: string | null;
        status?: string | null;
        source_metadata?: Record<string, unknown> | null;
      } | null;
      if (!row) return NextResponse.json({ error: '거래를 찾을 수 없습니다' }, { status: 404 });
      if (!isClobeSource(row) || row.transaction_type !== '출금') {
        return NextResponse.json({ error: 'Clobe 여행 출금만 승인할 수 있습니다.' }, { status: 400 });
      }
      if (row.status === 'excluded') return NextResponse.json({ error: '제외된 거래입니다.' }, { status: 409 });
      if (row.booking_id || row.match_status === 'auto' || row.match_status === 'manual') {
        return NextResponse.json({ success: true, alreadyMatched: true, bookingId: row.booking_id });
      }
      const clobeMetadata = row.source_metadata?.[row.source === 'clobe_api' ? 'clobe_api' : 'clobe_mcp'];
      const suggestedBookingId = clobeMetadata && typeof clobeMetadata === 'object'
        ? (clobeMetadata as { suggested_booking_id?: unknown }).suggested_booking_id
        : null;
      const purposeTags = clobeMetadata && typeof clobeMetadata === 'object'
        ? (clobeMetadata as { purpose_tags?: unknown }).purpose_tags
        : null;
      const parsedPurposeTags = parseTravelSettlementMemo(row.memo)?.purposeTags ?? [];
      const defaultAllocationType = (Array.isArray(purposeTags) && purposeTags.includes('환불')) || parsedPurposeTags.includes('환불')
        ? 'refund'
        : 'payout';

      let allocations: Array<{ bookingId: string; amount: number; allocationType: 'payout' | 'refund' }>;
      if (action === 'confirm_clobe_outflow') {
        if (typeof suggestedBookingId !== 'string' || !UUID_PATTERN.test(suggestedBookingId)) {
          return NextResponse.json({ error: '메모 기준 예약 후보가 없어 검토가 필요합니다.' }, { status: 409 });
        }
        const transactionAmount = Math.abs(Number(row.amount));
        if (!Number.isSafeInteger(transactionAmount) || transactionAmount <= 0 || transactionAmount > 2147483647) {
          return NextResponse.json({ error: '출금 금액이 올바르지 않습니다.' }, { status: 409 });
        }
        allocations = [{
          bookingId: suggestedBookingId,
          amount: transactionAmount,
          allocationType: defaultAllocationType,
        }];
      } else {
        const requested = Array.isArray(body.allocations) ? body.allocations : [];
        const hasInvalidAllocationType = requested.some((item: unknown) => {
          const value = (item ?? {}) as Record<string, unknown>;
          return value.allocationType !== 'payout' && value.allocationType !== 'refund';
        });
        if (hasInvalidAllocationType) {
          return NextResponse.json({ error: '처리 구분은 랜드사 지급 또는 고객 환불이어야 합니다.' }, { status: 400 });
        }
        allocations = requested.map((item: unknown) => {
          const value = (item ?? {}) as Record<string, unknown>;
          return {
            bookingId: String(value.bookingId ?? ''),
            amount: Number(value.amount),
            allocationType: value.allocationType as 'payout' | 'refund',
          };
        });
        if (allocations.length === 0
          || allocations.some(item => !UUID_PATTERN.test(item.bookingId) || !Number.isSafeInteger(item.amount) || item.amount <= 0 || item.amount > 2147483647)) {
          return NextResponse.json({ error: '예약, 금액, 처리 구분이 포함된 allocations가 필요합니다.' }, { status: 400 });
        }
      }

      const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : `clobe-outflow:${transactionId}`;
      const { data: result, error: allocationError } = await supabaseAdmin.rpc('match_clobe_outflow_allocations', {
        p_transaction_id: transactionId,
        p_allocations: allocations,
        p_idempotency_key: idempotencyKey,
        p_matched_by: actor,
        p_notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      });
      if (allocationError) {
        const status = (allocationError as { code?: string }).code === 'P0002' ? 404 : 409;
        return NextResponse.json({ error: sanitizeDbError(allocationError) }, { status });
      }

      const previousMetadata = row.source_metadata ?? {};
      const clobeSourceKey = row.source === 'clobe_api' ? 'clobe_api' : 'clobe_mcp';
      const currentClobeMetadata = (previousMetadata[clobeSourceKey] ?? {}) as Record<string, unknown>;
      const { error: metadataError } = await supabaseAdmin
        .from('bank_transactions')
        .update({
          source_metadata: {
            ...previousMetadata,
            [clobeSourceKey]: {
              ...currentClobeMetadata,
              outflow_approved_at: new Date().toISOString(),
              outflow_allocation_count: allocations.length,
            },
          },
        } as Record<string, unknown>)
        .eq('id', transactionId);
      if (metadataError) {
        console.warn('[Clobe outflow] approval metadata update failed:', sanitizeDbError(metadataError));
      }
      return NextResponse.json({ success: true, bookingId: suggestedBookingId, approved: true, result });
    }

    const BULK_ACTIONS = ['trash_bulk', 'restore_bulk', 'hard_delete_bulk'];
    if (!transactionId && action !== 'resync' && !BULK_ACTIONS.includes(action))
      return NextResponse.json({ error: 'transactionId 필요' }, { status: 400 });

    // ── trash: 단건 소프트 삭제 ────────────────────────────────────────────
    if (action === 'trash') {
      const protectedIds = await getProtectedClobeTransactionIds([transactionId]);
      if (protectedIds.has(transactionId)) {
        return NextResponse.json({ error: 'Clobe 원본 거래는 삭제할 수 없습니다. Clobe에서 수정한 뒤 다시 동기화하세요.' }, { status: 409 });
      }
      const { count: allocationCount } = await supabaseAdmin
        .from('bank_transaction_allocations')
        .select('id', { count: 'exact', head: true })
        .eq('bank_transaction_id', transactionId)
        .eq('status', 'active');
      if ((allocationCount ?? 0) > 0) {
        return NextResponse.json({ error: '배정 원장이 있는 거래는 먼저 매칭 취소 후 제외할 수 있습니다.' }, { status: 409 });
      }
      await supabaseAdmin
        .from('bank_transactions')
        .update({ status: 'excluded', deleted_at: new Date().toISOString() })
        .eq('id', transactionId);
      await supabaseAdmin.from('ops_events').insert({
        event_type: 'payment_excluded',
        severity: 'warning',
        title: '입출금 내역 제외',
        bank_transaction_id: transactionId,
        target_type: 'bank_transactions',
        target_id: transactionId,
        metadata: { action: 'trash' },
        created_by: actor,
      } as Record<string, unknown>);
      return NextResponse.json({ success: true });
    }

    // ── restore: 단건 복원 ────────────────────────────────────────────────
    if (action === 'restore') {
      const protectedIds = await getProtectedClobeTransactionIds([transactionId]);
      if (protectedIds.has(transactionId)) {
        return NextResponse.json({ error: 'Clobe 보관 행은 수동 복원할 수 없습니다. 동기화가 원본 상태를 복구합니다.' }, { status: 409 });
      }
      await supabaseAdmin
        .from('bank_transactions')
        .update({ status: 'active', deleted_at: null })
        .eq('id', transactionId);
      return NextResponse.json({ success: true });
    }

    // ── hard_delete: 단건 영구 삭제 ──────────────────────────────────────
    if (action === 'hard_delete') {
      const protectedIds = await getProtectedClobeTransactionIds([transactionId]);
      if (protectedIds.has(transactionId)) {
        return NextResponse.json({ error: 'Clobe 원본 증거는 영구 삭제할 수 없습니다.' }, { status: 409 });
      }
      const { count: allocationCount } = await supabaseAdmin
        .from('bank_transaction_allocations')
        .select('id', { count: 'exact', head: true })
        .eq('bank_transaction_id', transactionId);
      if ((allocationCount ?? 0) > 0) {
        return NextResponse.json({ error: '배정/원장 증거가 있는 거래는 영구 삭제할 수 없습니다.' }, { status: 409 });
      }
      await supabaseAdmin
        .from('bank_transactions')
        .delete()
        .eq('id', transactionId);
      return NextResponse.json({ success: true });
    }

    // ── trash_bulk: 다건 소프트 삭제 ─────────────────────────────────────
    if (action === 'trash_bulk') {
      const ids: string[] = body.ids || [];
      if (ids.length === 0) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });
      const { data: allocated } = await supabaseAdmin
        .from('bank_transaction_allocations')
        .select('bank_transaction_id')
        .in('bank_transaction_id', ids)
        .eq('status', 'active');
      const blocked = new Set(((allocated ?? []) as Array<{ bank_transaction_id: string }>).map(r => r.bank_transaction_id));
      const protectedIds = await getProtectedClobeTransactionIds(ids);
      for (const id of protectedIds) blocked.add(id);
      const allowed = ids.filter(id => !blocked.has(id));
      if (allowed.length === 0) {
        return NextResponse.json({ error: '선택 거래는 모두 배정 원장이 있어 제외할 수 없습니다.' }, { status: 409 });
      }
      await supabaseAdmin
        .from('bank_transactions')
        .update({ status: 'excluded', deleted_at: new Date().toISOString() })
        .in('id', allowed);
      return NextResponse.json({ success: true, count: allowed.length, blocked: blocked.size });
    }

    // ── restore_bulk: 다건 복원 ──────────────────────────────────────────
    if (action === 'restore_bulk') {
      const ids: string[] = body.ids || [];
      if (ids.length === 0) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });
      const protectedIds = await getProtectedClobeTransactionIds(ids);
      if (protectedIds.size > 0) {
        return NextResponse.json({ error: 'Clobe 보관 행은 수동 복원할 수 없습니다. 동기화를 이용하세요.' }, { status: 409 });
      }
      await supabaseAdmin
        .from('bank_transactions')
        .update({ status: 'active', deleted_at: null })
        .in('id', ids);
      return NextResponse.json({ success: true, count: ids.length });
    }

    // ── hard_delete_bulk: 다건 영구 삭제 ─────────────────────────────────
    if (action === 'hard_delete_bulk') {
      const ids: string[] = body.ids || [];
      if (ids.length === 0) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });
      const protectedIds = await getProtectedClobeTransactionIds(ids);
      if (protectedIds.size > 0) {
        return NextResponse.json({ error: 'Clobe 원본 증거가 포함되어 영구 삭제할 수 없습니다.' }, { status: 409 });
      }
      const { data: allocated } = await supabaseAdmin
        .from('bank_transaction_allocations')
        .select('bank_transaction_id')
        .in('bank_transaction_id', ids);
      if ((allocated ?? []).length > 0) {
        return NextResponse.json({ error: '배정/원장 증거가 있는 거래가 포함되어 영구 삭제할 수 없습니다.' }, { status: 409 });
      }
      await supabaseAdmin
        .from('bank_transactions')
        .delete()
        .in('id', ids);
      return NextResponse.json({ success: true, count: ids.length });
    }

    // ── fee: 수수료 단독 처리 ──────────────────────────────────────────────
    if (action === 'fee') {
      await supabaseAdmin
        .from('bank_transactions')
        .update({
          is_fee:       true,
          booking_id:   null,
          match_status: 'manual',
          matched_by:   'fee',
          matched_at:   new Date().toISOString(),
        })
        .eq('id', transactionId);

      return NextResponse.json({ success: true });
    }

    // ── undo: 롤백 + quick-create 고아 레코드 청소 ───────────────────────
    if (action === 'undo') {
      const { data: tx } = await supabaseAdmin
        .from('bank_transactions')
        .select('amount, transaction_type, is_refund, booking_id, source, external_provider')
        .eq('id', transactionId)
        .single();

      if (isClobeSource(tx)) {
        const reverseIdempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim()
          : `clobe-outflow-reverse:${transactionId}:${crypto.randomUUID()}`;
        const { data: result, error: reverseError } = await supabaseAdmin.rpc('reverse_clobe_outflow_allocations', {
          p_transaction_id: transactionId,
          p_idempotency_key: reverseIdempotencyKey,
          p_actor: actor,
          p_reason: typeof body.reason === 'string' ? body.reason.trim() || null : 'Clobe 출금 배정 재검토',
        });
        if (reverseError) {
          const status = (reverseError as { code?: string }).code === 'P0002' ? 404 : 409;
          return NextResponse.json({ error: sanitizeDbError(reverseError) }, { status });
        }
        return NextResponse.json({ success: true, clobeReversed: true, result });
      }

      const quickCleanup: { bookings: number; customers: number } = { bookings: 0, customers: 0 };

      const reversedCount = await reverseAllocationsForTransaction(transactionId, actor);

      if (tx && reversedCount === 0) {
        const t = tx as BankTxRow;
        if (t.booking_id) {
          await applyToBooking(t.booking_id, t.transaction_type, t.amount, t.is_refund, -1, {
            bankTxId: transactionId,
            createdBy: actor,
          });
        }
      }

      // 이 거래로 quick-create된 booking들 soft-delete (다른 매칭 없을 때만)
      const { data: quickBookings } = await supabaseAdmin
        .from('bookings')
        .select('id, lead_customer_id')
        .eq('quick_created_tx_id', transactionId)
        .eq('quick_created', true)
        .or('is_deleted.is.null,is_deleted.eq.false');

      const affectedCustomerIds = new Set<string>();
      for (const b of (quickBookings ?? []) as Array<{ id: string; lead_customer_id: string | null }>) {
        // 이 booking이 다른 입금에도 매칭돼 있으면 보존
        const { count: otherMatchCount } = await supabaseAdmin
          .from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('booking_id', b.id)
          .neq('id', transactionId)
          .neq('match_status', 'unmatched');

        if ((otherMatchCount ?? 0) > 0) continue;

        await supabaseAdmin
          .from('bookings')
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .eq('id', b.id);
        quickCleanup.bookings += 1;
        if (b.lead_customer_id) affectedCustomerIds.add(b.lead_customer_id);
      }

      // 이 거래로 quick-create된 customers soft-delete (자기 예약 외에 다른 예약 없을 때만)
      const { data: quickCustomers } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('quick_created_tx_id', transactionId)
        .eq('quick_created', true)
        .is('deleted_at', null);

      for (const c of (quickCustomers ?? []) as Array<{ id: string }>) {
        // 이 고객이 다른 (살아있는) 예약에 연결돼 있으면 보존
        const { count: liveBookingCount } = await supabaseAdmin
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('lead_customer_id', c.id)
          .or('is_deleted.is.null,is_deleted.eq.false');

        if ((liveBookingCount ?? 0) > 0) continue;

        await supabaseAdmin
          .from('customers')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', c.id);
        quickCleanup.customers += 1;
      }

      await supabaseAdmin
        .from('bank_transactions')
        .update({
          booking_id:       null,
          match_status:     'unmatched',
          match_confidence: 0,
          matched_by:       null,
          matched_at:       null,
          is_fee:           false,
        })
        .eq('id', transactionId);

      return NextResponse.json({ success: true, quickCleanup });
    }

    // ── multi: 다중 예약 분배 ─────────────────────────────────────────────
    if (action === 'multi') {
      const splits: { bookingId: string; amount: number }[] = body.splits || [];
      if (splits.length === 0) return NextResponse.json({ error: 'splits 필요' }, { status: 400 });

      // [하드닝] 각 split 유효성 검증
      for (const [idx, s] of splits.entries()) {
        if (!s.bookingId) return NextResponse.json({ error: `splits[${idx}].bookingId 필요` }, { status: 400 });
        if (!Number.isFinite(s.amount) || s.amount <= 0) {
          return NextResponse.json({ error: `splits[${idx}].amount는 양수여야 합니다 (현재: ${s.amount})` }, { status: 400 });
        }
      }

      // [하드닝] bookingId 중복 금지
      const bookingIdSet = new Set(splits.map(s => s.bookingId));
      if (bookingIdSet.size !== splits.length) {
        return NextResponse.json({ error: '같은 예약이 여러 split에 중복됐습니다' }, { status: 400 });
      }

      // [하드닝] 모든 bookingId 실재 확인
      const { data: existingBks } = await supabaseAdmin
        .from('bookings')
        .select('id')
        .in('id', [...bookingIdSet]);
      const existingIds = new Set((existingBks || []).map((b: { id: string }) => b.id));
      const missing = splits.filter(s => !existingIds.has(s.bookingId)).map(s => s.bookingId);
      if (missing.length > 0) {
        return NextResponse.json({ error: `존재하지 않는 예약 ID: ${missing.join(', ')}` }, { status: 400 });
      }

      const { data: txData } = await supabaseAdmin
        .from('bank_transactions')
        .select('amount, transaction_type, is_refund, counterparty_name')
        .eq('id', transactionId)
        .single();
      const txRow = txData as BankTxRow | null;
      if (!txRow) return NextResponse.json({ error: '거래를 찾을 수 없습니다' }, { status: 404 });

      const txAmount       = txRow.amount;
      const txType         = txRow.transaction_type;
      const isRefund       = txRow.is_refund;
      const counterpartyName = txRow.counterparty_name ?? undefined;

      const splitTotal = splits.reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount), 0);
      const diff = splitTotal - txAmount;

      // [하드닝] 초과 분할은 무조건 거부 (장부 조작 방어)
      if (diff > 0) {
        return NextResponse.json({
          error: `분배 합계(${splitTotal.toLocaleString()}원)가 거래 금액(${txAmount.toLocaleString()}원)을 ${diff.toLocaleString()}원 초과합니다. 초과 분할은 허용되지 않습니다.`,
        }, { status: 400 });
      }
      // 부족은 500원 허용 (부가세/은행수수료 반올림 오차 대응)
      if (diff < -500) {
        return NextResponse.json({
          error: `분배 합계(${splitTotal.toLocaleString()}원)가 거래 금액(${txAmount.toLocaleString()}원)보다 ${Math.abs(diff).toLocaleString()}원 부족합니다.`,
        }, { status: 400 });
      }

      await matchTransactionAllocations({
        transactionId,
        allocations: splits,
        confidence: 1,
        actor,
        notes: 'multi booking allocation',
      });

      for (const split of splits) {
        if (txType === '입금' && !isRefund) {
          learnAliasForMatch(split.bookingId, counterpartyName).catch(() => {});
        }
      }

      return NextResponse.json({ success: true });
    }

    // ── resync: 전체 예약 입금액 재계산 (기존 매칭 기준) ────────────────
    if (action === 'resync') {
      // Phase 2a — ledger 도 함께 보정하는 resync_paid_amounts_with_ledger 만 호출.
      // 이 RPC 는 bookings 갱신 + 기존 ledger 합계와의 차이를 manual_adjust 로 보정 INSERT 까지 atomic.
      const { data, error } = await supabaseAdmin.rpc('resync_paid_amounts_with_ledger');
      if (error) {
        console.error('[resync] RPC 실패:', error);
        return NextResponse.json(
          { error: `재동기화 RPC 실패: ${sanitizeDbError(error)}. 마이그레이션 적용 상태를 확인하세요.` },
          { status: 500 },
        );
      }
      return NextResponse.json(data ?? { updated: 0 });
    }

    // ── match (기본): 양방향 단일 매칭 ───────────────────────────────────
    const { bookingId, overflowAction } = body;
    if (!bookingId) return NextResponse.json({ error: 'bookingId 필요' }, { status: 400 });

    const { data: txData, error: txErr } = await supabaseAdmin
      .from('bank_transactions')
      .select('amount, transaction_type, is_refund, counterparty_name')
      .eq('id', transactionId)
      .single();

    if (txErr) throw txErr;
    const txRow = txData as BankTxRow | null;
    if (!txRow) throw new Error('매칭 후 거래 데이터를 찾을 수 없습니다');

    const txAmount         = txRow.amount;
    const txType           = txRow.transaction_type;
    const isRefund         = txRow.is_refund;
    const counterpartyName = txRow.counterparty_name ?? undefined;
    let bookingLedgerDelta = txAmount;
    let overflowMileage = 0;
    let overflowCustomerId: string | null = null;

    if (overflowAction === 'mileage' && txType === '입금' && !isRefund) {
      const { data: bk } = await supabaseAdmin
        .from('bookings')
        .select('total_price, paid_amount, lead_customer_id')
        .eq('id', bookingId)
        .single();

      if (bk) {
        const bkRow = bk as { total_price: number; paid_amount: number | null; lead_customer_id: string | null };
        const balance = Math.max(0, Number(bkRow.total_price ?? 0) - Number(bkRow.paid_amount ?? 0));
        bookingLedgerDelta = Math.min(txAmount, balance);
        overflowMileage = Math.max(0, txAmount - bookingLedgerDelta);
        overflowCustomerId = bkRow.lead_customer_id;
      }
    }

    await matchTransactionAllocations({
      transactionId,
      allocations: [{ bookingId, amount: txAmount, ledgerDelta: bookingLedgerDelta }],
      confidence: 1,
      actor,
      notes: 'manual payment match',
    });

    // Alias 학습 — 다음 같은 입금자가 오면 자동 매칭 신뢰도 +0.3
    if (txType === '입금' && !isRefund) {
      learnAliasForMatch(bookingId, counterpartyName).catch(() => {});
    }

    // 입금 매칭 시 마일리지 자동 적립 (등급 적립률 기반)
    if (txType === '입금' && !isRefund && bookingLedgerDelta > 0) {
      creditMileageForBooking(bookingId, bookingLedgerDelta, transactionId).catch(e =>
        console.warn('[마일리지 적립 실패]', e)
      );
    }

    // 과오납 마일리지 적립
    if (overflowAction === 'mileage' && txType === '입금') {
      const overflow = overflowMileage;
      if (overflow > 0 && overflowCustomerId) {
        await supabaseAdmin.from('mileage_transactions').insert({
          user_id: overflowCustomerId,
          booking_id: bookingId,
          amount: overflow,
          type: 'EARNED',
          margin_impact: 0,
          base_net_profit: 0,
          mileage_rate: 0,
          memo: `과오납 마일리지 전환: bank_tx=${transactionId}`,
        } as Record<string, unknown>);
        const { error: mileageErr } = await supabaseAdmin.rpc('increment_customer_mileage', {
          p_customer_id: overflowCustomerId,
          p_delta: overflow,
        });
        if (mileageErr) throw new Error(`마일리지 적립 실패: ${sanitizeDbError(mileageErr)}`);
        await supabaseAdmin.from('ops_events').insert({
          event_type: 'mileage_adjusted',
          severity: 'info',
          title: '과오납 마일리지 전환',
          description: `${overflow.toLocaleString('ko-KR')}P 적립`,
          booking_id: bookingId,
          customer_id: overflowCustomerId,
          bank_transaction_id: transactionId,
          target_type: 'customers',
          target_id: overflowCustomerId,
          status: 'resolved',
          metadata: { overflow, source: 'bank_transaction_match' },
          created_by: actor,
        } as Record<string, unknown>);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const status = typeof e === 'object' && e !== null && 'status' in e
      ? Number((e as { status?: number }).status) || 500
      : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '처리 실패' }, { status });
  }
}

// ─── POST: 과거 내역 일괄 등록 ────────────────────────────────────────────────

interface BulkRow {
  receivedAt: string;
  depositAmount: number;
  withdrawAmount: number;
  counterpartyName: string;
  memo: string;
  accountNumber?: string;
  originalLine?: string;
  rowIndex?: number;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const rows: BulkRow[] = body.rows || [];
    const preview: boolean = body.preview === true;

    if (rows.length === 0) return NextResponse.json({ error: '등록할 행이 없습니다.' }, { status: 400 });

    const results: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const isDeposit = row.depositAmount > 0;
      const amount    = isDeposit ? row.depositAmount : row.withdrawAmount;
      const txType: '입금' | '출금' = isDeposit ? '입금' : '출금';
      const parsed: ParsedTravelSettlementMemo | null = parseTravelSettlementMemo(row.memo);
      const fingerprint = buildBankTransactionFingerprint({
        accountNumber: row.accountNumber,
        receivedAt: row.receivedAt,
        txType,
        amount,
        counterpartyName: row.counterpartyName,
        memo: row.memo,
      });
      const duplicate = await findExistingBankTransaction({
        receivedAt: row.receivedAt,
        txType,
        amount,
        counterpartyName: row.counterpartyName,
        memo: row.memo,
        fingerprint,
      });

      let matchedBooking: {
        id: string;
        booking_no?: string | null;
        customer_name?: string | null;
      } | null = null;
      let confidence = 0;
      const matchReasons: string[] = [];
      let resolutionSource: string | null = null;

      if (parsed) {
        const resolution = await resolveSettlementMemoBooking(parsed, {
          createIfMissing: !preview && parsed.memoFormat === 'canonical',
        });
        resolutionSource = resolution.source;
        confidence = resolution.confidence;
        if (resolution.bookingId) {
          matchedBooking = {
            id: resolution.bookingId,
            booking_no: resolution.bookingNo,
            customer_name: resolution.customerName,
          };
          matchReasons.push(`memo_key:${parsed.normalizedKey}`, `source:${resolution.source}`);
        } else if (resolution.reason) {
          matchReasons.push(resolution.reason);
        }
      }

      const matchStatus: 'auto' | 'review' | 'unmatched' =
        !parsed ? 'unmatched' :
        !isDeposit ? 'review' :
        confidence >= 0.85 ? 'auto' : confidence >= 0.5 ? 'review' : 'unmatched';

      const eventId = `bulk_${fingerprint.replace(/^sha256:/, '')}`;
      const importAction =
        !parsed ? 'ignored_non_travel' :
        duplicate.kind === 'exact' ? 'already_processed' :
        duplicate.kind === 'probable' ? 'merge_candidate' :
        duplicate.row && duplicate.confidence >= 0.65 ? 'duplicate_review' :
        'insert';

      const previewRow = {
        receivedAt: row.receivedAt, type: txType, amount,
        counterpartyName: row.counterpartyName, memo: row.memo,
        matchStatus, confidence: Math.round(confidence * 100), matchReasons,
        bookingNo: matchedBooking?.booking_no, bookingId: matchedBooking?.id,
        customerName: matchedBooking?.customer_name, eventId,
        transactionFingerprint: fingerprint,
        importAction,
        resolutionSource,
        existingTxId: duplicate.row?.id ?? null,
        existingMatchStatus: duplicate.row?.match_status ?? null,
        duplicateConfidence: Math.round(duplicate.confidence * 100),
      };

      if (preview) { results.push(previewRow); continue; }

      if (!parsed) {
        results.push({ ...previewRow, status: 'skipped' });
        continue;
      }

      if (duplicate.kind === 'exact' && duplicate.row) {
        await attachBulkImportEvidence(duplicate.row.id, { fingerprint, row, eventId });
        results.push({ ...previewRow, status: 'merged', txId: duplicate.row.id });
        continue;
      }

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('bank_transactions')
        .insert([{
          slack_event_id: eventId, raw_message: `[일괄등록] ${row.memo}`,
          transaction_fingerprint: fingerprint,
          source: 'bulk_import',
          source_metadata: {
            bulk_import: {
              event_id: eventId,
              received_at: row.receivedAt,
              account_number: row.accountNumber ?? null,
              counterparty_name: row.counterpartyName,
              memo: row.memo,
              original_line: row.originalLine ?? null,
              row_index: row.rowIndex ?? null,
              settlement_key: parsed.normalizedKey,
              imported_at: new Date().toISOString(),
            },
          },
          transaction_type: txType, amount,
          counterparty_name: row.counterpartyName, memo: row.memo,
          received_at: row.receivedAt,
          booking_id: null,
          is_refund: false, is_fee: false, fee_amount: 0,
          match_status: matchStatus === 'auto' ? 'unmatched' : matchStatus,
          match_confidence: matchStatus === 'auto' ? 0 : confidence,
          matched_by: null,
          matched_at: null,
        } as Record<string, unknown>])
        .select('id').single();

      if (insertError?.code === '23505') { results.push({ ...previewRow, status: 'duplicate' }); continue; }
      if (insertError) { results.push({ ...previewRow, status: 'error', error: insertError.message }); continue; }

      if (matchStatus === 'auto' && matchedBooking && isDeposit) {
        const insertedId = (inserted as { id?: string })?.id;
        if (insertedId) await matchTransactionAllocations({
          transactionId: insertedId,
          allocations: [{ bookingId: matchedBooking.id, amount }],
          confidence,
          actor: 'bulk_retroactive',
          notes: `bulk insert auto-match ${txType}`,
        });
      }

      results.push({ ...previewRow, status: 'inserted', txId: (inserted as { id?: string })?.id });
    }

    if (preview) return NextResponse.json({ preview: true, rows: results });

    return NextResponse.json({
      inserted:   results.filter(r => r.status === 'inserted').length,
      skipped:    results.filter(r => r.status === 'skipped').length,
      duplicates: results.filter(r => r.status === 'duplicate').length,
      merged:     results.filter(r => r.status === 'merged').length,
      errors:     results.filter(r => r.status === 'error').length,
      matched:    results.filter(r => r.status === 'inserted' && r.matchStatus === 'auto').length,
      firstError: (results.find(r => r.status === 'error') as { error?: string } | undefined)?.error || null,
      results,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '일괄 등록 실패' }, { status: 500 });
  }
}
