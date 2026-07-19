import { NextResponse } from 'next/server';

export const SENSITIVE_API_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
} as const;

export function sensitiveBackendUnavailable(feature: string): NextResponse {
  return NextResponse.json(
    {
      error: `${feature.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_UNAVAILABLE`,
    },
    {
      status: 503,
      headers: SENSITIVE_API_NO_STORE_HEADERS,
    },
  );
}
