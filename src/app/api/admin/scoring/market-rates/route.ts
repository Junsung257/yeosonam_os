import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';

export const dynamic = 'force-dynamic';

const getHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });

  const dest = req.nextUrl.searchParams.get('destination');
  let q = supabaseAdmin
    .from('optional_tour_market_rates')
    .select('*')
    .order('destination', { ascending: true, nullsFirst: true })
    .order('tour_name', { ascending: true })
    .limit(500);

  if (dest) q = q.eq('destination', dest);

  const { data, error } = await q;
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  return apiResponse({ rates: data ?? [] });
};

const postHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });

  let body: { tour_name?: string; destination?: string | null; market_rate_krw?: number; notes?: string };
  try {
    body = await req.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const tour_name = (body.tour_name ?? '').trim();
  const market_rate_krw = body.market_rate_krw;

  if (!tour_name) return apiResponse({ error: 'TOUR_NAME_REQUIRED' }, { status: 400 });
  if (typeof market_rate_krw !== 'number' || !Number.isFinite(market_rate_krw) || market_rate_krw < 0) {
    return apiResponse({ error: 'INVALID_MARKET_RATE' }, { status: 400 });
  }

  const row = {
    tour_name,
    destination: body.destination?.trim() || null,
    market_rate_krw: Math.round(market_rate_krw),
    source: 'manual',
    notes: body.notes ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('optional_tour_market_rates')
    .upsert(row, { onConflict: 'tour_name,destination' })
    .select()
    .limit(1);

  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  return apiResponse({ rate: data?.[0] });
};

export const GET = withAdminGuard(getHandler);

export const POST = withAdminGuard(postHandler);
