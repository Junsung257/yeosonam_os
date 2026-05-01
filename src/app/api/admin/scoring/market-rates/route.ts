import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  const dest = req.nextUrl.searchParams.get('destination');
  let q = supabaseAdmin
    .from('optional_tour_market_rates')
    .select('*')
    .order('destination', { ascending: true, nullsFirst: true })
    .order('tour_name', { ascending: true })
    .limit(500);
  if (dest) q = q.eq('destination', dest);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rates: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  let body: { tour_name?: string; destination?: string | null; market_rate_krw?: number; notes?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const tour_name = (body.tour_name ?? '').trim();
  const market_rate_krw = body.market_rate_krw;
  if (!tour_name) return NextResponse.json({ error: 'tour_name 필수' }, { status: 400 });
  if (typeof market_rate_krw !== 'number' || !Number.isFinite(market_rate_krw) || market_rate_krw < 0) {
    return NextResponse.json({ error: 'market_rate_krw 형식 오류' }, { status: 400 });
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
    .select().limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rate: data?.[0] });
}
