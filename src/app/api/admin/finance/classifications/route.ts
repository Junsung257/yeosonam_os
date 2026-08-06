import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { getAdminContext } from '@/lib/admin-context';
import { requireAdminRequest } from '@/lib/admin-guard';
import { YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER } from '@/lib/bank-account-reality';
import {
  defaultProfitAndLoss,
  resolveFinanceClassification,
  type FinanceClassification,
  type FinanceClassificationOverride,
  type FinanceClassificationRule,
  type FinanceClassificationTransaction,
} from '@/lib/finance-classification';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { loadFinanceTransactionBreakdown } from '@/lib/finance-settlement-v3-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLASSIFICATIONS = new Set<FinanceClassification>([
  'company_expense', 'company_travel', 'tax', 'capital', 'transfer', 'refund', 'owner_draw', 'other_income', 'review',
]);

const ALLOCATION_TO_CLASSIFICATION: Record<string, FinanceClassification> = {
  customer_refund: 'refund',
  bank_fee: 'company_expense',
  company_expense: 'company_expense',
  company_travel: 'company_travel',
  tax: 'tax',
  capital: 'capital',
  transfer: 'transfer',
  owner_draw: 'owner_draw',
  other_income: 'other_income',
  unassigned: 'review',
};

const CLASSIFICATION_TO_ALLOCATION: Partial<Record<FinanceClassification, string>> = {
  company_expense: 'company_expense',
  company_travel: 'company_travel',
  tax: 'tax',
  capital: 'capital',
  transfer: 'transfer',
  refund: 'customer_refund',
  owner_draw: 'owner_draw',
  other_income: 'other_income',
};

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
    const [transactionResult, allocationResult, classificationResult, ruleResult] = await Promise.all([
      supabaseAdmin
        .from('bank_transactions')
        .select('id, transaction_type, amount, received_at, counterparty_name, memo, provider_category, provider_is_unclassified, settlement_scope')
        .eq('external_provider', 'clobe')
        .eq('source', 'clobe_mcp')
        .eq('status', 'active')
        .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
        .order('received_at', { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from('bank_transaction_allocations')
        .select('id, bank_transaction_id, booking_id, allocated_amount, target_type, target_label, reconciliation_key, metadata')
        .eq('status', 'active')
        .is('reversed_at', null)
        .limit(5000),
      supabaseAdmin
        .from('bank_transaction_classifications')
        .select('bank_transaction_id, clobe_original_classification, os_classification, resolved_classification, resolution_source, rule_id, is_profit_and_loss, receipt_status, confirmed_at, confirmed_by, notes')
        .limit(5000),
      supabaseAdmin
        .from('bank_classification_rules')
        .select('id, name, priority, counterparty_pattern, memo_pattern, direction, target_classification, is_profit_and_loss, apply_to_existing, effective_from, is_active')
        .order('priority', { ascending: true })
        .limit(500),
    ]);
    if (transactionResult.error) throw transactionResult.error;
    if (allocationResult.error) throw allocationResult.error;
    if (classificationResult.error) throw classificationResult.error;
    if (ruleResult.error) throw ruleResult.error;

    const storedByTransaction = new Map((classificationResult.data ?? []).map(row => [
      row.bank_transaction_id as string,
      row,
    ]));
    const rules = (ruleResult.data ?? []) as Array<FinanceClassificationRule & { name: string }>;
    const allocationsByTransaction = new Map<string, Array<{
      id: string;
      bank_transaction_id: string;
      booking_id: string | null;
      allocated_amount: number;
      target_type: string | null;
      target_label: string | null;
      reconciliation_key: string | null;
      metadata: Record<string, unknown> | null;
    }>>();
    for (const allocation of allocationResult.data ?? []) {
      const rows = allocationsByTransaction.get(allocation.bank_transaction_id as string) ?? [];
      rows.push(allocation as typeof rows[number]);
      allocationsByTransaction.set(allocation.bank_transaction_id as string, rows);
    }

    const rows = ((transactionResult.data ?? []) as Array<FinanceClassificationTransaction & {
      amount: number;
      settlement_scope: 'travel' | 'non_travel';
    }>).flatMap(transaction => {
      const stored = storedByTransaction.get(transaction.id);
      const resolved = resolveFinanceClassification({
        transaction,
        override: stored as FinanceClassificationOverride | undefined,
        rules,
      });
      const base = {
        ...transaction,
        amount: Number((transaction as FinanceClassificationTransaction & { amount?: number }).amount ?? 0),
        clobeOriginalClassification: transaction.provider_category ?? null,
        osClassification: stored?.os_classification ?? null,
        resolvedClassification: resolved.classification,
        resolutionSource: resolved.source,
        isProfitAndLoss: resolved.isProfitAndLoss,
        ruleId: resolved.ruleId,
        receiptStatus: stored?.receipt_status ?? 'not_required',
        confirmedAt: stored?.confirmed_at ?? null,
        confirmedBy: stored?.confirmed_by ?? null,
        notes: stored?.notes ?? null,
      };
      const allocations = allocationsByTransaction.get(transaction.id) ?? [];
      const nonBookingAllocations = allocations.filter(allocation => allocation.target_type !== 'booking');
      const splitRows = nonBookingAllocations.map(allocation => {
        const allocationClassification = ALLOCATION_TO_CLASSIFICATION[allocation.target_type ?? 'unassigned'] ?? 'review';
        const receiptStatus = typeof allocation.metadata?.receiptStatus === 'string'
          ? allocation.metadata.receiptStatus
          : ['company_expense', 'company_travel', 'tax'].includes(allocationClassification)
            ? 'missing'
            : 'not_required';
        return {
          ...base,
          id: allocation.id,
          transactionId: transaction.id,
          allocationId: allocation.id,
          amount: Number(allocation.allocated_amount) || 0,
          targetLabel: allocation.target_label,
          reconciliationKey: allocation.reconciliation_key,
          osClassification: allocationClassification === 'review' ? null : allocationClassification,
          resolvedClassification: allocationClassification,
          resolutionSource: allocationClassification === 'review' ? 'review' : 'manual',
          isProfitAndLoss: defaultProfitAndLoss(allocationClassification),
          receiptStatus,
          confirmedAt: null,
          confirmedBy: null,
          notes: allocation.target_label,
        };
      });
      const allocatedTotal = allocations.reduce((sum, allocation) => sum + Number(allocation.allocated_amount || 0), 0);
      const remaining = Math.max(0, Number(transaction.amount || 0) - allocatedTotal);
      const wholeTransactionRows = transaction.settlement_scope === 'non_travel' && remaining > 0
        ? [{ ...base, amount: remaining, transactionId: transaction.id, allocationId: null, targetLabel: null, reconciliationKey: null }]
        : [];
      return [...splitRows, ...wholeTransactionRows];
    });

    return NextResponse.json({
      rows,
      rules: ruleResult.data ?? [],
      summary: {
        total: rows.length,
        review: rows.filter(row => row.resolvedClassification === 'review').length,
        manual: rows.filter(row => row.resolutionSource === 'manual').length,
        missingReceipt: rows.filter(row => row.receiptStatus === 'missing').length,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '회사 거래 분류를 불러오지 못했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await guard(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';
    const allocationId = typeof body.allocationId === 'string' ? body.allocationId : '';
    const classification = body.classification as FinanceClassification;
    if (!transactionId || !CLASSIFICATIONS.has(classification)) {
      return NextResponse.json({ error: '거래와 확정 분류를 선택해주세요.' }, { status: 400 });
    }
    const receiptStatus = ['not_required', 'missing', 'attached', 'verified'].includes(body.receiptStatus)
      ? body.receiptStatus
      : classification === 'company_expense' || classification === 'company_travel' || classification === 'tax'
        ? 'missing'
        : 'not_required';
    const context = getAdminContext(request);

    if (allocationId) {
      const targetType = CLASSIFICATION_TO_ALLOCATION[classification];
      if (!targetType) return NextResponse.json({ error: '분할선의 최종 분류를 선택해주세요.' }, { status: 400 });
      const current = await loadFinanceTransactionBreakdown(transactionId);
      if (!current) return NextResponse.json({ error: 'Clobe 원본 거래를 찾지 못했습니다.' }, { status: 404 });
      if (!current.allocations.some(allocation => allocation.id === allocationId)) {
        return NextResponse.json({ error: '변경할 분할선을 찾지 못했습니다. 최신 내역을 다시 확인해주세요.' }, { status: 409 });
      }
      const lines = current.allocations.map(allocation => {
        const selected = allocation.id === allocationId;
        const nextTarget = selected ? targetType : allocation.target_type;
        const metadata = {
          ...(allocation.metadata ?? {}),
          ...(selected ? { receiptStatus, classificationSource: 'company_expense_tab' } : {}),
        };
        return {
          targetType: nextTarget,
          amount: Number(allocation.allocated_amount),
          bookingId: nextTarget === 'booking'
            || nextTarget === 'customer_refund'
            || nextTarget === 'bank_fee'
            ? allocation.booking_id
            : null,
          targetLabel: selected
            ? (typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 240) : allocation.target_label)
            : allocation.target_label,
          reconciliationKey: allocation.reconciliation_key,
          metadata,
        };
      });
      const reason = `회사 경비 분할선 분류 변경: ${classification}`;
      const { data, error } = await supabaseAdmin.rpc('save_bank_transaction_breakdown', {
        p_transaction_id: transactionId,
        p_lines: lines,
        p_expected_fingerprint: current.fingerprint,
        p_idempotency_key: `finance-classification:${allocationId}:${randomUUID()}`,
        p_actor: context.userId,
        p_actor_label: context.actor,
        p_reason: reason,
      });
      if (error) {
        const stale = /stale breakdown fingerprint/i.test(error.message);
        return NextResponse.json({
          error: stale ? '거래 분할이 방금 변경되었습니다. 최신 내역을 다시 확인해주세요.' : error.message,
        }, { status: stale ? 409 : 400 });
      }
      return NextResponse.json({ success: true, transactionId, allocationId, classification, result: data });
    }

    const { data: transactions, error: transactionError } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, provider_category')
      .eq('id', transactionId)
      .eq('external_provider', 'clobe')
      .eq('source', 'clobe_mcp')
      .eq('status', 'active')
      .eq('account_number', YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER)
      .eq('settlement_scope', 'non_travel')
      .limit(1);
    if (transactionError) throw transactionError;
    if (!transactions?.length) return NextResponse.json({ error: '회사 거래를 찾지 못했습니다.' }, { status: 404 });

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from('bank_transaction_classifications').upsert({
      bank_transaction_id: transactionId,
      clobe_original_classification: transactions[0].provider_category,
      os_classification: classification,
      resolved_classification: classification,
      resolution_source: 'manual',
      rule_id: null,
      is_profit_and_loss: typeof body.isProfitAndLoss === 'boolean'
        ? body.isProfitAndLoss
        : defaultProfitAndLoss(classification),
      receipt_status: receiptStatus,
      confirmed_at: now,
      confirmed_by: context.actor,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null,
      updated_at: now,
    }, { onConflict: 'bank_transaction_id' });
    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      user_id: context.userId,
      action: 'FINANCE_TRANSACTION_CLASSIFIED',
      target_type: 'bank_transaction',
      target_id: transactionId,
      description: `${classification} 수동 확정`,
      after_value: { classification, receipt_status: receiptStatus, actor: context.actor },
    } as never);

    return NextResponse.json({ success: true, transactionId, classification });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '회사 거래 분류를 저장하지 못했습니다.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await guard(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'create_rule') {
      return NextResponse.json({ error: '지원하지 않는 분류 작업입니다.' }, { status: 400 });
    }
    const classification = body.targetClassification as FinanceClassification;
    const counterpartyPattern = typeof body.counterpartyPattern === 'string' ? body.counterpartyPattern.trim() : '';
    const memoPattern = typeof body.memoPattern === 'string' ? body.memoPattern.trim() : '';
    if (!CLASSIFICATIONS.has(classification) || (!counterpartyPattern && !memoPattern)) {
      return NextResponse.json({ error: '규칙 조건과 결과 분류를 입력해주세요.' }, { status: 400 });
    }
    const context = getAdminContext(request);
    const { data, error } = await supabaseAdmin.from('bank_classification_rules').insert({
      name: typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : `${counterpartyPattern || memoPattern} 자동 분류`,
      priority: Number.isFinite(Number(body.priority)) ? Math.round(Number(body.priority)) : 100,
      counterparty_pattern: counterpartyPattern || null,
      memo_pattern: memoPattern || null,
      direction: body.direction === 'deposit' || body.direction === 'withdrawal' ? body.direction : null,
      target_classification: classification,
      is_profit_and_loss: typeof body.isProfitAndLoss === 'boolean'
        ? body.isProfitAndLoss
        : defaultProfitAndLoss(classification),
      apply_to_existing: false,
      effective_from: new Date().toISOString(),
      created_by: context.actor,
    }).select('id, name').limit(1);
    if (error) throw error;
    return NextResponse.json({ success: true, rule: data?.[0] ?? null }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '분류 규칙을 만들지 못했습니다.' },
      { status: 500 },
    );
  }
}
