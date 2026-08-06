import { NextResponse, type NextRequest } from 'next/server';

import { getAdminContext } from '@/lib/admin-context';
import { requireAdminRequest } from '@/lib/admin-guard';
import {
  FINANCE_ALLOCATION_TARGETS,
  validateBreakdownTotal,
  type FinanceAllocationTarget,
} from '@/lib/finance-settlement-v3';
import { loadFinanceTransactionBreakdown } from '@/lib/finance-settlement-v3-service';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function guard(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }
  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await guard(request);
  if (authError) return authError;
  try {
    const { id } = await context.params;
    const breakdown = await loadFinanceTransactionBreakdown(id);
    if (!breakdown) return NextResponse.json({ error: 'Clobe 거래를 찾지 못했습니다.' }, { status: 404 });
    return NextResponse.json({ breakdown }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '거래 분할 내역을 불러오지 못했습니다.' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await guard(request);
  if (authError) return authError;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = request.headers.get('idempotency-key')
      ?? (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '');
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const validTargets = new Set<FinanceAllocationTarget>(FINANCE_ALLOCATION_TARGETS);
    if (!idempotencyKey || typeof body.expectedFingerprint !== 'string' || !lines.length) {
      return NextResponse.json({ error: '분할 내역, 최신 지문, 중복방지 키가 필요합니다.' }, { status: 400 });
    }
    if (lines.some((line: Record<string, unknown>) => !validTargets.has(line.targetType as FinanceAllocationTarget)
      || !Number.isFinite(Number(line.amount)) || Number(line.amount) <= 0)) {
      return NextResponse.json({ error: '분할 대상과 금액을 다시 확인해주세요.' }, { status: 400 });
    }
    const current = await loadFinanceTransactionBreakdown(id);
    if (!current) return NextResponse.json({ error: 'Clobe 거래를 찾지 못했습니다.' }, { status: 404 });
    const withdrawalOnly = new Set<FinanceAllocationTarget>([
      'customer_refund', 'bank_fee', 'company_expense', 'company_travel', 'tax', 'owner_draw',
    ]);
    const depositOnly = new Set<FinanceAllocationTarget>(['capital', 'other_income']);
    const hasDirectionMismatch = lines.some((line: Record<string, unknown>) => {
      const target = line.targetType as FinanceAllocationTarget;
      return (withdrawalOnly.has(target) && current.transaction.transaction_type !== '출금')
        || (depositOnly.has(target) && current.transaction.transaction_type !== '입금');
    });
    if (hasDirectionMismatch) {
      return NextResponse.json({ error: '입금·출금 방향과 맞지 않는 용도가 있습니다. 거래 용도를 다시 확인해주세요.' }, { status: 400 });
    }
    const total = validateBreakdownTotal(Number(current.transaction.amount), lines);
    if (!total.exact) {
      return NextResponse.json({ error: `분할 합계가 원본과 ${Math.abs(total.remaining).toLocaleString('ko-KR')}원 다릅니다.` }, { status: 400 });
    }
    const contextValue = getAdminContext(request);
    const { data, error } = await supabaseAdmin.rpc('save_bank_transaction_breakdown', {
      p_transaction_id: id,
      p_lines: lines,
      p_expected_fingerprint: body.expectedFingerprint,
      p_idempotency_key: idempotencyKey,
      p_actor: contextValue.userId,
      p_actor_label: contextValue.actor,
      p_reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '',
    });
    if (error) {
      const stale = /stale breakdown fingerprint/i.test(error.message);
      return NextResponse.json(
        { error: stale ? '화면을 연 뒤 거래나 메모가 바뀌었습니다. 최신 내역을 다시 확인해주세요.' : error.message },
        { status: stale ? 409 : 400 },
      );
    }
    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '거래 분할을 저장하지 못했습니다.' },
      { status: 500 },
    );
  }
}
