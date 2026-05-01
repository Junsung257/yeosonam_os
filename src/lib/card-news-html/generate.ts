/**
 * @file generate.ts — 카드뉴스 HTML 생성기 (Stage 1)
 *
 * 입력: 원문 텍스트 + 상품 메타 + (선택) 각도/톤 힌트
 * 출력: 6장 carousel HTML 1개 + thinking 트레이스 + 비용 추정
 *
 * V3 (2026-05-01): Claude Sonnet → DeepSeek V4-Pro 전환 (비용 90%+ 절감)
 * DeepSeek는 OpenAI 호환 API 사용, thinking 대신 일반 CoT 프롬프트
 */

import OpenAI from 'openai';
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
  /**
   * 이전 critic 피드백 (compound learning loop).
   * 1차 생성 후 critic 점수가 낮았을 때, 재생성 시 구체 약점을 프롬프트에 주입.
   * Reflexion 패턴 — 같은 카드뉴스의 실패 차원을 명시해서 자기교정 유도.
   */
  previousCritique?: {
    avg_score: number;
    summary?: string | null;
    /** dimensions: hook_strength·self_relevance·visual_text_balance·cta_clarity·consistency */
    weakDimensions?: string[];
  };
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

const MODEL = 'deepseek-v4-pro';
const MAX_TOKENS = 16384;

// DeepSeek V4-Pro 가격 (USD per Million tokens)
const PRICE_USD_PER_M = {
  input: 1.74,
  output: 3.48,
  cacheHit: 0.17,
};

function calcCost(usage: GenerateOutput['usage']): number {
  return (
    (usage.input_tokens / 1_000_000) * PRICE_USD_PER_M.input +
    (usage.output_tokens / 1_000_000) * PRICE_USD_PER_M.output +
    (usage.cache_read_input_tokens / 1_000_000) * PRICE_USD_PER_M.cacheHit
  );
}

function getDeepSeek(): OpenAI {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY 미설정');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
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

  // Compound learning loop: 이전 시도가 critic 저점이면 약점 명시
  if (input.previousCritique) {
    lines.push('## ⚠️ 이전 시도 약점 (반드시 개선)');
    lines.push(`- 이전 점수: ${input.previousCritique.avg_score}/100 (커트라인 65 미만)`);
    if (input.previousCritique.summary) {
      lines.push(`- critic 요약: ${input.previousCritique.summary}`);
    }
    if (input.previousCritique.weakDimensions?.length) {
      lines.push(`- 약점 차원: ${input.previousCritique.weakDimensions.join(', ')}`);
      lines.push('  → 위 차원에서 점수가 낮았습니다. 이번엔 그 부분을 집중 보완하세요.');
      lines.push('  · hook_strength 약점: 1번 카드 헤드라인을 더 구체적으로 (숫자·장소명·시간 트리거)');
      lines.push('  · self_relevance 약점: 타겟 고객이 자기 얘기로 느끼게 (연령·동반자·상황 명시)');
      lines.push('  · visual_text_balance 약점: 헤드라인 ≤15자, body ≤40자 엄수');
      lines.push('  · cta_clarity 약점: 마지막 카드 액션이 모호 — DM 키워드 명시');
      lines.push('  · consistency 약점: 6장 톤·페이스 통일');
    }
    lines.push('');
  }

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
  const client = getDeepSeek();
  const userMessage = await buildUserMessage(input);
  const startedAt = Date.now();

  // Brand voice 동적 주입 (brandCode 있을 때만)
  let systemPrompt = CARD_NEWS_HTML_SYSTEM_PROMPT;
  if (input.brandCode) {
    try {
      const voiceBlock = await getBrandVoiceBlock(input.brandCode, 'instagram', 2);
      if (voiceBlock?.trim()) {
        systemPrompt += `\n\n# E. 브랜드 보이스 (이 브랜드 전용 필수 적용)\n\n${voiceBlock}\n\n위 브랜드 보이스 + 우수 샘플 톤을 따르세요. 단, A0 (Faithfulness) 와 충돌 시 A0 우선.`;
      }
    } catch (e) {
      // Brand voice 누락은 블로커 아님 — 기본 톤으로 진행
      console.warn('[card-news-html] brand voice fetch 실패 (무시):', e);
    }
  }

  // DeepSeek V4-Pro로 생성 (thinking 대신 CoT를 system prompt에 포함)
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content: `먼저 <thinking> 태그 안에 각도·카피·레이아웃 전략을 300자 이내로 짧게 정리한 뒤, 최종 HTML을 출력하세요.\n\n${systemPrompt}`,
      },
      { role: 'user', content: userMessage },
    ],
  });

  const textOut = response.choices?.[0]?.message?.content || '';
  const usage = response.usage;

  // <thinking> 태그 분리
  let thinking = '';
  let htmlRaw = textOut;
  const thinkMatch = textOut.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    htmlRaw = textOut.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
  }

  const html = extractHtml(htmlRaw);

  const usageData = {
    input_tokens: usage?.prompt_tokens || 0,
    output_tokens: usage?.completion_tokens || 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: (usage as any)?.prompt_cache_hit_tokens || 0,
  };

  // Faithfulness 자동 후처리 (regex 환각 검출, API 호출 0)
  const faithfulness = checkFaithfulness({ html, rawText: input.rawText });

  return {
    html,
    thinking,
    rawText: textOut,
    usage: usageData,
    costUsd: calcCost(usageData),
    model: MODEL,
    durationMs: Date.now() - startedAt,
    faithfulness,
  };
}
