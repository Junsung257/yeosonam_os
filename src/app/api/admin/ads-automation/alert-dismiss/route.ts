/**
 * POST /api/admin/ads-automation/alert-dismiss
 *
 * 어드민 페이지에서 ad-balance alert 를 dismiss (read 마킹).
 * Body: { alertId: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  let body: { alertId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }
  const { alertId } = body;
  if (!alertId) {
    return NextResponse.json({ error: 'alertId 필수' }, { status: 400 });
  }

  // admin_alerts 의 일반 dismiss 패턴 — 다른 곳에서 동일 패턴 사용 시 helper 로 추출 권장
  const { error } = await supabaseAdmin
    .from('admin_alerts')
    .update({
      dismissed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', alertId);

  if (error) {
    return NextResponse.json(
      { error: `dismiss 실패: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, alertId });
}
