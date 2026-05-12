import { randomUUID } from 'node:crypto';
import { generateCardNewsHtml, type GenerateInput } from './generate';
import { critiqueHtmlCarousel } from './critic';
import { supabaseAdmin } from '@/lib/supabase';
import { withRetry } from '@/lib/llm-retry';

const VARIANT_CONCURRENCY = 3;
const RETRY_THRESHOLD = 65;

const ALL_ANGLES: GenerateInput['angleHint'][] = [
  'luxury', 'value', 'urgency', 'emotional', 'filial', 'activity', 'food',
];

const DEFAULT_5_ANGLES: GenerateInput['angleHint'][] = [
  'luxury', 'value', 'urgency', 'emotional', 'activity',
];

async function processInBatches<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map((item, j) => fn(item, i + j)));
    results.push(...settled);
  }
  return results;
}

export interface GenerateVariantsJobPayload {
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

export async function executeGenerateVariantsJob(body: GenerateVariantsJobPayload) {
  const count = Math.max(1, Math.min(7, body.count ?? 5));
  const angles: GenerateInput['angleHint'][] = (body.angles?.length
    ? body.angles
    : count === 6
      ? ALL_ANGLES.slice(0, 6)
      : count === 7
        ? ALL_ANGLES
        : DEFAULT_5_ANGLES.slice(0, count)) as GenerateInput['angleHint'][];

  const variantGroupId = randomUUID();
  const baseTitle = body.title?.trim() || body.productMeta?.title?.trim() || `변형 그룹 (${new Date().toISOString().slice(0, 10)})`;
  const t0 = Date.now();

  async function processOneVariant(angle: GenerateInput['angleHint']) {
    const genResult = await withRetry(
      () => generateCardNewsHtml({
        rawText: body.rawText,
        productMeta: body.productMeta,
        angleHint: angle,
        toneHint: body.toneHint,
        brandCode: body.brandCode ?? 'yeosonam',
      }),
      { maxAttempts: 3, baseDelayMs: 2000, label: `variant-${angle ?? 'auto'}` }
    );
    if (!genResult.success) {
      throw genResult.error instanceof Error ? genResult.error : new Error(String(genResult.error));
    }
    let result = genResult.value;

    let critique: Awaited<ReturnType<typeof critiqueHtmlCarousel>> | null = null;
    let criticError: string | null = null;
    let learningRetried = false;

    if (!body.skipCritic) {
      try {
        critique = await critiqueHtmlCarousel({
          html: result.html,
          rawText: body.rawText,
          productMeta: { title: body.productMeta?.title, angle },
        });

        if (critique && critique.avg_score < RETRY_THRESHOLD && critique.verdict === 'regenerate') {
          const dims: Record<string, number> = (critique.dimensions ?? {}) as Record<string, number>;
          const weakDimensions = Object.entries(dims)
            .filter(([, score]) => typeof score === 'number' && score < 60)
            .map(([name]) => name);

          try {
            const retryGen = await generateCardNewsHtml({
              rawText: body.rawText,
              productMeta: body.productMeta,
              angleHint: angle,
              toneHint: body.toneHint,
              brandCode: body.brandCode ?? 'yeosonam',
              previousCritique: { avg_score: critique.avg_score, summary: critique.summary ?? null, weakDimensions },
            });
            const retryCritique = await critiqueHtmlCarousel({
              html: retryGen.html,
              rawText: body.rawText,
              productMeta: { title: body.productMeta?.title, angle },
            });
            
            const retryCriticCost = (retryCritique as { costUsd?: number }).costUsd ?? 0;
            const oldCriticCost = (critique as { costUsd?: number }).costUsd ?? 0;
            
            if (retryCritique.avg_score > critique.avg_score) {
              result = {
                ...retryGen,
                costUsd: result.costUsd + retryGen.costUsd + oldCriticCost,
                durationMs: result.durationMs + retryGen.durationMs,
                usage: {
                  input_tokens: result.usage.input_tokens + retryGen.usage.input_tokens,
                  output_tokens: result.usage.output_tokens + retryGen.usage.output_tokens,
                  cache_creation_input_tokens: result.usage.cache_creation_input_tokens + retryGen.usage.cache_creation_input_tokens,
                  cache_read_input_tokens: result.usage.cache_read_input_tokens + retryGen.usage.cache_read_input_tokens,
                },
              };
              critique = retryCritique;
              learningRetried = true;
            } else {
              result = {
                ...result,
                costUsd: result.costUsd + retryGen.costUsd + retryCriticCost,
                durationMs: result.durationMs + retryGen.durationMs,
              };
            }
          } catch (retryErr) {
            console.warn(`[variant-${angle}] learning retry 실패:`, retryErr);
          }
        }
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
        variant_score_detail: critique ? {
          cards: critique.cards,
          dimensions: critique.dimensions,
          verdict: critique.verdict,
          summary: critique.summary,
          criticUsage: critique.usage,
          criticCostUsd: critique.costUsd,
        } : null,
        generation_config: {
          html_mode: { angleHint: angle, toneHint: body.toneHint ?? null, productMeta: body.productMeta ?? null },
          learning_loop: { retried: learningRetried, retry_threshold: RETRY_THRESHOLD },
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
      learningRetried,
    };
  }

  const settled = await processInBatches(angles, VARIANT_CONCURRENCY, processOneVariant);
  const variantOutputs = settled.map((s, idx) => {
    if (s.status === 'rejected') return { angle: angles[idx], error: s.reason instanceof Error ? s.reason.message : String(s.reason) };
    return s.value;
  });

  const successVariants = variantOutputs.filter((v) => !('error' in v && v.error));
  const totalCostUsd = successVariants.reduce((sum, v) => sum + ((v as { costUsd?: number }).costUsd ?? 0), 0);

  return {
    variant_group_id: variantGroupId,
    variants: variantOutputs,
    success_count: successVariants.length,
    total_count: variantOutputs.length,
    totalCostUsd,
    durationMs: Date.now() - t0,
  };
}
