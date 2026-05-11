import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { validateRequest } from '@/lib/api-validation';

const DisputeBodySchema = z.object({
  dispute_flag: z.boolean(),
  dispute_note: z.string().max(2000).optional().nullable(),
});

// POST: 분쟁 플래그 토글
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const validation = await validateRequest(request, DisputeBodySchema);
  if (!validation.success) return validation.response;
  const { dispute_flag, dispute_note } = validation.data;

  try {
    const { id } = params;

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
