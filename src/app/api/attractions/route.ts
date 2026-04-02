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
    if (limit) query = query.limit(parseInt(limit));

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ attractions: data || [] });
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

    let upserted = 0;
    for (const item of items) {
      if (!item.name) continue;
      const { error } = await supabaseAdmin
        .from('attractions')
        .upsert({
          name: item.name,
          short_desc: item.short_desc || null,
          long_desc: item.long_desc || null,
          country: item.country || null,
          region: item.region || null,
          badge_type: item.badge_type || 'tour',
          emoji: item.emoji || null,
          ...(item.aliases ? { aliases: item.aliases } : {}),
          ...(item.photos ? { photos: item.photos } : {}),
        }, { onConflict: 'name' });

      if (!error) upserted++;
    }

    return NextResponse.json({ success: true, upserted });
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
