import { NextRequest, NextResponse } from 'next/server';
import { POST as syncClobeTransactions } from '@/app/api/bank-transactions/sync-clobe/route';
import { requireCronBearer } from '@/lib/cron-auth';
import { getSecret } from '@/lib/secret-registry';
import { getScheduledClobeSyncWindow } from '@/lib/settlement-import/clobe-sync-scheduler';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = requireCronBearer(request);
  if (authError) return authError;

  const adminToken = getSecret('ADMIN_API_TOKEN');
  if (!adminToken) {
    return NextResponse.json(
      { success: false, error: 'ADMIN_API_TOKEN is required for scheduled Clobe sync' },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from('bank_transactions')
    .select('received_at')
    .eq('source', 'clobe_mcp')
    .neq('status', 'excluded')
    .is('external_transaction_id', null)
    .order('received_at', { ascending: true })
    .limit(1);

  if (error) {
    return NextResponse.json(
      { success: false, error: `Clobe backfill cursor lookup failed: ${error.message}` },
      { status: 500 },
    );
  }

  const window = getScheduledClobeSyncWindow({
    oldestMissingReceivedAt: data?.[0]?.received_at ?? null,
  });
  const syncRequest = new NextRequest(new URL('/api/bank-transactions/sync-clobe', request.nextUrl.origin), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken,
    },
    body: JSON.stringify({ from: window.from, to: window.to, limit: 1000 }),
  });
  const response = await syncClobeTransactions(syncRequest);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return NextResponse.json(
      { success: false, mode: window.mode, window, error: body.error ?? 'Scheduled Clobe sync failed' },
      { status: response.status },
    );
  }

  return NextResponse.json({
    success: true,
    mode: window.mode,
    window: { from: window.from, to: window.to },
    fetched: body.fetched ?? 0,
    normalized: body.normalized ?? 0,
    inserted: body.inserted ?? 0,
    matched: body.matched ?? 0,
    nonTravelStored: body.nonTravelStored ?? 0,
    merged: body.merged ?? 0,
    duplicates: body.duplicates ?? 0,
    skipped: body.skipped ?? 0,
    errors: body.errors ?? 0,
    normalizeErrors: Array.isArray(body.normalizeErrors) ? body.normalizeErrors.length : 0,
    classificationRefresh: body.classificationRefresh ?? {
      processed: 0,
      review: 0,
      allocationInserted: 0,
      allocationUpdated: 0,
      allocationNonExact: 0,
    },
    postCloseChanges: body.postCloseChanges ?? { checked: 0, changed: 0 },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
