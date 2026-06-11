import { NextRequest } from 'next/server';
import {
  parseAdOsSafePipelineList,
  type AdOsSafePipelineKey,
} from '@/lib/ad-os-safe-pipelines';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const DEFAULT_CRON_PIPELINES: AdOsSafePipelineKey[] = ['conversion', 'optimization'];

function appUrl(request: NextRequest): string {
  return String(
    getSecret('NEXT_PUBLIC_APP_URL') ||
      getSecret('NEXT_PUBLIC_BASE_URL') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      request.nextUrl.origin,
  ).replace(/\/$/, '');
}

async function runPipeline(request: NextRequest, pipeline: AdOsSafePipelineKey) {
  const adminToken = getSecret('ADMIN_API_TOKEN');
  if (!adminToken) {
    return {
      ok: false,
      pipeline,
      skipped: true,
      error: 'ADMIN_API_TOKEN is required for cron-to-admin Ad OS safe pipeline calls.',
    };
  }

  const response = await fetch(`${appUrl(request)}/api/admin/ad-os/safe-pipelines/run`, {
    method: 'POST',
    headers: {
      'x-admin-token': adminToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pipeline }),
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));
  return {
    ok: response.ok && json?.ok !== false,
    status: response.status,
    pipeline,
    ...json,
  };
}

async function runAdOsSafePipelinesCron(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) {
    return { ok: true, skipped: true, reason: 'Supabase not configured', errors: [] as string[] };
  }

  const selected = parseAdOsSafePipelineList(
    request.nextUrl.searchParams.get('pipelines') || getSecret('AD_OS_SAFE_PIPELINE_CRON_PIPELINES'),
    DEFAULT_CRON_PIPELINES,
  );
  const results = [];
  const errors: string[] = [];

  for (const pipeline of selected) {
    try {
      const result = await runPipeline(request, pipeline);
      results.push(result);
      if (!result.ok) errors.push(`${pipeline}: ${String(result.error || 'safe pipeline failed')}`);
    } catch (error) {
      const message = sanitizeDbError(error, `${pipeline} safe pipeline failed`);
      results.push({ ok: false, pipeline, error: message });
      errors.push(`${pipeline}: ${message}`);
    }
  }

  return {
    ok: errors.length === 0,
    pipelines: selected,
    results,
    safety: {
      external_api_write: false,
      live_publish_enabled: false,
      approval_required_for_external_execution: true,
    },
    ran_at: new Date().toISOString(),
    errors,
  };
}

export const GET = withCronLogging('ad-os-safe-pipelines', runAdOsSafePipelinesCron);
