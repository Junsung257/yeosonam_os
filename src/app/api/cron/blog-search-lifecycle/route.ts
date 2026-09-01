import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { isGSCApiConfigured, inspectUrlIndexState, type UrlInspectionResult } from '@/lib/gsc-api';
import { buildGscSearchSiteUrlCandidates } from '@/lib/gsc-site-url';
import { submitGoogleSitemap } from '@/lib/gsc-client';
import {
  buildGoogleVisibilitySnapshot,
  googleInspectionToIndexStatus,
  recordBlogVisibilitySnapshot,
} from '@/lib/blog-visibility-snapshots';
import {
  BLOG_AUTOPILOT_PIPELINE_VERSION,
  BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
  BLOG_SEARCH_CLASSIFICATION_VERSION,
  readBlogDeploymentCommitShaV4,
  resolveBlogSearchLifecycleStatus,
  resolveProviderReceiptStatus,
} from '@/lib/blog-autopilot-v4-contract';
import {
  decideBlogSearchFollowupV4,
  nextBlogSearchFollowupRetryV4,
  type BlogSearchFollowupMilestoneV4,
} from '@/lib/blog-search-followup-v4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_JOBS_PER_RUN = 10;

async function inspectAcrossProperties(url: string, baseUrl: string) {
  const errors: string[] = [];
  for (const siteUrl of buildGscSearchSiteUrlCandidates(process.env.GSC_SITE_URL, { canonicalOrigin: baseUrl })) {
    const result = await inspectUrlIndexState(siteUrl, url);
    if (!result.error) return { result, siteUrl, errors };
    errors.push(`${siteUrl}:${result.error}`);
  }
  const empty: UrlInspectionResult = {
    url,
    verdict: null,
    coverageState: null,
    indexingState: null,
    lastCrawlTime: null,
    pageFetchState: null,
    robotsTxtState: null,
    googleCanonical: null,
    userCanonical: null,
    error: errors.join(' | '),
  };
  return { result: empty, siteUrl: null, errors };
}

async function runBlogSearchLifecycle(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseAdminConfigured) return { skipped: true, reason: 'supabase_admin_not_configured' };
  if (!isGSCApiConfigured()) return { skipped: true, reason: 'gsc_not_configured' };

  const now = new Date();
  const baseUrl = String(
    process.env.BLOG_CANONICAL_ORIGIN
    || process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || 'https://www.yeosonam.com',
  ).replace(/\/+$/, '');
  const { data: jobs, error: jobsError } = await supabaseAdmin
    .from('blog_search_followup_jobs')
    .select('id,content_creative_id,slug,url,milestone_days,status,attempt_count,due_at')
    .in('status', ['queued', 'retry'])
    .lte('due_at', now.toISOString())
    .lte('next_attempt_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(MAX_JOBS_PER_RUN);
  if (jobsError) return { errors: [`followup_query_failed:${jobsError.message}`] };

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  for (const job of jobs ?? []) {
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('blog_search_followup_jobs')
      .update({ status: 'processing', updated_at: now.toISOString() })
      .eq('id', job.id)
      .in('status', ['queued', 'retry'])
      .select('id')
      .maybeSingle();
    if (claimError || !claimed) continue;

    const inspected = await inspectAcrossProperties(String(job.url), baseUrl);
    if (inspected.result.error) {
      const retry = nextBlogSearchFollowupRetryV4(Number(job.attempt_count || 0), now);
      await supabaseAdmin.from('blog_search_followup_jobs').update({
        status: retry.status,
        attempt_count: retry.attemptCount,
        next_attempt_at: retry.nextAttemptAt,
        last_error: inspected.result.error.slice(0, 1_000),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id).eq('status', 'processing');
      errors.push(`followup_inspection_failed:${job.id}:${inspected.result.error}`);
      results.push({ jobId: job.id, status: retry.status });
      continue;
    }

    const evidence = {
      verdict: inspected.result.verdict,
      coverage_state: inspected.result.coverageState,
      indexing_state: inspected.result.indexingState,
      last_crawl_time: inspected.result.lastCrawlTime,
      page_fetch_state: inspected.result.pageFetchState,
      robots_txt_state: inspected.result.robotsTxtState,
      google_canonical: inspected.result.googleCanonical,
      user_canonical: inspected.result.userCanonical,
      milestone_days: job.milestone_days,
      gsc_site_url: inspected.siteUrl,
    };
    const indexStatus = googleInspectionToIndexStatus(evidence);
    const providerReceiptStatus = resolveProviderReceiptStatus({ verificationOnly: true });
    const lifecycleStatus = resolveBlogSearchLifecycleStatus({
      requestStatus: 'requested',
      providerReceiptStatus,
      indexStatus,
      coverageState: inspected.result.coverageState,
      pageFetchState: inspected.result.pageFetchState,
      lastCrawlTime: inspected.result.lastCrawlTime,
    });
    const { error: reportError } = await supabaseAdmin.from('indexing_reports').insert({
      url: job.url,
      content_creative_id: job.content_creative_id,
      google_status: indexStatus === 'indexed' ? 'indexed' : 'not_indexed',
      google_error: null,
      indexnow_status: 'skipped',
      indexnow_error: null,
      sitemap_pings: [],
      google_index_verdict: inspected.result.verdict,
      google_coverage_state: inspected.result.coverageState,
      google_indexing_state: inspected.result.indexingState,
      google_last_crawl_time: inspected.result.lastCrawlTime,
      google_page_fetch_state: inspected.result.pageFetchState,
      google_canonical: inspected.result.googleCanonical,
      user_canonical: inspected.result.userCanonical,
      search_lifecycle_status: lifecycleStatus,
      provider_receipt_status: providerReceiptStatus,
      classification_version: BLOG_SEARCH_CLASSIFICATION_VERSION,
      provider_raw_response: inspected.result.raw ?? evidence,
      pipeline_version: BLOG_AUTOPILOT_PIPELINE_VERSION,
      deployment_commit_sha: readBlogDeploymentCommitShaV4(),
      schema_migration_version: BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
    });
    if (reportError) {
      errors.push(`followup_report_insert_failed:${job.id}:${reportError.message}`);
      await supabaseAdmin.from('blog_search_followup_jobs').update({
        status: 'failed', last_error: reportError.message, updated_at: new Date().toISOString(),
      }).eq('id', job.id).eq('status', 'processing');
      continue;
    }
    await recordBlogVisibilitySnapshot(supabaseAdmin, buildGoogleVisibilitySnapshot({
      slug: String(job.slug),
      url: String(job.url),
      requestStatus: 'requested',
      evidence,
      source: `gsc_d_plus_${job.milestone_days}`,
    }));

    const decision = decideBlogSearchFollowupV4({
      milestoneDays: Number(job.milestone_days) as BlogSearchFollowupMilestoneV4,
      indexStatus,
      lifecycleStatus,
      pageFetchState: inspected.result.pageFetchState,
      userCanonical: inspected.result.userCanonical,
      inspectedUrl: String(job.url),
    });
    let sitemapResubmitted = false;
    let sitemapError: string | null = null;
    if (decision.resubmitSitemap) {
      const sitemap = await submitGoogleSitemap(`${baseUrl}/sitemap.xml`, baseUrl);
      sitemapResubmitted = sitemap.ok;
      sitemapError = sitemap.error ?? null;
    }
    if (decision.correctionType) {
      const correction = await supabaseAdmin.from('blog_search_correction_queue').upsert({
        content_creative_id: job.content_creative_id,
        followup_job_id: job.id,
        url: job.url,
        correction_type: decision.correctionType,
        reason: decision.reason,
        evidence: { ...evidence, index_status: indexStatus, lifecycle_status: lifecycleStatus },
        status: 'queued',
      }, { onConflict: 'content_creative_id,correction_type,status', ignoreDuplicates: true });
      if (correction.error) errors.push(`correction_queue_failed:${job.id}:${correction.error.message}`);
    }
    const { error: completeError } = await supabaseAdmin.from('blog_search_followup_jobs').update({
      status: decision.outcome,
      attempt_count: Number(job.attempt_count || 0) + 1,
      checked_at: new Date().toISOString(),
      last_error: sitemapError,
      result: {
        version: BLOG_SEARCH_CLASSIFICATION_VERSION,
        index_status: indexStatus,
        lifecycle_status: lifecycleStatus,
        reason: decision.reason,
        sitemap_resubmitted: sitemapResubmitted,
        correction_type: decision.correctionType,
      },
      updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('status', 'processing');
    if (completeError) errors.push(`followup_completion_failed:${job.id}:${completeError.message}`);
    results.push({ jobId: job.id, milestoneDays: job.milestone_days, status: decision.outcome, indexStatus, lifecycleStatus });
  }

  return { processed: results.length, results, errors };
}

export const GET = withCronLogging('blog-search-lifecycle', runBlogSearchLifecycle, {
  handlerTimeoutMs: 285_000,
});
