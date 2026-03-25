import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

/** GET /api/customers/[id]/mileage-history */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ history: [] });

  const { data, error } = await supabaseAdmin
    .from('mileage_history')
    .select('*')
    .eq('customer_id', params.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data || [] });
}

/**
 * POST /api/customers/[id]/mileage-history
 * 수동 마일리지 조정 (CS용)
 * body: { delta: number, reason: string }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });

  const { delta, reason } = await req.json();
  if (typeof delta !== 'number' || delta === 0)
    return NextResponse.json({ error: 'delta(숫자)가 필요합니다.' }, { status: 400 });
  if (!reason?.trim())
    return NextResponse.json({ error: 'reason이 필요합니다.' }, { status: 400 });

  const { data: cust, error: fetchErr } = await supabaseAdmin
    .from('customers')
    .select('mileage')
    .eq('id', params.id)
    .single();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const currentMileage = (cust as any)?.mileage ?? 0;
  const newMileage = Math.max(0, currentMileage + delta);

  await supabaseAdmin
    .from('customers')
    .update({ mileage: newMileage, updated_at: new Date().toISOString() })
    .eq('id', params.id);

  const { data: hist, error: histErr } = await supabaseAdmin
    .from('mileage_history')
    .insert([{ customer_id: params.id, delta, reason: reason.trim(), balance_after: newMileage }])
    .select()
    .single();

  if (histErr) return NextResponse.json({ error: histErr.message }, { status: 500 });
  return NextResponse.json({ history: hist, mileage: newMileage });
}
