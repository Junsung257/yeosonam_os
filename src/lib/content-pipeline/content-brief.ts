import { GoogleGenerativeAI } from '@google/generative-ai';
import { ContentBrief, parseAndValidateBrief } from '@/lib/validators/content-brief';
import { TEMPLATE_IDS, TEMPLATE_META } from '@/lib/card-news/tokens';
import { ANGLE_PRESETS } from '@/lib/content-generator';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';

/**
 * Call 1: Content Brief 설계자 (V2)
 *
 * 역할: 블로그+카드뉴스 공통 목차 설계 + V2 슬롯 풀 충전
 * 출력: ContentBrief (Zod 검증 통과) — V2 슬롯 포함
 *
 * V2 슬롯 (필수화):
 *   eyebrow      : 카테고리 태그 ("특가", "핵심 혜택", "TIP", "주의")
 *   tip          : tip role 섹션에만 (꿀팁 1줄)
 *   warning      : warning role 섹션에만 (주의사항 1줄)
 *   price_chip   : hook/cta/benefit 슬라이드 (product 모드만) — "41만9천원~"
 *   trust_row    : benefit/inclusion 섹션 — ["노팁","노옵션","5성급"] 3~4개
 *   accent_color : null (템플릿 기본 악센트 사용)
 *   photo_hint   : 구체적 사진 장소/분위기 힌트 (Pexels 힌트 외)
 *
 * template_family_suggestion: 상품 성격에 따라 선택
 *   - editorial: 정보성/가이드 (하얀 카드)
 *   - cinematic: 감성/풍경 (풀이미지+scrim)
 *   - premium:   럭셔리/신혼 (블랙+골드)
 *   - bold:      특가/가성비 (네이비→골드)
 */

export interface BriefInput {
  mode: 'product' | 'info';
  slideCount?: number;
  tone?: string;
  extraPrompt?: string;
  // Product mode
  product?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    airline?: string;
    departure_airport?: string;
    inclusions?: string[];
    product_highlights?: string[];
    itinerary?: string[];
    product_summary?: string;
    special_notes?: string;
  };
  angle?: string;
  // Info mode
  topic?: string;
  category?: string;
}

const TEMPLATE_LIST = TEMPLATE_IDS.map(id => `  - ${id}: ${TEMPLATE_META[id].label} (${TEMPLATE_META[id].bestFor})`).join('\n');

/**
 * Gemini 1회 호출로 Brief 생성 (검증 실패 시 1회 재시도)
 */
export async function generateContentBrief(input: BriefInput): Promise<ContentBrief> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return fallbackBrief(input);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
  });

  const prompt = buildBriefPrompt(input);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const { data, errors } = parseAndValidateBrief(text);
    if (data) return enrichBriefWithV2Slots(data, input);
    console.warn('[content-brief] 1차 검증 실패:', errors.slice(0, 3));

    const retryPrompt = prompt + `\n\n## 재시도 주의사항\n이전 응답이 스키마 검증에 실패했다. 반드시 JSON만 출력하고, 모든 필수 필드(특히 target_audience, sections, cta_slide, seo, template_family_suggestion)를 누락 없이 채워라. V2 슬롯(eyebrow/price_chip/trust_row)도 의미있게 채워라. 글자 수 제한을 엄수하라.`;
    const retry = await model.generateContent(retryPrompt);
    const retryText = retry.response.text();
    const retryResult = parseAndValidateBrief(retryText);
    if (retryResult.data) return enrichBriefWithV2Slots(retryResult.data, input);
    console.warn('[content-brief] 2차 검증도 실패, fallback 사용:', retryResult.errors.slice(0, 3));
  } catch (err) {
    console.warn('[content-brief] Gemini 호출 실패:', err instanceof Error ? err.message : err);
  }

  return fallbackBrief(input);
}

// ──────────────────────────────────────────────────────
// V2 슬롯 보강 — LLM이 일부 누락해도 product 데이터로 사후 채움
// ──────────────────────────────────────────────────────
function enrichBriefWithV2Slots(brief: ContentBrief, input: BriefInput): ContentBrief {
  if (input.mode !== 'product' || !input.product) return brief;
  const p = input.product;

  const priceChip = p.price ? formatPriceChip(p.price) : null;
  const trustSignals = extractTrustSignals(p);
  const family = brief.template_family_suggestion ?? deriveFamily(p, input.angle);

  const enrichedSections = brief.sections.map((s) => {
    const cs = { ...s.card_slide };
    // eyebrow 자동 채움 (빈 경우만)
    if (!cs.eyebrow) {
      if (s.role === 'hook') cs.eyebrow = p.destination || '여행';
      else if (s.role === 'benefit') cs.eyebrow = '핵심 혜택';
      else if (s.role === 'tourist_spot') cs.eyebrow = '주요 관광지';
      else if (s.role === 'inclusion') cs.eyebrow = '포함 사항';
      else if (s.role === 'tip') cs.eyebrow = 'PRO TIP';
      else if (s.role === 'warning') cs.eyebrow = '주의';
    }
    // price_chip — hook 섹션에 가격 표시
    if (!cs.price_chip && s.role === 'hook' && priceChip) {
      cs.price_chip = priceChip;
    }
    // trust_row — benefit/inclusion 섹션에
    if ((!cs.trust_row || cs.trust_row.length === 0) &&
        (s.role === 'benefit' || s.role === 'inclusion') &&
        trustSignals.length > 0) {
      cs.trust_row = trustSignals.slice(0, 4);
    }
    return { ...s, card_slide: cs };
  });

  const enrichedCta = { ...brief.cta_slide };
  if (!enrichedCta.price_chip && priceChip) enrichedCta.price_chip = priceChip;
  if (!enrichedCta.eyebrow) enrichedCta.eyebrow = '지금 예약하기';
  if (!enrichedCta.trust_row && trustSignals.length > 0) {
    enrichedCta.trust_row = trustSignals.slice(0, 3);
  }

  return {
    ...brief,
    sections: enrichedSections,
    cta_slide: enrichedCta,
    template_family_suggestion: family,
  };
}

// ──────────────────────────────────────────────────────
// 신뢰 시그널 추출 (노팁, 노옵션, 5성급, 전식사 포함, ...)
// ──────────────────────────────────────────────────────
function extractTrustSignals(p: BriefInput['product']): string[] {
  if (!p) return [];
  const signals: string[] = [];
  const haystack = [
    p.title,
    p.product_summary,
    p.special_notes,
    ...(p.inclusions ?? []),
    ...(p.product_highlights ?? []),
  ].filter(Boolean).join(' ');

  const rules: Array<[RegExp, string]> = [
    [/노\s*팁|no\s*tip/i, '노팁'],
    [/노\s*옵션|no\s*option/i, '노옵션'],
    [/노\s*쇼핑|no\s*shop/i, '노쇼핑'],
    [/5\s*성급|파이브\s*스타|5\*/i, '5성급'],
    [/전\s*식사|전식|호텔\s*조식/i, '전식사'],
    [/과일\s*도시락/i, '과일도시락'],
    [/왕복\s*항공/i, '왕복항공'],
    [/마사지|맛사지|massage/i, '마사지'],
    [/전용\s*차량|단독\s*차량/i, '전용차량'],
    [/가이드\s*팁\s*포함|가이드팁\s*포함/i, '가이드팁포함'],
    [/수화물|위탁수하물/i, '수하물 포함'],
    [/허니문|신혼/i, '허니문 특화'],
    [/효도|부모님/i, '효도여행'],
    [/무비자/i, '무비자'],
  ];
  for (const [re, label] of rules) {
    if (re.test(haystack) && !signals.includes(label)) signals.push(label);
    if (signals.length >= 4) break;
  }
  return signals;
}

// ──────────────────────────────────────────────────────
// 가격 → "41만9천원~" 스타일
// ──────────────────────────────────────────────────────
function formatPriceChip(price: number): string {
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    const remainder = price % 10000;
    if (remainder === 0) return `${man}만원~`;
    const cheon = Math.round(remainder / 1000);
    if (cheon === 0) return `${man}만원~`;
    return `${man}만${cheon}천원~`;
  }
  return `${price.toLocaleString()}원~`;
}

// ──────────────────────────────────────────────────────
// 상품 성격 → family 자동 선택
// ──────────────────────────────────────────────────────
function deriveFamily(
  p: BriefInput['product'],
  angle?: string,
): 'editorial' | 'cinematic' | 'premium' | 'bold' {
  if (!p) return 'editorial';
  const text = [
    p.title,
    p.product_summary,
    ...(p.product_highlights ?? []),
  ].filter(Boolean).join(' ');

  // 1순위: 명시적 angle
  if (angle === 'value' || angle === 'deal') return 'bold';
  if (angle === 'emotional' || angle === 'honeymoon') return 'cinematic';
  if (angle === 'premium' || angle === 'luxury') return 'premium';
  if (angle === 'info' || angle === 'guide') return 'editorial';

  // 2순위: 키워드 추론
  if (/5\s*성급|프리미엄|럭셔리|허니문|신혼|품격/i.test(text)) return 'premium';
  if (/특가|가성비|반값|최저가|마감|임박/i.test(text)) return 'bold';
  if (/자연|풍경|야경|감성|모험|트래킹|오로라|해변/i.test(text)) return 'cinematic';
  return 'editorial';
}

function buildBriefPrompt(input: BriefInput): string {
  const slideCount = input.slideCount ?? 6;
  const tone = input.tone ?? 'professional';

  let contextBlock = '';
  let angleBlock = '';
  let priceHint = '';
  let trustHint = '';

  if (input.mode === 'product' && input.product) {
    const p = input.product;
    const nights = p.nights ?? (p.duration ? p.duration - 1 : 0);
    const dur = p.duration ? `${nights}박${p.duration}일` : '';
    const priceStr = p.price ? `${p.price.toLocaleString()}원~` : '';
    priceHint = p.price ? formatPriceChip(p.price) : '';
    const autoSignals = extractTrustSignals(p);
    trustHint = autoSignals.length > 0 ? autoSignals.slice(0, 4).join(', ') : '';

    contextBlock = `## 상품 정보
- 상품명: ${p.title}
- 목적지: ${p.destination ?? '여행지'}
- 기간: ${dur} (박수/일수는 이대로 유지)
- 가격: ${priceStr}
- 항공: ${p.airline ?? ''}
- 출발: ${p.departure_airport ?? ''}
- 포함사항: ${(p.inclusions ?? []).slice(0, 6).join(', ')}
- 하이라이트: ${(p.product_highlights ?? []).slice(0, 5).join(', ')}
- 주요 일정: ${(p.itinerary ?? []).slice(0, 4).join(' / ')}
- 요약: ${p.product_summary ?? ''}
- 특이사항: ${p.special_notes ?? ''}`;

    if (input.angle && ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS]) {
      const a = ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS];
      angleBlock = `## 앵글 (핵심 소구 방향)\n- ${a.label}: ${a.description}`;
    }
  } else {
    contextBlock = `## 정보성 콘텐츠 주제
- 주제: ${input.topic ?? '여행 정보'}
- 카테고리: ${input.category ?? '일반'}`;
  }

  return `너는 10년차 여행 콘텐츠 마케팅 기획자다. 블로그와 카드뉴스를 **동시에 일관되게** 생산하기 위한 Brief(설계도)를 JSON으로 짜내라.

${contextBlock}

${angleBlock}

## 슬라이드 수 / 톤
- 슬라이드 수: ${slideCount}장 (= sections + cta_slide 1개 = ${slideCount - 1}개의 섹션 + 마지막 cta_slide)
- 톤: ${tone}
${input.extraPrompt ? `- 추가 지시: ${input.extraPrompt}` : ''}

## 템플릿 Family (4개 중 1개 선택)
- editorial: 정보성/가이드 (하얀 카드 매거진 스타일)
- cinematic: 감성/풍경 여행 (풀이미지 + 진한 scrim)
- premium:   럭셔리/신혼 (블랙 + 골드 보더 + 세리프 톤)
- bold:      특가/가성비 (네이비→블루→골드 그라디언트, 장식 원)

## V2 슬롯 생성 규칙 (중요!)
각 sections[].card_slide 와 cta_slide 는 **단순 headline+body가 아니라 아래 슬롯들을 의미있게 채워야 한다**:

- eyebrow: 카테고리 태그 1줄 (예: "핵심 혜택", "주요 관광지", "포함 사항", "PRO TIP", "주의"). 최대 20자.
- tip: role이 'tip'인 섹션에만 꿀팁 1줄 (예: "항공권은 출발 3개월 전 예약이 가장 저렴"). 최대 80자.
- warning: role이 'warning'인 섹션에만 주의 1줄 (예: "여권 유효기간 6개월 미만이면 출국 거부"). 최대 80자.
- price_chip: product 모드의 hook 섹션과 cta_slide에 **반드시** 채움. 형식 "${priceHint || '41만9천원~'}" 같은 칩 텍스트. 최대 20자.
- trust_row: product 모드의 benefit/inclusion 섹션에 **배열 3~4개** 채움. 각 항목 최대 12자 (예: ["노팁","노옵션","5성급","전식사"]). 힌트: ${trustHint || '상품 정보에서 추출'}.
- accent_color: 기본 null (템플릿 기본 악센트 사용). 특별히 다른 색이 필요한 경우만 "#RRGGBB" 6자리.
- photo_hint: Pexels 키워드 외에 추가로 "어떤 분위기 사진"을 원하는지 한국어 1줄 (예: "해질 무렵 팜트리 실루엣"). 최대 100자.

## 출력 JSON 스키마 (반드시 이 형식 준수)
{
  "mode": "${input.mode}",
  "h1": "블로그 H1 (최대 70자)",
  "intro_hook": "인트로 후킹 (100~150자)",
  "target_audience": "타겟 (예: '2030 가성비 여행객', '60대 효도관광 자녀')",
  "key_selling_points": ["핵심 소구점1","핵심 소구점2","핵심 소구점3"],
  "template_family_suggestion": "editorial|cinematic|premium|bold",
  "sections": [
    {
      "position": 1,
      "h2": "블로그 H2 (2~50자)",
      "role": "hook|benefit|detail|tip|warning|tourist_spot|inclusion",
      "blog_paragraph_seed": "블로그 본문 씨앗 2~3줄 (10~500자)",
      "card_slide": {
        "headline": "카드뉴스 제목 (최대 15자)",
        "body": "카드뉴스 본문 (최대 40자)",
        "template_suggestion": "${TEMPLATE_IDS[0]}",
        "pexels_keyword": "영문 명사 1~2개 (예: 'bohol beach')",
        "badge": "선택 배지 (예: '특가', 'NEW', null)",
        "eyebrow": "카테고리 태그 (최대 20자)",
        "tip": "role=tip인 경우만 (최대 80자, 아니면 null)",
        "warning": "role=warning인 경우만 (최대 80자, 아니면 null)",
        "price_chip": "hook 섹션이면 '${priceHint || '41만9천원~'}' 형식 (최대 20자, 아니면 null)",
        "trust_row": "benefit/inclusion이면 ['노팁','노옵션','5성급'] 3~4개 (아니면 null)",
        "accent_color": null,
        "photo_hint": "사진 분위기 힌트 (최대 100자)"
      }
    }
  ],
  "cta_slide": {
    "headline": "최대 15자",
    "body": "최대 40자",
    "template_suggestion": "${TEMPLATE_IDS[0]}",
    "pexels_keyword": "영문 명사 1~2개",
    "badge": "'지금 예약' 같은 CTA 라벨",
    "eyebrow": "LIMITED OFFER 같은 카테고리",
    "price_chip": "${priceHint || '41만9천원~'}",
    "trust_row": "['노팁','노옵션','5성급'] 3~4개",
    "tip": null, "warning": null, "accent_color": null, "photo_hint": "사진 힌트"
  },
  "seo": {
    "title": "SEO 타이틀 (10~70자)",
    "description": "SEO 설명 (30~200자)",
    "slug_suggestion": "영문 slug"
  }
}

## 템플릿 ID (template_suggestion 후보)
${TEMPLATE_LIST}

## 엄격 규칙
1. sections 배열 길이는 정확히 ${slideCount - 1}개
2. position은 1부터 순서대로
3. headline 15자 이하, body 40자 이하 엄수
4. pexels_keyword는 영문 명사 1~2개만 (문장 금지)
5. **price_chip은 상품 모드 hook 섹션과 cta_slide에 반드시 채움** (형식: "${priceHint || '41만9천원~'}")
6. **trust_row는 benefit/inclusion 섹션에 3~4개 배열** (각 항목 12자 이하)
7. product 모드에서는 박수/일수/가격 팩트 변경 금지
8. target_audience는 구체적으로
9. template_family_suggestion은 상품 성격에 맞게 4개 중 1개
10. JSON만 출력, 마크다운 코드블록 없이

반드시 위 JSON 스키마 그대로 출력하라.`;
}

/**
 * AI 실패 시 결정론적 Fallback Brief (V2 슬롯 풀 채움)
 */
function fallbackBrief(input: BriefInput): ContentBrief {
  const slideCount = input.slideCount ?? 6;
  const contentCount = slideCount - 1;
  const year = new Date().getFullYear();

  if (input.mode === 'product' && input.product) {
    const p = input.product;
    const nights = p.nights ?? (p.duration ? p.duration - 1 : 0);
    const dur = p.duration ? `${nights}박${p.duration}일` : '';
    const price = p.price ? `${Math.round(p.price / 10000)}만원~` : '';
    const priceChip = p.price ? formatPriceChip(p.price) : null;
    const trustSignals = extractTrustSignals(p);
    const family = deriveFamily(p, input.angle);
    const angleLabel = input.angle && ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS]
      ? ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS].label
      : '추천';
    const dest = p.destination || '여행지';
    const firstHighlight = (p.product_highlights ?? ['올인클루시브'])[0] ?? '완벽 포함';
    const firstSpot = (p.itinerary ?? ['알찬 일정'])[0] ?? '핵심 코스';

    type SectionTpl = {
      h2: string;
      role: 'hook' | 'benefit' | 'tourist_spot' | 'inclusion' | 'detail';
      seed: string;
      headline: string;
      body: string;
      eyebrow: string;
      trust?: boolean;
      price?: boolean;
    };
    const sectionTemplates: SectionTpl[] = ([
      {
        h2: `${dest} ${dur} ${angleLabel}`,
        role: 'hook',
        seed: `${dest} ${dur} ${angleLabel} 패키지. 여소남이 엄선한 ${price} 특별가.`,
        headline: `${dest} ${dur}`.slice(0, 15),
        body: `${price} ${angleLabel} 특별가`.slice(0, 40),
        eyebrow: dest,
        price: true,
      },
      {
        h2: `핵심 혜택 · ${angleLabel}`,
        role: 'benefit',
        seed: '주요 포함사항과 차별화 포인트.',
        headline: '핵심 혜택',
        body: firstHighlight.slice(0, 40),
        eyebrow: '핵심 혜택',
        trust: true,
      },
      {
        h2: `일정 하이라이트`,
        role: 'tourist_spot',
        seed: '주요 관광지와 일정 소개.',
        headline: '핵심 일정',
        body: firstSpot.slice(0, 40),
        eyebrow: '주요 관광지',
      },
      {
        h2: `포함 사항 체크리스트`,
        role: 'inclusion',
        seed: '모든 포함 혜택 체크리스트.',
        headline: '포함 사항',
        body: '항공+호텔+식사+관광',
        eyebrow: '포함 사항',
        trust: true,
      },
      {
        h2: `왜 여소남인가`,
        role: 'detail',
        seed: '여소남 플랫폼 신뢰성과 장점.',
        headline: '여소남 선택 이유',
        body: '안심 비교 예약',
        eyebrow: '여소남 신뢰',
      },
    ] as SectionTpl[]).slice(0, contentCount);

    return {
      mode: 'product',
      h1: `${dest} ${dur} ${angleLabel} 패키지 ${price} | 여소남 ${year}`.slice(0, 70),
      intro_hook: `${dest} ${dur} ${angleLabel} 여행을 찾고 계신가요? 여소남이 제안하는 ${price} 알찬 패키지를 만나보세요.`,
      target_audience: `${angleLabel}를 중시하는 여행객`,
      key_selling_points: (p.product_highlights ?? [`${dest} 필수 코스`, `${dur} 알찬 일정`, '노팁 노옵션']).slice(0, 3),
      template_family_suggestion: family,
      sections: sectionTemplates.map((s, i) => ({
        position: i + 1,
        h2: s.h2,
        role: s.role,
        blog_paragraph_seed: s.seed,
        card_slide: {
          headline: s.headline.slice(0, 15),
          body: s.body.slice(0, 40),
          template_suggestion: TEMPLATE_IDS[0],
          pexels_keyword: dest.replace(/\//g, ' '),
          badge: null,
          eyebrow: s.eyebrow,
          tip: null,
          warning: null,
          price_chip: s.price && priceChip ? priceChip : null,
          trust_row: s.trust && trustSignals.length > 0 ? trustSignals.slice(0, 4) : null,
          accent_color: null,
          photo_hint: `${dest} 풍경`,
        },
      })),
      cta_slide: {
        headline: '지금 예약하기',
        body: `${price} 특별가 예약`.slice(0, 40),
        template_suggestion: TEMPLATE_IDS[0],
        pexels_keyword: 'travel booking',
        badge: '지금 예약',
        eyebrow: 'LIMITED OFFER',
        tip: null,
        warning: null,
        price_chip: priceChip,
        trust_row: trustSignals.slice(0, 3).length > 0 ? trustSignals.slice(0, 3) : null,
        accent_color: null,
        photo_hint: `${dest} 일몰 커플`,
      },
      seo: {
        title: `${dest} ${dur} ${angleLabel} 패키지 ${price} | 여소남 ${year}`.slice(0, 70),
        description: `${dest} ${dur} ${angleLabel} 패키지. ${price} 특별가. 여소남에서 안심 비교·예약하세요.`.slice(0, 160),
        slug_suggestion: `${dest.replace(/[\/\s]/g, '-').toLowerCase()}-${dur}-${input.angle || 'travel'}`.replace(/[^a-z0-9가-힣-]/g, '-').slice(0, 80),
      },
    };
  }

  // Info mode fallback
  const topic = input.topic || '여행 정보';
  type InfoTpl = {
    h2: string;
    role: 'hook' | 'benefit' | 'detail' | 'tip' | 'warning';
    seed: string;
    headline: string;
    body: string;
    eyebrow: string;
    tip?: string;
    warning?: string;
  };
  const infoSections: InfoTpl[] = ([
    { h2: `${topic} 핵심 요약`, role: 'hook', seed: `${topic} 핵심 정리.`, headline: topic.slice(0, 15), body: '완벽 가이드', eyebrow: 'OVERVIEW' },
    { h2: '주요 포인트', role: 'benefit', seed: '반드시 알아야 할 주요 사항.', headline: '핵심 포인트', body: '꼭 알아야 할 내용', eyebrow: 'KEY POINTS' },
    { h2: '준비 체크리스트', role: 'detail', seed: '여행 전 준비할 사항.', headline: '준비물', body: '체크리스트', eyebrow: '준비사항' },
    { h2: 'PRO TIP', role: 'tip', seed: '알면 도움 되는 팁.', headline: '꿀팁', body: '실속 꿀팁', eyebrow: 'PRO TIP',
      tip: '여행 3개월 전 예약 시 평균 25% 절약' },
    { h2: '주의사항', role: 'warning', seed: '실수 방지 주의사항.', headline: '주의사항', body: '이것 놓치면 낭패', eyebrow: 'WATCH OUT',
      warning: '여권 유효기간 6개월 미만이면 출국 거부될 수 있음' },
  ] as InfoTpl[]).slice(0, contentCount);

  return {
    mode: 'info',
    h1: `${topic} 완벽 가이드 ${year}`.slice(0, 70),
    intro_hook: `${topic}에 대해 알아야 할 모든 것을 여소남이 정리했습니다.`,
    target_audience: '여행 준비 중인 일반 여행객',
    key_selling_points: ['실용 정보', `최신 ${year} 기준`, '여소남 검증'],
    template_family_suggestion: 'editorial',
    sections: infoSections.map((s, i) => ({
      position: i + 1,
      h2: s.h2,
      role: s.role,
      blog_paragraph_seed: s.seed,
      card_slide: {
        headline: s.headline.slice(0, 15),
        body: s.body.slice(0, 40),
        template_suggestion: TEMPLATE_IDS[1],
        pexels_keyword: 'travel',
        badge: null,
        eyebrow: s.eyebrow,
        tip: s.tip ?? null,
        warning: s.warning ?? null,
        price_chip: null,
        trust_row: null,
        accent_color: null,
        photo_hint: `${topic} 분위기 사진`,
      },
    })),
    cta_slide: {
      headline: '여소남과 함께',
      body: '안심 여행 준비 시작',
      template_suggestion: TEMPLATE_IDS[1],
      pexels_keyword: 'travel booking',
      badge: '시작하기',
      eyebrow: 'START NOW',
      tip: null,
      warning: null,
      price_chip: null,
      trust_row: null,
      accent_color: null,
      photo_hint: '여행 시작 분위기',
    },
    seo: {
      title: `${topic} 완벽 가이드 ${year} | 여소남`.slice(0, 70),
      description: `${topic}에 대한 완벽 가이드. 실용 정보와 팁을 여소남에서 확인하세요.`.slice(0, 160),
      slug_suggestion: topic.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-').replace(/-+/g, '-').slice(0, 80),
    },
  };
}
