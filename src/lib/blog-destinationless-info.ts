export type BlogDestinationlessInfoRow = {
  id?: string | null;
  topic?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  category?: string | null;
  source?: string | null;
  product_id?: string | null;
  meta?: Record<string, unknown> | null;
  generation_meta?: Record<string, unknown> | null;
};

export type BlogDestinationlessInfoCategory =
  | 'intentionally_generic'
  | 'generic_unmarked'
  | 'missing_destination';

export type BlogDestinationlessInfoWorkItem = {
  queue_id: string | null;
  topic: string | null;
  primary_keyword: string | null;
  category: string | null;
  source: string | null;
  issue: BlogDestinationlessInfoCategory;
  next_action: 'mark_intentionally_generic' | 'add_destination_or_skip';
};

export type BlogDestinationlessInfoWorkReport = {
  total: number;
  issue_counts: Record<string, number>;
  next_actions: string[];
  samples: BlogDestinationlessInfoWorkItem[];
};

const GENERIC_INFO_CATEGORY_RE = /^(?:travel_tips|visa_info|preparation|local_info)$/i;
const GENERIC_INFO_TOPIC_RE =
  /(?:로밍|유심|eSIM|USIM|보험|비자|입국|여행지\s*추천|휴양지\s*추천|가족\s*여행지|아이와\s*가기|해외여행\s*(?:전화|데이터|보험|준비|체크|비자)|광복절\s*연휴|여름\s*휴가철)/i;
const MULTI_DESTINATION_COMPARISON_RE =
  /(?:\bvs\b|비교).*(?:홍콩|도쿄|오사카|방콕|싱가포르|다낭|세부|발리|괌|사이판|유럽|동남아)|(?:홍콩|도쿄|오사카|방콕|싱가포르|다낭|세부|발리|괌|사이판|유럽|동남아).*(?:\bvs\b|비교)/i;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function readWriterType(row: BlogDestinationlessInfoRow): string {
  const raw = clean(row.meta?.writer_type ?? row.meta?.writer ?? row.generation_meta?.writer);
  if (raw) return raw;
  return row.product_id ? 'product_consultant_writer' : 'info_writer';
}

export function isDestinationlessInfoCandidate(row: BlogDestinationlessInfoRow): boolean {
  return !row.product_id &&
    readWriterType(row) === 'info_writer' &&
    !clean(row.destination);
}

export function hasIntentionallyGenericInfoFlag(row: BlogDestinationlessInfoRow): boolean {
  return row.meta?.intentionally_generic === true ||
    row.generation_meta?.intentionally_generic === true;
}

export function looksLikeGenericInfoTopic(row: BlogDestinationlessInfoRow): boolean {
  const text = [row.topic, row.primary_keyword, row.category, row.source].map(clean).join(' ');
  if (MULTI_DESTINATION_COMPARISON_RE.test(text)) return true;
  if (GENERIC_INFO_TOPIC_RE.test(text)) return true;
  return GENERIC_INFO_CATEGORY_RE.test(clean(row.category)) && GENERIC_INFO_TOPIC_RE.test(text);
}

export function classifyDestinationlessInfoCandidate(
  row: BlogDestinationlessInfoRow,
): BlogDestinationlessInfoCategory | null {
  if (!isDestinationlessInfoCandidate(row)) return null;
  if (hasIntentionallyGenericInfoFlag(row)) return 'intentionally_generic';
  if (looksLikeGenericInfoTopic(row)) return 'generic_unmarked';
  return 'missing_destination';
}

export function destinationlessInfoBlocksPublishability(row: BlogDestinationlessInfoRow): boolean {
  const category = classifyDestinationlessInfoCandidate(row);
  return category === 'generic_unmarked' || category === 'missing_destination';
}

export function buildDestinationlessInfoGenericMeta(input: {
  row: BlogDestinationlessInfoRow;
  checkedAt?: string;
}): Record<string, unknown> {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  return {
    ...(input.row.meta ?? {}),
    intentionally_generic: true,
    generic_info_candidate: true,
    generic_info_marked_at: checkedAt,
    generic_info_marked_by: 'blog-destinationless-info-recheck',
  };
}

export function buildBlogDestinationlessInfoWorkReport(input: {
  rows: BlogDestinationlessInfoRow[];
  limit?: number;
}): BlogDestinationlessInfoWorkReport {
  const issueCounts: Record<string, number> = {};
  const items: BlogDestinationlessInfoWorkItem[] = [];

  for (const row of input.rows) {
    const issue = classifyDestinationlessInfoCandidate(row);
    if (!issue || issue === 'intentionally_generic') continue;
    issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    items.push({
      queue_id: row.id ?? null,
      topic: row.topic ?? null,
      primary_keyword: row.primary_keyword ?? null,
      category: row.category ?? null,
      source: row.source ?? null,
      issue,
      next_action: issue === 'generic_unmarked' ? 'mark_intentionally_generic' : 'add_destination_or_skip',
    });
  }

  const samples = items.slice(0, Math.max(0, input.limit ?? 10));
  return {
    total: items.length,
    issue_counts: issueCounts,
    next_actions: [...new Set(items.map((item) => item.next_action))],
    samples,
  };
}
