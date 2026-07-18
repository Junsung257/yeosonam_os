/**
 * /api/capital
 *
 * GET  — 자본금 투입 목록 + 합계
 * POST — 자본금 항목 추가
 * DELETE — 자본금 항목 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500, headers: NO_STORE_HEADERS });

  const { searchParams } = new URL(request.url);
  const summaryOnly = searchParams.get('summary') === '1';
  if (summaryOnly) {
    const { data, error } = await supabaseAdmin.rpc('get_capital_total');

    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });

    return NextResponse.json(data ?? { entries: [], total: 0 }, { headers: NO_STORE_HEADERS });
  }

  const { data, error } = await supabaseAdmin
    .from('capital_entries')
    .select('*')
    .order('entry_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });

  const total = (data || []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  return NextResponse.json({ entries: data || [], total }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500, headers: NO_STORE_HEADERS });

  const body = await request.json();
  const { amount, note, entry_date } = body;

  if (!amount || amount <= 0)
    return NextResponse.json({ error: 'amount는 양수여야 합니다.' }, { status: 400, headers: NO_STORE_HEADERS });

  const { data, error } = await supabaseAdmin
    .from('capital_entries')
    .insert({
      amount:     Math.round(amount),
      note:       note ?? null,
      entry_date: entry_date ?? new Date().toISOString().slice(0, 10),
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  return NextResponse.json({ entry: data }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500, headers: NO_STORE_HEADERS });

  const { searchParams } = new URL(request.url);
  const queryId = searchParams.get('id');
  const body = queryId ? null : await request.json();
  const id = queryId ?? body?.id;
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400, headers: NO_STORE_HEADERS });

  const { error } = await supabaseAdmin
    .from('capital_entries')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
}
