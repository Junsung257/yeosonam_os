import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { readBlogAutopublishPolicyV3 } from '@/lib/blog-autopublish-policy-v3';
import { calculateBlogPublishSlotQuota } from '@/lib/blog-publish-slot-quota';
import { readBlogInformationRepresentativeIdentity } from '@/lib/blog-information-representative';
import { createBlogInformationContentFingerprint } from '@/lib/blog-information-review-workflow';
import {
  publishBlogInformationAtomically,
  replaceBlogInformationAutomatedDraftAtomically,
} from '@/lib/blog-information-atomic-publication';
import { enqueueBlogIndexingJob } from '@/lib/blog-indexing-outbox';
import { processDueBlogIndexingJobs } from '@/lib/blog-indexing-worker';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';
import {
  PUBLIC_BLOG_READ_SOURCE,
  getBlogPublicSurfacePolicyBlockReason,
} from '@/lib/blog-public-eligibility';
import { readAutomatedPublishedBlogReplacement } from '@/lib/blog-private-regeneration';
import {
  resolveEffectiveBlogPublicationRollout,
} from '@/lib/blog-publication-rollout';
import { loadBlogPublicationRolloutState } from '@/lib/blog-publication-rollout-repository';

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

  const rolloutStateResult = await loadBlogPublicationRolloutState(supabaseAdmin);
  if (!rolloutStateResult.state) {
    return { skipped: true, reason: `publication_rollout_state_unavailable:${rolloutStateResult.error}` };
  }
  const rollout = resolveEffectiveBlogPublicationRollout({
    state: rolloutStateResult.state,
    environmentStageCeiling: policy.publicationRampStage,
    environmentDailyCap: policy.requestedDailyPublishCap,
  });
  if (rollout.frozen || rollout.dailyCap <= 0) {
    return { skipped: true, reason: 'publication_rollout_frozen', policy, rollout };
  }

  const now = new Date();
  const targetedRunId = request.nextUrl.searchParams.get('runId')?.trim() ?? '';
  const forceTargetedRun = request.nextUrl.searchParams.get('force') === 'true'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetedRunId);
  const range = kstDayRange(now);
  const { count: publishedToday, error: countError } = await supabaseAdmin
    .from(PUBLIC_BLOG_READ_SOURCE)
    .select('id', { count: 'exact', head: true })
    .gte('published_at', range.start)
    .lt('published_at', range.end);
  if (countError) return { skipped: true, reason: `publish_count_failed:${countError.message}` };

  const quota = calculateBlogPublishSlotQuota({
    now,
    dailyTarget: rollout.dailyCap,
    alreadyPublished: Number(publishedToday ?? 0),
    rolloutStage: rollout.stage,
    cumulativeTargets: rollout.cumulativeSlotCaps,
  });
  const remainingDailyCapacity = Math.max(0, rollout.dailyCap - Number(publishedToday ?? 0));
  if (remainingDailyCapacity <= 0) return { skipped: true, reason: 'daily_publish_cap_reached', quota };
  if (!forceTargetedRun && quota.remainingDueNow <= 0) {
    return { skipped: true, reason: 'publication_slot_not_due', quota };
  }

  let dueRunsQuery = supabaseAdmin
    .from('blog_generation_runs')
    .select('id,queue_id,content_creative_id,selected_attempt_id,latest_quality_score,scheduled_publish_at')
    .eq('status', 'approved_for_slot');
  dueRunsQuery = forceTargetedRun
    ? dueRunsQuery.eq('id', targetedRunId).limit(1)
    : dueRunsQuery
        .lte('scheduled_publish_at', now.toISOString())
        .order('scheduled_publish_at', { ascending: true })
        .limit(Math.min(quota.remainingDueNow, remainingDailyCapacity));
  const { data: dueRuns, error: dueError } = await dueRunsQuery;
  if (dueError) return { skipped: true, reason: `approved_run_query_failed:${dueError.message}`, quota };

  const results: Array<{ runId: string; creativeId: string | null; status: string; reason?: string }> = [];
  const baseUrl = resolveBlogCanonicalOrigin();
  for (const run of dueRuns ?? []) {
    let publicCommitComplete = false;
    const creativeId = run.content_creative_id as string | null;
    const selectedAttemptId = run.selected_attempt_id as string | null;
    let publishedCreativeId = creativeId;
    let publishedSlug: string | null = null;
    if (!creativeId || !selectedAttemptId || Number(run.latest_quality_score ?? 0) < 90) {
      await supabaseAdmin.from('blog_generation_runs').update({
        status: 'quarantine', disposition: 'controller_precondition_failed', quarantined_at: now.toISOString(),
      }).eq('id', run.id).eq('status', 'approved_for_slot');
      results.push({ runId: run.id, creativeId, status: 'quarantined', reason: 'missing_creative_selected_attempt_or_score_below_90' });
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
        .select('hard_blockers,failure_reasons,route,quality_score_after,output_document')
        .eq('id', selectedAttemptId)
        .eq('run_id', run.id)
        .single();
      if (attemptError || attempt?.route !== 'approved_for_slot'
        || (Array.isArray(attempt?.hard_blockers) && attempt.hard_blockers.length > 0)
        || (Array.isArray(attempt?.failure_reasons) && attempt.failure_reasons.length > 0)) {
        throw new Error('selected_attempt_not_publishable');
      }

      const { data: creative, error: creativeError } = await supabaseAdmin
        .from('content_creatives')
        .select('id,slug,blog_html,seo_title,seo_description,title,channel,category,content_type,status,review_status,quality_gate,generation_meta,product_id,destination')
        .eq('id', creativeId)
        .single();
      if (creativeError || !creative || creative.status !== 'draft') throw new Error('approved_draft_missing');
      const selectedOutput = attempt.output_document as Record<string, unknown> | null;
      const automatedReplacement = readAutomatedPublishedBlogReplacement(creative.generation_meta);
      const selectedOutputMatchesDraft = selectedOutput
        && String(selectedOutput.title ?? '') === String(creative.seo_title ?? '')
        && String(selectedOutput.description ?? '') === String(creative.seo_description ?? '')
        && (
          String(selectedOutput.slug ?? '') === String(creative.slug ?? '')
          || (
            automatedReplacement !== null
            && automatedReplacement.draftSlug === String(creative.slug ?? '')
            && automatedReplacement.canonicalSlug === String(selectedOutput.slug ?? '')
          )
        )
        && String(selectedOutput.markdown ?? '') === String(creative.blog_html ?? '');
      if (!selectedOutputMatchesDraft) throw new Error('selected_attempt_output_mismatch');
      const generationMeta = (creative.generation_meta || {}) as Record<string, unknown>;
      const orchestration = generationMeta.ai_orchestration_v4 as Record<string, unknown> | undefined;
      const selectedScore = Number(attempt.quality_score_after ?? 0);
      if (orchestration?.route !== 'approved_for_slot'
        || Number(orchestration.score || 0) < 90
        || selectedScore < 90
        || selectedScore !== Number(run.latest_quality_score ?? 0)) {
        throw new Error('creative_generation_meta_not_approved');
      }
      if (creative.channel !== 'naver_blog' || !String(creative.slug || '').trim()) {
        throw new Error('creative_public_identity_invalid');
      }
      const publicSurfaceBlock = getBlogPublicSurfacePolicyBlockReason({
        productId: creative.product_id,
        reviewStatus: creative.review_status,
        title: creative.title,
        category: creative.category,
        contentType: creative.content_type,
        generationMeta,
      });
      if (publicSurfaceBlock) throw new Error(`creative_public_policy_blocked:${publicSurfaceBlock}`);
      if ((creative.quality_gate as Record<string, unknown> | null)?.passed !== true) {
        throw new Error('creative_quality_gate_not_passed');
      }

      const identity = readBlogInformationRepresentativeIdentity(generationMeta);
      if (!identity && !creative.product_id) throw new Error('information_representative_identity_missing');
      if (identity) {
        const claimValidation = generationMeta.information_claim_validation as Record<string, unknown> | undefined;
        if (claimValidation?.passed !== true) throw new Error('information_claim_gate_not_passed');
        const contentFingerprint = createBlogInformationContentFingerprint({
          blogHtml: String(creative.blog_html || ''),
          seoTitle: String(creative.seo_title || ''),
          seoDescription: String(creative.seo_description || ''),
          slug: String(creative.slug || ''),
        });
        if (automatedReplacement) {
          if (automatedReplacement.queueId !== String(run.queue_id)) {
            throw new Error('automated_replacement_queue_mismatch');
          }
          const replacement = await replaceBlogInformationAutomatedDraftAtomically({
            replacementDraftId: creativeId,
            targetCreativeId: automatedReplacement.targetCreativeId,
            runId: String(run.id),
            selectedAttemptId,
            sourceFingerprint: contentFingerprint,
            validationMeta: {
              information_claim_validation: (generationMeta.information_claim_validation || {}) as Record<string, unknown>,
            },
            qualityGate: (creative.quality_gate || {}) as Record<string, unknown>,
            identity,
          });
          publishedCreativeId = replacement.targetCreativeId;
          publishedSlug = replacement.slug;
        } else {
          await publishBlogInformationAtomically({
            creativeId,
            contentFingerprint,
            validationMeta: {
              information_claim_validation: (generationMeta.information_claim_validation || {}) as Record<string, unknown>,
            },
            qualityGate: (creative.quality_gate || {}) as Record<string, unknown>,
            publishedAt: now.toISOString(),
            identity,
            reservationOwner: `blog_topic_queue:${run.queue_id}`,
          });
          publishedSlug = String(creative.slug || '');
        }
        publicCommitComplete = true;
      } else {
        const { data: promoted, error: promoteError } = await supabaseAdmin
          .from('content_creatives')
          .update({ status: 'published', published_at: now.toISOString() })
          .eq('id', creativeId)
          .eq('status', 'draft')
          .select('id')
          .maybeSingle();
        if (promoteError || !promoted) throw new Error('draft_promotion_race');
        publicCommitComplete = true;
        publishedSlug = String(creative.slug || '');
        const enqueue = await enqueueBlogIndexingJob({
          slug: String(creative.slug), baseUrl, contentCreativeId: creativeId, source: 'blog_publication_controller',
        });
        if (!enqueue.ok) throw new Error(`indexing_enqueue_failed_after_public_commit:${enqueue.error}`);
      }

      const [runSync, queueSync] = await Promise.all([
        supabaseAdmin.from('blog_generation_runs').update({
          status: 'published', disposition: 'published', published_at: now.toISOString(),
          content_creative_id: publishedCreativeId,
          last_error: null, lease_owner: null, lease_expires_at: null, updated_at: now.toISOString(),
        }).eq('id', run.id).eq('status', 'publishing'),
        supabaseAdmin.from('blog_topic_queue').update({
          status: 'published', last_error: null, attempts: 0,
          content_creative_id: publishedCreativeId,
        }).eq('id', run.queue_id),
      ]);
      if (runSync.error || queueSync.error) {
        throw new Error(`post_publish_state_sync_failed:${runSync.error?.message || queueSync.error?.message}`);
      }
      revalidatePublicBlogCache(publishedSlug || undefined, creative.destination ?? null);
      results.push({ runId: run.id, creativeId: publishedCreativeId, status: 'published' });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (publicCommitComplete) {
        // Publication itself is irreversible in this request. Never relabel a public
        // article as quarantined merely because orchestration bookkeeping failed.
        await Promise.allSettled([
          supabaseAdmin.from('blog_generation_runs').update({
            status: 'published', disposition: 'published_state_sync_error', published_at: now.toISOString(),
            content_creative_id: publishedCreativeId,
            last_error: reason, lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString(),
          }).eq('id', run.id).eq('status', 'publishing'),
          supabaseAdmin.from('blog_topic_queue').update({
            status: 'published', last_error: `publication_state_sync:${reason}`,
            content_creative_id: publishedCreativeId,
          }).eq('id', run.queue_id),
        ]);
        revalidatePublicBlogCache();
        results.push({ runId: run.id, creativeId: publishedCreativeId, status: 'published_state_sync_error', reason });
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
  return {
    processed: results.length,
    published,
    quota,
    rollout,
    targetedRunId: forceTargetedRun ? targetedRunId : null,
    results,
    modelCalls: 0,
  };
}

export const GET = withCronLogging('blog-publication-controller', runBlogPublicationController, {
  handlerTimeoutMs: 165_000,
});
