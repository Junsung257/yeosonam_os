import { NextRequest } from 'next/server';

import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { maybeSkipNonCriticalCron } from '@/lib/cron-resource-saver';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { runUploadToOpenAutopilot } from '@/lib/product-registration/upload-to-open-autopilot';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { GET as unmatchedOrchestratorGet } from '../unmatched-orchestrator/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function intParam(request: NextRequest, name: string, fallback: number, min: number, max: number): number {
  const raw = Number(request.nextUrl.searchParams.get(name) ?? fallback);
  return Number.isFinite(raw) ? Math.max(min, Math.min(max, Math.floor(raw))) : fallback;
}

function csvParam(request: NextRequest, name: string): string[] {
  return (request.nextUrl.searchParams.get(name) ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function boolParam(request: NextRequest, name: string, fallback: boolean): boolean {
  const raw = request.nextUrl.searchParams.get(name);
  if (raw == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function scopedUnmatchedRequest(request: NextRequest): NextRequest {
  const url = new URL('/api/cron/unmatched-orchestrator', request.nextUrl.origin);
  const limit = request.nextUrl.searchParams.get('entityLimit') ?? request.nextUrl.searchParams.get('limit') ?? '50';
  url.searchParams.set('limit', limit);
  url.searchParams.set('force', request.nextUrl.searchParams.get('force') ?? 'true');
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret) url.searchParams.set('secret', secret);
  return new NextRequest(url, {
    headers: request.headers,
  });
}

async function handleUploadToOpenAutopilot(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  const resourceSaver = maybeSkipNonCriticalCron(request, 'upload-to-open-autopilot');
  if (resourceSaver) return resourceSaver;

  if (!isSupabaseConfigured) {
    return { ok: false, errors: ['Supabase is not configured'], scanned: 0, opened: 0 };
  }

  const errors: string[] = [];
  const unmatchedPasses = intParam(request, 'entityPasses', 2, 0, 3);
  const unmatchedSteps = [];

  for (let pass = 0; pass < unmatchedPasses; pass += 1) {
    try {
      const response = await unmatchedOrchestratorGet(scopedUnmatchedRequest(request));
      const body = await response.json().catch(() => null);
      unmatchedSteps.push({ pass: pass + 1, ok: response.ok && body?.ok !== false, status: response.status, body });
      if (!response.ok || body?.ok === false) {
        errors.push(`unmatched-orchestrator pass ${pass + 1} failed`);
        break;
      }
    } catch (error) {
      errors.push(sanitizeDbError(error, `unmatched-orchestrator pass ${pass + 1} failed`));
      break;
    }
  }

  const packageIds = [
    ...csvParam(request, 'packageIds'),
    ...csvParam(request, 'packageId'),
  ];
  const status = csvParam(request, 'status');
  const catalogGroupId = request.nextUrl.searchParams.get('catalogGroupId')?.trim() || null;
  const autoOpen = boolParam(request, 'autoOpen', true);
  const limit = intParam(request, 'limit', 10, 1, 50);

  const result = await runUploadToOpenAutopilot({
    supabase: supabaseAdmin,
    isSupabaseConfigured,
    options: {
      packageIds,
      catalogGroupId,
      status,
      limit,
      autoOpen,
    },
  });

  return {
    stage: 'upload_to_open_autopilot',
    unmatched_passes: unmatchedSteps,
    ...result,
    ok: errors.length === 0 && result.ok,
    errors: [...errors, ...result.errors].slice(0, 20),
  };
}

export const GET = withCronLogging('upload-to-open-autopilot', handleUploadToOpenAutopilot, {
  handlerTimeoutMs: 240_000,
  sideEffectTimeoutMs: 3_000,
});
