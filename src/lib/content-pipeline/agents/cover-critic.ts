/**
 * Cover Critic Agent (Claude Sonnet)
 *
 * 카드뉴스 Cover 슬라이드만 집중 비평.
 * 이유: Cover 80% 비중 (Socialinsider 22M 포스트 연구).
 * Gemini Flash 가 생성한 카피를 Claude Sonnet 이 더 discerning 하게 심사.
 *
 * 사용 시점:
 *   - /api/card-news/render-v2 직후 (cover 만)
 *   - 또는 UI 에서 "Cover 품질 비평" 버튼
 *
 * 출력: 점수 + 구체 지적 + 재생성 제안
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
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
  verdict: z.enum(['ship_as_is', 'minor_polish', 'regenerate']),
});

export type CoverCritique = z.infer<typeof CoverCritiqueSchema>;

export interface CoverCriticInput {
  cover: SlideV2;
  product_context?: {
    title?: string;
    destination?: string;
    price?: number;
    key_selling_points?: string[];
    target_audience?: string;
  };
}

export async function critiqueCover(input: CoverCriticInput): Promise<CoverCritique> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[cover-critic] ANTHROPIC_API_KEY 없음 → fallback');
    return fallbackCritique(input);
  }

  const client = new Anthropic({ apiKey });

  const prompt = buildCriticPrompt(input);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('')
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : text;
    const parsed = JSON.parse(jsonStr);
    const checked = CoverCritiqueSchema.safeParse(parsed);
    if (checked.success) return checked.data;
    console.warn('[cover-critic] 스키마 검증 실패:', checked.error.errors.slice(0, 3));
  } catch (err) {
    console.warn('[cover-critic] 호출 실패:', err instanceof Error ? err.message : err);
  }

  return fallbackCritique(input);
}

function buildCriticPrompt(input: CoverCriticInput): string {
  const c = input.cover;
  const p = input.product_context;

  return `너는 **인스타그램 카드뉴스 시니어 리뷰어**. 10년차. Socialinsider 22M 포스트 연구 + 토스애즈 + PostNitro AIDA + 국내외 여행사 Best Practice 내재화.

Cover 슬라이드 1장 받아 **5개 축 각 10점 만점** + 총 100점으로 심사.

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
  "verdict": "ship_as_is|minor_polish|regenerate"
}

엄격: JSON 만 출력. 60+ 는 rewritten_cover null 허용, 59 이하는 반드시 제시.`;
}

function fallbackCritique(input: CoverCriticInput): CoverCritique {
  // API 실패 시 결정론적 점수 계산
  const c = input.cover;
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
    rewritten_cover: overall >= 60 ? null : {
      headline: c.headline.slice(0, 20),
      body: c.body.slice(0, 50),
      eyebrow: '[선착순 20석]',
    },
    verdict,
  };
}
