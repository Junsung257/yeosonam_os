import type { PublicBlogCatalogPost } from '@/lib/blog-public-catalog';

const DECISION_KEYWORDS = ['크루즈', '골프', '패키지', '부모님', '부산', '비용', '예약', '비교'];

function currentKstParts(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? now.getUTCFullYear()),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? now.getUTCMonth() + 1),
  };
}

export function isCurrentCustomerGuide(post: PublicBlogCatalogPost, now = new Date()): boolean {
  const title = post.seo_title?.trim() ?? '';
  const slug = post.slug?.trim() ?? '';
  if (!title || !slug) return false;

  const publishedAt = Date.parse(post.published_at);
  if (!Number.isFinite(publishedAt) || publishedAt > now.getTime() + 5 * 60_000) return false;
  if (now.getTime() - publishedAt > 550 * 24 * 60 * 60_000) return false;

  const { year, month } = currentKstParts(now);
  const mentionedYears = [...title.matchAll(/(20\d{2})년/gu)].map((match) => Number(match[1]));
  if (mentionedYears.some((mentionedYear) => mentionedYear !== year)) return false;
  const mentionedMonths = [...title.matchAll(/(?:^|\D)(1[0-2]|[1-9])월/gu)].map((match) => Number(match[1]));
  if (mentionedMonths.some((mentionedMonth) => mentionedMonth !== month)) return false;
  return true;
}

export function selectCurrentCustomerGuides(
  posts: PublicBlogCatalogPost[],
  limit: number,
  now = new Date(),
): PublicBlogCatalogPost[] {
  return posts
    .filter((post) => isCurrentCustomerGuide(post, now))
    .sort((left, right) => {
      const leftTitle = left.seo_title ?? '';
      const rightTitle = right.seo_title ?? '';
      const leftPriority = DECISION_KEYWORDS.some((keyword) => leftTitle.includes(keyword)) ? 1 : 0;
      const rightPriority = DECISION_KEYWORDS.some((keyword) => rightTitle.includes(keyword)) ? 1 : 0;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return Date.parse(right.published_at) - Date.parse(left.published_at);
    })
    .slice(0, Math.max(0, limit));
}
