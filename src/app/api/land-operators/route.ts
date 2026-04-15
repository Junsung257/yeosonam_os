import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 기본 랜드사 목록 (land_operators 테이블이 없을 때 폴백)
const DEFAULT_OPERATORS = [
  '투어폰', '투어비', '현지투어', '나라투어', '하나투어 현지', '모두투어 현지',
  '선셋투어', '아시아투어', '골든투어', '퍼시픽투어', '드래곤투어', '로열투어',
  '직접 진행', '기타',
].map((name, i) => ({ id: `default-${i}`, name, contact: null, regions: [] as string[], is_active: true }));

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// GET /api/land-operators — 전체 목록 반환 (is_active 포함)
export async function GET() {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ operators: DEFAULT_OPERATORS });

  const { data, error } = await sb
    .from('land_operators')
    .select('id, name, contact, regions, is_active')
    .order('name');

  if (error) {
    // 테이블이 아직 없을 경우 기본값 반환 (graceful fallback)
    console.warn('[land-operators] Table not found, using defaults:', error.message);
    return NextResponse.json({ operators: DEFAULT_OPERATORS });
  }

  // DB 데이터 + 기본값 병합 (DB 우선)
  const dbNames = new Set((data ?? []).map((o: { name: string }) => o.name));
  const merged = [
    ...(data ?? []),
    ...DEFAULT_OPERATORS.filter(d => !dbNames.has(d.name)),
  ];

  return NextResponse.json({ operators: merged }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
}

// POST /api/land-operators — 신규 랜드사 DB Insert + ID 반환
// 트랜잭션: 이미 존재하면 Upsert (중복 방지)
export async function POST(req: NextRequest) {
  const sb = getSupabase();
  const body = await req.json();
  const { name, contact, regions } = body as { name: string; contact?: string; regions?: string[] };

  if (!name?.trim()) {
    return NextResponse.json({ error: '랜드사 이름이 필요합니다.' }, { status: 400 });
  }

  // DB 없으면 임시 ID로 응답 (프론트 로직 중단 방지)
  if (!sb) {
    return NextResponse.json({
      operator: { id: `temp-${Date.now()}`, name: name.trim(), contact: contact ?? null, regions: regions ?? [], is_active: true },
    });
  }

  // Upsert: 동일 name이 있으면 기존 레코드 반환, 없으면 신규 Insert
  const { data, error } = await sb
    .from('land_operators')
    .upsert({ name: name.trim(), contact: contact ?? null, regions: regions ?? [], is_active: true }, { onConflict: 'name' })
    .select('id, name, contact, regions, is_active')
    .single();

  if (error) {
    console.warn('[land-operators] Upsert failed:', error.message);
    // DB 실패 시에도 임시 ID 반환 — 앱이 죽지 않도록
    return NextResponse.json({
      operator: { id: `temp-${Date.now()}`, name: name.trim(), contact: contact ?? null, regions: regions ?? [], is_active: true },
    });
  }

  return NextResponse.json({ operator: data });
}

// PATCH /api/land-operators — Soft Delete / 복구 / 이름·연락처 수정
// Body: { id, is_active } | { id, name, contact }
export async function PATCH(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const body = await req.json();
  const { id, is_active, name, contact } = body as {
    id: string; is_active?: boolean; name?: string; contact?: string | null;
  };

  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

  // 이름/연락처 수정
  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: '이름이 비어있습니다.' }, { status: 400 });
    const { data, error } = await sb
      .from('land_operators')
      .update({ name: name.trim(), contact: contact ?? null })
      .eq('id', id)
      .select('id, name, contact, regions, is_active')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ operator: data });
  }

  // is_active 토글
  if (typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active(boolean) 또는 name이 필요합니다.' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('land_operators')
    .update({ is_active })
    .eq('id', id)
    .select('id, name, contact, regions, is_active')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ operator: data });
}
