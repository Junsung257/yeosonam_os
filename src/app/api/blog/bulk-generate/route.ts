import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  generateBlogPost, generateBlogSeo, ANGLE_PRESETS, ANGLE_SUB_KEYWORDS,
  type AngleType,
} from '@/lib/content-generator';
import { matchAttraction } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { generateBlogText, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { calculateSeoScore } from '@/lib/seo-scorer';
import { BLOG_PROMPT_VERSION, BLOG_AI_MODEL, BLOG_AI_TEMPERATURE_BULK } from '@/lib/prompt-version';
import { getTopPerformingBlogExcerpts, formatFewShotBlock } from '@/lib/blog-few-shot';
import { pickMarketingPrice } from '@/lib/marketing-price';

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

    // Compound learning: 같은 (destination, angle) 의 과거 성공 글 발췌
    // 0개면 빈 문자열 — 신규 목적지·앵글은 자연스럽게 skip
    const fewShotExamples = await getTopPerformingBlogExcerpts(
      pkg.destination,
      angle,
      { excludeProductId: pkg.id, limit: 3, minViewCount: 30 },
    );
    const fewShotBlock = formatFewShotBlock(fewShotExamples);

    const angleLabel = ANGLE_PRESETS[angle].label;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
    const productUrl = `${baseUrl}/packages/${pkg.id}`;

    // 각 서브 키워드로 블로그 생성 (병렬 호출)
    const results = await Promise.allSettled(
      subKeywords.map(async ({ keyword, focus }, idx) => {
        // 1차: 템플릿 초안
        const baseBlog = generateBlogPost(pkg, angle, attractions);

        let blogHtml = baseBlog;

        // 2차: AI 리라이트 (서브 키워드 반영)
        if (hasBlogApiKey()) {
          try {

            const dest = pkg.destination || '여행지';
            const nightsVal = pkg.nights ?? (pkg.duration ? pkg.duration - 1 : 0);
            const dur = pkg.duration ? `${nightsVal}박${pkg.duration}일` : '';
            // v3.2 마케팅 단일가격 fix — price_dates 최저가 정직 사용
            const marketingPrice = pickMarketingPrice(pkg);
            const price = marketingPrice ? `${marketingPrice.toLocaleString()}원` : '';

            const departure = pkg.departure_airport ? pkg.departure_airport.replace(/\(.*?\)/g, '').trim() : '';
            const internalDestLink = `${baseUrl}/packages?destination=${encodeURIComponent(dest)}`;
            // Prompt injection 방어: 줄바꿈·과도한 백틱 제거 (DB→prompt 사용자 입력 격리)
            const sanitizeWs = (s: string) => s.split(/[\r\n\t]+/).join(' ');
            const safe = (s: string | null | undefined) =>
              sanitizeWs(s ?? '')
                .replace(/`{3,}/g, "'''")
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 200);
            const highlightsForFab = (pkg.product_highlights || []).slice(0, 3).map(safe).filter(Boolean).join(' / ');
            const inclusionsForAnchor = (pkg.inclusions || []).slice(0, 5).map(safe).filter(Boolean).join(' / ');
            const priceMan = marketingPrice ? Math.round(marketingPrice / 10000) : 0;
            // 프롬프트에 직접 삽입되는 사용자 입력값 모두 sanitize
            const safeDest = safe(dest) || '여행지';
            const safeDur = safe(dur);
            const safeDeparture = safe(departure);
            const safeAirline = safe(pkg.airline);

            const prompt = `여행 블로그 초안을 "${keyword}" 키워드 중심으로, **검색자가 3초 안에 "이거다" 느끼는 구매 결정 가이드**로 리라이트하라. AI가 쓴 정보 카탈로그 X, 사람이 쓴 세일즈 가이드 O.

## 상품 정보 (팩트 절대 불변)
- 목적지: ${safeDest}
- 기간: ${safeDur} (박수 변경 금지)
- 가격: ${price}~
- 출발: ${safeDeparture || '미지정'}
- 항공: ${safeAirline || '미지정'}
- 앵글: ${angleLabel}
- 핵심 포인트(원문): ${highlightsForFab || '없음'}
- 포함사항(원문): ${inclusionsForAnchor || '없음'}
- 상품 예약 URL: ${productUrl}
- 같은 목적지 상품 비교 URL (내부링크 의무): ${internalDestLink}

## 이 블로그의 고유 포커스
- 메인 키워드: "${keyword}"
- 포커스: ${focus}
- H1·H2에 "${keyword}" 자연스럽게 포함
- 도입부 2~3줄에서 "${focus}" 관점 분명히 제시

${fewShotBlock}## 초안 (참고용 — 구조만 차용, 문장은 아래 P0 세일즈 프레임으로 재작성)
${baseBlog.substring(0, 3000)}

═══════════════════════════════════════════════
## 🎯 P0 세일즈마스터 프레임 (절대 준수)
═══════════════════════════════════════════════

### [1] Hook — 첫 200자 안에 구체적 갈고리
도입부는 "여행을 꿈꾸시나요?" 같은 평이한 질문 금지. 다음 중 1개 이상 필수:
- 가격 절감액 ("같은 호텔 단품으로 잡으면 약 ${priceMan ? Math.round(priceMan * 1.3) + '만원' : '시중가'}, 패키지 ${priceMan}만원~ — ${priceMan ? Math.round(priceMan * 0.3) + '만원' : ''} 차이")
- 시간 절약 (셔틀·픽업으로 절약되는 분 단위)
- 구체 통계 (입력에 있을 때만: 객실수·운영연차·평점)
- 의외성 질문 ("${dest} ${dur}가 100만원대로 가능한 진짜 이유")
"잊지 못할 / 환상적인 / 완벽한 / 아름다운" 같은 추측 형용사 도입부 사용 금지.

### [2] FAB 변환 — 특징을 베네핏으로
포함사항·옵션을 단순 나열 금지. 반드시 "고객이 얻는 것"으로 변환:
- ❌ "올인클루시브 제공"
- ✅ "4박 내내 지갑 한 번 안 꺼냅니다 — 가족 4인 기준 현지 식음료비 약 80만원 절약"
- ❌ "리조트 셔틀 제공"
- ✅ "택시 흥정·바가지 걱정 없이 시내 야시장까지 무료"
- ❌ "5성급 호텔"
- ✅ "${pkg.airline || '항공사'} 도착 후 30분 만에 체크인, 발코니 욕조에서 첫 일몰"
원문 데이터에 없는 수치(절약액·시간·평점)는 절대 만들지 말 것. 추정 표현은 "약~", "~정도"로 명시.

### [3] 가격 앵커링 H2 의무
"## 같은 일정 직접 잡으면 얼마?" 또는 유사 H2 1개 필수.
구조:
1. 단품 시중가 추정 (호텔 1박 평균 × 박수 + 항공 왕복 시세)
2. 패키지 가격 (${price})
3. 절감액 명시 (시중가 - 패키지가) 또는 "약 N% 저렴"
"시중가 추정"이라고 분명히 표기 (확정 사실 아님 명시). 구체 수치 모르면 이 단락 생략.

### [4] E-E-A-T — 검증 가능한 정보만
- ❌ "아름다운 해변과 조화를 이루는 건축미"
- ✅ "${dest}에서 차로 30분 (${pkg.airline || '항공'} 도착 기준)"
- 입력에 있는 IATA 코드·시각·박수만 사용
- 추측 형용사 ("최고의", "환상적인", "완벽한") 절대 금지
- "5성급" 같은 등급은 입력에 명시되어 있을 때만

### [5] 3-Tier CTA 배치
3개 위치에 분산 — 각각 다른 액션:
1. **Above-fold (도입부 끝)**: "💬 카카오톡 1분 상담 — 같은 ${dest} 패키지 즉시 비교"
   링크: ${productUrl}?utm=blog_top
2. **중간 (일정표 직후)**: "📅 출발일별 잔여석 보기"
   링크: ${productUrl}?utm=blog_mid
3. **하단 (FAQ 직후)**: "👉 ${dest} ${dur} 상품 상세 보기"
   링크: ${productUrl}?utm=blog_bottom
하단 CTA 링크만 \`**[..](..)\` 볼드 허용 (마지막 1개).

### [6] 내부·외부 링크 의무
- 내부링크 ≥2: 같은 목적지 비교 링크 ${internalDestLink} (의무) + 다른 H2에서 한 번 더 내부 참조
- 외부 권위링크 ≥1: 비자·여권 안내 시 외교부 영사 https://www.0404.go.kr 또는 동급 정부 사이트
- 내부링크는 자연스러운 문장 안에 (예: "다른 일정도 비교해 보고 싶다면 [같은 ${dest} 출발일 모음](${internalDestLink})에서 확인할 수 있어요")

═══════════════════════════════════════════════
## 형식 규칙
═══════════════════════════════════════════════
1. 마크다운 (# H1 / ## H2 / ### H3)
2. **H1**: "${dest} ${dur} ${keyword}" 필수 포함 + 가격${price ? '(' + priceMan + '만원~)' : ''} 또는 숫자·강조어. 30~50자. 느낌표 최소화
3. H2 5~7개. 각 H2에 "${keyword}" 또는 관련어 자연스럽게
4. 문장은 60자 이내, 한 문단 4문장 이내
5. 분량 1800~2500자 (지키지 못하면 실패 처리)
6. 마크다운만 출력 (코드블록 X)
7. 메인 키워드 "${keyword}" 전체에서 **3~5회만** (스터핑 감점)
8. 이미지 \`![...](url)\` URL 한 글자도 건드리지 말 것 (특히 images.pexels.com 점 보존)

## 금지 사항
- 자기소개 / 작성자 페르소나 ("10년차 에디터") / 프롬프트 누설
- 영어 약어 (TAX → 세금, BX → 에어부산)
- 원가·랜드사명 노출
- 상품 예약 URL(${productUrl}) 변경·삭제
- 관광지 설명 임의 창작 (초안 외)
- 입력 외 숫자·가격·평점·통계 창작
- 본문 \`**텍스트**\` 볼드 (한국어 조사 깨짐). 예외: 마지막 CTA 버튼 \`**[..](..)\`만
- 다른 키워드(${subKeywords.filter(s => s.keyword !== keyword).slice(0, 2).map(s => s.keyword).join(', ')}) 내용 최소화
- 추측 형용사: "아름다운/환상적인/완벽한/특별한/매력적인/잊지 못할/놓치지 마세요/꼭 가봐야 할/최고의/인생샷/설레는/낭만적인/제대로/알찬/만끽/힐링" — 1500자 기준 합산 2회 이하
- "다녀왔는데 / 가봤어요 / 직접 체크" 같은 가짜 1인칭 경험 (실제 경험 아니면 거짓말)`;

            const rawText = await generateBlogText(prompt, { temperature: BLOG_AI_TEMPERATURE_BULK });
            let aiText = rawText
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
        const marketingPrice2 = pickMarketingPrice(pkg);
        const priceStr2 = marketingPrice2 ? `${marketingPrice2.toLocaleString()}원~` : '';
        // SEO 제목: 구글 SEO 최적화 (출발지+목적지+기간+키워드+가격+브랜드)
        const departure2 = pkg.departure_airport as string | undefined;
        const depPrefix2 = departure2 ? `${departure2.replace(/\(.*?\)/g, '').trim()}출발 ` : '';
        const priceShort2 = marketingPrice2 ? ` ${Math.round(marketingPrice2 / 10000)}만원~` : '';
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
            // Compound learning loop 추적
            few_shot_examples_count: fewShotExamples.length,
            few_shot_total_views: fewShotExamples.reduce((sum, ex) => sum + ex.viewCount, 0),
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
