import { CUSTOMER_VISIBLE_STATUSES } from '@/lib/visibility-status';

export const ADMIN_PACKAGE_STATUSES = ['all', 'selling', 'pending', 'archived'] as const;

export type AdminPackageStatus = (typeof ADMIN_PACKAGE_STATUSES)[number];

export function parseAdminPackageStatus(value: string | null | undefined): AdminPackageStatus {
  return ADMIN_PACKAGE_STATUSES.includes(value as AdminPackageStatus)
    ? value as AdminPackageStatus
    : 'all';
}

export function packageDatabaseStatuses(status: AdminPackageStatus): readonly string[] | null {
  if (status === 'selling') return CUSTOMER_VISIBLE_STATUSES;
  if (status === 'pending') return ['pending', 'pending_review', 'draft'];
  if (status === 'archived') return ['archived', 'INACTIVE'];
  return null;
}

export const PACKAGE_CONTENT_CHANNELS = ['naver_blog', 'instagram_card', 'google_search'] as const;

export type PackageContentChannel = (typeof PACKAGE_CONTENT_CHANNELS)[number];

export interface PackageContentGenerationResult {
  successful: PackageContentChannel[];
  failed: Array<{ channel: PackageContentChannel; reason: string }>;
}

type ContentRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; reason?: string };
    return body.error || body.reason || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function generatePackageContentChannels(
  productId: string,
  request: ContentRequest = fetch,
): Promise<PackageContentGenerationResult> {
  const results = await Promise.all(PACKAGE_CONTENT_CHANNELS.map(async (channel) => {
    try {
      const response = await request('/api/content-hub/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, angle: 'value', channel }),
      });
      if (!response.ok) {
        return { channel, ok: false as const, reason: await responseError(response) };
      }
      return { channel, ok: true as const };
    } catch (error) {
      return {
        channel,
        ok: false as const,
        reason: error instanceof Error ? error.message : '네트워크 오류',
      };
    }
  }));

  return {
    successful: results.filter(result => result.ok).map(result => result.channel),
    failed: results
      .filter((result): result is Extract<(typeof results)[number], { ok: false }> => !result.ok)
      .map(result => ({ channel: result.channel, reason: result.reason })),
  };
}
