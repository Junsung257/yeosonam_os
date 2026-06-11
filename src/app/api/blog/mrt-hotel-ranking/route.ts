/**
 * POST /api/blog/mrt-hotel-ranking
 *
 * Generates an SEO blog post from real-time MyRealTrip hotel data.
 * Body: { city, tier?, count?, publish? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { mrtProvider, buildMylinkUrl } from '@/lib/travel-providers/mrt';
import { getPrompt } from '@/lib/prompt-loader';
import { logAndSanitize } from '@/lib/error-sanitizer';
import {
  applyBlogPublishQualityToUpdate,
  blogPublishQualityWarnings,
  evaluateBlogPublishQuality,
} from '@/lib/blog-publish-quality';

export const maxDuration = 60;

const TIER_LABEL: Record<string, string> = {
  luxury: '5성급',
  mid: '가성비',
};

const TIER_MIN_RATING: Record<string, number> = {
  luxury: 4.5,
  mid: 3.8,
};

function slugPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function ensureUniqueSlug(slug: string): Promise<string> {
  if (!isSupabaseConfigured) return slug;
  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select('slug')
    .like('slug', `${slug}%`)
    .limit(10);
  if (!data || data.length === 0) return slug;
  const existing = new Set(data.map((r: { slug: string }) => r.slug));
  if (!existing.has(slug)) return slug;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${slug}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });

  try {
    const body = await request.json() as {
      city: string;
      tier?: string;
      count?: number;
      publish?: boolean;
    };

    const city = body.city?.trim();
    const tier = body.tier ?? 'luxury';
    const count = Math.min(10, Math.max(3, body.count ?? 5));
    const publish = body.publish !== false;

    if (!city) return NextResponse.json({ error: 'city is required' }, { status: 400 });

    const checkIn = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const checkOut = new Date(Date.now() + 31 * 86400_000).toISOString().slice(0, 10);
    const hotels = await mrtProvider.searchStays({
      destination: city,
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
    });

    const minRating = TIER_MIN_RATING[tier] ?? 4.5;
    const filtered = hotels
      .filter(h => (h.rating ?? 0) >= minRating)
      .sort((a, b) => {
        const rDiff = (b.rating ?? 0) - (a.rating ?? 0);
        if (rDiff !== 0) return rDiff;
        return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
      })
      .slice(0, count);

    if (filtered.length === 0) {
      return NextResponse.json({ error: `${city} hotel candidates not found for rating ${minRating}+` }, { status: 404 });
    }

    const hotelLines = filtered.map((hotel, i) => {
      const affLink = buildMylinkUrl(hotel.providerUrl ?? '', `hotel-ranking-${slugPart(city)}-${i + 1}`);
      const rating = hotel.rating ? `평점 ${hotel.rating.toFixed(1)}` : '평점 정보 없음';
      const reviews = hotel.reviewCount ? `리뷰 ${hotel.reviewCount.toLocaleString()}건` : '리뷰 정보 없음';
      const price = hotel.pricePerNight > 0 ? `1박 ${hotel.pricePerNight.toLocaleString()}원대` : '가격 확인 필요';
      return `${i + 1}. **${hotel.name}** (${rating}, ${reviews}, ${price})
   - 위치: ${hotel.location || city}
   - 예약: ${affLink}`;
    }).join('\n\n');

    const tierLabel = TIER_LABEL[tier] ?? '추천';
    const year = new Date().getFullYear();
    const topN = filtered.length;
    const keyword = `${city} ${tierLabel} 호텔`;
    const h1 = `${city} ${tierLabel} 호텔 TOP ${topN} (${year}년 최신)`;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.yeosonam.com';
    const internalLink = `${baseUrl}/free-travel`;

    const MRT_SYSTEM_FALLBACK = `당신은 한국 여행 블로그 전문 작성자입니다. SEO에 맞는 호텔 랭킹 글을 작성합니다.
규칙:
- Markdown 형식만 출력합니다.
- H1은 "{{h1}}" 그대로 사용합니다.
- H2는 4~6개로 구성하고 "{{keyword}}" 또는 관련 롱테일 키워드를 자연스럽게 포함합니다.
- 1800~2500자로 작성합니다.
- 각 호텔 섹션에는 이름, 별점, 위치, 가격, 특징, 예약 링크를 포함합니다.
- 과장된 표현과 추측을 피하고, 실제 데이터 기준으로 씁니다.
- 결론에는 자유여행 플래너 내부 링크를 1회 넣습니다: {{internalLink}}`;
    const systemPrompt = (await getPrompt('mrt-hotel-ranking-system', MRT_SYSTEM_FALLBACK))
      .replace('{{h1}}', h1)
      .replace('{{keyword}}', keyword)
      .replace('{{internalLink}}', internalLink);

    const userPrompt = `다음 ${city} ${tierLabel} 호텔 ${topN}곳을 랭킹 형식으로 소개하는 SEO 블로그를 작성하세요.

## 호텔 데이터

${hotelLines}

## 작성 가이드
1. 서론은 "${city} ${tierLabel} 호텔"을 고르는 기준 3가지로 시작합니다.
2. 각 호텔 섹션에는 순위, 이름, 별점, 간단한 특징, 예약 링크를 넣습니다.
3. "## 직접 예약 vs 패키지 가격 비교" H2를 포함합니다.
4. 결론에는 자유여행 플래너 내부 링크를 넣습니다: ${internalLink}`;

    const result = await llmCall<string>({
      task: 'blog-generate',
      systemPrompt,
      userPrompt,
      maxTokens: 3000,
      temperature: 0.5,
    });

    let blogHtml = result.rawText?.trim() ?? '';
    if (blogHtml.length < 500) {
      blogHtml = `# ${h1}

${city} ${tierLabel} 호텔을 찾고 있다면 평점, 위치, 가격을 함께 확인하는 편이 좋습니다. 아래 목록은 MyRealTrip 호텔 데이터에서 평점과 리뷰 수를 기준으로 정리한 TOP ${topN}입니다.

${filtered.map((hotel, i) => {
  const affLink = buildMylinkUrl(hotel.providerUrl ?? '', `hotel-ranking-${slugPart(city)}-${i + 1}`);
  return `## ${i + 1}. ${hotel.name}

- 평점: ${hotel.rating?.toFixed(1) ?? 'N/A'} / 리뷰 ${(hotel.reviewCount ?? 0).toLocaleString()}건
- 위치: ${hotel.location || city}
- 가격: 1박 ${hotel.pricePerNight.toLocaleString()}원대
- 예약: [${hotel.name} 예약 확인](${affLink})`;
}).join('\n\n')}

## 직접 예약 vs 패키지 가격 비교

호텔만 따로 예약하면 일정 자유도가 높습니다. 항공, 차량, 가이드까지 같이 필요한 여행이라면 [여소남 자유여행 플래너](${internalLink})에서 전체 비용을 비교해 보세요.`;
    }

    const slugBase = `${slugPart(city)}-${slugPart(tierLabel)}-hotel-top${topN}-${year}`;
    const finalSlug = await ensureUniqueSlug(slugBase);
    const seoTitle = `${city} ${tierLabel} 호텔 TOP ${topN} ${year}년 최신`.slice(0, 60);
    const seoDesc = `${city} ${tierLabel} 호텔 ${topN}곳을 평점, 가격, 위치 기준으로 비교했습니다. MyRealTrip 실시간 호텔 데이터를 바탕으로 예약 링크까지 정리했습니다.`.slice(0, 160);

    const qaReport = publish
      ? await evaluateBlogPublishQuality({
          blog_html: blogHtml,
          slug: finalSlug,
          seo_title: seoTitle,
          seo_description: seoDesc,
          destination: city,
          angle_type: 'hotel_ranking',
          product_id: null,
          primary_keyword: keyword,
          secondary_keywords: [`${city} 호텔 추천`, `${city} 호텔 가격`, `${city} 숙소 위치`],
        })
      : null;
    if (qaReport && !qaReport.passed) {
      return NextResponse.json({
        error: 'Blog publish quality gate failed',
        summary: qaReport.summary,
        quality_warnings: blogPublishQualityWarnings(qaReport),
        blog_quality_score: qaReport.blogQualityScore,
        quality_gate: qaReport.qualityGate,
        seo_score: qaReport.seoScore,
        readability: qaReport.readability,
      }, { status: 422 });
    }

    const insertData: Record<string, unknown> = {
      channel: 'naver_blog',
      blog_html: blogHtml,
      slides: [],
      status: publish ? 'published' : 'draft',
      category: 'hotel_ranking',
      slug: finalSlug,
      seo_title: seoTitle,
      seo_description: seoDesc,
      destination: city,
      topic_source: 'mrt_hotel',
      published_at: publish ? new Date().toISOString() : null,
      generation_params: {
        city,
        tier,
        count: topN,
        hotel_count: filtered.length,
        ai_model: result.model ?? 'gemini-2.5-flash',
      },
    };
    if (qaReport) applyBlogPublishQualityToUpdate(insertData, qaReport);

    const { data: creative, error } = await supabaseAdmin
      .from('content_creatives')
      .insert(insertData)
      .select('id, slug')
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      slug: finalSlug,
      id: creative?.id,
      hotels: topN,
      status: publish ? 'published' : 'draft',
    });
  } catch (err) {
    return NextResponse.json(
      { error: logAndSanitize('mrt-hotel-ranking', err, 'Generation failed') },
      { status: 500 },
    );
  }
}
