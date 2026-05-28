import { NextRequest, NextResponse } from 'next/server';
import { successResponse, ApiErrors } from '@/lib/api-response';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

/** GET /api/customers/[id]/mileage-history */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    if (!isSupabaseConfigured) return successResponse({ history: [] });

    const { data, error } = await supabaseAdmin
      .from('mileage_history')
      .select('id, delta, reason, balance_after, created_at')
      .eq('customer_id', params.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    return successResponse({ history: data || [] });
  } catch (err) {
    console.error('[GET /api/customers/[id]/mileage-history] 오류:', err);
    return ApiErrors.internalError(err instanceof Error ? err.message : '마일리지 이력 조회 실패');
  }
}

/**
 * POST /api/customers/[id]/mileage-history
 * 수동 마일리지 조정 (CS용)
 * body: { delta: number, reason: string }
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
  const custRow = cust as { mileage: number | null } | null;

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const currentMileage = custRow?.mileage ?? 0;
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
