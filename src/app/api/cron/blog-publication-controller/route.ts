import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { logWarning } from '@/lib/sentry-logger';
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
import { getBlogPublicSurfacePolicyBlockReason } from '@/lib/blog-public-eligibility';
import { readAutomatedPublishedBlogReplacement } from '@/lib/blog-private-regeneration';
import {
  resolveEffectiveBlogPublicationRollout,
} from '@/lib/blog-publication-rollout';
import { loadBlogPublicationRolloutState } from '@/lib/blog-publication-rollout-repository';
import {
  BLOG_CONTENT_FACTORY_KST_SLOTS_V4,
  BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4,
  cumulativeBlogContentFactorySlotCapsV4,
} from '@/lib/blog-content-factory/quota';
import {
  claimBlogContentOperationPublicationV4,
  publishBlogCommercialOperationV4,
  projectBlogContentOperationPublicStateV4,
  recordBlogContentOperationStageV4,
  retryBlogContentOperationPublicationV4,
  terminalizeBlogContentOperationV4,
} from '@/lib/blog-content-factory/repository';
import { validateBlogPackageSnapshotPinV4 } from '@/lib/blog-content-factory/package-snapshot';
import { hashBlogContentRevisionV1 } from '@/lib/blog-quality-decision-v1';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

function kstDayRange(now = new Date()): { start: string; end: string } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000;
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() };
}

function kstDayKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isRetryablePublicationFailure(reason: string): boolean {
  return /timeout|temporar|connection|network|fetch failed|econn|rate.?limit|unavailable|deadlock|serialization|\b5\d{2}\b/i.test(reason);
}

async function runBlogPublicationController(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return { skipped: true, reason: 'supabase_not_configured' };

  const factoryEnabled = ['1', 'true'].includes(
    String(process.env.BLOG_CONTENT_FACTORY_ENABLED || '').trim().toLowerCase(),
  );
  if (process.env.VERCEL_ENV === 'production' && !factoryEnabled) {
    return { skipped: true, reason: 'content_factory_required_in_production' };
  }

  const policy = readBlogAutopublishPolicyV3();
  if (!['live', 'reviewed_only'].includes(policy.mode)) {
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
  const kstMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60) % (24 * 60);
  if (factoryEnabled && (kstMinutes < 9 * 60 || kstMinutes > 22 * 60)) {
    return { skipped: true, reason: 'content_factory_publication_window_closed', rollout };
  }
  const targetedRunId = request.nextUrl.searchParams.get('runId')?.trim() ?? '';
  const forceTargetedRun = request.nextUrl.searchParams.get('force') === 'true'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetedRunId);
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
    dailyTarget: rollout.dailyCap,
    alreadyPublished: Number(publishedToday ?? 0),
    rolloutStage: rollout.stage,
    slotTimes: factoryEnabled ? [...BLOG_CONTENT_FACTORY_KST_SLOTS_V4] : undefined,
    cumulativeTargets: factoryEnabled
      ? cumulativeBlogContentFactorySlotCapsV4(rollout.stage).map((value) => Math.min(value, rollout.dailyCap))
      : rollout.cumulativeSlotCaps,
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

  type PublicationOperation = {
    id: string;
    generation_run_id: string;
    status: string;
    creates_new_url: boolean;
    package_id: string | null;
    package_snapshot_id: string | null;
    package_snapshot_revision: number | null;
    package_snapshot_hash: string | null;
  };
  const operationByRun = new Map<string, PublicationOperation>();
  if (factoryEnabled && (dueRuns?.length ?? 0) > 0) {
    const { data: operations, error: operationError } = await supabaseAdmin
      .from('blog_content_operations')
      .select('id,generation_run_id,status,creates_new_url,package_id,package_snapshot_id,package_snapshot_revision,package_snapshot_hash')
      .in('generation_run_id', (dueRuns ?? []).map((run) => run.id))
      .eq('status', 'approved_for_slot');
    if (operationError) {
      return { skipped: true, reason: `content_operation_inventory_failed:${operationError.message}`, quota, rollout };
    }
    for (const operation of operations ?? []) {
      if (operation.generation_run_id) operationByRun.set(operation.generation_run_id, operation as PublicationOperation);
    }
  }

  const results: Array<{ runId: string; creativeId: string | null; status: string; reason?: string }> = [];
  const baseUrl = resolveBlogCanonicalOrigin();
  for (const run of dueRuns ?? []) {
    let publicCommitComplete = false;
    const operation = factoryEnabled ? operationByRun.get(run.id) ?? null : null;
    const operationLeaseOwner = `blog-publication-controller:${run.id}`;
    let operationFencingToken: number | null = null;
    let operationFinalizedAtomically = false;
    const creativeId = run.content_creative_id as string | null;
    const selectedAttemptId = run.selected_attempt_id as string | null;
    let publishedCreativeId = creativeId;
    let publishedSlug: string | null = null;
    if (!creativeId || !selectedAttemptId) {
      await supabaseAdmin.from('blog_generation_runs').update({
        status: 'quarantine', disposition: 'controller_precondition_failed', quarantined_at: now.toISOString(),
      }).eq('id', run.id).eq('status', 'approved_for_slot');
      results.push({ runId: run.id, creativeId, status: 'quarantined', reason: 'missing_creative_or_selected_attempt' });
      continue;
    }

    if (factoryEnabled) {
      if (!operation) {
        results.push({
          runId: run.id,
          creativeId,
          status: 'skipped',
          reason: 'approved_content_operation_missing',
        });
        continue;
      }
      const stageCaps = BLOG_CONTENT_FACTORY_PORTFOLIO_CAPS_V4[rollout.stage];
      try {
        const operationClaim = await claimBlogContentOperationPublicationV4({
          supabase: supabaseAdmin,
          operationId: operation.id,
          leaseOwner: operationLeaseOwner,
          operationDayKst: kstDayKey(now),
          maxOperations: Math.min(stageCaps.totalOperations, rollout.dailyCap),
          maxNewUrls: Math.min(stageCaps.newUrls, rollout.dailyCap),
        });
        operationFencingToken = operationClaim.fencingToken;
      } catch (error) {
        results.push({
          runId: run.id,
          creativeId,
          status: 'skipped',
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (operation.package_snapshot_id) {
        const [{ data: pointer, error: pointerError }, { data: snapshot, error: snapshotError }] = await Promise.all([
          supabaseAdmin.from('product_registration_v5_publication_pointers')
            .select('package_id,current_snapshot_id,current_revision_id,state')
            .eq('package_id', operation.package_id).eq('channel', 'customer').eq('locale', 'ko-KR').maybeSingle(),
          supabaseAdmin.from('public_package_snapshots')
            .select('id,package_id,package_revision,snapshot_hash,status')
            .eq('id', operation.package_snapshot_id).maybeSingle(),
        ]);
        const snapshotValidation = pointerError || snapshotError || !operation.package_id
          || operation.package_snapshot_revision == null || !operation.package_snapshot_hash
          ? { valid: false, reason: 'package_snapshot_revalidation_unavailable' }
          : validateBlogPackageSnapshotPinV4({
              pin: {
                packageId: operation.package_id,
                snapshotId: operation.package_snapshot_id,
                revision: operation.package_snapshot_revision,
                hash: operation.package_snapshot_hash,
              },
              pointer: pointer as never,
              snapshot: snapshot as never,
            });
        if (!snapshotValidation.valid) {
          await recordBlogContentOperationStageV4({
            supabase: supabaseAdmin, operationId: operation.id,
            fencingToken: operationFencingToken, leaseOwner: operationLeaseOwner,
            eventKey: 'publication:package-snapshot-stale:v1', stage: 'quarantined',
            eventStatus: 'failed', operationStatus: 'quarantined',
            failureCode: snapshotValidation.reason,
          }).catch(() => undefined);
          await supabaseAdmin.from('blog_generation_runs').update({
            status: 'quarantine', disposition: snapshotValidation.reason,
            quarantined_at: now.toISOString(), updated_at: now.toISOString(),
          }).eq('id', run.id).eq('status', 'approved_for_slot');
          results.push({ runId: run.id, creativeId, status: 'quarantined', reason: snapshotValidation.reason ?? undefined });
          continue;
        }
      }
    }

    // Factory publication claims the operation and generation run in one RPC.
    // The legacy path keeps its historical single-row claim until it is retired.
    if (!factoryEnabled) {
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('blog_generation_runs')
        .update({ status: 'publishing', lease_owner: 'blog-publication-controller', lease_expires_at: new Date(now.getTime() + 120_000).toISOString() })
        .eq('id', run.id)
        .eq('status', 'approved_for_slot')
        .select('id')
        .maybeSingle();
      if (claimError || !claimed) continue;
    }

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
      const finalQualityDecisionValue = generationMeta.final_quality_decision;
      const finalQualityDecision = finalQualityDecisionValue
        && typeof finalQualityDecisionValue === 'object'
        && !Array.isArray(finalQualityDecisionValue)
        ? finalQualityDecisionValue as Record<string, unknown>
        : null;
      const finalRevisionId = typeof generationMeta.final_revision_id === 'string'
        ? generationMeta.final_revision_id
        : null;
      const finalQualityDecisionId = typeof generationMeta.final_quality_decision_id === 'string'
        ? generationMeta.final_quality_decision_id
        : null;
      const currentContentHash = hashBlogContentRevisionV1({
        blogHtml: String(creative.blog_html || ''),
        title: String(creative.seo_title || ''),
        description: String(creative.seo_description || ''),
        slug: String(creative.slug || ''),
      });
      const hardBlockers = Array.isArray(finalQualityDecision?.hardBlockers)
        ? finalQualityDecision.hardBlockers
        : [];
      if (!finalQualityDecision
        || finalQualityDecision.passed !== true
        || finalQualityDecision.decision !== 'pass'
        || hardBlockers.length > 0
        || !finalRevisionId
        || !finalQualityDecisionId
        || finalQualityDecision.revisionId !== finalRevisionId
        || finalQualityDecision.evaluatedContentHash !== currentContentHash) {
        throw new Error('final_quality_decision_not_publishable');
      }
      const { data: finalRevision, error: finalRevisionError } = await supabaseAdmin
        .from('blog_content_revisions')
        .select('id,creative_id,content_hash,immutable')
        .eq('id', finalRevisionId)
        .maybeSingle();
      if (finalRevisionError || !finalRevision
        || String(finalRevision.creative_id) !== String(creativeId)
        || finalRevision.content_hash !== currentContentHash
        || finalRevision.immutable !== true) {
        throw new Error('final_quality_revision_not_immutable_or_current');
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
      if (policy.mode === 'reviewed_only' && creative.review_status !== 'approved') {
        throw new Error('reviewed_only_requires_approved_review_status');
      }
      // `final_quality_decision` is the only publish authority. `quality_gate`
      // remains a compatibility projection and is not consulted here.

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
        if (factoryEnabled) {
          if (!operation || operationFencingToken == null) {
            throw new Error('commercial_content_operation_required');
          }
          const commercialPublication = await publishBlogCommercialOperationV4({
            supabase: supabaseAdmin,
            operationId: operation.id,
            fencingToken: operationFencingToken,
            leaseOwner: operationLeaseOwner,
            generationRunId: run.id,
            selectedAttemptId,
            creativeId,
            publicationMode: policy.mode === 'reviewed_only' ? 'reviewed_only' : 'live',
            publishedAt: now.toISOString(),
          });
          publicCommitComplete = true;
          await projectBlogContentOperationPublicStateV4({
            supabase: supabaseAdmin,
            operationId: operation.id,
            generationRunId: run.id,
            creativeId: commercialPublication.creativeId,
            finalRevisionId: typeof generationMeta.final_revision_id === 'string'
              ? generationMeta.final_revision_id
              : null,
            finalQualityDecisionId: typeof generationMeta.final_quality_decision_id === 'string'
              ? generationMeta.final_quality_decision_id
              : null,
          });
          operationFinalizedAtomically = true;
          publishedCreativeId = commercialPublication.creativeId;
          publishedSlug = commercialPublication.slug;
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
            slug: String(creative.slug), baseUrl, contentCreativeId: creativeId,
            source: 'blog_publication_controller_legacy',
          });
          if (!enqueue.ok) throw new Error(`indexing_enqueue_failed_after_public_commit:${enqueue.error}`);
        }
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
      if (operation && operationFencingToken != null && !operationFinalizedAtomically) {
        await recordBlogContentOperationStageV4({
          supabase: supabaseAdmin, operationId: operation.id,
          fencingToken: operationFencingToken, leaseOwner: operationLeaseOwner,
          eventKey: 'publication:published:v1', stage: 'published',
          eventStatus: 'succeeded', operationStatus: 'published',
          generationRunId: run.id, creativeId: publishedCreativeId,
          evidence: {
            slug: publishedSlug,
            selectedAttemptId,
            operationState: {
              generationStatus: 'succeeded',
              reviewStatus: 'not_required',
              publicationStatus: 'published',
              indexingStatus: 'queued',
              finalRevisionId: generationMeta.final_revision_id ?? null,
              finalQualityDecisionId: generationMeta.final_quality_decision_id ?? null,
            },
          },
        });
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
          operation && operationFencingToken != null && !operationFinalizedAtomically
            ? recordBlogContentOperationStageV4({
                supabase: supabaseAdmin, operationId: operation.id,
                fencingToken: operationFencingToken, leaseOwner: operationLeaseOwner,
                eventKey: 'publication:published-state-sync-error:v1', stage: 'published',
                eventStatus: 'succeeded', operationStatus: 'published',
                generationRunId: run.id, creativeId: publishedCreativeId,
                evidence: { slug: publishedSlug, selectedAttemptId, stateSyncError: reason },
              })
            : Promise.resolve(),
        ]);
        revalidatePublicBlogCache();
        results.push({ runId: run.id, creativeId: publishedCreativeId, status: 'published_state_sync_error', reason });
        continue;
      }
      if (operation && operationFencingToken != null && isRetryablePublicationFailure(reason)) {
        try {
          await retryBlogContentOperationPublicationV4({
            supabase: supabaseAdmin,
            operationId: operation.id,
            fencingToken: operationFencingToken,
            leaseOwner: operationLeaseOwner,
            eventKey: `publication:retryable:v1:${run.id}`,
            failureCode: reason,
            evidence: {
              operationState: {
                generationStatus: 'succeeded',
                reviewStatus: 'not_required',
                publicationStatus: 'failed',
                indexingStatus: 'not_eligible',
                finalRevisionId: null,
                finalQualityDecisionId: null,
              },
              retryable: true,
            },
          });
          results.push({ runId: run.id, creativeId, status: 'retryable', reason });
          continue;
        } catch (retryError) {
          logWarning('[cron/blog-publication-controller] publication retry handoff failed', {
            runId: run.id,
            operationId: operation.id,
            error: retryError,
          });
        }
      }
      await supabaseAdmin.from('blog_generation_runs').update({
        status: 'quarantine', disposition: 'controller_publish_failed', quarantined_at: new Date().toISOString(),
        last_error: reason, lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString(),
      }).eq('id', run.id).eq('status', 'publishing');
      if (operation && operationFencingToken != null) {
        await terminalizeBlogContentOperationV4({
          supabase: supabaseAdmin, operationId: operation.id,
          fencingToken: operationFencingToken, leaseOwner: operationLeaseOwner,
          eventKey: 'publication:failed:v2', stage: 'quarantined', status: 'quarantined',
          failureCode: reason, skipReason: 'publication_failed',
          evidence: {
            operationState: {
              generationStatus: 'succeeded',
              reviewStatus: 'not_required',
              publicationStatus: 'failed',
              indexingStatus: 'not_eligible',
              finalRevisionId: null,
              finalQualityDecisionId: null,
            },
          },
        }).catch(() => undefined);
      }
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
    contentFactoryEnabled: factoryEnabled,
    targetedRunId: forceTargetedRun ? targetedRunId : null,
    results,
    modelCalls: 0,
  };
}

export const GET = withCronLogging('blog-publication-controller', runBlogPublicationController, {
  handlerTimeoutMs: 165_000,
});
