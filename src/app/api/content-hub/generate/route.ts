import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  generateCardSlides, generateBlogPost, generateAdCopy, generateTrackingId,
  type AngleType, type Channel, type ImageRatio,
} from '@/lib/content-generator';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { product_id, angle, channel, ratio, slideCount, tone, extraPrompt } = body as {
      product_id: string; angle: AngleType; channel: Channel;
      ratio?: ImageRatio; slideCount?: number; tone?: string; extraPrompt?: string;
    };

    if (!product_id || !angle || !channel) {
      return NextResponse.json({ error: 'product_id, angle, channel 필수' }, { status: 400 });
    }

    // 상품 조회
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, price, price_tiers, inclusions, excludes, product_type, airline, departure_airport, product_highlights, itinerary, optional_tours')
      .eq('id', product_id)
      .single();

    if (!pkg) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

    const trackingId = generateTrackingId(pkg.destination || '');
    const options = {
      angle, channel,
      ratio: (ratio || '1:1') as ImageRatio,
      slideCount: slideCount || 6,
      tone: tone || 'professional',
      extraPrompt,
    };

    let slides = null;
    let blogHtml = null;
    let adCopy = null;

    if (channel === 'instagram_card' || channel === 'instagram_reel' || channel === 'youtube_short' || channel === 'kakao') {
      slides = await generateCardSlides(pkg, options);
    }
    if (channel === 'naver_blog') {
      blogHtml = generateBlogPost(pkg, angle);
    }
    if (channel === 'google_search') {
      adCopy = generateAdCopy(pkg, angle);
    }

    // DB 저장
    const { data: creative, error } = await supabaseAdmin
      .from('content_creatives')
      .insert({
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
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ creative }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '생성 실패' }, { status: 500 });
  }
}
