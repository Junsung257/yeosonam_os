import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { startProductRegistrationWorkflowBySourceId } from '@/lib/product-registration-authority/start-workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }
  const body = await request.json() as {
    sourceDocumentId?: unknown;
  };
  if (typeof body.sourceDocumentId !== 'string' || !body.sourceDocumentId.trim()) {
    return NextResponse.json({ success: false, code: 'SOURCE_DOCUMENT_ID_REQUIRED' }, { status: 400 });
  }
  try {
    const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? request.nextUrl.origin;
    const started = await startProductRegistrationWorkflowBySourceId({
      supabase: supabaseAdmin,
      sourceDocumentId: body.sourceDocumentId,
      requestBaseUrl: request.nextUrl.origin,
      publicBaseUrl,
      sourceChannel: 'admin-job',
    });
    return NextResponse.json({
      success: true,
      code: 'PRODUCT_REGISTRATION_WORKFLOW_ACCEPTED',
      ...started,
      state: 'processing',
    }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Product Registration V4] job create failed:', error);
    return NextResponse.json({ success: false, code: 'REGISTRATION_JOB_CREATE_FAILED', error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
};

export const POST = withAdminGuard(postHandler);
