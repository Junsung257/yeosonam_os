export type BlogDestinationlessInfoRow = {
  id?: string | null;
  slug?: string | null;
  topic?: string | null;
  title?: string | null;
  seo_title?: string | null;
  destination?: string | null;
  primary_keyword?: string | null;
  category?: string | null;
  source?: string | null;
  status?: string | null;
  product_id?: string | null;
  meta?: Record<string, unknown> | null;
  generation_meta?: Record<string, unknown> | null;
};

export type BlogDestinationlessInfoCategory =
  | 'intentionally_generic'
  | 'generic_unmarked'
  | 'missing_destination'
  | 'invalid_destination';

export type BlogDestinationlessInfoWorkItem = {
  queue_id: string | null;
  content_id: string | null;
  slug: string | null;
  topic: string | null;
  destination: string | null;
  primary_keyword: string | null;
  category: string | null;
  source: string | null;
  issue: BlogDestinationlessInfoCategory;
  next_action: 'mark_intentionally_generic' | 'add_destination_or_skip' | 'archive_or_rewrite';
};

export type BlogDestinationlessInfoWorkReport = {
  total: number;
  issue_counts: Record<string, number>;
  next_actions: string[];
  samples: BlogDestinationlessInfoWorkItem[];
};

export const BLOG_GENERIC_INFORMATION_RESEARCH_SCOPE = '해외여행 공통';

const GENERIC_INFO_CATEGORY_RE = /^(?:travel_tips|visa_info|preparation|local_info)$/i;
const GENERIC_INFO_TOPIC_RE =
  /(?:roaming|insurance|coverage|로밍|유심|eSIM|USIM|보험|비자|입국|항공권|비행시간|공항\s*혼잡|비상약|상비약|환전|트래블월렛|travelwallet|비용\s*절약|경비\s*절약|배낭여행|여행\s*준비|여행지\s*추천|휴양지\s*추천|가족\s*(?:여행지|해외여행)|아이와\s*가기|해외여행\s*(?:전화|데이터|보험|준비|체크|비자|항공권|비행시간|환전|상비약|비상약)|광복절\s*연휴|황금연휴|여름\s*(?:휴가철|방학|항공권|공항))/i;
const MULTI_DESTINATION_COMPARISON_RE =
  /(?:\bvs\b|비교).*(?:도쿄|홍콩|오사카|방콕|싱가포르|오키나와|몽골|발리|괌|사이판|유럽|동남아)|(?:도쿄|홍콩|오사카|방콕|싱가포르|오키나와|몽골|발리|괌|사이판|유럽|동남아).*(?:\bvs\b|비교)/i;
const INVALID_INFO_DESTINATIONS = new Set([
  '가족',
  '대학생',
  '아이',
  '여행',
  '여행 준비',
  '해외여행',
  '여름',
  '여름방학',
  '황금연휴',
  '봄',
  '가을',
  '겨울',
  '1월',
  '2월',
  '3월',
  '4월',
  '5월',
  '6월',
  '7월',
  '8월',
  '9월',
  '10월',
  '11월',
  '12월',
]);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function readWriterType(row: BlogDestinationlessInfoRow): string {
  const raw = clean(row.meta?.writer_type ?? row.meta?.writer ?? row.generation_meta?.writer);
  if (raw) return raw;
  return row.product_id ? 'product_consultant_writer' : 'info_writer';
}

function readContentBrief(row: BlogDestinationlessInfoRow): Record<string, unknown> {
  const contentBrief = row.generation_meta?.content_brief;
  return contentBrief && typeof contentBrief === 'object' && !Array.isArray(contentBrief)
    ? contentBrief as Record<string, unknown>
    : {};
}

function readKeywords(row: BlogDestinationlessInfoRow): string {
  const keywords = row.generation_meta?.keywords;
  return Array.isArray(keywords) ? keywords.map(clean).filter(Boolean).join(' ') : '';
}

export function isInfoDestinationContractCandidate(row: BlogDestinationlessInfoRow): boolean {
  return !row.product_id && readWriterType(row) === 'info_writer';
}

export function isDestinationlessInfoCandidate(row: BlogDestinationlessInfoRow): boolean {
  return isInfoDestinationContractCandidate(row) && !clean(row.destination);
}

export function hasInvalidInfoDestination(row: BlogDestinationlessInfoRow): boolean {
  const destination = clean(row.destination);
  return Boolean(destination && INVALID_INFO_DESTINATIONS.has(destination));
}

export function hasIntentionallyGenericInfoFlag(row: BlogDestinationlessInfoRow): boolean {
  return row.meta?.intentionally_generic === true ||
    row.generation_meta?.intentionally_generic === true;
}

export function looksLikeGenericInfoTopic(row: BlogDestinationlessInfoRow): boolean {
  const contentBrief = readContentBrief(row);
  const text = [
    row.slug,
    row.topic,
    row.title,
    row.seo_title,
    row.primary_keyword,
    contentBrief.title,
    contentBrief.primary_keyword,
    row.category,
    row.source,
    readKeywords(row),
  ].map(clean).join(' ');
  if (MULTI_DESTINATION_COMPARISON_RE.test(text)) return true;
  if (GENERIC_INFO_TOPIC_RE.test(text)) return true;
  return GENERIC_INFO_CATEGORY_RE.test(clean(row.category)) && GENERIC_INFO_TOPIC_RE.test(text);
}

export function classifyDestinationlessInfoCandidate(
  row: BlogDestinationlessInfoRow,
): BlogDestinationlessInfoCategory | null {
  if (!isInfoDestinationContractCandidate(row)) return null;
  if (hasInvalidInfoDestination(row)) return 'invalid_destination';
  if (clean(row.destination)) return null;
  if (hasIntentionallyGenericInfoFlag(row)) return 'intentionally_generic';
  if (looksLikeGenericInfoTopic(row)) return 'generic_unmarked';
  return 'missing_destination';
}

export function destinationlessInfoBlocksPublishability(row: BlogDestinationlessInfoRow): boolean {
  const category = classifyDestinationlessInfoCandidate(row);
  return category === 'generic_unmarked' ||
    category === 'missing_destination' ||
    category === 'invalid_destination';
}

export function resolveBlogInformationResearchDestination(
  row: BlogDestinationlessInfoRow,
): string | null {
  const destination = clean(row.destination);
  if (destination) return destination;
  return classifyDestinationlessInfoCandidate(row) === 'intentionally_generic'
    ? BLOG_GENERIC_INFORMATION_RESEARCH_SCOPE
    : null;
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

export function buildDestinationlessInfoGenericGenerationMeta(input: {
  row: BlogDestinationlessInfoRow;
  checkedAt?: string;
}): Record<string, unknown> {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  return {
    ...(input.row.generation_meta ?? {}),
    intentionally_generic: true,
    generic_info_candidate: true,
    generic_info_marked_at: checkedAt,
    generic_info_marked_by: 'blog-published-info-destination-recheck',
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
      queue_id: row.source === 'content_creatives' ? null : row.id ?? null,
      content_id: row.source === 'content_creatives' ? row.id ?? null : null,
      slug: row.slug ?? null,
      topic: row.topic ?? row.seo_title ?? row.title ?? null,
      destination: row.destination ?? null,
      primary_keyword: row.primary_keyword ?? null,
      category: row.category ?? null,
      source: row.source ?? null,
      issue,
      next_action: issue === 'generic_unmarked'
        ? 'mark_intentionally_generic'
        : issue === 'invalid_destination'
          ? 'archive_or_rewrite'
          : 'add_destination_or_skip',
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
