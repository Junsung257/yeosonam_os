import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// POST: 분쟁 플래그 토글
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const { id } = params;
    const body = await request.json();
    const { dispute_flag, dispute_note } = body;

    if (typeof dispute_flag !== 'boolean') {
      return NextResponse.json({ error: 'dispute_flag (boolean) 필수' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .update({
        dispute_flag,
        dispute_note: dispute_note || null,
      })
      .eq('id', id)
      .select('id, dispute_flag, dispute_note')
      .single();

    if (error) throw error;

    // 감사 로그
    await supabaseAdmin.from('audit_logs').insert({
      action: dispute_flag ? 'DISPUTE_FLAG_ON' : 'DISPUTE_FLAG_OFF',
      target_type: 'booking',
      target_id: id,
      description: dispute_flag
        ? `분쟁 플래그 설정: ${dispute_note || '사유 없음'}`
        : '분쟁 플래그 해제',
    });

    return NextResponse.json({ booking: data });
  } catch (error) {
    console.error('[Dispute]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '처리 실패' },
      { status: 500 }
    );
  }
}
