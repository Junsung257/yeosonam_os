/**
 * POST /api/blog/mrt-hotel-ranking
 *
 * MRT 실시간 호텔 데이터 → 랭킹형 SEO 블로그 자동 생성.
 * 예: "나트랑 5성급 호텔 TOP 5 (2026년)" + 각 호텔에 MRT 어필리에이트 링크.
 *
 * Body: { city, tier?, count?, publish? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { llmCall } from '@/lib/llm-gateway';
import { mrtProvider, buildMylinkUrl } from '@/lib/travel-providers/mrt';

export const maxDuration = 60;

const TIER_LABEL: Record<string, string> = {
  luxury: '5성급',
  mid:    '가성비',
};
const TIER_MIN_RATING: Record<string, number> = {
  luxury: 4.5,
  mid:    3.8,
};

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
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json() as {
      city:     string;
      tier?:    string;
      count?:   number;
      publish?: boolean;
    };

    const city    = body.city?.trim();
    const tier    = body.tier ?? 'luxury';
    const count   = Math.min(10, Math.max(3, body.count ?? 5));
    const publish = body.publish !== false; // default true

    if (!city) return NextResponse.json({ error: 'city 필수' }, { status: 400 });

    // 1. MRT 호텔 검색
    const checkIn  = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const checkOut = new Date(Date.now() + 31 * 86400_000).toISOString().slice(0, 10);
    const hotels = await mrtProvider.searchStays({
      destination: city,
      checkIn,
      checkOut,
      adults:   2,
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
      return NextResponse.json({ error: `${city}에서 조건에 맞는 호텔 없음 (평점 ${minRating}+)` }, { status: 404 });
    }

    // 2. 어필리에이트 링크 빌드
    const hotelLines = filtered.map((h, i) => {
      const affLink = buildMylinkUrl(h.providerUrl ?? '', `hotel-ranking-${city}-${i + 1}`);
      const stars = h.rating ? `★${h.rating.toFixed(1)}` : '';
      const reviews = h.reviewCount ? `리뷰 ${h.reviewCount.toLocaleString()}건` : '';
      const price = h.pricePerNight > 0 ? `1박 ${h.pricePerNight.toLocaleString()}원~` : '';
      return `${i + 1}위. **${h.name}** ${stars} ${reviews} / ${price}\n   - 위치: ${h.location || '시내'}\n   - 예약: ${affLink}`;
    }).join('\n\n');

    const tierLabel = TIER_LABEL[tier] ?? '추천';
    const year      = new Date().getFullYear();
    const topN      = filtered.length;
    const keyword   = `${city} ${tierLabel} 호텔`;
    const h1        = `${city} ${tierLabel} 호텔 TOP ${topN} (${year}년 최신)`;
    const baseUrl   = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.yeosonam.com';
    const internalLink = `${baseUrl}/free-travel`;

    // 3. LLM 블로그 생성
    const systemPrompt = `당신은 한국 여행 블로그 전문 작가입니다. SEO 최적화된 호텔 랭킹 블로그를 작성합니다.
규칙:
- 마크다운 형식 (# H1, ## H2, ### H3)
- H1: "${h1}" 그대로 사용
- H2 4~6개, 각 H2에 "${keyword}" 또는 관련어 자연스럽게 포함
- 1800~2500자
- 각 호텔 섹션: 이름·별점·위치·가격·특징·예약링크 포함
- 추측 형용사("아름다운/환상적인/완벽한") 금지 — 구체 수치만
- 결론에 내부링크(자유여행 플래너) 1회 의무: ${internalLink}
- 마크다운만 출력 (코드블록 X)`;

    const userPrompt = `다음 ${city} ${tierLabel} 호텔 ${topN}곳을 랭킹 형식으로 소개하는 SEO 블로그를 작성하세요.

## 호텔 데이터 (팩트 절대 유지)

${hotelLines}

## 작성 가이드
1. 서론: "${city} ${tierLabel} 호텔을 고를 때 기준이 되는 3가지 (위치·평점·가격)" 형식
2. 각 호텔 ## 섹션: 순위·이름·별점·간단한 특징·예약 링크
3. "## 직접 예약 vs 패키지 가격 비교" H2 1개 필수 (가성비 설명)
4. 결론 + 자유여행 플래너 내부링크: ${internalLink}`;

    const result = await llmCall<string>({
      task: 'blog-generate',
      systemPrompt,
      userPrompt,
      maxTokens:   3000,
      temperature: 0.5,
    });

    let blogHtml = result.rawText?.trim() ?? '';
    if (blogHtml.length < 500) {
      // LLM 실패 시 서식화된 폴백 생성
      blogHtml = `# ${h1}\n\n${city} ${tierLabel} 호텔을 찾고 있다면, 평점과 리뷰 수 기준으로 엄선한 TOP ${topN}을 확인하세요.\n\n${filtered.map((h, i) => {
        const affLink = buildMylinkUrl(h.providerUrl ?? '', `hotel-ranking-${city}-${i + 1}`);
        return `## ${i + 1}위. ${h.name}\n\n- 평점: ★${h.rating?.toFixed(1) ?? 'N/A'} (리뷰 ${(h.reviewCount ?? 0).toLocaleString()}건)\n- 위치: ${h.location || city}\n- 가격: 1박 ${h.pricePerNight.toLocaleString()}원~\n\n[${h.name} 예약하기](${affLink})`;
      }).join('\n\n')}\n\n---\n\n자유여행 전체 견적은 [여소남 자유여행 플래너](${internalLink})에서 확인하세요.`;
    }

    // 4. SEO 메타
    const slugBase   = `${city.replace(/\s+/g, '-')}-${tierLabel}-hotel-top${topN}-${year}`;
    const finalSlug  = await ensureUniqueSlug(slugBase);
    const seoTitle   = `${city} ${tierLabel} 호텔 TOP ${topN} ${year}년 최신 | 여소남`.slice(0, 60);
    const seoDesc    = `${city} ${tierLabel} 호텔 ${topN}곳 평점·가격·위치 비교. MRT 실시간 최저가 기준 랭킹. 바로 예약 가능.`.slice(0, 160);

    // 5. DB 저장
    const insertData = {
      channel:      'naver_blog',
      blog_html:    blogHtml,
      slides:       [],
      status:       publish ? 'published' : 'draft',
      category:     'hotel_ranking',
      slug:         finalSlug,
      seo_title:    seoTitle,
      seo_description: seoDesc,
      destination:  city,
      topic_source: 'mrt_hotel',
      published_at: publish ? new Date().toISOString() : null,
      generation_params: {
        city,
        tier,
        count:        topN,
        hotel_count:  filtered.length,
        ai_model:     result.model ?? 'gemini-2.5-flash',
      },
    };

    const { data: creative, error } = await supabaseAdmin
      .from('content_creatives')
      .insert(insertData)
      .select('id, slug')
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok:      true,
      slug:    finalSlug,
      id:      creative?.id,
      hotels:  topN,
      status:  publish ? 'published' : 'draft',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '생성 실패' },
      { status: 500 },
    );
  }
}
