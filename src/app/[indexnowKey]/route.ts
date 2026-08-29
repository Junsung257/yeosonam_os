import { NextResponse } from 'next/server';

import { getSecret } from '@/lib/secret-registry';
import { isValidNaverIndexNowKey, NAVER_INDEXNOW_KEY_PATTERN } from '@/lib/indexnow-key';

export const dynamic = 'force-dynamic';

const INDEXNOW_TXT_RE = new RegExp(`^(${NAVER_INDEXNOW_KEY_PATTERN.source.slice(1, -1)})\\.txt$`);

export async function GET(
  _request: Request,
  props: { params: Promise<{ indexnowKey?: string | string[] }> },
) {
  const params = await props.params;
  const requestedPath = Array.isArray(params.indexnowKey)
    ? params.indexnowKey.join('')
    : params.indexnowKey ?? '';
  const requested = requestedPath.match(INDEXNOW_TXT_RE)?.[1] ?? '';
  const configured = getSecret('INDEXNOW_KEY')?.trim() ?? '';

  if (!isValidNaverIndexNowKey(configured) || requested !== configured) {
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
