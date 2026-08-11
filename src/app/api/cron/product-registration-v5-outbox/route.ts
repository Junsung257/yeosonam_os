import { NextRequest, NextResponse } from 'next/server';

import { withCronGuard } from '@/lib/cron-auth';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { processProductRegistrationV5OutboxBatch } from '@/lib/product-registration-v4/outbox-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

async function handler(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }
  const requested = Number(request.nextUrl.searchParams.get('limit') ?? 5);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 20)) : 5;
  try {
    const processed = await processProductRegistrationV5OutboxBatch({ supabase: supabaseAdmin, limit });
    return NextResponse.json({ success: true, processed, count: processed.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Product Registration V5] outbox worker failed:', error);
    return NextResponse.json({ success: false, code: 'V5_OUTBOX_WORKER_FAILED' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = withCronGuard(handler);
