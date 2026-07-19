import { createClient } from '@supabase/supabase-js';
import type { BlogInformationSourcePolicy } from '../src/lib/blog-information-contract';
import {
  BLOG_INFORMATION_RESEARCH_META_KEY,
  evaluateBlogGenerationResearchReadiness,
  summarizeBlogGenerationResearch,
} from '../src/lib/blog-generation-research';
import { buildSapporoFoodBudgetResearchBundle } from './lib/sapporo-food-budget-research';

const QUEUE_ID = 'f36a41e1-b6c9-48ac-b135-a9d685f51d34';
const CREATIVE_ID = '4c5e0bf9-5dd9-49f5-9bf7-055c6a2d4e0c';
const EXPECTED_SLUG = 'sapporo-food-budget';
const FOOD_POLICY: BlogInformationSourcePolicy = {
  minimumClaimSourceCoverage: 0.9,
  primarySourcesRequired: false,
  exactNumbersRequireSource: true,
  retrievedAtRequired: true,
  sourceTypes: ['official', 'field_research', 'reputable_local_source', 'reputable_price_source'],
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const run = process.argv.includes('--run');
  if (run && !apply) throw new Error('--run requires --apply');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing production Supabase URL or service-role key.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: queue, error: queueError } = await supabase
    .from('blog_topic_queue')
    .select('*')
    .eq('id', QUEUE_ID)
    .maybeSingle();
  if (queueError || !queue) throw new Error(queueError?.message || 'Canary queue row not found.');

  const { data: creative, error: creativeError } = await supabase
    .from('content_creatives')
    .select('id,slug,status,channel,generation_meta,updated_at')
    .eq('id', CREATIVE_ID)
    .maybeSingle();
  if (creativeError || !creative) throw new Error(creativeError?.message || 'Canary creative not found.');

  const meta = queue.meta && typeof queue.meta === 'object' ? queue.meta as Record<string, unknown> : {};
  const regeneration = meta.private_regeneration as Record<string, unknown> | undefined;
  const safeTarget = queue.content_creative_id === CREATIVE_ID
    && creative.id === CREATIVE_ID
    && creative.slug === EXPECTED_SLUG
    && creative.status === 'draft'
    && creative.channel === 'naver_blog'
    && regeneration?.mode === 'replace_existing_fallback_draft'
    && regeneration?.force_private_review === true;
  if (!safeTarget) throw new Error('Canary target contract does not match; no write was attempted.');

  const checkedAt = new Date();
  const bundle = buildSapporoFoodBudgetResearchBundle(checkedAt);
  const readiness = evaluateBlogGenerationResearchReadiness({
    meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle },
    expectedContentKey: EXPECTED_SLUG,
    destination: '삿포로',
    intent: 'food_budget',
    locale: 'ko-KR',
    sourcePolicy: FOOD_POLICY,
    now: checkedAt,
  });
  if (!readiness.passed) {
    throw new Error(`Research preflight failed: ${readiness.issues.join(', ')}`);
  }

  console.log(JSON.stringify({
    mode: apply ? (run ? 'apply-and-run' : 'apply') : 'dry-run',
    queueId: QUEUE_ID,
    creativeId: CREATIVE_ID,
    creativeStatus: creative.status,
    queueStatus: queue.status,
    research: summarizeBlogGenerationResearch(readiness),
  }, null, 2));

  if (apply) {
    const { error: updateError } = await supabase
      .from('blog_topic_queue')
      .update({
        status: 'queued',
        last_error: null,
        meta: {
          ...meta,
          self_heal_blocked: false,
          private_regeneration_blocked: false,
          [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle,
          research_canary_prepared_at: checkedAt.toISOString(),
        },
      })
      .eq('id', QUEUE_ID)
      .eq('content_creative_id', CREATIVE_ID);
    if (updateError) throw new Error(`Failed to prepare canary queue: ${updateError.message}`);
  }

  if (run) {
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL
      || process.env.NEXT_PUBLIC_SITE_URL
      || 'https://www.yeosonam.com').replace(/\/$/, '');
    if (!process.env.CRON_SECRET) throw new Error('Missing CRON_SECRET.');
    const response = await fetch(`${baseUrl}/api/cron/blog-publisher?force=true&privateQueueId=${QUEUE_ID}`, {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const body = await response.text();
    console.log(JSON.stringify({ httpStatus: response.status, response: body }, null, 2));
    if (!response.ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
