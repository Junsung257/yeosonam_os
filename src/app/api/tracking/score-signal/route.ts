import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const VALID_TYPES = new Set(['view', 'click', 'booking']);

/**
 * 패키지 시그널 수집 (LTR 학습 데이터).
 * Body: { package_id, signal_type, group_key?, rank?, score? }
 * 클라이언트 fetch — abuse 방지는 추후 rate limit 적용.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: false }, { status: 200 }); // silent
  let body: {
    package_id?: string; signal_type?: string;
    group_key?: string; rank?: number; score?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  if (!body.package_id || !body.signal_type) {
    return NextResponse.json({ error: 'package_id, signal_type 필수' }, { status: 400 });
  }
  if (!VALID_TYPES.has(body.signal_type)) {
    return NextResponse.json({ error: `signal_type 허용: ${[...VALID_TYPES].join(',')}` }, { status: 400 });
  }

  const sessionId = req.cookies.get('ys_session_id')?.value ?? null;

  const { error } = await supabaseAdmin
    .from('package_score_signals')
    .insert({
      package_id: body.package_id,
      signal_type: body.signal_type,
      group_key: body.group_key ?? null,
      rank_at_signal: body.rank ?? null,
      topsis_score_at_signal: body.score ?? null,
      session_id: sessionId,
    });
  if (error) {
    // 시그널 INSERT 실패해도 클라이언트엔 silent 200 (UX 보호)
    console.error('[tracking/score-signal] insert 실패:', error.message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
