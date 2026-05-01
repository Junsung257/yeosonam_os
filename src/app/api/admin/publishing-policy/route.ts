import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 발행 정책 관리 API
 *   GET    /api/admin/publishing-policy           → 모든 정책
 *   GET    /api/admin/publishing-policy?scope=X   → 단일
 *   PATCH  /api/admin/publishing-policy           → 부분 업데이트 (scope 필수)
 */

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ items: [] });

  const scope = request.nextUrl.searchParams.get('scope');
  let query = supabaseAdmin.from('publishing_policies').select('*').order('scope', { ascending: true });
  if (scope) query = query.eq('scope', scope);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { scope, ...updates } = body;
    if (!scope) return NextResponse.json({ error: 'scope 필수' }, { status: 400 });

    // 화이트리스트 필드만
    const allowed = [
      'posts_per_day', 'per_destination_daily_cap', 'slot_times',
      'product_ratio', 'enabled', 'multi_angle_count', 'multi_angle_gap_days',
      'auto_trigger_card_news', 'auto_trigger_orchestrator',
      'auto_regenerate_underperformers', 'daily_summary_webhook',
    ];
    const update: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in updates) update[k] = updates[k];
    }

    const { data, error } = await supabaseAdmin
      .from('publishing_policies')
      .update(update)
      .eq('scope', scope)
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ item: data?.[0] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '업데이트 실패' }, { status: 500 });
  }
}
