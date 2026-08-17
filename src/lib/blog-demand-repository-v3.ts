import type { BlogDemandSignalInput } from './blog-autopublish-policy-v3';

export interface PersistedBlogDemandSignalV3 {
  provider: string;
  signal_value: number | null;
  source_reference: string | null;
  verified_at: string | null;
  expires_at: string | null;
}

export interface MergedBlogDemandEvidenceV3 {
  signal: BlogDemandSignalInput;
  acceptedProviders: string[];
  rejectedCount: number;
}

export interface BlogQueueDemandRowV3 {
  product_id?: string | null;
  monthly_search_volume?: number | null;
  trend_score?: number | null;
  meta?: Record<string, unknown> | null;
}

const HUMAN_ASSERTED_PROVIDERS = new Set(['operator_note', 'editor_seed']);

function positive(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function readEmbeddedBlogQueueDemandSignalV3(
  row: BlogQueueDemandRowV3,
): BlogDemandSignalInput {
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
    ? row.meta as Record<string, unknown>
    : {};
  return {
    gsc: Number(meta.gsc_impressions || meta.gsc_clicks || 0) > 0 || meta.gsc_signal === true,
    naver: Number(meta.naver_impressions || meta.naver_clicks || 0) > 0 || meta.naver_signal === true,
    customerQuestionCount: positive(meta.customer_question_count),
    activeProductRelation: meta.active_product_relation_verified === true,
    verifiedOperatorNote: typeof meta.verified_operator_note_id === 'string'
      && meta.verified_operator_note_id.trim().length > 0,
    editorApprovedSeed: meta.editor_approved_seed === true,
    monthlySearchVolume: positive(row.monthly_search_volume) || null,
    trendScore: positive(row.trend_score) || null,
  };
}

export function mergePersistedBlogDemandSignalsV3(
  base: BlogDemandSignalInput,
  rows: PersistedBlogDemandSignalV3[],
  now = new Date(),
): MergedBlogDemandEvidenceV3 {
  const signal: BlogDemandSignalInput = { ...base };
  const acceptedProviders = new Set<string>();
  let rejectedCount = 0;

  for (const row of rows) {
    const sourceReference = String(row.source_reference || '').trim();
    const expired = row.expires_at != null && Date.parse(row.expires_at) <= now.getTime();
    const humanAssertionUnverified = HUMAN_ASSERTED_PROVIDERS.has(row.provider) && !row.verified_at;
    if (!sourceReference || expired || humanAssertionUnverified) {
      rejectedCount += 1;
      continue;
    }

    const value = positive(row.signal_value);
    switch (row.provider) {
      case 'google_search_console':
        signal.gsc = signal.gsc === true || value > 0;
        break;
      case 'naver_search_advisor':
        signal.naver = signal.naver === true || value > 0;
        break;
      case 'customer_question':
      case 'consultation_aggregate':
        signal.customerQuestionCount = positive(signal.customerQuestionCount) + value;
        break;
      case 'active_product_question':
        signal.activeProductRelation = true;
        break;
      case 'operator_note':
        signal.verifiedOperatorNote = true;
        break;
      case 'editor_seed':
        signal.editorApprovedSeed = true;
        break;
      case 'search_volume':
        signal.monthlySearchVolume = Math.max(positive(signal.monthlySearchVolume), value) || null;
        break;
      case 'search_trend':
        signal.trendScore = Math.max(positive(signal.trendScore), value) || null;
        break;
      default:
        rejectedCount += 1;
        continue;
    }
    if (value > 0 || ['active_product_question', 'operator_note', 'editor_seed'].includes(row.provider)) {
      acceptedProviders.add(row.provider);
    }
  }

  return {
    signal,
    acceptedProviders: [...acceptedProviders].sort(),
    rejectedCount,
  };
}
