import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { processProductRegistrationV4ExtractionJob } from '@/lib/product-registration-v4/extractions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const postHandler = async (_request: NextRequest, context?: { params: Promise<{ jobId: string }> | { jobId: string } }) => {
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
    const result = await processProductRegistrationV4ExtractionJob({ supabase: supabaseAdmin, jobId });
    return NextResponse.json({ success: true, job: result.job, extraction: { id: result.extraction.id, summary: { pages: result.documentIr.pages, nodes: result.documentIr.nodes.length, tables: result.documentIr.tables.length, chars: result.documentIr.text.length } } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Product Registration V4] extraction failed:', message);
    return NextResponse.json({ success: false, code: 'EXTRACTION_FAILED', error: message }, { status: 502 });
  }
};

export const POST = withAdminGuard(postHandler);
