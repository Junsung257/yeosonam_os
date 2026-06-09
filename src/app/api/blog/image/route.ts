import { NextRequest, NextResponse } from 'next/server';
import { isProxyableBlogImageUrl } from '@/lib/blog-image-proxy';

export const runtime = 'nodejs';
export const revalidate = 2592000;

const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get('src') || '';
  if (!isProxyableBlogImageUrl(src)) {
    return badRequest('Unsupported blog image source');
  }

  const upstream = await fetch(src, {
    headers: {
      accept: IMAGE_ACCEPT,
      'user-agent': 'yeosonam-blog-image-proxy/1.0',
    },
    next: { revalidate },
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return badRequest('Blog image source is not reachable', 502);
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('image/')) {
    return badRequest('Blog image source is not an image', 415);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
    },
  });
}
