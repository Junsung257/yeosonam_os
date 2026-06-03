/**
 * GET /api/admin/platform-learning?limit=50&offset=0&source=qa_chat|jarvis_v1|jarvis_v2_stream
 * GET /api/admin/platform-learning?stats=true — 피드백 집계 통계
 *
 * 플랫폼 AI 플라이휠 이벤트 조회 — 어드민 대시보드용
 */
import { type NextRequest, type NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCES = new Set(['qa_chat', 'qa_escalation_cta', 'jarvis_v1', 'jarvis_v2_stream']);

interface FeedbackStats {
  totalUp: number;
  totalDown: number;
  totalFeedback: number;
  positiveRate: number;
  bySource: Array<{ source: string; up: number; down: number; total: number }>;
  byDay: Array<{ date: string; up: number; down: number; total: number }>;
  latest: Array<{
    id: string;
    created_at: string;
    rating: string;
    source: string;
    session_id: string | null;
    payload: Record<string, unknown> | null;
  }>;
}

const getHandler = async (req: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ events: [], total: 0 });
  }

  const sp = req.nextUrl.searchParams;
  const stats = sp.get('stats') === 'true';

  // ── 피드백 통계 ────────────────────────────────────────
  if (stats) {
    const sb = supabaseAdmin;

    // 전체 집계
    const { data: allFeedback, error: statsError } = await sb
      .from('platform_learning_events')
      .select('id, created_at, source, session_id, payload')
      .eq('source', 'qa_chat')
      .filter('payload->>event', 'eq', 'feedback')
      .order('created_at', { ascending: false });

    if (statsError) {
      return apiResponse(
        { error: sanitizeDbError(statsError, 'Failed to load feedback stats') },
        { status: 500 },
      );
    }

    const rows = (allFeedback ?? []) as Array<{
      id: string;
      created_at: string;
      source: string;
      session_id: string | null;
      payload: Record<string, unknown> | null;
    }>;

    const up = rows.filter((r) => (r.payload as Record<string, unknown>)?.rating === 'up');
    const down = rows.filter((r) => (r.payload as Record<string, unknown>)?.rating === 'down');

    // 소스별 분포
    const sourceMap = new Map<string, { up: number; down: number }>();
    for (const r of rows) {
      const src = String((r.payload as Record<string, unknown>)?.leadSource || 'unknown');
      if (!sourceMap.has(src)) sourceMap.set(src, { up: 0, down: 0 });
      const s = sourceMap.get(src)!;
      if ((r.payload as Record<string, unknown>)?.rating === 'up') s.up++;
      else s.down++;
    }
    const bySource = [...sourceMap.entries()].map(([source, v]) => ({
      source,
      up: v.up,
      down: v.down,
      total: v.up + v.down,
    }));

    // 일별 추이 (최근 30일)
    const dayMap = new Map<string, { up: number; down: number }>();
    for (const r of rows) {
      const date = r.created_at?.slice(0, 10);
      if (!date) continue;
      if (!dayMap.has(date)) dayMap.set(date, { up: 0, down: 0 });
      const d = dayMap.get(date)!;
      if ((r.payload as Record<string, unknown>)?.rating === 'up') d.up++;
      else d.down++;
    }
    const byDay = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, v]) => ({ date, up: v.up, down: v.down, total: v.up + v.down }));

    const statsResult: FeedbackStats = {
      totalUp: up.length,
      totalDown: down.length,
      totalFeedback: rows.length,
      positiveRate: rows.length > 0 ? up.length / rows.length : 0,
      bySource,
      byDay,
      latest: rows.slice(0, 20).map((r) => ({
        id: r.id,
        created_at: r.created_at,
        rating: ((r.payload as Record<string, unknown>)?.rating as string) ?? 'unknown',
        source: r.source,
        session_id: r.session_id,
        payload: r.payload,
      })),
    };

    return apiResponse({ stats: statsResult });
  }

  // ── 일반 이벤트 목록 ──────────────────────────────────────
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
    const safeError = sanitizeDbError(error, 'Failed to load platform learning events');
    if (safeError.includes('does not exist') || error.code === '42P01') {
      return apiResponse({
        events: [],
        total: 0,
        notice: 'platform_learning_events 테이블이 없습니다. Supabase 마이그레이션을 적용하세요.',
      });
    }
    return apiResponse({ error: safeError }, { status: 500 });
  }

  return apiResponse({ events: data ?? [], total: count ?? 0 });
};

export const GET = withAdminGuard(getHandler);
