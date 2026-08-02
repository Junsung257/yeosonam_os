import type { NextRequest } from 'next/server';

import { errorResponse, successResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = 'private, no-store';

function privateResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', PRIVATE_NO_STORE);
  return response;
}

function strings(value: unknown): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[|,\n]/u) : [];
  return [...new Set(source.map(item => String(item ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim()).filter(Boolean))];
}

function date(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : null;
}

function url(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function contractPayload(body: Record<string, unknown>) {
  const rate = Number(body.commissionRate);
  const validFrom = date(body.validFrom);
  const validTo = body.validTo ? date(body.validTo) : null;
  const evidenceUrl = url(body.evidenceUrl);
  const evidenceHash = String(body.evidenceHash ?? '').trim() || null;
  const filenameMarkers = strings(body.filenameMarkers);
  const sourceLabelMarkers = strings(body.sourceLabelMarkers);
  const rawTextMarkers = strings(body.rawTextMarkers);
  const allowOperatorAliasMatch = body.allowOperatorAliasMatch === true;
  const errors: string[] = [];

  if (!String(body.landOperatorId ?? '').trim()) errors.push('랜드사를 선택해 주세요.');
  if (!String(body.contractLabel ?? '').trim()) errors.push('계약 구분명을 입력해 주세요.');
  if (!Number.isFinite(rate) || rate <= 0 || rate > 50) errors.push('커미션율은 0 초과 50 이하의 실제 계약값이어야 합니다.');
  if (!validFrom) errors.push('계약 적용 시작일을 입력해 주세요.');
  if (body.validTo && !validTo) errors.push('계약 종료일 형식이 올바르지 않습니다.');
  if (validFrom && validTo && validTo < validFrom) errors.push('계약 종료일은 시작일보다 빠를 수 없습니다.');
  if (body.evidenceUrl && !evidenceUrl) errors.push('계약 근거 URL은 HTTPS 주소여야 합니다.');
  if (!evidenceUrl && !evidenceHash) errors.push('계약서 URL 또는 계약 증빙 해시가 필요합니다.');
  if (
    filenameMarkers.length === 0
    && sourceLabelMarkers.length === 0
    && rawTextMarkers.length === 0
    && !allowOperatorAliasMatch
  ) {
    errors.push('자동 매칭에 사용할 명시적 표식을 하나 이상 입력해 주세요.');
  }

  return {
    errors,
    payload: {
      land_operator_id: String(body.landOperatorId ?? '').trim(),
      contract_label: String(body.contractLabel ?? '').trim(),
      commission_rate: rate,
      filename_markers: filenameMarkers,
      source_label_markers: sourceLabelMarkers,
      raw_text_markers: rawTextMarkers,
      allow_operator_alias_match: allowOperatorAliasMatch,
      valid_from: validFrom,
      valid_to: validTo,
      evidence_url: evidenceUrl,
      evidence_hash: evidenceHash,
      verified_at: new Date().toISOString(),
      auto_apply: body.autoApply !== false,
      is_active: body.isActive !== false,
      priority: Math.max(0, Math.min(1000, Number(body.priority ?? 100) || 100)),
    },
  };
}

const getHandler = async () => {
  if (!isSupabaseConfigured) return privateResponse(errorResponse('DB_NOT_CONFIGURED', 'DB가 연결되지 않았습니다.', 503));
  const [{ data: contracts, error }, { data: operators, error: operatorError }] = await Promise.all([
    supabaseAdmin
      .from('product_commercial_contracts')
      .select('id,land_operator_id,contract_label,commission_rate,filename_markers,source_label_markers,raw_text_markers,allow_operator_alias_match,valid_from,valid_to,evidence_url,evidence_hash,verified_at,auto_apply,is_active,priority,created_at,updated_at,land_operators(name,aliases,is_active)')
      .order('is_active', { ascending: false })
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false }),
    supabaseAdmin.from('land_operators').select('id,name,aliases,is_active').eq('is_active', true).order('name'),
  ]);
  if (error || operatorError) {
    return privateResponse(errorResponse(
      'COMMERCIAL_CONTRACT_LOOKUP_FAILED',
      sanitizeDbError(error ?? operatorError, '계약 원장을 불러오지 못했습니다.'),
      500,
    ));
  }
  return privateResponse(successResponse({ contracts: contracts ?? [], operators: operators ?? [] }));
};

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return privateResponse(errorResponse('DB_NOT_CONFIGURED', 'DB가 연결되지 않았습니다.', 503));
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return privateResponse(errorResponse('INVALID_JSON', '요청 형식이 올바르지 않습니다.', 400));
  const parsed = contractPayload(body);
  if (parsed.errors.length > 0) {
    return privateResponse(errorResponse('INVALID_COMMERCIAL_CONTRACT', parsed.errors[0], 400, parsed.errors));
  }
  const { data, error } = await supabaseAdmin
    .from('product_commercial_contracts')
    .insert(parsed.payload)
    .select()
    .single();
  if (error) return privateResponse(errorResponse('COMMERCIAL_CONTRACT_SAVE_FAILED', sanitizeDbError(error), 500));
  return privateResponse(successResponse(data, 201));
};

const patchHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return privateResponse(errorResponse('DB_NOT_CONFIGURED', 'DB가 연결되지 않았습니다.', 503));
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = String(body?.id ?? '').trim();
  if (!body || !id) return privateResponse(errorResponse('INVALID_INPUT', '계약 ID가 필요합니다.', 400));

  if (body.action === 'deactivate') {
    const { data, error } = await supabaseAdmin
      .from('product_commercial_contracts')
      .update({ is_active: false, auto_apply: false })
      .eq('id', id)
      .select()
      .single();
    if (error) return privateResponse(errorResponse('COMMERCIAL_CONTRACT_SAVE_FAILED', sanitizeDbError(error), 500));
    return privateResponse(successResponse(data));
  }

  const parsed = contractPayload(body);
  if (parsed.errors.length > 0) {
    return privateResponse(errorResponse('INVALID_COMMERCIAL_CONTRACT', parsed.errors[0], 400, parsed.errors));
  }
  const { data, error } = await supabaseAdmin
    .from('product_commercial_contracts')
    .update(parsed.payload)
    .eq('id', id)
    .select()
    .single();
  if (error) return privateResponse(errorResponse('COMMERCIAL_CONTRACT_SAVE_FAILED', sanitizeDbError(error), 500));
  return privateResponse(successResponse(data));
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
export const PATCH = withAdminGuard(patchHandler);
