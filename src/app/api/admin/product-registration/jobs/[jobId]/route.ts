import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { getProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (_request: NextRequest, context?: { params: Promise<{ jobId: string }> | { jobId: string } }) => {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }
  const params = context?.params;
  const resolved = params && typeof (params as Promise<unknown>).then === 'function'
    ? await params as { jobId: string }
    : params as { jobId: string } | undefined;
  const jobId = resolved?.jobId;
  if (!jobId) return NextResponse.json({ success: false, code: 'JOB_ID_REQUIRED' }, { status: 400 });
  try {
    const job = await getProductRegistrationV4Job({ supabase: supabaseAdmin, jobId });
    if (!job) return NextResponse.json({ success: false, code: 'JOB_NOT_FOUND' }, { status: 404 });
    let v5: Record<string, unknown> | null = null;
    if (process.env.PRODUCT_REGISTRATION_V5_SHADOW === '1') {
      const { data: normalizations, error: normalizationError } = await supabaseAdmin
        .from('product_registration_v4_normalizations')
        .select('id, status, normalization_version, raw_text_hash, quality_diagnostics, created_at')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (normalizationError) {
        console.warn('[Product Registration V4] normalization summary unavailable:', normalizationError.message);
      }
      const { data: revisions, error: revisionError } = await supabaseAdmin
        .from('product_registration_v5_revisions')
        .select('id, package_id, status, revision_no, schema_version, normalization_version, payload_hash, lineage_hash, created_at')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (revisionError) {
        // The shadow flag can be enabled before the migration reaches a
        // preview environment; keep the existing V4 job monitor usable.
        console.warn('[Product Registration V5] revision summary unavailable:', revisionError.message);
      } else {
        const rows = Array.isArray(revisions) ? revisions : [];
        v5 = {
          revisionCount: rows.length,
          latestRevision: rows[0] ?? null,
          revisions: rows,
          latestNormalization: Array.isArray(normalizations) ? normalizations[0] ?? null : null,
        };
      }
    }
    return NextResponse.json({ success: true, job, v5 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Product Registration V4] job read failed:', error);
    return NextResponse.json({ success: false, code: 'REGISTRATION_JOB_READ_FAILED' }, { status: 502 });
  }
};

export const GET = withAdminGuard(getHandler);
