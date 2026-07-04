import { NextRequest, NextResponse } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReplayState = 'pending' | 'resolved' | 'failed' | 'skipped' | 'unknown';

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function normalizeState(value: unknown): ReplayState {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'resolved' || status === 'replayed') return 'resolved';
  if (status === 'failed') return 'failed';
  if (status === 'skipped') return 'skipped';
  if (status === 'pending' || status === 'review') return 'pending';
  return 'unknown';
}

async function loadPackagesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id,internal_code,title,price,airline,status,departure_days,price_dates,itinerary_data,updated_at')
    .in('id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []).map(row => {
    const priceDates = Array.isArray(row.price_dates) ? row.price_dates : [];
    const days = row.itinerary_data && typeof row.itinerary_data === 'object' && !Array.isArray(row.itinerary_data)
      ? (row.itinerary_data as { days?: unknown }).days
      : null;
    return {
      package_id: row.id,
      short_code: row.internal_code ?? null,
      title: row.title ?? null,
      price: row.price ?? null,
      airline: row.airline ?? null,
      status: row.status ?? null,
      departure_days: row.departure_days ?? null,
      mobile_url: `/packages/${row.id}`,
      lp_url: `/lp/${row.id}`,
      a4_url: `/admin/packages/${row.id}/a4`,
      price_dates_count: priceDates.length,
      itinerary_days_count: Array.isArray(days) ? days.length : 0,
    };
  });
}

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const queueId = request.nextUrl.searchParams.get('queueId')?.trim();
  const uploadRequestId = request.nextUrl.searchParams.get('uploadRequestId')?.trim();
  if (!queueId && !uploadRequestId) {
    return NextResponse.json(
      { success: false, error: 'queueId or uploadRequestId is required.' },
      { status: 400 },
    );
  }

  let query = supabaseAdmin
    .from('upload_review_queue')
    .select('id,status,error_reason,parsed_draft_json,product_title,updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (queueId) {
    query = query.eq('id', queueId);
  } else {
    query = query.ilike('error_reason', `%uploadRequestId=${uploadRequestId}%`);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: true, state: 'unknown', queueId, uploadRequestId }, { status: 200 });
  }

  const draft = asRecord(data.parsed_draft_json);
  const replayResult = asRecord(draft.replayResult);
  const savedIds = stringArray(replayResult.savedIds);
  const duplicateInternalCode = stringValue(replayResult.duplicateInternalCode);
  let packageIds = savedIds;
  if (packageIds.length === 0 && duplicateInternalCode) {
    const { data: duplicateRows, error: duplicateError } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .eq('internal_code', duplicateInternalCode)
      .limit(10);
    if (duplicateError) throw new Error(duplicateError.message);
    packageIds = (duplicateRows ?? []).map(row => row.id).filter(Boolean);
  }
  const registerReport = await loadPackagesByIds(packageIds);
  const replayState = normalizeState(replayResult.status);
  const queueState = normalizeState(data.status);
  const state = replayState === 'unknown' ? queueState : replayState;

  return NextResponse.json({
    success: true,
    queueId: data.id,
    uploadRequestId: uploadRequestId ?? stringValue(draft.uploadRequestId),
    state,
    title: data.product_title ?? null,
    updatedAt: data.updated_at ?? null,
    savedIds: packageIds,
    duplicateInternalCode,
    registerReport,
    message: replayResult.reason ?? data.error_reason ?? null,
  });
};

export const GET = withAdminGuard(getHandler);
