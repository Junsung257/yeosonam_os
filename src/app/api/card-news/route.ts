import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getCardNewsList, upsertCardNews } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import { updateFactoryJobStep } from '@/lib/content-factory-step';
import { searchPexelsPhotos, buildPexelsKeyword, isPexelsConfigured, getBrandPlaceholder } from '@/lib/pexels';
import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { pickMarketingPrice } from '@/lib/marketing-price';
import { getSecret } from '@/lib/secret-registry';

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ card_news: [] });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') ?? undefined;
  const packageId = searchParams.get('package_id') ?? undefined;
  const limit = parseInt(searchParams.get('limit') ?? '20');

  try {
    const list = await getCardNewsList({ status, packageId, limit });
    return NextResponse.json({ card_news: list });
  } catch (error) {
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { package_id, title: customTitle, slide_count, ratio, tone, extra_prompt,
      mode, topic, category_id, brief } = body as {
      package_id?: string;
      title?: string;
      slide_count?: number;
      ratio?: string;
      tone?: string;
      extra_prompt?: string;
      mode?: 'product' | 'info';
      topic?: string;
      category_id?: string;
      brief?: unknown;  // ContentBrief (Wizard Step 2에서 전달)
    };

    const resolvedMode = mode || (package_id ? 'product' : 'info');

    // ── Brief 기반 생성 (V2 파이프라인) ────────────────────────
    if (brief) {
      const { generateCardCopy } = await import('@/lib/content-pipeline/card-copy');
      const { searchPexelsPhotos, isPexelsConfigured } = await import('@/lib/pexels');
      const { supabaseAdmin } = await import('@/lib/supabase');

      const copySlides = await generateCardCopy(brief as any);
      const briefAny = brief as any;

      // Pexels 이미지 병렬 로드 — 키워드 실패 시 h1/destination 폴백
      const pexelsEnabled = isPexelsConfigured();
      const fallbackKeyword = (briefAny.h1 || briefAny.target_audience || 'travel')
        .toString().split(/\s+/).slice(0, 2).join(' ') || 'travel';
      const images: string[] = await Promise.all(
        copySlides.map(async (s) => {
          if (!pexelsEnabled) return '';
          const candidates = [s.pexels_keyword, fallbackKeyword, 'travel landscape']
            .filter((k): k is string => !!k && k.trim().length > 0);
          for (const kw of candidates) {
            try {
              const photos = await searchPexelsPhotos(kw, 3);
              const url = photos[0]?.src?.large2x || photos[0]?.src?.large;
              if (url) return url;
            } catch { /* 다음 후보 */ }
          }
          return '';
        })
      );

      // V2 slides — copySlides 에 V2 슬롯이 이미 있으므로 직접 활용
      const templateFamily: 'editorial' | 'cinematic' | 'premium' | 'bold' =
        briefAny.template_family_suggestion ?? 'editorial';

      const slides = copySlides.map((s, i) => ({
        id: crypto.randomUUID(),
        position: s.position,
        headline: s.headline,
        body: s.body,
        bg_image_url: images[i] ?? '',
        pexels_keyword: s.pexels_keyword,
        overlay_style: s.role === 'hook' || s.role === 'cta' ? 'gradient-bottom' : 'dark',
        headline_style: { fontFamily: 'Pretendard', fontSize: s.role === 'hook' ? 40 : 32, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
        body_style: { fontFamily: 'Pretendard', fontSize: 18, color: '#e0e0e0', fontWeight: 'normal', textAlign: 'center' },
        // V1 template 매핑
        template_id: s.template_id,
        role: s.role,
        badge: s.badge,
        brief_section_position: s.position,
        // V2 슬롯 — copySlides 에서 직접
        template_family: templateFamily,
        template_version: 'v2',
        eyebrow: s.eyebrow ?? null,
        tip: s.tip ?? null,
        warning: s.warning ?? null,
        price_chip: s.price_chip ?? null,
        trust_row: s.trust_row ?? null,
        accent_color: s.accent_color ?? null,
        photo_hint: s.photo_hint ?? null,
      }));

      const title = customTitle ?? briefAny.h1 ?? (briefAny.mode === 'info' ? `${briefAny.h1} — 카드뉴스` : `카드뉴스`);

      const insertData: Record<string, unknown> = {
        title,
        status: 'DRAFT',
        slides,
        card_news_type: resolvedMode,
        template_family: templateFamily,
        template_version: 'v2',
        generation_config: { brief },
      };
      if (resolvedMode === 'product' && package_id) insertData.package_id = package_id;
      if (resolvedMode === 'info' && topic) insertData.topic = topic;
      if (category_id) insertData.category_id = category_id;

      const cardNews = await upsertCardNews(insertData as any);

      // ── content_factory_jobs 생성 (Content Hub 폴링용) ──────
      if (cardNews?.id) {
        const { supabaseAdmin: supa } = await import('@/lib/supabase');
        supa.from('content_factory_jobs').insert({
          card_news_id: cardNews.id,
          product_id: (resolvedMode === 'product' && package_id) ? package_id : null,
          status: 'pending',
        }).then().catch(() => {});
      }

      // ── 자동 Cover Critic + Apply (환경변수로 끄기 가능) ──
      //    DISABLE_COVER_CRITIC=1 면 스킵. 기본 활성.
      //    80점 이상이면 적용 스킵, 60~79 는 minor_polish 로 rewritten_cover 있으면 적용, 59 이하면 regenerate.
      let coverCritique: unknown = null;
      let coverApply: unknown = null;
      if (cardNews?.id && process.env.DISABLE_COVER_CRITIC !== '1') {
        try {
          const { critiqueCover } = await import('@/lib/content-pipeline/agents/cover-critic');
          const { applyCritiqueToCover } = await import('@/lib/content-pipeline/apply-critique');
          const firstSlide = slides[0];
          const critique = await critiqueCover({
            cover: firstSlide as never,
            product_context: {
              title: (briefAny.h1 as string | undefined) ?? undefined,
              destination: (briefAny.target_audience as string | undefined) ?? undefined,
              key_selling_points: briefAny.key_selling_points as string[] | undefined,
              target_audience: briefAny.target_audience as string | undefined,
            },
          });
          coverCritique = critique;
          const appUrlForCritic = getSecret('NEXT_PUBLIC_APP_URL') ?? `https://${process.env.VERCEL_URL ?? 'localhost:3000'}`;
          const kickRenderAfterCritic = () => {
            fetch(`${appUrlForCritic}/api/card-news/render-v2`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ card_news_id: cardNews.id, formats: ['1x1'] }),
            }).catch(() => {});
          };

          if (critique.verdict !== 'ship_as_is' && critique.rewritten_cover) {
            // minor_polish 또는 regenerate: rewritten_cover 적용 후 재렌더
            coverApply = await applyCritiqueToCover(cardNews.id, critique);
            if ((coverApply as { applied?: boolean })?.applied) {
              kickRenderAfterCritic();
            }
          } else if (critique.verdict === 'regenerate' && !critique.rewritten_cover) {
            // score<60 + rewritten_cover 없음: 카피 전체 재생성 후 재렌더
            try {
              const { generateCardCopy } = await import('@/lib/content-pipeline/card-copy');
              const newCopySlides = await generateCardCopy(briefAny as never);
              const mergedSlides = newCopySlides.map((s, i) => ({
                ...slides[i],
                headline: s.headline,
                body: s.body,
                eyebrow: s.eyebrow ?? slides[i]?.eyebrow ?? null,
                tip: s.tip ?? slides[i]?.tip ?? null,
                warning: s.warning ?? slides[i]?.warning ?? null,
                price_chip: s.price_chip ?? slides[i]?.price_chip ?? null,
                trust_row: s.trust_row ?? slides[i]?.trust_row ?? null,
              }));
              const { supabaseAdmin: supa } = await import('@/lib/supabase');
              await supa.from('card_news').update({ slides: mergedSlides }).eq('id', cardNews.id);
              kickRenderAfterCritic();
            } catch (regenErr) {
              console.warn('[card-news POST] regenerate 재생성 실패(무시):', regenErr instanceof Error ? regenErr.message : regenErr);
            }
          }
          // cover_critic 스텝 완료 마킹
          updateFactoryJobStep(cardNews.id, 'cover_critic', 'done');
        } catch (err) {
          console.warn('[card-news POST] 자동 cover critic 실패(무시):', err instanceof Error ? err.message : err);
          updateFactoryJobStep(cardNews.id, 'cover_critic', 'failed', err instanceof Error ? err.message : '알 수 없는 오류');
        }
      }

      // ── 최종 Satori 자동 렌더 (fire-and-forget) ─────────────
      if (cardNews?.id && process.env.DISABLE_AUTO_RENDER !== '1') {
        const appUrl = getSecret('NEXT_PUBLIC_APP_URL') ?? `https://${process.env.VERCEL_URL ?? 'localhost:3000'}`;
        fetch(`${appUrl}/api/card-news/render-v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_news_id: cardNews.id, formats: ['1x1'] }),
        }).catch(e => console.warn('[card-news POST] 자동 렌더 실패(무시):', e.message));
      }

      return NextResponse.json({
        card_news: cardNews,
        cover_critique: coverCritique,
        cover_apply: coverApply,
      }, { status: 201 });
    }

    // ── 정보성 모드 ──────────────────────────────────────────────
    if (resolvedMode === 'info') {
      if (!topic || !topic.trim()) {
        return NextResponse.json({ error: '정보성 모드에서는 topic이 필수입니다.' }, { status: 400 });
      }
      const slideNum = slide_count ?? 6;
      const slides = await buildInfoSlides(topic, { slideCount: slideNum, tone, extraPrompt: extra_prompt }) as import('@/lib/supabase').CardNewsSlide[];
      const title = customTitle ?? `${topic} — 카드뉴스`;

      const cardNews = await upsertCardNews({
        title,
        status: 'DRAFT',
        slides,
        card_news_type: 'info',
        topic,
        category_id: category_id || null,
      } as any);

      return NextResponse.json({ card_news: cardNews }, { status: 201 });
    }

    // ── 상품 모드 (기존 로직) ────────────────────────────────────
    if (!package_id) {
      return NextResponse.json({ error: 'package_id 필수 (또는 mode=info + topic)' }, { status: 400 });
    }

    const { supabaseAdmin } = await import('@/lib/supabase');
    const { data: pkg } = await supabaseAdmin
      .from('travel_packages')
      .select('title, destination, price, duration, itinerary, inclusions, excludes, product_highlights, product_summary')
      .eq('id', package_id)
      .single();

    if (!pkg) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 });
    }

    const title = customTitle ?? `${pkg.title} — 카드뉴스`;
    const destination = pkg.destination ?? '여행지';
    const slideNum = slide_count ?? 6;

    const { data: pkgFull } = await supabaseAdmin
      .from('travel_packages')
      .select('product_summary, special_notes, product_type, airline, departure_airport')
      .eq('id', package_id)
      .single();

    const slides = await buildAutoSlides(
      { ...pkg, ...(pkgFull ?? {}) },
      destination,
      { slideCount: slideNum, tone, extraPrompt: extra_prompt }
    ) as import('@/lib/supabase').CardNewsSlide[];

    const cardNews = await upsertCardNews({
      package_id,
      title,
      status: 'DRAFT',
      slides,
      card_news_type: 'product',
    } as any);

    return NextResponse.json({ card_news: cardNews }, { status: 201 });
  } catch (error) {
    console.error('카드뉴스 생성 실패:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '생성 실패' },
      { status: 500 }
    );
  }
}

async function buildAutoSlides(
  pkg: any, destination: string,
  options?: { slideCount?: number; tone?: string; extraPrompt?: string },
) {
  const slideCount = options?.slideCount ?? 6;
  const tone = options?.tone ?? 'professional';
  const extraPrompt = options?.extraPrompt ?? '';

  // ── Step 0: 상품 정보에서 핵심 셀링포인트 자동 추출 ────────
  const sellingPoints: string[] = [];
  const summaryText = [pkg.product_summary, pkg.special_notes, pkg.title].filter(Boolean).join(' ');
  const inclusionsList = pkg.inclusions ?? [];
  const highlightsList = pkg.product_highlights ?? [];

  // 키워드 감지
  if (/노팁|노 팁|no tip/i.test(summaryText)) sellingPoints.push('노팁');
  if (/노옵션|노 옵션|no option/i.test(summaryText)) sellingPoints.push('노옵션');
  if (/5성|5\*|파이브스타|five star/i.test(summaryText)) sellingPoints.push('5성급 호텔');
  if (/전 ?식사|전식|all meal/i.test(summaryText) || inclusionsList.some((s: string) => /전 ?식사|호텔조식/.test(s))) sellingPoints.push('전 식사 포함');
  if (/과일도시락|과일 도시락/i.test(summaryText)) sellingPoints.push('과일도시락 제공');
  if (/왕복항공|왕복 항공/i.test(inclusionsList.join(' '))) sellingPoints.push('왕복항공 포함');
  if (/마사지|맛사지|massage/i.test(summaryText)) sellingPoints.push('마사지 체험');
  if (/품격|프리미엄|럭셔리/i.test(summaryText)) sellingPoints.push('품격 여행');

  // ── Step 1: AI 슬라이드 카피 생성 ────────────────
  let aiSlides: { headline: string; body: string; pexels_keyword: string }[] = [];

  if (hasBlogApiKey()) {
    try {

      const inclusions = inclusionsList.slice(0, 6).join(', ');
      const excludes = (pkg.excludes ?? []).slice(0, 3).join(', ');
      const itinerary = (pkg.itinerary ?? []).slice(0, 4).join(' / ');
      const highlights = highlightsList.slice(0, 5).join(', ');
      const priceStr = pickMarketingPrice(pkg).toLocaleString();
      const spStr = sellingPoints.length > 0 ? sellingPoints.join(', ') : '정보 없음';

      const toneMap: Record<string, string> = {
        professional: '신뢰감 있고 전문적인',
        casual: '친근하고 캐주얼한',
        emotional: '감성적이고 감동적인',
        humorous: '유머러스하고 재미있는',
      };
      const toneDesc = toneMap[tone] || toneMap.professional;

      const prompt = `너는 10년차 여행 전문 퍼포먼스 마케터이자 카피라이터다.
아래 여행 상품 정보를 바탕으로 인스타그램 카드뉴스 ${slideCount}장의 카피를 작성해라.

## 상품 정보
- 상품명: ${pkg.title}
- 목적지: ${destination}
- 기간: ${pkg.duration ?? '?'}일
- 가격: ${priceStr}원~
- 핵심 셀링포인트: ${spStr}
- 포함사항: ${inclusions || '정보 없음'}
- 불포함사항: ${excludes || '정보 없음'}
- 주요 일정: ${itinerary || '정보 없음'}
- 상품 하이라이트: ${highlights || '정보 없음'}
- 상품 요약: ${pkg.product_summary || '정보 없음'}

## 톤앤매너
${toneDesc} 톤으로 작성. 브랜드명은 '여소남'. ${extraPrompt ? `추가 지시: ${extraPrompt}` : ''}

## 슬라이드별 역할 (필수 준수)
- 1장(후킹): 스크롤 멈추게 하는 질문형/도발형 카피. 예: "패키지 여행, 아직도 눈치 보시나요?" / "이 가격에 5성급이라고?"
- 2장(혜택): 핵심 셀링포인트를 임팩트 있게 나열. 예: "숨겨진 비용 NO! 오직 즐거움만" + "왕복항공, 숙박, 전 식사, 과일도시락까지 완벽 포함! 노팁/노옵션."
- 3장~${Math.max(3, slideCount - 1)}장(상세): 구체적 일정/호텔/식사/관광지 정보. 실제 장소명, 호텔명 등 구체적 정보 포함
- 마지막장(CTA): 가격 + 긴급감 + 예약 유도. 예: "품격 여행, 지금 바로 경험하세요!" + "${priceStr}원~ ${destination}, 여소남에서 완벽한 휴가를!"

## 규칙
- headline: 최대 20자, 임팩트 있는 한 줄 (마침표 없이)
- body: 최대 40자, 핵심 정보만 (줄바꿈 없이 한 문장)
- pexels_keyword: 영문, 구체적 검색어 3-4단어 (예: "luxury resort pool vietnam", "nha trang aerial beach sunset", "vietnamese food pho restaurant")
- 원가, 랜드사명, 내부 코드 절대 노출 금지
- '여소남' 브랜드로만 표기
- 각 슬라이드의 pexels_keyword는 서로 다르게 (중복 금지)

반드시 아래 JSON 배열만 출력. 마크다운 코드블록 없이:
[{"headline":"...","body":"...","pexels_keyword":"..."}]`;

      const rawText = (await generateBlogJSON(prompt, { temperature: 0.8 }))
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        try {
          const cleaned = rawText.replace(/,\s*([}\]])/g, '$1');
          const arrMatch = cleaned.match(/\[[\s\S]*\]/);
          if (arrMatch) parsed = JSON.parse(arrMatch[0]);
        } catch {
          console.warn('[Card News] JSON 복구 실패, fallback 사용');
        }
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        aiSlides = parsed.slice(0, slideCount);
      }
    } catch (err) {
      console.warn('[Card News] AI 카피 실패, fallback 사용:', err instanceof Error ? err.message : err);
    }
  }

  // ── Step 2: AI 실패 시 fallback (상품정보 기반 템플릿) ────────
  if (aiSlides.length === 0) {
    const priceStr = pickMarketingPrice(pkg).toLocaleString();
    const spText = sellingPoints.length > 0 ? sellingPoints.join(' · ') : '완벽 포함 패키지';

    aiSlides = [
      { headline: `${destination}, 이 가격 실화?`, body: `${pkg.duration ?? '?'}일 ${priceStr}원~ 여소남 단독`, pexels_keyword: `${destination} aerial landscape beautiful` },
      { headline: '숨겨진 비용 NO!', body: spText, pexels_keyword: `luxury resort pool tropical` },
      ...(highlightsList.length > 0 ? [{ headline: highlightsList[0]?.slice(0, 20) ?? '특별한 일정', body: highlightsList.slice(1, 3).join(', ').slice(0, 40) || '잊지 못할 경험', pexels_keyword: `${destination} tourism culture` }] : []),
      { headline: '지금 바로 경험하세요!', body: `${priceStr}원~ 여소남에서 완벽한 휴가를!`, pexels_keyword: `${destination} sunset vacation couple` },
    ].slice(0, slideCount);
  }

  // ── Step 3: Pexels 이미지 병렬 로드 (fallback 포함) ─────────
  const pexelsEnabled = isPexelsConfigured();

  async function getImage(keyword: string): Promise<string> {
    // 1차: Pexels API
    if (pexelsEnabled) {
      try {
        const photos = await searchPexelsPhotos(keyword, 5);
        if (photos[0]?.src?.large2x) return photos[0].src.large2x;
      } catch (e) {
        console.warn('[Card News] Pexels 검색 실패:', keyword, e instanceof Error ? e.message : e);
      }
    }
    // 2차: 키워드 단순화 후 재시도
    if (pexelsEnabled) {
      try {
        const simpleKeyword = keyword.split(' ').slice(0, 2).join(' ');
        const photos = await searchPexelsPhotos(simpleKeyword, 5);
        if (photos[0]?.src?.large2x) return photos[0].src.large2x;
      } catch { /* ignore */ }
    }
    // 3차: destination만으로 검색
    if (pexelsEnabled) {
      try {
        const photos = await searchPexelsPhotos(`${destination} travel`, 5);
        if (photos[0]?.src?.large2x) return photos[0].src.large2x;
      } catch { /* ignore */ }
    }
    return '';
  }

  let images: string[];
  try {
    images = await Promise.race([
      Promise.all(aiSlides.map(s => getImage(s.pexels_keyword || `${destination} travel`))),
      new Promise<string[]>(resolve => setTimeout(() => resolve(aiSlides.map(() => '')), 12000)),
    ]);
  } catch {
    images = aiSlides.map(() => '');
  }

  // ── Step 4: 슬라이드 조립 ───────────────────────────────────
  return aiSlides.map((s, i) => ({
    id: crypto.randomUUID(),
    position: i,
    headline: s.headline,
    body: s.body,
    bg_image_url: images[i] ?? '',
    pexels_keyword: s.pexels_keyword || buildPexelsKeyword(destination, 'cover'),
    overlay_style: i === 0 ? 'gradient-bottom' : i === aiSlides.length - 1 ? 'gradient-bottom' : 'dark',
    headline_style: { fontFamily: 'Pretendard', fontSize: i === 0 ? 40 : 32, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
    body_style: { fontFamily: 'Pretendard', fontSize: 18, color: '#e0e0e0', fontWeight: 'normal', textAlign: 'center' },
  }));
}

// ── 정보성 카드뉴스 슬라이드 생성 ─────────────────────────────
async function buildInfoSlides(
  topic: string,
  options?: { slideCount?: number; tone?: string; extraPrompt?: string },
) {
  const slideCount = options?.slideCount ?? 6;
  const tone = options?.tone ?? 'professional';
  const extraPrompt = options?.extraPrompt ?? '';

  let aiSlides: { headline: string; body: string; pexels_keyword: string }[] = [];

  if (hasBlogApiKey()) {
    try {

      const toneMap: Record<string, string> = {
        professional: '신뢰감 있고 전문적인',
        casual: '친근하고 캐주얼한',
        emotional: '감성적이고 따뜻한',
      };
      const toneDesc = toneMap[tone] || toneMap.professional;

      const prompt = `너는 10년차 여행 정보 콘텐츠 전문 마케터이자 카피라이터다.
아래 주제로 인스타그램 카드뉴스 ${slideCount}장의 카피를 작성해라.

## 주제
${topic}

## 톤앤매너
${toneDesc} 톤. 브랜드: 여소남. ${extraPrompt}

## 슬라이드 역할
- 1장(후킹): 스크롤 멈추는 질문형/숫자형. 예: "${topic} 이거 모르면 손해" / "5분만에 정복"
- 2장~${Math.max(2, slideCount - 1)}장(본론): 구체적 정보 3~5가지. 실용 팁, 체크리스트
- 마지막장(CTA): "여소남에서 여행 준비 시작" 같은 행동 유도

## 규칙
- headline: 최대 20자, 임팩트 있는 한 줄 (마침표 없이)
- body: 최대 40자, 핵심 정보만
- pexels_keyword: 영문, 주제와 관련된 구체적 검색어 3-4단어
- '여소남' 브랜드로만 표기
- 각 슬라이드의 pexels_keyword는 서로 다르게

반드시 아래 JSON 배열만 출력. 마크다운 코드블록 없이:
[{"headline":"...","body":"...","pexels_keyword":"..."}]`;

      const rawText = (await generateBlogJSON(prompt, { temperature: 0.8 }))
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

      let parsed: any = null;
      try { parsed = JSON.parse(rawText); }
      catch {
        try {
          const cleaned = rawText.replace(/,\s*([}\]])/g, '$1');
          const arrMatch = cleaned.match(/\[[\s\S]*\]/);
          if (arrMatch) parsed = JSON.parse(arrMatch[0]);
        } catch { /* noop */ }
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        aiSlides = parsed.slice(0, slideCount);
      }
    } catch (err) {
      console.warn('[Info Card News] AI 카피 실패:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback
  if (aiSlides.length === 0) {
    aiSlides = [
      { headline: topic.slice(0, 20), body: '여소남과 함께 알아보세요', pexels_keyword: 'travel information guide' },
      { headline: '핵심 정보', body: '꼭 알아야 할 내용', pexels_keyword: 'travel checklist' },
      { headline: '준비하기', body: '체크리스트', pexels_keyword: 'travel preparation' },
      { headline: '여소남 확인하기', body: '안심하고 여행 준비하세요', pexels_keyword: 'travel booking' },
    ].slice(0, slideCount);
  }

  // Pexels 이미지 로드 (실패 시 여소남 브랜드 Placeholder로 Fallback)
  const pexelsEnabled = isPexelsConfigured();
  async function getImage(keyword: string, idx: number, total: number): Promise<string> {
    if (pexelsEnabled) {
      try {
        const photos = await searchPexelsPhotos(keyword, 5);
        if (photos[0]?.src?.large2x) return photos[0].src.large2x;
      } catch { /* noop */ }
    }
    const purpose: 'cover' | 'content' | 'cta' =
      idx === 0 ? 'cover' : idx === total - 1 ? 'cta' : 'content';
    return getBrandPlaceholder(purpose, keyword);
  }
  const images = await Promise.all(
    aiSlides.map((s, i) => getImage(s.pexels_keyword, i, aiSlides.length))
  );

  return aiSlides.map((s, i) => ({
    id: crypto.randomUUID(),
    position: i,
    headline: s.headline,
    body: s.body,
    bg_image_url: images[i] ?? '',
    pexels_keyword: s.pexels_keyword,
    overlay_style: i === 0 ? 'gradient-bottom' : i === aiSlides.length - 1 ? 'gradient-bottom' : 'dark',
    headline_style: { fontFamily: 'Pretendard', fontSize: i === 0 ? 40 : 32, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
    body_style: { fontFamily: 'Pretendard', fontSize: 18, color: '#e0e0e0', fontWeight: 'normal', textAlign: 'center' },
  }));
}
