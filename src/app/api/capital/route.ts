/**
 * /api/capital
 *
 * GET    — 자본금 투입 목록 + 합계
 * POST   — 자본금 항목 추가
 * DELETE — 자본금 항목 삭제
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { validateRequest, IsoDateSchema, UuidSchema } from '@/lib/api-validation';

const CapitalCreateSchema = z.object({
  amount: z.number().int().positive().max(10_000_000_000),
  note: z.string().max(500).optional().nullable(),
  entry_date: IsoDateSchema.optional(),
});

const CapitalDeleteSchema = z.object({
  id: UuidSchema,
});

export async function GET() {
  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  try {
    const { data, error } = await supabaseAdmin
      .from('capital_entries')
      .select('*')
      .order('entry_date', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const total = (data || []).reduce((s: number, e: any) => s + (e.amount ?? 0), 0);
    return NextResponse.json({ entries: data || [], total });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const validation = await validateRequest(request, CapitalCreateSchema);
  if (!validation.success) return validation.response;
  const { amount, note, entry_date } = validation.data;

  try {
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
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '생성 실패' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured)
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const validation = await validateRequest(request, CapitalDeleteSchema);
  if (!validation.success) return validation.response;
  const { id } = validation.data;

  try {
    const { error } = await supabaseAdmin
      .from('capital_entries')
      .delete()
      .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '삭제 실패' },
      { status: 500 },
    );
  }
}
