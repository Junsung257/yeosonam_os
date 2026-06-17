import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

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

const MIN_DAILY_BLOG_POSTS = 3;

function isGoogleIndexedReport(report: any): boolean {
  if (report?.google_status === 'indexed') return true;
  if (report?.google_index_verdict === 'PASS') return true;
  const coverage = String(report?.google_coverage_state || '').toLowerCase();
  return coverage.includes('indexed')
    || coverage.includes('색인이 생성')
    || coverage.includes('색인 생성');
}

async function runDailySummary(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
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

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [pubRes, queueRes, alertRes, indexRes, visibilityRes, rankRes] = await Promise.all([
    supabaseAdmin.from('content_creatives').select('id, slug, content_type, destination, readability_score', { count: 'exact' })
      .eq('channel', 'naver_blog').eq('status', 'published')
      .gte('published_at', yStart.toISOString()).lte('published_at', yEnd.toISOString()),
    supabaseAdmin.from('blog_topic_queue').select('status', { count: 'exact' })
      .in('status', ['queued', 'failed']),
    supabaseAdmin.from('rank_alerts').select('id', { count: 'exact' })
      .is('resolved_at', null),
    supabaseAdmin.from('indexing_reports').select('google_status, google_error, indexnow_status, indexnow_error, sitemap_pings, google_index_verdict, google_coverage_state')
      .gte('reported_at', yStart.toISOString()).lte('reported_at', yEnd.toISOString()),
    supabaseAdmin.from('blog_visibility_snapshots').select('id, platform, index_status, visibility_status', { count: 'exact' })
      .gte('checked_at', yStart.toISOString()).lte('checked_at', yEnd.toISOString()),
    supabaseAdmin.from('rank_history').select('slug', { count: 'exact', head: true })
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0]),
  ]);

  const published = pubRes.data || [];
  const indexReports = indexRes.data || [];
  const indexSuccess = indexReports.filter((r: any) => r.google_status === 'success' || r.indexnow_status === 'success').length;
  const indexRate = indexReports.length > 0 ? (indexSuccess / indexReports.length) * 100 : 0;
  const googleInspectionReports = indexReports.filter((r: any) =>
    ['indexed', 'not_indexed'].includes(String(r.google_status || '')) || r.google_index_verdict,
  );
  const googleIndexed = googleInspectionReports.filter(isGoogleIndexedReport).length;
  const googleNotIndexed = googleInspectionReports.filter((r: any) => !isGoogleIndexedReport(r)).length;
  const googleIndexedRate = googleInspectionReports.length > 0
    ? +((googleIndexed / googleInspectionReports.length) * 100).toFixed(1)
    : null;

  const providerStats = indexReports.reduce((acc: Record<string, { total: number; ok: number }>, report: any) => {
    const pings = Array.isArray(report?.sitemap_pings) ? report.sitemap_pings : [];
    for (const ping of pings) {
      const provider = String(ping?.provider || '');
      if (!provider) continue;
      const stats = acc[provider] ?? { total: 0, ok: 0 };
      stats.total += 1;
      if (ping?.ok === true) stats.ok += 1;
      acc[provider] = stats;
    }
    return acc;
  }, {});

  const providerRate = (provider: string): number | null => {
    const stats = providerStats[provider];
    if (!stats || stats.total === 0) return null;
    return +((stats.ok / stats.total) * 100).toFixed(1);
  };

  const googleSitemapSuccessRate = providerRate('google_search_console_sitemap');
  const naverIndexNowSuccessRate = providerRate('naver_indexnow');
  const globalIndexNowSuccessRate = providerRate('global_indexnow');
  const searchHealthIssues: string[] = [];
  if (googleSitemapSuccessRate !== null && googleSitemapSuccessRate < 80) {
    searchHealthIssues.push(`google_sitemap_low:${googleSitemapSuccessRate}%`);
  }
  if (naverIndexNowSuccessRate !== null && naverIndexNowSuccessRate < 80) {
    searchHealthIssues.push(`naver_indexnow_low:${naverIndexNowSuccessRate}%`);
  }
  if ((visibilityRes.count || 0) === 0) {
    searchHealthIssues.push('visibility_snapshots_missing');
  }
  if ((rankRes.count || 0) === 0) {
    searchHealthIssues.push('rank_history_missing_30d');
  }
  if (googleInspectionReports.length > 0 && googleIndexedRate !== null && googleIndexedRate < 20) {
    searchHealthIssues.push(`google_actual_index_low:${googleIndexedRate}%`);
  }

  const queueCounts = (queueRes.data || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  // destination별 발행 분포
  const destDist: Record<string, number> = {};
  for (const p of published as unknown as Array<Record<string, unknown>>) {
    const dest = p.destination as string | undefined;
    if (dest) destDist[dest] = (destDist[dest] || 0) + 1;
  }

  // 가독성 평균
  const readabilityScores = (published as unknown as Array<{ readability_score?: number }>).map(p => p.readability_score).filter((s): s is number => s !== undefined && s !== null);
  const avgReadability = readabilityScores.length > 0
    ? Math.round(readabilityScores.reduce((a, b) => a + b, 0) / readabilityScores.length)
    : null;

  const summary = {
    date: yStart.toISOString().split('T')[0],
    published: pubRes.count || 0,
    min_daily_target: MIN_DAILY_BLOG_POSTS,
    under_daily_target: (pubRes.count || 0) < MIN_DAILY_BLOG_POSTS,
    queue_pending: queueCounts.queued || 0,
    queue_failed: queueCounts.failed || 0,
    rank_alerts_open: alertRes.count || 0,
    indexing_success_rate: +indexRate.toFixed(1),
    search_standard: {
      publishing_source: 'yeosonam.com /blog',
      primary_market: 'naver',
      secondary_market: 'google',
      naver: {
        role: 'Korean SERP fit, longtail intent, IndexNow notification',
        indexnow_success_rate: naverIndexNowSuccessRate,
      },
      google: {
        role: 'GSC metrics, sitemap submission, URL inspection, canonical/indexability health',
        sitemap_success_rate: googleSitemapSuccessRate,
        actual_indexed_rate: googleIndexedRate,
        inspected_indexed: googleIndexed,
        inspected_not_indexed: googleNotIndexed,
        direct_indexing_api_policy: 'skipped for normal blog posts; use sitemap/GSC unless explicitly enabled',
      },
      global_indexnow_success_rate: globalIndexNowSuccessRate,
      visibility_snapshots_24h: visibilityRes.count || 0,
      rank_history_rows_30d: rankRes.count || 0,
      health_issues: searchHealthIssues,
    },
    avg_readability: avgReadability,
    destination_distribution: destDist,
  };

  if (summary.under_daily_target) {
    const message = `블로그 일일 발행 SLA 미달: ${summary.date} published=${summary.published}, min=${MIN_DAILY_BLOG_POSTS}`;
    errors.push(message);
    await supabaseAdmin.from('admin_alerts').insert({
      category: 'blog',
      severity: summary.published === 0 ? 'high' : 'medium',
      title: '블로그 일일 발행 SLA 미달',
      message,
      ref_type: 'blog_daily_summary',
      ref_id: summary.date,
      meta: {
        published: summary.published,
        min_daily_target: MIN_DAILY_BLOG_POSTS,
        queue_pending: summary.queue_pending,
        queue_failed: summary.queue_failed,
        recommendation: '품질 게이트 실패 또는 큐 부족 원인을 확인하고 대체 토픽을 큐잉하세요.',
      },
    });
  }

  if (searchHealthIssues.length > 0) {
    const message = `블로그 검색 제출 상태 점검 필요: ${searchHealthIssues.join(', ')}`;
    errors.push(message);
    await supabaseAdmin.from('admin_alerts').insert({
      category: 'blog',
      severity: 'medium',
      title: '블로그 검색 제출 상태 점검 필요',
      message,
      ref_type: 'blog_search_indexing',
      ref_id: summary.date,
      meta: {
        search_standard: summary.search_standard,
        recommendation: '네이버는 IndexNow/Search Advisor, 구글은 GSC sitemap과 URL Inspection 권한을 우선 확인하세요.',
      },
    });
  }

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
    const row = r as { slug: string; clicks: number };
    clickMap.set(row.slug, (clickMap.get(row.slug) || 0) + (row.clicks || 0));
  }

  const underperformers = candidates.filter((c: any) => (clickMap.get(c.slug) || 0) === 0);
  if (underperformers.length === 0) return { count: 0 };

  // 14일 윈도 dedup — 같은 (destination, angle) 큐 이미 있으면 skip
  const { data: recentQueue } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('destination, angle_type')
    .gte('created_at', fourteenDaysAgo.toISOString());
  const recentKeys = new Set(((recentQueue || []) as unknown as Array<Record<string, unknown>>).map(r => `${r.destination}::${r.angle_type}`));

  const fresh = underperformers.filter((c: any) =>
    !recentKeys.has(`${c.destination}::${c.angle_type}`)
  ).slice(0, 5);  // 일일 5건 상한

  if (fresh.length === 0) return { count: 0 };

  const rows = fresh.map((c: any) => ({
    topic: c.seo_title || '(제목 없음)',
    source: 'user_seed',
    priority: 85,
    destination: c.destination,
    angle_type: c.angle_type,
    category: 'travel_tips',
    meta: {
      regenerated_from: c.id,
      regenerated_reason: '7일 GSC 클릭 0',
      original_slug: c.slug,
      original_title: c.seo_title,
    },
  }));

  const { data: inserted } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(rows)
    .select('id');

  return { count: inserted?.length ?? 0 };
}

export const GET = withCronLogging('blog-daily-summary', runDailySummary);
