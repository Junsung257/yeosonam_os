import { sanitizeDbError } from '@/lib/error-sanitizer';

export type BlogOpsLevel = 'healthy' | 'watch' | 'risk' | 'blocked';

type QueryResult<T> = { data: T[] | null; error: unknown | null };

type QueueRow = {
  id: string;
  topic: string | null;
  status: string | null;
  source: string | null;
  priority: number | null;
  destination: string | null;
  target_publish_at: string | null;
  attempts: number | null;
  last_error: string | null;
  content_creative_id?: string | null;
  primary_keyword?: string | null;
  keyword_tier?: string | null;
  created_at: string | null;
  meta?: Record<string, unknown> | null;
};

type PostRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  status: string | null;
  published_at: string | null;
  readability_score: number | string | null;
  seo_score: Record<string, unknown> | null;
  quality_gate: Record<string, unknown> | null;
  generation_meta: Record<string, unknown> | null;
  destination: string | null;
};

type CronHealthRow = {
  cron_name: string | null;
  last_status: string | null;
  last_run_at: string | null;
  last_elapsed_ms: number | null;
  last_error_count: number | null;
  last_summary: Record<string, unknown> | null;
};

type IndexingReportRow = {
  url: string | null;
  google_status: string | null;
  google_error: string | null;
  google_index_verdict?: string | null;
  google_coverage_state?: string | null;
  indexnow_status: string | null;
  indexnow_error: string | null;
  reported_at: string | null;
};

type PolicyRow = {
  posts_per_day?: number | null;
  per_destination_daily_cap?: number | null;
  product_ratio?: number | null;
  enabled?: boolean | null;
  slot_times?: string[] | null;
};

type ProgrammaticTopicRow = { status: string | null };
type CategoryRow = { is_active: boolean | null; scope: string | null };
type AdMappingRow = {
  active: boolean | null;
  operational_status: string | null;
  clicks: number | null;
  cta_clicks?: number | null;
  conversions: number | null;
};

type RankRow = {
  source: string | null;
  impressions: number | null;
  clicks: number | null;
};

function countBy<T>(rows: T[], pick: (row: T) => string | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = pick(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function startOfKstDay(offsetDays = 0): Date {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 60 * 60 * 1000);
}

function classifyQueueError(message: string | null | undefined): string {
  const text = (message || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('topic_fit') || text.includes('intent_mismatch')) return 'topic_fit';
  if (text.includes('editorial')) return 'editorial_quality';
  if (text.includes('seo')) return 'seo_score';
  if (text.includes('constraint')) return 'schema_constraint';
  if (text.includes('self-heal') || text.includes('self_heal')) return 'self_heal_blocked';
  if (text.includes('image')) return 'image_quality';
  if (text.includes('timeout')) return 'timeout';
  return 'other';
}

function levelRank(level: BlogOpsLevel): number {
  return { healthy: 0, watch: 1, risk: 2, blocked: 3 }[level];
}

function maxLevel(...levels: BlogOpsLevel[]): BlogOpsLevel {
  return levels.reduce((max, level) => (levelRank(level) > levelRank(max) ? level : max), 'healthy' as BlogOpsLevel);
}

function isRecentOrDueQueue(row: QueueRow, now: Date): boolean {
  if (row.status === 'failed' || row.status === 'generating') return true;
  if (row.status !== 'queued') return false;
  const created = row.created_at ? new Date(row.created_at) : null;
  const target = row.target_publish_at ? new Date(row.target_publish_at) : null;
  const recent = created ? now.getTime() - created.getTime() <= 7 * 24 * 60 * 60 * 1000 : false;
  const dueSoon = target ? target.getTime() <= now.getTime() + 14 * 24 * 60 * 60 * 1000 : false;
  return recent || dueSoon;
}

async function settle<T>(label: string, promise: PromiseLike<QueryResult<T>>, warnings: string[]): Promise<T[]> {
  try {
    const result = await promise;
    if (result.error) {
      warnings.push(`${label}: ${sanitizeDbError(result.error)}`);
      return [];
    }
    return result.data || [];
  } catch (error) {
    warnings.push(`${label}: ${sanitizeDbError(error)}`);
    return [];
  }
}

export async function buildBlogOpsSummary(supabase: any) {
  const warnings: string[] = [];
  const now = new Date();
  const todayStart = startOfKstDay(0);
  const tomorrowStart = startOfKstDay(1);
  const yesterdayStart = startOfKstDay(-1);
  const weekAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [
    queueRows,
    postRows,
    indexingJobs,
    indexingReports,
    cronRows,
    policyRows,
    programmaticRows,
    categoryRows,
    adRows,
    rankRows,
  ] = await Promise.all([
    settle<QueueRow>('blog_topic_queue', supabase.from('blog_topic_queue').select('*').order('created_at', { ascending: false }).limit(500), warnings),
    settle<PostRow>(
      'content_creatives',
      supabase
        .from('content_creatives')
        .select('id, slug, seo_title, status, published_at, readability_score, seo_score, quality_gate, generation_meta, destination')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(120),
      warnings,
    ),
    settle<{ status: string | null }>('blog_indexing_jobs', supabase.from('blog_indexing_jobs').select('status').limit(500), warnings),
    settle<IndexingReportRow>(
      'indexing_reports',
      supabase
        .from('indexing_reports')
        .select('url, google_status, google_error, google_index_verdict, google_coverage_state, indexnow_status, indexnow_error, reported_at')
        .order('reported_at', { ascending: false })
        .limit(80),
      warnings,
    ),
    settle<CronHealthRow>(
      'cron_health',
      supabase
        .from('cron_health')
        .select('cron_name, last_status, last_run_at, last_elapsed_ms, last_error_count, last_summary'),
      warnings,
    ),
    settle<PolicyRow>('publishing_policies', supabase.from('publishing_policies').select('*').eq('scope', 'global').limit(1), warnings),
    settle<ProgrammaticTopicRow>('programmatic_seo_topics', supabase.from('programmatic_seo_topics').select('status'), warnings),
    settle<CategoryRow>('blog_categories', supabase.from('blog_categories').select('is_active, scope'), warnings),
    settle<AdMappingRow>('ad_landing_mappings', supabase.from('ad_landing_mappings').select('active, operational_status, clicks, cta_clicks, conversions').limit(500), warnings),
    settle<RankRow>('rank_history', supabase.from('rank_history').select('source, impressions, clicks').gte('date', monthAgoDate).limit(2000), warnings),
  ]);

  const queueCounts = countBy(queueRows, (row) => row.status);
  const activeQueue = queueRows.filter((row) => isRecentOrDueQueue(row, now));
  const hiddenHistory = queueRows.filter((row) => !isRecentOrDueQueue(row, now)).length;
  const overdueQueued = queueRows.filter((row) => row.status === 'queued' && row.target_publish_at && new Date(row.target_publish_at) < now).length;
  const staleGenerating = queueRows.filter((row) => row.status === 'generating' && row.created_at && now.getTime() - new Date(row.created_at).getTime() > 90 * 60 * 1000).length;
  const failureBuckets = countBy(queueRows.filter((row) => row.status === 'failed'), (row) => classifyQueueError(row.last_error));

  const publishedRows = postRows.filter((row) => row.status === 'published');
  const publishedToday = publishedRows.filter((row) => row.published_at && new Date(row.published_at) >= todayStart && new Date(row.published_at) < tomorrowStart).length;
  const publishedYesterday = publishedRows.filter((row) => row.published_at && new Date(row.published_at) >= yesterdayStart && new Date(row.published_at) < todayStart).length;
  const policy = policyRows[0] || {};
  const dailyTarget = Math.max(1, Math.round(asNumber(policy.posts_per_day) || 3));
  const lowQualityRecent = publishedRows.slice(0, 30).filter((row) => {
    const seoScore = asNumber(row.seo_score?.score);
    const qualityPassed = row.quality_gate?.passed !== false;
    return (seoScore > 0 && seoScore < 85) || !qualityPassed;
  }).length;

  const indexingCounts = countBy(indexingJobs, (row) => row.status);
  const indexingActive = indexingJobs.filter((row) => !['succeeded', 'done', 'completed'].includes(String(row.status || ''))).length;
  const recentIndexingFailures = indexingReports.filter((row) => row.google_error || row.indexnow_error || row.google_status === 'error' || row.indexnow_status === 'error').length;
  const googleUnknownUrls = indexingReports.filter((row) => String(row.google_coverage_state || '').includes('알려지지 않은 URL')).length;
  const googleIndexedReports = indexingReports.filter((row) => String(row.google_index_verdict || '').toUpperCase() === 'PASS').length;
  const indexNowOk = indexingReports.filter((row) => row.indexnow_status === 'ok').length;
  const indexNowKnown = indexingReports.filter((row) => row.indexnow_status).length;
  const indexNowSuccessRate = indexNowKnown ? Math.round((indexNowOk / indexNowKnown) * 1000) / 10 : null;

  const blogCronNames = new Set([
    'blog-daily-summary',
    'blog-indexing-worker',
    'blog-orchestrator',
    'blog-publisher',
    'blog-scheduler',
    'gsc-index-rank',
    'rank-tracking',
    'serp-rank-snapshot',
    'topical-rebuild',
    'trend-topic-miner',
  ]);
  const blogCrons = cronRows
    .filter((row) => row.cron_name && (blogCronNames.has(row.cron_name) || row.cron_name.startsWith('blog-')))
    .sort((a, b) => String(a.cron_name).localeCompare(String(b.cron_name)));
  const unhealthyCrons = blogCrons.filter((row) => row.last_status && row.last_status !== 'success');
  const coreCrons = blogCrons.filter((row) => blogCronNames.has(String(row.cron_name)));

  const programmaticCounts = countBy(programmaticRows, (row) => row.status);
  const categoryCounts = {
    active: categoryRows.filter((row) => row.is_active).length,
    inactive: categoryRows.filter((row) => !row.is_active).length,
    info: categoryRows.filter((row) => row.scope === 'info').length,
    product: categoryRows.filter((row) => row.scope === 'product').length,
    both: categoryRows.filter((row) => row.scope === 'both').length,
  };
  const adCounts = countBy(adRows, (row) => row.operational_status || (row.active ? 'legacy_active' : 'candidate'));
  const adConversions = adRows.reduce((sum, row) => sum + asNumber(row.conversions), 0);
  const rankTotals = {
    rows_30d: rankRows.length,
    clicks_30d: rankRows.reduce((sum, row) => sum + asNumber(row.clicks), 0),
    impressions_30d: rankRows.reduce((sum, row) => sum + asNumber(row.impressions), 0),
    sources: countBy(rankRows, (row) => row.source),
  };

  const dailyLevel: BlogOpsLevel = publishedToday >= dailyTarget ? 'healthy' : publishedYesterday < dailyTarget ? 'risk' : 'watch';
  const queueLevel: BlogOpsLevel = (queueCounts.failed || 0) > 0 || staleGenerating > 0 ? 'risk' : overdueQueued > 0 ? 'watch' : 'healthy';
  const indexingLevel: BlogOpsLevel = googleUnknownUrls > 0 || recentIndexingFailures > 0 ? 'risk' : indexingActive > 0 ? 'watch' : 'healthy';
  const cronLevel: BlogOpsLevel = unhealthyCrons.some((row) => row.cron_name === 'blog-publisher') ? 'blocked' : unhealthyCrons.length > 0 ? 'risk' : 'healthy';
  const qualityLevel: BlogOpsLevel = lowQualityRecent > 0 ? 'risk' : 'healthy';
  const overallLevel = maxLevel(dailyLevel, queueLevel, indexingLevel, cronLevel, qualityLevel);

  const nextActions: Array<{ severity: BlogOpsLevel; title: string; detail: string; href: string; action?: string }> = [];
  if (publishedToday < dailyTarget) {
    nextActions.push({
      severity: dailyLevel,
      title: '오늘 발행 목표 미달',
      detail: `오늘 ${publishedToday}/${dailyTarget}편 발행됨. 큐와 publisher 상태를 같이 확인하세요.`,
      href: '/admin/blog/queue',
      action: 'run_publisher',
    });
  }
  if ((queueCounts.failed || 0) > 0) {
    nextActions.push({
      severity: 'risk',
      title: '실패 큐 정리 필요',
      detail: `실패 ${queueCounts.failed}건. 원인별로 재시도 또는 숨김 처리하세요.`,
      href: '/admin/blog/queue?scope=attention',
    });
  }
  if (unhealthyCrons.length > 0) {
    nextActions.push({
      severity: cronLevel,
      title: '블로그 크론 부분 실패',
      detail: unhealthyCrons.map((row) => row.cron_name).slice(0, 4).join(', '),
      href: '/admin/blog/system',
    });
  }
  if (googleUnknownUrls > 0) {
    nextActions.push({
      severity: indexingLevel,
      title: 'Google 실제 색인 확인 필요',
      detail: `최근 Inspection 표본 ${googleUnknownUrls}건이 Google에 아직 알려지지 않은 URL입니다. sitemap, GSC, 내부링크 상태를 분리 확인하세요.`,
      href: '/admin/blog/rankings',
    });
  }
  if (googleUnknownUrls === 0 && (recentIndexingFailures > 0 || indexingActive > 0)) {
    nextActions.push({
      severity: indexingLevel,
      title: '색인 작업 확인',
      detail: `대기/실패 작업 ${indexingActive + recentIndexingFailures}건. Google/Naver 상태를 분리 확인하세요.`,
      href: '/admin/blog/rankings',
    });
  }
  if ((programmaticCounts.pending || 0) > 100) {
    nextActions.push({
      severity: 'watch',
      title: 'pSEO 후보 적체',
      detail: `pending ${programmaticCounts.pending}건. 토픽 권위 기준으로 승격 대상을 줄이세요.`,
      href: '/admin/blog/topical',
    });
  }
  if (nextActions.length === 0) {
    nextActions.push({
      severity: 'healthy',
      title: '핵심 자동화 정상',
      detail: '발행, 큐, 색인, 크론에서 즉시 조치할 항목이 없습니다.',
      href: '/admin/blog/system',
    });
  }

  return {
    ok: true,
    generated_at: now.toISOString(),
    level: overallLevel,
    warnings,
    contract: {
      document: 'docs/blog-autopublish-contract.md',
      current_version: '2026-06-16',
      passed: overallLevel === 'healthy' || overallLevel === 'watch',
      failed_checks: [
        ...(dailyLevel === 'risk' ? ['daily_publish_sla'] : []),
        ...(queueLevel === 'risk' ? ['queue_failures_or_stale_generation'] : []),
        ...(cronLevel === 'risk' || cronLevel === 'blocked' ? ['cron_health'] : []),
        ...(qualityLevel === 'risk' ? ['recent_quality_gate'] : []),
        ...(googleUnknownUrls > 0 ? ['google_url_unknown'] : []),
      ],
    },
    publish: {
      daily_target: dailyTarget,
      published_today: publishedToday,
      published_yesterday: publishedYesterday,
      remaining_today: Math.max(0, dailyTarget - publishedToday),
      policy_enabled: policy.enabled !== false,
      per_destination_daily_cap: asNumber(policy.per_destination_daily_cap) || null,
      product_ratio: typeof policy.product_ratio === 'number' ? policy.product_ratio : null,
      slot_times: policy.slot_times || [],
      level: dailyLevel,
    },
    queue: {
      counts: queueCounts,
      active_count: activeQueue.length,
      hidden_history: hiddenHistory,
      overdue_queued: overdueQueued,
      stale_generating: staleGenerating,
      failure_buckets: failureBuckets,
      recent_attention: activeQueue.slice(0, 12),
      level: queueLevel,
    },
    quality: {
      recent_checked: Math.min(30, publishedRows.length),
      low_quality_recent: lowQualityRecent,
      latest_posts: publishedRows.slice(0, 8).map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.seo_title,
        destination: row.destination,
        published_at: row.published_at,
        seo_score: asNumber(row.seo_score?.score) || null,
        readability_score: asNumber(row.readability_score) || null,
        quality_passed: row.quality_gate?.passed !== false,
        failure_code: row.generation_meta?.failure_code || null,
      })),
      level: qualityLevel,
    },
    indexing: {
      job_counts: indexingCounts,
      active_jobs: indexingActive,
      recent_failures: recentIndexingFailures,
      google_unknown_urls: googleUnknownUrls,
      google_indexed_reports: googleIndexedReports,
      inspected_reports: indexingReports.length,
      indexnow_success_rate: indexNowSuccessRate,
      recent_reports: indexingReports.slice(0, 8),
      level: indexingLevel,
    },
    cron: {
      level: cronLevel,
      unhealthy_count: unhealthyCrons.length,
      core: coreCrons,
      unhealthy: unhealthyCrons,
    },
    keyword: {
      programmatic_counts: programmaticCounts,
      rank: rankTotals,
    },
    taxonomy: categoryCounts,
    ads: {
      counts: adCounts,
      conversions: adConversions,
      tracked_mappings: adRows.length,
    },
    next_actions: nextActions,
  };
}
