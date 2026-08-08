import { NextRequest } from 'next/server';

export function isAllowedPartnerWriteOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === request.nextUrl.host;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin';

  // Node tests and trusted server-to-server calls do not always set browser
  // fetch metadata. Production browsers do, so fail closed there.
  return process.env.NODE_ENV !== 'production';
}

