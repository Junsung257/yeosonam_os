/**
 * GET /api/brand-kits — 활성 brand_kit 목록
 * GET /api/brand-kits?code=yeosonam — code로 단건 조회
 *
 * 멀티테넌시 대비 API. 현 시점은 yeosonam 1건이지만 파트너 랜드사 입점 시 이 엔드포인트가 카드뉴스/A4 포스터/블로그의 브랜드 토큰 공급원.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ brand_kits: [] });
  }

  try {
    const code = request.nextUrl.searchParams.get('code');

    let query = supabaseAdmin
      .from('brand_kits')
      .select('id, code, name, colors, fonts, logo_text, logo_url, domain')
      .eq('is_active', true);

    if (code) {
      query = query.eq('code', code);
    }

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      brand_kits: data ?? [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '조회 실패';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
