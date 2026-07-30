import { inferBlogInformationIntent } from '@/lib/blog-information-contract';

export interface PublicBlogAuditCategoryInput {
  category?: string | null;
  title?: string | null;
  destination?: string | null;
  expectedType?: 'info' | 'product' | 'unknown';
  contentType?: string | null;
}

const GENERIC_CATEGORIES = new Set([
  '',
  'blog',
  'guide',
  'info',
  'travel',
  '여행',
  '정보',
]);

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function resolvePublicBlogAuditCategory(
  input: PublicBlogAuditCategoryInput,
): string {
  const declaredCategory = clean(input.category);
  const contentType = clean(input.contentType) || 'guide';

  if (input.expectedType === 'product') {
    return `product:${contentType}`;
  }

  const inferredIntent = inferBlogInformationIntent({
    topic: input.title,
    primaryKeyword: input.title,
    destination: input.destination,
    category: declaredCategory,
  });
  if (inferredIntent !== 'general') return inferredIntent;

  if (!GENERIC_CATEGORIES.has(declaredCategory.toLowerCase())) {
    return declaredCategory;
  }

  return `legacy:${contentType}:general`;
}
