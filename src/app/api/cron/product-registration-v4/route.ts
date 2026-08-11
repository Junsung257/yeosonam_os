import { NextRequest, NextResponse } from 'next/server';

import { withCronGuard } from '@/lib/cron-auth';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  claimNextProductRegistrationV4Job,
  claimNextProductRegistrationV4NormalizationJob,
} from '@/lib/product-registration-v4/jobs';
import { processProductRegistrationV4ExtractionJob } from '@/lib/product-registration-v4/extractions';
import { processProductRegistrationV4CanonicalNormalizationJob } from '@/lib/product-registration-v4/canonical-worker';
import { getProductRegistrationV6RuntimeConfig } from '@/lib/product-registration-v6/runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handler(request: NextRequest): Promise<NextResponse> {
  if (getProductRegistrationV6RuntimeConfig().workflowEnabled) {
    return NextResponse.json({
      success: true,
      skipped: true,
      code: 'PRODUCT_REGISTRATION_V4_CRON_DISABLED_BY_V6_WORKFLOW',
      processed: [],
      count: 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }
  const requested = Number(request.nextUrl.searchParams.get('limit') ?? 3);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 10)) : 3;
  const processed: Array<Record<string, unknown>> = [];

  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimNextProductRegistrationV4Job({ supabase: supabaseAdmin, leaseSeconds: 240 });
    if (claimed) {
      try {
        const result = await processProductRegistrationV4ExtractionJob({ supabase: supabaseAdmin, jobId: claimed.id });
        processed.push({ jobId: claimed.id, stage: 'extracted', ok: true, extractionId: result.extraction.id });
      } catch (error) {
        processed.push({ jobId: claimed.id, stage: 'extraction', ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }

    const normalizationJob = await claimNextProductRegistrationV4NormalizationJob({ supabase: supabaseAdmin, leaseSeconds: 240 });
    if (!normalizationJob) break;
    try {
      const result = await processProductRegistrationV4CanonicalNormalizationJob({
        supabase: supabaseAdmin,
        job: normalizationJob,
      });
      processed.push({
        jobId: normalizationJob.id,
        stage: 'normalized',
        ok: true,
        normalizationId: result.normalizationId,
        sectionCount: result.normalization.qualityDiagnostics.sectionCount,
      });
    } catch (error) {
      processed.push({ jobId: normalizationJob.id, stage: 'normalization', ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return NextResponse.json({ success: true, processed, count: processed.length }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withCronGuard(handler);
