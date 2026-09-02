import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { promotePendingTopics } from '@/lib/programmatic-seo';

/**
 * Compatibility entrypoint for the former standalone programmatic generator.
 * Candidate selection, demand proof, source coverage, representative dedup and
 * queue writes are owned by promotePendingTopics() so every caller uses the
 * same fail-closed contract.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_BATCH_DEFAULT = 8;
const MAX_BATCH_HARD = 30;

function clampBatch(raw: string | null): number {
  if (!raw) return MAX_BATCH_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return MAX_BATCH_DEFAULT;
  return Math.min(MAX_BATCH_HARD, Math.max(1, Math.round(value)));
}

async function runGenerator(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return { skipped: true, reason: 'Supabase 미설정' };
  const startedAt = Date.now();

  const { data: policyRows, error: policyError } = await supabaseAdmin
    .from('publishing_policies')
    .select('enabled')
    .eq('scope', 'global')
    .limit(1);
  if (policyError) {
    return { processed: 0, queued: 0, failed: 1, errors: [`policy lookup failed: ${policyError.message}`] };
  }
  if (policyRows?.[0]?.enabled === false) {
    return {
      skipped: true,
      reason: 'publishing_policies.global.enabled=false',
      processed: 0,
      queued: 0,
      failed: 0,
      errors: [],
    };
  }

  const result = await promotePendingTopics({
    limit: clampBatch(request.nextUrl.searchParams.get('limit')),
  });
  return {
    processed: result.promoted,
    queued: result.promoted,
    dropped: 0,
    failed: result.errors.length > 0 ? 1 : 0,
    ...result,
    results: [],
    elapsed_ms: Date.now() - startedAt,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('programmatic-seo-generator', runGenerator);
export const POST = withCronLogging('programmatic-seo-generator', runGenerator);
