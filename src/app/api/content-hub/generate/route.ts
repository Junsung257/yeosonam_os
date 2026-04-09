import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  generateCardSlides, generateBlogPost, generateAdCopy, generateTrackingId, generateBlogSeo,
  type AngleType, type Channel, type ImageRatio,
} from '@/lib/content-generator';
import { matchAttraction, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';

/** slug 중복 방지: 동일 slug 존재 시 -2, -3 접미사 자동 부여 */
async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select('slug')
    .like('slug', `${baseSlug}%`)
    .not('slug', 'is', null);

  const existing = new Set((data || []).map((r: { slug: string }) => r.slug));
  if (!existing.has(baseSlug)) return baseSlug;

  let i = 2;
  while (existing.has(`${baseSlug}-${i}`)) i++;
  return `${baseSlug}-${i}`;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { product_id, angle, channel, ratio, slideCount, tone, extraPrompt,
      blog_html: blogHtmlOverride, slug: slugOverride, seo_title, seo_description, og_image_url, tracking_id: trackingIdOverride,
    } = body as {
      product_id: string; angle: AngleType; channel: Channel;
      ratio?: ImageRatio; slideCount?: number; tone?: string; extraPrompt?: string;
      blog_html?: string; slug?: string; seo_title?: string; seo_description?: string;
      og_image_url?: string; tracking_id?: string;
    };

    if (!product_id || !angle || !channel) {
      return NextResponse.json({ error: 'product_id, angle, channel 필수' }, { status: 400 });
    }

    // 상품 조회
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, price, price_tiers, price_dates, inclusions, excludes, product_type, airline, departure_airport, product_highlights, itinerary, itinerary_data, optional_tours, notices_parsed')
      .eq('id', product_id)
      .single();

    if (!pkg) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

    const trackingId = trackingIdOverride || generateTrackingId(pkg.destination || '');
    const options = {
      angle, channel,
      ratio: (ratio || '1:1') as ImageRatio,
      slideCount: slideCount || 6,
      tone: tone || 'professional',
      extraPrompt,
    };

    // 관광지 조회 (블로그 생성 시 자동 결합용)
    let attractions: AttractionData[] = [];
    if (channel === 'naver_blog' && pkg.destination) {
      const { data: attrData } = await supabaseAdmin
        .from('attractions')
        .select('name, short_desc, photos, country, region, badge_type, emoji, aliases, category')
        .or(`region.ilike.%${pkg.destination}%,country.ilike.%${pkg.destination}%`)
        .limit(500);
      attractions = (attrData || []) as AttractionData[];
    }

    let slides = null;
    let blogHtml = null;
    let adCopy = null;

    if (channel === 'instagram_card' || channel === 'instagram_reel' || channel === 'youtube_short' || channel === 'kakao') {
      slides = await generateCardSlides(pkg, options);
    }
    if (channel === 'naver_blog') {
      blogHtml = blogHtmlOverride || generateBlogPost(pkg, angle, attractions);
    }
    if (channel === 'google_search') {
      adCopy = generateAdCopy(pkg, angle);
    }

    // SEO 자동 생성 (naver_blog 채널, 수동 override가 없을 때)
    const autoSeo = channel === 'naver_blog' ? generateBlogSeo(pkg, angle) : null;

    // DB 저장
    const insertData: Record<string, unknown> = {
      product_id,
      angle_type: angle,
      channel,
      image_ratio: options.ratio,
      slides: slides || [],
      blog_html: blogHtml,
      ad_copy: adCopy,
      tracking_id: trackingId,
      tone: options.tone,
      extra_prompt: options.extraPrompt || null,
      status: 'draft',
    };

    // SEO 필드: 수동 override > 자동 생성
    if (channel === 'naver_blog') {
      const rawSlug = slugOverride || autoSeo?.slug || '';
      if (rawSlug) {
        // slug sanitizer + 중복 방지
        const sanitized = rawSlug.toLowerCase().replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
        insertData.slug = await ensureUniqueSlug(sanitized);
      }
      insertData.seo_title = seo_title || autoSeo?.seoTitle || null;
      insertData.seo_description = seo_description || autoSeo?.seoDescription || null;
      if (og_image_url) insertData.og_image_url = og_image_url;
    }

    const { data: creative, error } = await supabaseAdmin
      .from('content_creatives')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ creative }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '생성 실패' }, { status: 500 });
  }
}
