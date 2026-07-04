import { NextResponse } from 'next/server';

import { getSecret } from '@/lib/secret-registry';

export const dynamic = 'force-dynamic';

const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export async function GET(
  _request: Request,
  props: { params: Promise<{ indexnowKey?: string | string[] }> },
) {
  const params = await props.params;
  const requested = Array.isArray(params.indexnowKey)
    ? params.indexnowKey.join('')
    : params.indexnowKey ?? '';
  const configured = getSecret('INDEXNOW_KEY')?.trim() ?? '';

  if (!configured || !INDEXNOW_KEY_PATTERN.test(configured) || requested !== configured) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  return new NextResponse(configured, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
