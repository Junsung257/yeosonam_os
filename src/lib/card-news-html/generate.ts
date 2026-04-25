/**
 * @file generate.ts — 카드뉴스 HTML 생성기 (Stage 1)
 *
 * 입력: 원문 텍스트 + 상품 메타 + (선택) 각도/톤 힌트
 * 출력: 6장 carousel HTML 1개 + thinking 트레이스 + 비용 추정
 *
 * 모델: Claude Sonnet 4.6 + Extended Thinking (4K) + Prompt Caching (system)
 */

import Anthropic from '@anthropic-ai/sdk';
import { CARD_NEWS_HTML_SYSTEM_PROMPT } from './system-prompt';
import { checkFaithfulness, type FaithfulnessReport } from './faithfulness-check';
import { getBrandVoiceBlock } from '@/lib/content-pipeline/brand-voice';
import { extractCompetitorSeed, formatCompetitorSeedAsPrompt } from './competitor-seed';

export interface GenerateInput {
  rawText: string;
  productMeta?: {
    title?: string;
    destination?: string;
    nights?: number;
    duration?: number;
    price?: number;
    highlights?: string[];
    departureDates?: string[];
  };
  angleHint?: 'luxury' | 'value' | 'urgency' | 'emotional' | 'filial' | 'activity' | 'food';
  toneHint?: string;
  /** brand_kits.code (예: 'yeosonam'). 있으면 voice_guide + 우수 샘플을 system prompt 에 동적 주입 */
  brandCode?: string;
  /** true 면 같은 destination 의 경쟁사 광고에서 트렌드 시드 자동 추출해 user 메시지에 첨부 */
  useCompetitorSeed?: boolean;
}

export interface GenerateOutput {
  html: string;
  thinking: string;
  rawText: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  costUsd: number;
  model: string;
  durationMs: number;
  faithfulness: FaithfulnessReport;
}

const MODEL = 'claude-sonnet-4-6';
const THINKING_BUDGET = 4000;
const MAX_TOKENS = 40000;

const PRICE_USD_PER_M = {
  input: 3,
  output: 15,
  cacheWrite5m: 3.75,
  cacheRead: 0.30,
};

function calcCost(usage: GenerateOutput['usage']): number {
  return (
    (usage.input_tokens / 1_000_000) * PRICE_USD_PER_M.input +
    (usage.output_tokens / 1_000_000) * PRICE_USD_PER_M.output +
    (usage.cache_creation_input_tokens / 1_000_000) * PRICE_USD_PER_M.cacheWrite5m +
    (usage.cache_read_input_tokens / 1_000_000) * PRICE_USD_PER_M.cacheRead
  );
}

async function buildUserMessage(input: GenerateInput): Promise<string> {
  const lines: string[] = [];

  // 경쟁사 트렌드 시드 (옵션)
  if (input.useCompetitorSeed && input.productMeta?.destination) {
    try {
      const seed = await extractCompetitorSeed({
        destination: input.productMeta.destination,
        excludeOwnBrand: input.brandCode ?? 'yeosonam',
      });
      const seedBlock = formatCompetitorSeedAsPrompt(seed);
      if (seedBlock) {
        lines.push(seedBlock);
        lines.push('');
      }
    } catch (e) {
      console.warn('[card-news-html] competitor seed 실패 (무시):', e);
    }
  }

  if (input.productMeta) {
    const m = input.productMeta;
    lines.push('## 상품 메타');
    if (m.title) lines.push(`- 상품명: ${m.title}`);
    if (m.destination) lines.push(`- 목적지: ${m.destination}`);
    if (m.nights != null && m.duration != null) {
      lines.push(`- 기간: ${m.nights}박${m.duration}일`);
    }
    if (m.price != null) {
      lines.push(`- 가격(1인 최저): ${m.price.toLocaleString('ko-KR')}원`);
    }
    if (m.highlights?.length) {
      lines.push(`- 하이라이트: ${m.highlights.join(' / ')}`);
    }
    if (m.departureDates?.length) {
      lines.push(`- 출발일: ${m.departureDates.join(', ')}`);
    }
    lines.push('');
  }

  if (input.angleHint) lines.push(`## 각도 힌트\n${input.angleHint}\n`);
  if (input.toneHint) lines.push(`## 톤 힌트\n${input.toneHint}\n`);

  lines.push('## 원문');
  lines.push(input.rawText.trim());
  lines.push('');
  lines.push('---');
  lines.push('위 정보로 6장 carousel HTML 을 생성해주세요. 코드블럭 1개만 출력.');

  return lines.join('\n');
}

function extractHtml(text: string): string {
  const m = text.match(/```html\s*([\s\S]*?)\s*```/);
  if (m) return m[1].trim();
  // fallback: 코드블럭 없이 raw HTML 출력했을 때
  const docTypeIdx = text.indexOf('<!DOCTYPE');
  if (docTypeIdx >= 0) return text.slice(docTypeIdx).trim();
  return text.trim();
}

export async function generateCardNewsHtml(
  input: GenerateInput,
): Promise<GenerateOutput> {
  const client = new Anthropic();
  const userMessage = await buildUserMessage(input);
  const startedAt = Date.now();

  // Brand voice 동적 주입 (brandCode 있을 때만)
  type SystemBlock = {
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  };
  const systemBlocks: SystemBlock[] = [
    {
      type: 'text',
      text: CARD_NEWS_HTML_SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (input.brandCode) {
    try {
      const voiceBlock = await getBrandVoiceBlock(input.brandCode, 'instagram', 2);
      if (voiceBlock?.trim()) {
        systemBlocks.push({
          type: 'text',
          text: `\n# E. 브랜드 보이스 (이 브랜드 전용 필수 적용)\n\n${voiceBlock}\n\n위 브랜드 보이스 + 우수 샘플 톤을 따르세요. 단, A0 (Faithfulness) 와 충돌 시 A0 우선.`,
          cache_control: { type: 'ephemeral' },
        });
      }
    } catch (e) {
      // Brand voice 누락은 블로커 아님 — 기본 톤으로 진행
      console.warn('[card-news-html] brand voice fetch 실패 (무시):', e);
    }
  }

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: {
      type: 'enabled',
      budget_tokens: THINKING_BUDGET,
    },
    system: systemBlocks,
    messages: [{ role: 'user', content: userMessage }],
  });
  const response = await stream.finalMessage();

  let textOut = '';
  let thinking = '';
  for (const block of response.content) {
    if (block.type === 'thinking') {
      thinking += block.thinking;
    } else if (block.type === 'text') {
      textOut += block.text;
    }
  }

  const html = extractHtml(textOut);

  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };

  // Faithfulness 자동 후처리 (regex 환각 검출, API 호출 0)
  const faithfulness = checkFaithfulness({ html, rawText: input.rawText });

  return {
    html,
    thinking,
    rawText: textOut,
    usage,
    costUsd: calcCost(usage),
    model: response.model,
    durationMs: Date.now() - startedAt,
    faithfulness,
  };
}
