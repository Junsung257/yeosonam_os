/**
 * /api/capital
 *
 * GET  — 자본금 투입 목록 + 합계
 * POST — 자본금 항목 추가
 * DELETE — 자본금 항목 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { data, error } = await supabaseAdmin
    .from('capital_entries')
    .select('*')
    .order('entry_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const total = (data || []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
  return NextResponse.json({ entries: data || [], total });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const body = await request.json();
  const { amount, note, entry_date } = body;

  if (!amount || amount <= 0)
    return NextResponse.json({ error: 'amount는 양수여야 합니다.' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('capital_entries')
    .insert({
      amount:     Math.round(amount),
      note:       note ?? null,
      entry_date: entry_date ?? new Date().toISOString().slice(0, 10),
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('capital_entries')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
