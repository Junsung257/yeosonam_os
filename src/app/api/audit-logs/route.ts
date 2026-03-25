import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// GET: 감사 로그 타임라인 조회
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetType = searchParams.get('targetType'); // 'booking' | 'affiliate' | 'settlement'
  const targetId = searchParams.get('targetId');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const supabase = getSupabase();

  try {
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (targetType) query = query.eq('target_type', targetType);
    if (targetId) query = query.eq('target_id', targetId);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ logs: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

// POST: 감사 로그 기록
export async function POST(request: NextRequest) {
  const supabase = getSupabase();

  try {
    const body = await request.json();
    const { action, targetType, targetId, description, beforeValue, afterValue, userId } = body;

    if (!action) return NextResponse.json({ error: 'action이 필요합니다.' }, { status: 400 });

    const { data, error } = await supabase
      .from('audit_logs')
      .insert([{
        user_id: userId || null,
        action,
        target_type: targetType || null,
        target_id: targetId || null,
        description: description || null,
        before_value: beforeValue || null,
        after_value: afterValue || null,
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ log: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '로그 기록 실패' }, { status: 500 });
  }
}
