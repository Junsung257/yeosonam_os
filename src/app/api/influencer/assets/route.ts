import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// GET: 인플루언서가 활용할 수 있는 마케팅 소재 (카드뉴스, 마케팅 카피 등)
export async function GET(req: NextRequest) {
  try {
    const referral_code = req.nextUrl.searchParams.get('code');
    const packageId = req.nextUrl.searchParams.get('package_id');
    if (!referral_code) return NextResponse.json({ error: '코드 필요' }, { status: 400 });

    // 어필리에이트 확인
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id')
      .eq('referral_code', referral_code)
      .single();

    if (!affiliate) {
      return NextResponse.json({ error: '존재하지 않는 코드' }, { status: 404 });
    }

    // 카드뉴스 소재 — CONFIRMED 또는 LAUNCHED 상태만
    let cardNewsQuery = supabaseAdmin
      .from('card_news')
      .select('id, title, slides, package_id, status, created_at')
      .in('status', ['CONFIRMED', 'LAUNCHED'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (packageId) {
      cardNewsQuery = cardNewsQuery.eq('package_id', packageId);
    }

    const { data: cardNews } = await cardNewsQuery;

    // 마케팅 카피가 있는 상품들
    let packagesQuery = supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, price, marketing_copies, product_highlights, product_summary')
      .not('marketing_copies', 'is', null)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(50);

    if (packageId) {
      packagesQuery = packagesQuery.eq('id', packageId);
    }

    const { data: packages } = await packagesQuery;

    // 소재를 카테고리별로 정리
    const assets = {
      card_news: (cardNews || []).map(cn => ({
        id: cn.id,
        title: cn.title,
        package_id: cn.package_id,
        slide_count: Array.isArray(cn.slides) ? cn.slides.length : 0,
        thumbnail: Array.isArray(cn.slides) && cn.slides.length > 0 ? cn.slides[0]?.image_url : null,
        created_at: cn.created_at,
      })),
      marketing_copies: (packages || []).map(pkg => ({
        package_id: pkg.id,
        title: pkg.title,
        destination: pkg.destination,
        duration: pkg.duration,
        price: pkg.price,
        copies: pkg.marketing_copies,
        highlights: pkg.product_highlights,
        summary: pkg.product_summary,
      })),
    };

    return NextResponse.json({ assets });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
