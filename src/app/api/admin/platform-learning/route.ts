/**
 * GET /api/admin/platform-learning?limit=50&offset=0&source=qa_chat|qa_escalation_cta|jarvis_v1|jarvis_v2_stream
 *
 * 플랫폼 AI 플라이휠 이벤트 조회 — 어드민 대시보드용
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCES = new Set(['qa_chat', 'qa_escalation_cta', 'jarvis_v1', 'jarvis_v2_stream']);

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ events: [], total: 0 });
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
  const source = sp.get('source');

  let q = supabaseAdmin
    .from('platform_learning_events')
    .select(
      'id, created_at, source, session_id, tenant_id, affiliate_id, message_sha256, message_redacted, payload, consent_flags',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (source && SOURCES.has(source)) {
    q = q.eq('source', source);
  }

  const { data, error, count } = await q;

  if (error) {
    if (error.message.includes('does not exist') || error.code === '42P01') {
      return NextResponse.json({
        events: [],
        total: 0,
        notice: 'platform_learning_events 테이블이 없습니다. Supabase 마이그레이션을 적용하세요.',
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [], total: count ?? 0 });
}
