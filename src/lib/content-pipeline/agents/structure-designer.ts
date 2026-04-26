/**
 * Structure Designer Agent
 *
 * 역할: Brief 의 "뼈대" 만 설계 (카피 작성은 하지 않음)
 *   - 슬라이드 수
 *   - 각 section 의 role / hook_type / h2 / blog_paragraph_seed
 *   - template_family_suggestion
 *   - target_audience / key_selling_points / intro_hook / h1
 *   - seo.title/description/slug
 *
 * Card slide 의 headline/body 등 실제 카피는 **card-news-copywriter 가 담당**.
 *
 * 왜 분리?
 *   - 단일 mega-prompt 한계 돌파. 각 에이전트 <500자 프롬프트 → 응답 품질 ↑
 *   - Structure 결정 (AIDA 배치, hook type) 은 논리적 작업. 카피 감성 작업과 분리.
 *   - 향후 critic 에이전트가 stage 별 검증 가능.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { TEMPLATE_IDS, TEMPLATE_META } from '@/lib/card-news/tokens';
import { SlideRoleEnum, TemplateFamilyEnum, HookTypeEnum } from '@/lib/validators/content-brief';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import { callWithZodValidation } from '@/lib/llm-validate-retry';

export interface StructureInput {
  mode: 'product' | 'info';
  slideCount: number;
  tone?: string;
  extraPrompt?: string;
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
  topic?: string;
  category?: string;
}

/** Designer 출력: card_slide 는 빈 상태. copywriter 가 채움. */
export const StructureOutputSchema = z.object({
  mode: z.enum(['product', 'info']),
  h1: z.string().min(5).max(80),
  intro_hook: z.string().min(10).max(250),
  target_audience: z.string().min(5).max(100),
  key_selling_points: z.array(z.string().min(2).max(60)).min(2).max(5),
  template_family_suggestion: TemplateFamilyEnum,
  sections: z.array(z.object({
    position: z.number().int().min(1),
    role: SlideRoleEnum,
    h2: z.string().min(2).max(50),
    blog_paragraph_seed: z.string().min(10).max(500),
    hook_type: HookTypeEnum.nullable().optional(),
    template_suggestion: z.enum(TEMPLATE_IDS),
    pexels_keyword: z.string().min(2).max(40),
  })).min(3).max(10),
  cta_meta: z.object({
    template_suggestion: z.enum(TEMPLATE_IDS),
    pexels_keyword: z.string().min(2).max(40),
  }),
  seo: z.object({
    title: z.string().min(10).max(70),
    description: z.string().min(30).max(200),
    slug_suggestion: z.string().min(3).max(100),
  }),
});

export type StructureOutput = z.infer<typeof StructureOutputSchema>;

/** 결정론적 fallback — AI 실패 시 */
export function fallbackStructure(input: StructureInput): StructureOutput {
  const slideCount = input.slideCount;
  const contentCount = slideCount - 1;
  const year = new Date().getFullYear();

  if (input.mode === 'product' && input.product) {
    const p = input.product;
    const nights = p.nights ?? (p.duration ? p.duration - 1 : 0);
    const dur = p.duration ? `${nights}박${p.duration}일` : '';
    const price = p.price ? `${Math.round(p.price / 10000)}만원~` : '';
    const dest = p.destination || '여행지';
    const family = deriveFallbackFamily(p);
    const hookType = deriveFallbackHookType(p);

    const rolePool: Array<{ role: 'hook' | 'benefit' | 'tourist_spot' | 'inclusion' | 'detail' | 'tip' | 'warning'; h2: string; seed: string }> = [
      { role: 'hook',         h2: `${dest} ${dur} ${price}`,                seed: `${dest} ${dur} ${price} 상품 한눈에 정리` },
      { role: 'benefit',      h2: `핵심 혜택 (노팁·노옵션 등)`,             seed: '주요 포함사항, 차별화 포인트' },
      { role: 'tourist_spot', h2: `${dest} 주요 관광지`,                    seed: `${dest} 핵심 관광지와 체험` },
      { role: 'inclusion',    h2: `포함 사항 체크리스트`,                   seed: '모든 포함 항목 체크리스트' },
      { role: 'detail',       h2: `호텔/항공 스펙`,                          seed: '호텔 등급과 항공 스펙 디테일' },
    ];
    const sections = rolePool.slice(0, contentCount).map((r, i) => ({
      position: i + 1,
      role: r.role,
      h2: r.h2.slice(0, 50),
      blog_paragraph_seed: r.seed,
      hook_type: r.role === 'hook' ? hookType : null,
      template_suggestion: TEMPLATE_IDS[0],
      pexels_keyword: dest.replace(/\//g, ' ').slice(0, 40),
    }));

    return {
      mode: 'product',
      h1: `${price} ${dur} ${dest} 패키지 | 여소남 ${year}`.slice(0, 70),
      intro_hook: `${dest} ${dur} ${price} 여행 찾으신다면, 여소남이 엄선한 패키지를 만나보세요.`,
      target_audience: `${dest} ${dur} ${price} 여행 관심자 (가성비·직항)`,
      key_selling_points: (p.product_highlights ?? [`${dest} 필수`, dur, '노팁'])
        .map((s) => s.slice(0, 60)).slice(0, 3),
      template_family_suggestion: family,
      sections,
      cta_meta: {
        template_suggestion: TEMPLATE_IDS[0],
        pexels_keyword: `${dest} sunset`.slice(0, 40),
      },
      seo: {
        title: `${price} ${dest} ${dur} 패키지 | 여소남 ${year}`.slice(0, 70),
        description: `${dest} ${dur} ${price} 패키지. 여소남에서 안심 비교·예약하세요.`.slice(0, 200),
        slug_suggestion: `${dest.replace(/[\/\s]/g, '-').toLowerCase()}-${dur}`.slice(0, 80),
      },
    };
  }

  // info mode fallback
  const topic = input.topic || '여행 정보';
  const infoSections: StructureOutput['sections'] = ([
    { position: 1, role: 'hook' as const, h2: `${topic} 핵심`, blog_paragraph_seed: '핵심 요약', hook_type: 'number' as const, template_suggestion: TEMPLATE_IDS[1], pexels_keyword: 'travel' },
    { position: 2, role: 'benefit' as const, h2: '주요 포인트', blog_paragraph_seed: '반드시 알아야 할 사항', hook_type: null, template_suggestion: TEMPLATE_IDS[1], pexels_keyword: 'travel' },
    { position: 3, role: 'detail' as const, h2: '준비 체크리스트', blog_paragraph_seed: '여행 전 준비사항', hook_type: null, template_suggestion: TEMPLATE_IDS[1], pexels_keyword: 'travel checklist' },
    { position: 4, role: 'tip' as const, h2: '꿀팁', blog_paragraph_seed: '실용 팁', hook_type: null, template_suggestion: TEMPLATE_IDS[1], pexels_keyword: 'travel' },
    { position: 5, role: 'warning' as const, h2: '주의사항', blog_paragraph_seed: '실수 방지', hook_type: null, template_suggestion: TEMPLATE_IDS[1], pexels_keyword: 'travel' },
  ] satisfies StructureOutput['sections']).slice(0, contentCount);

  return {
    mode: 'info',
    h1: `${topic} 완벽 가이드 ${year}`.slice(0, 70),
    intro_hook: `${topic} 관련 필수 정보를 여소남이 정리했습니다.`,
    target_audience: `여행 준비 중인 일반 여행객`,
    key_selling_points: ['실용 정보', `${year} 최신`, '여소남 검증'],
    template_family_suggestion: 'editorial',
    sections: infoSections,
    cta_meta: {
      template_suggestion: TEMPLATE_IDS[1],
      pexels_keyword: 'travel booking',
    },
    seo: {
      title: `${topic} 완벽 가이드 ${year} | 여소남`.slice(0, 70),
      description: `${topic} 관련 완벽 가이드. 실용 정보와 팁을 여소남에서.`.slice(0, 200),
      slug_suggestion: topic.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-').slice(0, 80),
    },
  };
}

function deriveFallbackFamily(p: NonNullable<StructureInput['product']>): 'editorial' | 'cinematic' | 'premium' | 'bold' {
  const text = [p.title, p.product_summary, ...(p.product_highlights ?? [])].filter(Boolean).join(' ');
  if (/5\s*성급|프리미엄|럭셔리|허니문|신혼/i.test(text)) return 'premium';
  if (/특가|가성비|반값|최저가|마감/i.test(text)) return 'bold';
  if (/자연|풍경|야경|감성|모험|오로라|해변/i.test(text)) return 'cinematic';
  return 'editorial';
}

function deriveFallbackHookType(p: NonNullable<StructureInput['product']>): 'urgency' | 'question' | 'number' | 'fomo' | 'story' {
  const text = [p.title, p.product_summary, ...(p.product_highlights ?? [])].filter(Boolean).join(' ');
  if (/특가|가성비|마감|선착순/i.test(text)) return 'urgency';
  if (/프리미엄|럭셔리|허니문|신혼/i.test(text)) return 'story';
  if (/한정|\d+석/i.test(text)) return 'fomo';
  return 'question';
}

/**
 * Structure Designer — Gemini 1회 호출 (재시도 1회)
 */
export async function designBriefStructure(input: StructureInput): Promise<StructureOutput> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[structure-designer] GOOGLE_AI_API_KEY 없음 → fallback');
    return fallbackStructure(input);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: 0.6, responseMimeType: 'application/json' },
  });

  const prompt = buildDesignerPrompt(input);

  // W3 Pivot C — Zod 위반 시 LLM 자기수정 (instructor-js 패턴)
  const result = await callWithZodValidation({
    label: 'structure-designer',
    schema: StructureOutputSchema,
    maxAttempts: 3,
    fn: async (feedback) => {
      const r = await model.generateContent(prompt + (feedback ?? ''));
      return r.response.text();
    },
  });

  if (result.success) return result.value;
  console.warn('[structure-designer] callWithZodValidation 실패 → fallback');
  return fallbackStructure(input);
}

function buildDesignerPrompt(input: StructureInput): string {
  const slideCount = input.slideCount;
  const contentCount = slideCount - 1;

  let contextBlock = '';
  if (input.mode === 'product' && input.product) {
    const p = input.product;
    const nights = p.nights ?? (p.duration ? p.duration - 1 : 0);
    const dur = p.duration ? `${nights}박${p.duration}일` : '';
    const price = p.price ? `${p.price.toLocaleString()}원~` : '';
    contextBlock = `
## 상품
- 상품명: ${p.title}
- 목적지: ${p.destination ?? ''}
- 기간: ${dur}
- 가격: ${price}
- 항공: ${p.airline ?? ''}
- 출발: ${p.departure_airport ?? ''}
- 하이라이트: ${(p.product_highlights ?? []).slice(0, 4).join(', ')}
- 요약: ${p.product_summary ?? ''}`;
  } else {
    contextBlock = `
## 주제
- 주제: ${input.topic ?? '여행 정보'}
- 카테고리: ${input.category ?? '일반'}`;
  }

  const templateList = TEMPLATE_IDS.map(id => `  - ${id}: ${TEMPLATE_META[id].label}`).join('\n');

  return `너는 카드뉴스 기획 전문가다. **카피는 쓰지 말고** Brief 의 구조 설계만 한다.

## 🚨 출처 제약 (Faithfulness — 최상위 규칙)
- blog_paragraph_seed / h2 / key_selling_points 등 모든 텍스트 출력은 **입력 productContext / topic 에 명시된 사실에서만** 추출한다.
- 입력에 없는 시설(수영장, 라이브공연 등), 수치(만족도·재구매율·인기도), 운영조건(연령제한, 할인조건 등)을 임의로 만들지 마라.
- 모르면 적지 마라. 추측보다 빈칸이 낫다.
- 위반 시 전체 재작성.
(다음 에이전트가 카피를 쓸 것이므로, 너는 role/배치/메타만 결정)
${contextBlock}

## 출력 스펙
- 슬라이드 ${slideCount}장 = ${contentCount}개 섹션 + 1 CTA
- AIDA + PAS 혼합 배치 권장:
  · 1: hook (주목)
  · 2: objection (반론 예측+해소) — 상품 모드일 때 "비싼 거 아냐?" "노옵션 진짜?" 같은 의심 해소
  · 3~4: benefit·tourist_spot·inclusion (혜택·구체 근거)
  · 중간: tip / warning / detail (심화 정보)
  · 마지막 전: save_hook (체크리스트 형식) — IG 알고리즘이 '저장(Save)' 에 최고 가중치 부여
  · 마지막: cta (DM 유도)
- hook 섹션의 hook_type 6종:
  · 특가·마감 → urgency
  · 가성비·정보 → question/number
  · 프리미엄·신혼 → story
  · 재고 한정 → fomo
  · 통념 파괴 → contrarian ("보홀은 비싸다는 거짓말") — 글로벌 상위 1% 마케터가 가장 많이 쓰는 hook
- role enum 전체: hook|benefit|detail|tip|warning|tourist_spot|inclusion|objection|save_hook|cta
- template_family_suggestion: editorial|cinematic|premium|bold 중 상품 성격 1개
- h2 는 블로그 목차 — 간결/명확
- pexels_keyword 는 영문 명사 1~2개

## JSON 스키마 (반드시 이 형식)
{
  "mode": "${input.mode}",
  "h1": "블로그 H1 (가격·숫자 앞쪽, 자기관련성 포함, 최대 70자)",
  "intro_hook": "인트로 훅 (100~250자)",
  "target_audience": "타겟 (구체적, 최대 100자)",
  "key_selling_points": ["수치 포함 3~5개"],
  "template_family_suggestion": "editorial|cinematic|premium|bold",
  "sections": [
    {
      "position": 1,
      "role": "hook|benefit|detail|tip|warning|tourist_spot|inclusion|objection|save_hook",
      "h2": "블로그 H2 (2~50자)",
      "blog_paragraph_seed": "본문 씨앗 (10~500자)",
      "hook_type": "hook 섹션이면 urgency|question|number|fomo|story 중 1개, 아니면 null",
      "template_suggestion": "${TEMPLATE_IDS[0]}",
      "pexels_keyword": "영문 명사 1~2개"
    }
  ],
  "cta_meta": {
    "template_suggestion": "${TEMPLATE_IDS[0]}",
    "pexels_keyword": "영문 명사"
  },
  "seo": {
    "title": "SEO 타이틀 (10~70자, 가격·숫자 앞)",
    "description": "SEO 설명 (30~200자, 마지막 문장에 한정·마감 뉘앙스)",
    "slug_suggestion": "영문 slug"
  }
}

## 템플릿 id
${templateList}

## 규칙
1. sections 배열 정확히 ${contentCount}개
2. position 1~${contentCount}
3. h2 는 "슬라이드 카피"가 아님. 블로그 섹션 제목 톤.
4. 상품 모드에서 박수/일수/가격 팩트 변경 금지
5. JSON만 출력, 마크다운 없이`;
}
