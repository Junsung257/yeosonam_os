export const PRIVATE_BLOG_REGENERATION_MODE = 'replace_existing_fallback_draft' as const;
export const PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE = 'replace_published_after_quality_gate' as const;
export const REVIEWED_PUBLISHED_BLOG_REPLACEMENT_MODE = 'reviewed_published_replacement_v1' as const;
export const AUTOMATED_PUBLISHED_BLOG_REPLACEMENT_MODE = 'automated_published_replacement_v1' as const;

export interface ReviewedPublishedBlogReplacement {
  mode: typeof REVIEWED_PUBLISHED_BLOG_REPLACEMENT_MODE;
  targetCreativeId: string;
  canonicalSlug: string;
  originalPublishedAt: string | null;
  queueId: string;
}

export interface AutomatedPublishedBlogReplacement {
  mode: typeof AUTOMATED_PUBLISHED_BLOG_REPLACEMENT_MODE;
  targetCreativeId: string;
  canonicalSlug: string;
  draftSlug: string;
  originalPublishedAt: string | null;
  queueId: string;
}

interface PublishedBlogUpgradeTopicInput {
  slug?: unknown;
  destination?: unknown;
  seo_title?: unknown;
  blog_html?: unknown;
}

interface PublishedBlogUpgradeSlugInput {
  publishedAtomicUpgrade: boolean;
  originalSlug?: unknown;
  generatedSlug?: unknown;
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildReviewedPublishedBlogReplacementDraftSlug(input: {
  canonicalSlug: unknown;
  queueId: unknown;
}): string {
  const canonicalSlug = readTrimmedString(input.canonicalSlug);
  const queueId = readTrimmedString(input.queueId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  if (!canonicalSlug || !queueId) return '';
  return `${canonicalSlug}--review-${queueId}`.slice(0, 240);
}

export function buildAutomatedPublishedBlogReplacementDraftSlug(input: {
  canonicalSlug: unknown;
  queueId: unknown;
}): string {
  const canonicalSlug = readTrimmedString(input.canonicalSlug);
  const queueId = readTrimmedString(input.queueId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  if (!canonicalSlug || !queueId) return '';
  return `${canonicalSlug}--auto-${queueId}`.slice(0, 240);
}

export function readReviewedPublishedBlogReplacement(
  generationMeta: unknown,
): ReviewedPublishedBlogReplacement | null {
  const metadata = record(generationMeta);
  const replacement = record(metadata?.reviewed_published_replacement);
  const mode = replacement?.mode;
  const targetCreativeId = readTrimmedString(replacement?.target_creative_id);
  const canonicalSlug = readTrimmedString(replacement?.canonical_slug);
  const queueId = readTrimmedString(replacement?.queue_id);
  const originalPublishedAt = replacement?.original_published_at === null
    ? null
    : readTrimmedString(replacement?.original_published_at);
  if (
    mode !== REVIEWED_PUBLISHED_BLOG_REPLACEMENT_MODE
    || !targetCreativeId
    || !canonicalSlug
    || !queueId
  ) {
    return null;
  }
  return {
    mode,
    targetCreativeId,
    canonicalSlug,
    originalPublishedAt: originalPublishedAt || null,
    queueId,
  };
}

export function readAutomatedPublishedBlogReplacement(
  generationMeta: unknown,
): AutomatedPublishedBlogReplacement | null {
  const metadata = record(generationMeta);
  const replacement = record(metadata?.automated_published_replacement);
  const mode = replacement?.mode;
  const targetCreativeId = readTrimmedString(replacement?.target_creative_id);
  const canonicalSlug = readTrimmedString(replacement?.canonical_slug);
  const draftSlug = readTrimmedString(replacement?.draft_slug);
  const queueId = readTrimmedString(replacement?.queue_id);
  const originalPublishedAt = replacement?.original_published_at === null
    ? null
    : readTrimmedString(replacement?.original_published_at);
  if (
    mode !== AUTOMATED_PUBLISHED_BLOG_REPLACEMENT_MODE
    || !targetCreativeId
    || !canonicalSlug
    || !draftSlug
    || !queueId
  ) {
    return null;
  }
  return {
    mode,
    targetCreativeId,
    canonicalSlug,
    draftSlug,
    originalPublishedAt: originalPublishedAt || null,
    queueId,
  };
}

export function buildPublishedBlogUpgradeQueueTopic(
  input: PublishedBlogUpgradeTopicInput,
): string {
  const seoTitle = readTrimmedString(input.seo_title);
  const slugValue = readTrimmedString(input.slug);
  const existingBody = readTrimmedString(input.blog_html);
  const itineraryContext = `${seoTitle} ${slugValue} ${existingBody.slice(0, 4_000)}`;
  const duration = itineraryContext.match(/(?:^|\s)(\d{1,2})\s*박\s*(\d{1,2})\s*일/u);
  const destination = readTrimmedString(input.destination)
    .replace(/[|\u00b7\u2022]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (duration && /일정|코스|동선|여정|itinerary|route/i.test(itineraryContext)) {
    return `${destination || '여행지'} ${duration[1]}박${duration[2]}일 여행 코스와 이동 동선`;
  }

  const titleTopic = seoTitle
    .split('|')[0]!
    .replace(/(?:여행\s*)?가이드|체크리스트|총정리|완벽|필수|BEST/gi, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/[가-힣]{2,}/.test(titleTopic)) return titleTopic;

  const slug = slugValue;
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
    .replace(/(?:총정리|완벽\s*(?:가이드|정리|체크리스트)|완벽한)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (slugTopic) {
    return /^(?:20\d{2}|\d{1,2}\s*(?:월|month))/i.test(slugTopic)
      ? `${destination || '여행'} ${slugTopic}`
      : slugTopic;
  }

  return destination ? `${destination} 현지 여행 정보` : '해외여행 현지 정보';
}

export function preservePublishedBlogAtomicUpgradeSlug(
  input: PublishedBlogUpgradeSlugInput,
): string {
  const originalSlug = readTrimmedString(input.originalSlug);
  const generatedSlug = readTrimmedString(input.generatedSlug);
  return input.publishedAtomicUpgrade && originalSlug ? originalSlug : generatedSlug;
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
