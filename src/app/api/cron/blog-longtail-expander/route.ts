import { NextRequest } from 'next/server';
import { expandGscLongtailTopics } from '@/lib/blog-longtail-expander';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

function parseIntParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

async function runLongtailExpander(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase not configured', errors: [] as string[] };
  }

  const params = request.nextUrl.searchParams;
  const dryRun = params.get('dry_run') === '1' || params.get('dryRun') === 'true';

  try {
    const result = await expandGscLongtailTopics({
      dryRun,
      limit: parseIntParam(params.get('limit'), 8),
      seedLimit: parseIntParam(params.get('seed_limit'), 20),
      lookbackDays: parseIntParam(params.get('lookback_days'), 28),
      maxCandidatesPerSeed: parseIntParam(params.get('max_candidates_per_seed'), 5),
      recentDedupDays: parseIntParam(params.get('recent_dedup_days'), 90),
      minSeedImpressions: parseIntParam(params.get('min_impressions'), 5),
      minSeedClicks: parseIntParam(params.get('min_clicks'), 1),
      maxAvgPosition: parseIntParam(params.get('max_position'), 25),
    });

    return {
      ok: true,
      dry_run: dryRun,
      seeds: result.seeds.slice(0, 10),
      candidates: result.candidates,
      inserted: result.inserted,
      skipped_count: result.skipped.length,
      skipped_sample: result.skipped.slice(0, 10),
      errors: result.errors,
      ranAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: sanitizeDbError(err, 'blog longtail expansion failed'),
      errors: [sanitizeDbError(err)],
    };
  }
}

export const GET = withCronLogging('blog-longtail-expander', runLongtailExpander);
