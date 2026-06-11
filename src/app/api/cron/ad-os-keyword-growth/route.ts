import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

function appUrl(request: NextRequest): string {
  if (request.nextUrl.origin) return request.nextUrl.origin.replace(/\/$/, '');
  return String(
    getSecret('NEXT_PUBLIC_APP_URL') ||
      getSecret('NEXT_PUBLIC_BASE_URL') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      request.nextUrl.origin,
  ).replace(/\/$/, '');
}

async function postAdminRoute(request: NextRequest, path: string, body: Record<string, unknown>) {
  const adminToken = getSecret('ADMIN_API_TOKEN');
  if (!adminToken) {
    return {
      ok: false,
      skipped: true,
      error: 'ADMIN_API_TOKEN is required for cron-to-admin Ad OS calls.',
    };
  }

  const response = await fetch(`${appUrl(request)}${path}`, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    ...json,
  };
}

async function runAdOsKeywordGrowth(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return { ok: true, skipped: true, reason: 'Supabase not configured', errors: [] as string[] };
  }

  const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';
  const apply = !dryRun;

  try {
    const learningHarvest = await postAdminRoute(request, '/api/admin/ad-os/learning-harvest', {
      mode: apply ? 'guarded' : 'dry_run',
      apply,
      days: 30,
      include_mock_search_terms: false,
    });

    const searchTermGrowth = await postAdminRoute(request, '/api/admin/ad-os/search-term-growth', {
      apply,
      limit: 100,
      platforms: ['naver', 'google'],
      min_keyword_score: 45,
      min_negative_score: 35,
    });

    const errors = [
      learningHarvest.ok ? '' : String(learningHarvest.error || 'learning harvest failed'),
      searchTermGrowth.ok ? '' : String(searchTermGrowth.error || 'search term growth failed'),
    ].filter(Boolean);

    return {
      ok: Boolean(learningHarvest.ok && searchTermGrowth.ok),
      dry_run: dryRun,
      learning_harvest: learningHarvest,
      search_term_growth: searchTermGrowth,
      safety: {
        external_api_write: false,
        external_spend_krw: 0,
        approval_required_for_external_execution: true,
      },
      ran_at: new Date().toISOString(),
      errors,
    };
  } catch (err) {
    return {
      ok: false,
      error: sanitizeDbError(err, 'Ad OS keyword growth cron failed'),
      errors: [sanitizeDbError(err)],
    };
  }
}

export const GET = withCronLogging('ad-os-keyword-growth', runAdOsKeywordGrowth);
