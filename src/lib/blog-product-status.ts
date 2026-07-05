const RETIRED_PRODUCT_STATUSES = new Set([
  'archived',
  'inactive',
  'rejected',
  'expired',
  'deleted',
  'cancelled',
  'canceled',
]);

export function normalizeBlogProductStatus(status?: string | null): string {
  return String(status ?? '').trim().toLowerCase();
}

export function isRetiredBlogProductStatus(status?: string | null): boolean {
  return RETIRED_PRODUCT_STATUSES.has(normalizeBlogProductStatus(status));
}
