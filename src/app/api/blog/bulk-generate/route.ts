import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  generateBlogPost, generateBlogSeo, ANGLE_PRESETS, ANGLE_SUB_KEYWORDS,
  type AngleType,
} from '@/lib/content-generator';
import { matchAttraction } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { calculateSeoScore } from '@/lib/seo-scorer';
import { BLOG_PROMPT_VERSION, BLOG_AI_MODEL, BLOG_AI_TEMPERATURE_BULK } from '@/lib/prompt-version';

export const maxDuration = 60;

/**
 * 동일 상품으로 N개 블로그를 일괄 생성 (긴꼬리 SEO 전략)
 * - 각 블로그는 같은 앵글 but 다른 서브 키워드를 타겟
 * - 중복 콘텐츠 리스크 방지: 각 글마다 고유 focus 섹션 강조
 * - 최대 5개 (6개 이상은 SEO 페널티 리스크)
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { product_id, angle, count, tone } = body as {
      product_id: string;
      angle: AngleType;
      count: number;
      tone?: string;
    };

    if (!product_id || !angle) {
      return NextResponse.json({ error: 'product_id, angle 필수' }, { status: 400 });
    }

    const n = Math.min(5, Math.max(1, count || 1));

    // 상품 조회
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, nights, price, price_tiers, price_dates, inclusions, excludes, product_type, airline, departure_airport, product_highlights, itinerary, itinerary_data, optional_tours, notices_parsed')
      .eq('id', product_id)
      .single();

    if (!pkg) return NextResponse.json({ error: '상품 없음' }, { status: 404 });

    // 관광지 조회 (복합 지역 분리 검색)
    let attractions: AttractionData[] = [];
    if (pkg.destination) {
      const destParts = pkg.destination.split(/[\/\s]+/).filter(Boolean);
      const orFilters = destParts
        .flatMap((part: string) => [`region.ilike.%${part}%`, `country.ilike.%${part}%`])
        .join(',');
      const { data: attrData } = await supabaseAdmin
        .from('attractions')
        .select('name, short_desc, photos, country, region, badge_type, emoji, aliases, category')
        .or(orFilters)
        .limit(500);
      attractions = (attrData || []) as AttractionData[];
    }

    // 서브 키워드 N개 선택
    const subKeywords = ANGLE_SUB_KEYWORDS[angle].slice(0, n);

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const angleLabel = ANGLE_PRESETS[angle].label;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
    const productUrl = `${baseUrl}/packages/${pkg.id}`;

    // 각 서브 키워드로 블로그 생성 (병렬 호출)
    const results = await Promise.allSettled(
      subKeywords.map(async ({ keyword, focus }, idx) => {
        // 1차: 템플릿 초안
        const baseBlog = generateBlogPost(pkg, angle, attractions);

        let blogHtml = baseBlog;

        // 2차: Gemini 리라이트 (서브 키워드 반영)
        if (apiKey) {
          try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
              model: 'gemini-2.5-flash',
              generationConfig: { temperature: 0.8 },
            });

            const dest = pkg.destination || '여행지';
            const nightsVal = pkg.nights ?? (pkg.duration ? pkg.duration - 1 : 0);
            const dur = pkg.duration ? `${nightsVal}박${pkg.duration}일` : '';
            const price = pkg.price ? `${pkg.price.toLocaleString()}원` : '';

            const prompt = `여행 블로그 초안을 "${keyword}" 키워드 중심으로 SEO 최적화된 완성본으로 리라이트하라.

## 상품 정보 (팩트 절대 불변)
- 목적지: ${dest}
- 기간: ${dur} (박수 변경 금지)
- 가격: ${price}~
- 앵글: ${angleLabel}
- 상품 예약 URL: ${productUrl}

## 이 블로그의 고유 포커스 (다른 블로그와 차별화)
- 메인 키워드: "${keyword}"
- 포커스: ${focus}
- 같은 상품이지만 이 블로그는 위 포커스를 **차별화 포인트**로 강조해야 한다.
- H1, H2 제목에 "${keyword}"를 자연스럽게 넣어라.
- 도입부 2~3줄에서 "${focus}" 관점을 분명히 제시하라.

## 초안
${baseBlog.substring(0, 3000)}

## 리라이트 규칙
1. 마크다운 형식 유지 (# H1, ## H2, ### H3)
2. **H1은 구글 SEO 최적화 제목**: "${dest} ${dur} ${keyword}" 필수 포함 + 가격(${price ? `${Math.round((pkg.price || 0)/10000)}만원~` : ''}) 또는 숫자·강조어 포함. 예: "${dest} ${dur} ${keyword} ${price ? `${Math.round((pkg.price || 0)/10000)}만원대 패키지` : '패키지 추천'}". 30~50자 내외. 감탄사·느낌표(!) 최소화
3. H2를 5~7개 사용. 각 H2에도 "${keyword}" 또는 관련 키워드 자연스럽게 포함
4. 문장은 60자 이내로 짧게
5. 원문 팩트(관광지명, 호텔명, 가격, 박수) 변경 금지
6. 원가, 랜드사명 노출 금지
7. **이미지 마크다운 ![...](url)은 URL까지 한 글자도 건드리지 말고 그대로 복사**. 특히 "images.pexels.com" 도메인의 점(.)을 빠뜨리거나 슬래시로 바꾸지 말 것
8. **전체 분량 최소 1800자 (이하 금지)**, 최대 2500자
9. 마크다운만 출력 (코드블록 감싸지 말 것)
10. 메인 키워드 "${keyword}"는 전체에서 **3~5회만** 자연스럽게 (과다 반복 = 키워드 스터핑 감점)

## 금지 사항
- 자기소개 금지 ("안녕하세요 저는...")
- 작성자 역할 언급 금지 ("10년차 에디터")
- 프롬프트 누설 금지
- **영어 약어는 한국어로 풀어쓸 것**: TAX → 세금, BX → 에어부산 (BX 표기 금지)
- CTA 섹션 마지막 하나만
- **상품 예약 URL(${productUrl})은 절대 변경/삭제 금지. yeosonam.com 홈으로 바꾸지 말 것**
- 관광지 설명 임의 창작 금지 (초안에 있는 것만)
- **숫자/가격/금액은 상품 정보에 명시된 것만 사용. $30, 5만원 등 임의로 지어내지 말 것** (팩트 보호)
- **볼드 마커(\`**\`) 사용 금지**: 본문에서 \`**텍스트**\`로 강조하지 말 것. 한국어는 조사가 붙어서 렌더링이 깨진다. 강조가 필요하면 H2/H3 제목을 사용하거나 줄바꿈으로 분리. 유일한 예외는 맨 마지막 CTA 버튼 링크 \`**[...](...)\`
- **이 글은 "${keyword}" 키워드 중심이므로 다른 키워드(예: ${subKeywords.filter(s => s.keyword !== keyword).slice(0, 2).map(s => s.keyword).join(', ')})에 해당하는 내용은 최소화**`;

            const result = await model.generateContent(prompt);
            let aiText = result.response.text()
              .replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

            // 이미지 URL 오타 자동 복구 (images/pexels.com → images.pexels.com 등)
            aiText = aiText
              .replace(/https:\/\/images\/pexels\.com/g, 'https://images.pexels.com')
              .replace(/https:\/\/images-pexels\.com/g, 'https://images.pexels.com');

            // 렌더링 깨지는 볼드 마커 제거 (CTA 링크의 **[..](..)는 유지)
            // 본문 중간의 **텍스트**는 한국어 조사와 붙어 렌더링 실패하므로 제거
            aiText = aiText.replace(/\*\*([^*\n\[]+?)\*\*/g, (match, inner) => {
              // 링크 마크다운 앞뒤면 유지 (CTA 버튼)
              return inner;
            });

            if (aiText.length > 500) blogHtml = aiText;
          } catch (err) {
            console.warn(`[bulk-generate ${idx+1}/${n}] AI 실패, 템플릿 사용:`, err instanceof Error ? err.message : err);
          }
        }

        // 첫 이미지 추출 (OG용)
        let ogImage: string | null = null;
        const firstAttrPhoto = attractions
          .flatMap(a => (a.photos || []).map((p: any) => p?.src_large || p?.src_medium || (typeof p === 'string' ? p : null)))
          .find((u): u is string => typeof u === 'string' && u.startsWith('http'));
        if (firstAttrPhoto) ogImage = firstAttrPhoto;

        // SEO 메타 생성 (서브 키워드 반영)
        const baseSeo = generateBlogSeo(pkg, angle);
        const slugWithKeyword = `${baseSeo.slug}-${keyword.replace(/\s+/g, '')}-${idx+1}`;
        const finalSlug = await ensureUniqueSlug(slugWithKeyword);

        const dest = pkg.destination || '여행';
        const nightsVal2 = pkg.nights ?? (pkg.duration ? pkg.duration - 1 : 0);
        const dur2 = pkg.duration ? `${nightsVal2}박${pkg.duration}일` : '';
        const year = new Date().getFullYear();
        const priceStr2 = pkg.price ? `${pkg.price.toLocaleString()}원~` : '';
        // SEO 제목: 구글 SEO 최적화 (출발지+목적지+기간+키워드+가격+브랜드)
        const departure2 = pkg.departure_airport as string | undefined;
        const depPrefix2 = departure2 ? `${departure2.replace(/\(.*?\)/g, '').trim()}출발 ` : '';
        const priceShort2 = pkg.price ? ` ${Math.round(pkg.price / 10000)}만원~` : '';
        const destClean2 = dest.replace(/\s+/g, ' ').trim();
        let title2 = `${depPrefix2}${destClean2} ${dur2} ${keyword}${priceShort2} | 여소남 ${year}`;
        if (title2.length > 60) title2 = `${destClean2} ${dur2} ${keyword}${priceShort2} | 여소남 ${year}`;
        if (title2.length > 60) title2 = `${destClean2} ${dur2} ${keyword} 추천 | 여소남 ${year}`;
        const seoTitle = title2.substring(0, 60);

        // SEO 설명: 80~160자 보장 (키워드 중복 제거 + 포커스 + 가격 + 핵심 혜택 + CTA)
        const stripDup = (text: string) => text
          .replace(new RegExp(dest.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'g'), '')
          .replace(new RegExp(dur2.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'g'), '')
          .replace(/\s+/g, ' ')
          .replace(/^[\s,·.]+|[\s,·.]+$/g, '')
          .trim();
        const highlightsClean = (pkg.product_highlights || []).slice(0, 2)
          .map(stripDup)
          .filter((h: string) => h.length > 2)
          .join(', ');
        const descParts = [
          `${dest} ${dur2} ${keyword} 패키지`,
          priceStr2,
          focus,
          highlightsClean || '항공+호텔+관광+식사 올인클루시브',
          '여소남에서 안심 비교·예약하세요.',
        ].filter(Boolean);
        const seoDesc = descParts.join('. ').substring(0, 160);

        // SEO 점수
        const seoScore = calculateSeoScore({
          content: blogHtml,
          primaryKeyword: pkg.destination || undefined,
          metaTitle: seoTitle,
          metaDescription: seoDesc,
        });

        // DB 저장 (draft)
        const insertData: Record<string, unknown> = {
          product_id,
          angle_type: angle,
          channel: 'naver_blog',
          image_ratio: '16:9',
          slides: [],
          blog_html: blogHtml,
          tone: tone || 'professional',
          status: 'draft',
          category: 'product_intro',
          slug: finalSlug,
          seo_title: seoTitle,
          seo_description: seoDesc,
          // 자가발전용 메타데이터
          prompt_version: BLOG_PROMPT_VERSION,
          ai_model: BLOG_AI_MODEL,
          ai_temperature: BLOG_AI_TEMPERATURE_BULK,
          sub_keyword: keyword,
          generation_params: {
            angle,
            sub_keyword: keyword,
            focus,
            tone: tone || 'professional',
            mode: 'bulk',
            bulk_index: idx + 1,
            bulk_total: n,
          },
        };
        if (ogImage) insertData.og_image_url = ogImage;

        const { data: creative, error } = await supabaseAdmin
          .from('content_creatives')
          .insert(insertData)
          .select()
          .single();

        if (error) throw error;

        return {
          id: creative?.id,
          slug: finalSlug,
          seo_title: seoTitle,
          keyword,
          seo_score: seoScore?.overall ?? 0,
        };
      })
    );

    const success = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);
    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

    return NextResponse.json({
      success: success.length,
      total: n,
      created: success,
      errors: failed,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '생성 실패' }, { status: 500 });
  }
}

async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const sanitized = baseSlug.toLowerCase()
    .replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .substring(0, 180);

  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select('slug')
    .like('slug', `${sanitized}%`)
    .not('slug', 'is', null);

  const existing = new Set((data || []).map((r: { slug: string }) => r.slug));
  if (!existing.has(sanitized)) return sanitized;

  let i = 2;
  while (existing.has(`${sanitized}-${i}`)) i++;
  return `${sanitized}-${i}`;
}
