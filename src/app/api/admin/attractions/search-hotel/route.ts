/**
 * N4 박제 (2026-05-16 트립박스 표준): 호텔 마스터 검색 API.
 *
 * 어드민 inline 편집 시 일차별 호텔을 attractions 마스터에서 검색.
 *   - category = 'accommodation' 또는 hotel_canonical 박힌 attractions
 *   - destination/region 필터
 *   - 키워드 매칭 (name + aliases)
 *
 * 결과 형식: { id, name, grade?, region?, photos[0]?.src_medium? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

export const GET = withAdminGuard(async (req: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ hotels: [] });

  const { searchParams } = req.nextUrl;
  const q = (searchParams.get('q') ?? '').trim();
  const region = (searchParams.get('region') ?? '').trim();
  const limit = Number(searchParams.get('limit') ?? 10);

  let query = supabaseAdmin
    .from('attractions')
    .select('id, name, short_desc, region, country, photos, aliases')
    .eq('is_active', true)
    .eq('category', 'accommodation')
    .order('mention_count', { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (region) {
    query = query.ilike('region', `%${region}%`);
  }
  if (q.length >= 1) {
    // name ilike 또는 aliases 배열 포함
    query = query.or(`name.ilike.%${q}%,aliases.cs.{${q}}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message, hotels: [] }, { status: 500 });

  const hotels = ((data ?? []) as Array<{ id: string; name: string; short_desc: string | null; region: string | null; country: string | null; photos?: Array<{ src_medium?: string }>; aliases?: string[] }>)
    .map(h => ({
      id: h.id,
      name: h.name,
      short_desc: h.short_desc,
      region: h.region,
      country: h.country,
      photo: h.photos?.[0]?.src_medium ?? null,
      aliases: h.aliases ?? [],
    }));

  return NextResponse.json({ hotels });
});
