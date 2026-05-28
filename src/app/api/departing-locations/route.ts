import { NextRequest, NextResponse } from 'next/server';
import { successResponse, ApiErrors } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const DEFAULT_LOCATIONS = ['부산', '인천', '청주', '대구', '무안', '기타']
  .map((name, i) => ({ id: `default-${i}`, name, is_active: true }));

// GET /api/departing-locations
export async function GET() {
  try {
    if (!isSupabaseConfigured) return successResponse({ locations: DEFAULT_LOCATIONS }, 200, 60);

    const { data, error } = await supabaseAdmin
      .from('departing_locations')
      .select('id, name, is_active')
      .order('name');

    if (error) {
      console.warn('[departing-locations] Table not found, using defaults:', error.message);
      return successResponse({ locations: DEFAULT_LOCATIONS }, 200, 60);
    }

    const dbNames = new Set((data ?? []).map((l: { name: string }) => l.name));
    const merged = [...(data ?? []), ...DEFAULT_LOCATIONS.filter(d => !dbNames.has(d.name))];
    return successResponse({ locations: merged }, 200, 60);
  } catch (err) {
    console.error('[GET /api/departing-locations] 오류:', err);
    return ApiErrors.internalError(err instanceof Error ? err.message : '출발지 조회 실패');
  }
}

// POST /api/departing-locations — 신규 추가
export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json() as { name: string };
    if (!name?.trim()) return ApiErrors.badRequest('이름이 필요합니다.');

    if (!isSupabaseConfigured) {
      return successResponse({ location: { id: `temp-${Date.now()}`, name: name.trim(), is_active: true } });
    }

    const { data, error } = await supabaseAdmin
      .from('departing_locations')
      .upsert({ name: name.trim(), is_active: true }, { onConflict: 'name' })
      .select('id, name, is_active')
      .single();
    if (error) {
      return successResponse({ location: { id: `temp-${Date.now()}`, name: name.trim(), is_active: true } });
    }
    return successResponse({ location: data });
  } catch (err) {
    console.error('[POST /api/departing-locations] 오류:', err);
    return ApiErrors.internalError(err instanceof Error ? err.message : '출발지 추가 실패');
  }
}

// PATCH /api/departing-locations — 이름 수정 또는 is_active 토글
// Body: { id, name } | { id, is_active }
export async function PATCH(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 연결 실패' }, { status: 500 });

  const { id, is_active, name } = await req.json() as {
    id: string; is_active?: boolean; name?: string;
  };
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });

  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: '이름이 비어있습니다.' }, { status: 400 });
    const { data, error } = await supabaseAdmin
      .from('departing_locations')
      .update({ name: name.trim() })
      .eq('id', id)
      .select('id, name, is_active')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ location: data });
  }

  if (typeof is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active(boolean) 또는 name이 필요합니다.' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from('departing_locations')
    .update({ is_active })
    .eq('id', id)
    .select('id, name, is_active')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ location: data });
}
