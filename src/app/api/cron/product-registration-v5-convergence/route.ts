import { NextRequest, NextResponse } from 'next/server';

import { withCronGuard } from '@/lib/cron-auth';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { observeProductRegistrationV5ConvergenceBatch } from '@/lib/product-registration-v4/convergence-observer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

async function handler(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ success: false, code: 'SUPABASE_ADMIN_UNAVAILABLE' }, { status: 503 });
  }

  const requested = Number(request.nextUrl.searchParams.get('limit') ?? 10);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 50)) : 10;
  const snapshotHashes = [
    ...request.nextUrl.searchParams.getAll('snapshot_hash'),
    ...request.nextUrl.searchParams.getAll('snapshotHash'),
  ];
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || 'https://www.yeosonam.com'
  ).replace(/\/+$/, '');

  try {
    const observed = await observeProductRegistrationV5ConvergenceBatch({
      supabase: supabaseAdmin,
      baseUrl,
      limit,
      snapshotHashes,
    });
    return NextResponse.json(
      {
        success: true,
        baseUrl,
        observed,
        count: observed.length,
        summary: {
          converged: observed.filter(row => row.status === 'converged').length,
          stale: observed.filter(row => row.status === 'stale').length,
          failed: observed.filter(row => row.status === 'failed').length,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[Product Registration V5] convergence observer failed:', error);
    return NextResponse.json(
      { success: false, code: 'V5_CONVERGENCE_OBSERVER_FAILED' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export const GET = withCronGuard(handler);
