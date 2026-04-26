/**
 * Cover Critic Agent (Gemini 2.5 Flash)
 *
 * 카드뉴스 Cover 슬라이드만 집중 비평.
 * 이유: Cover 80% 비중 (Socialinsider 22M 포스트 연구).
 *
 * 사용 시점:
 *   - /api/card-news/render-v2 직후 (cover 만)
 *   - 또는 UI 에서 "Cover 품질 비평" 버튼
 *
 * 출력: 점수 + 구체 지적 + 재생성 제안
 *
 * 모델: Gemini 2.5 Flash (GOOGLE_AI_API_KEY) — 컨텐츠 파이프 공통 convention
 */
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai';
import { z } from 'zod';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import type { SlideV2 } from '@/lib/card-news/v2/types';

export const CoverCritiqueSchema = z.object({
  overall_score: z.number().min(0).max(100),
  dimensions: z.object({
    hook_strength: z.number().min(0).max(10),         // 0.25초 정지 유도
    self_relevance: z.number().min(0).max(10),         // 타겟 호명
    specificity: z.number().min(0).max(10),            // 구체 수치·장소
    urgency: z.number().min(0).max(10),                // 긴급성 적절성
    visual_text_balance: z.number().min(0).max(10),    // 텍스트·이미지 밸런스
  }),
  issues: z.array(z.object({
    severity: z.enum(['critical', 'major', 'minor']),
    slot: z.string(),          // 'headline' | 'body' | 'eyebrow' | 'price_chip' 등
    problem: z.string().max(200),
    suggestion: z.string().max(200),
  })).max(10),
  rewritten_cover: z.object({
    headline: z.string().max(20).nullable(),
    body: z.string().max(50).nullable(),
    eyebrow: z.string().max(20).nullable(),
  }).nullable(),             // 50점 미만이면 재작성 버전 제시
  // V4: 5가지 심리적 소구점 variants — A/B 테스트용
  // angle: price|loss_aversion|target_call|number_stat|question|contrarian 중 5개
  rewritten_variants: z.array(z.object({
    angle: z.enum(['price', 'loss_aversion', 'target_call', 'number_stat', 'question', 'contrarian']),
    headline: z.string().max(20),
    body: z.string().max(50),
    eyebrow: z.string().max(20),
  })).max(6).optional().nullable(),
  verdict: z.enum(['ship_as_is', 'minor_polish', 'regenerate']),
});

export type CoverCritique = z.infer<typeof CoverCritiqueSchema> & {
  /** 비-스키마 필드: 'llm' 은 Claude Sonnet 결과, 'fallback' 은 결정론적 폴백.
   *  UI/경고용으로만 사용. DB 저장 시에는 schema 필드만 사용. */
  source?: 'llm' | 'fallback';
  fallback_reason?: 'no_api_key' | 'api_failed' | 'parse_failed' | 'schema_failed';
};

export interface CoverCriticInput {
  cover: SlideV2;
  product_context?: {
    title?: string;
    destination?: string;
    price?: number;
    nights?: number;
    key_selling_points?: string[];
    target_audience?: string;
  };
}

export async function critiqueCover(input: CoverCriticInput): Promise<CoverCritique> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.warn('[cover-critic] GOOGLE_AI_API_KEY 없음 → fallback');
    return fallbackCritique(input, 'no_api_key');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // Gemini Structured Outputs — JSON Schema 강제로 parse_failed 경로 제거
  const responseSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      overall_score: { type: SchemaType.INTEGER },
      dimensions: {
        type: SchemaType.OBJECT,
        properties: {
          hook_strength:       { type: SchemaType.INTEGER },
          self_relevance:      { type: SchemaType.INTEGER },
          specificity:         { type: SchemaType.INTEGER },
          urgency:             { type: SchemaType.INTEGER },
          visual_text_balance: { type: SchemaType.INTEGER },
        },
        required: ['hook_strength', 'self_relevance', 'specificity', 'urgency', 'visual_text_balance'],
      },
      issues: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            severity:   { type: SchemaType.STRING, format: 'enum', enum: ['critical', 'major', 'minor'] },
            slot:       { type: SchemaType.STRING },
            problem:    { type: SchemaType.STRING },
            suggestion: { type: SchemaType.STRING },
          },
          required: ['severity', 'slot', 'problem', 'suggestion'],
        },
      },
      rewritten_cover: {
        type: SchemaType.OBJECT,
        properties: {
          headline: { type: SchemaType.STRING, nullable: true },
          body:     { type: SchemaType.STRING, nullable: true },
          eyebrow:  { type: SchemaType.STRING, nullable: true },
        },
        nullable: true,
      },
      rewritten_variants: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            angle:    { type: SchemaType.STRING, format: 'enum', enum: ['price', 'loss_aversion', 'target_call', 'number_stat', 'question', 'contrarian'] },
            headline: { type: SchemaType.STRING },
            body:     { type: SchemaType.STRING },
            eyebrow:  { type: SchemaType.STRING },
          },
          required: ['angle', 'headline', 'body', 'eyebrow'],
        },
        nullable: true,
      },
      verdict: { type: SchemaType.STRING, format: 'enum', enum: ['ship_as_is', 'minor_polish', 'regenerate'] },
    },
    required: ['overall_score', 'dimensions', 'issues', 'verdict'],
  };

  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const prompt = buildCriticPrompt(input);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn('[cover-critic] JSON 파싱 실패:', parseErr instanceof Error ? parseErr.message : parseErr);
      return fallbackCritique(input, 'parse_failed');
    }
    // Gemini 가 길이 제한을 무시하는 경우가 잦음 — Zod 검증 전 보수적으로 트렁케이트.
    // (20~50자 기준은 카드 UI 고정 제약이라 넘는 값은 어차피 렌더 시 잘림)
    coerceCritiqueLengths(parsed);
    const checked = CoverCritiqueSchema.safeParse(parsed);
    if (checked.success) return { ...checked.data, source: 'llm' };
    console.warn('[cover-critic] 스키마 검증 실패:', checked.error.errors.slice(0, 3));
    return fallbackCritique(input, 'schema_failed');
  } catch (err) {
    console.warn('[cover-critic] 호출 실패:', err instanceof Error ? err.message : err);
    return fallbackCritique(input, 'api_failed');
  }
}

/**
 * Gemini 출력의 headline/body/eyebrow 가 Zod 한계치(20/50/20)를 미세하게 넘는 경우가
 * 잦아, 검증 전에 보수적으로 자른다. 잘린 값은 어차피 카드 UI 폭에서 렌더 시 클립되므로
 * UX 손실 < 매번 fallback 로 떨어지는 손실.
 */
function coerceCritiqueLengths(parsed: unknown): void {
  if (!parsed || typeof parsed !== 'object') return;
  const obj = parsed as Record<string, unknown>;

  const clip = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return (v as null) ?? null;
    return v.length > max ? v.slice(0, max) : v;
  };

  // rewritten_cover: {headline, body, eyebrow}
  if (obj.rewritten_cover && typeof obj.rewritten_cover === 'object') {
    const rc = obj.rewritten_cover as Record<string, unknown>;
    if (rc.headline !== null && rc.headline !== undefined) rc.headline = clip(rc.headline, 20);
    if (rc.body     !== null && rc.body     !== undefined) rc.body     = clip(rc.body, 50);
    if (rc.eyebrow  !== null && rc.eyebrow  !== undefined) rc.eyebrow  = clip(rc.eyebrow, 20);
  }

  // rewritten_variants: [{angle, headline, body, eyebrow}]
  if (Array.isArray(obj.rewritten_variants)) {
    for (const v of obj.rewritten_variants) {
      if (v && typeof v === 'object') {
        const rv = v as Record<string, unknown>;
        if (typeof rv.headline === 'string') rv.headline = clip(rv.headline, 20);
        if (typeof rv.body     === 'string') rv.body     = clip(rv.body, 50);
        if (typeof rv.eyebrow  === 'string') rv.eyebrow  = clip(rv.eyebrow, 20);
      }
    }
  }

  // issues[].problem / suggestion: 200자 한계도 보수적으로
  if (Array.isArray(obj.issues)) {
    for (const it of obj.issues) {
      if (it && typeof it === 'object') {
        const iss = it as Record<string, unknown>;
        if (typeof iss.problem    === 'string') iss.problem    = clip(iss.problem, 200);
        if (typeof iss.suggestion === 'string') iss.suggestion = clip(iss.suggestion, 200);
      }
    }
  }
}

function buildCriticPrompt(input: CoverCriticInput): string {
  const c = input.cover;
  const p = input.product_context;

  return `너는 **인스타그램 카드뉴스 시니어 리뷰어**. 10년차. Socialinsider 22M 포스트 연구 + 토스애즈 + PostNitro AIDA + 국내외 여행사 Best Practice 내재화.

Cover 슬라이드 1장 받아 **5개 축 각 10점 만점** + 총 100점으로 심사.

## 🚨 출처 제약 (Faithfulness)
- 심사 시 cover 의 사실 주장(가격·박일·재구매율·만족도·N위 등)이 Product 맥락과 일치하는지 점검.
- **불일치/근거없음** 발견 시 → faithfulness_warnings 배열에 기록 + overall_score 30점 이상 감점.
- rewritten_variants 생성 시에도 **Product 맥락 외 사실 추가 금지** (수치·통계·인증 등 임의 생성 X).

## 심사 대상 Cover
- eyebrow:     "${c.eyebrow ?? ''}"
- headline:    "${c.headline ?? ''}"
- body:        "${c.body ?? ''}"
- price_chip:  "${c.price_chip ?? ''}"
- trust_row:   ${JSON.stringify(c.trust_row ?? [])}
- social_proof:"${c.social_proof ?? ''}"
- hook_type:   "${c.hook_type ?? ''}"
- bg_image_url: ${c.bg_image_url ? 'present' : 'missing'}

## Product 맥락
${p ? `- 상품: ${p.title ?? ''}
- 목적지: ${p.destination ?? ''}
- 가격: ${p.price ?? ''}
- 타겟: ${p.target_audience ?? ''}
- 셀링: ${(p.key_selling_points ?? []).join(', ')}` : '(없음)'}

## 5 심사 축 (각 10점)

### 1. hook_strength (0.25초 정지)
10: "4박 419,000원 — 주말만 출발" 같이 숫자+시간 훅
5:  "보홀 4박5일 패키지" 같은 평이
0:  "즐거운 여행" 같이 막연

### 2. self_relevance (자기관련성)
10: "연차 없이 주말만" 직장인 직접 호명
5:  "가성비 여행자"
0:  불특정 "누구나"

### 3. specificity (구체성)
10: 장소명 + 수식어 + 숫자 모두
5:  일부만
0:  "아름다운 여행지"

### 4. urgency (긴급성 적절성)
10: [선착순 20석] 같이 숫자 포함
5:  [마감 임박]
0:  없거나 과장 ("인생 마지막 기회")

### 5. visual_text_balance (이미지·텍스트 밸런스)
10: bg_image_url 있고 텍스트 슬롯 충분
5:  둘 중 하나만
0:  둘 다 부실

## 점수 해석 + verdict
- 80+ → ship_as_is
- 60~79 → minor_polish (issues 에 고칠 것)
- ~59 → regenerate (rewritten_cover 제시)

## 출력 JSON
{
  "overall_score": 0~100,
  "dimensions": {
    "hook_strength": 0~10,
    "self_relevance": 0~10,
    "specificity": 0~10,
    "urgency": 0~10,
    "visual_text_balance": 0~10
  },
  "issues": [
    {
      "severity": "critical|major|minor",
      "slot": "headline|body|eyebrow|price_chip|...",
      "problem": "200자 이내 구체 지적",
      "suggestion": "200자 이내 개선 제안"
    }
  ],
  "rewritten_cover": {
    "headline": "20자",
    "body": "50자",
    "eyebrow": "20자"
  },
  "rewritten_variants": [
    { "angle": "price",          "headline": "가격 강조형",      "body": "...", "eyebrow": "..." },
    { "angle": "loss_aversion",  "headline": "공포/손실 회피형", "body": "...", "eyebrow": "..." },
    { "angle": "target_call",    "headline": "타겟 지칭형",      "body": "...", "eyebrow": "..." },
    { "angle": "number_stat",    "headline": "숫자/통계형",      "body": "...", "eyebrow": "..." },
    { "angle": "contrarian",     "headline": "통념 파괴형",      "body": "...", "eyebrow": "..." }
  ],
  "verdict": "ship_as_is|minor_polish|regenerate"
}

## 금지어 (절대 사용 금지)
형용사: 매력적인/아름다운/특별한/완벽한/잊지 못할/환상적인/놀라운/인상적인
문구: 놓치지 마세요/지금 바로/절대 후회 없는
거짓 경험: 다녀왔는데/가봤어요/직접 체크
→ 대신 **숫자·장소명·감각 묘사(온도·색·시간)** 만 사용.

## 엄격
- JSON 만 출력
- 60+ 는 rewritten_cover null 허용. 59 이하는 반드시 제시.
- **rewritten_variants 는 항상 5개 제공** (verdict 무관) — A/B 테스트용
- 각 variant 는 서로 확연히 다른 소구점이어야 함 (가격강조 + 공포 둘 다 price 계열이면 부적절)`;
}

function fallbackCritique(
  input: CoverCriticInput,
  reason: NonNullable<CoverCritique['fallback_reason']> = 'api_failed',
): CoverCritique {
  // API 실패 시 결정론적 점수 계산
  const c = input.cover;
  const p = input.product_context ?? {};
  let hookScore = 5;
  let selfRel = 3;
  let specific = 5;
  let urgency = 3;
  let balance = c.bg_image_url ? 8 : 3;

  if (c.headline && /\d/.test(c.headline)) hookScore += 2;
  if (c.eyebrow && /\[.*\]/.test(c.eyebrow)) urgency += 4;
  if (c.price_chip) hookScore += 1;
  if (c.trust_row && c.trust_row.length >= 3) specific += 2;
  if (c.body && /이신 분|이라면|연차|주말/.test(c.body)) selfRel += 4;

  hookScore = Math.min(10, hookScore);
  selfRel = Math.min(10, selfRel);
  specific = Math.min(10, specific);
  urgency = Math.min(10, urgency);
  balance = Math.min(10, balance);

  const overall = Math.round((hookScore + selfRel + specific + urgency + balance) * 2);
  const verdict = overall >= 80 ? 'ship_as_is' : overall >= 60 ? 'minor_polish' : 'regenerate';

  // 결정론적 rewritten_cover: ship_as_is 가 아니면 항상 제공.
  // 지적사항(self_relevance/specificity/urgency)을 실제로 반영해 slide[0] 와 달라지도록 구성.
  const buildRewrite = (): CoverCritique['rewritten_cover'] => {
    if (verdict === 'ship_as_is') return null;

    const hasAudience = p.target_audience && p.target_audience.trim().length > 0;
    const hasPrice = typeof p.price === 'number' && p.price > 0;
    const hasDest = p.destination && p.destination.trim().length > 0;

    // headline: 자기관련성(타겟) 우선, 없으면 가격+목적지로 구체성 강화
    const originalHead = c.headline ?? '';
    let headline: string | null = originalHead;
    if (hasAudience && !originalHead.includes((p.target_audience as string).slice(0, 4))) {
      headline = `${p.target_audience} 위한 ${originalHead}`.slice(0, 20);
    } else if (hasPrice && !/\d/.test(originalHead)) {
      headline = `${Math.floor((p.price as number) / 10000)}만원대 ${originalHead}`.slice(0, 20);
    } else {
      // 동일하면 null 처리(no_diff 방지 위해 미세 조정)
      headline = null;
    }

    const originalBody = c.body ?? '';
    let body: string | null = originalBody;
    if (hasAudience && !originalBody.includes((p.target_audience as string).slice(0, 4))) {
      body = `${p.target_audience}을 위한 맞춤 일정`.slice(0, 50);
    } else if (hasDest && !originalBody.includes(p.destination as string)) {
      body = `${p.destination} ${originalBody}`.slice(0, 50);
    } else {
      body = null;
    }

    const originalEye = c.eyebrow ?? '';
    const eyebrow = /\[.*\]/.test(originalEye) ? null : '[선착순 20석]';

    // 세 필드 모두 null 이면 폴백이 헤드라인만이라도 바꾸도록 보장
    if (!headline && !body && !eyebrow) {
      return { headline: null, body: null, eyebrow: '[선착순 20석]' };
    }
    return { headline, body, eyebrow };
  };

  // 결정론적 variants 5개 (verdict 무관, A/B 용)
  const buildVariants = (): NonNullable<CoverCritique['rewritten_variants']> => {
    const priceStr = typeof p.price === 'number' && p.price > 0
      ? `${Math.floor(p.price / 10000)}만원대`
      : '특가';
    const dest = p.destination ?? '여행';
    const audience = p.target_audience ?? '직장인';
    const origHead = c.headline ?? dest;
    return [
      {
        angle: 'price' as const,
        headline: `${priceStr} ${dest}`.slice(0, 20),
        body: `이 가격 실화? ${dest} ${origHead.slice(0, 10)}…`.slice(0, 50),
        eyebrow: '[최저가]'.slice(0, 20),
      },
      {
        angle: 'loss_aversion' as const,
        headline: `${dest} 호구 주의`.slice(0, 20),
        body: `이거 모르고 ${dest} 가면 돈 날립니다…`.slice(0, 50),
        eyebrow: '[경고]',
      },
      {
        angle: 'target_call' as const,
        headline: `${audience} 주목`.slice(0, 20),
        body: `${audience}이라면 놓치면 후회하는 ${dest}…`.slice(0, 50),
        eyebrow: `[${audience}]`.slice(0, 20),
      },
      {
        // Faithfulness: 재구매율/만족도 통계는 출처가 없으므로 입력에 명시된 박일·가격만 사용.
        angle: 'number_stat' as const,
        headline: (p.nights ? `${p.nights}박 ${dest}` : dest).slice(0, 20),
        body: `${priceStr} ${dest} ${origHead.slice(0, 8)}…`.slice(0, 50),
        eyebrow: priceStr === '특가' ? '[특가]' : `[${priceStr}]`,
      },
      {
        // Faithfulness: 단언("거짓말 끝") 대신 의문형 프레임으로 제한.
        angle: 'contrarian' as const,
        headline: `${dest} 비싸다고?`.slice(0, 20),
        body: `${priceStr}로 ${dest} 다녀온 후기…`.slice(0, 50),
        eyebrow: '[반전]',
      },
    ];
  };

  return {
    overall_score: overall,
    dimensions: {
      hook_strength: hookScore,
      self_relevance: selfRel,
      specificity: specific,
      urgency,
      visual_text_balance: balance,
    },
    issues: overall >= 80 ? [] : [
      { severity: overall < 60 ? 'critical' : 'major', slot: 'headline', problem: '수치·자기관련성 부족', suggestion: '가격/시간/타겟 호명 추가' },
    ],
    rewritten_cover: buildRewrite(),
    rewritten_variants: buildVariants(),
    verdict,
    source: 'fallback',
    fallback_reason: reason,
  };
}
