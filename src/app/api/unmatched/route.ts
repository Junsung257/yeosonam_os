import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * POST /api/unmatched — 미매칭 관광지 자동 수집
 * 랜딩페이지 로드 시 미매칭 activity 목록 전송 → upsert
 * body: { items: Array<{ activity, package_id?, package_title?, day_number?, country?, region? }> }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ success: false });

  try {
    const { items } = await request.json();
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ success: true, saved: 0 });

    let saved = 0;
    for (const item of items) {
      if (!item.activity || item.activity.length < 3) continue;

      // ON CONFLICT(activity) → occurrence_count 증가
      const { error } = await supabaseAdmin.rpc('upsert_unmatched_activity', {
        p_activity: item.activity,
        p_package_id: item.package_id || null,
        p_package_title: item.package_title || null,
        p_day_number: item.day_number || null,
        p_country: item.country || null,
        p_region: item.region || null,
      }).single();

      // rpc가 없으면 fallback으로 직접 upsert
      if (error) {
        const { error: e2 } = await supabaseAdmin
          .from('unmatched_activities')
          .upsert({
            activity: item.activity,
            package_id: item.package_id || null,
            package_title: item.package_title || null,
            day_number: item.day_number || null,
            country: item.country || null,
            region: item.region || null,
            occurrence_count: 1,
            status: 'pending',
          }, { onConflict: 'activity' });

        if (!e2) saved++;
      } else {
        saved++;
      }
    }

    return NextResponse.json({ success: true, saved });
  } catch (error) {
    console.error('[Unmatched API] 저장 오류:', error);
    return NextResponse.json({ success: false });
  }
}

/**
 * GET /api/unmatched — 미매칭 목록 조회 (관리자용)
 * ?status=pending (기본)
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';

    let query = supabaseAdmin
      .from('unmatched_activities')
      .select('*')
      .order('occurrence_count', { ascending: false })
      .order('created_at', { ascending: false });

    if (status !== 'all') query = query.eq('status', status);

    const { data, error } = await query.limit(200);
    if (error) throw error;
    return NextResponse.json({ items: data || [] });
  } catch (error) {
    console.error('[Unmatched API] 조회 오류:', error);
    return NextResponse.json({ items: [] });
  }
}

/**
 * PATCH /api/unmatched — 상태 변경 또는 별칭 연결
 * body: { id, status } — 단순 상태 변경
 * body: { id, action: 'link_alias', attractionId: 'uuid' } — 기존 관광지에 alias 연결
 */
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    // 별칭 연결 모드
    if (body.action === 'link_alias') {
      const { attractionId } = body;
      if (!attractionId) return NextResponse.json({ error: 'attractionId 필요' }, { status: 400 });

      // 1. 미매칭 항목 조회
      const { data: unmatched } = await supabaseAdmin
        .from('unmatched_activities')
        .select('activity')
        .eq('id', id)
        .single();
      if (!unmatched) return NextResponse.json({ error: '미매칭 항목을 찾을 수 없습니다.' }, { status: 404 });

      const aliasText = unmatched.activity;

      // 2. 중복 체크 — 같은 alias가 다른 관광지에 이미 있는지
      const { data: dupeCheck } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases')
        .neq('id', attractionId) as any;
      const dupeAttraction = (dupeCheck || []).find((a: any) =>
        (a.aliases || []).some((alias: string) => alias === aliasText)
      );
      if (dupeAttraction) {
        return NextResponse.json(
          { error: `"${aliasText}"는 이미 "${dupeAttraction.name}"에 별칭으로 등록되어 있습니다.` },
          { status: 409 }
        );
      }

      // 3. 대상 관광지 조회 & aliases 업데이트
      const { data: attraction } = await supabaseAdmin
        .from('attractions')
        .select('id, name, aliases')
        .eq('id', attractionId)
        .single() as any;
      if (!attraction) return NextResponse.json({ error: '관광지를 찾을 수 없습니다.' }, { status: 404 });

      const currentAliases: string[] = attraction.aliases || [];
      if (!currentAliases.includes(aliasText)) {
        const newAliases = [...currentAliases, aliasText];
        const { error: updateErr } = await supabaseAdmin
          .from('attractions')
          .update({ aliases: newAliases })
          .eq('id', attractionId);
        if (updateErr) throw updateErr;
      }

      // 4. 미매칭 상태 → added
      await supabaseAdmin
        .from('unmatched_activities')
        .update({ status: 'added' })
        .eq('id', id);

      return NextResponse.json({
        success: true,
        message: `"${aliasText}" → "${attraction.name}" 별칭 연결 완료`,
      });
    }

    // 단순 상태 변경 모드
    const { status } = body;
    if (!status) return NextResponse.json({ error: 'status 필요' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('unmatched_activities')
      .update({ status })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Unmatched API] 처리 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '처리 실패' }, { status: 500 });
  }
}
