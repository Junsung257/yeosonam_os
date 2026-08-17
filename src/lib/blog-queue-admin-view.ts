export const BLOG_QUEUE_ADMIN_VIEW_KEYS = [
  'active',
  'attention',
  'manual',
  'queued',
  'failed',
  'history',
  'all',
] as const;

export type BlogQueueAdminViewKey = (typeof BLOG_QUEUE_ADMIN_VIEW_KEYS)[number];

export function resolveBlogQueueAdminView(
  scope: string | string[] | undefined,
  status: string | string[] | undefined,
): BlogQueueAdminViewKey {
  const normalizedScope = Array.isArray(scope) ? scope[0] : scope;
  const normalizedStatus = Array.isArray(status) ? status[0] : status;

  if (normalizedStatus === 'failed') return 'failed';
  if (normalizedStatus === 'queued') return 'queued';
  if (normalizedScope === 'attention') return 'attention';
  if (normalizedScope === 'manual') return 'manual';
  if (normalizedScope === 'history') return 'history';
  if (normalizedScope === 'all') return 'all';
  return 'active';
}
