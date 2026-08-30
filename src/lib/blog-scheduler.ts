import { createHash } from 'node:crypto';
import {
  compareBlogDuplicateCandidatePreference,
  isPublishedBlogQualityUpgradeCandidate,
} from './blog-publishable-duplicate-cleanup';
import { buildBlogContentBrief } from './blog-content-brief';
import { buildBlogInformationRepresentativeKey } from './blog-information-representative';
import { CUSTOMER_VISIBLE_STATUSES } from './visibility-status';
import {
  hasVerifiedBlogDemandSignal,
  readBlogAutopublishPolicyV3,
  type BlogDemandSignalInput,
} from './blog-autopublish-policy-v3';
import {
  mergePersistedBlogDemandSignalsV3,
  readEmbeddedBlogQueueDemandSignalV3,
  type PersistedBlogDemandSignalV3,
} from './blog-demand-repository-v3';
import { PUBLIC_BLOG_READ_SOURCE } from './blog-public-eligibility';

type MicroAngleId =
  | 'budget_family'
  | 'transport_cost'
  | 'hotel_area'
  | 'food_budget'
  | 'weather_packing'
  | 'first_day_plan'
  | 'shopping_budget'
  | 'kid_friendly'
  | 'airport_arrival'
  | 'local_mobility';

interface MicroAngleTemplate {
  id: MicroAngleId;
  category: string;
  keywordSuffix: string;
  topic: (destination: string, year: number, month: number) => string;
}

const MICRO_ANGLE_TEMPLATES: MicroAngleTemplate[] = [
  {
    id: 'budget_family',
    category: 'travel_tips',
    keywordSuffix: '가족여행 예산 계산',
    topic: (destination) => `${destination} 가족여행 예산에서 먼저 계산할 비용`,
  },
  {
    id: 'transport_cost',
    category: 'transport',
    keywordSuffix: '공항 숙소 이동 비용',
    topic: (destination) => `${destination} 공항에서 숙소 이동수단 비용과 시간 비교`,
  },
  {
    id: 'hotel_area',
    category: 'hotel',
    keywordSuffix: '숙소 지역 선택',
    topic: (destination) => `${destination} 숙소 지역 선택 공항 이동과 일정 기준`,
  },
  {
    id: 'food_budget',
    category: 'food',
    keywordSuffix: '식비 예산',
    topic: (destination) => `${destination} 식비 예산 끼니별 비용과 추가요금 확인`,
  },
  {
    id: 'weather_packing',
    category: 'preparation',
    keywordSuffix: '날씨 옷차림 준비물',
    topic: (destination, _year, month) => `${destination} ${month}월 날씨와 옷차림 준비물 체크`,
  },
  {
    id: 'first_day_plan',
    category: 'itinerary',
    keywordSuffix: '도착 첫날 일정',
    topic: (destination) => `${destination} 도착 첫날 일정 공항에서 숙소까지 동선`,
  },
  {
    id: 'shopping_budget',
    category: 'shopping',
    keywordSuffix: '쇼핑 예산',
    topic: (destination) => `${destination} 쇼핑 예산 품목별 가격과 세관 확인`,
  },
  {
    id: 'kid_friendly',
    category: 'family',
    keywordSuffix: '아이와 가족여행',
    topic: (destination) => `${destination} 아이와 가기 좋은 코스와 가족 일정`,
  },
  {
    id: 'airport_arrival',
    category: 'transport',
    keywordSuffix: '공항 도착 숙소 이동',
    topic: (destination) => `${destination} 공항 도착 후 숙소까지 이동 순서와 선택 기준`,
  },
  {
    id: 'local_mobility',
    category: 'transport',
    keywordSuffix: '현지 이동수단',
    topic: (destination) => `${destination} 현지 이동수단 비용과 이용 조건 비교`,
  },
];

function microAngleKey(destination: string | null | undefined, microAngle: string | null | undefined): string | null {
  const dest = destination?.trim();
  const angle = microAngle?.trim();
  if (!dest || !angle) return null;
  return `${dest}::${angle}`;
}

function destinationAngleKey(row: QueueCandidateLike): string | null {
  if (row.product_id) return null;
  const destination = row.destination?.trim();
  if (!destination || row.source === 'pillar') return null;
  const angle = row.angle_type?.trim() || 'value';
  return `info_writer::destination_angle::${destination}::${angle}`;
}

function readMicroAngle(row: { angle_type?: string | null; generation_meta?: any; meta?: any }): string | null {
  const fromMeta = row.meta?.micro_angle ?? row.generation_meta?.micro_angle;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  const rawAngle = row.angle_type;
  if (typeof rawAngle === 'string' && MICRO_ANGLE_TEMPLATES.some(t => t.id === rawAngle)) return rawAngle;
  return null;
}

export function buildMicroAnglePrimaryKeyword(destination: string, template: Pick<MicroAngleTemplate, 'keywordSuffix'>): string {
  return `${destination} ${template.keywordSuffix}`.replace(/\s+/g, ' ').trim();
}

export const MIN_PUBLISHABLE_BUFFER_DAYS = 3;

const WEATHER_READER_SCENARIOS = [
  'first_time_light_packer',
  'family_rain_plan',
  'urban_walking_day',
  'late_arrival_check',
] as const;

const WEATHER_OPENING_VARIANTS = [
  'temperature_first',
  'rain_first',
  'clothing_decision_first',
  'packing_mistake_first',
] as const;

const WEATHER_SECTION_ORDER_VARIANTS = [
  'weather_then_clothing',
  'clothing_then_rain',
  'decision_table_first',
  'packing_then_local_risk',
] as const;

const WEATHER_HEADING_COPY_VARIANTS = [
  'core_weather_check',
  'departure_weather_basis',
  'packing_decision',
  'clothing_check_order',
  'trip_weather_decision',
  'departure_packing_basis',
  'route_weather_prep',
  'forecast_prep',
] as const;

export const WEATHER_EDITORIAL_VARIATION_CONTRACT_VERSION = 3;

function stableIndex(seed: string, modulo: number): number {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  return digest.readUInt32BE(0) % Math.max(1, modulo);
}

export function buildWeatherQueueVariation(destination: string, month: number): {
  contract_version: number;
  reader_scenario: string;
  opening_variant: string;
  section_order_variant: string;
  heading_copy_variant: string;
} {
  const seed = `${destination}:${month}`;
  return {
    contract_version: WEATHER_EDITORIAL_VARIATION_CONTRACT_VERSION,
    reader_scenario: WEATHER_READER_SCENARIOS[stableIndex(`${seed}:reader`, WEATHER_READER_SCENARIOS.length)]!,
    opening_variant: WEATHER_OPENING_VARIANTS[stableIndex(`${seed}:opening`, WEATHER_OPENING_VARIANTS.length)]!,
    section_order_variant: WEATHER_SECTION_ORDER_VARIANTS[stableIndex(`${seed}:section`, WEATHER_SECTION_ORDER_VARIANTS.length)]!,
    heading_copy_variant: WEATHER_HEADING_COPY_VARIANTS[stableIndex(`${seed}:heading`, WEATHER_HEADING_COPY_VARIANTS.length)]!,
  };
}

type QueueCandidateLike = {
  id?: string | null;
  product_id?: string | null;
  content_creative_id?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  category?: string | null;
  angle_type?: string | null;
  topic?: string | null;
  slug?: string | null;
  source?: string | null;
  priority?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  slug_hint?: string | null;
  generation_meta?: any;
  meta?: any;
  monthly_search_volume?: number | null;
  trend_score?: number | null;
};

export async function loadQueueDemandSignalMapV3(
  rows: QueueCandidateLike[],
  client: any = supabaseAdmin,
): Promise<Map<string, BlogDemandSignalInput>> {
  const map = new Map<string, BlogDemandSignalInput>();
  const ids = rows.map((row) => row.id).filter((id): id is string => Boolean(id));
  for (const row of rows) {
    if (row.id) map.set(row.id, readEmbeddedBlogQueueDemandSignalV3(row));
  }
  if (ids.length === 0) return map;
  let persistedRows: any[] = [];
  try {
    const result = await client
      .from('blog_demand_signals')
      .select('queue_id, provider, signal_value, source_reference, verified_at, expires_at')
      .in('queue_id', ids);
    if (!result.error) persistedRows = result.data ?? [];
  } catch {
    persistedRows = [];
  }
  const grouped = new Map<string, PersistedBlogDemandSignalV3[]>();
  for (const row of persistedRows) {
    const queueId = typeof row.queue_id === 'string' ? row.queue_id : null;
    if (!queueId) continue;
    const values = grouped.get(queueId) ?? [];
    values.push(row as PersistedBlogDemandSignalV3);
    grouped.set(queueId, values);
  }
  for (const row of rows) {
    if (!row.id) continue;
    map.set(row.id, mergePersistedBlogDemandSignalsV3(
      map.get(row.id) ?? {},
      grouped.get(row.id) ?? [],
    ).signal);
  }
  const normalizeQuery = (value: unknown) => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const keywordToQueueIds = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.id) continue;
    const keyword = normalizeQuery(row.primary_keyword);
    if (!keyword) continue;
    keywordToQueueIds.set(keyword, [...(keywordToQueueIds.get(keyword) ?? []), row.id]);
  }
  const keywords = [...keywordToQueueIds.keys()];
  if (keywords.length > 0) {
    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const performance = await client
        .from('blog_search_performance')
        .select('provider, query, impressions')
        .in('query', keywords)
        .gte('metric_date', since)
        .gt('impressions', 0)
        .limit(5000);
      if (!performance.error) {
        for (const observed of performance.data ?? []) {
          const queueIds = keywordToQueueIds.get(normalizeQuery(observed.query)) ?? [];
          for (const queueId of queueIds) {
            const signal = map.get(queueId) ?? {};
            if (observed.provider === 'google_search_console') signal.gsc = true;
            if (observed.provider === 'naver_search_advisor') signal.naver = true;
            map.set(queueId, signal);
          }
        }
      }
    } catch {
      // Missing V3 repository or old test client: embedded/persisted demand
      // remains authoritative and the caller still fails closed when absent.
    }
  }
  return map;
}

function readWriterType(row: QueueCandidateLike): string {
  const raw = row.meta?.writer_type ?? row.meta?.writer ?? row.generation_meta?.writer;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return row.product_id ? 'product_consultant_writer' : 'info_writer';
}

function readExpectedSlug(row: QueueCandidateLike): string | null {
  const raw = row.meta?.expected_slug ?? row.meta?.spun_slug ?? row.slug_hint ?? row.slug;
  return typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : null;
}

function readProductDedupKey(row: QueueCandidateLike): string | null {
  const raw = row.meta?.product_dedup_key ?? row.generation_meta?.product_dedup_key ?? row.meta?.dedup_key;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toLowerCase();
  if (typeof row.product_id === 'string' && row.product_id.trim()) return row.product_id.trim().toLowerCase();
  return null;
}

function hasEvidenceInsufficientFlag(row: QueueCandidateLike): boolean {
  return row.meta?.evidence_insufficient === true ||
    row.meta?.failure_code === 'evidence_insufficient' ||
    row.generation_meta?.failure_bucket === 'evidence_insufficient';
}

function hasProductOpenContractBlock(row: QueueCandidateLike): boolean {
  return row.meta?.failure_code === 'product_open_contract' ||
    row.meta?.quarantine_reason === 'product_open_contract' ||
    row.generation_meta?.failure_bucket === 'product_open_contract';
}

function publishableQueueKey(row: QueueCandidateLike): string | null {
  const writer = readWriterType(row);
  const productDedupKey = readProductDedupKey(row);
  if (productDedupKey) return `${writer}::product::${productDedupKey}`;
  const micro = readMicroAngle(row);
  const microKey = microAngleKey(row.destination, micro);
  if (microKey) return `${writer}::${microKey}`;
  const destinationAngle = destinationAngleKey(row);
  if (destinationAngle) return destinationAngle;
  const slug = readExpectedSlug(row);
  if (slug) return `${writer}::slug::${slug}`;
  if (typeof row.topic === 'string' && row.topic.trim()) {
    return `${writer}::topic::${row.topic.trim().toLowerCase()}`;
  }
  return null;
}

function publishableRepresentativeKey(row: QueueCandidateLike): string | null {
  if (row.product_id || row.source === 'pillar') return null;
  const brief = buildBlogContentBrief({
    topic: row.topic,
    destination: row.destination,
    primaryKeyword: row.primary_keyword,
    category: row.category,
    source: row.source,
    microAngle: readMicroAngle(row),
    audience: typeof row.meta?.audience === 'string' ? row.meta.audience : null,
    locale: typeof row.meta?.locale === 'string' ? row.meta.locale : 'ko-KR',
    travelerNationality: typeof row.meta?.traveler_nationality === 'string'
      ? row.meta.traveler_nationality
      : null,
  });
  if (!brief.passed || !brief.plan.destinationId || brief.intentType === 'general') return null;
  return buildBlogInformationRepresentativeKey({
    destinationId: brief.plan.destinationId,
    intent: brief.intentType,
    audience: brief.plan.audience,
    locale: brief.plan.locale,
  });
}

export function countPublishableQueueCandidates(input: {
  activeQueue: QueueCandidateLike[];
  recentPublished: QueueCandidateLike[];
  activeRepresentativeKeys?: ReadonlySet<string>;
  demandSignalsByQueueId?: ReadonlyMap<string, BlogDemandSignalInput>;
}): {
  publishableCount: number;
  blockedRecentDuplicate: number;
  duplicateQueued: number;
  evidenceInsufficient: number;
  productOpenContractBlocked: number;
  destinationlessInfoBlocked: number;
  candidateContractBlocked: number;
  researchNotReady: number;
  demandMissing: number;
} {
  const recentKeys = new Set<string>();
  for (const row of input.recentPublished) {
    const key = publishableQueueKey(row);
    if (key) recentKeys.add(key);
  }

  const publishableKeys = new Set<string>();
  const candidateKeys = new Set<string>();
  let blockedRecentDuplicate = 0;
  let duplicateQueued = 0;
  let evidenceInsufficient = 0;
  let productOpenContractBlocked = 0;
  let destinationlessInfoBlocked = 0;
  let candidateContractBlocked = 0;
  let researchNotReady = 0;
  let demandMissing = 0;

  for (const row of [...input.activeQueue].sort(compareBlogDuplicateCandidatePreference)) {
    if (row.source === 'pillar') continue;
    if (hasProductOpenContractBlock(row)) {
      productOpenContractBlocked += 1;
      continue;
    }
    if (hasEvidenceInsufficientFlag(row)) {
      evidenceInsufficient += 1;
      continue;
    }
    if (destinationlessInfoBlocksPublishability(row)) {
      destinationlessInfoBlocked += 1;
      continue;
    }
    if (!inspectBlogCandidatePrepublishContract(row).passed) {
      candidateContractBlocked += 1;
      continue;
    }
    const key = publishableQueueKey(row);
    if (!key) continue;
    const representativeKey = publishableRepresentativeKey(row);
    if (
      representativeKey
      && input.activeRepresentativeKeys?.has(representativeKey)
      && !isPublishedBlogQualityUpgradeCandidate(row)
    ) {
      blockedRecentDuplicate += 1;
      continue;
    }
    if (recentKeys.has(key) && !isPublishedBlogQualityUpgradeCandidate(row)) {
      blockedRecentDuplicate += 1;
      continue;
    }
    if (candidateKeys.has(key)) {
      duplicateQueued += 1;
      continue;
    }
    candidateKeys.add(key);
    if (readWriterType(row) === 'info_writer' && !evaluateQueuedInformationResearch(row).passed) {
      researchNotReady += 1;
      continue;
    }
    const demandSignal = row.id ? input.demandSignalsByQueueId?.get(row.id) : undefined;
    if (!hasVerifiedBlogDemandSignal(demandSignal ?? readEmbeddedBlogQueueDemandSignalV3(row))) {
      demandMissing += 1;
      continue;
    }
    publishableKeys.add(key);
  }

  return {
    publishableCount: publishableKeys.size,
    blockedRecentDuplicate,
    duplicateQueued,
    evidenceInsufficient,
    productOpenContractBlocked,
    destinationlessInfoBlocked,
    candidateContractBlocked,
    researchNotReady,
    demandMissing,
  };
}

async function quarantineDuplicatePublishableCandidates(input: {
  activeQueue: QueueCandidateLike[];
  recentPublished: QueueCandidateLike[];
  activeRepresentativeKeys?: ReadonlySet<string>;
}): Promise<number> {
  const recentKeys = new Set<string>();
  for (const row of input.recentPublished) {
    const key = publishableQueueKey(row);
    if (key) recentKeys.add(key);
  }

  const seen = new Set<string>();
  const duplicateRows: Array<{ id: string; key: string; meta: Record<string, unknown> }> = [];
  for (const row of [...input.activeQueue].sort(compareBlogDuplicateCandidatePreference)) {
    if (
      !row.id ||
      row.source === 'pillar' ||
      hasEvidenceInsufficientFlag(row) ||
      hasProductOpenContractBlock(row) ||
      destinationlessInfoBlocksPublishability(row) ||
      !inspectBlogCandidatePrepublishContract(row).passed ||
      (readWriterType(row) === 'info_writer' && !evaluateQueuedInformationResearch(row).passed)
    ) continue;
    const key = publishableQueueKey(row);
    if (!key) continue;
    const representativeKey = publishableRepresentativeKey(row);
    const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
      ? row.meta as Record<string, unknown>
      : {};
    if (
      (
        representativeKey
        && input.activeRepresentativeKeys?.has(representativeKey)
        && !isPublishedBlogQualityUpgradeCandidate(row)
      )
      ||
      (recentKeys.has(key) && !isPublishedBlogQualityUpgradeCandidate(row))
      || seen.has(key)
    ) {
      duplicateRows.push({ id: row.id, key, meta });
      continue;
    }
    seen.add(key);
  }

  if (duplicateRows.length === 0) return 0;
  const now = new Date().toISOString();
  let quarantined = 0;
  for (const row of duplicateRows.slice(0, 50)) {
    const { error } = await supabaseAdmin
      .from('blog_topic_queue')
      .update({
        status: 'skipped',
        last_error: 'candidate_duplicate_preclaim',
        updated_at: now,
        meta: {
          ...row.meta,
          self_heal_blocked: true,
          quarantine_reason: 'duplicate_preclaim',
          duplicate_key: row.key,
          quarantined_by: 'blog-engine-v2-publishability',
          quarantined_at: now,
        },
      } as never)
      .eq('id', row.id)
      .eq('status', 'queued');
    if (!error) quarantined += 1;
  }
  return quarantined;
}

export async function ensureDailyPublishableQueue(opts?: {
  postsPerDay?: number;
  minCandidates?: number;
}): Promise<{
  added: number;
  existingQueued: number;
  targetCandidates: number;
  skippedRecentDuplicate: number;
  skippedQueuedDuplicate: number;
  evidenceInsufficient: number;
  quarantinedDuplicateCandidates: number;
  publishabilitySnapshot: BlogPublishabilitySnapshot;
  rejectedByTopicFit: number;
  insertedTopics: string[];
}> {
  const policy = await getBlogPublishingPolicy('global');
  const postsPerDay = normalizeDailyPostTarget(opts?.postsPerDay ?? policy.posts_per_day);
  const targetCandidates = Math.max(
    opts?.minCandidates ?? 0,
    postsPerDay * MIN_PUBLISHABLE_BUFFER_DAYS,
  );

  const since = new Date();
  since.setDate(since.getDate() - Math.max(14, policy.multi_angle_gap_days ?? 14));

  const [recentPublishedRes, activeQueueRes, activeRepresentativesRes] = await Promise.all([
    supabaseAdmin
      .from(PUBLIC_BLOG_READ_SOURCE)
      .select('destination, angle_type, slug, product_id, generation_meta')
      .gte('published_at', since.toISOString())
      .limit(300),
    supabaseAdmin
      .from('blog_topic_queue')
      .select('id, product_id, content_creative_id, destination, primary_keyword, category, angle_type, topic, source, priority, created_at, updated_at, monthly_search_volume, trend_score, meta')
      .in('status', ['queued', 'generating'])
      .limit(500),
    supabaseAdmin
      .from('blog_information_representatives')
      .select('representative_key')
      .eq('status', 'active')
      .limit(500),
  ]);
  const activeRepresentativeKeys = new Set(
    (activeRepresentativesRes.data ?? [])
      .map(row => row.representative_key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0),
  );

  const demandSignalsByQueueId = await loadQueueDemandSignalMapV3(activeQueueRes.data ?? []);
  const queueCandidateStats = countPublishableQueueCandidates({
    activeQueue: activeQueueRes.data ?? [],
    recentPublished: recentPublishedRes.data ?? [],
    activeRepresentativeKeys,
    demandSignalsByQueueId,
  });
  const queuedTotal = activeQueueRes.data?.filter((row: QueueCandidateLike) => row.source !== 'pillar').length ?? 0;
  const duplicateCount = queueCandidateStats.blockedRecentDuplicate + queueCandidateStats.duplicateQueued;
  const publishabilitySnapshot: BlogPublishabilitySnapshot = {
    queued_total: queuedTotal,
    publishable_count: queueCandidateStats.publishableCount,
    duplicate_count: duplicateCount,
    evidence_insufficient_count: queueCandidateStats.evidenceInsufficient
      + queueCandidateStats.productOpenContractBlocked
      + queueCandidateStats.researchNotReady
      + queueCandidateStats.demandMissing,
    destinationless_info_count: queueCandidateStats.destinationlessInfoBlocked,
    candidate_contract_blocked_count: queueCandidateStats.candidateContractBlocked,
    candidate_shortage: queueCandidateStats.publishableCount < targetCandidates,
    next_action: queueCandidateStats.evidenceInsufficient
      + queueCandidateStats.productOpenContractBlocked
      + queueCandidateStats.researchNotReady
      + queueCandidateStats.demandMissing > 0
      ? 'collect_evidence'
      : queueCandidateStats.destinationlessInfoBlocked > 0
        ? 'repair_destinationless_info'
        : queueCandidateStats.candidateContractBlocked > 0
          ? 'repair_candidate_contract'
          : duplicateCount > 0
            ? 'quarantine_duplicates'
            : queueCandidateStats.publishableCount < targetCandidates
              ? 'refill_candidates'
              : 'publish_ready',
  };
  const quarantinedDuplicateCandidates = await quarantineDuplicatePublishableCandidates({
    activeQueue: activeQueueRes.data ?? [],
    recentPublished: recentPublishedRes.data ?? [],
    activeRepresentativeKeys,
  });
  const existingQueued = queueCandidateStats.publishableCount;
  if (existingQueued >= targetCandidates) {
    return {
      added: 0,
      existingQueued,
      targetCandidates,
      skippedRecentDuplicate: queueCandidateStats.blockedRecentDuplicate,
      skippedQueuedDuplicate: queueCandidateStats.duplicateQueued,
      evidenceInsufficient: queueCandidateStats.evidenceInsufficient
        + queueCandidateStats.productOpenContractBlocked
        + queueCandidateStats.researchNotReady
        + queueCandidateStats.demandMissing,
      quarantinedDuplicateCandidates,
      publishabilitySnapshot,
      rejectedByTopicFit: 0,
      insertedTopics: [],
    };
  }

  // Coverage gaps and reviewed climate research prove that an article can be
  // researched; they do not prove that anyone needs it. Queue creation waits
  // for an observed demand record or an explicitly verified human/product
  // signal instead of manufacturing another weather candidate.
  return {
    added: 0,
    existingQueued,
    targetCandidates,
    skippedRecentDuplicate: queueCandidateStats.blockedRecentDuplicate,
    skippedQueuedDuplicate: queueCandidateStats.duplicateQueued,
    evidenceInsufficient: queueCandidateStats.evidenceInsufficient
      + queueCandidateStats.productOpenContractBlocked
      + queueCandidateStats.researchNotReady
      + queueCandidateStats.demandMissing,
    quarantinedDuplicateCandidates,
    publishabilitySnapshot: {
      ...publishabilitySnapshot,
      publishable_count: existingQueued,
      candidate_shortage: existingQueued < targetCandidates,
      next_action: 'collect_demand',
    },
    rejectedByTopicFit: 0,
    insertedTopics: [],
  };
}

/**
 * 블로그 스케줄러 — 발행 캘린더 자동 생성
 *
 * 책임:
 *   1) 매주 월 0시: 이번 주 토픽 N개 큐 충전 (시즌 + 갭 + 상품신규)
 *   2) 매일 첫 슬롯 전: 오늘 발행할 5개 슬롯에 큐 항목 배정 (target_publish_at 설정)
 *
 * 발행 스케줄: 하루 5개, 09/12/15/18/21 KST
 * 비율: 상품 40% + 정보성 60% (주간 기준)
 *
 * Priority 규칙:
 *   user_seed = 90 (최우선)
 *   product   = 80 (신규 상품은 발행일 임박)
 *   seasonal  = 60
 *   coverage  = 40
 */

import { supabaseAdmin } from './supabase';
import { pickSeasonalTopics, generateNextQuarterTopics } from './blog-seasonal-calendar';
import { analyzeCoverageGaps } from './blog-coverage-analyzer';
import { researchKeywordsBatch, classifyKeywordTier, type KeywordTier } from './keyword-research';
import { filterTopicFitPassed } from './blog-topic-fit-gate';
import { buildProductDedupKey, resolveProductDepartureDate, resolveProductSupplierCode } from './blog-product-brief';
import type { BlogPublishabilitySnapshot } from './blog-engine-v2';
import { destinationlessInfoBlocksPublishability } from './blog-destinationless-info';
import { inspectBlogCandidatePrepublishContract } from './blog-candidate-prepublish-contract';
import { evaluateQueuedInformationResearch } from './blog-queue-research';

// fallback (DB 정책 없을 때) — publishing_policies.scope='global' 우선
export const DAILY_PUBLISH_SLOTS = ['09:00', '12:00', '15:00', '18:00', '21:00'];

export const MIN_POSTS_PER_DAY = 0;
export const MAX_POSTS_PER_DAY = 5;
export const DEFAULT_POSTS_PER_DAY = 1;
export const PRODUCT_RATIO = 0.4; // 40% — multi-angle drip 도입으로 상품 비중 상향
export const SCHEDULE_OCCUPYING_QUEUE_STATUSES = ['queued', 'generating'] as const;

export interface PublishingPolicy {
  scope: string;
  posts_per_day: number;
  per_destination_daily_cap: number;
  slot_times: string[];
  product_ratio: number;
  multi_angle_count: number;
  multi_angle_gap_days: number;
  auto_trigger_card_news?: boolean;
  auto_trigger_orchestrator?: boolean;
  auto_regenerate_underperformers?: boolean;
  daily_summary_webhook?: string | null;
}

export function normalizeDailyPostTarget(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : DEFAULT_POSTS_PER_DAY;
  const configured = Number.isFinite(parsed)
    ? Math.min(MAX_POSTS_PER_DAY, Math.max(MIN_POSTS_PER_DAY, parsed))
    : DEFAULT_POSTS_PER_DAY;
  return Math.min(configured, readBlogAutopublishPolicyV3().dailyPublishCap);
}

export async function getBlogPublishingPolicy(scope: string = 'global'): Promise<PublishingPolicy> {
  try {
    const { data } = await supabaseAdmin
      .from('publishing_policies')
      .select('*')
      .eq('scope', scope)
      .eq('enabled', true)
      .limit(1);
    if (data?.[0]) {
      const policy = data[0] as PublishingPolicy;
      return {
        ...policy,
        posts_per_day: normalizeDailyPostTarget(policy.posts_per_day),
        slot_times: policy.slot_times?.length === MAX_POSTS_PER_DAY
          ? policy.slot_times.slice(0, MAX_POSTS_PER_DAY)
          : DAILY_PUBLISH_SLOTS,
      };
    }
  } catch { /* fallback */ }
  return {
    scope: 'global',
    posts_per_day: DEFAULT_POSTS_PER_DAY,
    per_destination_daily_cap: 2,
    slot_times: DAILY_PUBLISH_SLOTS,
    product_ratio: PRODUCT_RATIO,
    multi_angle_count: 5,
    multi_angle_gap_days: 3,
  };
}

function kstToUtcIso(yyyyMmDd: string, hhmm: string): string {
  // KST(+09:00) 기준 로컬을 UTC ISO 로 변환
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const kstDate = new Date(Date.UTC(y, m - 1, d, hh - 9, mm, 0));
  return kstDate.toISOString();
}

function kstDateString(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]!;
}

/**
 * 이번 주 큐를 채운다 — 매주 월 0시 실행
 */
export async function refillWeeklyQueue(opts?: { postsPerDay?: number }): Promise<{
  seasonal_added: number;
  coverage_added: number;
  product_added: number;
  micro_angle_added: number;
  total_added: number;
}> {
  const policy = await getBlogPublishingPolicy('global');
  const postsPerDay = normalizeDailyPostTarget(opts?.postsPerDay ?? policy.posts_per_day);
  const weeklyTarget = postsPerDay * 7;
  const productTarget = Math.floor(weeklyTarget * policy.product_ratio);
  const infoTarget = weeklyTarget - productTarget;

  // 시즌 캘린더가 비어있으면 채우기
  await generateNextQuarterTopics().catch(e => console.warn('[scheduler] 시즌 생성 실패:', e));

  let seasonalAdded = 0;
  let coverageAdded = 0;
  let productAdded = 0;

  // --- 정보성: 시즌 60% + 갭 40%
  const seasonalTarget = Math.ceil(infoTarget * 0.6);
  const coverageTarget = infoTarget - seasonalTarget;

  // 시즌 토픽 뽑기 — 단일 batch INSERT + 키워드 리서치
  const seasonals = await pickSeasonalTopics(seasonalTarget);
  if (seasonals.length > 0) {
    // 시즌 토픽의 첫 키워드를 primary로 일괄 리서치
    const primaryKeywords = seasonals.map(s => (s.keywords?.[0] || s.topic.split(' ').slice(0, 3).join(' ')));
    const research = await researchKeywordsBatch(primaryKeywords).catch(() => new Map());

    const seasonalRowsRaw = seasonals.map((s, idx) => {
      const pk = primaryKeywords[idx];
      const r = research.get(pk);
      return {
        topic: s.topic,
        source: 'seasonal',
        priority: 60,
        destination: s.destination ?? null,
        category: inferCategoryFromSeasonal(s.topic),
        primary_keyword: pk,
        keyword_tier: r?.tier ?? classifyKeywordTier(pk),
        monthly_search_volume: r?.monthly_search_volume ?? null,
        trend_score: r?.trend_score ?? null,
        competition_level: r?.competition_level ?? null,
        meta: { keywords: s.keywords, season_tag: s.season_tag },
      };
    });
    const { rows: seasonalRows } = filterTopicFitPassed(seasonalRowsRaw);
    const demandBackedSeasonalRows = seasonalRows.filter((row) =>
      hasVerifiedBlogDemandSignal(readEmbeddedBlogQueueDemandSignalV3(row)),
    );
    if (demandBackedSeasonalRows.length > 0) {
    const { data: inserted, error } = await supabaseAdmin
      .from('blog_topic_queue')
      .insert(demandBackedSeasonalRows)
      .select('topic');
    if (!error) {
      const insertedTopics = new Set((inserted ?? []).map((r: { topic: string }) => r.topic));
      const usedSeasonals = seasonals.filter(s => insertedTopics.has(s.topic));
      seasonalAdded = usedSeasonals.length;
      // 캘린더 사용 표시 — 월별 그룹 단위 1쿼리로 묶음
      const byMonth = new Map<string, string[]>();
      for (const s of usedSeasonals) {
        const arr = byMonth.get(s.year_month) ?? [];
        arr.push(s.topic);
        byMonth.set(s.year_month, arr);
      }
      const usedAt = new Date().toISOString();
      await Promise.all(
        Array.from(byMonth.entries()).map(([year_month, topics]) =>
          supabaseAdmin
            .from('blog_seasonal_calendar')
            .update({ used: true, used_at: usedAt })
            .eq('year_month', year_month)
            .in('topic', topics)
        )
      );
    }
    }
  }

  // 커버리지 갭 — 단일 batch INSERT + 키워드 리서치 (mid tier 기본)
  const gaps = await analyzeCoverageGaps({ maxPerDestination: 2 });
  const toAddGaps = gaps.slice(0, coverageTarget);
  if (toAddGaps.length > 0) {
    // 갭은 "{dest} 비자", "{dest} 날씨" 같은 mid 키워드
    const gapKeywords = toAddGaps.map(g => g.topic.replace(/ 완벽 체크리스트| 완벽 가이드| 총정리| 가이드$/g, '').trim());
    const research = await researchKeywordsBatch(gapKeywords).catch(() => new Map());

    const gapRowsRaw = toAddGaps.map((g, idx) => {
      const pk = gapKeywords[idx];
      const r = research.get(pk);
      return {
        topic: g.topic,
        source: 'coverage_gap',
        priority: 40,
        destination: g.destination,
        category: g.category,
        primary_keyword: pk,
        keyword_tier: r?.tier ?? 'mid',
        monthly_search_volume: r?.monthly_search_volume ?? null,
        trend_score: r?.trend_score ?? null,
        competition_level: r?.competition_level ?? 'medium',
        meta: { expected_slug: g.slug_suffix },
      };
    });
    const { rows: gapRows } = filterTopicFitPassed(gapRowsRaw);
    const demandBackedGapRows = gapRows.filter((row) =>
      hasVerifiedBlogDemandSignal(readEmbeddedBlogQueueDemandSignalV3(row)),
    );
    if (demandBackedGapRows.length > 0) {
      const { data: inserted, error } = await supabaseAdmin
        .from('blog_topic_queue')
        .insert(demandBackedGapRows)
        .select('topic');
      if (!error) coverageAdded = (inserted ?? []).length;
    }
  }

  // --- 상품: 최근 7일 내 approved 됐는데 아직 블로그 없는 상품
  // ticketing_deadline 포함 — 발권기한 있는 상품은 별도 우선 처리
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data: freshProducts } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, title, created_at, ticketing_deadline, duration, price_dates, price_tiers, confirmed_dates, land_operator, land_operator_id, internal_code')
    .in('status', [...CUSTOMER_VISIBLE_STATUSES])
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(productTarget * 2);

  type PkgRow = {
    id: string;
    destination: string | null;
    title: string | null;
    created_at: string;
    ticketing_deadline: string | null;
    duration: number | null;
    price_dates?: unknown;
    price_tiers?: unknown;
    confirmed_dates?: unknown;
    land_operator?: string | null;
    land_operator_id?: string | null;
    internal_code?: string | null;
  };
  const productIds = ((freshProducts || []) as PkgRow[]).map((p) => p.id);

  // 1) content_creatives 에 이미 발행/예약/초안 있는 product_id 제외
  let existingProductBlogs = new Set<string>();
  if (productIds.length > 0) {
    const { data: existing } = await supabaseAdmin
      .from('content_creatives')
      .select('product_id')
      .in('product_id', productIds)
      .eq('channel', 'naver_blog')
      .in('status', ['published', 'scheduled', 'draft']);
    existingProductBlogs = new Set(
      ((existing || []) as Array<{ product_id: string | null }>)
        .map((e) => e.product_id)
        .filter((id): id is string => Boolean(id))
    );
  }

  // 2) blog_topic_queue 에 이미 queued/generating 중인 product_id 제외 (중복 방지)
  let alreadyQueuedProductIds = new Set<string>();
  if (productIds.length > 0) {
    const { data: inQueue } = await supabaseAdmin
      .from('blog_topic_queue')
      .select('product_id')
      .in('product_id', productIds)
      .in('status', ['queued', 'generating']);
    alreadyQueuedProductIds = new Set(
      ((inQueue || []) as Array<{ product_id: string | null }>)
        .map((e) => e.product_id)
        .filter((id): id is string => Boolean(id))
    );
  }

  const eligibleProducts = ((freshProducts || []) as PkgRow[])
    .filter((p) => !existingProductBlogs.has(p.id) && !alreadyQueuedProductIds.has(p.id))
    .slice(0, productTarget);

  if (eligibleProducts.length > 0) {
    const today = new Date();
    // 상품 블로그는 longtail — "{출발지+}부산출발 다낭 4박5일 가성비 리뷰"
    const productRowsRaw = eligibleProducts.map(p => {
      const pk = `${p.destination || ''} ${p.title || '패키지'}`.trim();
      const productDedupKey = buildProductDedupKey(p);
      const departureDate = resolveProductDepartureDate(p);
      const supplierCode = resolveProductSupplierCode(p);

      // 발권기한 있는 상품: 발권기한 15일 전을 목표 발행일로, priority 상향
      let rowPriority = 80;
      let targetPublishAt: string | undefined = undefined;
      if (p.ticketing_deadline) {
        const deadline = new Date(p.ticketing_deadline);
        const daysUntilDeadline = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);
        if (daysUntilDeadline >= 1) {
          // 발권기한 15일 전 발행 목표 (SEO 효과 고려 최소 기준)
          const targetDt = new Date(deadline);
          targetDt.setDate(deadline.getDate() - 15);
          // 목표 발행일이 오늘보다 과거이면 최대한 빨리 (내일 첫 슬롯)
          if (targetDt <= today) {
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            tomorrow.setUTCHours(23, 0, 0, 0); // 08:00 KST = 23:00 UTC 전날
            targetPublishAt = tomorrow.toISOString();
          } else {
            targetPublishAt = targetDt.toISOString();
          }
          // 기한 임박도에 따라 priority boost (15일 이내=95, 30일 이내=88, 그 외=82)
          rowPriority = daysUntilDeadline <= 15 ? 95 : daysUntilDeadline <= 30 ? 88 : 82;
        }
      }

      return {
        topic: `${p.destination} ${p.title || '패키지'} 가성비 리뷰`,
        source: 'product',
        priority: rowPriority,
        destination: p.destination,
        angle_type: 'value',
        product_id: p.id,
        category: 'product_intro',
        primary_keyword: pk,
        keyword_tier: 'longtail' as KeywordTier,
        competition_level: 'low',
        ...(targetPublishAt ? { target_publish_at: targetPublishAt } : {}),
        meta: {
          product_title: p.title,
          active_product_relation_verified: true,
          product_dedup_key: productDedupKey,
          departure_date: departureDate,
          duration: p.duration ?? null,
          supplier_code: supplierCode,
          ...(p.ticketing_deadline ? { ticketing_deadline: p.ticketing_deadline } : {}),
        },
      };
    });
    const { rows: productRows } = filterTopicFitPassed(productRowsRaw);
    if (productRows.length > 0) {
      const { data: inserted, error } = await supabaseAdmin
        .from('blog_topic_queue')
        .insert(productRows)
        .select('id');
      if (!error) productAdded = (inserted ?? []).length;
    }
  }

  // assignPublishSlots는 route.ts(cron 엔트리)에서 호출하므로 여기서는 생략

  const microAngleRefill = await ensureDailyPublishableQueue({ postsPerDay }).catch((e) => {
    console.warn('[scheduler] micro-angle refill failed:', e);
    return { added: 0 };
  });

  return {
    seasonal_added: seasonalAdded,
    coverage_added: coverageAdded,
    product_added: productAdded,
    micro_angle_added: microAngleRefill.added,
    total_added: seasonalAdded + coverageAdded + productAdded + microAngleRefill.added,
  };
}

/**
 * 큐의 항목에 target_publish_at 슬롯으로 배정.
 * - 정책의 slot_times 사용
 * - 같은 destination 1일 N개 제한 (per_destination_daily_cap)
 */
export async function assignPublishSlots(postsPerDay?: number): Promise<{ assigned: number }> {
  const policy = await getBlogPublishingPolicy('global');
  const ppd = normalizeDailyPostTarget(postsPerDay ?? policy.posts_per_day);
  const slots = (policy.slot_times.length > 0 ? policy.slot_times : DAILY_PUBLISH_SLOTS).slice(0, MAX_POSTS_PER_DAY);
  const destCap = policy.per_destination_daily_cap;

  const { data: queued } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('id, product_id, priority, destination, primary_keyword, angle_type, topic, category, source, monthly_search_volume, trend_score, meta')
    .eq('status', 'queued')
    .is('target_publish_at', null)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  const demandSignalsByQueueId = await loadQueueDemandSignalMapV3(queued ?? []);
  const publishableQueued = (queued ?? []).filter((row: QueueCandidateLike) => {
    if (
      row.source === 'pillar'
      || hasEvidenceInsufficientFlag(row)
      || hasProductOpenContractBlock(row)
      || destinationlessInfoBlocksPublishability(row)
      || !inspectBlogCandidatePrepublishContract(row).passed
    ) return false;
    if (!hasVerifiedBlogDemandSignal(
      (row.id ? demandSignalsByQueueId.get(row.id) : undefined)
        ?? readEmbeddedBlogQueueDemandSignalV3(row),
    )) return false;
    return readWriterType(row) !== 'info_writer' || evaluateQueuedInformationResearch(row).passed;
  });
  if (publishableQueued.length === 0) return { assigned: 0 };

  // 미래 14일 내 이미 스케줄된 슬롯 + destination별 카운트
  const { data: scheduled } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('target_publish_at, destination')
    .in('status', [...SCHEDULE_OCCUPYING_QUEUE_STATUSES])
    .not('target_publish_at', 'is', null)
    .gte('target_publish_at', new Date().toISOString());

  const takenSlots = new Set<string>();
  const destCountByDay = new Map<string, number>(); // 'YYYY-MM-DD::dest' → count
  ((scheduled || []) as Array<{ target_publish_at: string | null; destination: string | null }>).forEach((s) => {
    if (!s.target_publish_at) return;
    const iso = new Date(s.target_publish_at).toISOString();
    takenSlots.add(iso);
    if (s.destination) {
      const day = iso.split('T')[0];
      const key = `${day}::${s.destination}`;
      destCountByDay.set(key, (destCountByDay.get(key) ?? 0) + 1);
    }
  });

  let assigned = 0;
  const today = new Date();
  const todayKst = kstDateString(today);
  const remaining = [...publishableQueued];

  // 향후 21일까지 (multi-angle drip 12-15일 분산 수용)
  for (let dayOffset = 0; dayOffset < 21 && remaining.length > 0; dayOffset++) {
    const d = new Date(`${todayKst}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    const yyyyMmDd = d.toISOString().split('T')[0]!;

    for (let slotIdx = 0; slotIdx < ppd && remaining.length > 0; slotIdx++) {
      const slotIso = kstToUtcIso(yyyyMmDd, slots[slotIdx % slots.length]);
      if (new Date(slotIso) <= new Date()) continue;
      if (takenSlots.has(slotIso)) continue;

      // 이 슬롯에 들어갈 후보 — destination cap 통과하는 첫 항목 픽
      const idx = remaining.findIndex(item => {
        if (!item.destination) return true;
        const key = `${yyyyMmDd}::${item.destination}`;
        return (destCountByDay.get(key) ?? 0) < destCap;
      });
      if (idx === -1) continue;

      const item = remaining.splice(idx, 1)[0];
      const { error } = await supabaseAdmin
        .from('blog_topic_queue')
        .update({ target_publish_at: slotIso })
        .eq('id', item.id);

      if (!error) {
        takenSlots.add(slotIso);
        if (item.destination) {
          const key = `${yyyyMmDd}::${item.destination}`;
          destCountByDay.set(key, (destCountByDay.get(key) ?? 0) + 1);
        }
        assigned++;
      }
    }
  }

  return { assigned };
}

function inferCategoryFromSeasonal(topic: string): string {
  if (/준비물|체크리스트|챙/i.test(topic)) return 'preparation';
  if (/날씨|옷차림|기온/i.test(topic)) return 'local_info';
  if (/비자|입국/i.test(topic)) return 'visa_info';
  if (/일정|코스/i.test(topic)) return 'itinerary';
  if (/FAQ|질문/i.test(topic)) return 'travel_tips';
  return 'travel_tips';
}
