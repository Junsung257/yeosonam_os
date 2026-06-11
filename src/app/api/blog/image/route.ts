import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { isProxyableBlogImageUrl } from '@/lib/blog-image-proxy';

export const runtime = 'nodejs';
export const revalidate = 2592000;

const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const DEFAULT_WIDTH = 960;
const MAX_WIDTH = 1600;
const DEFAULT_QUALITY = 74;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get('src') || '';
  if (!isProxyableBlogImageUrl(src)) {
    return badRequest('Unsupported blog image source');
  }
  const width = clampInt(request.nextUrl.searchParams.get('w'), DEFAULT_WIDTH, 160, MAX_WIDTH);
  const quality = clampInt(request.nextUrl.searchParams.get('q'), DEFAULT_QUALITY, 50, 85);

  const upstream = await fetch(src, {
    headers: {
      accept: IMAGE_ACCEPT,
      'user-agent': 'yeosonam-blog-image-proxy/1.0',
    },
    cache: 'no-store',
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return badRequest('Blog image source is not reachable', 502);
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('image/')) {
    return badRequest('Blog image source is not an image', 415);
  }
  if (contentType.toLowerCase().includes('svg')) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const sourceBuffer = Buffer.from(await upstream.arrayBuffer());
  if (sourceBuffer.byteLength > MAX_SOURCE_BYTES) {
    return badRequest('Blog image source is too large', 413);
  }

  try {
    const optimized = await sharp(sourceBuffer, { animated: false, limitInputPixels: 24_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();

    return new Response(new Uint8Array(optimized), {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'content-length': String(optimized.byteLength),
        'cache-control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800',
        'x-content-type-options': 'nosniff',
        'vary': 'Accept',
      },
    });
  } catch {
    // Keep image availability higher than optimization perfection.
    return new Response(new Uint8Array(sourceBuffer), {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-length': String(sourceBuffer.byteLength),
        'cache-control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800',
        'x-content-type-options': 'nosniff',
      },
    });
  }
}
