import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';

export const maxDuration = 120;

/**
 * POST /api/content-brief
 *
 * 역할: Content Brief 생성 (Call 1만)
 *
 * Body:
 *   mode: 'product' | 'info'  — 자동 유추 가능
 *   package_id?: string       — product 모드
 *   angle?: string            — product 모드
 *   topic?: string            — info 모드
 *   category?: string         — info 모드
 *   slide_count?: number      — default 6
 *   tone?: string             — default 'professional'
 *   extra_prompt?: string
 *
 * Response:
 *   { brief: ContentBrief }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const {
      mode: modeInput,
      package_id,
      angle,
      topic,
      category,
      slide_count,
      tone,
      extra_prompt,
    } = body as {
      mode?: 'product' | 'info';
      package_id?: string;
      angle?: string;
      topic?: string;
      category?: string;
      slide_count?: number;
      tone?: string;
      extra_prompt?: string;
    };

    const mode: 'product' | 'info' = modeInput || (package_id ? 'product' : 'info');

    // 상품 정보 조회 (product 모드)
    let productData: any = null;
    if (mode === 'product') {
      if (!package_id) {
        return NextResponse.json({ error: 'product 모드에서는 package_id가 필수입니다.' }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, duration, nights, price, airline, departure_airport, inclusions, product_highlights, itinerary, product_summary')
        .eq('id', package_id)
        .limit(1);
      if (error || !data || data.length === 0) {
        return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
      }
      productData = data[0];
    } else {
      if (!topic || !topic.trim()) {
        return NextResponse.json({ error: 'info 모드에서는 topic이 필수입니다.' }, { status: 400 });
      }
    }

    // Brief 생성
    const brief = await generateContentBrief({
      mode,
      slideCount: slide_count ?? 6,
      tone,
      extraPrompt: extra_prompt,
      product: productData,
      angle,
      topic,
      category,
    });

    return NextResponse.json({
      brief,
      product_id: productData?.id || null,
    }, { status: 200 });
  } catch (err) {
    console.error('[content-brief] 오류:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Brief 생성 실패' },
      { status: 500 },
    );
  }
}
