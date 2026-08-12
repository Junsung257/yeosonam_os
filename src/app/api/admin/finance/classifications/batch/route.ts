import type { NextRequest } from 'next/server';

import { getAdminContext } from '@/lib/admin-context';
import { requireAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import type { FinanceClassification } from '@/lib/finance-classification';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FINAL_CLASSIFICATIONS = new Set<FinanceClassification>([
  'company_expense', 'company_travel', 'tax', 'capital', 'transfer', 'refund', 'owner_draw', 'other_income',
]);
const RECEIPT_STATUSES = new Set(['not_required', 'missing', 'attached', 'verified']);

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? '';
    const sourceItems: unknown[] = Array.isArray(body.items) ? body.items : [];
    if (!idempotencyKey || sourceItems.length < 1 || sourceItems.length > 200) {
      return apiResponse({ error: '1~200건의 거래와 Idempotency-Key가 필요합니다.' }, { status: 400 });
    }
    const items = sourceItems.map(rawItem => {
      const item = rawItem && typeof rawItem === 'object' ? rawItem as Record<string, unknown> : {};
      return {
        transactionId: typeof item.transactionId === 'string' ? item.transactionId : '',
        allocationId: typeof item.allocationId === 'string' ? item.allocationId : '',
        classification: item.classification as FinanceClassification,
        expectedClassification: item.expectedClassification as FinanceClassification,
        receiptStatus: typeof item.receiptStatus === 'string' ? item.receiptStatus : 'not_required',
      };
    });
    if (items.some(item => !item.transactionId
      || !item.allocationId
      || !FINAL_CLASSIFICATIONS.has(item.classification)
      || !RECEIPT_STATUSES.has(item.receiptStatus)
      || typeof item.expectedClassification !== 'string')) {
      return apiResponse({ error: '선택 거래의 분류 정보가 올바르지 않습니다.' }, { status: 400 });
    }
    const context = getAdminContext(request);
    const { data, error } = await supabaseAdmin.rpc('save_finance_classification_batch', {
      p_items: items,
      p_idempotency_key: idempotencyKey,
      p_actor: context.userId,
      p_actor_label: context.actor,
    });
    if (error) {
      const stale = /stale finance classification/i.test(error.message);
      return apiResponse(
        { error: stale ? '선택한 거래가 방금 변경되었습니다. 최신 목록을 다시 확인해주세요.' : error.message },
        { status: stale ? 409 : 400 },
      );
    }
    return apiResponse({ result: data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiResponse(
      { error: error instanceof Error ? error.message : '회사 거래 일괄 분류를 저장하지 못했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
