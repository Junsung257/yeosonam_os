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
// V2 슬롯 보강 — LLM이 누락/모호하게 뱉어도 토스 CTR 공식대로 사후 채움/보정
// ──────────────────────────────────────────────────────
function enrichBriefWithV2Slots(brief: ContentBrief, input: BriefInput): ContentBrief {
  if (input.mode !== 'product' || !input.product) return brief;
  const p = input.product;

  const priceChip = p.price ? formatPriceChip(p.price) : null;
  const trustSignals = extractTrustSignals(p);
  const family = brief.template_family_suggestion ?? deriveFamily(p, input.angle);

  // 토스 긴급성 어휘 (hook/cta eyebrow 자동 주입용)
  const urgencyEyebrowForHook = pickUrgencyEyebrow(p, 'hook');
  const urgencyEyebrowForCta = pickUrgencyEyebrow(p, 'cta');

  const enrichedSections = brief.sections.map((s) => {
    const cs = { ...s.card_slide };

    // 1) eyebrow — 긴급성/카테고리 자동 주입
    if (!cs.eyebrow || isGenericEyebrow(cs.eyebrow)) {
      if (s.role === 'hook') cs.eyebrow = urgencyEyebrowForHook;
      else if (s.role === 'benefit') cs.eyebrow = '[0원] 추가 비용';
      else if (s.role === 'tourist_spot') cs.eyebrow = `[${p.destination || '현지'}] 핵심`;
      else if (s.role === 'inclusion') cs.eyebrow = '[0원] 포함';
      else if (s.role === 'tip') cs.eyebrow = 'PRO TIP';
      else if (s.role === 'warning') cs.eyebrow = 'WATCH OUT';
      else if (s.role === 'detail') cs.eyebrow = '핵심 디테일';
    }

    // 2) eyebrow 대괄호 보정 — hook/cta 에는 [ ] 강제
    if ((s.role === 'hook') && cs.eyebrow && !/\[.*\]/.test(cs.eyebrow)) {
      cs.eyebrow = `[${cs.eyebrow}]`;
    }

    // 3) price_chip — hook/benefit 에 자동
    if (!cs.price_chip && (s.role === 'hook' || s.role === 'benefit') && priceChip) {
      cs.price_chip = priceChip;
    }

    // 4) trust_row — benefit/inclusion 에 자동 (LLM 출력이 빈약하면 product 데이터로 보충)
    if (trustSignals.length > 0 && (s.role === 'benefit' || s.role === 'inclusion')) {
      const existing = Array.isArray(cs.trust_row) ? cs.trust_row : [];
      if (existing.length < 3) {
        // merge 중복 제거
        const merged = Array.from(new Set([...existing, ...trustSignals])).slice(0, 4);
        cs.trust_row = merged;
      }
    }

    // 5) body 의 "/" 구분자 → 쉼표 (토스 가독성 공식)
    if (cs.body && cs.body.includes(' / ') && !cs.body.includes(',')) {
      cs.body = cs.body.replace(/\s*\/\s*/g, ', ');
    }

    return { ...s, card_slide: cs };
  });

  const enrichedCta = { ...brief.cta_slide };
  if (!enrichedCta.eyebrow || isGenericEyebrow(enrichedCta.eyebrow)) {
    enrichedCta.eyebrow = urgencyEyebrowForCta;
  } else if (!/\[.*\]/.test(enrichedCta.eyebrow)) {
    enrichedCta.eyebrow = `[${enrichedCta.eyebrow}]`;
  }
  if (!enrichedCta.price_chip && priceChip) enrichedCta.price_chip = priceChip;
  if (!enrichedCta.badge) enrichedCta.badge = '지금 예약';
  if ((!enrichedCta.trust_row || enrichedCta.trust_row.length === 0) && trustSignals.length > 0) {
    enrichedCta.trust_row = trustSignals.slice(0, 3);
  }

  return {
    ...brief,
    sections: enrichedSections,
    cta_slide: enrichedCta,
    template_family_suggestion: family,
  };
}

// 긴급성 eyebrow 선택 — destination/duration 기반
function pickUrgencyEyebrow(p: BriefInput['product'], role: 'hook' | 'cta'): string {
  if (!p) return role === 'hook' ? '[이번 주 특가]' : '[오늘만]';
  const month = new Date().getMonth() + 1;
  if (role === 'cta') {
    return '[오늘만 이 가격]';
  }
  // hook 은 상품 성격별
  if (p.product_summary && /특가|가성비|최저가|마감/i.test(p.product_summary)) {
    return '[선착순 20석]';
  }
  if (/5\s*성급|프리미엄|럭셔리|허니문/i.test(`${p.title} ${p.product_summary ?? ''}`)) {
    return '[VIP 20석 한정]';
  }
  return `[${month}월 특가]`;
}

// eyebrow 가 너무 일반적이면 재생성 대상
function isGenericEyebrow(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= 2) return true;
  // "여행", "정보", "안내" 등 단일 단어면 generic
  return /^(여행|정보|안내|카테고리|카드뉴스)$/.test(trimmed);
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

  return `너는 **인스타그램 카드뉴스 성과형 카피라이터 10년차**다. 토스애즈 실데이터 기반 CTR 공식을 완벽히 체화하고 있다. 블로그 + 카드뉴스 Brief(설계도) 를 JSON으로 짜내라.

${contextBlock}

${angleBlock}

## 슬라이드 수 / 톤
- 슬라이드 수: ${slideCount}장 (= sections + cta_slide 1개 = ${slideCount - 1}개 섹션 + 마지막 cta_slide)
- 톤: ${tone}
${input.extraPrompt ? `- 추가 지시: ${input.extraPrompt}` : ''}

## 템플릿 Family (상품 성격에 맞게 1개)
- editorial: 정보성/가이드 (하얀 카드)
- cinematic: 감성/풍경 (풀이미지 + scrim)
- premium:   럭셔리/신혼 (블랙 + 골드)
- bold:      특가/가성비 (그라디언트 + 장식)

## ⚡ 토스 CTR 4대 공식 (필수 체화 — CTR 평균 +30%)

### 1️⃣ 긴급성 (CTR +20~30%)
- "[선착순 N명]", "[오늘만]", "[마감 D-N]", "[단 N석]"
- 대괄호 [ ] 로 감싼다. 숫자는 구체적으로.
- ❌ BAD: "마감 임박!"  → 막연함
- ✅ GOOD: "[선착순 20석] 부산 직항"

### 2️⃣ 자기관련성 (CTR +15%)
- "~이라면 주목!", "~이신 분", "~분들께"
- 타겟의 상황/욕망을 2인칭으로 호명
- ❌ BAD: "여행하세요"  → 불특정
- ✅ GOOD: "4박5일 여유 있는 분이라면"

### 3️⃣ 혜택성 (CTR +25%)
- 대괄호 [ ] 로 핵심 혜택 강조: "[0원]", "[5성급 포함]", "[팁·옵션·쇼핑 0]"
- 수치로 구체화 (금액/횟수/일수)
- 쉼표로 가독성 (A, B, C 3개 나열)
- ❌ BAD: "추가 비용 걱정 없이"
- ✅ GOOD: "[0원] 추가 비용, 팁·옵션·쇼핑 전부 포함"

### 4️⃣ 구체성 (감성적 수식어 + 팩트)
관광지는 이름만 나열하지 말고 **감성 수식어 + 팩트** 조합:
- "바나산 국립공원" → "[구름 위 판타지 테마파크] 바나산"
- "미케 비치" → "[세계 6대 해변] 미케 비치"
- "칭다오 맥주박물관" → "[120년 역사의 심장] 칭다오 맥주"
호텔은 구체 등급/체인/수치:
- "5성급" → "전 일정 5성급 + 매일 조식뷔페"

## V2 슬롯 생성 규칙 (슬롯마다 명시적 역할)

| 슬롯 | 내용 | 제한 | 예시 |
|---|---|---|---|
| eyebrow | 카테고리 태그 (대괄호 OK) | 20자 | "[선착순 20석]", "핵심 혜택", "주요 관광지" |
| headline | 슬라이드 메인 | 15자 | "호캉스 4박5일", "구름 위 다낭" |
| body | 본문 (쉼표 OK) | 40자 | "팁·옵션·쇼핑 0원, 5성급 조식까지" |
| tip | role=tip만 꿀팁 | 80자 | "출발 3개월 전 예약 시 평균 25% 절약" |
| warning | role=warning만 | 80자 | "여권 유효기간 6개월 미만 시 출국 거부" |
| price_chip | hook + cta 필수 | 20자 | "${priceHint || '41만9천원~'}" |
| trust_row | benefit/inclusion | 각 12자 × 3~4개 | ["노팁","노옵션","5성급","전식사"] |
| photo_hint | Pexels 힌트 외 추가 | 100자 | "해질 무렵 팜트리 실루엣" |
| badge | 작은 라벨 | 10자 | "핵심", "TIP", "특가" |
| pexels_keyword | 영문 명사 1~2개 | 40자 | "bohol beach" |
| accent_color | 기본 null | #RRGGBB | null |

## 슬라이드 역할별 카피 설계 (토스 공식 적용)

### Role: hook (1장, 후킹)
- eyebrow: 긴급성 [ ] 필수 — "[선착순 N석]" 또는 "[D-N 마감]" 또는 "[N월 특가]"
- headline: 자기관련성 포함 — "~이신 분 주목" 또는 destination+duration 임팩트 조합
- body: 핵심 혜택 1줄 + 쉼표 가독성 — "A, B, C"
- price_chip: **필수** "${priceHint || '41만9천원~'}"
- trust_row: 3~4개 시그널 (있으면)
- ❌ BAD: headline "다낭 4박5일" / eyebrow "다낭"
- ✅ GOOD: eyebrow "[선착순 20석]" / headline "4박5일 호캉스" / body "팁·옵션·쇼핑 0원, 5성급 포함"

### Role: benefit (핵심 혜택)
- eyebrow: "[0원] 추가비용" 또는 "핵심 혜택" + 대괄호
- headline: 가장 강력한 1가지 혜택 (수치화)
- body: 구체 포함 아이템 쉼표 나열
- trust_row: **필수** 3~4개
- ✅ GOOD: headline "[0원] 추가비용" / body "팁·옵션·쇼핑 전부 포함, 5성급 조식 매일"

### Role: tourist_spot (관광지)
- eyebrow: "주요 관광지" 또는 "[도시] 핵심"
- headline: **감성 수식어 + 장소명**
- body: 구체 체험/특징 쉼표 나열
- ❌ BAD: headline "바나산" / body "바나산 국립공원"
- ✅ GOOD: headline "[구름 위 다낭]" / body "바나산 국립공원, 황금다리 SKY 워크"

### Role: inclusion (포함사항)
- eyebrow: "포함 사항" or "[0원] 포함"
- headline: 가장 가치 높은 포함물
- body: 체크리스트 스타일 쉼표 나열
- trust_row: **필수** 3~4개
- ✅ GOOD: body "왕복항공, 5성급 숙박, 전 식사, 전용차량"

### Role: detail (디테일)
- 일정/스케줄/호텔 등 구체 정보
- headline: 시간·횟수·등급 포함
- body: 실제 이름/장소 구체 언급

### Role: tip (꿀팁, 해당 슬라이드만)
- tip 필드에 실용 팁 1줄 (수치 포함)
- headline: 간결한 질문/후킹

### Role: warning (주의, 해당 슬라이드만)
- warning 필드에 구체 주의사항 (수치·기간 포함)

### Role: cta (마지막, 예약 유도)
- eyebrow: 긴급성 [ ] — "[오늘만]" "[마감 D-3]" "[선착순 N석]"
- headline: 행동 동사 + 감정 — "지금 바로 출발" "놓치면 후회"
- body: 요약 한 줄 + 쉼표
- badge: "지금 예약" 또는 "상담 신청"
- price_chip: **필수**
- trust_row: 3개
- ✅ GOOD: eyebrow "[오늘만]" / headline "지금 예약 놓치지 마세요" / body "팁·옵션 0원, 5성급"

## 출력 JSON 스키마 (정확히 이 형식)
{
  "mode": "${input.mode}",
  "h1": "블로그 H1 (최대 70자, SEO + 클릭 유도)",
  "intro_hook": "인트로 후킹 2~3줄 (100~200자)",
  "target_audience": "구체적 타겟 (예: '30대 커플 3박5일 첫 동남아 여행자', '50대 부모님 효도여행 자녀')",
  "key_selling_points": ["수치 포함 셀링포인트1","2","3"],
  "template_family_suggestion": "editorial|cinematic|premium|bold",
  "sections": [
    {
      "position": 1,
      "h2": "블로그 H2",
      "role": "hook|benefit|detail|tip|warning|tourist_spot|inclusion",
      "blog_paragraph_seed": "블로그 본문 씨앗 2~3줄 (구체 팩트 포함)",
      "card_slide": {
        "headline": "최대 15자",
        "body": "최대 40자",
        "template_suggestion": "${TEMPLATE_IDS[0]}",
        "pexels_keyword": "영문 명사 1~2개",
        "badge": "선택 배지",
        "eyebrow": "[긴급성 또는 카테고리] 최대 20자",
        "tip": "role=tip만, 아니면 null",
        "warning": "role=warning만, 아니면 null",
        "price_chip": "hook이면 '${priceHint || '41만9천원~'}'",
        "trust_row": ["노팁","노옵션","5성급","전식사"],
        "accent_color": null,
        "photo_hint": "사진 분위기 1줄"
      }
    }
  ],
  "cta_slide": {
    "headline": "행동 유도 15자",
    "body": "마감·혜택 요약 40자",
    "template_suggestion": "${TEMPLATE_IDS[0]}",
    "pexels_keyword": "영문 명사",
    "badge": "지금 예약",
    "eyebrow": "[오늘만] 또는 [마감 D-N]",
    "price_chip": "${priceHint || '41만9천원~'}",
    "trust_row": ["노팁","노옵션","5성급"],
    "tip": null, "warning": null, "accent_color": null, "photo_hint": "일몰 커플"
  },
  "seo": {
    "title": "SEO 타이틀 (10~70자)",
    "description": "SEO 설명 (30~200자)",
    "slug_suggestion": "영문 slug"
  }
}

## 템플릿 ID
${TEMPLATE_LIST}

## 엄격 규칙 (위반 시 카드뉴스 광고 효율 50% 이하)
1. sections 배열은 정확히 ${slideCount - 1}개
2. position은 1부터 순서대로
3. headline 15자, body 40자 엄수
4. **hook + cta 의 eyebrow 에 [대괄호] 긴급성 필수** (예: [선착순 N], [오늘만], [마감 D-N])
5. **headline 은 상품명 단순 복제 금지** — 감성 수식어, 수치, 자기관련성 중 1개 필수
6. **body 는 "완벽한 휴식" 같은 모호한 표현 금지** — 구체 혜택/장소/수치 포함 필수
7. tourist_spot section headline 은 **"[감성 수식어]" 포함 필수**
8. price_chip 은 hook 과 cta 에 반드시. ("${priceHint || '41만9천원~'}")
9. trust_row 는 benefit/inclusion 섹션과 cta 에 반드시 3~4개
10. 박수/일수/가격 팩트 변경 금지
11. JSON만 출력, 마크다운 코드블록 금지

위 11개 규칙 모두 준수해서 JSON 출력.`;
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
