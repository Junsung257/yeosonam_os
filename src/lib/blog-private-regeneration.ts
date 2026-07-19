export const PRIVATE_BLOG_REGENERATION_MODE = 'replace_existing_fallback_draft' as const;

export interface PrivateBlogRegenerationRequest {
  mode: typeof PRIVATE_BLOG_REGENERATION_MODE;
  contentCreativeId: string;
}

export function hasPrivateBlogRegenerationIntent(item: QueueInput): boolean {
  const metadata = record(item.meta);
  return metadata !== null && Object.hasOwn(metadata, 'private_regeneration');
}

interface QueueInput {
  content_creative_id?: unknown;
  meta?: unknown;
}

interface CreativeInput {
  id?: unknown;
  channel?: unknown;
  status?: unknown;
  generation_meta?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readPrivateBlogRegenerationRequest(
  item: QueueInput,
): PrivateBlogRegenerationRequest | null {
  const metadata = record(item.meta);
  const privateRegeneration = record(metadata?.private_regeneration);
  const contentCreativeId = typeof item.content_creative_id === 'string'
    ? item.content_creative_id.trim()
    : '';
  if (
    privateRegeneration?.mode !== PRIVATE_BLOG_REGENERATION_MODE
    || privateRegeneration.force_private_review !== true
    || !contentCreativeId
  ) {
    return null;
  }
  return {
    mode: PRIVATE_BLOG_REGENERATION_MODE,
    contentCreativeId,
  };
}

export function isEligiblePrivateBlogRegenerationTarget(
  creative: CreativeInput | null | undefined,
  request: PrivateBlogRegenerationRequest,
): boolean {
  if (!creative || creative.id !== request.contentCreativeId) return false;
  if (creative.channel !== 'naver_blog' || creative.status !== 'draft') return false;
  const generationMeta = record(creative.generation_meta);
  return generationMeta?.deterministic_info_fallback === true
    || generationMeta?.deterministic_fast_fallback === true;
}
