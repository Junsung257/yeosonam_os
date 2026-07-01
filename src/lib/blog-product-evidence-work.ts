export interface BlogProductEvidenceQueueRow {
  id?: string | null;
  status?: string | null;
  product_id?: string | null;
  destination?: string | null;
  topic?: string | null;
  attempts?: number | null;
  last_error?: string | null;
  updated_at?: string | null;
  target_publish_at?: string | null;
  meta?: unknown;
}

export interface BlogProductEvidenceProduct {
  id?: string | null;
  title?: string | null;
  status?: string | null;
  destination?: string | null;
  updated_at?: string | null;
}

export interface BlogProductEvidenceWorkItem {
  queue_id: string | null;
  product_id: string | null;
  product_title: string | null;
  product_status: string | null;
  destination: string | null;
  topic: string | null;
  queue_status: string | null;
  attempts: number;
  blocker_categories: string[];
  blockers: string[];
  next_action: string;
  updated_at: string | null;
}

export interface BlogProductEvidenceWorkReport {
  total: number;
  category_counts: Record<string, number>;
  next_actions: string[];
  samples: BlogProductEvidenceWorkItem[];
}

function readMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {};
}

function asCleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function extractProductOpenContractBlockers(row: BlogProductEvidenceQueueRow): string[] {
  const meta = readMeta(row.meta);
  const rawMetaBlockers = Array.isArray(meta.product_open_contract_blockers)
    ? meta.product_open_contract_blockers
    : Array.isArray(meta.blockers)
      ? meta.blockers
      : [];
  const metaBlockers = rawMetaBlockers
    .map(value => asCleanString(value))
    .filter((value): value is string => Boolean(value));

  const error = row.last_error ?? '';
  const marker = 'product_customer_open_contract_failed:';
  const markerIndex = error.indexOf(marker);
  const errorBlockers = markerIndex >= 0
    ? error.slice(markerIndex + marker.length).split('|')
    : [];

  return unique([...metaBlockers, ...errorBlockers]);
}

export function categorizeProductEvidenceBlocker(blocker: string): string {
  const lower = blocker.toLowerCase();
  if (lower.includes('mobile_proof')) return 'mobile_proof';
  if (lower.includes('quality_scorecard')) return 'quality_scorecard';
  if (lower.includes('registration_evidence_pack') || lower.includes('blog_publish')) return 'evidence_pack';
  if (lower.startsWith('v3') || lower.includes('v3_payload')) return 'v3_customer_payload';
  if (lower.includes('package_lookup')) return 'package_lookup';
  if (lower.includes('price') || lower.includes('product_prices')) return 'price_evidence';
  return 'other';
}

function actionForCategories(categories: string[]): string {
  if (categories.includes('package_lookup')) return '상품 ID 연결 또는 상품 상태를 먼저 복구';
  if (categories.includes('mobile_proof')) return '모바일 공개 화면 증빙을 새로 생성하고 customer_open_contract 재평가';
  if (categories.includes('v3_customer_payload')) return 'V3 고객 안내문/원문 누수 차단 사유를 수정';
  if (categories.includes('quality_scorecard')) return '상품 품질 점수표의 차단 항목을 수정';
  if (categories.includes('price_evidence')) return '출발일/가격 근거를 보강';
  if (categories.includes('evidence_pack')) return 'registration_evidence_pack의 blog_publish eligibility를 복구';
  return '상품 공개 근거를 재검수한 뒤 재큐잉';
}

export function buildBlogProductEvidenceWorkReport(input: {
  rows: BlogProductEvidenceQueueRow[];
  productsById?: Map<string, BlogProductEvidenceProduct>;
  limit?: number;
}): BlogProductEvidenceWorkReport {
  const categoryCounts: Record<string, number> = {};
  const items: BlogProductEvidenceWorkItem[] = [];

  for (const row of input.rows) {
    const blockers = extractProductOpenContractBlockers(row);
    const meta = readMeta(row.meta);
    const isProductOpenContract =
      meta.failure_code === 'product_open_contract' ||
      meta.quarantine_reason === 'product_open_contract' ||
      /product_customer_open_contract_failed|customer_open_contract|mobile_proof|registration_evidence_pack|blog_publish/i.test(row.last_error ?? '');
    if (!isProductOpenContract) continue;

    const categories = unique(
      (blockers.length > 0 ? blockers : ['product_open_contract'])
        .map(categorizeProductEvidenceBlocker),
    );
    for (const category of categories) {
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }

    const productId = row.product_id ?? null;
    const product = productId ? input.productsById?.get(productId) : undefined;
    items.push({
      queue_id: row.id ?? null,
      product_id: productId,
      product_title: product?.title ?? null,
      product_status: product?.status ?? null,
      destination: row.destination ?? product?.destination ?? null,
      topic: row.topic ?? null,
      queue_status: row.status ?? null,
      attempts: Number(row.attempts ?? 0),
      blocker_categories: categories,
      blockers,
      next_action: actionForCategories(categories),
      updated_at: row.updated_at ?? null,
    });
  }

  items.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  const samples = items.slice(0, Math.max(0, input.limit ?? 10));

  return {
    total: items.length,
    category_counts: categoryCounts,
    next_actions: unique(items.map(item => item.next_action)),
    samples,
  };
}
