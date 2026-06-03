import { extractThreadsFeatures, runCriticGate } from '@/lib/content-pipeline/critic';
import { extractTrendFeatures } from '@/lib/trend-feature-extractor';
import { validateThreadsBody } from '@/lib/threads-publisher';

export interface ThreadsDistributionPayload {
  main?: string;
  text?: string;
  thread?: string[];
  hashtags?: string[];
  image_urls?: string[];
  media_urls?: string[];
}

export interface ThreadsGateResult {
  approved: boolean;
  predicted_er: number;
  text: string;
  fullText: string;
  reason?: string;
}

export function getThreadsMainText(payload: Record<string, unknown>): string {
  return String(payload.main ?? payload.text ?? '').trim();
}

export function getThreadsFullText(payload: Record<string, unknown>): string {
  const main = getThreadsMainText(payload);
  const thread = Array.isArray(payload.thread)
    ? payload.thread.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  const hashtags = Array.isArray(payload.hashtags)
    ? payload.hashtags.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  return [main, ...thread, hashtags.join(' ')].filter(Boolean).join('\n\n');
}

export function postingHourKst(date: Date = new Date()): number {
  return (date.getUTCHours() + 9) % 24;
}

export async function evaluateThreadsDistribution(args: {
  distributionId?: string | null;
  payload: Record<string, unknown>;
  scheduledFor?: string | null;
  dryRun?: boolean;
}): Promise<ThreadsGateResult> {
  const text = getThreadsMainText(args.payload);
  const fullText = getThreadsFullText(args.payload);
  const bodyError = validateThreadsBody(text);
  if (bodyError) {
    return { approved: false, predicted_er: 0, text, fullText, reason: bodyError };
  }

  const trend = extractTrendFeatures(text);
  const scheduledDate = args.scheduledFor ? new Date(args.scheduledFor) : new Date();
  const decision = await runCriticGate({
    cardNewsId: null,
    platform: 'threads',
    fullText,
    features: extractThreadsFeatures({
      text: fullText,
      hook_type: trend.hook_type_guess,
      posting_hour_kst: Number.isNaN(scheduledDate.getTime()) ? postingHourKst() : postingHourKst(scheduledDate),
    }),
  });

  return {
    approved: decision.approved,
    predicted_er: decision.predicted_er,
    text,
    fullText,
    reason: decision.reason,
  };
}
