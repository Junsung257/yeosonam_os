import { NextRequest, NextResponse } from 'next/server';
import {
  buildAdOsSafePipelineSteps,
  isAdOsSafePipelineKey,
  type AdOsSafePipelineKey,
  type AdOsSafePipelineStep,
} from '@/lib/ad-os-safe-pipelines';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type StepResult = {
  key: string;
  url: string;
  ok: boolean;
  status: number;
  run_id?: unknown;
  summary?: unknown;
};

function buildInternalHeaders(request: NextRequest): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const cookie = request.headers.get('cookie');
  const authorization = request.headers.get('authorization');
  if (cookie) headers.Cookie = cookie;
  if (authorization) headers.Authorization = authorization;
  return headers;
}

async function executeStep(request: NextRequest, step: AdOsSafePipelineStep): Promise<StepResult> {
  const response = await fetch(new URL(step.url, request.url), {
    method: 'POST',
    headers: buildInternalHeaders(request),
    body: JSON.stringify(step.body),
    cache: 'no-store',
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) {
    throw new Error(String(json?.error || `${step.key} failed with status ${response.status}`));
  }
  return {
    key: step.key,
    url: step.url,
    ok: true,
    status: response.status,
    run_id: json?.run_id,
    summary: json?.summary,
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const pipeline = body.pipeline || body.pipeline_key || body.pipelineKey;
  if (!isAdOsSafePipelineKey(pipeline)) {
    return NextResponse.json({
      ok: false,
      error: 'Unsupported safe pipeline.',
      supported: ['google', 'conversion', 'optimization', 'meta_creative'] satisfies AdOsSafePipelineKey[],
    }, { status: 400 });
  }

  const steps = buildAdOsSafePipelineSteps(pipeline);
  const results: StepResult[] = [];
  try {
    for (const step of steps) {
      results.push(await executeStep(request, step));
    }
  } catch (error) {
    return NextResponse.json({
      ok: false,
      pipeline,
      completed_steps: results.length,
      failed_step: steps[results.length]?.key || null,
      error: error instanceof Error ? error.message : 'Safe pipeline failed.',
      results,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    pipeline,
    summary: {
      steps: results.length,
      audit_exported: results.some((result) => result.key === 'tenant_audit_export'),
      external_api_write: false,
    },
    results,
  });
});
