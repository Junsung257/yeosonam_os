import { sanitizeDbError } from '@/lib/error-sanitizer';
import { buildBlogEditorialBacklogWorkReport } from '@/lib/blog-editorial-backlog-work';
import { summarizeBlogIndexingCoverage } from '@/lib/blog-indexing-coverage';
import { evaluateBlogPublishPreflight } from '@/lib/blog-publish-preflight';
import {
  countPublishableQueueCandidates,
  loadQueueDemandSignalMapV3,
  MIN_PUBLISHABLE_BUFFER_DAYS,
  normalizeDailyPostTarget,
} from '@/lib/blog-scheduler';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { buildBlogCanaryPreflight } from '@/lib/blog-canary-preflight';
import { evaluateBlogGeneratedQualityCanaryReport } from '@/lib/blog-canary-generated-quality';
import { buildProductGeneratedCanaryRows } from '@/lib/blog-product-generated-canary';
import { evaluateCurrentDayPublisherHealth } from '@/lib/blog-current-day-publisher-health';
import { classifyDestinationlessInfoCandidate } from '@/lib/blog-destinationless-info';
import { evaluateBlogEngineV2 } from '@/lib/blog-engine-v2';
import { inspectBlogFleetPhraseDrift } from '@/lib/blog-fleet-phrase-drift';
import { BLOG_INFORMATION_RESEARCH_META_KEY } from '@/lib/blog-generation-research';
import { isExternalAdapterBenchmarkPassingV4, type BlogExternalAdapterBenchmarkRowV4 } from '@/lib/blog-research-source-adapters-v4';
import { isKoreanSemanticBenchmarkPassingV4, type BlogKoreanSemanticBenchmarkRowV4 } from '@/lib/blog-korean-semantic-v4';

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
  product_id?: string | null;
  primary_keyword?: string | null;
  keyword_tier?: string | null;
  created_at: string | null;
  meta?: Record<string, unknown> | null;
};

type PostRow = {
  id: string;
  slug: string | null;
  seo_title: string | null;
  seo_description?: string | null;
  og_image_url?: string | null;
  blog_html?: string | null;
  status: string | null;
  published_at: string | null;
  readability_score: number | string | null;
  seo_score: Record<string, unknown> | null;
  quality_gate: Record<string, unknown> | null;
  generation_meta: Record<string, unknown> | null;
  destination: string | null;
  product_id?: string | null;
  angle_type?: string | null;
  category?: string | null;
  content_type?: string | null;
  primary_keyword?: string | null;
};

type CronHealthRow = {
  cron_name: string | null;
  last_status: string | null;
  last_run_at: string | null;
  last_elapsed_ms: number | null;
  last_error_count: number | null;
  last_summary: Record<string, unknown> | null;
};

type IndexingJobRow = {
  status: string | null;
  content_creative_id?: string | null;
  slug?: string | null;
  url?: string | null;
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
  search_lifecycle_status?: string | null;
  provider_receipt_status?: string | null;
  classification_version?: string | null;
};

type GenerationRunRow = {
  id: string;
  status: string | null;
  disposition: string | null;
  attempt_count: number | null;
  latest_quality_score: number | null;
  content_creative_id: string | null;
  updated_at: string | null;
};

type SearchFollowupRow = {
  milestone_days: number | null;
  status: string | null;
  attempt_count: number | null;
};

type SearchCorrectionRow = { correction_type: string | null; status: string | null };

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

type SeoAuditRunRow = {
  id: string;
  status: string | null;
  started_at: string | null;
  completed_at: string | null;
  summary: Record<string, unknown> | null;
};

type AdapterBenchmarkRow = {
  adapter: 'crawl4ai' | 'docling' | 'korean_semantic';
  adapter_version: string;
  sample_size: number;
  extraction_success_count: number | null;
  factual_fidelity_count: number | null;
  ssrf_security_passed: boolean | null;
  latency_p95_ms: number | null;
  precision: number | null;
  recall: number | null;
  passed: boolean;
  evaluated_at?: string | null;
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

function isCanonicalGoogleInspectionUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.yeosonam.com' && url.pathname.startsWith('/blog/');
  } catch {
    return false;
  }
}

function startOfKstDay(offsetDays = 0): Date {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 60 * 60 * 1000);
}

function classifyQueueFailureCode(code: unknown): string | null {
  const value = typeof code === 'string' ? code.toLowerCase() : '';
  if (!value) return null;
  if (value === 'context_missing' || value === 'linked_draft_invalid') return 'context_missing';
  if (value === 'duplicate_content') return 'duplicate_content';
  if (value === 'keyword_density') return 'keyword_density';
  if (value === 'structure_integrity') return 'structure_integrity';
  if (value === 'intent_quality') return 'intent_quality';
  if (value === 'seo_score') return 'seo_score';
  if (value === 'db_write') return 'db_write';
  if (value === 'card_news_render_pending') return 'card_news_render_pending';
  return value;
}

function classifyQueueError(message: string | null | undefined, failureCode?: unknown): string {
  const metaIssue = classifyQueueFailureCode(failureCode);
  if (metaIssue) return metaIssue;
  const text = (message || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('context missing') || text.includes('insufficient context')) return 'context_missing';
  if (text.includes('duplicate') || text.includes('slug already')) return 'duplicate_content';
  if (text.includes('keyword_density')) return 'keyword_density';
  if (text.includes('structure_integrity')) return 'structure_integrity';
  if (text.includes('intent_quality')) return 'intent_quality';
  if (text.includes('topic_fit') || text.includes('intent_mismatch')) return 'topic_fit';
  if (text.includes('editorial')) return 'editorial_quality';
  if (text.includes('seo')) return 'seo_score';
  if (text.includes('constraint')) return 'schema_constraint';
  if (text.includes('self-heal') || text.includes('self_heal')) return 'self_heal_blocked';
  if (text.includes('image')) return 'image_quality';
  if (text.includes('timeout')) return 'timeout';
  return 'other';
}

function hasObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function seoScoreValue(value: unknown): number {
  if (hasObject(value) && 'score' in value) return asNumber(value.score);
  return asNumber(value);
}

function hasContentBrief(meta: Record<string, unknown> | null | undefined): boolean {
  return hasObject(meta?.content_brief);
}

function hasInlineImageEvidence(row: PostRow): boolean {
  if (typeof row.og_image_url === 'string' && row.og_image_url.trim()) return true;
  const body = typeof row.blog_html === 'string' ? row.blog_html : '';
  return /!\[[^\]]*]\([^)]+\)|<img\b[^>]*\bsrc=/i.test(body);
}

function extractQualityGateFailureCodes(qualityGate: Record<string, unknown> | null | undefined): string[] {
  if (!hasObject(qualityGate)) return ['quality_gate_missing'];

  const codes: string[] = [];
  if (Array.isArray(qualityGate.gates)) {
    for (const gate of qualityGate.gates) {
      if (!hasObject(gate) || gate.passed !== false) continue;
      const code = typeof gate.gate === 'string' ? gate.gate : 'quality_gate_failed';
      codes.push(`quality_gate_${code}`);
    }
  }

  if (Array.isArray(qualityGate.issues)) {
    for (const issue of qualityGate.issues) {
      if (!hasObject(issue)) continue;
      const code = typeof issue.code === 'string'
        ? issue.code
        : typeof issue.gate === 'string'
          ? issue.gate
          : null;
      if (code) codes.push(`quality_gate_${code}`);
    }
  }

  if (qualityGate.passed === false && codes.length === 0) {
    codes.push('quality_gate_failed');
  }

  return [...new Set(codes)];
}

function isSlugQualityIssue(code: string): boolean {
  return /(?:^|_)slug(?:_|$)|duplicate_content|canonical_mismatch/i.test(code);
}

export function classifyPublishedBlogQualityIssues(row: PostRow): string[] {
  const issues: string[] = [];
  const body = typeof row.blog_html === 'string' ? row.blog_html.trim() : '';
  const seoScore = seoScoreValue(row.seo_score);
  const readabilityScore = asNumber(row.readability_score);

  if (!row.slug?.trim()) issues.push('slug_missing');
  if (!row.seo_title?.trim() || !row.seo_description?.trim()) issues.push('metadata_missing');
  if (body.replace(/\s+/g, '').length < 80) issues.push('body_missing');
  if (!hasInlineImageEvidence(row)) issues.push('image_missing');
  if (!hasContentBrief(row.generation_meta)) issues.push('content_brief_missing');

  if (!hasObject(row.quality_gate)) {
    issues.push('quality_gate_missing');
  } else {
    issues.push(...extractQualityGateFailureCodes(row.quality_gate));
  }

  if (row.seo_score == null) {
    issues.push('seo_score_missing');
  } else if (seoScore > 0 && seoScore < 95) {
    issues.push('seo_score_low');
  }

  if (row.readability_score == null || row.readability_score === '') {
    issues.push('readability_score_missing');
  } else if (readabilityScore > 0 && readabilityScore < 95) {
    issues.push('readability_score_low');
  }

  const destinationIssue = classifyDestinationlessInfoCandidate({
    id: row.id,
    slug: row.slug,
    seo_title: row.seo_title,
    destination: row.destination,
    primary_keyword: row.primary_keyword,
    category: row.category,
    status: row.status,
    product_id: row.product_id,
    source: 'content_creatives',
    generation_meta: row.generation_meta,
  });
  if (destinationIssue && destinationIssue !== 'intentionally_generic') {
    issues.push(`info_destination_${destinationIssue}`);
  }

  return [...new Set(issues)];
}

export function summarizePublishedBlogQuality(rows: PostRow[], limit = 30) {
  const checkedRows = rows.slice(0, Math.max(1, limit));
  const buckets: Record<string, number> = {};
  const failedSamples: Array<{
    id: string;
    slug: string | null;
    title: string | null;
    published_at: string | null;
    issues: string[];
    slug_only: boolean;
  }> = [];

  for (const row of checkedRows) {
    const issues = classifyPublishedBlogQualityIssues(row);
    if (issues.length === 0) continue;

    for (const issue of issues) {
      buckets[issue] = (buckets[issue] ?? 0) + 1;
    }

    failedSamples.push({
      id: row.id,
      slug: row.slug,
      title: row.seo_title,
      published_at: row.published_at,
      issues,
      slug_only: issues.every(isSlugQualityIssue),
    });
  }

  const slugOnlyFailureCount = failedSamples.filter((sample) => sample.slug_only).length;
  const nonSlugFailureCount = failedSamples.length - slugOnlyFailureCount;

  return {
    checked_count: checkedRows.length,
    blocking_count: failedSamples.length,
    non_slug_failure_count: nonSlugFailureCount,
    slug_only_failure_count: slugOnlyFailureCount,
    buckets,
    samples: failedSamples.slice(0, 12),
  };
}

function summarizeEngineCategoryScorecard(rows: PostRow[], limit = 30) {
  const checkedRows = rows.slice(0, Math.max(1, limit));
  const failedCategoryBuckets: Record<string, number> = {};
  const samples: Array<{
    id: string;
    slug: string | null;
    title: string | null;
    writer: string;
    score: number;
    failed_categories: string[];
  }> = [];
  let perfectCount = 0;
  let scoreTotal = 0;

  for (const row of checkedRows) {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: row.blog_html ?? '',
      primaryKeyword: row.primary_keyword ?? row.destination ?? row.seo_title ?? row.slug,
      destination: row.destination,
      contentType: row.content_type ?? (row.product_id ? 'package_intro' : 'guide'),
      productId: row.product_id ?? null,
      generationMeta: row.generation_meta ?? null,
    });
    scoreTotal += evaluation.score;
    const failedCategories = evaluation.category_scores
      .filter((category) => !category.passed || category.score < 100)
      .map((category) => category.id);

    if (evaluation.passed && failedCategories.length === 0 && evaluation.score === 100) {
      perfectCount += 1;
      continue;
    }

    for (const category of failedCategories) {
      failedCategoryBuckets[category] = (failedCategoryBuckets[category] ?? 0) + 1;
    }
    samples.push({
      id: row.id,
      slug: row.slug,
      title: row.seo_title,
      writer: evaluation.brief.writer_type,
      score: evaluation.score,
      failed_categories: failedCategories,
    });
  }

  const checkedCount = checkedRows.length;
  return {
    checked_count: checkedCount,
    perfect_count: perfectCount,
    below_100_count: checkedCount - perfectCount,
    average_score: checkedCount > 0 ? Math.round(scoreTotal / checkedCount) : 0,
    failed_category_buckets: failedCategoryBuckets,
    samples: samples.slice(0, 8),
  };
}

function sumBuckets(buckets: Record<string, number>, matcher: (bucket: string) => boolean): number {
  return Object.entries(buckets).reduce((sum, [bucket, count]) => sum + (matcher(bucket) ? count : 0), 0);
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

function isManualReviewQueue(row: QueueRow): boolean {
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {};
  return row.status === 'failed' && (
    meta.self_heal_blocked === true ||
    Boolean(meta.quarantine_reason) ||
    Boolean(meta.self_heal_closed_at)
  );
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
    generationRuns,
    searchFollowups,
    searchCorrections,
    seoAuditRuns,
    adapterBenchmarks,
  ] = await Promise.all([
    settle<QueueRow>('blog_topic_queue', supabase.from('blog_topic_queue').select('*').order('created_at', { ascending: false }).limit(500), warnings),
    settle<PostRow>(
      'content_creatives',
      supabase
        .from('content_creatives')
        .select('id, slug, seo_title, seo_description, og_image_url, blog_html, status, published_at, readability_score, seo_score, quality_gate, generation_meta, destination, product_id, angle_type, category, content_type')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(500),
      warnings,
    ),
    settle<IndexingJobRow>(
      'blog_indexing_jobs',
      supabase
        .from('blog_indexing_jobs')
        .select('status, content_creative_id, slug, url')
        .order('updated_at', { ascending: false })
        .limit(1000),
      warnings,
    ),
    settle<IndexingReportRow>(
      'indexing_reports',
      supabase
        .from('indexing_reports')
        .select('url, google_status, google_error, google_index_verdict, google_coverage_state, indexnow_status, indexnow_error, reported_at, search_lifecycle_status, provider_receipt_status, classification_version')
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
    settle<GenerationRunRow>(
      'blog_generation_runs',
      supabase.from('blog_generation_runs').select('id,status,disposition,attempt_count,latest_quality_score,content_creative_id,updated_at').order('updated_at', { ascending: false }).limit(500),
      warnings,
    ),
    settle<SearchFollowupRow>(
      'blog_search_followup_jobs',
      supabase.from('blog_search_followup_jobs').select('milestone_days,status,attempt_count').order('due_at', { ascending: false }).limit(500),
      warnings,
    ),
    settle<SearchCorrectionRow>(
      'blog_search_correction_queue',
      supabase.from('blog_search_correction_queue').select('correction_type,status').order('created_at', { ascending: false }).limit(500),
      warnings,
    ),
    settle<SeoAuditRunRow>(
      'blog_seo_audit_runs',
      supabase.from('blog_seo_audit_runs').select('id,status,started_at,completed_at,summary').order('started_at', { ascending: false }).limit(2),
      warnings,
    ),
    settle<AdapterBenchmarkRow>(
      'blog_adapter_benchmarks',
      supabase.from('blog_adapter_benchmarks').select('adapter,adapter_version,sample_size,extraction_success_count,factual_fidelity_count,ssrf_security_passed,latency_p95_ms,precision,recall,passed,evaluated_at').order('evaluated_at', { ascending: false }).limit(20),
      warnings,
    ),
  ]);

  const queueCounts = countBy(queueRows, (row) => row.status);
  const postById = new Map(postRows.map((row) => [row.id, row]));
  const publishedQueueRows = queueRows.filter((row) => row.status === 'published');
  const publishedStateMismatches = publishedQueueRows.filter((row) => {
    const post = row.content_creative_id ? postById.get(row.content_creative_id) : null;
    return !post || post.status !== 'published';
  });
  const activeQueue = queueRows.filter((row) => isRecentOrDueQueue(row, now));
  const hiddenHistory = queueRows.filter((row) => !isRecentOrDueQueue(row, now)).length;
  const overdueQueued = queueRows.filter((row) => row.status === 'queued' && row.target_publish_at && new Date(row.target_publish_at) < now).length;
  const staleGenerating = queueRows.filter((row) => row.status === 'generating' && row.created_at && now.getTime() - new Date(row.created_at).getTime() > 90 * 60 * 1000).length;
  const manualReviewQueue = queueRows.filter(isManualReviewQueue);
  const retryableFailedQueue = queueRows.filter((row) => row.status === 'failed' && !isManualReviewQueue(row));
  const failureBuckets = countBy(queueRows.filter((row) => row.status === 'failed'), (row) => classifyQueueError(row.last_error, row.meta?.failure_code));
  const queueFailureGroups = {
    slug_failures: sumBuckets(failureBuckets, (bucket) => /slug|duplicate_content/i.test(bucket)),
    non_slug_failures: sumBuckets(failureBuckets, (bucket) => !/slug|duplicate_content|indexing|indexnow|google|sitemap/i.test(bucket)),
    indexing_failures: sumBuckets(failureBuckets, (bucket) => /indexing|indexnow|google|sitemap/i.test(bucket)),
    stuck_queue_rows: overdueQueued + staleGenerating,
  };
  const editorialBacklogWork = buildBlogEditorialBacklogWorkReport({
    rows: queueRows,
    limit: 12,
    now,
  });

  const publishedRows = postRows.filter((row) => row.status === 'published');
  const publishedToday = publishedRows.filter((row) => row.published_at && new Date(row.published_at) >= todayStart && new Date(row.published_at) < tomorrowStart).length;
  const publishedYesterday = publishedRows.filter((row) => row.published_at && new Date(row.published_at) >= yesterdayStart && new Date(row.published_at) < todayStart).length;
  const policy = policyRows[0] || {};
  const autopublishPolicy = readBlogAutopublishPolicyV3();
  const configuredDailyTarget = policy.enabled === false
    ? 0
    : Math.min(5, Math.max(0, Math.round(asNumber(policy.posts_per_day))));
  const effectiveDailyTarget = normalizeDailyPostTarget(configuredDailyTarget);
  const publicPublicationEnabled = policy.enabled !== false
    && autopublishPolicy.mode !== 'draft_only'
    && effectiveDailyTarget > 0;
  const publicDailyTarget = publicPublicationEnabled ? effectiveDailyTarget : 0;
  const generatedCanaryRequested = Math.min(5, Math.max(3, effectiveDailyTarget));
  const qualitySummary = summarizePublishedBlogQuality(publishedRows, 30);
  const engineCategoryScorecard = summarizeEngineCategoryScorecard(publishedRows, 30);
  const lowQualityRecent = qualitySummary.non_slug_failure_count;

  const indexingCounts = countBy(indexingJobs, (row) => row.status);
  const indexingActive = indexingJobs.filter((row) => !['succeeded', 'done', 'completed'].includes(String(row.status || ''))).length;
  const indexingCoverage = summarizeBlogIndexingCoverage({
    posts: publishedRows.slice(0, 30).map((row) => ({
      id: row.id,
      slug: row.slug,
      published_at: row.published_at,
    })),
    jobs: indexingJobs,
    limit: 30,
  });
  const recentIndexingFailures = indexingReports.filter((row) => row.google_error || row.indexnow_error || row.google_status === 'error' || row.indexnow_status === 'error').length;
  const googleUnknownUrls = indexingReports.filter((row) =>
    isCanonicalGoogleInspectionUrl(row.url)
    && String(row.google_coverage_state || '').includes('알려지지 않은 URL')
  ).length;
  const indexingFailureBuckets = {
    outbox_missing: indexingCoverage.missing_count,
    provider_failures: recentIndexingFailures,
    active_jobs: indexingActive,
    google_unknown_urls: googleUnknownUrls,
  };
  const googleIndexedReports = indexingReports.filter((row) => String(row.google_index_verdict || '').toUpperCase() === 'PASS').length;
  const indexNowOk = indexingReports.filter((row) =>
    ['ok', 'success', 'succeeded'].includes(String(row.indexnow_status || '').toLowerCase()),
  ).length;
  const indexNowKnown = indexingReports.filter((row) => row.indexnow_status).length;
  const indexNowSuccessRate = indexNowKnown ? Math.round((indexNowOk / indexNowKnown) * 1000) / 10 : null;
  const searchLifecycleCounts = countBy(indexingReports, (row) => row.search_lifecycle_status);
  const lifecycleTotal = indexingReports.filter((row) => row.classification_version).length;
  const lifecycleRate = (statuses: string[]) => lifecycleTotal > 0
    ? Math.round((indexingReports.filter((row) => statuses.includes(String(row.search_lifecycle_status))).length / lifecycleTotal) * 1000) / 10
    : null;
  const followupCounts = countBy(searchFollowups, (row) => row.status);
  const correctionCounts = countBy(searchCorrections, (row) => `${row.status || 'unknown'}:${row.correction_type || 'unknown'}`);

  const generationStageCounts = countBy(generationRuns, (row) => row.status);
  const previewPendingRuns = generationRuns.filter((row) => row.disposition === 'browser_preview_pending').length;
  const v4QualityDecisions = postRows.flatMap((row) => {
    const decision = row.generation_meta?.quality_decision_v4;
    return decision && typeof decision === 'object' ? [decision as Record<string, unknown>] : [];
  });
  const browserPreviewEvidence = postRows.flatMap((row) => {
    const evidence = row.generation_meta?.browser_preview_v4;
    return evidence && typeof evidence === 'object' ? [evidence as Record<string, unknown>] : [];
  });
  const browserPublicEvidence = postRows.flatMap((row) => {
    const evidence = row.generation_meta?.browser_public_v4;
    return evidence && typeof evidence === 'object' ? [evidence as Record<string, unknown>] : [];
  });
  const qualityDecisionPasses = v4QualityDecisions.filter((decision) => decision.passed === true).length;
  const browserPreviewPasses = browserPreviewEvidence.filter((evidence) => (
    evidence.passed === true && asNumber(evidence.score) >= 95
  )).length;
  const browserPublicPasses = browserPublicEvidence.filter((evidence) => (
    evidence.passed === true && asNumber(evidence.score) >= 95
  )).length;
  const latestSeoAudit = seoAuditRuns[0] ?? null;
  const seoAuditCritical = asNumber(latestSeoAudit?.summary?.critical);
  const seoAuditLevel: BlogOpsLevel = !latestSeoAudit
    ? 'watch'
    : latestSeoAudit.status === 'failed' || seoAuditCritical > 0
      ? 'risk'
      : latestSeoAudit.status === 'partial'
        ? 'watch'
        : 'healthy';
  const latestBenchmarkByAdapter = new Map<string, AdapterBenchmarkRow>();
  for (const row of adapterBenchmarks) if (!latestBenchmarkByAdapter.has(row.adapter)) latestBenchmarkByAdapter.set(row.adapter, row);
  const crawl4aiBenchmark = latestBenchmarkByAdapter.get('crawl4ai') ?? null;
  const doclingBenchmark = latestBenchmarkByAdapter.get('docling') ?? null;
  const koreanSemanticBenchmark = latestBenchmarkByAdapter.get('korean_semantic') ?? null;
  const adapterReadiness = {
    crawl4ai: isExternalAdapterBenchmarkPassingV4(crawl4aiBenchmark as BlogExternalAdapterBenchmarkRowV4 | null),
    docling: isExternalAdapterBenchmarkPassingV4(doclingBenchmark as BlogExternalAdapterBenchmarkRowV4 | null),
    korean_semantic: isKoreanSemanticBenchmarkPassingV4(koreanSemanticBenchmark as BlogKoreanSemanticBenchmarkRowV4 | null),
  };

  const blogCronNames = new Set([
    'blog-daily-summary',
    'blog-indexing-worker',
    'blog-orchestrator',
    'blog-generate',
    'blog-publication-controller',
    'blog-search-lifecycle',
    'blog-seo-weekly-audit',
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
  const publisherCron = blogCrons.find((row) => row.cron_name === 'blog-publication-controller') ?? null;
  const currentDayPublisherHealth = evaluateCurrentDayPublisherHealth({
    cronHealth: publisherCron,
    now,
    currentDayPublishedCount: publishedToday,
    dailyTarget: effectiveDailyTarget,
  });

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

  const dailyLevel: BlogOpsLevel = !publicPublicationEnabled
    ? 'blocked'
    : publishedToday >= publicDailyTarget ? 'healthy' : publishedYesterday < publicDailyTarget ? 'risk' : 'watch';
  const queueLevel: BlogOpsLevel = retryableFailedQueue.length > 0 || staleGenerating > 0 || publishedStateMismatches.length > 0
    ? 'risk'
    : overdueQueued > 0 || manualReviewQueue.length > 0 ? 'watch' : 'healthy';
  const indexingLevel: BlogOpsLevel = googleUnknownUrls > 0
    || recentIndexingFailures > 0
    || indexingCoverage.missing_count > 0
    || (followupCounts.failed || 0) > 0
    || Object.entries(correctionCounts).some(([key, count]) => key.startsWith('queued:') && count > 0)
    ? 'risk'
    : indexingActive > 0 || (followupCounts.retry || 0) > 0 ? 'watch' : 'healthy';
  const cronLevel: BlogOpsLevel = unhealthyCrons.some((row) => (
    row.cron_name === 'blog-generate' || row.cron_name === 'blog-publication-controller'
  )) ? 'blocked' : unhealthyCrons.length > 0 ? 'risk' : 'healthy';
  const qualityLevel: BlogOpsLevel = qualitySummary.non_slug_failure_count > 0
    ? 'risk'
    : qualitySummary.slug_only_failure_count > 0 ? 'watch' : 'healthy';
  const currentDayPublisherLevel: BlogOpsLevel = currentDayPublisherHealth.status === 'risk' ? 'blocked' : 'healthy';
  const publishableQueueRows = queueRows.filter((row) => row.status === 'queued' || row.status === 'generating');
  const demandSignalsByQueueId = await loadQueueDemandSignalMapV3(publishableQueueRows, supabase);
  const publishabilityStats = countPublishableQueueCandidates({
    activeQueue: publishableQueueRows,
    recentPublished: publishedRows.slice(0, 100),
    demandSignalsByQueueId,
  });
  const researchCompletedCandidates = publishableQueueRows.filter((row) => (
    row.meta?.[BLOG_INFORMATION_RESEARCH_META_KEY]
    && row.meta?.content_brief_v3
  )).length;
  const publishReadyCandidates = publishabilityStats.publishableCount;
  const candidateReadinessLevel: BlogOpsLevel = publishReadyCandidates === 0
    ? 'risk'
    : publishReadyCandidates < 15 || researchCompletedCandidates < 60 ? 'watch' : 'healthy';
  const qualityDecisionFailures = v4QualityDecisions.length - qualityDecisionPasses;
  const browserPreviewFailures = browserPreviewEvidence.length - browserPreviewPasses;
  const browserPublicFailures = browserPublicEvidence.length - browserPublicPasses;
  const v4QualityLevel: BlogOpsLevel = qualityDecisionFailures > 0
    || browserPreviewFailures > 0
    || browserPublicFailures > 0
    || previewPendingRuns > 0
    ? 'risk'
    : generationRuns.some((row) => row.status === 'approved_for_slot') && browserPreviewEvidence.length === 0
      ? 'risk'
      : 'healthy';
  const candidateContractBlocked = publishabilityStats.candidateContractBlocked;
  const preflight = evaluateBlogPublishPreflight({
    dailyTarget: effectiveDailyTarget,
    publishedToday,
    publishableCandidateCount: publishabilityStats.publishableCount,
    duplicateCandidateCount: publishabilityStats.blockedRecentDuplicate + publishabilityStats.duplicateQueued,
    evidenceInsufficientCount: publishabilityStats.evidenceInsufficient
      + publishabilityStats.productOpenContractBlocked
      + publishabilityStats.researchNotReady
      + publishabilityStats.demandMissing,
    candidateShortage: publishabilityStats.publishableCount < effectiveDailyTarget * MIN_PUBLISHABLE_BUFFER_DAYS,
    actionableFailedCount: retryableFailedQueue.length,
    staleGeneratingCount: staleGenerating,
    manualReviewCount: manualReviewQueue.length,
    overdueQueuedCount: overdueQueued,
    indexingOutboxMissingCount: indexingCoverage.missing_count,
    indexingOutboxCoverageRate: indexingCoverage.coverage_rate,
    recentPosts: publishedRows.slice(0, 8),
    bufferDays: MIN_PUBLISHABLE_BUFFER_DAYS,
  });
  const preflightLevel: BlogOpsLevel = preflight.status === 'block' ? 'risk' : preflight.status === 'warn' ? 'watch' : 'healthy';
  const canaryPreflight = buildBlogCanaryPreflight({
    activeQueue: queueRows.filter((row) => row.status === 'queued' || row.status === 'generating'),
    recentPublished: publishedRows.slice(0, 100),
    requested: 3,
  });
  const canaryProductIds = Array.from(new Set(
    queueRows
      .filter((row) => (row.status === 'queued' || row.status === 'generating') && row.product_id)
      .map((row) => String(row.product_id)),
  )).slice(0, 12);
  const productCanaryPackages = canaryProductIds.length > 0
    ? await settle<any>(
      'travel_packages_canary',
      supabase.from('travel_packages').select('*').in('id', canaryProductIds),
      warnings,
    )
    : [];
  const productGeneratedCanaryRows = buildProductGeneratedCanaryRows({
    queueRows: queueRows.filter((row) => row.status === 'queued' || row.status === 'generating'),
    products: productCanaryPackages,
    limit: Math.min(3, Math.max(2, generatedCanaryRequested - 2)),
  });
  const generatedCanaryQuality = await evaluateBlogGeneratedQualityCanaryReport({
    posts: [...publishedRows.slice(0, 8), ...productGeneratedCanaryRows],
    requested: generatedCanaryRequested,
    writerMixRequired: productGeneratedCanaryRows.length > 0,
  });
  const fleetPhraseDrift = inspectBlogFleetPhraseDrift(
    publishedRows.slice(0, 100).map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.seo_title,
      blog_html: row.blog_html,
      writer_type: row.generation_meta?.writer as string | null | undefined,
    })),
  );
  const canaryLevel: BlogOpsLevel = canaryPreflight.status === 'block' ? 'risk' : canaryPreflight.status === 'warn' ? 'watch' : 'healthy';
  const generatedCanaryLevel: BlogOpsLevel = generatedCanaryQuality.status === 'block' ? 'risk' : generatedCanaryQuality.status === 'warn' ? 'watch' : 'healthy';
  const fleetPhraseLevel: BlogOpsLevel = fleetPhraseDrift.status === 'block' ? 'risk' : fleetPhraseDrift.status === 'warn' ? 'watch' : 'healthy';
  const candidateContractLevel: BlogOpsLevel = candidateContractBlocked > 0 ? 'watch' : 'healthy';
  const overallLevel = maxLevel(dailyLevel, queueLevel, indexingLevel, cronLevel, qualityLevel, v4QualityLevel, candidateReadinessLevel, preflightLevel, canaryLevel, generatedCanaryLevel, fleetPhraseLevel, currentDayPublisherLevel, candidateContractLevel, seoAuditLevel);

  const nextActions: Array<{ severity: BlogOpsLevel; title: string; detail: string; href: string; action?: string }> = [];
  if (!publicPublicationEnabled) {
    nextActions.push({
      severity: 'blocked',
      title: '자동발행 안전정지 확인',
      detail: `현재 ${autopublishPolicy.mode} 모드입니다. 공개 발행은 중지되고 초안·검수 대기까지만 진행됩니다.`,
      href: '/admin/blog/policy',
    });
  } else if (publishedToday < publicDailyTarget) {
    nextActions.push({
      severity: dailyLevel,
      title: '오늘 발행 목표 미달',
      detail: `오늘 ${publishedToday}/${publicDailyTarget}편 발행됨. 발행 큐와 글 발행자 상태를 같이 확인하세요.`,
      href: '/admin/blog/queue',
      action: 'run_publisher',
    });
  }
  if (publishReadyCandidates === 0) {
    nextActions.push({
      severity: 'risk',
      title: '발행 준비 후보 없음',
      detail: `연구 완료 ${researchCompletedCandidates}/60건, 발행 준비 0/15건입니다. 후보가 없는 상태는 정상으로 표시하지 않습니다.`,
      href: '/admin/blog/queue',
    });
  }
  if (previewPendingRuns > 0 || browserPreviewFailures > 0 || browserPublicFailures > 0) {
    nextActions.push({
      severity: 'risk',
      title: '실제 브라우저 검사 차단',
      detail: `검사 대기 ${previewPendingRuns}건, 공개 전 실패 ${browserPreviewFailures}건, 공개 후 실패 ${browserPublicFailures}건입니다.`,
      href: '/admin/blog/system',
    });
  }
  if (!latestSeoAudit || latestSeoAudit.status === 'failed' || seoAuditCritical > 0) {
    nextActions.push({
      severity: latestSeoAudit ? 'risk' : 'watch',
      title: latestSeoAudit ? '주간 SEO 감사 조치 필요' : '주간 SEO 감사 증거 없음',
      detail: latestSeoAudit
        ? `최신 감사 상태 ${latestSeoAudit.status}, critical ${seoAuditCritical}건입니다. 자동 수정 없이 finding 원장을 확인하세요.`
        : '첫 주간 SEO 감사를 실행해 canonical·Sitemap·렌더·GSC·CrUX 기준선을 만드세요.',
      href: '/admin/blog/system',
    });
  }
  if (retryableFailedQueue.length > 0) {
    nextActions.push({
      severity: 'risk',
      title: '실패 큐 정리 필요',
      detail: `재시도 가능한 실패 ${retryableFailedQueue.length}건. 원인별로 재시도 또는 숨김 처리하세요.`,
      href: '/admin/blog/queue?scope=attention',
    });
  }
  if (manualReviewQueue.length > 0) {
    nextActions.push({
      severity: 'watch',
      title: '수동 재작성 항목 확인',
      detail: `자동 재시도에서 제외된 글감 ${manualReviewQueue.length}건이 있습니다. 자동발행은 막지 않지만 사람이 주제와 브리프를 다시 잡아야 합니다.`,
      href: '/admin/blog/queue?scope=manual',
    });
  }
  if (publishedStateMismatches.length > 0) {
    nextActions.push({
      severity: 'risk',
      title: '발행 상태 불일치 정리',
      detail: `큐는 발행 완료인데 실제 글 상태가 맞지 않는 항목 ${publishedStateMismatches.length}건. 공개 글 또는 큐 상태를 맞춰야 합니다.`,
      href: '/admin/blog/system',
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
  if (currentDayPublisherHealth.status === 'risk') {
    nextActions.unshift({
      severity: currentDayPublisherLevel,
      title: '오늘 발행자 실패',
      detail: `${currentDayPublisherHealth.detail} 시스템 탭에서 최신 실패 원인을 확인하세요.`,
      href: '/admin/blog/system',
      action: 'run_publisher',
    });
  }
  if (generatedCanaryQuality.status === 'block') {
    nextActions.unshift({
      severity: generatedCanaryLevel,
      title: '생성 글 샘플 품질 실패',
      detail: `${generatedCanaryQuality.fail_count}/${generatedCanaryQuality.checked_count}개 샘플이 엔진·고객문구·렌더링 통합 검사를 통과하지 못했습니다.`,
      href: '/admin/blog/system',
    });
  } else if (generatedCanaryQuality.status === 'warn') {
    nextActions.push({
      severity: generatedCanaryLevel,
      title: '상품/정보성 생성 샘플 검증 보강',
      detail: generatedCanaryQuality.next_action,
      href: '/admin/blog/system',
    });
  }
  if (fleetPhraseDrift.status === 'block') {
    nextActions.unshift({
      severity: fleetPhraseLevel,
      title: '최근 글 말투 반복 차단',
      detail: fleetPhraseDrift.summary,
      href: '/admin/blog/system',
    });
  } else if (fleetPhraseDrift.status === 'warn') {
    nextActions.push({
      severity: fleetPhraseLevel,
      title: '최근 글 말투 반복 주의',
      detail: fleetPhraseDrift.next_action,
      href: '/admin/blog/system',
    });
  }
  if (qualitySummary.non_slug_failure_count > 0) {
    nextActions.push({
      severity: 'risk',
      title: '최근 발행 글 품질 증거 점검',
      detail: `최근 ${qualitySummary.checked_count}개 중 비slug 품질 문제 ${qualitySummary.non_slug_failure_count}건. 주요 버킷: ${Object.keys(qualitySummary.buckets).slice(0, 4).join(', ') || 'unknown'}`,
      href: '/admin/blog/system',
    });
  } else if (qualitySummary.slug_only_failure_count > 0) {
    nextActions.push({
      severity: 'watch',
      title: '최근 발행 글 slug 정리',
      detail: `최근 ${qualitySummary.checked_count}개 중 slug-only 정리 대상 ${qualitySummary.slug_only_failure_count}건. 본문 품질 실패와 분리해 처리하세요.`,
      href: '/admin/blog/system',
    });
  }
  if (googleUnknownUrls > 0) {
    nextActions.push({
      severity: indexingLevel,
      title: '구글 실제 색인 확인 필요',
      detail: `최근 색인 확인 표본 ${googleUnknownUrls}건이 구글에 아직 알려지지 않은 URL입니다. 사이트맵, 서치콘솔, 내부 링크 상태를 분리 확인하세요.`,
      href: '/admin/blog/rankings',
    });
  }
  if (indexingCoverage.missing_count > 0) {
    nextActions.push({
      severity: 'risk',
      title: '색인 작업 누락 확인',
      detail: `최근 공개 글 ${indexingCoverage.checked_count}개 중 ${indexingCoverage.missing_count}개가 색인 작업 기록과 연결되지 않았습니다.`,
      href: '/admin/blog/rankings',
    });
  }
  if (canaryPreflight.status !== 'pass') {
    nextActions.push({
      severity: canaryLevel,
      title: 'Canary 후보 보강',
      detail: `발행 전 canary 후보 ${canaryPreflight.ready_count}/${canaryPreflight.requested}개 준비됨. ${canaryPreflight.next_action}`,
      href: '/admin/blog/queue',
    });
  }
  if (candidateContractBlocked > 0) {
    nextActions.push({
      severity: 'watch',
      title: '발행 후보 문구 정리',
      detail: `현재 큐에서 ${candidateContractBlocked}개 후보가 금지 표현, 숫자형 slug 위험, broad 추천형 계약에 걸립니다. 발행 전 자동 격리되지만 생산 템플릿도 같이 정리해야 합니다.`,
      href: '/admin/blog/queue',
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
      title: '자동 SEO 후보 적체',
      detail: `대기 후보 ${programmaticCounts.pending}건. 토픽 권위 기준으로 승격 대상을 줄이세요.`,
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

  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  const kstMinutes = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
  const slotSuccess = (policy.slot_times || []).slice(0, effectiveDailyTarget).map((slot, index) => {
    const match = /^(\d{2}):(\d{2})$/.exec(slot);
    const slotMinutes = match ? Number(match[1]) * 60 + Number(match[2]) : Number.POSITIVE_INFINITY;
    return {
      slot,
      due: slotMinutes <= kstMinutes,
      succeeded: publishedToday > index,
      status: publishedToday > index ? 'succeeded' : slotMinutes <= kstMinutes ? 'missed' : 'not_due',
    };
  });

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
        ...(!publicPublicationEnabled ? ['autopublish_mode_draft_only'] : []),
        ...(publicPublicationEnabled && dailyLevel === 'risk' ? ['daily_publish_sla'] : []),
        ...(queueLevel === 'risk' ? ['queue_failures_or_stale_generation'] : []),
        ...(publishedStateMismatches.length > 0 ? ['published_state_mismatch'] : []),
        ...(cronLevel === 'risk' || cronLevel === 'blocked' ? ['cron_health'] : []),
        ...(qualityLevel === 'risk' ? ['recent_quality_gate'] : []),
        ...(v4QualityLevel === 'risk' ? ['v4_quality_or_browser_gate'] : []),
        ...(publishReadyCandidates === 0 ? ['publish_ready_candidates_zero'] : []),
        ...(indexingCoverage.missing_count > 0 ? ['indexing_outbox_missing'] : []),
        ...(preflight.status === 'block' ? ['publish_preflight_blocked'] : []),
        ...(canaryPreflight.status === 'block' ? ['canary_candidates_unavailable'] : []),
        ...(generatedCanaryQuality.status === 'block' ? ['generated_canary_quality_failed'] : []),
        ...(fleetPhraseDrift.status === 'block' ? ['fleet_phrase_drift'] : []),
        ...(currentDayPublisherHealth.status === 'risk' ? ['current_day_publisher_failure'] : []),
        ...(googleUnknownUrls > 0 ? ['google_url_unknown'] : []),
        ...(seoAuditLevel === 'risk' ? ['seo_weekly_audit_failed_or_critical'] : []),
      ],
    },
    health_sections: {
      publish: {
        level: dailyLevel,
        failed: dailyLevel === 'risk' || dailyLevel === 'blocked',
        checks: !publicPublicationEnabled
          ? ['autopublish_mode_draft_only']
          : publishedToday >= publicDailyTarget ? [] : ['daily_publish_sla'],
      },
      queue: {
        level: maxLevel(queueLevel, candidateContractLevel),
        failed: queueLevel === 'risk',
        checks: [
          ...(retryableFailedQueue.length > 0 ? ['retryable_failed_queue'] : []),
          ...(staleGenerating > 0 ? ['stale_generating'] : []),
          ...(publishedStateMismatches.length > 0 ? ['published_state_mismatch'] : []),
          ...(candidateContractBlocked > 0 ? ['candidate_pre_publish_contract'] : []),
        ],
      },
      quality: {
        level: maxLevel(qualityLevel, v4QualityLevel, generatedCanaryLevel, fleetPhraseLevel),
        failed: qualitySummary.non_slug_failure_count > 0 || v4QualityLevel === 'risk' || generatedCanaryQuality.status === 'block' || fleetPhraseDrift.status === 'block',
        checks: [
          ...Object.keys(qualitySummary.buckets),
          ...(qualityDecisionFailures > 0 ? ['v4_quality_decision_failed'] : []),
          ...(browserPreviewFailures > 0 || previewPendingRuns > 0 ? ['browser_preview_failed_or_pending'] : []),
          ...(browserPublicFailures > 0 ? ['browser_public_audit_failed'] : []),
          ...(generatedCanaryQuality.status === 'block' ? ['generated_canary_quality_failed'] : []),
          ...(fleetPhraseDrift.status === 'block' ? ['fleet_phrase_drift'] : []),
        ],
      },
      indexing: {
        level: indexingLevel,
        failed: indexingLevel === 'risk',
        checks: [
          ...(indexingCoverage.missing_count > 0 ? ['indexing_outbox_missing'] : []),
          ...(recentIndexingFailures > 0 ? ['indexing_provider_failure'] : []),
          ...(googleUnknownUrls > 0 ? ['google_url_unknown'] : []),
          ...((followupCounts.failed || 0) > 0 ? ['search_followup_failed'] : []),
          ...(Object.keys(correctionCounts).some((key) => key.startsWith('queued:')) ? ['d7_search_correction_queued'] : []),
        ],
      },
      cron: {
        level: cronLevel,
        failed: cronLevel === 'risk' || cronLevel === 'blocked',
        checks: unhealthyCrons.map((row) => row.cron_name).filter(Boolean),
      },
      seo_operations: {
        level: seoAuditLevel,
        failed: seoAuditLevel === 'risk',
        checks: [
          ...(!latestSeoAudit ? ['seo_audit_missing'] : []),
          ...(latestSeoAudit?.status === 'failed' ? ['seo_audit_failed'] : []),
          ...(seoAuditCritical > 0 ? ['seo_audit_critical_findings'] : []),
        ],
      },
    },
    publish: {
      configured_daily_target: configuredDailyTarget,
      effective_daily_target: effectiveDailyTarget,
      daily_publish_cap: autopublishPolicy.dailyPublishCap,
      autopublish_mode: autopublishPolicy.mode,
      requested_autopublish_mode: autopublishPolicy.requestedMode,
      public_publication_enabled: publicPublicationEnabled,
      daily_target: publicDailyTarget,
      published_today: publishedToday,
      published_yesterday: publishedYesterday,
      remaining_today: Math.max(0, publicDailyTarget - publishedToday),
      policy_enabled: policy.enabled !== false,
      per_destination_daily_cap: asNumber(policy.per_destination_daily_cap) || null,
      product_ratio: typeof policy.product_ratio === 'number' ? policy.product_ratio : null,
      slot_times: policy.slot_times || [],
      slot_success: slotSuccess,
      level: dailyLevel,
    },
    queue: {
      counts: queueCounts,
      active_count: activeQueue.length,
      hidden_history: hiddenHistory,
      manual_review_count: manualReviewQueue.length,
      retryable_failed_count: retryableFailedQueue.length,
      published_state_mismatch: publishedStateMismatches.length,
      published_state_mismatch_sample: publishedStateMismatches.slice(0, 8).map((row) => {
        const post = row.content_creative_id ? postById.get(row.content_creative_id) : null;
        return {
          queue_id: row.id,
          topic: row.topic,
          primary_keyword: row.primary_keyword,
          content_creative_id: row.content_creative_id || null,
          article_status: post?.status || null,
          slug: post?.slug || null,
          title: post?.seo_title || null,
          published_at: post?.published_at || null,
        };
      }),
      overdue_queued: overdueQueued,
      stale_generating: staleGenerating,
      failure_buckets: failureBuckets,
      failure_groups: queueFailureGroups,
      candidate_contract_blocked_count: candidateContractBlocked,
      editorial_backlog_work: editorialBacklogWork,
      recent_attention: activeQueue.slice(0, 12),
      level: queueLevel,
    },
    quality: {
      recent_checked: Math.min(30, publishedRows.length),
      low_quality_recent: lowQualityRecent,
      summary: qualitySummary,
      engine_category_scorecard: engineCategoryScorecard,
      fleet_phrase_drift: fleetPhraseDrift,
      failure_buckets: qualitySummary.buckets,
      non_slug_failures: qualitySummary.non_slug_failure_count,
      slug_only_failures: qualitySummary.slug_only_failure_count,
      latest_posts: publishedRows.slice(0, 8).map((row) => {
        const issues = classifyPublishedBlogQualityIssues(row);
        return {
          issues,
          id: row.id,
          slug: row.slug,
          title: row.seo_title,
          destination: row.destination,
          published_at: row.published_at,
          seo_score: seoScoreValue(row.seo_score) || null,
          readability_score: asNumber(row.readability_score) || null,
          quality_passed: issues.length === 0,
          failure_code: row.generation_meta?.failure_code || null,
        };
      }),
      level: qualityLevel,
    },
    preflight,
    canary_preflight: canaryPreflight,
    generated_canary_quality: generatedCanaryQuality,
    autopilot: {
      research_completed_candidates: researchCompletedCandidates,
      research_target: 60,
      publish_ready_candidates: publishReadyCandidates,
      publish_ready_target: 15,
      stage_counts: generationStageCounts,
      retry_count: generationRuns.filter((row) => Number(row.attempt_count || 0) > 1).length,
      quarantine_count: generationRuns.filter((row) => row.status === 'quarantine').length,
      preview_pending_count: previewPendingRuns,
      quality: {
        checked: v4QualityDecisions.length,
        passed: qualityDecisionPasses,
        failed: qualityDecisionFailures,
        pass_rate: v4QualityDecisions.length > 0
          ? Math.round((qualityDecisionPasses / v4QualityDecisions.length) * 1000) / 10
          : null,
      },
      browser_preview: {
        checked: browserPreviewEvidence.length,
        passed: browserPreviewPasses,
        failed: browserPreviewFailures,
        pass_rate: browserPreviewEvidence.length > 0
          ? Math.round((browserPreviewPasses / browserPreviewEvidence.length) * 1000) / 10
          : null,
        required_score: 95,
      },
      browser_public: {
        checked: browserPublicEvidence.length,
        passed: browserPublicPasses,
        failed: browserPublicFailures,
        pass_rate: browserPublicEvidence.length > 0
          ? Math.round((browserPublicPasses / browserPublicEvidence.length) * 1000) / 10
          : null,
        required_score: 95,
      },
      level: maxLevel(candidateReadinessLevel, v4QualityLevel),
    },
    seo_operations: {
      latest_audit: latestSeoAudit,
      level: seoAuditLevel,
      adapter_readiness: adapterReadiness,
      latest_adapter_benchmarks: Object.fromEntries(latestBenchmarkByAdapter),
      automatic_content_changes: 0,
    },
    indexing: {
      job_counts: indexingCounts,
      active_jobs: indexingActive,
      outbox_coverage: indexingCoverage,
      recent_failures: recentIndexingFailures,
      failure_buckets: indexingFailureBuckets,
      google_unknown_urls: googleUnknownUrls,
      google_indexed_reports: googleIndexedReports,
      inspected_reports: indexingReports.length,
      indexnow_success_rate: indexNowSuccessRate,
      recent_reports: indexingReports.slice(0, 8),
      lifecycle_counts: searchLifecycleCounts,
      submission_rate: lifecycleRate(['submitted', 'received', 'discovered', 'crawled', 'indexed', 'ranking']),
      discovery_rate: lifecycleRate(['discovered', 'crawled', 'indexed', 'ranking']),
      actual_index_rate: lifecycleRate(['indexed', 'ranking']),
      ranking_rate: lifecycleRate(['ranking']),
      followup_counts: followupCounts,
      correction_counts: correctionCounts,
      level: indexingLevel,
    },
    cron: {
      level: cronLevel,
      unhealthy_count: unhealthyCrons.length,
      current_day_publisher_health: currentDayPublisherHealth,
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
