import { researchBlogInformationAutomatically } from './blog-auto-research';
import { buildBlogContentBrief } from './blog-content-brief';
import {
  BLOG_INFORMATION_RESEARCH_META_KEY,
  evaluateBlogGenerationResearchReadiness,
} from './blog-generation-research';
import { supabaseAdmin } from './supabase';

type QueueResearchCandidate = {
  id?: string | null;
  product_id?: string | null;
  topic?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  category?: string | null;
  source?: string | null;
  angle_type?: string | null;
  meta?: any;
};

export const MIN_READY_INFORMATION_INTENT_DIVERSITY = 5;
export const BLOG_INFORMATION_RESEARCH_CONCURRENCY = 3;

function cleanMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? { ...(meta as Record<string, unknown>) }
    : {};
}

function queueMicroAngle(row: QueueResearchCandidate): string | null {
  const value = row.meta?.micro_angle;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildQueuedInformationBrief(row: QueueResearchCandidate) {
  const keywords = Array.isArray(row.meta?.keywords)
    ? row.meta.keywords.filter((value: unknown): value is string => typeof value === 'string')
    : [];
  return buildBlogContentBrief({
    topic: row.topic,
    destination: row.destination,
    primaryKeyword: row.primary_keyword || row.destination || row.topic,
    category: row.category,
    source: row.source,
    keywords,
    microAngle: queueMicroAngle(row),
    audience: typeof row.meta?.audience === 'string' ? row.meta.audience : null,
    locale: typeof row.meta?.locale === 'string' ? row.meta.locale : null,
    travelerNationality: typeof row.meta?.traveler_nationality === 'string'
      ? row.meta.traveler_nationality
      : null,
  });
}

function expectedContentKey(row: QueueResearchCandidate): string | null {
  const value = row.meta?.expected_slug ?? row.meta?.spun_slug;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

export function evaluateQueuedInformationResearch(row: QueueResearchCandidate) {
  if (row.product_id) return { passed: true, issues: [] as string[] };
  const contentKey = expectedContentKey(row);
  const destination = row.destination?.trim();
  if (!contentKey || !destination) {
    return {
      passed: false,
      issues: [
        ...(!contentKey ? ['research_expected_content_key_missing'] : []),
        ...(!destination ? ['research_destination_missing'] : []),
      ],
    };
  }
  const brief = buildQueuedInformationBrief(row);
  const readiness = evaluateBlogGenerationResearchReadiness({
    meta: row.meta,
    expectedContentKey: contentKey,
    destination,
    intent: brief.intentType,
    locale: brief.plan.locale,
    sourcePolicy: brief.sourcePolicy,
  });
  return { passed: readiness.passed, issues: readiness.issues };
}

export function prioritizeQueuedInformationResearch(
  rows: QueueResearchCandidate[],
  alreadyReadyIntents: Iterable<string> = [],
): QueueResearchCandidate[] {
  const firstByIntent: QueueResearchCandidate[] = [];
  const remaining: QueueResearchCandidate[] = [];
  const seenIntents = new Set(alreadyReadyIntents);

  for (const row of rows) {
    const intent = buildQueuedInformationBrief(row).intentType;
    if (!seenIntents.has(intent)) {
      seenIntents.add(intent);
      firstByIntent.push(row);
    } else {
      remaining.push(row);
    }
  }

  return [...firstByIntent, ...remaining];
}

export async function prepareDailyInformationResearch(input: {
  targetReady: number;
  maxResearch?: number;
}): Promise<{
  readyBefore: number;
  readyAfter: number;
  researched: number;
  blockedAndReplaced: number;
  failedResearch: number;
  issues: string[];
}> {
  const maxResearch = Math.max(1, Math.min(12, input.maxResearch ?? input.targetReady));
  const { data, error } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, product_id, topic, destination, primary_keyword, category, source, angle_type, meta, priority, created_at')
    .eq('status', 'queued')
    .is('product_id', null)
    .or('target_publish_at.is.null,source.eq.user_seed')
    .neq('source', 'pillar')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(250);
  if (error) throw new Error(`blog_queue_research_load:${error.message}`);

  const rows = (data ?? []) as QueueResearchCandidate[];
  const readyRows = rows.filter((row) => evaluateQueuedInformationResearch(row).passed);
  const readyIntents = new Set(
    readyRows.map((row) => buildQueuedInformationBrief(row).intentType),
  );
  const targetIntentDiversity = Math.min(
    MIN_READY_INFORMATION_INTENT_DIVERSITY,
    Math.max(1, input.targetReady),
  );
  let readyAfter = readyRows.length;
  let researched = 0;
  let blockedAndReplaced = 0;
  let failedResearch = 0;
  const issues: string[] = [];
  if (readyAfter >= input.targetReady && readyIntents.size >= targetIntentDiversity) {
    return {
      readyBefore: readyRows.length,
      readyAfter,
      researched,
      blockedAndReplaced,
      failedResearch,
      issues,
    };
  }

  const pendingRows = rows.filter((row) => !evaluateQueuedInformationResearch(row).passed);
  const researchRows = prioritizeQueuedInformationResearch(
    pendingRows.filter((row) => Boolean(row.destination?.trim()) && Boolean(expectedContentKey(row))),
    readyIntents,
  );

  let researchCursor = 0;
  while (researchCursor < researchRows.length) {
    if (
      (readyAfter >= input.targetReady && readyIntents.size >= targetIntentDiversity)
      || researched + failedResearch >= maxResearch
    ) break;
    const remainingBudget = maxResearch - researched - failedResearch;
    const remainingNeeded = Math.max(
      input.targetReady - readyAfter,
      targetIntentDiversity - readyIntents.size,
      1,
    );
    const batchSize = Math.min(
      BLOG_INFORMATION_RESEARCH_CONCURRENCY,
      remainingBudget,
      remainingNeeded,
    );
    const batch = researchRows.slice(researchCursor, researchCursor + batchSize);
    researchCursor += batch.length;

    await Promise.all(batch.map(async (row) => {
      const id = row.id;
      const destination = row.destination?.trim();
      const contentKey = expectedContentKey(row);
      if (!id || !destination || !contentKey) return;
      const brief = buildQueuedInformationBrief(row);
      try {
        const result = await researchBlogInformationAutomatically({
          contentKey,
          destination,
          locale: brief.plan.locale,
          brief,
        });
        const nextMeta = cleanMeta(row.meta);
        if (!result.passed || !result.bundle) {
          failedResearch += 1;
          blockedAndReplaced += 1;
          const failureIssues = result.issues.slice(0, 12);
          issues.push(`${id}:${failureIssues.join(',') || 'research_failed'}`);
          await supabaseAdmin
            .from('blog_topic_queue')
            .update({
              status: 'skipped',
              last_error: 'evidence_insufficient',
              meta: {
                ...nextMeta,
                evidence_insufficient: true,
                failure_code: 'evidence_insufficient',
                self_heal_blocked: true,
                replacement_required: true,
                research_issues: failureIssues,
                research_failed_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            } as never)
            .eq('id', id)
            .eq('status', 'queued');
          return;
        }

        delete nextMeta.failure_code;
        delete nextMeta.quarantine_reason;
        delete nextMeta.self_heal_blocked;
        delete nextMeta.replacement_required;
        delete nextMeta.research_issues;
        delete nextMeta.research_failed_at;
        const candidateMeta = {
          ...nextMeta,
          [BLOG_INFORMATION_RESEARCH_META_KEY]: result.bundle,
          evidence_insufficient: false,
          research_preflight: {
            passed: true,
            model: result.model,
            source_count: result.directSourceCount,
            claim_count: result.bundle.claims.length,
            checked_at: new Date().toISOString(),
          },
        };
        const readiness = evaluateBlogGenerationResearchReadiness({
          meta: candidateMeta,
          expectedContentKey: contentKey,
          destination,
          intent: brief.intentType,
          locale: brief.plan.locale,
          sourcePolicy: brief.sourcePolicy,
        });
        if (!readiness.passed) {
          failedResearch += 1;
          blockedAndReplaced += 1;
          issues.push(`${id}:${readiness.issues.slice(0, 12).join(',')}`);
          await supabaseAdmin
            .from('blog_topic_queue')
            .update({
              status: 'skipped',
              last_error: 'evidence_insufficient',
              meta: {
                ...nextMeta,
                evidence_insufficient: true,
                failure_code: 'evidence_insufficient',
                self_heal_blocked: true,
                replacement_required: true,
                research_issues: readiness.issues.slice(0, 12),
                research_failed_at: new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            } as never)
            .eq('id', id)
            .eq('status', 'queued');
          return;
        }

        const { error: updateError } = await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            meta: candidateMeta,
            last_error: null,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', id)
          .eq('status', 'queued');
        if (updateError) throw new Error(updateError.message);
        researched += 1;
        readyAfter += 1;
        readyIntents.add(brief.intentType);
      } catch (researchError) {
        failedResearch += 1;
        blockedAndReplaced += 1;
        const message = researchError instanceof Error ? researchError.message : 'research_exception';
        issues.push(`${id}:${message}`);
        await supabaseAdmin
          .from('blog_topic_queue')
          .update({
            status: 'skipped',
            last_error: 'research_exception',
            meta: {
              ...cleanMeta(row.meta),
              evidence_insufficient: true,
              failure_code: 'research_exception',
              self_heal_blocked: true,
              replacement_required: true,
              research_issues: [message],
              research_failed_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', id)
          .eq('status', 'queued');
      }
    }));
  }

  return {
    readyBefore: readyRows.length,
    readyAfter,
    researched,
    blockedAndReplaced,
    failedResearch,
    issues,
  };
}
