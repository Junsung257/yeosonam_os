/**
 * 여소남 OS — 예약 단건 REST 엔드포인트
 *
 * GET  /api/bookings/:id  — 예약 단건 조회 (customers join 포함)
 * PATCH /api/bookings/:id — 예약 필드 수정 (화이트리스트 적용)
 *
 * 기존 PATCH /api/bookings (body.id) 와의 차이:
 *   - URL 파라미터로 id를 받아 라우팅 명확화
 *   - supabaseAdmin (service role) 사용 → RLS 우회 보장
 *   - total_cost / is_manual_cost 를 명시적으로 허용 (GENERATED 제약 제거 후)
 *   - 에러 발생 시 { error, code } JSON 명확 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// ── 수정 허용 필드 화이트리스트 ──────────────────────────────────────────────
// total_cost / is_manual_cost 는 DB 마이그레이션(manual_cost_override_v1.sql)
// 이후 일반 컬럼이 되어 직접 UPDATE 가능.
const PATCH_FIELDS = [
  // 수동 원가 오버라이드 잠금
  'total_cost',
  'is_manual_cost',
  // 견적 빌더 단가/인원
  'adult_count', 'child_count',
  'adult_price', 'child_price',
  'adult_cost',  'child_cost',
  'total_price',
  // 유연한 JSONB (커스텀 행, override 메모 등)
  'metadata',
  // 예약 일반 정보
  'departure_region', 'land_operator', 'land_operator_id',
  'manager_name', 'package_title', 'departure_date',
  // 결제 정보 (직접 수정용)
  'paid_amount', 'payment_status',
  // 정산 확정 / 커미션 (20260418 마이그레이션)
  'settlement_confirmed_at', 'settlement_confirmed_by',
  'settlement_mode', // 20260422 — accrual(장부) / cash(통장 대조)
  'commission_rate', 'commission_amount',
  // 취소/환불 (20260418010000 마이그레이션)
  'cancelled_at', 'cancellation_reason', 'refund_settled_at',
  // 상태 직접 수정
  'status', 'notes',
] as const;

type PatchField = typeof PATCH_FIELDS[number];

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: '예약 ID가 필요합니다.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('*, customers!lead_customer_id(id, name, phone)')
    .eq('id', id)
    .single();

  if (error) {
    const status = error.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status },
    );
  }

  return NextResponse.json({ booking: data });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: '예약 ID가 필요합니다.' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body가 유효한 JSON이 아닙니다.' },
      { status: 400 },
    );
  }

  // 화이트리스트 필터링 — 허용되지 않은 필드 자동 제거
  const updateFields: Record<string, unknown> = {};
  for (const field of PATCH_FIELDS as readonly string[]) {
    if (field in body) {
      updateFields[field as PatchField] = body[field];
    }
  }

  if (Object.keys(updateFields).length === 0) {
    return NextResponse.json(
      { error: '수정할 필드가 없습니다. 허용된 필드를 확인하세요.' },
      { status: 400 },
    );
  }

  // updated_at 항상 갱신
  updateFields.updated_at = new Date().toISOString();

  // Phase 2a — paid_amount 직접 수정은 record_manual_paid_amount_change RPC 로 분기
  //   이유: bookings.paid_amount UPDATE 와 ledger_entries INSERT 를 같은 트랜잭션에서 보장.
  //   다른 필드들은 그대로 일반 UPDATE 로 처리 후, paid_amount 만 RPC 로 후처리.
  const hasManualPaidAmount = Object.prototype.hasOwnProperty.call(updateFields, 'paid_amount');
  const newPaidAmount = hasManualPaidAmount ? Number(updateFields.paid_amount ?? 0) : null;
  if (hasManualPaidAmount) {
    delete updateFields.paid_amount;
  }

  // supabaseAdmin (service role key) — RLS 우회 보장
  // 다른 필드 먼저 UPDATE
  if (Object.keys(updateFields).length > 1) {
    // updated_at 외 다른 필드가 있으면 일반 UPDATE
    const { error: bulkErr } = await supabaseAdmin
      .from('bookings')
      .update(updateFields)
      .eq('id', id);
    if (bulkErr) {
      console.error(`[bookings/${id} PATCH] Supabase 에러:`, bulkErr);
      return NextResponse.json(
        { error: bulkErr.message, code: bulkErr.code, details: bulkErr.details ?? null, hint: bulkErr.hint ?? null },
        { status: 500 },
      );
    }
  }

  // paid_amount 만 RPC 경로 — ledger 이중쓰기 보장
  if (hasManualPaidAmount && Number.isFinite(newPaidAmount)) {
    const { error: rpcErr } = await supabaseAdmin.rpc('record_manual_paid_amount_change', {
      p_booking_id: id,
      p_new_paid_amount: newPaidAmount,
      p_new_total_paid_out: null,
      p_source: 'admin_manual_edit',
      p_source_ref_id: id,
      p_idempotency_key: `manual:${id}:${Date.now()}`,    // 같은 booking 의 동일 호출은 시간으로 분리
      p_memo: 'admin manual paid_amount edit',
      p_created_by: 'admin',
    });
    if (rpcErr) {
      console.error(`[bookings/${id} PATCH] manual paid_amount RPC 실패:`, rpcErr);
      return NextResponse.json(
        { error: rpcErr.message, code: rpcErr.code },
        { status: 500 },
      );
    }
  }

  // 최종 booking 조회 후 반환 (ledger RPC 가 payment_status 도 자동 갱신하지만 여긴 일반 UPDATE 후라 단순 SELECT)
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('*, customers!lead_customer_id(id, name, phone)')
    .eq('id', id)
    .single();

  if (error) {
    console.error(`[bookings/${id} PATCH] Supabase 에러:`, error);
    return NextResponse.json(
      {
        error:   error.message,
        code:    error.code,
        details: error.details ?? null,
        hint:    error.hint   ?? null,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ booking: data });
}
