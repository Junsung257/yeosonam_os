import {
  getTrendStyleContext,
  refreshTrendStyleFingerprints,
  type TrendStyleContext,
} from '@/lib/trend-style-engine';

export interface ThreadsLearningInput {
  destination?: string | null;
  audience?: string | null;
  limit?: number;
}

export async function refreshThreadsTrendLearning() {
  return refreshTrendStyleFingerprints('threads');
}

export async function getThreadsTrendLearningContext(input: ThreadsLearningInput = {}): Promise<TrendStyleContext> {
  return getTrendStyleContext({
    platform: 'threads',
    destination: input.destination,
    audience: input.audience,
    limit: input.limit ?? 6,
  });
}

export function summarizeTrendSourcesForGeneration(context: TrendStyleContext) {
  return context.sources.slice(0, 6).map((source) => ({
    source_type: source.source_type,
    destination: source.destination,
    hook_type: source.hook_type,
    style_key: source.style_key,
    sample_count: source.sample_count,
    avg_score: source.avg_score,
    avg_er: source.avg_er,
    latest_captured_at: source.latest_captured_at,
  }));
}

export type ThreadsLearningMode = 'owned_performance' | 'external_trend' | 'fallback_curated';

export function chooseThreadsLearningMode(context: TrendStyleContext): ThreadsLearningMode {
  if (context.sources.some((source) => source.source_type === 'owned_performance')) return 'owned_performance';
  if (context.sources.some((source) => source.source_type === 'external_trend')) return 'external_trend';
  return 'fallback_curated';
}

export function computeTrendConfidence(context: TrendStyleContext): number {
  const owned = context.sources.filter((source) => source.source_type === 'owned_performance');
  const external = context.sources.filter((source) => source.source_type === 'external_trend');
  if (owned.length > 0) {
    const samples = owned.reduce((sum, source) => sum + source.sample_count, 0);
    return Math.min(1, 0.45 + samples / 20);
  }
  if (external.length > 0) {
    const samples = external.reduce((sum, source) => sum + source.sample_count, 0);
    return Math.min(0.75, 0.25 + samples / 40);
  }
  return 0.15;
}
