import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 패키지별 리뷰 1줄 요약 (hero carousel용 공개 API)
 * - 캐시: 60초 SWR (운영 시 ISR 변경 가능)
 * - 데이터 없으면 200 + empty (UI 분기 단순화)
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isSupabaseConfigured) {
    return NextResponse.json({ digest_quotes: [], source_count: 0 });
  }

  const { data, error } = await supabaseAdmin
    .from('package_review_digests')
    .select('digest_quotes, source_count, avg_rating, generated_at')
    .eq('package_id', id)
    .limit(1);

  if (error) {
    return NextResponse.json({ digest_quotes: [], source_count: 0, error: error.message }, { status: 200 });
  }

  const row = data?.[0];
  return NextResponse.json(
    {
      digest_quotes: row?.digest_quotes ?? [],
      source_count: row?.source_count ?? 0,
      avg_rating: row?.avg_rating ?? null,
      generated_at: row?.generated_at ?? null,
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    },
  );
}
