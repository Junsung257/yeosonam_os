import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { getAdminContext } from '@/lib/admin-context';
import {
  assertCompletedSettlementMonth,
  calculateMonthlySettlementClosePreview,
  settlementMonthBounds,
  type MonthlyCloseAllocation,
  type MonthlyCloseBooking,
  type MonthlyCloseTransaction,
  type MonthlySettlementClosePreview,
} from '@/lib/monthly-settlement-close';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER } from '@/lib/bank-account-reality';

export const runtime = 'nodejs';

const MAX_CLOSE_BOOKINGS = 500;

function chunkIds(ids: string[], size = 100): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

function readMonth(value: unknown): string {
  if (typeof value !== 'string') throw new Error('마감할 출발 월을 선택해주세요.');
  assertCompletedSettlementMonth(value);
  return value;
}

async function loadPreview(month: string): Promise<MonthlySettlementClosePreview> {
  const { endDate: throughDate } = settlementMonthBounds(month);

  const [transactionResult, bookingResult] = await Promise.all([
    supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount')
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('status', 'active')
      .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
      .eq('settlement_scope', 'travel')
      .limit(5000),
    supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, departure_date, status, is_deleted, settlement_confirmed_at, settlement_mode')
      .lte('departure_date', throughDate)
      .limit(5000),
  ]);

  if (transactionResult.error) throw transactionResult.error;
  if (bookingResult.error) throw bookingResult.error;

  const transactions = (transactionResult.data ?? []) as MonthlyCloseTransaction[];
  const allocations: MonthlyCloseAllocation[] = [];
  for (const ids of chunkIds(transactions.map(row => row.id))) {
    const { data, error } = await supabaseAdmin
      .from('bank_transaction_allocations')
      .select('bank_transaction_id, booking_id, allocated_amount')
      .in('bank_transaction_id', ids)
      .eq('status', 'active')
      .is('reversed_at', null);
    if (error) throw error;
    allocations.push(...((data ?? []) as MonthlyCloseAllocation[]));
  }

  return calculateMonthlySettlementClosePreview({
    month,
    transactions,
    allocations,
    bookings: (bookingResult.data ?? []) as MonthlyCloseBooking[],
  });
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  try {
    const month = readMonth(request.nextUrl.searchParams.get('month'));
    const preview = await loadPreview(month);
    return NextResponse.json({ preview }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '월 마감 미리보기를 불러오지 못했습니다.';
    const status = /월|YYYY-MM|연도/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 500 });
  }

  let body: { month?: unknown; expectedBookingIds?: unknown; expectedCandidateFingerprint?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  try {
    const month = readMonth(body.month);
    if (!Array.isArray(body.expectedBookingIds)) {
      return NextResponse.json({ error: '미리보기 대상이 없습니다. 새로고침 후 다시 시도해주세요.' }, { status: 400 });
    }
    const expectedBookingIds = body.expectedBookingIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, MAX_CLOSE_BOOKINGS)
      .sort();
    if (expectedBookingIds.length !== body.expectedBookingIds.length) {
      return NextResponse.json({ error: '마감 대상이 올바르지 않거나 너무 많습니다.' }, { status: 400 });
    }

    const before = await loadPreview(month);
    const currentBookingIds = before.eligible.map(row => row.bookingId).sort();
    if (
      body.expectedCandidateFingerprint !== before.candidateFingerprint
      ||
      currentBookingIds.length !== expectedBookingIds.length
      || currentBookingIds.some((id, index) => id !== expectedBookingIds[index])
    ) {
      return NextResponse.json({
        error: '미리보기 후 통장 또는 예약 정보가 바뀌었습니다. 최신 내역을 확인한 뒤 다시 확정해주세요.',
        preview: before,
      }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    }

    if (currentBookingIds.length === 0) {
      return NextResponse.json({
        result: { requested: 0, confirmed: 0, auditRecorded: true },
        preview: before,
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const context = getAdminContext(request);
    const now = new Date().toISOString();
    const actor = `monthly_cash_close:${context.actor}`.slice(0, 240);
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({
        settlement_confirmed_at: now,
        settlement_confirmed_by: actor,
        settlement_mode: 'cash',
        status: 'completed',
        payment_status: '완납',
        updated_at: now,
      })
      .in('id', currentBookingIds)
      .is('settlement_confirmed_at', null)
      .select('id, booking_no');
    if (error) throw error;

    const confirmedRows = (data ?? []) as Array<{ id: string; booking_no: string | null }>;
    const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
      user_id: context.userId,
      action: 'MONTHLY_CASH_SETTLEMENT_CLOSE',
      target_type: 'booking_month',
      target_id: month,
      description: `${month}까지 Clobe 통장 기준 월 정산확정: ${confirmedRows.length}/${currentBookingIds.length}건`,
      before_value: {
        month,
        through_date: before.throughDate,
        eligible_count: before.summary.eligibleCount,
        eligible_profit: before.summary.eligibleProfit,
        review_count: before.summary.reviewCount,
      },
      after_value: {
        confirmed_at: now,
        confirmed_by: actor,
        confirmed_count: confirmedRows.length,
        booking_ids: confirmedRows.map(row => row.id),
        booking_nos: confirmedRows.map(row => row.booking_no),
      },
    } as never);
    if (auditError) {
      console.error('[monthly-settlement-close] audit log failed:', auditError.message);
    }

    const preview = await loadPreview(month);
    return NextResponse.json({
      result: {
        requested: currentBookingIds.length,
        confirmed: confirmedRows.length,
        confirmedProfit: before.summary.eligibleProfit,
        auditRecorded: !auditError,
      },
      preview,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '월 정산확정에 실패했습니다.';
    const status = /월|YYYY-MM|연도/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
