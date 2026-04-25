/**
 * @file critic.ts — 카드뉴스 HTML 6장 전체 비평기 (Performance Predictor)
 *
 * AdCreative.ai / Pencil AI 의 Score 시스템 모방.
 * Claude Haiku 4.5 사용 (저비용 + 빠른 응답) — 6장 전체 평가에 최적.
 *
 * 입력: 6장 carousel HTML + 원문
 * 출력: 카드별 점수 + 종합 점수 + 발행 권장 verdict
 */

import Anthropic from '@anthropic-ai/sdk';

export interface CardCritique {
  index: number;            // 0-5
  score: number;            // 0-100
  issues: Array<{
    severity: 'high' | 'medium' | 'low';
    problem: string;
    suggestion: string;
  }>;
}

export interface FullCritique {
  avg_score: number;        // 6장 평균
  cards: CardCritique[];    // 카드별
  dimensions: {
    hook_strength: number;        // 1번 카드 시선 끄는 힘
    self_relevance: number;       // 타겟 매칭
    visual_text_balance: number;  // 시각/텍스트 균형
    cta_clarity: number;          // 마지막 카드 CTA 명료성
    consistency: number;          // 6장 일관성
  };
  verdict: 'ship_as_is' | 'minor_polish' | 'regenerate';
  summary: string;          // 한 줄 요약
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  costUsd: number;
  durationMs: number;
}

const MODEL = 'claude-haiku-4-5-20251001';

// Haiku 4.5 가격 (USD per Million tokens)
const PRICE = {
  input: 1,
  output: 5,
  cacheWrite5m: 1.25,
  cacheRead: 0.10,
};

const SYSTEM_PROMPT = `당신은 인스타그램 carousel 광고 성과 예측 전문가입니다.
6장 카드뉴스 HTML 을 받아서 각 카드를 0-100점으로 평가합니다.

# 평가 기준 (광고 성과 예측 관점)

## 1. Hook Strength (1번 카드 — 시선 캐치)
- 0.5초 안에 핵심 셀링 포인트가 인식되는가
- 메인 카피 + 가격 + 출발일이 시각적으로 동등하게 강한가

## 2. Self-Relevance (타겟 매칭)
- "이건 나를 위한 상품" 신호가 명확한가
- 각도(luxury/value/urgency 등)가 일관되는가

## 3. Visual-Text Balance
- 글자가 너무 작거나 흐리지 않은가 (모바일 가독성)
- 컬러 대비 충분한가
- 시각 장식이 텍스트를 가리지 않는가

## 4. CTA Clarity (6번 카드)
- "지금 무엇을 해야 하는지" 명확한가
- 카카오 채널 / 문의 정보 표기 명료한가

## 5. Consistency (6장 일관성)
- 컬러 팔레트 일관
- 타이포 위계 일관
- 톤 일관

# 점수 가이드
- 90-100: 발행 즉시 가능, 매우 우수
- 70-89: 발행 권장 (일부 미세 개선 가능)
- 50-69: 미세 수정 후 발행 (minor_polish)
- 0-49: 재생성 권장 (regenerate)

# Verdict 규칙
- 평균 ≥ 80 + 모든 카드 ≥ 70: ship_as_is
- 평균 ≥ 65: minor_polish
- 평균 < 65: regenerate

# 출력 형식 (반드시 JSON, 코드블럭 없이)
{
  "cards": [
    { "index": 0, "score": 85, "issues": [{"severity":"medium","problem":"...","suggestion":"..."}] },
    ...
  ],
  "dimensions": {
    "hook_strength": 82,
    "self_relevance": 78,
    "visual_text_balance": 85,
    "cta_clarity": 75,
    "consistency": 88
  },
  "avg_score": 82,
  "verdict": "ship_as_is",
  "summary": "..."
}`;

function calcCost(usage: FullCritique['usage']): number {
  return (
    (usage.input_tokens / 1_000_000) * PRICE.input +
    (usage.output_tokens / 1_000_000) * PRICE.output +
    (usage.cache_creation_input_tokens / 1_000_000) * PRICE.cacheWrite5m +
    (usage.cache_read_input_tokens / 1_000_000) * PRICE.cacheRead
  );
}

function extractJson(text: string): unknown {
  // 코드블럭 안에 있을 수도, 없을 수도
  const cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const target = fence ? fence[1] : cleaned;
  // 첫 { 부터 마지막 } 까지
  const start = target.indexOf('{');
  const end = target.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('JSON 응답 파싱 실패');
  return JSON.parse(target.slice(start, end + 1));
}

export async function critiqueHtmlCarousel(input: {
  html: string;
  rawText?: string;
  productMeta?: { title?: string; angle?: string };
}): Promise<FullCritique> {
  const client = new Anthropic();
  const startedAt = Date.now();

  const userMessage = [
    input.productMeta?.title && `## 상품: ${input.productMeta.title}`,
    input.productMeta?.angle && `## 각도: ${input.productMeta.angle}`,
    input.rawText && `## 원문 (Faithfulness 검증용)\n${input.rawText.slice(0, 1500)}`,
    `## 평가할 HTML carousel (6장)\n\n${input.html}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  let textOut = '';
  for (const block of response.content) {
    if (block.type === 'text') textOut += block.text;
  }

  const parsed = extractJson(textOut) as {
    cards?: CardCritique[];
    dimensions?: FullCritique['dimensions'];
    avg_score?: number;
    verdict?: FullCritique['verdict'];
    summary?: string;
  };

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };

  return {
    avg_score: parsed.avg_score ?? 0,
    cards: parsed.cards ?? [],
    dimensions: parsed.dimensions ?? {
      hook_strength: 0,
      self_relevance: 0,
      visual_text_balance: 0,
      cta_clarity: 0,
      consistency: 0,
    },
    verdict: parsed.verdict ?? 'minor_polish',
    summary: parsed.summary ?? '',
    usage,
    costUsd: calcCost(usage),
    durationMs: Date.now() - startedAt,
  };
}
