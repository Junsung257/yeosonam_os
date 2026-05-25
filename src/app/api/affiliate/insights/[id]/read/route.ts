/**
 * PATCH /api/affiliate/insights/:id/read
 * 인사이트 읽음 처리
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { markInsightAsRead } from '@/lib/card-news/affiliate-feedback';

export const runtime = 'nodejs';

export async function PATCH(
  _request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const insightId = params.id;
  if (!insightId) {
    return NextResponse.json({ error: 'insight_id 필요' }, { status: 400 });
  }

  try {
    const success = await markInsightAsRead(insightId);
    if (!success) {
      return NextResponse.json({ error: '읽음 처리 실패' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
