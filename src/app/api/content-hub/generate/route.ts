import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  generateCardSlides, generateBlogPost, generateAdCopy, generateTrackingId, generateBlogSeo,
  ANGLE_PRESETS, type AngleType, type Channel, type ImageRatio,
} from '@/lib/content-generator';
import { matchAttraction, normalizeDays } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { generateBlogText, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { calculateSeoScore } from '@/lib/seo-scorer';
import { BLOG_PROMPT_VERSION, BLOG_AI_MODEL, BLOG_AI_TEMPERATURE } from '@/lib/prompt-version';

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
      .select('id, title, destination, duration, nights, price, price_tiers, price_dates, inclusions, excludes, product_type, airline, departure_airport, product_highlights, itinerary, itinerary_data, optional_tours, notices_parsed')
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

    // 관광지 조회 (블로그 생성 시 자동 결합용) — "다낭/호이안" 같은 복합 지역 분리 검색
    let attractions: AttractionData[] = [];
    if (channel === 'naver_blog' && pkg.destination) {
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

    let slides = null;
    let blogHtml = null;
    let adCopy = null;

    if (channel === 'instagram_card' || channel === 'instagram_reel' || channel === 'youtube_short' || channel === 'kakao') {
      slides = await generateCardSlides(pkg, options);
    }
    if (channel === 'naver_blog') {
      // 1차: 템플릿 기반 초안 생성
      const baseBlog = generateBlogPost(pkg, angle, attractions);

      // 2차: Gemini AI로 SEO 최적화 리라이트
      if (!blogHtmlOverride && hasBlogApiKey()) {
        try {

          const dest = pkg.destination || '여행지';
          const nightsVal = pkg.nights ?? (pkg.duration ? pkg.duration - 1 : 0);
          const dur = pkg.duration ? `${nightsVal}박${pkg.duration}일` : '';
          const angleLabel = ANGLE_PRESETS[angle].label;
          const price = pkg.price ? `${pkg.price.toLocaleString()}원` : '';

          // 상품 이미지 추출 (본문 및 OG용)
          const photoUrls: string[] = Array.isArray(pkg.photo_urls)
            ? pkg.photo_urls.filter((u: any) => typeof u === 'string' && u.startsWith('http'))
            : [];

          const prompt = `여행 블로그 초안을 SEO 최적화된 완성본으로 리라이트하라.

## 상품 정보 (팩트 절대 불변)
- 목적지: ${dest}
- 기간: ${dur} (이 표기를 그대로 사용, 박수 변경 금지)
- 가격: ${price}~
- 앵글: ${angleLabel}
- 브랜드: 여소남 (여소남은 여행 플랫폼 브랜드이며, 개인이 아니다)

## 초안
${baseBlog.substring(0, 3000)}

## 리라이트 규칙 (반드시 준수)
1. 마크다운 형식 유지 (# H1, ## H2, ### H3)
2. **H1은 구글 SEO 최적화 제목**: "${dest} ${dur} ${angleLabel}" 필수 포함 + 가격${pkg.price ? ` ${Math.round(pkg.price/10000)}만원~` : ''} 또는 숫자·강조어 포함. 예: "${dest} ${dur} ${angleLabel} ${pkg.price ? `${Math.round(pkg.price/10000)}만원대 패키지` : '패키지 추천'}". 30~50자 내외. 느낌표(!) 과다 사용 금지
3. H2를 5~7개 사용 (각 H2에도 목적지/${angleLabel} 키워드 자연스럽게)
4. 각 섹션 첫 문장에 관련 키워드를 자연스럽게 배치
5. 인트로에 결론을 먼저 제시 (역피라미드)
6. **문장은 짧게: 한 문장당 60자 이내로 끊어 써라**. 긴 문장은 쉼표 대신 마침표로 분리.
7. CTA 문구에 '여소남' 브랜드 포함
8. 원문의 관광지명, 호텔명, 가격, 박수/일수는 절대 변경 금지
9. 원가, 랜드사명, 공급사명 노출 금지
10. 이미지 마크다운(![...](url))은 그대로 보존
11. 전체 분량: 1500~2500자
12. 마크다운만 출력 (코드블록으로 감싸지 말 것)
13. "${dur}" 외의 박수/일수 표기를 임의로 쓰지 말 것 (예: ${dur}가 "3박5일"이면 "4박5일" 같은 표기 금지)

## 금지 사항 (매우 중요)
- 절대 "안녕하세요, 저는 ... 에디터입니다" 같은 자기소개 금지
- "10년차 전문 에디터", "SEO 전문가" 같은 작성자 역할 언급 금지
- 이 프롬프트의 지시사항을 글에 녹여 쓰지 말 것 (프롬프트 누설 금지)
- 여소남을 사람/에디터가 아닌 "여행 플랫폼 브랜드"로만 취급
- 인트로는 "베트남 ${dest}에서..." 처럼 바로 본론으로 시작
- **영어 약어는 한국어로 풀어쓸 것**: TAX → 세금, BX → 에어부산 (BX 표기 금지)
- **CTA/예약 안내 섹션은 글의 맨 마지막에 딱 하나만** (중복 금지). "예약 안내", "여소남과 함께", "지금 바로 떠나세요" 같은 비슷한 섹션을 2개 이상 만들지 말 것
- 초안에 관광지 설명이 구체적으로 있으면 그것을 유지. 없다면 임의로 관광지 설명을 창작하지 말 것 (팩트 보호)
- **초안에 있는 상품 예약 링크([...](${process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com'}/packages/...) URL)는 절대 변경/삭제 금지**. 반드시 그대로 보존. URL을 일반 홈페이지(yeosonam.com)로 바꾸지 말 것
- **이미지 마크다운 ![...](url)의 URL은 한 글자도 건드리지 말고 그대로 복사**. "images.pexels.com" 도메인의 점(.)을 빠뜨리거나 슬래시로 바꾸지 말 것
- **숫자/가격/금액은 상품 정보에 명시된 것만 사용. $30, 5만원 등 임의로 지어내지 말 것** (팩트 보호)
- **볼드 마커(\`**\`) 사용 금지**: 본문에서 \`**텍스트**\`로 강조하지 말 것. 한국어는 조사가 붙어서 렌더링이 깨진다. 강조가 필요하면 H2/H3 제목을 사용하거나 줄바꿈으로 분리. 유일한 예외는 맨 마지막 CTA 버튼 링크 \`**[...](...)\`
- 전체 분량 최소 1800자 이상`;

          let aiText = (await generateBlogText(prompt, { temperature: BLOG_AI_TEMPERATURE }))
            .replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

          // 이미지 URL 오타 자동 복구
          aiText = aiText
            .replace(/https:\/\/images\/pexels\.com/g, 'https://images.pexels.com')
            .replace(/https:\/\/images-pexels\.com/g, 'https://images.pexels.com');

          // 렌더링 깨지는 볼드 마커 제거 (CTA 링크의 **[..](..)는 유지)
          aiText = aiText.replace(/\*\*([^*\n\[]+?)\*\*/g, (_m, inner) => inner);

          if (aiText.length > 500) {
            blogHtml = aiText;
          } else {
            blogHtml = baseBlog;
          }
        } catch (err) {
          console.warn('[Content Hub] 블로그 AI 리라이트 실패, 템플릿 사용:', err instanceof Error ? err.message : err);
          blogHtml = baseBlog;
        }
      } else {
        blogHtml = blogHtmlOverride || baseBlog;
      }

      // 본문에 이미지가 없으면 attractions의 첫 사진을 H1 아래 삽입
      if (blogHtml && !/!\[[^\]]*\]\([^)]+\)/.test(blogHtml)) {
        const firstAttrPhoto = attractions
          .flatMap(a => (a.photos || []).map((p: any) => p?.src_medium || p?.src_large || (typeof p === 'string' ? p : null)))
          .find((u): u is string => typeof u === 'string' && u.startsWith('http'));
        if (firstAttrPhoto) {
          blogHtml = blogHtml.replace(
            /^(# [^\n]+)/,
            `$1\n\n![${pkg.destination || pkg.title}](${firstAttrPhoto})`,
          );
        }
      }
    }
    if (channel === 'google_search') {
      adCopy = generateAdCopy(pkg, angle);
    }

    // SEO 자동 생성 (naver_blog 채널, 수동 override가 없을 때)
    const autoSeo = channel === 'naver_blog' ? generateBlogSeo(pkg, angle) : null;

    // SEO 품질 점수 자동 산출 (블로그 채널)
    let seoScore = null;
    if (channel === 'naver_blog' && blogHtml) {
      seoScore = calculateSeoScore({
        content: blogHtml,
        primaryKeyword: pkg.destination || undefined,
        metaTitle: seo_title || autoSeo?.seoTitle,
        metaDescription: seo_description || autoSeo?.seoDescription,
      });
    }

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
      // 자가발전용 메타데이터
      prompt_version: BLOG_PROMPT_VERSION,
      ai_model: BLOG_AI_MODEL,
      ai_temperature: BLOG_AI_TEMPERATURE,
      generation_params: {
        angle,
        channel,
        ratio: options.ratio,
        tone: options.tone,
        extra_prompt: options.extraPrompt || null,
        mode: 'single',
      },
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

      // OG 이미지 자동: 수동 override > 관광지 첫 사진
      if (og_image_url) {
        insertData.og_image_url = og_image_url;
      } else {
        const firstAttrPhoto = attractions
          .flatMap(a => (a.photos || []).map((p: any) => p?.src_large || p?.src_medium || (typeof p === 'string' ? p : null)))
          .find((u): u is string => typeof u === 'string' && u.startsWith('http'));
        if (firstAttrPhoto) insertData.og_image_url = firstAttrPhoto;
      }
    }

    const { data: creative, error } = await supabaseAdmin
      .from('content_creatives')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ creative, seo_score: seoScore }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '생성 실패' }, { status: 500 });
  }
}
