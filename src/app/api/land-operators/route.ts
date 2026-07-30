import { NextRequest } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

// GET /api/land-operators — 전체 목록 반환 (is_active 포함)
export async function GET(req: NextRequest) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '랜드사 DB 연결이 설정되지 않았습니다.' }, { status: 503 });
  }

  const { data, error } = await supabaseAdmin
    .from('land_operators')
    .select('id, name, contact, regions, is_active, aliases')
    .order('name');

  if (error) {
    console.error('[land-operators] 조회 실패:', sanitizeDbError(error));
    return apiResponse({ error: '랜드사 목록을 조회하지 못했습니다.' }, { status: 503 });
  }

  return apiResponse({ operators: data ?? [], source: 'database' }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
}

// POST /api/land-operators — 신규 랜드사 DB Insert + ID 반환
// 트랜잭션: 이미 존재하면 Upsert (중복 방지)
export async function POST(req: NextRequest) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  const body = await req.json();
  const { name, contact, regions } = body as { name: string; contact?: string; regions?: string[] };

  if (!name?.trim()) {
    return apiResponse({ error: '랜드사 이름이 필요합니다.' }, { status: 400 });
  }

  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '랜드사 DB 연결이 설정되지 않았습니다.' }, { status: 503 });
  }

  // Upsert: 동일 name이 있으면 기존 레코드 반환, 없으면 신규 Insert
  const { data, error } = await supabaseAdmin
    .from('land_operators')
    .upsert({ name: name.trim(), contact: contact ?? null, regions: regions ?? [], is_active: true }, { onConflict: 'name' })
    .select('id, name, contact, regions, is_active')
    .single();

  if (error) {
    console.error('[land-operators] 저장 실패:', sanitizeDbError(error));
    return apiResponse({ error: '랜드사를 저장하지 못했습니다.' }, { status: 503 });
  }

  return apiResponse({ operator: data });
}

// PATCH /api/land-operators — Soft Delete / 복구 / 이름·연락처 수정
// Body: { id, is_active } | { id, name, contact }
export async function PATCH(req: NextRequest) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  if (!isSupabaseAdminConfigured) return apiResponse({ error: 'DB 연결 실패' }, { status: 503 });

  const body = await req.json();
  const { id, is_active, name, contact } = body as {
    id: string; is_active?: boolean; name?: string; contact?: string | null;
  };

  if (!id) return apiResponse({ error: 'id가 필요합니다.' }, { status: 400 });

  // 이름/연락처 수정
  if (name !== undefined) {
    if (!name.trim()) return apiResponse({ error: '이름이 비어있습니다.' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('land_operators')
      .update({ name: name.trim(), contact: contact ?? null })
      .eq('id', id)
      .select('id, name, contact, regions, is_active')
      .single();
    if (error) {
      console.error('[land-operators] 수정 실패:', sanitizeDbError(error));
      return apiResponse({ error: '랜드사를 수정하지 못했습니다.' }, { status: 503 });
    }
    return apiResponse({ operator: data });
  }

  // is_active 토글
  if (typeof is_active !== 'boolean') {
    return apiResponse({ error: 'is_active(boolean) 또는 name이 필요합니다.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('land_operators')
    .update({ is_active })
    .eq('id', id)
    .select('id, name, contact, regions, is_active')
    .single();

  if (error) {
    console.error('[land-operators] 상태 변경 실패:', sanitizeDbError(error));
    return apiResponse({ error: '랜드사 상태를 변경하지 못했습니다.' }, { status: 503 });
  }
  return apiResponse({ operator: data });
}
