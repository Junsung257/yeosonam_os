/**
 * GET /api/affiliate/public/[referral_code]
 *
 * 공개 어필리에이터 프로필 API (인증 불필요)
 * - 어필리에이터 정보 (이름, 로고, bio, 소셜 링크)
 * - 어필리에이터의 공개 카드뉴스 목록 (발행된 것만)
 * - 조회수 추적 없음 (퍼블릭 뷰)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ referral_code: string }> },
) {
  const { referral_code } = await props.params;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  if (!referral_code || referral_code.length < 3) {
    return NextResponse.json({ error: '유효하지 않은 referral 코드' }, { status: 400 });
  }

  try {
    // 1. 어필리에이터 정보 조회
    const { data: affiliate, error: affErr } = await supabaseAdmin
      .from('affiliates')
      .select(
        'id, name, referral_code, logo_url, bio, profile_image_url, social_links, branding_level, landing_intro, landing_video_url, landing_pick_package_ids',
      )
      .eq('referral_code', referral_code)
      .eq('is_active', true)
      .maybeSingle();

    if (affErr) throw affErr;
    if (!affiliate) {
      return NextResponse.json({ error: '어필리에이터를 찾을 수 없습니다' }, { status: 404 });
    }

    // 2. 연결된 brand_kit 조회
    const { data: brandKit } = await supabaseAdmin
      .from('brand_kits')
      .select('*')
      .eq('owner_type', 'affiliate')
      .eq('owner_id', affiliate.id)
      .eq('is_active', true)
      .maybeSingle();

    // 3. 어필리에이터의 공개 카드뉴스 목록
    const { data: cardNews, error: cnErr } = await supabaseAdmin
      .from('card_news')
      .select(
        'id, title, status, template_family, variant_angle, ig_slide_urls, created_at, ig_scheduled_for, ig_publish_status, engagement_score, branding_level',
      )
      .eq('created_by_affiliate_id', affiliate.id)
      .in('status', ['CONFIRMED', 'PUBLISHED', 'LAUNCHED'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (cnErr) throw cnErr;

    // 4. 추천 패키지 (pick_package_ids)
    let packages: unknown[] = [];
    if (affiliate.landing_pick_package_ids && affiliate.landing_pick_package_ids.length > 0) {
      const { data: pkgData } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, location_summary, price, original_price, discount_rate, package_type, main_image')
        .in('id', affiliate.landing_pick_package_ids)
        .limit(10);
      packages = pkgData ?? [];
    }

    return NextResponse.json({
      affiliate: {
        name: affiliate.name,
        referral_code: affiliate.referral_code,
        logo_url: affiliate.logo_url,
        profile_image_url: affiliate.profile_image_url,
        bio: affiliate.bio,
        social_links: affiliate.social_links,
        branding_level: affiliate.branding_level,
        landing_intro: affiliate.landing_intro,
        landing_video_url: affiliate.landing_video_url,
      },
      brand_kit: brandKit
        ? {
            primary_color: brandKit.primary_color,
            accent_color: brandKit.accent_color,
            background_color: brandKit.background_color,
            font_family: brandKit.font_family,
            logo_url: brandKit.logo_url,
            logo_light_url: brandKit.logo_light_url,
            brand_name: brandKit.brand_name,
            brand_tagline: brandKit.brand_tagline,
          }
        : null,
      card_news: (cardNews ?? []).map((cn: {
        id: number;
        title: string;
        template_family: string | null;
        variant_angle: string | null;
        ig_slide_urls: string[] | null;
        created_at: string;
        engagement_score: number | null;
      }) => ({
        id: cn.id,
        title: cn.title,
        template_family: cn.template_family,
        variant_angle: cn.variant_angle,
        thumbnail_url: cn.ig_slide_urls?.[0] ?? null,
        created_at: cn.created_at,
        engagement_score: cn.engagement_score,
      })),
      packages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
