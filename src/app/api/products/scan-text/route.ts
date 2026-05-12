/**
 * POST /api/products/scan-text
 *
 * 밴드 게시글 텍스트 붙여넣기 → AI 분석 → 상품 미리보기 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeFromText } from '@/lib/band-ai-analyzer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

async function getNextInternalCode(
  departureCode: string,
  destinationCode: string,
  durationDays: number,
): Promise<string> {
  const prefix = `${departureCode.toUpperCase()}-XX-${destinationCode.toUpperCase()}-${String(durationDays).padStart(2, '0')}-`;
  const { data } = await supabaseAdmin
    .from('products')
    .select('internal_code')
    .like('internal_code', `${prefix}%`)
    .order('internal_code', { ascending: false })
    .limit(1);

  let lastSeq = 0;
  if (data?.[0]) {
    const seq = parseInt((data[0] as { internal_code: string }).internal_code.slice(prefix.length), 10);
    if (!isNaN(seq)) lastSeq = seq;
  }
  return prefix + String(lastSeq + 1).padStart(4, '0');
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { rawText, bandPostUrl } = await request.json() as { rawText: string; bandPostUrl?: string };

    if (!rawText?.trim()) {
      return NextResponse.json({ error: '텍스트를 입력하세요' }, { status: 400 });
    }

    // 중복 체크 (URL 제공 시)
    if (bandPostUrl) {
      const { data: exists } = await supabaseAdmin
        .from('band_import_log')
        .select('id, status')
        .eq('post_url', bandPostUrl)
        .limit(1);
      if (exists?.[0]) {
        return NextResponse.json(
          { error: '이미 임포트된 게시글입니다', existing: exists[0] },
          { status: 409 },
        );
      }
    }

    const ai = await analyzeFromText(rawText);
    if (!ai) {
      return NextResponse.json({ error: '여행 상품 정보를 추출할 수 없습니다' }, { status: 422 });
    }

    const internalCode = await getNextInternalCode(
      ai.departure_region_code,
      ai.destination_code,
      ai.duration_days,
    );

    return NextResponse.json({
      preview: {
        internal_code:          internalCode,
        display_name:           ai.display_name,
        destination:            ai.destination,
        destination_code:       ai.destination_code,
        departure_region:       ai.departure_region,
        departure_region_code:  ai.departure_region_code,
        duration_days:          ai.duration_days,
        departure_date:         ai.departure_date,
        net_price:              ai.net_price,
        ai_tags:                ai.ai_tags,
        source:                 'band_text_paste',
        band_post_url:          bandPostUrl ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '분석 실패' },
      { status: 500 },
    );
  }
}
