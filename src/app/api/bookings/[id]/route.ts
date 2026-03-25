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

  // supabaseAdmin (service role key) — RLS 우회 보장
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update(updateFields)
    .eq('id', id)
    .select('*, customers!lead_customer_id(id, name, phone)')
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
