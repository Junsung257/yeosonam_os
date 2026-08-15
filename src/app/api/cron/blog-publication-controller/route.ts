import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { calculateBlogPublishSlotQuota } from '@/lib/blog-publish-slot-quota';
import { readBlogInformationRepresentativeIdentity } from '@/lib/blog-information-representative';
import { createBlogInformationContentFingerprint } from '@/lib/blog-information-review-workflow';
import { publishBlogInformationAtomically } from '@/lib/blog-information-atomic-publication';
import { enqueueBlogIndexingJob } from '@/lib/blog-indexing-outbox';
import { processDueBlogIndexingJobs } from '@/lib/blog-indexing-worker';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

function kstDayRange(now = new Date()): { start: string; end: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000;
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() };
}

async function runBlogPublicationController(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return { skipped: true, reason: 'supabase_not_configured' };

  const policy = readBlogAutopublishPolicyV3();
  if (policy.mode !== 'live') {
    return { skipped: true, reason: `autopublish_mode_${policy.mode}`, policy };
  }

  const now = new Date();
  const range = kstDayRange(now);
  const { count: publishedToday, error: countError } = await supabaseAdmin
    .from('content_creatives')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .gte('published_at', range.start)
    .lt('published_at', range.end);
  if (countError) return { skipped: true, reason: `publish_count_failed:${countError.message}` };

  const quota = calculateBlogPublishSlotQuota({
    now,
    dailyTarget: policy.dailyPublishCap,
    alreadyPublished: Number(publishedToday ?? 0),
  });
  if (quota.remainingDueNow <= 0) return { skipped: true, reason: 'publication_slot_not_due', quota };

  const { data: dueRuns, error: dueError } = await supabaseAdmin
    .from('blog_generation_runs')
    .select('id,queue_id,content_creative_id,latest_quality_score,scheduled_publish_at')
    .eq('status', 'approved_for_slot')
    .lte('scheduled_publish_at', now.toISOString())
    .order('scheduled_publish_at', { ascending: true })
    .limit(quota.remainingDueNow);
  if (dueError) return { skipped: true, reason: `approved_run_query_failed:${dueError.message}`, quota };

  const results: Array<{ runId: string; creativeId: string | null; status: string; reason?: string }> = [];
  const baseUrl = resolveBlogCanonicalOrigin();
  for (const run of dueRuns ?? []) {
    let publicCommitComplete = false;
    const creativeId = run.content_creative_id as string | null;
    if (!creativeId || Number(run.latest_quality_score ?? 0) < 90) {
      await supabaseAdmin.from('blog_generation_runs').update({
        status: 'quarantine', disposition: 'controller_precondition_failed', quarantined_at: now.toISOString(),
      }).eq('id', run.id).eq('status', 'approved_for_slot');
      results.push({ runId: run.id, creativeId, status: 'quarantined', reason: 'missing_creative_or_score_below_90' });
      continue;
    }

    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('blog_generation_runs')
      .update({ status: 'publishing', lease_owner: 'blog-publication-controller', lease_expires_at: new Date(now.getTime() + 120_000).toISOString() })
      .eq('id', run.id)
      .eq('status', 'approved_for_slot')
      .select('id')
      .maybeSingle();
    if (claimError || !claimed) continue;

    try {
      const { data: attempt, error: attemptError } = await supabaseAdmin
        .from('blog_generation_attempts')
        .select('hard_blockers,failure_reasons,route')
        .eq('run_id', run.id)
        .order('attempt_number', { ascending: false })
        .limit(1)
        .single();
      if (attemptError || attempt?.route !== 'approved_for_slot'
        || (Array.isArray(attempt?.hard_blockers) && attempt.hard_blockers.length > 0)
        || (Array.isArray(attempt?.failure_reasons) && attempt.failure_reasons.length > 0)) {
        throw new Error('latest_attempt_not_publishable');
      }

      const { data: creative, error: creativeError } = await supabaseAdmin
        .from('content_creatives')
        .select('id,slug,blog_html,seo_title,seo_description,status,review_status,quality_gate,generation_meta,product_id,destination')
        .eq('id', creativeId)
        .single();
      if (creativeError || !creative || creative.status !== 'draft') throw new Error('approved_draft_missing');
      const generationMeta = (creative.generation_meta || {}) as Record<string, unknown>;
      const orchestration = generationMeta.ai_orchestration_v4 as Record<string, unknown> | undefined;
      if (orchestration?.route !== 'approved_for_slot' || Number(orchestration.score || 0) < 90) {
        throw new Error('creative_generation_meta_not_approved');
      }

      const identity = readBlogInformationRepresentativeIdentity(generationMeta);
      if (identity) {
        await publishBlogInformationAtomically({
          creativeId,
          contentFingerprint: createBlogInformationContentFingerprint({
            blogHtml: String(creative.blog_html || ''),
            seoTitle: String(creative.seo_title || ''),
            seoDescription: String(creative.seo_description || ''),
            slug: String(creative.slug || ''),
          }),
          validationMeta: {
            information_claim_validation: (generationMeta.information_claim_validation || {}) as Record<string, unknown>,
          },
          qualityGate: (creative.quality_gate || {}) as Record<string, unknown>,
          publishedAt: now.toISOString(),
          identity,
          reservationOwner: `blog_topic_queue:${run.queue_id}`,
        });
        publicCommitComplete = true;
      } else {
        const enqueue = await enqueueBlogIndexingJob({
          slug: String(creative.slug), baseUrl, contentCreativeId: creativeId, source: 'blog_publication_controller',
        });
        if (!enqueue.ok) throw new Error(`indexing_enqueue_failed:${enqueue.error}`);
        const { data: promoted, error: promoteError } = await supabaseAdmin
          .from('content_creatives')
          .update({ status: 'published', published_at: now.toISOString() })
          .eq('id', creativeId)
          .eq('status', 'draft')
          .select('id')
          .maybeSingle();
        if (promoteError || !promoted) throw new Error('draft_promotion_race');
        publicCommitComplete = true;
      }

      const [runSync, queueSync] = await Promise.all([
        supabaseAdmin.from('blog_generation_runs').update({
          status: 'published', disposition: 'published', published_at: now.toISOString(),
          last_error: null, lease_owner: null, lease_expires_at: null, updated_at: now.toISOString(),
        }).eq('id', run.id).eq('status', 'publishing'),
        supabaseAdmin.from('blog_topic_queue').update({
          status: 'published', last_error: null, attempts: 0,
        }).eq('id', run.queue_id).eq('content_creative_id', creativeId),
      ]);
      if (runSync.error || queueSync.error) {
        throw new Error(`post_publish_state_sync_failed:${runSync.error?.message || queueSync.error?.message}`);
      }
      revalidatePublicBlogCache(String(creative.slug || ''), creative.destination ?? null);
      results.push({ runId: run.id, creativeId, status: 'published' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (publicCommitComplete) {
        // Publication itself is irreversible in this request. Never relabel a public
        // article as quarantined merely because orchestration bookkeeping failed.
        await Promise.allSettled([
          supabaseAdmin.from('blog_generation_runs').update({
            status: 'published', disposition: 'published_state_sync_error', published_at: now.toISOString(),
            last_error: reason, lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString(),
          }).eq('id', run.id).eq('status', 'publishing'),
          supabaseAdmin.from('blog_topic_queue').update({
            status: 'published', last_error: `publication_state_sync:${reason}`,
          }).eq('id', run.queue_id).eq('content_creative_id', creativeId),
        ]);
        revalidatePublicBlogCache();
        results.push({ runId: run.id, creativeId, status: 'published_state_sync_error', reason });
        continue;
      }
      await supabaseAdmin.from('blog_generation_runs').update({
        status: 'quarantine', disposition: 'controller_publish_failed', quarantined_at: new Date().toISOString(),
        last_error: reason, lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString(),
      }).eq('id', run.id).eq('status', 'publishing');
      results.push({ runId: run.id, creativeId, status: 'quarantined', reason });
    }
  }

  const published = results.filter((result) => (
    result.status === 'published' || result.status === 'published_state_sync_error'
  )).length;
  if (published > 0) {
    await supabaseAdmin.rpc('refresh_blog_public_snapshots_v3');
    revalidatePublicBlogCache();
    await processDueBlogIndexingJobs({ workerName: 'blog-publication-controller', limit: 10, baseUrl });
  }
  return { processed: results.length, published, quota, results, modelCalls: 0 };
}

export const GET = withCronLogging('blog-publication-controller', runBlogPublicationController, {
  handlerTimeoutMs: 165_000,
});
