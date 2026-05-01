import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

/**
 * 일일 발행 요약 + 저성과 글 자동 재생성 트리거 — 매일 09:00 KST (00:00 UTC)
 *
 * 1) 어제 발행 통계 → publishing_policies.daily_summary_webhook 으로 push
 * 2) auto_regenerate_underperformers ON 시:
 *    - 7일 이상 발행 + GSC 클릭 0건 → 큐에 user_seed priority=85 재생성
 *    - 단, 14일 윈도 dedup 통과한 것만
 */

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

async function runDailySummary(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];

  // 정책 조회
  const { data: policyRow } = await supabaseAdmin
    .from('publishing_policies')
    .select('*')
    .eq('scope', 'global')
    .limit(1);
  const policy = policyRow?.[0];

  // 어제 통계 (24h)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStart = new Date(yesterday); yStart.setHours(0, 0, 0, 0);
  const yEnd = new Date(yesterday); yEnd.setHours(23, 59, 59, 999);

  const [pubRes, queueRes, alertRes, indexRes] = await Promise.all([
    supabaseAdmin.from('content_creatives').select('id, slug, content_type, destination, readability_score', { count: 'exact' })
      .eq('channel', 'naver_blog').eq('status', 'published')
      .gte('published_at', yStart.toISOString()).lte('published_at', yEnd.toISOString()),
    supabaseAdmin.from('blog_topic_queue').select('status', { count: 'exact' })
      .in('status', ['queued', 'failed']),
    supabaseAdmin.from('rank_alerts').select('id', { count: 'exact' })
      .is('resolved_at', null),
    supabaseAdmin.from('indexing_reports').select('google_status, indexnow_status')
      .gte('reported_at', yStart.toISOString()).lte('reported_at', yEnd.toISOString()),
  ]);

  const published = pubRes.data || [];
  const indexReports = indexRes.data || [];
  const indexSuccess = indexReports.filter((r: any) => r.google_status === 'success' || r.indexnow_status === 'success').length;
  const indexRate = indexReports.length > 0 ? (indexSuccess / indexReports.length) * 100 : 0;

  const queueCounts = (queueRes.data || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  // destination별 발행 분포
  const destDist: Record<string, number> = {};
  for (const p of published as any[]) {
    if (p.destination) destDist[p.destination] = (destDist[p.destination] || 0) + 1;
  }

  // 가독성 평균
  const readabilityScores = (published as any[]).map(p => p.readability_score).filter(Boolean);
  const avgReadability = readabilityScores.length > 0
    ? Math.round(readabilityScores.reduce((a, b) => a + b, 0) / readabilityScores.length)
    : null;

  const summary = {
    date: yStart.toISOString().split('T')[0],
    published: pubRes.count || 0,
    queue_pending: queueCounts.queued || 0,
    queue_failed: queueCounts.failed || 0,
    rank_alerts_open: alertRes.count || 0,
    indexing_success_rate: +indexRate.toFixed(1),
    avg_readability: avgReadability,
    destination_distribution: destDist,
  };

  // 2) 저성과 글 재생성 트리거 (정책 ON 시)
  let regenInfo: { count: number } | null = null;
  if (policy?.auto_regenerate_underperformers) {
    try {
      regenInfo = await regenerateUnderperformers();
    } catch (e) {
      errors.push(`regen 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3) Webhook push (Slack/Discord 호환 JSON)
  let webhookInfo: { sent: boolean; status?: number } | null = null;
  if (policy?.daily_summary_webhook) {
    try {
      const text = `📊 *여소남 블로그 발행 요약 ${summary.date}*\n` +
        `• 발행: ${summary.published}편 (대기 ${summary.queue_pending} / 실패 ${summary.queue_failed})\n` +
        `• 색인 성공률: ${summary.indexing_success_rate}%\n` +
        `• 평균 가독성: ${summary.avg_readability ?? '-'}/100\n` +
        `• 순위 경보: ${summary.rank_alerts_open}건` +
        (regenInfo ? `\n• 저성과 재생성: ${regenInfo.count}건 큐잉` : '');

      const res = await fetch(policy.daily_summary_webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, summary }),
        signal: AbortSignal.timeout(8000),
      });
      webhookInfo = { sent: res.ok, status: res.status };
    } catch (e) {
      errors.push(`webhook 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    summary,
    regenerated: regenInfo,
    webhook: webhookInfo,
    errors,
    ranAt: new Date().toISOString(),
  };
}

/**
 * 7일 이상 발행 + GSC 클릭 0건 → 큐에 user_seed로 재생성
 */
async function regenerateUnderperformers(): Promise<{ count: number }> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // 후보: 7-14일 전 발행, 정보성 위주 (상품은 노출 사이클 다름)
  const { data: candidates } = await supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, destination, angle_type, content_type, generation_meta')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .is('product_id', null)
    .lte('published_at', sevenDaysAgo.toISOString())
    .gte('published_at', fourteenDaysAgo.toISOString())
    .limit(50);

  if (!candidates || candidates.length === 0) return { count: 0 };

  // GSC에서 7일 클릭 0건 필터
  const slugs = candidates.map((c: any) => c.slug);
  const { data: clickRows } = await supabaseAdmin
    .from('rank_history')
    .select('slug, clicks')
    .in('slug', slugs)
    .gte('date', sevenDaysAgo.toISOString().split('T')[0]);

  const clickMap = new Map<string, number>();
  for (const r of clickRows || []) {
    const slug = (r as any).slug;
    clickMap.set(slug, (clickMap.get(slug) || 0) + ((r as any).clicks || 0));
  }

  const underperformers = candidates.filter((c: any) => (clickMap.get(c.slug) || 0) === 0);
  if (underperformers.length === 0) return { count: 0 };

  // 14일 윈도 dedup — 같은 (destination, angle) 큐 이미 있으면 skip
  const { data: recentQueue } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('destination, angle_type')
    .gte('created_at', fourteenDaysAgo.toISOString());
  const recentKeys = new Set(((recentQueue || []) as any[]).map(r => `${r.destination}::${r.angle_type}`));

  const fresh = underperformers.filter((c: any) =>
    !recentKeys.has(`${c.destination}::${c.angle_type}`)
  ).slice(0, 5);  // 일일 5건 상한

  if (fresh.length === 0) return { count: 0 };

  const rows = fresh.map((c: any) => ({
    topic: `${c.seo_title} — 재작성 v2`,
    source: 'user_seed',
    priority: 85,
    destination: c.destination,
    angle_type: c.angle_type,
    category: 'travel_tips',
    meta: {
      regenerated_from: c.id,
      regenerated_reason: '7일 GSC 클릭 0',
      original_slug: c.slug,
    },
  }));

  const { data: inserted } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(rows)
    .select('id');

  return { count: inserted?.length ?? 0 };
}

export const GET = withCronLogging('blog-daily-summary', runDailySummary);
