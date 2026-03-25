import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, getMessageLogs, createMessageLog } from '@/lib/supabase';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  const logs = await getMessageLogs(params.id);
  return NextResponse.json({ logs });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  try {
    const { content } = await request.json();
    if (!content?.trim()) {
      return NextResponse.json({ error: '메모 내용이 필요합니다.' }, { status: 400 });
    }
    const log = await createMessageLog({
      booking_id: params.id,
      log_type:   'manual',
      event_type: 'MANUAL_MEMO',
      title:      '수동 메모',
      content:    content.trim(),
      is_mock:    false,
      created_by: 'admin',
    });
    return NextResponse.json({ log });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '메모 저장 실패' },
      { status: 500 }
    );
  }
}
