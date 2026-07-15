export const INFORMATIONAL_QUEUE_SOURCES = [
  'seasonal',
  'coverage_gap',
  'user_seed',
  'trend',
  'pillar',
  'programmatic_seo',
  'auto_heal',
  'gsc_longtail',
  'manual',
] as const;

export type InformationalQueueSource = (typeof INFORMATIONAL_QUEUE_SOURCES)[number];
export type BlogContentLane = 'informational' | 'product' | 'card_news_bridge';

export interface BlogContentBoundaryInput {
  source?: string | null;
  productId?: string | null;
  cardNewsId?: string | null;
  declaredLane?: string | null;
}

export type BlogContentBoundaryIssue =
  | 'card_news_id_requires_card_news_source'
  | 'card_news_source_requires_card_news_id'
  | 'product_source_requires_product_id'
  | 'product_id_requires_product_source'
  | 'declared_lane_mismatch'
  | 'unsupported_informational_source';

export type BlogContentBoundaryDecision =
  | { passed: true; lane: BlogContentLane; source: string }
  | { passed: false; lane: null; source: string; issue: BlogContentBoundaryIssue };

const INFORMATIONAL_SOURCE_SET = new Set<string>(INFORMATIONAL_QUEUE_SOURCES);

export function routeBlogContentLane(input: BlogContentBoundaryInput): BlogContentBoundaryDecision {
  const source = String(input.source || '').trim().toLowerCase();
  const hasProduct = typeof input.productId === 'string' && input.productId.trim().length > 0;
  const hasCardNews = typeof input.cardNewsId === 'string' && input.cardNewsId.trim().length > 0;
  const declaredLane = typeof input.declaredLane === 'string'
    ? input.declaredLane.trim().toLowerCase()
    : '';
  const pass = (lane: BlogContentLane): BlogContentBoundaryDecision => {
    if (declaredLane && declaredLane !== lane) {
      return { passed: false, lane: null, source, issue: 'declared_lane_mismatch' };
    }
    return { passed: true, lane, source };
  };

  if (hasCardNews) {
    if (source !== 'card_news') {
      return { passed: false, lane: null, source, issue: 'card_news_id_requires_card_news_source' };
    }
    return pass('card_news_bridge');
  }
  if (source === 'card_news') {
    return { passed: false, lane: null, source, issue: 'card_news_source_requires_card_news_id' };
  }
  if (source === 'product') {
    return hasProduct
      ? pass('product')
      : { passed: false, lane: null, source, issue: 'product_source_requires_product_id' };
  }
  if (source === 'auto_heal') {
    return hasProduct ? pass('product') : pass('informational');
  }
  if (hasProduct) {
    return { passed: false, lane: null, source, issue: 'product_id_requires_product_source' };
  }
  if (!INFORMATIONAL_SOURCE_SET.has(source)) {
    return { passed: false, lane: null, source, issue: 'unsupported_informational_source' };
  }
  return pass('informational');
}
