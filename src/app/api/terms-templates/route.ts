import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { invalidateTermsCache } from '@/lib/standard-terms';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });

  try {
    const { searchParams } = request.nextUrl;
    const tier = searchParams.get('tier');
    const landOperatorId = searchParams.get('land_operator_id');
    const includeInactive = searchParams.get('include_inactive') === 'true';

    let query = supabaseAdmin
      .from('terms_templates')
      .select('*')
      .eq('is_current', true)
      .order('tier', { ascending: true })
      .order('priority', { ascending: true });

    if (!includeInactive) query = query.eq('is_active', true);
    if (tier) query = query.eq('tier', Number(tier));
    if (landOperatorId) query = query.contains('scope', { land_operator_id: landOperatorId });

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { name, tier, scope, notices, priority, starts_at, ends_at, notes } = body;

    if (!name || !tier || !Array.isArray(notices)) {
      return NextResponse.json({ error: 'name, tier, notices 필수' }, { status: 400 });
    }
    if (![1, 2, 3].includes(tier)) {
      return NextResponse.json({ error: 'tier는 1,2,3 중 하나' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('terms_templates')
      .insert({
        name,
        tier,
        scope: scope ?? {},
        notices,
        priority: priority ?? 50,
        starts_at: starts_at ?? new Date().toISOString(),
        ends_at: ends_at ?? null,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    invalidateTermsCache();
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '생성 실패' },
      { status: 500 },
    );
  }
}
