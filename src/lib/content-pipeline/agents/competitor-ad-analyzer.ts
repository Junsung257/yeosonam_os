/**
 * Competitor Ad Analyzer
 *
 * 경쟁사 광고 snapshots 를 분석해 **패턴 요약** 을 생성. 이 요약을 Meta Ads
 * 에이전트 프롬프트에 주입해 "요즘 경쟁사가 이렇게 쓴다" 를 학습시킨다.
 *
 * 호출:
 *   const summary = await analyzeCompetitorAds(['보홀','다낭']);
 *   → Meta Ads 프롬프트 앞에 "## 경쟁사 패턴\n...\n\n" 삽입
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import { callWithZodValidation } from '@/lib/llm-validate-retry';

export const CompetitorPatternSchema = z.object({
  common_hooks: z.array(z.string().max(100)).max(10),       // 자주 쓰는 훅 문구
  common_benefits: z.array(z.string().max(60)).max(10),     // 공통 어필 혜택
  common_urgency: z.array(z.string().max(60)).max(5),       // 긴급성 패턴
  cta_distribution: z.record(z.string(), z.number()),       // { "BOOK_TRAVEL": 12, "LEARN_MORE": 5 }
  top_active_ad: z.object({
    brand: z.string(),
    primary_copy: z.string().max(300),
    active_days: z.number().nullable(),
  }).nullable(),
  differentiation_hint: z.string().max(400),                // 우리가 어떻게 다르게 할지 힌트
});

export type CompetitorPattern = z.infer<typeof CompetitorPatternSchema>;

/**
 * Destination 힌트로 필터링한 경쟁사 광고 분석 요약.
 * 없으면 null 반환 (에이전트가 공경쟁 없이 진행).
 */
export async function analyzeCompetitorAds(
  destinationHints: string[],
  limit: number = 20,
): Promise<CompetitorPattern | null> {
  if (!isSupabaseConfigured) return null;

  // 1. snapshot 조회 (destination 우선, 없으면 전체 최신)
  let query = supabaseAdmin
    .from('competitor_ad_snapshots')
    .select('brand, copy_primary, copy_headline, copy_description, cta_button, destination_hint, promo_type, active_days, ctr_estimate, analysis')
    .order('active_days', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (destinationHints.length > 0) {
    query = query.in('destination_hint', destinationHints);
  }

  const { data, error } = await query;
  if (error || !data || data.length === 0) return null;

  // 2. AI 패턴 분석 (Gemini Flash)
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return fallbackPattern(data as never[]);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: BLOG_AI_MODEL,
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  });

  const sample = (data as Array<Record<string, unknown>>).slice(0, 10)
    .map((r, i) => `[${i + 1}] ${r.brand} · ${r.destination_hint ?? '-'} · ${r.active_days ?? '?'}일
  P: ${(r.copy_primary as string || '').slice(0, 180)}
  H: ${r.copy_headline ?? '-'}
  CTA: ${r.cta_button ?? '-'}`)
    .join('\n');

  const prompt = `너는 광고 카피 분석가. 아래 경쟁사 Meta 광고 ${data.length}건을 분석해 패턴 추출.

## 데이터
${sample}

## 출력 JSON
{
  "common_hooks": ["자주 쓰는 훅 문구 3~5개"],
  "common_benefits": ["공통 혜택 키워드 3~6개"],
  "common_urgency": ["긴급성 패턴 2~4개"],
  "cta_distribution": { "BOOK_TRAVEL": 숫자, "LEARN_MORE": 숫자 },
  "top_active_ad": {
    "brand": "가장 오래 게재된 브랜드",
    "primary_copy": "그 광고 본문 180자 이내",
    "active_days": 숫자 또는 null
  },
  "differentiation_hint": "여소남이 이들과 다르게 접근할 지점 400자 이내"
}

JSON만 출력.`;

  const result = await callWithZodValidation({
    label: 'competitor-ad-analyzer',
    schema: CompetitorPatternSchema,
    maxAttempts: 3,
    fn: async (feedback) => {
      const r = await model.generateContent(prompt + (feedback ?? ''));
      return r.response.text();
    },
  });

  if (result.success) return result.value;
  console.warn('[competitor-analyzer] callWithZodValidation 실패 → fallback');
  return fallbackPattern(data as never[]);
}

function fallbackPattern(data: Array<Record<string, unknown>>): CompetitorPattern {
  const ctaCounts: Record<string, number> = {};
  const hooks: string[] = [];
  for (const r of data) {
    const cta = r.cta_button as string | undefined;
    if (cta) ctaCounts[cta] = (ctaCounts[cta] ?? 0) + 1;
    const headline = r.copy_headline as string | undefined;
    if (headline && hooks.length < 5) hooks.push(headline);
  }
  const top = data[0];
  return {
    common_hooks: hooks,
    common_benefits: ['가성비', '특가', '직항', '선착순'],
    common_urgency: ['마감', '선착순', '오늘만'],
    cta_distribution: ctaCounts,
    top_active_ad: top ? {
      brand: top.brand as string,
      primary_copy: ((top.copy_primary as string) || '').slice(0, 180),
      active_days: (top.active_days as number) ?? null,
    } : null,
    differentiation_hint: '경쟁사는 평이한 정보 나열. 여소남은 Hook Type 다변화 + 자기관련성 + Social Proof 로 차별화.',
  };
}

/**
 * Meta Ads 프롬프트에 주입할 텍스트 블록.
 */
export async function getCompetitorPromptBlock(destinationHints: string[]): Promise<string> {
  const pattern = await analyzeCompetitorAds(destinationHints);
  if (!pattern) return '';

  const topAd = pattern.top_active_ad
    ? `- 최장 게재 광고(${pattern.top_active_ad.brand}, ${pattern.top_active_ad.active_days ?? '?'}일):\n    "${pattern.top_active_ad.primary_copy}"`
    : '';

  const ctaList = Object.entries(pattern.cta_distribution).slice(0, 3)
    .map(([k, v]) => `${k}(${v})`).join(', ');

  return `## 경쟁사 Meta 광고 패턴 (데이터 기반, 차별화 목적)
- 공통 훅: ${pattern.common_hooks.slice(0, 5).join(' / ')}
- 공통 혜택: ${pattern.common_benefits.slice(0, 5).join(' / ')}
- 긴급성: ${pattern.common_urgency.join(' / ')}
- 주 CTA: ${ctaList}
${topAd}

## 차별화 가이드
${pattern.differentiation_hint}
위 공통 패턴은 "따라 쓰지 말 것". 여소남만의 자기관련성·hook_type 다변화·social_proof 수치로 차별화.`;
}
