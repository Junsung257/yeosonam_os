import { GoogleGenerativeAI } from '@google/generative-ai';
import { ContentBrief, parseAndValidateBrief } from '@/lib/validators/content-brief';
import { TEMPLATE_IDS, TEMPLATE_META } from '@/lib/card-news/tokens';
import { ANGLE_PRESETS } from '@/lib/content-generator';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';

/**
 * Call 1: Content Brief 설계자
 *
 * 역할: 블로그+카드뉴스 공통 목차 설계
 * 출력: ContentBrief (Zod 검증 통과)
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
  };
  angle?: string;  // 'value' | 'emotional' | ...
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

  // 1차 시도
  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const { data, errors } = parseAndValidateBrief(text);
    if (data) return data;
    console.warn('[content-brief] 1차 검증 실패:', errors.slice(0, 3));

    // 2차 재시도 (더 엄격한 지시)
    const retryPrompt = prompt + `\n\n## 재시도 주의사항\n이전 응답이 스키마 검증에 실패했다. 반드시 JSON만 출력하고, 모든 필수 필드(특히 target_audience, sections, cta_slide, seo)를 누락 없이 채워라. 글자 수 제한을 엄수하라.`;
    const retry = await model.generateContent(retryPrompt);
    const retryText = retry.response.text();
    const retryResult = parseAndValidateBrief(retryText);
    if (retryResult.data) return retryResult.data;
    console.warn('[content-brief] 2차 검증도 실패, fallback 사용:', retryResult.errors.slice(0, 3));
  } catch (err) {
    console.warn('[content-brief] Gemini 호출 실패:', err instanceof Error ? err.message : err);
  }

  return fallbackBrief(input);
}

function buildBriefPrompt(input: BriefInput): string {
  const slideCount = input.slideCount ?? 6;
  const tone = input.tone ?? 'professional';

  let contextBlock = '';
  let angleBlock = '';

  if (input.mode === 'product' && input.product) {
    const p = input.product;
    const nights = p.nights ?? (p.duration ? p.duration - 1 : 0);
    const dur = p.duration ? `${nights}박${p.duration}일` : '';
    const price = p.price ? `${p.price.toLocaleString()}원~` : '';
    contextBlock = `## 상품 정보
- 상품명: ${p.title}
- 목적지: ${p.destination ?? '여행지'}
- 기간: ${dur} (박수/일수는 이대로 유지)
- 가격: ${price}
- 항공: ${p.airline ?? ''}
- 출발: ${p.departure_airport ?? ''}
- 포함사항: ${(p.inclusions ?? []).slice(0, 6).join(', ')}
- 하이라이트: ${(p.product_highlights ?? []).slice(0, 5).join(', ')}
- 주요 일정: ${(p.itinerary ?? []).slice(0, 4).join(' / ')}
- 요약: ${p.product_summary ?? ''}`;

    if (input.angle && ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS]) {
      const a = ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS];
      angleBlock = `## 앵글 (핵심 소구 방향)\n- ${a.label}: ${a.description}`;
    }
  } else {
    contextBlock = `## 정보성 콘텐츠 주제
- 주제: ${input.topic ?? '여행 정보'}
- 카테고리: ${input.category ?? '일반'}`;
  }

  return `너는 여행 콘텐츠 마케팅 기획자다. 블로그와 카드뉴스를 **동시에 일관되게** 생산하기 위한 Brief(설계도)를 JSON으로 짜내라.

${contextBlock}

${angleBlock}

## 슬라이드 수 / 톤
- 슬라이드 수: ${slideCount}장 (= sections + cta_slide 1개 = ${slideCount - 1}개의 섹션 + 마지막 cta_slide)
- 톤: ${tone}
${input.extraPrompt ? `- 추가 지시: ${input.extraPrompt}` : ''}

## 출력 JSON 스키마 (반드시 이 형식 준수)
{
  "mode": "${input.mode}",
  "h1": "블로그 H1 제목 (최대 70자, 목적지+기간+핵심키워드 포함)",
  "intro_hook": "인트로 첫 문단에 쓸 후킹 문장 (100~150자)",
  "target_audience": "타겟 고객층 (예: '2030 가성비 여행객', '60대 효도관광 자녀', '20대 인스타 감성')",
  "key_selling_points": ["핵심 소구점 1", "핵심 소구점 2", "핵심 소구점 3"],
  "sections": [
    {
      "position": 1,
      "h2": "블로그 H2 제목 (2~50자)",
      "role": "hook" | "benefit" | "detail" | "tourist_spot" | "inclusion" | "cta",
      "blog_paragraph_seed": "이 섹션 본문의 핵심 메시지를 2~3줄로 요약 (나중에 Call 3에서 확장됨)",
      "card_slide": {
        "headline": "카드뉴스 제목 (최대 15자, 필수)",
        "body": "카드뉴스 본문 (최대 40자, 필수)",
        "template_suggestion": "${TEMPLATE_IDS[0]}",
        "pexels_keyword": "영문 명사 1~2개만 (예: halong bay, passport, airplane). 문장형 금지",
        "badge": "선택적 배지 텍스트 (예: '핵심', 'TIP', null)"
      }
    }
  ],
  "cta_slide": {
    "headline": "마지막 예약 유도 슬라이드 (최대 15자)",
    "body": "본문 (최대 40자)",
    "template_suggestion": "${TEMPLATE_IDS[0]}",
    "pexels_keyword": "영문 명사 1~2개"
  },
  "seo": {
    "title": "SEO 타이틀 (30~60자, 키워드+숫자+브랜드)",
    "description": "SEO 설명 (80~160자)",
    "slug_suggestion": "영문 slug 추천 (소문자/하이픈)"
  }
}

## 템플릿 선택 (5개 중 1개)
${TEMPLATE_LIST}

각 sections[].card_slide.template_suggestion 및 cta_slide.template_suggestion는 이 5개 id 중 하나만 사용.

## 엄격 규칙
1. sections 배열 길이는 정확히 ${slideCount - 1}개
2. position은 1부터 순서대로
3. 각 card_slide.headline은 **15자 이하** (매우 중요, 초과 시 디자인 붕괴)
4. 각 card_slide.body는 **40자 이하**
5. pexels_keyword는 **영문 명사 1~2개만** (예: "halong bay", "passport" OK / "beautiful sunset in halong bay" 금지)
6. 상품 모드에서는 박수/일수/가격 팩트 변경 금지
7. target_audience는 구체적으로 (모호한 "일반 여행객" 금지)
8. JSON만 출력, 마크다운 코드블록 없이

반드시 위 JSON 스키마 그대로 출력하라.`;
}

/**
 * AI 실패 시 결정론적 Fallback Brief
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
    const angleLabel = input.angle && ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS]
      ? ANGLE_PRESETS[input.angle as keyof typeof ANGLE_PRESETS].label
      : '추천';
    const dest = p.destination || '여행지';

    const sectionTemplates = [
      { h2: `${dest} ${angleLabel} 여행 개요`, role: 'hook' as const, seed: `${dest} ${dur} ${angleLabel} 패키지의 핵심 정보를 요약합니다.`, headline: `${dest} ${angleLabel}`, body: `${price} 특별가` },
      { h2: `핵심 혜택`, role: 'benefit' as const, seed: '주요 포함사항과 차별화 포인트를 설명합니다.', headline: '핵심 혜택', body: (p.product_highlights ?? ['올인클루시브'])[0]?.slice(0, 40) ?? '완벽 포함' },
      { h2: `일정 하이라이트`, role: 'tourist_spot' as const, seed: '주요 관광지와 일정을 소개합니다.', headline: '핵심 일정', body: (p.itinerary ?? ['알찬 일정'])[0]?.slice(0, 40) ?? '핵심 코스' },
      { h2: `포함 사항`, role: 'inclusion' as const, seed: '모든 포함 혜택을 체크리스트로 제공합니다.', headline: '포함 사항', body: '항공+호텔+식사' },
      { h2: `왜 여소남인가`, role: 'detail' as const, seed: '여소남 플랫폼의 신뢰성과 장점을 설명합니다.', headline: '여소남 선택 이유', body: '안심 비교 예약' },
    ].slice(0, contentCount);

    return {
      mode: 'product',
      h1: `${dest} ${dur} ${angleLabel} 패키지 ${price} | 여소남 ${year}`.slice(0, 70),
      intro_hook: `${dest} ${dur} ${angleLabel} 여행을 찾고 계신가요? 여소남이 제안하는 ${price} 알찬 패키지를 만나보세요.`,
      target_audience: `${angleLabel}를 중시하는 여행객`,
      key_selling_points: (p.product_highlights ?? [`${dest} 필수 코스`, `${dur} 알찬 일정`, '노팁 노옵션']).slice(0, 3),
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
        },
      })),
      cta_slide: {
        headline: '지금 예약하기',
        body: `${price} 특별가 예약`.slice(0, 40),
        template_suggestion: TEMPLATE_IDS[0],
        pexels_keyword: 'travel booking',
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
  const infoSections = [
    { h2: `${topic} 핵심 요약`, role: 'hook' as const, seed: `${topic}의 핵심 내용을 한눈에 정리합니다.`, headline: topic.slice(0, 15), body: '완벽 가이드' },
    { h2: '주요 포인트', role: 'benefit' as const, seed: '반드시 알아야 할 주요 사항을 설명합니다.', headline: '핵심 포인트', body: '꼭 알아야 할 내용' },
    { h2: '준비 체크리스트', role: 'detail' as const, seed: '여행 전 준비할 사항을 체크합니다.', headline: '준비물', body: '체크리스트' },
    { h2: '주의사항', role: 'detail' as const, seed: '실패 없이 여행하기 위한 주의사항을 안내합니다.', headline: '주의사항', body: '실패 방지 팁' },
    { h2: '여소남 추천', role: 'detail' as const, seed: '여소남 플랫폼의 추천 서비스를 소개합니다.', headline: '여소남 추천', body: '안심 여행 시작' },
  ].slice(0, contentCount);

  return {
    mode: 'info',
    h1: `${topic} 완벽 가이드 ${year}`.slice(0, 70),
    intro_hook: `${topic}에 대해 알아야 할 모든 것을 여소남이 정리했습니다.`,
    target_audience: '여행 준비 중인 일반 여행객',
    key_selling_points: ['실용 정보', '최신 2026 기준', '여소남 검증'],
    sections: infoSections.map((s, i) => ({
      position: i + 1,
      h2: s.h2,
      role: s.role,
      blog_paragraph_seed: s.seed,
      card_slide: {
        headline: s.headline.slice(0, 15),
        body: s.body.slice(0, 40),
        template_suggestion: TEMPLATE_IDS[1],  // clean_white 기본
        pexels_keyword: 'travel',
        badge: null,
      },
    })),
    cta_slide: {
      headline: '여소남과 함께',
      body: '안심 여행 준비 시작',
      template_suggestion: TEMPLATE_IDS[1],
      pexels_keyword: 'travel booking',
    },
    seo: {
      title: `${topic} 완벽 가이드 ${year} | 여소남`.slice(0, 70),
      description: `${topic}에 대한 완벽 가이드. 실용 정보와 팁을 여소남에서 확인하세요.`.slice(0, 160),
      slug_suggestion: topic.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-').replace(/-+/g, '-').slice(0, 80),
    },
  };
}
