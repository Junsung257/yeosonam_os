import { NextResponse, type NextRequest } from 'next/server';

import { getAdminContext } from '@/lib/admin-context';
import { requireAdminRequest } from '@/lib/admin-guard';
import { requireSuperAdminRequest } from '@/lib/admin-role';
import {
  detectPostCloseSettlementChanges,
  loadFinanceCenterSummary,
  loadMonthlySettlementPreview,
} from '@/lib/finance-center-service';
import { assertCompletedSettlementMonth, type MonthlyCloseReviewReason } from '@/lib/monthly-settlement-close';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REASON_TO_EXCEPTION: Record<MonthlyCloseReviewReason, string> = {
  no_bank_evidence: 'no_bank_evidence',
  allocation_drift: 'allocation_drift',
  zero_cash_margin: 'zero_margin',
  negative_cash_margin: 'negative_margin',
};

function readMonth(value: unknown): string {
  if (typeof value !== 'string') throw new Error('마감할 출발 월을 선택해주세요.');
  assertCompletedSettlementMonth(value);
  return value;
}

async function guard(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await guard(request);
  if (authError) return authError;

  try {
    const monthValue = request.nextUrl.searchParams.get('month');
    const month = monthValue ? readMonth(monthValue) : null;
    const [preview, periodsResult, exceptionsResult] = await Promise.all([
      month ? loadMonthlySettlementPreview(month) : Promise.resolve(null),
      supabaseAdmin
        .from('settlement_periods')
        .select('*')
        .order('departure_month', { ascending: false })
        .order('revision', { ascending: false })
        .limit(120),
      supabaseAdmin
        .from('settlement_period_exceptions')
        .select('id, settlement_period_id, departure_month, booking_id, bank_transaction_id, exception_type, status, assigned_to, reason, due_date, payload, created_at, updated_at')
        .eq('status', 'open')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(500),
    ]);
    if (periodsResult.error) throw periodsResult.error;
    if (exceptionsResult.error) throw exceptionsResult.error;

    return NextResponse.json({
      preview,
      periods: periodsResult.data ?? [],
      exceptions: exceptionsResult.data ?? [],
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '월 마감 정보를 불러오지 못했습니다.';
    return NextResponse.json(
      { error: message },
      { status: /월|YYYY-MM|연도/.test(message) ? 400 : 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await guard(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  if (body.action === 'reopen') {
    const superAdminError = await requireSuperAdminRequest(request);
    if (superAdminError) return superAdminError;
    try {
      const month = readMonth(body.month);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason) return NextResponse.json({ error: '재개방 사유를 입력해주세요.' }, { status: 400 });
      const context = getAdminContext(request);
      const { data, error } = await supabaseAdmin.rpc('reopen_finance_settlement_period', {
        p_departure_month: `${month}-01`,
        p_reason: reason,
        p_actor: context.userId,
        p_actor_label: context.actor,
      });
      if (error) throw error;
      return NextResponse.json({ success: true, periodId: data });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '월 마감을 재개방하지 못했습니다.' },
        { status: 500 },
      );
    }
  }

  if (body.action !== 'close') {
    return NextResponse.json({ error: '지원하지 않는 월 마감 작업입니다.' }, { status: 400 });
  }

  try {
    const month = readMonth(body.month);
    const closeStatus = body.closeStatus === 'conditional' ? 'conditional' : 'closed';
    const preview = await loadMonthlySettlementPreview(month);
    if (body.expectedFingerprint !== preview.candidateFingerprint) {
      return NextResponse.json({
        error: '미리보기 후 통장 또는 예약 정보가 바뀌었습니다. 최신 내역을 확인해주세요.',
        preview,
      }, { status: 409 });
    }

    const expectedBookingIds = Array.isArray(body.expectedBookingIds)
      ? body.expectedBookingIds.filter((value: unknown): value is string => typeof value === 'string').sort()
      : [];
    const currentBookingIds = preview.eligible.map(row => row.bookingId).sort();
    if (expectedBookingIds.length !== currentBookingIds.length
      || currentBookingIds.some((id, index) => id !== expectedBookingIds[index])) {
      return NextResponse.json({ error: '마감 대상 예약이 달라졌습니다. 새로 계산해주세요.', preview }, { status: 409 });
    }

    if (closeStatus === 'closed' && preview.review.length > 0) {
      return NextResponse.json({
        error: `검토 예외 ${preview.review.length}건이 남아 있습니다. 해결하거나 조건부 마감을 선택해주세요.`,
        preview,
      }, { status: 400 });
    }

    const exceptionOwner = typeof body.exceptionOwner === 'string' ? body.exceptionOwner.trim() : '';
    const exceptionReason = typeof body.exceptionReason === 'string' ? body.exceptionReason.trim() : '';
    const exceptionDueDate = typeof body.exceptionDueDate === 'string' ? body.exceptionDueDate : '';
    if (closeStatus === 'conditional' && preview.review.length > 0
      && (!exceptionOwner || !exceptionReason || !/^\d{4}-\d{2}-\d{2}$/.test(exceptionDueDate))) {
      return NextResponse.json({ error: '조건부 마감에는 예외 담당자·사유·처리기한이 모두 필요합니다.' }, { status: 400 });
    }

    const summary = await loadFinanceCenterSummary();
    const context = getAdminContext(request);
    const items = preview.eligible.map(row => ({
      booking_id: row.bookingId,
      booking_no: row.bookingNo,
      customer_name: null,
      package_title: row.packageTitle,
      departure_date: row.departureDate,
      deposits: row.deposits,
      withdrawals: row.withdrawals,
      cash_margin: row.cashNet,
      allocation_count: row.allocationCount,
      transaction_ids: row.transactionIds,
      transaction_fingerprint: row.transactionFingerprint,
      snapshot: { close_basis: 'clobe_cash', source: 'clobe_mcp', account_number: summary.accountNumber, fingerprint_version: 2 },
    }));
    const exceptions = closeStatus === 'conditional'
      ? preview.review.map(row => ({
        booking_id: row.bookingId,
        exception_type: REASON_TO_EXCEPTION[row.reason ?? 'no_bank_evidence'],
        assigned_to: exceptionOwner,
        reason: exceptionReason,
        due_date: exceptionDueDate,
        source_fingerprint: row.transactionFingerprint,
        payload: {
          booking_no: row.bookingNo,
          departure_date: row.departureDate,
          deposits: row.deposits,
          withdrawals: row.withdrawals,
          cash_margin: row.cashNet,
        },
      }))
      : [];
    const reviewFingerprint = preview.review
      .map(row => `${row.bookingId}:${row.reason}:${row.transactionFingerprint}`)
      .sort()
      .join('|');
    const uniqueTransactionCount = new Set(preview.eligible.flatMap(row => row.transactionIds)).size;

    const { data, error } = await supabaseAdmin.rpc('close_finance_settlement_period', {
      p_departure_month: `${month}-01`,
      p_status: closeStatus,
      p_sync_cutoff_at: summary.status.lastSyncAt,
      p_source_fingerprint: preview.candidateFingerprint,
      p_review_fingerprint: reviewFingerprint,
      p_source_transaction_count: uniqueTransactionCount,
      p_items: items,
      p_exceptions: exceptions,
      p_actor: context.userId,
      p_actor_label: context.actor,
      p_bank_balance: summary.status.bankBalance,
      p_os_balance: summary.status.osBalance,
    });
    if (error) throw error;

    return NextResponse.json({
      success: true,
      periodId: data,
      closed: {
        month,
        status: closeStatus,
        bookingCount: items.length,
        deposits: preview.summary.eligibleDeposits,
        withdrawals: preview.summary.eligibleWithdrawals,
        cashMargin: preview.summary.eligibleProfit,
        exceptionCount: exceptions.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '월 마감을 확정하지 못했습니다.';
    return NextResponse.json(
      { error: message },
      { status: /locked|잠금/.test(message) ? 409 : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await guard(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'detect_post_close_changes') {
      const result = await detectPostCloseSettlementChanges();
      return NextResponse.json({ success: true, ...result });
    }

    const exceptionId = typeof body.exceptionId === 'string' ? body.exceptionId : '';
    if (!exceptionId) return NextResponse.json({ error: '처리할 예외를 선택해주세요.' }, { status: 400 });
    const status = body.status === 'resolved' || body.status === 'waived' ? body.status : 'open';
    const context = getAdminContext(request);
    const update: Record<string, unknown> = {
      status,
      assigned_to: typeof body.assignedTo === 'string' ? body.assignedTo.trim() || null : null,
      reason: typeof body.reason === 'string' ? body.reason.trim() || null : null,
      due_date: typeof body.dueDate === 'string' && body.dueDate ? body.dueDate : null,
    };
    if (status !== 'open') {
      update.resolved_at = new Date().toISOString();
      update.resolved_by = context.actor;
    }
    const { error } = await supabaseAdmin
      .from('settlement_period_exceptions')
      .update(update)
      .eq('id', exceptionId);
    if (error) throw error;
    return NextResponse.json({ success: true, exceptionId, status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '정산 예외를 저장하지 못했습니다.' },
      { status: 500 },
    );
  }
}
