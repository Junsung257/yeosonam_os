import { evaluateBlogTopicFit } from './blog-topic-fit-gate';
import { classifyDestinationlessInfoCandidate } from './blog-destinationless-info';
import { inspectBlogCandidatePrepublishContract } from './blog-candidate-prepublish-contract';
import { evaluateQueuedInformationResearch } from './blog-queue-research';
import {
  readProgrammaticExpectedSlug,
  readProgrammaticMicroAngle,
} from './blog-programmatic-contract';

export type BlogCanaryCandidateRow = {
  id?: string | null;
  topic?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  angle_type?: string | null;
  category?: string | null;
  content_type?: string | null;
  product_id?: string | null;
  source?: string | null;
  priority?: number | null;
  target_publish_at?: string | null;
  slug?: string | null;
  slug_hint?: string | null;
  generation_meta?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
};

export type BlogCanaryCandidate = {
  id: string;
  topic: string;
  destination: string | null;
  writer_type: 'info_writer' | 'product_consultant_writer';
  quality_contract: 'customer_surface_100';
  contract_expectations: string[];
  risk_level: 'low' | 'medium';
  reason: string;
  dedup_key: string;
};

export type BlogCanaryPreflightResult = {
  status: 'pass' | 'warn' | 'block';
  requested: number;
  ready_count: number;
  writer_mix: Record<string, number>;
  candidates: BlogCanaryCandidate[];
  rejected_counts: Record<string, number>;
  next_action: string;
};

function addRejected(counts: Record<string, number>, reason: string): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function readNestedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readWriterType(row: BlogCanaryCandidateRow): BlogCanaryCandidate['writer_type'] {
  const raw = readNestedString(row.meta?.writer_type, row.meta?.writer, row.generation_meta?.writer);
  if (raw === 'product_consultant_writer' || row.product_id) return 'product_consultant_writer';
  return 'info_writer';
}

function readExpectedSlug(row: BlogCanaryCandidateRow): string | null {
  const explicit = readNestedString(
    row.meta?.expected_slug,
    row.meta?.spun_slug,
    row.slug_hint,
    row.slug,
  );
  return explicit?.toLowerCase()
    ?? readProgrammaticExpectedSlug({ meta: row.meta, topic: row.topic });
}

function readMicroAngle(row: BlogCanaryCandidateRow): string | null {
  const explicit = readNestedString(row.meta?.micro_angle, row.generation_meta?.micro_angle);
  return explicit?.toLowerCase()
    ?? readProgrammaticMicroAngle({ meta: row.meta, angleType: row.angle_type })
    ?? readNestedString(row.angle_type)?.toLowerCase()
    ?? null;
}

function readProductDedupKey(row: BlogCanaryCandidateRow): string | null {
  return readNestedString(row.meta?.product_dedup_key, row.generation_meta?.product_dedup_key, row.meta?.dedup_key, row.product_id)?.toLowerCase() ?? null;
}

function canaryDedupKey(row: BlogCanaryCandidateRow): string | null {
  const writer = readWriterType(row);
  const productKey = readProductDedupKey(row);
  if (productKey) return `${writer}::product::${productKey}`;
  const destination = normalize(row.destination);
  const micro = readMicroAngle(row);
  if (destination && micro) return `${writer}::${destination}::${micro}`;
  const slug = readExpectedSlug(row);
  if (slug) return `${writer}::slug::${slug}`;
  const topic = normalize(row.topic);
  return topic ? `${writer}::topic::${topic}` : null;
}

function hasEvidenceBlock(row: BlogCanaryCandidateRow): boolean {
  return row.meta?.evidence_insufficient === true ||
    row.meta?.failure_code === 'evidence_insufficient' ||
    row.generation_meta?.failure_bucket === 'evidence_insufficient' ||
    row.meta?.failure_code === 'product_open_contract' ||
    row.meta?.quarantine_reason === 'product_open_contract' ||
    row.generation_meta?.failure_bucket === 'product_open_contract';
}

function candidateSortValue(row: BlogCanaryCandidateRow): number {
  const priority = typeof row.priority === 'number' && Number.isFinite(row.priority) ? row.priority : 50;
  const duePenalty = row.target_publish_at && new Date(row.target_publish_at).getTime() > Date.now() ? -5 : 0;
  const productBonus = row.product_id ? 1 : 0;
  return priority + duePenalty + productBonus;
}

function contractExpectationsForWriter(
  writerType: BlogCanaryCandidate['writer_type'],
): string[] {
  if (writerType === 'product_consultant_writer') {
    return [
      'product_db_only',
      'price_departure_duration_opening',
      'included_excluded_blocks',
      'fit_and_not_fit_blocks',
      'risk_notes_and_consult_questions',
      'no_hard_booking_pressure',
      'render_clean_tables',
    ];
  }

  return [
    'answer_first_120_200_chars',
    'korean_search_intent_not_raw_micro_angle',
    'official_source_if_changeable',
    'valid_table_or_checklist',
    'runtime_contextual_cta_only',
    'no_ai_cliche_opening',
    'render_clean_tables',
  ];
}

export function buildBlogCanaryPreflight(input: {
  activeQueue: BlogCanaryCandidateRow[];
  recentPublished: BlogCanaryCandidateRow[];
  requested?: number;
  evaluateInformationResearch?: (
    row: BlogCanaryCandidateRow,
  ) => { passed: boolean; issues?: string[] };
}): BlogCanaryPreflightResult {
  const requested = Math.max(1, Math.min(5, Math.round(input.requested ?? 3)));
  const evaluateInformationResearch = input.evaluateInformationResearch
    ?? evaluateQueuedInformationResearch;
  const rejectedCounts: Record<string, number> = {};
  const recentKeys = new Set(
    input.recentPublished
      .map(canaryDedupKey)
      .filter((key): key is string => Boolean(key)),
  );
  const selectedKeys = new Set<string>();
  const eligibleKeys = new Set<string>();
  const eligibleCandidates: BlogCanaryCandidate[] = [];

  const sortedRows = [...input.activeQueue]
    .filter((row) => row.id)
    .sort((a, b) => candidateSortValue(b) - candidateSortValue(a));

  for (const row of sortedRows) {
    const id = row.id?.trim();
    const topic = row.topic?.trim();
    if (!id || !topic) {
      addRejected(rejectedCounts, 'missing_topic_or_id');
      continue;
    }
    if (row.source === 'pillar') {
      addRejected(rejectedCounts, 'pillar_deferred');
      continue;
    }
    if (hasEvidenceBlock(row)) {
      addRejected(rejectedCounts, 'evidence_or_product_blocked');
      continue;
    }
    const writerType = readWriterType(row);
    let destinationlessIssue: ReturnType<typeof classifyDestinationlessInfoCandidate> = null;
    if (writerType === 'info_writer') {
      destinationlessIssue = classifyDestinationlessInfoCandidate(row);
      if (destinationlessIssue === 'generic_unmarked') {
        addRejected(rejectedCounts, 'info_generic_unmarked');
        continue;
      }
      if (destinationlessIssue === 'invalid_destination') {
        addRejected(rejectedCounts, 'info_invalid_destination');
        continue;
      }
      if (destinationlessIssue && destinationlessIssue !== 'intentionally_generic') {
        addRejected(rejectedCounts, 'info_missing_destination');
        continue;
      }
    }
    if (
      writerType === 'info_writer'
      && destinationlessIssue !== 'intentionally_generic'
      && !evaluateInformationResearch(row).passed
    ) {
      addRejected(rejectedCounts, 'research_not_ready');
      continue;
    }
    const key = canaryDedupKey(row);
    if (!key) {
      addRejected(rejectedCounts, 'missing_dedup_key');
      continue;
    }
    if (recentKeys.has(key) || eligibleKeys.has(key)) {
      addRejected(rejectedCounts, 'duplicate_candidate');
      continue;
    }
    eligibleKeys.add(key);

    const topicFit = evaluateBlogTopicFit({
      topic,
      destination: row.destination,
      primaryKeyword: readNestedString(row.primary_keyword, row.meta?.primary_keyword),
      category: row.category,
      angleType: row.angle_type,
      contentType: row.content_type,
      source: row.source,
      productId: row.product_id,
    });
    if (!topicFit.passed) {
      addRejected(rejectedCounts, 'topic_fit_failed');
      continue;
    }

    const candidateContract = inspectBlogCandidatePrepublishContract(row);
    if (!candidateContract.passed) {
      for (const issue of candidateContract.issues) {
        addRejected(rejectedCounts, `candidate_contract_${issue.code}`);
      }
      continue;
    }

    eligibleCandidates.push({
      id,
      topic,
      destination: row.destination ?? null,
      writer_type: writerType,
      quality_contract: 'customer_surface_100',
      contract_expectations: contractExpectationsForWriter(writerType),
      risk_level: writerType === 'product_consultant_writer' ? 'medium' : 'low',
      reason: writerType === 'product_consultant_writer'
        ? 'product-backed canary candidate with no evidence blocker'
        : 'info canary candidate with topic-fit and unique angle',
      dedup_key: key,
    });
  }

  const selectedCandidates: BlogCanaryCandidate[] = [];
  const takeCandidate = (candidate: BlogCanaryCandidate | undefined) => {
    if (!candidate || selectedCandidates.length >= requested || selectedKeys.has(candidate.dedup_key)) return;
    selectedKeys.add(candidate.dedup_key);
    selectedCandidates.push(candidate);
  };
  const infoCandidates = eligibleCandidates.filter((candidate) => candidate.writer_type === 'info_writer');
  const productCandidates = eligibleCandidates.filter((candidate) => candidate.writer_type === 'product_consultant_writer');
  if (requested >= 2) {
    takeCandidate(infoCandidates[0]);
    takeCandidate(productCandidates[0]);
  }
  for (const candidate of eligibleCandidates) {
    takeCandidate(candidate);
  }

  const candidates = selectedCandidates;
  const readyCount = candidates.length;
  const writerMix = candidates.reduce<Record<string, number>>((acc, candidate) => {
    acc[candidate.writer_type] = (acc[candidate.writer_type] ?? 0) + 1;
    return acc;
  }, {});
  const hasOnlyOneWriterType = readyCount >= requested && Object.keys(writerMix).length === 1;
  if (hasOnlyOneWriterType) {
    addRejected(rejectedCounts, 'single_writer_type_canary');
  }
  const status = readyCount >= requested
    ? hasOnlyOneWriterType ? 'warn' : 'pass'
    : readyCount > 0 ? 'warn' : 'block';
  return {
    status,
    requested,
    ready_count: readyCount,
    writer_mix: writerMix,
    candidates,
    rejected_counts: rejectedCounts,
    next_action: status === 'pass'
      ? 'Use these mixed writer candidates as the next dry-run canary set before expanding automatic publishing.'
      : status === 'warn' && hasOnlyOneWriterType
        ? 'Canary candidates are available, but only one writer type is represented; refill the missing info/product writer if possible.'
        : status === 'warn'
        ? 'Refill or repair the queue until three low-risk canary candidates are available.'
        : 'Do not run canary publishing until the ready candidate pool is repaired.',
  };
}
