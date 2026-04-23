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

// 매칭 성공 후 counterparty_name ↔ customer 매핑 학습 (best-effort)
async function learnAliasForMatch(bookingId: string, counterpartyName: string | undefined | null) {
  if (!counterpartyName) return;
  try {
    const { data: bk } = await supabaseAdmin
      .from('bookings')
      .select('lead_customer_id')
      .eq('id', bookingId)
      .maybeSingle();
    const customerId = (bk as any)?.lead_customer_id;
    if (!customerId) return;
    await learnAlias({ customerId, alias: counterpartyName, source: 'manual_match' });
  } catch (e) {
    console.warn('[bank-transactions] alias 학습 실패 (무시):', (e as any)?.message);
  }
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

  return (data || []).map((b: any) => ({
    ...b,
    customer_name: b.customers?.name,
  }));
}

/** JS fallback: RPC 없을 때 순수 JS로 재계산 */
async function resyncFallback(): Promise<{ updated: number; errors?: string[] }> {
  const { data: matched } = await supabaseAdmin
    .from('bank_transactions')
    .select('booking_id, transaction_type, amount, is_refund, is_fee')
    .in('match_status', ['auto', 'manual'])
    .not('booking_id', 'is', null);

  if (!matched || matched.length === 0) return { updated: 0 };

  const bookingMap = new Map<string, { paidIn: number; paidOut: number }>();
  for (const tx of matched as any[]) {
    if (!tx.booking_id || tx.is_fee) continue;
    if (!bookingMap.has(tx.booking_id)) bookingMap.set(tx.booking_id, { paidIn: 0, paidOut: 0 });
    const e = bookingMap.get(tx.booking_id)!;
    if (tx.transaction_type === '입금' && !tx.is_refund) e.paidIn += tx.amount;
    else if (tx.transaction_type === '출금' && !tx.is_refund) e.paidOut += tx.amount;
    else if (tx.is_refund) e.paidIn = Math.max(0, e.paidIn - tx.amount);
  }

  const errors: string[] = [];
  let updated = 0;
  for (const [bookingId, { paidIn, paidOut }] of bookingMap.entries()) {
    const paidAmount   = Math.max(0, paidIn);
    const totalPaidOut = Math.max(0, paidOut);

    const { error } = await supabaseAdmin
      .from('bookings')
      .update({ paid_amount: paidAmount, total_paid_out: totalPaidOut, updated_at: new Date().toISOString() })
      .eq('id', bookingId);

    if (error) errors.push(`${bookingId}: ${error.message}`);
    else updated++;
  }
  return { updated, ...(errors.length > 0 ? { errors } : {}) };
}

/** 예약 paid_amount / total_paid_out 업데이트 + 4단계 자동 진행 + 타임라인 로그 */
async function applyToBooking(
  bookingId: string,
  txType: '입금' | '출금',
  amount: number,
  isRefund: boolean,
  delta: number = 1, // +1 적용, -1 롤백
  meta?: { counterpartyName?: string },
) {
  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('total_price, total_cost, paid_amount, total_paid_out, status')
    .eq('id', bookingId)
    .single();

  if (!b) return;

  const book = b as any;
  let paidAmount   = book.paid_amount   || 0;
  let totalPaidOut = book.total_paid_out || 0;
  const totalPrice = book.total_price   || 0;

  if (txType === '입금' && !isRefund) {
    paidAmount = Math.max(0, paidAmount + amount * delta);
  } else if (txType === '출금' && !isRefund) {
    totalPaidOut = Math.max(0, totalPaidOut + amount * delta);
  } else if (isRefund) {
    paidAmount = Math.max(0, paidAmount - amount * delta);
  }

  // ── 4단계 자동 상태 진행 (적용 시에만, 취소된 예약 제외) ──────────────────
  let newStatus: string | null = null;
  const curStatus = book.status as string;
  if (delta === 1 && curStatus !== 'cancelled') {
    if (txType === '입금' && !isRefund) {
      if (paidAmount >= totalPrice && totalPrice > 0) {
        if (curStatus !== 'completed') newStatus = 'completed';
      } else if (paidAmount > 0) {
        if (curStatus === 'pending') newStatus = 'confirmed';
      }
    }
  }

  const updatePayload: Record<string, unknown> = {
    paid_amount:    paidAmount,
    total_paid_out: totalPaidOut,
    updated_at:     new Date().toISOString(),
  };
  if (newStatus) updatePayload.status = newStatus;

  const { error: updateErr } = await supabaseAdmin
    .from('bookings')
    .update(updatePayload)
    .eq('id', bookingId);

  if (updateErr) {
    console.error('[applyToBooking] UPDATE 실패:', bookingId, updateErr.message);
    return;
  }

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
          } as never);
      } catch {
        // 테이블 미존재 시 무시
      }
    }
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') ?? 'active';   // active | excluded | all
  const aggregate    = searchParams.get('aggregate');             // 'monthly'
  const months       = parseInt(searchParams.get('months') || '6', 10);
  const bookingId    = searchParams.get('booking_id');            // 예약별 입금 필터
  const matchStatus  = searchParams.get('match_status');          // 'unmatched' → 전체 기간 미매칭 조회

  // ── 월별 집계 (Recharts 차트 데이터용) ────────────────────────────────────
  if (aggregate === 'monthly') {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const { data: txs } = await supabaseAdmin
      .from('bank_transactions')
      .select('transaction_type, amount, received_at')
      .neq('status', 'excluded')
      .gte('received_at', cutoff.toISOString())
      .order('received_at', { ascending: true })
      .limit(5000);

    const map = new Map<string, { income: number; expense: number }>();
    for (const tx of (txs || []) as any[]) {
      const key = (tx.received_at as string).slice(0, 7);
      if (!map.has(key)) map.set(key, { income: 0, expense: 0 });
      const e = map.get(key)!;
      if (tx.transaction_type === '입금') e.income += tx.amount;
      else e.expense += tx.amount;
    }
    const chartData = Array.from(map.entries())
      .map(([month, { income, expense }]) => ({ month, income, expense, net: income - expense }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return NextResponse.json({ chartData });
  }

  // ── 미매칭 전체 기간 조회 (limit 없음) ────────────────────────────────────
  if (matchStatus === 'unmatched') {
    const { data: unmatchedData, error: unmatchedError } = await supabaseAdmin
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

    if (unmatchedError) return NextResponse.json({ error: unmatchedError.message }, { status: 500 });
    return NextResponse.json({ transactions: unmatchedData || [] });
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
  }

  if (bookingId) query = query.eq('booking_id', bookingId) as typeof query;

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transactions: data || [] });
}

// ─── PUT: 원클릭 일괄 자동 매칭 ──────────────────────────────────────────────

export async function PUT() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    // 미매칭 건 전체 로드
    const { data: unmatched } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, counterparty_name, is_refund')
      .eq('match_status', 'unmatched');

    if (!unmatched || unmatched.length === 0) {
      return NextResponse.json({ matched: 0, skipped: 0 });
    }

    const bookings = await loadActiveBookings();
    let matched = 0;
    let skipped = 0;

    for (const tx of unmatched as any[]) {
      if (tx.transaction_type !== '입금') { skipped++; continue; }

      const candidates = matchPaymentToBookings({
        amount: tx.amount,
        senderName: tx.counterparty_name,
        bookings,
      });
      const guarded = applyDuplicateNameGuard(candidates);
      const best = guarded[0];
      if (!best || best.confidence < AUTO_THRESHOLD) { skipped++; continue; }

      // DB 업데이트
      await supabaseAdmin
        .from('bank_transactions')
        .update({
          booking_id:       best.booking.id,
          match_status:     'auto',
          match_confidence: best.confidence,
          matched_by:       'auto',
          matched_at:       new Date().toISOString(),
        })
        .eq('id', tx.id);

      await applyToBooking(best.booking.id, tx.transaction_type, tx.amount, tx.is_refund, 1, { counterpartyName: tx.counterparty_name });
      matched++;
    }

    return NextResponse.json({ matched, skipped });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '처리 실패' }, { status: 500 });
  }
}

// ─── PATCH: action 분기 ───────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const { action = 'match', transactionId } = body;

    const BULK_ACTIONS = ['trash_bulk', 'restore_bulk', 'hard_delete_bulk'];
    if (!transactionId && action !== 'resync' && !BULK_ACTIONS.includes(action))
      return NextResponse.json({ error: 'transactionId 필요' }, { status: 400 });

    // ── trash: 단건 소프트 삭제 ────────────────────────────────────────────
    if (action === 'trash') {
      await supabaseAdmin
        .from('bank_transactions')
        .update({ status: 'excluded', deleted_at: new Date().toISOString() })
        .eq('id', transactionId);
      return NextResponse.json({ success: true });
    }

    // ── restore: 단건 복원 ────────────────────────────────────────────────
    if (action === 'restore') {
      await supabaseAdmin
        .from('bank_transactions')
        .update({ status: 'active', deleted_at: null })
        .eq('id', transactionId);
      return NextResponse.json({ success: true });
    }

    // ── hard_delete: 단건 영구 삭제 ──────────────────────────────────────
    if (action === 'hard_delete') {
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
      await supabaseAdmin
        .from('bank_transactions')
        .update({ status: 'excluded', deleted_at: new Date().toISOString() })
        .in('id', ids);
      return NextResponse.json({ success: true, count: ids.length });
    }

    // ── restore_bulk: 다건 복원 ──────────────────────────────────────────
    if (action === 'restore_bulk') {
      const ids: string[] = body.ids || [];
      if (ids.length === 0) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });
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
        .select('amount, transaction_type, is_refund, booking_id')
        .eq('id', transactionId)
        .single();

      const quickCleanup: { bookings: number; customers: number } = { bookings: 0, customers: 0 };

      if (tx) {
        const t = tx as any;
        if (t.booking_id) {
          await applyToBooking(t.booking_id, t.transaction_type, t.amount, t.is_refund, -1);
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

      const { data: txData } = await supabaseAdmin
        .from('bank_transactions')
        .select('amount, transaction_type, is_refund, counterparty_name')
        .eq('id', transactionId)
        .single();

      const txAmount       = (txData as any)?.amount || 0;
      const txType         = (txData as any)?.transaction_type as '입금' | '출금';
      const isRefund       = (txData as any)?.is_refund || false;
      const counterpartyName = (txData as any)?.counterparty_name ?? undefined;

      const splitTotal = splits.reduce((s, r) => s + r.amount, 0);
      if (Math.abs(splitTotal - txAmount) > 500) {
        return NextResponse.json({ error: `분배 합계(${splitTotal.toLocaleString()})가 거래 금액(${txAmount.toLocaleString()})과 일치하지 않습니다.` }, { status: 400 });
      }

      for (const split of splits) {
        await applyToBooking(split.bookingId, txType, split.amount, isRefund, 1, { counterpartyName });
        // 다중 매칭도 학습 대상 — 모든 split 예약 고객에 대해 alias 저장
        if (txType === '입금' && !isRefund) {
          learnAliasForMatch(split.bookingId, counterpartyName).catch(() => {});
        }
      }

      await supabaseAdmin
        .from('bank_transactions')
        .update({
          booking_id:       splits[0].bookingId,
          match_status:     'manual',
          match_confidence: 1.0,
          matched_by:       'multi',
          matched_at:       new Date().toISOString(),
        })
        .eq('id', transactionId);

      return NextResponse.json({ success: true });
    }

    // ── resync: 전체 예약 입금액 재계산 (기존 매칭 기준) ────────────────
    if (action === 'resync') {
      // DB 함수로 원자적 재계산 (JS 클라이언트 우회)
      const { data, error } = await supabaseAdmin.rpc('resync_paid_amounts');
      if (error) {
        // RPC 없으면 JS fallback
        console.warn('[resync] RPC 실패, JS fallback 실행:', error.message);
        return NextResponse.json(await resyncFallback());
      }
      return NextResponse.json({ updated: data ?? 0 });
    }

    // ── match (기본): 양방향 단일 매칭 ───────────────────────────────────
    const { bookingId, overflowAction } = body;
    if (!bookingId) return NextResponse.json({ error: 'bookingId 필요' }, { status: 400 });

    const { data: txData, error: txErr } = await supabaseAdmin
      .from('bank_transactions')
      .update({
        booking_id:       bookingId,
        match_status:     'manual',
        match_confidence: 1.0,
        matched_by:       'manual',
        matched_at:       new Date().toISOString(),
      })
      .eq('id', transactionId)
      .select('amount, transaction_type, is_refund, counterparty_name')
      .single();

    if (txErr) throw txErr;

    const txAmount         = (txData as any)?.amount || 0;
    const txType           = (txData as any)?.transaction_type as '입금' | '출금';
    const isRefund         = (txData as any)?.is_refund || false;
    const counterpartyName = (txData as any)?.counterparty_name ?? undefined;

    await applyToBooking(bookingId, txType, txAmount, isRefund, 1, { counterpartyName });

    // Alias 학습 — 다음 같은 입금자가 오면 자동 매칭 신뢰도 +0.3
    if (txType === '입금' && !isRefund) {
      learnAliasForMatch(bookingId, counterpartyName).catch(() => {});
    }

    // 입금 매칭 시 마일리지 자동 적립 (등급 적립률 기반)
    if (txType === '입금' && !isRefund) {
      creditMileageForBooking(bookingId, txAmount, transactionId).catch(e =>
        console.warn('[마일리지 적립 실패]', e)
      );
    }

    // 과오납 마일리지 적립
    if (overflowAction === 'mileage' && txType === '입금') {
      const { data: bk } = await supabaseAdmin
        .from('bookings')
        .select('total_price, lead_customer_id')
        .eq('id', bookingId)
        .single();

      if (bk) {
        const { data: bkAfter } = await supabaseAdmin
          .from('bookings')
          .select('paid_amount')
          .eq('id', bookingId)
          .single();

        const overflow = Math.max(0, ((bkAfter as any)?.paid_amount || 0) - ((bk as any)?.total_price || 0));
        if (overflow > 0 && (bk as any)?.lead_customer_id) {
          const { data: cust } = await supabaseAdmin
            .from('customers')
            .select('mileage')
            .eq('id', (bk as any).lead_customer_id)
            .single();

          await supabaseAdmin
            .from('customers')
            .update({ mileage: ((cust as any)?.mileage || 0) + overflow })
            .eq('id', (bk as any).lead_customer_id);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '처리 실패' }, { status: 500 });
  }
}

// ─── POST: 과거 내역 일괄 등록 ────────────────────────────────────────────────

function parseBulkMemo(memo: string) {
  const parts = memo.split('_');
  if (parts.length < 3) return null;
  const [yymmdd, customerName, ...agencyParts] = parts;
  if (!/^\d{6}$/.test(yymmdd)) return null;
  return {
    departureDatePrefix: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
    customerName,
    agencyName: agencyParts.join('_'),
  };
}

interface BulkRow {
  receivedAt: string;
  depositAmount: number;
  withdrawAmount: number;
  counterpartyName: string;
  memo: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const rows: BulkRow[] = body.rows || [];
    const preview: boolean = body.preview === true;

    if (rows.length === 0) return NextResponse.json({ error: '등록할 행이 없습니다.' }, { status: 400 });

    const { data: bookingsRaw } = await supabaseAdmin
      .from('bookings')
      .select(`
        id, booking_no, package_title,
        total_price, total_cost, paid_amount, total_paid_out,
        departure_date, status, payment_status,
        customers!lead_customer_id(name)
      `)
      .in('status', ['pending', 'confirmed', 'completed']);

    const bookings = (bookingsRaw || []).map((b: any) => ({ ...b, customer_name: b.customers?.name }));

    const results: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const isDeposit = row.depositAmount > 0;
      const amount    = isDeposit ? row.depositAmount : row.withdrawAmount;
      const txType: '입금' | '출금' = isDeposit ? '입금' : '출금';
      const parsed = parseBulkMemo(row.memo);

      let matchedBooking: typeof bookings[0] | null = null;
      let confidence = 0;
      const matchReasons: string[] = [];

      if (parsed) {
        let best = 0;
        for (const b of bookings) {
          let score = 0;
          if (b.departure_date?.startsWith(parsed.departureDatePrefix)) score += 0.4;
          const ns = nameSim(b.customer_name || '', parsed.customerName);
          if (ns > 0) score += ns * 0.5;
          if (score > best) { best = score; matchedBooking = b; confidence = score; }
        }
        if (confidence < 0.5) { matchedBooking = null; confidence = 0; }
      }

      const matchStatus: 'auto' | 'review' | 'unmatched' =
        confidence >= 0.85 ? 'auto' : confidence >= 0.5 ? 'review' : 'unmatched';

      const eventId = `bulk_${row.receivedAt}_${row.counterpartyName}_${amount}`.replace(/\s+/g, '_');

      const previewRow = {
        receivedAt: row.receivedAt, type: txType, amount,
        counterpartyName: row.counterpartyName, memo: row.memo,
        matchStatus, confidence: Math.round(confidence * 100), matchReasons,
        bookingNo: matchedBooking?.booking_no, bookingId: matchedBooking?.id,
        customerName: matchedBooking?.customer_name, eventId,
      };

      if (preview) { results.push(previewRow); continue; }

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('bank_transactions')
        .insert([{
          slack_event_id: eventId, raw_message: `[일괄등록] ${row.memo}`,
          transaction_type: txType, amount,
          counterparty_name: row.counterpartyName, memo: row.memo,
          received_at: row.receivedAt,
          booking_id: matchStatus === 'auto' ? (matchedBooking?.id ?? null) : null,
          is_refund: false, is_fee: false, fee_amount: 0,
          match_status: matchStatus, match_confidence: confidence,
          matched_by: matchStatus === 'auto' ? 'retroactive' : null,
          matched_at: matchStatus === 'auto' ? new Date().toISOString() : null,
        }])
        .select('id').single();

      if (insertError?.code === '23505') { results.push({ ...previewRow, status: 'duplicate' }); continue; }
      if (insertError) { results.push({ ...previewRow, status: 'error', error: insertError.message }); continue; }

      if (matchStatus === 'auto' && matchedBooking) {
        const b = matchedBooking as any;
        let pa = b.paid_amount || 0, po = b.total_paid_out || 0;
        if (txType === '입금') pa += amount; else po += amount;
        const tp = b.total_price || 0;
        await supabaseAdmin.from('bookings').update({
          paid_amount: pa, total_paid_out: po,
          payment_status: pa >= tp && tp > 0 ? '완납' : pa > 0 ? '일부입금' : '미입금',
          updated_at: new Date().toISOString(),
        }).eq('id', matchedBooking.id);
      }

      results.push({ ...previewRow, status: 'inserted', txId: (inserted as any)?.id });
    }

    if (preview) return NextResponse.json({ preview: true, rows: results });

    return NextResponse.json({
      inserted:   results.filter(r => r.status === 'inserted').length,
      duplicates: results.filter(r => r.status === 'duplicate').length,
      errors:     results.filter(r => r.status === 'error').length,
      matched:    results.filter(r => r.status === 'inserted' && r.matchStatus === 'auto').length,
      firstError: (results.find(r => r.status === 'error') as any)?.error || null,
      results,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '일괄 등록 실패' }, { status: 500 });
  }
}
