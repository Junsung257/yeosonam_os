import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  let body: { affiliate_id: string; pin: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.affiliate_id || !body.pin || body.pin.length < 4) {
    return NextResponse.json({ error: '유효하지 않은 요청' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('affiliates')
    .update({ portal_pin: body.pin })
    .eq('id', body.affiliate_id);

  if (error) {
    return NextResponse.json({ error: 'PIN 설정 중 오류가 발생했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
