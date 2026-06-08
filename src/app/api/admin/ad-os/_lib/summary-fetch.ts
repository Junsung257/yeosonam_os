import type { NextRequest } from 'next/server';
import type { Summary } from '@/app/admin/ad-os/_lib/types';

export type AdOsSummaryJson = Summary & Record<string, any>;

export async function fetchAdOsSummaryJson(request: NextRequest): Promise<AdOsSummaryJson> {
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const authorization = request.headers.get('authorization');
  if (cookie) headers.set('cookie', cookie);
  if (authorization) headers.set('authorization', authorization);

  const response = await fetch(new URL('/api/admin/ad-os/summary', request.url), {
    headers,
    cache: 'no-store',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error?: unknown }).error)
        : `Ad OS summary request failed with ${response.status}`;
    throw new Error(message);
  }
  return json && typeof json === 'object' ? json as AdOsSummaryJson : ({} as AdOsSummaryJson);
}
