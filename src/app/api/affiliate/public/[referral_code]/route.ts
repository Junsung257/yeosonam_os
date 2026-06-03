import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

type PublicCardNews = {
  id: number;
  title: string;
  template_family: string | null;
  variant_angle: string | null;
  ig_slide_urls: string[] | null;
  created_at: string;
  engagement_score: number | null;
};

export async function GET(
  _request: NextRequest,
  props: { params: Promise<{ referral_code: string }> },
) {
  const { referral_code } = await props.params;

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  if (!referral_code || referral_code.length < 3) {
    return apiResponse({ error: '유효하지 않은 referral 코드' }, { status: 400 });
  }

  try {
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
      return apiResponse({ error: '어필리에이터를 찾을 수 없습니다' }, { status: 404 });
    }

    const { data: brandKit } = await supabaseAdmin
      .from('brand_kits')
      .select('*')
      .eq('owner_type', 'affiliate')
      .eq('owner_id', affiliate.id)
      .eq('is_active', true)
      .maybeSingle();

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

    let packages: unknown[] = [];
    if (affiliate.landing_pick_package_ids && affiliate.landing_pick_package_ids.length > 0) {
      const { data: pkgData } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, location_summary, price, original_price, discount_rate, package_type, main_image')
        .in('id', affiliate.landing_pick_package_ids)
        .limit(10);
      packages = pkgData ?? [];
    }

    return apiResponse({
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
      card_news: (cardNews ?? []).map((cn: PublicCardNews) => ({
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
    return apiResponse({ error: sanitizeDbError(err, '조회 실패') }, { status: 500 });
  }
}
