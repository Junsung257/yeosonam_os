export const PRIVATE_BLOG_REGENERATION_MODE = 'replace_existing_fallback_draft' as const;
export const PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE = 'replace_published_after_quality_gate' as const;

interface PublishedBlogUpgradeTopicInput {
  slug?: unknown;
  destination?: unknown;
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildPublishedBlogUpgradeQueueTopic(
  input: PublishedBlogUpgradeTopicInput,
): string {
  const slug = readTrimmedString(input.slug);
  let decodedSlug = slug;
  if (slug) {
    try {
      decodedSlug = decodeURIComponent(slug);
    } catch {
      decodedSlug = '';
    }
  }

  const slugTopic = decodedSlug
    .replace(/[-_]+/g, ' ')
    .replace(/[|\u00b7\u2022]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (slugTopic) return slugTopic;

  const destination = readTrimmedString(input.destination)
    .replace(/[|\u00b7\u2022]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return destination ? `${destination} 현지 여행 정보` : '해외여행 현지 정보';
}

export interface PrivateBlogRegenerationRequest {
  mode: typeof PRIVATE_BLOG_REGENERATION_MODE | typeof PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE;
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
  product_id?: unknown;
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
  const mode = privateRegeneration?.mode;
  const privateDraftRequest = mode === PRIVATE_BLOG_REGENERATION_MODE
    && privateRegeneration?.force_private_review === true;
  const publishedUpgradeRequest = mode === PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE
    && privateRegeneration?.atomic_publish_replace === true;
  if (
    (!privateDraftRequest && !publishedUpgradeRequest)
    || !contentCreativeId
  ) {
    return null;
  }
  return {
    mode,
    contentCreativeId,
  };
}

export function isPublishedBlogAtomicUpgradeRequest(
  request: PrivateBlogRegenerationRequest | null | undefined,
): boolean {
  return request?.mode === PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE;
}

export function isEligiblePrivateBlogRegenerationTarget(
  creative: CreativeInput | null | undefined,
  request: PrivateBlogRegenerationRequest,
): boolean {
  if (!creative || creative.id !== request.contentCreativeId) return false;
  if (isPublishedBlogAtomicUpgradeRequest(request)) {
    return creative.channel === 'naver_blog'
      && creative.status === 'published'
      && creative.product_id == null;
  }
  if (creative.channel !== 'naver_blog' || creative.status !== 'draft') return false;
  const generationMeta = record(creative.generation_meta);
  return generationMeta?.deterministic_info_fallback === true
    || generationMeta?.deterministic_fast_fallback === true;
}
