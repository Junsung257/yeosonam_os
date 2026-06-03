/**
 * Threads Post Agent
 *
 * Generates a text-first Threads post plus follow-up thread entries from a
 * ContentBrief and optional product metadata. The prompt now includes compact
 * learned trend/style signals and the output stores the reasoning metadata
 * needed for later performance learning.
 */
import { z } from 'zod';
import type { ContentBrief } from '@/lib/validators/content-brief';
import { callWithZodValidation } from '@/lib/llm-validate-retry';
import { generateBlogJSON, hasBlogApiKey } from '@/lib/blog-ai-caller';
import { getBrandVoiceBlock } from '../brand-voice';
import { extractTrendFeatures } from '@/lib/trend-feature-extractor';
import { extractThreadsFeatures, predictEngagementRate } from '@/lib/content-pipeline/critic';
import { validateThreadsBody } from '@/lib/threads-publisher';
import {
  chooseThreadsLearningMode,
  computeTrendConfidence,
  getThreadsTrendLearningContext,
  summarizeTrendSourcesForGeneration,
} from '@/lib/threads-trend-learner';

const TrendSourceSchema = z.object({
  source_type: z.string(),
  destination: z.string(),
  hook_type: z.string(),
  style_key: z.string(),
  sample_count: z.number(),
  avg_score: z.number().nullable(),
  avg_er: z.number().nullable(),
  latest_captured_at: z.string().nullable(),
});

export const ThreadsPostSchema = z.object({
  main: z.string().min(30).max(500),
  thread: z.array(z.string().min(20).max(500)).max(4),
  hashtags: z.array(z.string().regex(/^#[^\s#]+$/)).max(3),
  cta_type: z.enum(['dm_keyword', 'reply_question', 'profile_link', 'none']),
  why_this_will_work: z.string().max(500).optional().default(''),
  trend_sources: z.array(TrendSourceSchema).max(6).optional().default([]),
  predicted_er: z.number().min(0).max(1).optional().default(0),
  risk_flags: z.array(z.string()).max(8).optional().default([]),
  learning_mode: z.enum(['owned_performance', 'external_trend', 'fallback_curated']).optional().default('fallback_curated'),
  trend_confidence: z.number().min(0).max(1).optional().default(0),
});

export type ThreadsPost = z.infer<typeof ThreadsPostSchema>;

export interface ThreadsPostInput {
  brief: ContentBrief;
  product?: {
    title: string;
    destination?: string;
    duration?: number;
    nights?: number;
    price?: number;
    product_summary?: string;
    product_highlights?: string[];
  };
  style?: 'personal_story' | 'info_list' | 'question' | 'behind_the_scene';
  trendKeywords?: string[];
  angleType?: 'budget' | 'luxury' | 'sentimental' | 'adventure';
  candidateCount?: number;
}

export async function generateThreadsPost(input: ThreadsPostInput): Promise<ThreadsPost> {
  const trendContext = await getThreadsTrendLearningContext({
    destination: input.product?.destination,
    audience: input.brief.target_audience,
    limit: 6,
  });
  const trendSources = summarizeTrendSourcesForGeneration(trendContext);
  const learningMode = chooseThreadsLearningMode(trendContext);
  const trendConfidence = computeTrendConfidence(trendContext);

  if (!hasBlogApiKey()) {
    console.warn('[threads-post] missing AI key; using fallback');
    return fallbackThreadsPost(input, trendSources, learningMode, trendConfidence);
  }

  const voiceBlock = await getBrandVoiceBlock('yeosonam', 'threads_post');
  const prefix = [
    voiceBlock,
    trendContext.promptBlock,
  ].filter(Boolean).join('\n\n');

  const styleCandidates: NonNullable<ThreadsPostInput['style']>[] = [
    input.style ?? 'personal_story',
    'info_list',
    'question',
    'behind_the_scene',
  ];
  const candidateCount = Math.min(Math.max(input.candidateCount ?? 3, 1), styleCandidates.length);
  const uniqueStyles = Array.from(new Set(styleCandidates)).slice(0, candidateCount);

  const results = await Promise.allSettled(
    uniqueStyles.map(async (style) => {
      const prompt = [prefix, buildThreadsPrompt({ ...input, style })].filter(Boolean).join('\n\n');
      const result = await callWithZodValidation({
        label: `threads-post-${style}`,
        schema: ThreadsPostSchema,
        maxAttempts: 2,
        fn: (feedback) => generateBlogJSON(prompt + (feedback ?? ''), { temperature: 0.9, longCache: true }),
      });
      if (!result.success) return null;
      const parsed = ThreadsPostSchema.parse(result.value);
      return enrichThreadsPost(parsed, trendSources, learningMode, trendConfidence);
    }),
  );

  const candidates = results
    .filter((r): r is PromiseFulfilledResult<ThreadsPost | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((post): post is ThreadsPost => post != null);
  const winner = pickBestThreadsCandidate(candidates);
  if (winner) return winner;

  console.warn('[threads-post] generation failed; using fallback');
  return fallbackThreadsPost(input, trendSources, learningMode, trendConfidence);
}

function pickBestThreadsCandidate(candidates: ThreadsPost[]): ThreadsPost | null {
  let best: { post: ThreadsPost; score: number } | null = null;
  for (const post of candidates) {
    const validationError = validateThreadsBody(post.main);
    if (validationError) continue;

    const predicted = predictThreadsEr(post);
    const conversionBonus = post.cta_type === 'dm_keyword' ? 0.006
      : post.cta_type === 'reply_question' ? 0.004
      : post.cta_type === 'profile_link' ? 0.001
      : 0;
    const threadBonus = Math.min(post.thread.length, 4) * 0.0015;
    const score = predicted + conversionBonus + threadBonus;
    const enriched = {
      ...post,
      predicted_er: Number(score.toFixed(4)),
      risk_flags: buildRiskFlags(post),
      why_this_will_work: post.why_this_will_work || buildWhyThisWorks(post, predicted),
    };
    if (!best || score > best.score) best = { post: enriched, score };
  }
  return best?.post ?? null;
}

function enrichThreadsPost(
  post: ThreadsPost,
  trendSources: ThreadsPost['trend_sources'],
  learningMode: ThreadsPost['learning_mode'],
  trendConfidence: number,
): ThreadsPost {
  const predicted = predictThreadsEr(post);
  return {
    ...post,
    trend_sources: post.trend_sources.length > 0 ? post.trend_sources : trendSources,
    predicted_er: post.predicted_er > 0 ? post.predicted_er : Number(predicted.toFixed(4)),
    risk_flags: post.risk_flags.length > 0 ? post.risk_flags : buildRiskFlags(post),
    why_this_will_work: post.why_this_will_work || buildWhyThisWorks(post, predicted),
    learning_mode: post.learning_mode === 'fallback_curated' ? learningMode : post.learning_mode,
    trend_confidence: post.trend_confidence > 0 ? post.trend_confidence : Number(trendConfidence.toFixed(2)),
  };
}

function predictThreadsEr(post: ThreadsPost): number {
  const fullText = [post.main, ...post.thread, post.hashtags.join(' ')].filter(Boolean).join('\n');
  const feats = extractTrendFeatures(post.main);
  return predictEngagementRate(extractThreadsFeatures({
    text: fullText,
    hook_type: feats.hook_type_guess,
    posting_hour_kst: null,
  }));
}

function buildRiskFlags(post: ThreadsPost): string[] {
  const flags: string[] = [];
  if (post.main.length > 470) flags.push('main_near_limit');
  if (post.thread.length < 2) flags.push('short_thread');
  if (post.hashtags.length > 2) flags.push('hashtag_heavy');
  if (post.cta_type === 'none') flags.push('no_cta');
  if (validateThreadsBody(post.main)) flags.push('main_validation_warning');
  return flags;
}

function buildWhyThisWorks(post: ThreadsPost, predicted: number): string {
  const hook = extractTrendFeatures(post.main).hook_type_guess ?? 'story';
  const cta = post.cta_type === 'dm_keyword' ? 'DM conversion CTA'
    : post.cta_type === 'reply_question' ? 'reply-inducing question'
    : post.cta_type === 'profile_link' ? 'low-friction profile CTA'
    : 'soft-share format';
  return `Hook=${hook}, ${cta}, ${post.thread.length} follow-up posts. Predicted ER ${(predicted * 100).toFixed(2)}%.`;
}

function buildThreadsPrompt(input: ThreadsPostInput): string {
  const b = input.brief;
  const p = input.product;
  const priceText = p?.price ? formatPriceChipSimple(p.price) : '';
  const style = input.style ?? 'personal_story';

  return `You are a Threads-first travel copywriter for Yeosonam.
Write like a real operator sharing useful context, not like an Instagram caption.

## Brief
- H1: ${b.h1}
- target_audience: ${b.target_audience}
${p ? `- product: ${p.title}
- destination: ${p.destination ?? ''}
- duration: ${p.duration ? `${p.nights ?? p.duration - 1} nights / ${p.duration} days` : ''}
- price: ${priceText}
- highlights: ${(p.product_highlights ?? []).slice(0, 3).join(', ')}` : ''}

## Style
Use style=${style}.
- personal_story: first-person operator note with one specific observation.
- info_list: numbered checklist with practical details.
- question: start with a real question that invites replies.
- behind_the_scene: explain why this route/product is getting attention.

## Rules
- main must be <= 500 chars and strong in the first line.
- thread is 0-4 follow-ups, each <= 500 chars.
- Prefer 3-4 thread entries when useful.
- hashtags 0-3 only.
- Use at most 6 emoji across main+thread.
- Pick one cta_type: dm_keyword, reply_question, profile_link, none.
- Use learned trend/style signals as direction only. Do not copy sample lines.
- Output JSON only.

## Output JSON
{
  "main": "first Threads post",
  "thread": ["2/N follow-up", "3/N detail", "4/N CTA"],
  "hashtags": ["#travel"],
  "cta_type": "dm_keyword",
  "why_this_will_work": "brief reason this should work",
  "trend_sources": [],
  "predicted_er": 0,
  "risk_flags": [],
  "learning_mode": "fallback_curated",
  "trend_confidence": 0
}`;
}

function formatPriceChipSimple(price: number): string {
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    const cheon = Math.round((price % 10000) / 1000);
    return cheon === 0 ? `${man}만원~` : `${man}만${cheon}천원~`;
  }
  return `${price.toLocaleString()}원`;
}

function fallbackThreadsPost(
  input: ThreadsPostInput,
  trendSources: ThreadsPost['trend_sources'] = [],
  learningMode: ThreadsPost['learning_mode'] = 'fallback_curated',
  trendConfidence = 0.15,
): ThreadsPost {
  const b = input.brief;
  const p = input.product;
  const dest = p?.destination ?? '여행지';
  const priceText = p?.price ? formatPriceChipSimple(p.price) : '상담가';

  const main = `요즘 ${dest} 문의가 다시 늘고 있어서, 실제 상담할 때 제일 먼저 보는 포인트를 정리해봤습니다.\n\n가격은 ${priceText} 기준으로 보되, 항공/숙소/일정 포함 범위를 같이 봐야 손해가 적습니다.`;

  const thread = [
    `2/4. 먼저 체크할 것\n- ${b.key_selling_points[0] ?? '핵심 일정'}\n- ${b.key_selling_points[1] ?? '숙소 위치'}\n- ${b.key_selling_points[2] ?? '포함/불포함'}`,
    `3/4. 같은 ${dest} 상품이어도 항공 시간, 이동 동선, 자유시간 비율 때문에 체감 만족도가 크게 갈립니다.`,
    `4/4. 궁금하면 DM으로 "${dest.slice(0, 2) || '여행'}"만 보내주세요. 비교 기준부터 짧게 정리해서 드릴게요.`,
  ];

  const parsed = ThreadsPostSchema.parse({
    main: main.slice(0, 500),
    thread: thread.map((t) => t.slice(0, 500)),
    hashtags: ['#여행', `#${dest}`].slice(0, 2),
    cta_type: 'dm_keyword',
    trend_sources: trendSources,
    learning_mode: learningMode,
    trend_confidence: trendConfidence,
  });
  return enrichThreadsPost(parsed, trendSources, learningMode, trendConfidence);
}
