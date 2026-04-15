import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/attractions — 전체 관광지 목록
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ attractions: [] });

  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get('country');
    const region = searchParams.get('region');
    const badge_type = searchParams.get('badge_type');
    const search = searchParams.get('search'); // 이름 검색 (별칭 연결용)
    const limit = searchParams.get('limit');

    // photos_only=1: 홈페이지용 경량 쿼리 (사진 매칭에 필요한 최소 필드만)
    const photosOnly = searchParams.get('photos_only');
    const fields = photosOnly
      ? 'id, name, country, region, photos, mention_count'
      : 'id, name, short_desc, long_desc, category, badge_type, emoji, country, region, aliases, photos, mention_count, created_at';

    let query = supabaseAdmin
      .from('attractions')
      .select(fields)
      .order('mention_count', { ascending: false });

    if (search) query = query.ilike('name', `%${search}%`);
    if (country) query = query.eq('country', country);
    if (region) query = query.eq('region', region);
    if (badge_type) query = query.eq('badge_type', badge_type);
    query = query.limit(limit ? parseInt(limit) : 5000);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ attractions: data || [] }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('[Attractions API] 조회 오류:', error);
    return NextResponse.json({ attractions: [] });
  }
}

// POST /api/attractions — 신규 등록
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const { data, error } = await supabaseAdmin
      .from('attractions')
      .insert({
        name: body.name,
        short_desc: body.short_desc || null,
        long_desc: body.long_desc || null,
        country: body.country || null,
        region: body.region || null,
        badge_type: body.badge_type || 'tour',
        emoji: body.emoji || null,
        aliases: body.aliases || [],
        photos: body.photos || [],
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ attraction: data }, { status: 201 });
  } catch (error) {
    console.error('[Attractions API] 등록 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '등록 실패' }, { status: 500 });
  }
}

// PATCH /api/attractions — 수정
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('attractions')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Attractions API] 수정 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '수정 실패' }, { status: 500 });
  }
}

// PUT /api/attractions — CSV 일괄 업로드 (upsert)
export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const { items } = await request.json();
    if (!Array.isArray(items)) return NextResponse.json({ error: 'items 배열 필요' }, { status: 400 });

    // 유효 행만 필터 + 정규화
    const cleaned = items
      .filter((i: Record<string, unknown>) => typeof i.name === 'string' && (i.name as string).trim())
      .map((i: Record<string, unknown>) => ({
        name: (i.name as string).trim(),
        short_desc: (i.short_desc as string) || null,
        long_desc: (i.long_desc as string) || null,
        country: (i.country as string) || null,
        region: (i.region as string) || null,
        badge_type: (i.badge_type as string) || 'tour',
        emoji: (i.emoji as string) || null,
        ...(i.aliases ? { aliases: i.aliases } : {}),
        ...(i.photos ? { photos: i.photos } : {}),
      }));

    // 500건씩 배치 upsert (순차 1건씩 → 배치로 성능 개선)
    let upserted = 0;
    const BATCH = 500;
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const chunk = cleaned.slice(i, i + BATCH);
      const { error } = await supabaseAdmin
        .from('attractions')
        .upsert(chunk as never[], { onConflict: 'name' });
      if (!error) upserted += chunk.length;
      else console.error('[Attractions CSV] 배치 upsert 오류:', error.message);
    }

    return NextResponse.json({ success: true, upserted, total: cleaned.length });
  } catch (error) {
    console.error('[Attractions API] 일괄 업로드 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '업로드 실패' }, { status: 500 });
  }
}

// DELETE /api/attractions?id=
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('attractions')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Attractions API] 삭제 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '삭제 실패' }, { status: 500 });
  }
}
