import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildBlogInformationRepresentativeKey } from '@/lib/blog-information-representative';
import type { BlogPublicationRampStage } from '@/lib/blog-publication-rollout';
import { isHighRiskAutoDiscardTopic } from '@/lib/blog-publication-review-policy';
import { buildQueuedInformationBrief } from '@/lib/blog-queue-research';
import { decideBlogDemandMaterializationV4, normalizeBlogDemandQueryV4 } from './demand';
import { evaluateBlogContentFactoryQuotaV4, type BlogContentFactoryInventoryCountsV4 } from './quota';
import { persistBlogDemandMaterializationV4, requeueBlogContentOperationV4 } from './repository';
import type {
  BlogContentOperationRisk,
  BlogContentOperationType,
  BlogDemandRepresentativeV4,
  BlogDemandSignalProviderV4,
  BlogDemandSignalV4,
  BlogPackageSnapshotPinV4,
} from './types';

type QueueCandidate = {
  id: string;
  topic: string | null;
  destination: string | null;
  primary_keyword: string | null;
  category: string | null;
  source: string | null;
  angle_type: string | null;
  product_id: string | null;
  content_creative_id: string | null;
  meta: Record<string, unknown> | null;
  priority: number | null;
  created_at: string;
};

const FACTORY_SIGNAL_PROVIDERS = new Set<BlogDemandSignalProviderV4>([
  'google_search_console', 'naver_search_advisor', 'customer_question',
  'consultation_aggregate', 'active_product_question', 'operator_note',
  'editor_seed', 'search_volume', 'search_trend',
]);

function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function hashSignal(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function queueQuery(row: QueueCandidate): string {
  return String(row.primary_keyword || row.topic || row.destination || '').replace(/\s+/g, ' ').trim();
}

function riskFor(row: QueueCandidate): BlogContentOperationRisk {
  const explicit = String(row.meta?.risk_level ?? '').toUpperCase();
  const query = queueQuery(row);
  const highRiskTopic = isHighRiskAutoDiscardTopic({
    title: row.topic,
    category: row.category,
    topic: query,
  });
  if (highRiskTopic) return 'HIGH';
  if (['LOW', 'MEDIUM', 'HIGH'].includes(explicit)) return explicit as BlogContentOperationRisk;
  return /(?:입국|비자|여권|세관|면세|보험|의료|안전|esta|eta|etias)/i.test(query)
    ? 'HIGH'
    : /(?:요금|가격|운영시간|공항|교통|날씨|우기|환율)/i.test(query)
      ? 'MEDIUM'
      : 'LOW';
}

function fresh(value: string | null | undefined, now: Date): boolean {
  return !value || Date.parse(value) > now.getTime();
}

function signalFromLegacy(row: Record<string, unknown>, now: Date): BlogDemandSignalV4 | null {
  const provider = String(row.provider ?? '') as BlogDemandSignalProviderV4;
  const verifiedAt = typeof row.verified_at === 'string' ? row.verified_at : null;
  const observedAt = typeof row.observed_at === 'string' ? row.observed_at : null;
  const expiresAt = typeof row.expires_at === 'string' ? row.expires_at : null;
  if (!FACTORY_SIGNAL_PROVIDERS.has(provider) || !verifiedAt || !observedAt || !fresh(expiresAt, now)) return null;
  const sourceReference = String(row.source_reference ?? '').trim();
  const signalKey = String(row.signal_key ?? '').trim();
  if (!sourceReference || !signalKey) return null;
  return {
    provider,
    signalKey,
    sourceReference,
    sourceRowHash: hashSignal([
      provider, signalKey, sourceReference, observedAt, expiresAt, verifiedAt,
      row.signal_value ?? null, row.metadata ?? {},
    ]),
    observedAt,
    expiresAt,
    verifiedAt,
    metricValue: typeof row.signal_value === 'number' ? row.signal_value : null,
    metrics: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
    verifierType: 'system',
  };
}

function signalFromSearch(row: Record<string, unknown>): BlogDemandSignalV4 | null {
  const provider = String(row.provider ?? '') as BlogDemandSignalProviderV4;
  if (!['google_search_console', 'naver_search_advisor'].includes(provider)) return null;
  const metricDate = String(row.metric_date ?? '');
  const importedAt = String(row.imported_at ?? '');
  const sourceRowHash = String(row.source_row_hash ?? '').toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)
    || Number.isNaN(Date.parse(importedAt))
    || !/^[0-9a-f]{64}$/.test(sourceRowHash)) return null;
  const observedAt = `${metricDate}T00:00:00.000Z`;
  const expiresAt = new Date(Date.parse(observedAt) + 90 * 86_400_000).toISOString();
  return {
    provider,
    signalKey: String(row.query ?? ''),
    sourceReference: `blog_search_performance:${String(row.id ?? sourceRowHash)}`,
    sourceRowHash,
    observedAt,
    expiresAt,
    verifiedAt: importedAt,
    metricValue: Number(row.impressions ?? 0),
    metrics: {
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      ctr: Number(row.ctr ?? 0),
      average_position: row.average_position == null ? null : Number(row.average_position),
      page_url: String(row.page_url ?? ''),
    },
    verifierType: 'system',
  };
}

export function aggregateBlogSearchDemandRowsV4(
  rows: Array<Record<string, unknown>>,
): Array<{ normalizedQuery: string; signal: BlogDemandSignalV4 }> {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const provider = String(row.provider ?? '');
    const normalizedQuery = normalizeBlogDemandQueryV4(String(row.query ?? ''));
    if (!normalizedQuery || !['google_search_console', 'naver_search_advisor'].includes(provider)) continue;
    const key = `${normalizedQuery}|${provider}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const candidates: Array<{ normalizedQuery: string; signal: BlogDemandSignalV4 }> = [];
  for (const [key, group] of groups) {
    const normalizedQuery = key.slice(0, key.lastIndexOf('|'));
    const valid = group.map(signalFromSearch).filter((signal): signal is BlogDemandSignalV4 => Boolean(signal));
    if (valid.length === 0) continue;
    const clicks = valid.reduce((sum, signal) => sum + Number(signal.metrics?.clicks ?? 0), 0);
    const impressions = valid.reduce((sum, signal) => sum + Number(signal.metrics?.impressions ?? 0), 0);
    if (clicks <= 0 && impressions <= 0) continue;
    const positioned = valid.filter((signal) => Number(signal.metrics?.impressions ?? 0) > 0
      && Number.isFinite(Number(signal.metrics?.average_position)));
    const weightedPositionDenominator = positioned.reduce(
      (sum, signal) => sum + Number(signal.metrics?.impressions ?? 0), 0,
    );
    const averagePosition = weightedPositionDenominator > 0
      ? positioned.reduce((sum, signal) => sum
          + Number(signal.metrics?.average_position ?? 0) * Number(signal.metrics?.impressions ?? 0), 0)
        / weightedPositionDenominator
      : null;
    const latest = [...valid].sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0]!;
    const sourceHashes = valid.map((signal) => signal.sourceRowHash).sort();
    const pageCount = new Set(group.map((row) => String(row.page_url ?? '').trim()).filter(Boolean)).size;
    candidates.push({
      normalizedQuery,
      signal: {
        ...latest,
        sourceReference: `blog_search_performance_cluster:${latest.provider}:${normalizedQuery}`,
        sourceRowHash: hashSignal(sourceHashes),
        metricValue: impressions,
        metrics: {
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          average_position: averagePosition,
          source_row_count: valid.length,
          page_count: pageCount,
          cannibalization_penalty: Math.min(20, Math.max(0, pageCount - 1) * 5),
        },
      },
    });
  }
  return candidates.sort((left, right) => (
    Number(right.signal.metrics?.impressions ?? 0) - Number(left.signal.metrics?.impressions ?? 0)
  ));
}

function incrementCounts(
  counts: BlogContentFactoryInventoryCountsV4,
  type: BlogContentOperationType,
  createsNewUrl: boolean,
) {
  counts.totalOperations += 1;
  if (createsNewUrl) counts.newUrls += 1;
  counts.byType[type] = (counts.byType[type] ?? 0) + 1;
}

export function scopeBlogContentOperationIdempotencyKeyV4(input: {
  baseKey: string;
  candidateId: string;
  metadata?: Record<string, unknown> | null;
  environment?: string | null;
}): string {
  const stagingCanary = input.environment?.trim().toLowerCase() === 'staging'
    && typeof input.metadata?.blog_v4_staging_seed === 'string'
    && input.metadata.blog_v4_staging_seed.trim().length > 0;
  return stagingCanary
    ? `${input.baseKey}:staging-canary:${input.candidateId}`
    : input.baseKey;
}

export async function materializeBlogContentOperationsV4(input: {
  supabase: SupabaseClient;
  now?: Date;
  stage: BlogPublicationRampStage;
  environmentDailyCap: number;
  candidateLimit?: number;
  targetQueueId?: string | null;
  allowQuotaBypassForTarget?: boolean;
}): Promise<{
  scanned: number;
  materialized: number;
  reused: number;
  skipped: Record<string, number>;
  operationIds: string[];
}> {
  const now = input.now ?? new Date();
  const operationDayKst = kstDay(now);
  const candidateLimit = Math.max(1, Math.min(250, input.candidateLimit ?? 90));
  let candidatesQuery = input.supabase
    .from('blog_topic_queue')
    .select('id,topic,destination,primary_keyword,category,source,angle_type,product_id,content_creative_id,meta,priority,created_at')
    .eq('status', 'queued');
  if (input.targetQueueId) candidatesQuery = candidatesQuery.eq('id', input.targetQueueId);
  const { data: candidatesData, error: candidatesError } = await candidatesQuery
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(candidateLimit);
  if (candidatesError) throw new Error(`blog_factory_queue_load_failed:${candidatesError.message}`);
  const candidates = (candidatesData ?? []) as unknown as QueueCandidate[];
  const queueIds = candidates.map((row) => row.id);
  const queries = [...new Set(candidates.map(queueQuery).filter(Boolean))];
  const productIds = [...new Set(candidates.map((row) => row.product_id).filter((value): value is string => Boolean(value)))];
  const commercialTargetIds = [...new Set(candidates
    .filter((row) => row.product_id && row.content_creative_id)
    .map((row) => row.content_creative_id as string))];

  const [legacySignalsResult, searchResult, operationResult, pointerResult] = await Promise.all([
    queueIds.length > 0
      ? input.supabase.from('blog_demand_signals')
          .select('queue_id,provider,signal_key,signal_value,source_reference,observed_at,expires_at,verified_at,metadata')
          .in('queue_id', queueIds).order('observed_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    queries.length > 0
      ? input.supabase.from('blog_search_performance')
          .select('id,provider,metric_date,query,page_url,clicks,impressions,ctr,average_position,imported_at,source_row_hash')
          .gte('metric_date', new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10))
          .order('metric_date', { ascending: false }).limit(2000)
      : Promise.resolve({ data: [], error: null }),
    input.supabase.from('blog_content_operations')
      .select('operation_type,creates_new_url,status')
      .eq('operation_day_kst', operationDayKst),
    productIds.length > 0
      ? input.supabase.from('product_registration_v5_publication_pointers')
          .select('package_id,current_snapshot_id,state')
          .in('package_id', productIds).eq('channel', 'customer').eq('locale', 'ko-KR')
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = legacySignalsResult.error || searchResult.error || operationResult.error || pointerResult.error;
  if (firstError) throw new Error(`blog_factory_inventory_load_failed:${firstError.message}`);

  const pointerRows = (pointerResult.data ?? []) as Array<{ package_id: string; current_snapshot_id: string | null; state: string }>;
  const snapshotIds = pointerRows.map((row) => row.current_snapshot_id).filter((value): value is string => Boolean(value));
  const { data: snapshotRows, error: snapshotError } = snapshotIds.length > 0
    ? await input.supabase.from('public_package_snapshots')
        .select('id,package_id,package_revision,snapshot_hash,status,created_at,published_at')
        .in('id', snapshotIds)
    : { data: [], error: null };
  if (snapshotError) throw new Error(`blog_factory_package_snapshot_load_failed:${snapshotError.message}`);
  const { data: commercialTargetRows, error: commercialTargetError } = commercialTargetIds.length > 0
    ? await input.supabase.from('content_creatives')
        .select('id,product_id,status,channel,slug')
        .in('id', commercialTargetIds)
    : { data: [], error: null };
  if (commercialTargetError) {
    throw new Error(`blog_factory_commercial_target_load_failed:${commercialTargetError.message}`);
  }

  const signalByQueue = new Map<string, BlogDemandSignalV4>();
  for (const row of (legacySignalsResult.data ?? []) as Array<Record<string, unknown>>) {
    const queueId = String(row.queue_id ?? '');
    if (!queueId || signalByQueue.has(queueId)) continue;
    const signal = signalFromLegacy(row, now);
    if (signal) signalByQueue.set(queueId, signal);
  }
  const signalByQuery = new Map<string, BlogDemandSignalV4>();
  for (const candidate of aggregateBlogSearchDemandRowsV4(
    (searchResult.data ?? []) as Array<Record<string, unknown>>,
  )) {
    if (!signalByQuery.has(candidate.normalizedQuery) && fresh(candidate.signal.expiresAt, now)) {
      signalByQuery.set(candidate.normalizedQuery, candidate.signal);
    }
  }
  const pointerByPackage = new Map(pointerRows.map((row) => [row.package_id, row]));
  const snapshotById = new Map(((snapshotRows ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
  const commercialTargetById = new Map(((commercialTargetRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => [String(row.id), row]));

  const counts: BlogContentFactoryInventoryCountsV4 = { totalOperations: 0, newUrls: 0, byType: {} };
  for (const row of (operationResult.data ?? []) as Array<{ operation_type: BlogContentOperationType; creates_new_url: boolean }>) {
    incrementCounts(counts, row.operation_type, row.creates_new_url);
  }

  const skipped: Record<string, number> = {};
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const operationIds: string[] = [];
  let materialized = 0;
  let reused = 0;

  for (const candidate of candidates) {
    const primaryQuery = queueQuery(candidate);
    if (!primaryQuery) { skip('query_missing'); continue; }
    const signal = signalByQueue.get(candidate.id)
      ?? signalByQuery.get(normalizeBlogDemandQueryV4(primaryQuery));

    let packageSnapshot: BlogPackageSnapshotPinV4 | null = null;
    if (candidate.product_id) {
      const pointer = pointerByPackage.get(candidate.product_id);
      const snapshot = pointer?.current_snapshot_id ? snapshotById.get(pointer.current_snapshot_id) : null;
      if (!pointer || !snapshot || !['approved', 'published'].includes(pointer.state)
        || !['approved', 'published'].includes(String(snapshot.status))) {
        skip('active_package_snapshot_missing');
        continue;
      }
      packageSnapshot = {
        packageId: candidate.product_id,
        snapshotId: String(snapshot.id),
        revision: Number(snapshot.package_revision),
        hash: String(snapshot.snapshot_hash),
      };
    }
    let refreshTargetCreativeId: string | null = null;
    if (candidate.product_id && candidate.content_creative_id) {
      const target = commercialTargetById.get(candidate.content_creative_id);
      if (!target || target.status !== 'published' || target.channel !== 'naver_blog'
        || target.product_id !== candidate.product_id || !String(target.slug ?? '').trim()) {
        skip('commercial_refresh_target_invalid');
        continue;
      }
      refreshTargetCreativeId = candidate.content_creative_id;
    }
    const effectiveSignal = signal ?? (packageSnapshot ? {
      provider: 'active_product' as const,
      signalKey: `active-package:${packageSnapshot.packageId}`,
      sourceReference: `public_package_snapshot:${packageSnapshot.snapshotId}`,
      sourceRowHash: hashSignal(['active_product', packageSnapshot.snapshotId, packageSnapshot.hash]),
      observedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      verifiedAt: now.toISOString(),
      metricValue: 1,
      metrics: { product_relevance: 1 },
      verifierType: 'system' as const,
    } : null);
    if (!effectiveSignal) { skip('verified_demand_signal_missing'); continue; }

    const brief = buildQueuedInformationBrief(candidate);
    let representativeKey: string | null = null;
    if (!candidate.product_id && brief.plan.destinationId) {
      try {
        representativeKey = buildBlogInformationRepresentativeKey({
          destinationId: brief.plan.destinationId,
          intent: brief.intentType,
          audience: brief.plan.audience,
          locale: brief.plan.locale,
        });
      } catch {
        representativeKey = null;
      }
    }
    let representative: BlogDemandRepresentativeV4 | null = null;
    if (representativeKey) {
      const { data, error } = await input.supabase.from('blog_information_representatives')
        .select('representative_key,canonical_creative_id,canonical_slug,status')
        .eq('representative_key', representativeKey).maybeSingle();
      if (error) throw new Error(`blog_factory_representative_load_failed:${error.message}`);
      if (data?.status === 'active' && data.canonical_creative_id && data.canonical_slug) {
        representative = {
          representativeKey: data.representative_key,
          canonicalCreativeId: data.canonical_creative_id,
          canonicalSlug: data.canonical_slug,
          status: 'active',
        };
      }
    }

    const decision = decideBlogDemandMaterializationV4({
      primaryQuery,
      destinationId: brief.plan.destinationId || candidate.destination,
      audience: brief.plan.audience,
      locale: brief.plan.locale,
      riskLevel: riskFor(candidate),
      signal: effectiveSignal,
      representative,
      refreshTargetCreativeId,
      packageSnapshot,
      seasonal: candidate.source === 'seasonal',
      emergency: candidate.meta?.urgent === true,
      queueId: candidate.id,
      creativeId: candidate.content_creative_id,
      operationDayKst,
    }, now);
    const quota = evaluateBlogContentFactoryQuotaV4({
      stage: input.stage,
      environmentDailyCap: input.environmentDailyCap,
      counts,
      candidateType: decision.operationType,
      candidateCreatesNewUrl: decision.createsNewUrl,
    });
    const isExplicitTarget = Boolean(input.targetQueueId && candidate.id === input.targetQueueId);
    if (!quota.allowed && !(isExplicitTarget && input.allowQuotaBypassForTarget)) {
      quota.reasons.forEach(skip);
      continue;
    }
    // A staging canary deliberately creates a fresh queue row while keeping
    // the reader-facing query stable. Scope only that explicit staging seed's
    // idempotency key to its queue so an earlier canary for the same query
    // cannot hand the new run an unrelated operation. Production retains the
    // normal same-day cluster idempotency contract.
    const stagingCanary = process.env.BLOG_V4_ENVIRONMENT?.trim().toLowerCase() === 'staging'
      && typeof candidate.meta?.blog_v4_staging_seed === 'string'
      && candidate.meta.blog_v4_staging_seed.trim().length > 0;
    const persisted = await persistBlogDemandMaterializationV4({
      supabase: input.supabase,
      decision: stagingCanary
        ? {
            ...decision,
            idempotencyKey: scopeBlogContentOperationIdempotencyKeyV4({
              baseKey: decision.idempotencyKey,
              candidateId: candidate.id,
              metadata: candidate.meta,
              environment: process.env.BLOG_V4_ENVIRONMENT,
            }),
          }
        : decision,
    });
    operationIds.push(persisted.operationId);
    if (persisted.operationCreated) {
      materialized += 1;
      incrementCounts(counts, decision.operationType, decision.createsNewUrl);
    } else {
      const { data: existingOperation, error: existingOperationError } = await input.supabase
        .from('blog_content_operations')
        .select('status')
        .eq('id', persisted.operationId)
        .maybeSingle();
      if (existingOperationError) {
        throw new Error(`blog_factory_existing_operation_load_failed:${existingOperationError.message}`);
      }
      if (existingOperation?.status === 'research_backlog') {
        await requeueBlogContentOperationV4({
          supabase: input.supabase,
          operationId: persisted.operationId,
        });
      }
      reused += 1;
    }
  }

  return { scanned: candidates.length, materialized, reused, skipped, operationIds };
}
