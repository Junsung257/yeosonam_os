import { NextRequest } from 'next/server';
import { requireAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard';
import { errorResponse, successResponse } from '@/lib/api-response';
import {
  mapSettlementRpcError,
  resolveSettlementPeriodKst,
  settlementCommandHash,
} from '@/lib/affiliate/settlement-v2';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';

function requiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function idempotencyKey(request: NextRequest): string | null {
  const key = request.headers.get('idempotency-key')?.trim() || '';
  return /^[A-Za-z0-9:_-]{8,100}$/.test(key) ? key : null;
}

function sameOriginWrite(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === request.nextUrl.origin;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function rpcFailure(error: unknown) {
  const message = String((error as { message?: string } | null)?.message || '');
  const mapped = mapSettlementRpcError(message);
  return errorResponse(mapped.code, '정산 명령을 처리할 수 없습니다. 상태와 정책을 확인해 주세요.', mapped.status);
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;
  if (!isSupabaseAdminConfigured) return errorResponse('SERVICE_UNAVAILABLE', 'DB 미설정', 503);

  const affiliateId = request.nextUrl.searchParams.get('affiliateId') || '';
  const period = request.nextUrl.searchParams.get('period') || '';
  if (affiliateId && !isValidUuid(affiliateId)) return errorResponse('INVALID_AFFILIATE_ID', '잘못된 파트너 ID입니다.', 400);
  if (period && !resolveSettlementPeriodKst(period)) return errorResponse('INVALID_PERIOD', 'period는 YYYY-MM 형식이어야 합니다.', 400);

  let query = supabaseAdmin
    .from('settlement_runs')
    .select('*, affiliates(id, name, referral_code, grade, payout_type), payouts(id, status, amount_krw, payout_reference, receipt_url, requested_by, approved_by, executed_by, completed_at)')
    .order('period_start_utc', { ascending: false });
  if (affiliateId) query = query.eq('affiliate_id', affiliateId);
  if (period) query = query.eq('settlement_period', period);
  const { data, error } = await query;
  if (error) return errorResponse('SETTLEMENTS_UNAVAILABLE', '정산 목록을 불러올 수 없습니다.', 503);
  return successResponse({
    settlements: data || [],
    contract_version: 'settlement-ledger-v2',
    updated_at: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;
  if (!sameOriginWrite(request)) return errorResponse('ORIGIN_REJECTED', '허용되지 않은 요청입니다.', 403);
  if (!isSupabaseAdminConfigured) return errorResponse('SERVICE_UNAVAILABLE', 'DB 미설정', 503);

  const commandKey = idempotencyKey(request);
  if (!commandKey) return errorResponse('IDEMPOTENCY_KEY_REQUIRED', '멱등 키가 필요합니다.', 400);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const affiliateId = requiredText(body.affiliateId ?? body.affiliate_id);
  const period = requiredText(body.period ?? body.settlement_period);
  if (!isValidUuid(affiliateId)) return errorResponse('INVALID_AFFILIATE_ID', '잘못된 파트너 ID입니다.', 400);
  const range = resolveSettlementPeriodKst(period);
  if (!range) return errorResponse('INVALID_PERIOD', 'period는 YYYY-MM 형식이어야 합니다.', 400);

  const actor = await resolveAdminActorLabel(request);
  const requestHash = settlementCommandHash({ affiliate_id: affiliateId, period });
  const { data, error } = await supabaseAdmin.rpc('create_affiliate_settlement_run_v2', {
    p_affiliate_id: affiliateId,
    p_period: period,
    p_actor: actor,
    p_idempotency_key: commandKey,
    p_request_hash: requestHash,
  });
  if (error) return rpcFailure(error);
  return successResponse({
    settlement: Array.isArray(data) ? data[0] : data,
    period_range: range,
    idempotent: true,
  });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;
  if (!sameOriginWrite(request)) return errorResponse('ORIGIN_REJECTED', '허용되지 않은 요청입니다.', 403);
  if (!isSupabaseAdminConfigured) return errorResponse('SERVICE_UNAVAILABLE', 'DB 미설정', 503);

  const commandKey = idempotencyKey(request);
  if (!commandKey) return errorResponse('IDEMPOTENCY_KEY_REQUIRED', '멱등 키가 필요합니다.', 400);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = requiredText(body.id ?? body.settlement_run_id);
  const rawAction = requiredText(body.action || body.status).toUpperCase();
  if (!isValidUuid(id)) return errorResponse('INVALID_SETTLEMENT_ID', '잘못된 정산 ID입니다.', 400);
  if (rawAction === 'VOID') {
    return errorResponse(
      'VOID_REMOVED_USE_REVERSAL',
      '완료 정산은 취소할 수 없습니다. 원본을 유지하고 역분개를 생성해야 합니다.',
      410,
    );
  }
  if (rawAction === 'COMPLETED') {
    return errorResponse(
      'PAYOUT_WORKFLOW_REQUIRED',
      '지급 요청 → 다른 관리자 승인 → 지급 증빙 등록 순서로 처리해 주세요.',
      409,
    );
  }

  const actor = await resolveAdminActorLabel(request);
  if (rawAction === 'HOLD' || rawAction === 'READY') {
    const holdReason = rawAction === 'HOLD' ? requiredText(body.hold_reason ?? body.hold_reason_code) : '';
    const requestHash = settlementCommandHash({ id, action: rawAction, hold_reason_code: holdReason });
    const { data, error } = await supabaseAdmin.rpc('transition_affiliate_settlement_run_v2', {
      p_run_id: id,
      p_status: rawAction,
      p_hold_reason_code: holdReason || null,
      p_actor: actor,
      p_idempotency_key: commandKey,
      p_request_hash: requestHash,
    });
    if (error) return rpcFailure(error);
    return successResponse({ settlement: Array.isArray(data) ? data[0] : data });
  }

  if (rawAction === 'REQUEST_PAYOUT') {
    const requestHash = settlementCommandHash({ id, action: rawAction });
    const { data, error } = await supabaseAdmin.rpc('request_affiliate_payout_v2', {
      p_run_id: id,
      p_actor: actor,
      p_idempotency_key: commandKey,
      p_request_hash: requestHash,
    });
    if (error) return rpcFailure(error);
    return successResponse({ payout: Array.isArray(data) ? data[0] : data, approval_required: true });
  }

  const payoutId = requiredText(body.payout_id);
  if (!isValidUuid(payoutId)) return errorResponse('INVALID_PAYOUT_ID', '잘못된 지급 ID입니다.', 400);
  if (rawAction === 'APPROVE_PAYOUT') {
    const requestHash = settlementCommandHash({ id, payout_id: payoutId, action: rawAction });
    const { data, error } = await supabaseAdmin.rpc('approve_affiliate_payout_v2', {
      p_payout_id: payoutId,
      p_actor: actor,
      p_idempotency_key: commandKey,
      p_request_hash: requestHash,
    });
    if (error) return rpcFailure(error);
    return successResponse({ payout: Array.isArray(data) ? data[0] : data, approved: true });
  }

  if (rawAction === 'COMPLETE_PAYOUT') {
    const payoutReference = requiredText(body.payout_reference);
    const receiptUrl = safeHttpsUrl(body.receipt_url);
    const bankReference = requiredText(body.bank_transaction_reference);
    const completedAt = requiredText(body.completed_at ?? body.paid_at);
    if (!payoutReference || !receiptUrl || !completedAt || !Number.isFinite(Date.parse(completedAt))) {
      return errorResponse('PAYOUT_EVIDENCE_REQUIRED', '지급 참조번호, HTTPS 증빙 URL, 지급 시각이 필요합니다.', 400);
    }
    const requestHash = settlementCommandHash({
      id, payout_id: payoutId, action: rawAction, payout_reference: payoutReference,
      receipt_url: receiptUrl, bank_transaction_reference: bankReference, completed_at: completedAt,
    });
    const { data, error } = await supabaseAdmin.rpc('complete_affiliate_payout_v2', {
      p_payout_id: payoutId,
      p_actor: actor,
      p_payout_reference: payoutReference,
      p_receipt_url: receiptUrl,
      p_bank_transaction_reference: bankReference,
      p_completed_at: completedAt,
      p_idempotency_key: commandKey,
      p_request_hash: requestHash,
    });
    if (error) return rpcFailure(error);
    return successResponse({ payout: Array.isArray(data) ? data[0] : data, completed: true });
  }

  return errorResponse('INVALID_SETTLEMENT_ACTION', '지원하지 않는 정산 명령입니다.', 400);
}
