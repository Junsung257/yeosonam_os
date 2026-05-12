import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getAdminContext } from '@/lib/admin-context';

/**
 * POST /api/payments/settlement-confirm
 *
 * settlement 상태 'pending' → 'confirmed' 전이 (회계 마감 흐름).
 * 재무 마감 후에는 reverse 가능 여부에 영향 없음 — 단순 라벨링.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }
  const { settlementId } = body as { settlementId: string };
  if (!settlementId) {
    return NextResponse.json({ error: 'settlementId 필수' }, { status: 400 });
  }

  const ctx = getAdminContext(req);

  try {
    const { data, error } = await supabaseAdmin
      .from('land_settlements')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: ctx.actor,
      })
      .eq('id', settlementId)
      .eq('status', 'pending')
      .select('id, status')
      .limit(1);

    if (error) throw error;
    const row = (data as any[] | null)?.[0];
    if (!row) {
      return NextResponse.json(
        { error: 'pending 상태가 아니거나 settlement 없음' },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, settlement: row });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'confirm 실패' },
      { status: 500 },
    );
  }
}
