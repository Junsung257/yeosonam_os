import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { createProductRegistrationV4Job } from '@/lib/product-registration-v4/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }
  const body = await request.json() as {
    sourceDocumentId?: unknown;
    sourceType?: unknown;
    normalizedHash?: unknown;
  };
  if (typeof body.sourceDocumentId !== 'string' || !body.sourceDocumentId.trim()) {
    return NextResponse.json({ success: false, code: 'SOURCE_DOCUMENT_ID_REQUIRED' }, { status: 400 });
  }
  const sourceType = body.sourceType === 'text' ? 'text' : 'file';
  try {
    const job = await createProductRegistrationV4Job({
      supabase: supabaseAdmin,
      sourceType,
      sourceDocumentId: body.sourceDocumentId,
      normalizedHash: typeof body.normalizedHash === 'string' ? body.normalizedHash : null,
    });
    return NextResponse.json({ success: true, job }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Product Registration V4] job create failed:', error);
    return NextResponse.json({ success: false, code: 'REGISTRATION_JOB_CREATE_FAILED', error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
};

export const POST = withAdminGuard(postHandler);
