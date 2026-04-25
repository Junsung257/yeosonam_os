/**
 * @file src/app/api/card-news/generate-variants/route.ts
 *
 * Variant Generator — 한 상품 → N장 카드뉴스 변형 동시 생성.
 * AdCreative.ai / Pencil AI 의 Multi-Variant Testing 패턴.
 *
 * 작동:
 *   1. 같은 원문 + 다른 angle (luxury/value/urgency/...) 로 N번 병렬 호출
 *   2. 각 결과에 자동 사실 검증 (regex)
 *   3. 각 결과에 Cover Critic (Haiku 4.5) 자동 점수 (0-100)
 *   4. 같은 variant_group_id 로 묶어서 DB 저장
 *
 * Body:
 *   {
 *     rawText: string,
 *     productMeta?: {...},
 *     count?: number = 5,
 *     angles?: string[],     // 명시 안 하면 자동 분배
 *     toneHint?: string,
 *     package_id?: string,
 *     title?: string,
 *     skipCritic?: boolean   // critic 비용 절감 옵션
 *   }
 *
 * Response:
 *   {
 *     variant_group_id: string,
 *     variants: [
 *       { card_news_id, variant_angle, variant_score, html, faithfulness, costUsd }
 *     ],
 *     totalCostUsd: number,
 *     durationMs: number
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { generateCardNewsHtml, type GenerateInput } from '@/lib/card-news-html/generate';
import { critiqueHtmlCarousel } from '@/lib/card-news-html/critic';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withRetry } from '@/lib/llm-retry';

export const runtime = 'nodejs';
export const maxDuration = 600; // 5병렬 + critic = 최대 5분

/**
 * Anthropic API 동시성 보호.
 * Sonnet 4.6 OTPM=16k 기준, max_tokens=40k × 7병렬 시 OTPM 한도 초과 위험.
 * 3개씩 슬라이딩 배치로 안전 마진 확보 + 캐시 hit 유도 (첫 3개 cache write 후 나머지 cache read).
 */
const VARIANT_CONCURRENCY = 3;

async function processInBatches<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const settled = await Promise.allSettled(
      batch.map((item, j) => fn(item, i + j)),
    );
    results.push(...settled);
  }
  return results;
}

const ALL_ANGLES: GenerateInput['angleHint'][] = [
  'luxury',
  'value',
  'urgency',
  'emotional',
  'filial',
  'activity',
  'food',
];

const DEFAULT_5_ANGLES: GenerateInput['angleHint'][] = [
  'luxury',
  'value',
  'urgency',
  'emotional',
  'activity',
];

interface RequestBody {
  rawText: string;
  productMeta?: GenerateInput['productMeta'];
  count?: number;
  angles?: GenerateInput['angleHint'][];
  toneHint?: string;
  package_id?: string | null;
  title?: string;
  skipCritic?: boolean;
  brandCode?: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 미설정' }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.rawText?.trim()) {
    return NextResponse.json({ error: 'rawText 필요' }, { status: 400 });
  }

  // 각도 분배
  const count = Math.max(1, Math.min(7, body.count ?? 5));
  const angles: GenerateInput['angleHint'][] = (body.angles?.length
    ? body.angles
    : count === 6
      ? ALL_ANGLES.slice(0, 6)
      : count === 7
        ? ALL_ANGLES
        : DEFAULT_5_ANGLES.slice(0, count)) as GenerateInput['angleHint'][];

  const variantGroupId = randomUUID();
  const baseTitle =
    body.title?.trim() ||
    body.productMeta?.title?.trim() ||
    `변형 그룹 (${new Date().toISOString().slice(0, 10)})`;

  const t0 = Date.now();

  // 한 변형 = generate(retry) → critic → DB INSERT 한 트랜잭션.
  // 이 함수를 VARIANT_CONCURRENCY 만큼 batch 로 돌려 Anthropic OTPM 보호 + Haiku critic 동시성 제한.
  async function processOneVariant(angle: GenerateInput['angleHint']) {
    const genResult = await withRetry(
      () =>
        generateCardNewsHtml({
          rawText: body.rawText,
          productMeta: body.productMeta,
          angleHint: angle,
          toneHint: body.toneHint,
          brandCode: body.brandCode ?? 'yeosonam',
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        label: `variant-${angle ?? 'auto'}`,
      },
    );
    if (!genResult.success) {
      throw genResult.error instanceof Error
        ? genResult.error
        : new Error(String(genResult.error));
    }
    const result = genResult.value;

    let critique: Awaited<ReturnType<typeof critiqueHtmlCarousel>> | null = null;
    let criticError: string | null = null;
    if (!body.skipCritic) {
      try {
        critique = await critiqueHtmlCarousel({
          html: result.html,
          rawText: body.rawText,
          productMeta: { title: body.productMeta?.title, angle },
        });
      } catch (err) {
        criticError = err instanceof Error ? err.message : String(err);
      }
    }

    const { data: insertRow, error: insertErr } = await supabaseAdmin
      .from('card_news')
      .insert({
        title: `${baseTitle} · ${angle ?? 'auto'}`,
        status: 'DRAFT',
        slides: [],
        package_id: body.package_id ?? null,
        card_news_type: body.package_id ? 'product' : 'info',
        html_raw: body.rawText,
        html_generated: result.html,
        html_thinking: result.thinking,
        html_usage: {
          ...result.usage,
          costUsd: result.costUsd,
          model: result.model,
          durationMs: result.durationMs,
          generatedAt: new Date().toISOString(),
        },
        template_version: 'html-v1',
        template_family: 'html',
        variant_group_id: variantGroupId,
        variant_angle: angle ?? null,
        variant_score: critique?.avg_score ?? null,
        variant_score_detail: critique
          ? {
              cards: critique.cards,
              dimensions: critique.dimensions,
              verdict: critique.verdict,
              summary: critique.summary,
              criticUsage: critique.usage,
              criticCostUsd: critique.costUsd,
            }
          : null,
        generation_config: {
          html_mode: {
            angleHint: angle,
            toneHint: body.toneHint ?? null,
            productMeta: body.productMeta ?? null,
          },
        },
      })
      .select('id')
      .single();

    if (insertErr || !insertRow) {
      throw new Error(`DB INSERT 실패: ${insertErr?.message ?? 'unknown'}`);
    }

    return {
      card_news_id: insertRow.id,
      variant_angle: angle,
      variant_score: critique?.avg_score ?? null,
      verdict: critique?.verdict ?? null,
      criticSummary: critique?.summary ?? null,
      faithfulness: result.faithfulness,
      html: result.html,
      thinking: result.thinking,
      usage: result.usage,
      costUsd: result.costUsd + (critique?.costUsd ?? 0),
      durationMs: result.durationMs,
      criticError,
    };
  }

  const settled = await processInBatches(angles, VARIANT_CONCURRENCY, processOneVariant);

  const variantOutputs = settled.map((s, idx) => {
    if (s.status === 'rejected') {
      return {
        angle: angles[idx],
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    }
    return s.value;
  });

  const successVariants = variantOutputs.filter((v) => !('error' in v && v.error));
  const totalCostUsd = successVariants.reduce(
    (sum, v) => sum + ((v as { costUsd?: number }).costUsd ?? 0),
    0,
  );

  return NextResponse.json(
    {
      variant_group_id: variantGroupId,
      variants: variantOutputs,
      success_count: successVariants.length,
      total_count: variantOutputs.length,
      totalCostUsd,
      durationMs: Date.now() - t0,
    },
    { status: 201 },
  );
}

/**
 * GET /api/card-news/generate-variants?group_id=...
 * 같은 그룹의 변형 목록을 조회 (variant_score 내림차순).
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const { searchParams } = request.nextUrl;
  const groupId = searchParams.get('group_id');
  if (!groupId) {
    return NextResponse.json({ error: 'group_id 필요' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('card_news')
    .select(
      'id, title, status, variant_angle, variant_score, variant_score_detail, engagement_score, is_winner, ig_publish_status, ig_slide_urls, html_generated, html_usage, created_at',
    )
    .eq('variant_group_id', groupId)
    .order('variant_score', { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ group_id: groupId, variants: data ?? [] });
}
