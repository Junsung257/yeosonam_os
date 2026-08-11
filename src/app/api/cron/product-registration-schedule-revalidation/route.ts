import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { processProductRegistrationScheduleRevalidations } from '@/lib/product-registration-v6/schedule-revalidation';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  const client = getSupabaseAdmin();
  if (!client) return NextResponse.json({ ok: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  const limit = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 10), 50));
  try {
    const result = await processProductRegistrationScheduleRevalidations({
      supabase: client as SupabaseClient,
      workerId: `schedule-revalidation:${randomUUID()}`,
      limit,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: 'PRODUCT_REGISTRATION_SCHEDULE_REVALIDATION_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
