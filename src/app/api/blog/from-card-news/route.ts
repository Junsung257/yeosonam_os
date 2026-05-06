import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { updateFactoryJobStep } from '@/lib/content-factory-step';
import { generateBlogJSON, generateBlogText, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { generateBlogPost, generateBlogSeo, ANGLE_PRESETS } from '@/lib/content-generator';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';
import { calculateSeoScore } from '@/lib/seo-scorer';
import { BLOG_PROMPT_VERSION, BLOG_AI_MODEL, BLOG_AI_TEMPERATURE } from '@/lib/prompt-version';
import { generateBlogBody } from '@/lib/content-pipeline/blog-body';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { ContentBrief } from '@/lib/validators/content-brief';
import { pickMarketingPrice } from '@/lib/marketing-price';
import { getSecret } from '@/lib/secret-registry';
import { fetchApprovedReviewSnippets, formatReviewQuotesForPrompt } from '@/lib/blog-review-quotes';

/** blog-publisher가 내부 fetch로 호출할 때 Brief+본문 생성이 60초를 넘기면 잘리므로, 상위 크론(300s) 안에서 여유 있게 실행 */
export const maxDuration = 240;

/** blog-publisher 크론만: 본문 생성만 하고 DB INSERT는 호출자(멱등 단일 커밋)가 담당 */
function isPublisherBridge(request: NextRequest, body: { publisher_bridge?: boolean }): boolean {
  if (!body.publisher_bridge) return false;
  const secret = getSecret('CRON_SECRET');
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * 카드뉴스를 기반으로 블로그 자동 생성 (하이브리드 이미지)
 *
 * 입력:
 *   - card_news_id: 기준 카드뉴스 ID
 *   - slide_image_urls: 클라이언트에서 캡처해 Storage에 업로드한 PNG URLs (길이 = 슬라이드 수)
 *   - publisher_bridge: true + Authorization: Bearer CRON_SECRET → 생성 결과만 반환 (INSERT 없음, blog-publisher 전용)
 *
 * 흐름:
 *   1. 카드뉴스 조회 (mode, topic, category, package 또는 주제)
 *   2. 상품 모드: 기존 generateBlogPost + attractions 사진
 *   3. 정보성 모드: AI가 주제 기반 블로그 생성 + Pexels 맥락 이미지
 *   4. 카드뉴스 PNG를 주요 섹션에, Pexels/attractions는 관광지/맥락 섹션에 배치
 *   5. content_creatives 신규 INSERT (draft) — publisher_bridge 시 생략
 *   6. card_news.linked_blog_id 업데이트 — publisher_bridge 시 생략
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { card_news_id, slide_image_urls, publisher_bridge } = body as {
      card_news_id: string;
      slide_image_urls?: string[];
      publisher_bridge?: boolean;
    };

    if (publisher_bridge && !isPublisherBridge(request, body)) {
      return NextResponse.json(
        { error: 'publisher_bridge는 CRON_SECRET Bearer 인증이 있을 때만 허용됩니다.' },
        { status: 403 },
      );
    }

    if (!card_news_id) {
      return NextResponse.json({ error: 'card_news_id 필수' }, { status: 400 });
    }

    // 1. 카드뉴스 조회
    const { data: cn, error: cnError } = await supabaseAdmin
      .from('card_news')
      .select('*')
      .eq('id', card_news_id)
      .single();
    if (cnError || !cn) {
      return NextResponse.json({ error: '카드뉴스를 찾을 수 없습니다.' }, { status: 404 });
    }

    const cardMode = cn.card_news_type || (cn.package_id ? 'product' : 'info');
    const cardNewsImages: string[] = Array.isArray(slide_image_urls) && slide_image_urls.length > 0
      ? slide_image_urls
      : [];

    if (!hasBlogApiKey()) {
      return NextResponse.json({ error: 'AI API 키 미설정' }, { status: 503 });
    }

    let blogHtml = '';
    let slug = '';
    let seoTitle = '';
    let seoDesc = '';
    let productId: string | null = null;
    let categoryId: string | null = null;
    let angleType = 'value';

    // ── 신규: Brief 기반 통합 파이프라인 (큐레이터 페르소나 + Few-shot) ──
    let brief: ContentBrief | null = (cn.generation_config as any)?.brief || null;
    let productData: any = null;

    if (cardMode === 'product' && cn.package_id) {
      productId = cn.package_id;
      angleType = (cn as any).angle_type || 'value';

      const { data: pkg } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, duration, nights, price, price_tiers, price_dates, inclusions, excludes, product_type, airline, departure_airport, product_highlights, itinerary, itinerary_data, optional_tours, notices_parsed')
        .eq('id', cn.package_id)
        .single();
      if (!pkg) return NextResponse.json({ error: '연결된 상품을 찾을 수 없습니다.' }, { status: 404 });
      productData = pkg;

      // Brief 없으면 즉석 생성 (기존 카드뉴스 호환)
      if (!brief) {
        try {
          brief = await generateContentBrief({
            mode: 'product',
            slideCount: Math.max(3, cardNewsImages.length || 6),
            product: pkg,
            angle: angleType,
          });
        } catch (err) {
          console.warn('[from-card-news] Brief 즉석 생성 실패:', err instanceof Error ? err.message : err);
        }
      }
    } else {
      // 정보성 모드
      const topic = cn.topic || cn.title || '여행 정보';
      categoryId = cn.category_id || null;

      let categoryLabel = '';
      if (categoryId) {
        const { data: cat } = await supabaseAdmin
          .from('blog_categories')
          .select('key, label')
          .eq('id', categoryId)
          .limit(1);
        if (cat?.[0]) categoryLabel = cat[0].label;
      }

      if (!brief) {
        try {
          brief = await generateContentBrief({
            mode: 'info',
            slideCount: Math.max(3, cardNewsImages.length || 6),
            topic,
            category: categoryLabel,
          });
        } catch (err) {
          console.warn('[from-card-news] Info Brief 즉석 생성 실패:', err instanceof Error ? err.message : err);
        }
      }
    }

    // ── Brief 기반 generateBlogBody 호출 (큐레이터 페르소나 + Few-shot 자동 적용) ──
    if (brief) {
      try {
        // 슬라이드 이미지 매핑 (position 1부터)
        const slideImageMap: Record<number, string> = {};
        cardNewsImages.forEach((url, idx) => {
          slideImageMap[idx + 1] = url;
        });

        // Pexels 보조 이미지 매핑 (각 H2별로 1장)
        const pexelsImageMap: Record<number, string> = {};
        if (isPexelsConfigured()) {
          await Promise.all(
            brief.sections.map(async (s) => {
              try {
                const photos = await searchPexelsPhotos(s.card_slide.pexels_keyword || (productData?.destination || 'travel'), 3);
                const url = photos[0]?.src?.large2x || photos[0]?.src?.large || '';
                if (url) pexelsImageMap[s.position] = url;
              } catch { /* noop */ }
            })
          );
        }

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
        let reviewQuotesMarkdown: string | null = null;
        if (productData) {
          const snips = await fetchApprovedReviewSnippets({
            packageId: productData.id,
            destination: productData.destination,
            limit: 4,
          });
          reviewQuotesMarkdown = formatReviewQuotesForPrompt(snips) || null;
        }
        blogHtml = await generateBlogBody({
          brief,
          slideImageMap,
          pexelsImageMap,
          productContext: productData ? {
            title: productData.title,
            destination: productData.destination,
            duration: productData.duration,
            nights: productData.nights,
            price: productData.price,
            airline: productData.airline,
            departure_airport: productData.departure_airport,
            inclusions: productData.inclusions,
            itinerary: productData.itinerary,
            product_id: productData.id,
          } : undefined,
          baseUrl,
          reviewQuotesMarkdown,
        });

        slug = `${brief.seo.slug_suggestion}-cn`;
        seoTitle = brief.seo.title;
        seoDesc = brief.seo.description;
      } catch (err) {
        console.error('[from-card-news] generateBlogBody 실패:', err instanceof Error ? err.message : err);
        return NextResponse.json(
          { error: 'Brief 생성 실패 — 재시도 크론이 자동 처리합니다.', retryable: true },
          { status: 500 },
        );
      }
    }

    // slug 중복 방지
    const finalSlug = await ensureUniqueSlug(slug);

    // OG 이미지: 카드뉴스 첫 번째 PNG (우선) > 배경 이미지
    const ogImage = cardNewsImages[0]
      || (cn.slides as any[])?.[0]?.bg_image_url
      || null;

    // SEO 점수 산출
    const seoScore = calculateSeoScore({
      content: blogHtml,
      primaryKeyword: (cardMode === 'product' ? (cn as any).destination : cn.topic) || undefined,
      metaTitle: seoTitle,
      metaDescription: seoDesc,
    });

    // blog-publisher: 생성만 반환 — 단일 INSERT·품질 게이트·색인은 퍼블리셔가 처리 (중복 draft / 큐 stuck 방지)
    if (publisher_bridge) {
      return NextResponse.json(
        {
          publisher_bridge: true,
          blog_html: blogHtml,
          slug: finalSlug,
          seo_title: seoTitle,
          seo_description: seoDesc,
          og_image_url: ogImage,
          angle_type: angleType,
          category: cardMode === 'product' ? 'product_intro' : 'info',
          category_id: categoryId,
          product_id: productId,
          seo_score: seoScore,
          card_news_id,
        },
        { status: 200 },
      );
    }

    // content_creatives에 저장 (draft)
    const insertData: Record<string, unknown> = {
      angle_type: angleType,
      channel: 'naver_blog',
      image_ratio: '16:9',
      slides: [],
      blog_html: blogHtml,
      status: 'draft',
      slug: finalSlug,
      seo_title: seoTitle,
      seo_description: seoDesc,
      og_image_url: ogImage,
      prompt_version: BLOG_PROMPT_VERSION,
      ai_model: BLOG_AI_MODEL,
      ai_temperature: BLOG_AI_TEMPERATURE,
      generation_params: {
        source: 'card_news',
        card_news_id,
        mode: cardMode,
      },
      category: cardMode === 'product' ? 'product_intro' : 'info',
      category_id: categoryId,
    };
    if (productId) insertData.product_id = productId;

    const { data: creative, error: creativeError } = await supabaseAdmin
      .from('content_creatives')
      .insert(insertData)
      .select()
      .single();
    if (creativeError) throw creativeError;

    // 카드뉴스에 linked_blog_id 연결 + 이미지 URL 저장
    await supabaseAdmin
      .from('card_news')
      .update({
        linked_blog_id: (creative as any).id,
        slide_image_urls: cardNewsImages,
        updated_at: new Date().toISOString(),
      })
      .eq('id', card_news_id);

    revalidatePath('/blog');

    // blog_generate 스텝 완료 마킹 (fire-and-forget)
    updateFactoryJobStep(card_news_id, 'blog_generate', 'done');

    return NextResponse.json(
      {
        blog: creative,
        blog_id: (creative as { id: string }).id,
        blog_html: blogHtml,
        slug: finalSlug,
        seo_title: seoTitle,
        seo_description: seoDesc,
        og_image_url: ogImage,
        seo_score: seoScore,
        card_news_id,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[blog/from-card-news] 오류:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '블로그 생성 실패' },
      { status: 500 },
    );
  }
}

// ── Gemini: 상품 블로그 리라이트 + 하이브리드 이미지 ─────────────
async function geminiRewriteWithHybridImages(opts: {
  baseBlog: string;
  cardNewsImages: string[];
  pkg: any;
  angle: string;
  isProduct: boolean;
}): Promise<string> {
  const { baseBlog, cardNewsImages, pkg, angle } = opts;
  const angleLabel = (ANGLE_PRESETS as any)[angle]?.label || angle;
  const dest = pkg.destination || '여행지';
  const nightsVal = pkg.nights ?? (pkg.duration ? pkg.duration - 1 : 0);
  const dur = pkg.duration ? `${nightsVal}박${pkg.duration}일` : '';
  // v3.2 마케팅 단일가격 fix
  const marketingPrice = pickMarketingPrice(pkg);
  const price = marketingPrice ? `${marketingPrice.toLocaleString()}원` : '';

  const cardImgList = cardNewsImages.map((u, i) => `  슬라이드${i+1}: ${u}`).join('\n');

  const prompt = `여행 블로그 초안을 SEO 최적화된 완성본으로 리라이트하라.

## 상품 정보 (팩트 절대 불변)
- 목적지: ${dest}
- 기간: ${dur} (박수 변경 금지)
- 가격: ${price}~
- 앵글: ${angleLabel}
- 상품 예약 URL: ${process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com'}/packages/${pkg.id}

## 카드뉴스 이미지 (브랜드 디자인 PNG, 주요 섹션에 삽입)
${cardImgList || '(없음)'}

## 초안 (attractions 사진 포함)
${baseBlog.substring(0, 3500)}

## 리라이트 규칙
1. 마크다운 형식 (# H1, ## H2, ### H3)
2. H1에 목적지+${dur}+${angleLabel} 필수 포함
3. H2를 5~7개 사용
4. 문장은 60자 이내로 짧게
5. **하이브리드 이미지 배치**:
   - **카드뉴스 이미지**는 "왜 이 상품인가", "핵심 혜택", "예약 안내" 같은 **브랜드/메시지 섹션 H2 아래**에 삽입
   - **초안에 있는 attractions 이미지(![...](...))**는 **관광지 소개 H3 아래**에 그대로 유지
   - 각 이미지 alt 텍스트는 구체적으로 (예: "다낭/호이안 ${angleLabel} 패키지 소개")
6. 원문 팩트(관광지명, 호텔명, 가격, 박수) 변경 금지
7. 원가, 랜드사명 노출 금지
8. **이미지 URL은 한 글자도 건드리지 말고 그대로 복사** (https://... 그대로)
9. 전체 1800~2500자
10. 마크다운만 출력 (코드블록 감싸지 말 것)

## 금지 사항
- 자기소개 ("10년차 에디터" 등) 금지
- 영어 약어(TAX, BX)는 한글로 풀어쓰기
- **본문에 볼드 마커 \`**\` 사용 금지** (CTA 링크 제외)
- 가격 임의 창작 금지
- CTA 섹션 마지막 하나만
- 상품 예약 URL 변경 금지`;

  try {
    let aiText = (await generateBlogText(prompt, { temperature: BLOG_AI_TEMPERATURE }))
      .replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    // 이미지 URL 오타 자동 복구
    aiText = aiText
      .replace(/https:\/\/images\/pexels\.com/g, 'https://images.pexels.com')
      .replace(/https:\/\/images-pexels\.com/g, 'https://images.pexels.com');
    // 볼드 마커 제거 (CTA 링크 제외)
    aiText = aiText.replace(/\*\*([^*\n\[]+?)\*\*/g, (_m, inner) => inner);

    // 동일 이미지 URL 중복 제거 (AI가 같은 슬라이드를 반복 삽입한 경우)
    {
      const seen = new Set<string>();
      aiText = aiText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, _alt, url) => {
        if (seen.has(url)) return '';
        seen.add(url);
        return match;
      });
      aiText = aiText.replace(/\n{3,}/g, '\n\n');
    }

    // 내부명 alt 텍스트 정리
    aiText = aiText.replace(/!\[\s*슬라이드\s*\d+\s*\]/g, `![${pkg.destination || pkg.title || '여행'}]`);

    return aiText.length > 500 ? aiText : baseBlog;
  } catch (err) {
    console.warn('[from-card-news] Gemini 리라이트 실패:', err instanceof Error ? err.message : err);
    return baseBlog;
  }
}

// ── Gemini: 정보성 블로그 생성 (Pexels 맥락 이미지 + 카드뉴스 PNG) ──
async function generateInfoBlog(opts: {
  topic: string;
  categoryLabel: string;
  cardNewsImages: string[];
}): Promise<string> {
  const { topic, categoryLabel, cardNewsImages } = opts;

  const cardImgList = cardNewsImages.map((u, i) => `  슬라이드${i+1}: ${u}`).join('\n');

  // Step 1: 블로그 뼈대 생성 (H2 섹션 구조 + Pexels 검색어)
  const outlinePrompt = `여행 정보 블로그의 H2 섹션 구조를 설계하라.

## 주제
${topic}

## 카테고리
${categoryLabel || '여행 정보'}

## 지시
- H2를 5~7개 설계
- 각 H2에 해당하는 **영문 Pexels 검색어**도 함께 생성 (실제 콘텐츠 맥락에 맞는 구체적 키워드 3~4단어)
- 반드시 JSON 배열만 출력 (마크다운 금지):
[
  { "h2": "섹션 제목", "pexels_keyword": "english keyword for pexels" },
  ...
]`;

  let outline: { h2: string; pexels_keyword: string }[] = [];
  try {
    const outlineText = (await generateBlogJSON(outlinePrompt, { temperature: BLOG_AI_TEMPERATURE }))
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      outline = JSON.parse(outlineText);
    } catch {
      const match = outlineText.match(/\[[\s\S]*\]/);
      if (match) outline = JSON.parse(match[0]);
    }
  } catch {
    outline = [];
  }

  // 기본 outline fallback
  if (!Array.isArray(outline) || outline.length === 0) {
    outline = [
      { h2: `${topic} 핵심 포인트`, pexels_keyword: 'travel guide information' },
      { h2: '준비물 체크리스트', pexels_keyword: 'travel preparation checklist' },
      { h2: '주의사항 및 팁', pexels_keyword: 'travel tips advice' },
      { h2: '자주 묻는 질문', pexels_keyword: 'travel faq question' },
      { h2: '여소남과 함께 여행 시작', pexels_keyword: 'travel booking holiday' },
    ];
  }

  // Step 2: Pexels 이미지 로드 (맥락 이미지)
  const pexelsEnabled = isPexelsConfigured();
  const pexelsImages: string[] = [];
  if (pexelsEnabled) {
    for (const o of outline) {
      try {
        const photos = await searchPexelsPhotos(o.pexels_keyword, 3);
        const url = photos[0]?.src?.large2x || photos[0]?.src?.large || '';
        pexelsImages.push(url);
      } catch {
        pexelsImages.push('');
      }
    }
  }

  // Step 3: 본문 생성 — 각 H2에 정확한 이미지 URL 매핑 (중복/누락 방지)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';

  // 하이브리드 이미지 할당: H2 섹션별로 카드뉴스 PNG 우선, 없으면 Pexels
  // - cardNewsImages[0] → H1 아래 (표지)
  // - cardNewsImages[1..N-2] → H2 섹션 1..N-2 (내용)
  // - cardNewsImages[N-1] → 마지막 CTA 섹션
  const h1Image = cardNewsImages[0] || null;
  const lastImage = cardNewsImages.length > 1 ? cardNewsImages[cardNewsImages.length - 1] : null;
  const middleCardImages = cardNewsImages.slice(1, Math.max(1, cardNewsImages.length - 1));

  const outlineWithAssignedImages = outline.map((o, i) => {
    // 각 H2에 카드뉴스 중간 슬라이드 우선, 없으면 Pexels
    const cardImg = middleCardImages[i] || null;
    const pexelsImg = pexelsImages[i] || null;
    return {
      h2: o.h2,
      assigned_image: cardImg || pexelsImg,
      image_type: cardImg ? 'card' : (pexelsImg ? 'pexels' : 'none'),
    };
  });

  const bodyPrompt = `여행 정보 블로그를 작성하라.

## 주제
${topic}

## 카테고리
${categoryLabel || '여행 정보'}

## 섹션별 정확한 이미지 배치 (반드시 그대로 사용, URL 한 글자도 변경 금지)

### H1 바로 아래 이미지:
${h1Image ? `![${topic}](${h1Image})` : '(없음)'}

### 각 H2 섹션과 그 아래에 삽입할 이미지:
${outlineWithAssignedImages.map((o, i) => `
${i + 1}. H2: "${o.h2}"
   이미지: ${o.assigned_image ? `![${o.h2}](${o.assigned_image})` : '(이미지 없음 — 삽입 생략)'}
`).join('')}

### 마지막 CTA 섹션 바로 아래:
${lastImage && lastImage !== h1Image ? `![${topic} 여소남](${lastImage})` : '(없음)'}

## 작성 규칙
1. 마크다운 형식 (# H1, ## H2)
2. H1에 주제 키워드 자연스럽게 포함. **H1 바로 다음 줄에 위에 지정된 "H1 바로 아래 이미지"를 그대로 삽입**
3. H2 이름은 위 구조 그대로 사용 (변경 금지)
4. **각 H2 바로 다음 줄에 위에 지정된 해당 섹션 이미지를 그대로 삽입** (복사-붙여넣기)
5. 같은 이미지를 2번 사용하지 말 것 (각 이미지는 지정된 위치에 1번만)
6. H2 본문은 3~6문장, 문장은 60자 이내로 짧게
7. 실용 정보 위주 (구체적 숫자, 절차, 팁)
8. 전체 1500~2500자
9. 마지막 CTA 섹션: 위에 지정된 "마지막 CTA 이미지" 삽입 후, "[👉 여소남에서 여행 준비하기](${baseUrl})" 링크
10. 마크다운만 출력 (코드블록 감싸지 말 것)

## 금지 사항
- 자기소개 금지
- 본문 볼드 마커(\`**\`) 사용 금지 (CTA 링크 제외)
- **이미지 URL을 한 글자도 변경 금지** (특히 images.pexels.com, supabase.co 도메인의 점/슬래시)
- **같은 이미지 중복 삽입 금지** (각 이미지는 위에 지정된 위치에만)
- 이미지 alt 텍스트에 "슬라이드1" 같은 내부명 사용 금지. 섹션 주제에 맞는 한국어 설명 사용
- 가격/숫자 임의 창작 금지 (확실치 않으면 언급하지 말 것)
- 브랜드명: 여소남 (여행 플랫폼)`;

  try {
    let aiText = (await generateBlogText(bodyPrompt, { temperature: BLOG_AI_TEMPERATURE }))
      .replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    aiText = aiText
      .replace(/https:\/\/images\/pexels\.com/g, 'https://images.pexels.com')
      .replace(/https:\/\/images-pexels\.com/g, 'https://images.pexels.com');
    aiText = aiText.replace(/\*\*([^*\n\[]+?)\*\*/g, (_m, inner) => inner);

    // 동일 이미지 URL 2번째 이후 등장 자동 제거 (AI가 같은 슬라이드를 중복 삽입한 경우 방어)
    {
      const seen = new Set<string>();
      aiText = aiText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        if (seen.has(url)) return ''; // 중복이면 제거
        seen.add(url);
        return match;
      });
      // 연속된 빈 줄 정리
      aiText = aiText.replace(/\n{3,}/g, '\n\n');
    }

    // "슬라이드1", "슬라이드 1" 같은 내부명 alt 텍스트를 주제로 대체
    aiText = aiText.replace(/!\[\s*슬라이드\s*\d+\s*\]/g, `![${topic}]`);

    if (aiText.length > 500) return aiText;
  } catch (err) {
    console.warn('[from-card-news] 정보성 블로그 생성 실패:', err instanceof Error ? err.message : err);
  }

  // Fallback: 최소한의 블로그 (카드뉴스 이미지 순서대로 + Pexels 보조)
  const sections: string[] = [];
  sections.push(`# ${topic}`);
  sections.push(`\n안녕하세요, 여소남입니다. ${topic}에 대해 알려드립니다.\n`);
  if (h1Image) sections.push(`![${topic}](${h1Image})`);
  for (let i = 0; i < outlineWithAssignedImages.length; i++) {
    const o = outlineWithAssignedImages[i];
    sections.push(`\n## ${o.h2}`);
    if (o.assigned_image) sections.push(`![${o.h2}](${o.assigned_image})`);
    sections.push('본문을 작성하세요.');
  }
  sections.push(`\n## 여소남에서 안심 여행 준비`);
  if (lastImage && lastImage !== h1Image) sections.push(`![${topic} 여소남](${lastImage})`);
  sections.push(`여소남에서 여행 준비를 시작하세요.\n[👉 여소남에서 여행 준비하기](${baseUrl})`);
  return sections.join('\n');
}

// slug 중복 방지
async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const sanitized = baseSlug.toLowerCase()
    .replace(/[^a-z0-9가-힣-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 180) || 'article';

  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select('slug')
    .like('slug', `${sanitized}%`)
    .not('slug', 'is', null)
    .limit(1000);

  const existing = new Set((data || []).map((r: { slug: string }) => r.slug));
  if (!existing.has(sanitized)) return sanitized;

  let i = 2;
  while (existing.has(`${sanitized}-${i}`) && i < 1000) i++;
  return `${sanitized}-${i}`;
}
