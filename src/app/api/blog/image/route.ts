import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { isProxyableBlogImageUrl, normalizeBlogImageProxyWidth } from '@/lib/blog-image-proxy';

export const runtime = 'nodejs';
export const revalidate = 2592000;

const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const DEFAULT_WIDTH = 960;
const DEFAULT_QUALITY = 74;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

class BlogImageProxyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function fetchAllowedUpstream(src: string): Promise<Response> {
  let current = src;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isProxyableBlogImageUrl(current)) {
      throw new BlogImageProxyError('Blog image source redirected outside the allowlist', 502);
    }

    let upstream: Response;
    try {
      upstream = await fetch(current, {
        headers: {
          accept: IMAGE_ACCEPT,
          'user-agent': 'yeosonam-blog-image-proxy/1.0',
        },
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new BlogImageProxyError('Blog image source is not reachable', 502);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) {
        throw new BlogImageProxyError('Blog image source redirect is invalid', 502);
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (!upstream.ok || !upstream.body) {
      throw new BlogImageProxyError('Blog image source is not reachable', 502);
    }
    return upstream;
  }

  throw new BlogImageProxyError('Blog image source redirect limit exceeded', 502);
}

async function readBodyWithinLimit(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw new BlogImageProxyError('Blog image source is too large', 413);
  }
  if (!response.body) {
    throw new BlogImageProxyError('Blog image source is not reachable', 502);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new BlogImageProxyError('Blog image source is too large', 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), received);
}

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get('src') || '';
  if (!isProxyableBlogImageUrl(src)) {
    return badRequest('Unsupported blog image source');
  }
  const width = normalizeBlogImageProxyWidth(
    clampInt(request.nextUrl.searchParams.get('w'), DEFAULT_WIDTH, 160, 1600),
  );
  const quality = clampInt(request.nextUrl.searchParams.get('q'), DEFAULT_QUALITY, 50, 85);

  let upstream: Response;
  try {
    upstream = await fetchAllowedUpstream(src);
  } catch (error) {
    if (error instanceof BlogImageProxyError) return badRequest(error.message, error.status);
    return badRequest('Blog image source is not reachable', 502);
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('image/')) {
    return badRequest('Blog image source is not an image', 415);
  }
  if (contentType.toLowerCase().includes('svg')) {
    return badRequest('SVG blog image sources are not supported', 415);
  }

  let sourceBuffer: Buffer;
  try {
    sourceBuffer = await readBodyWithinLimit(upstream);
  } catch (error) {
    if (error instanceof BlogImageProxyError) return badRequest(error.message, error.status);
    return badRequest('Blog image source is not reachable', 502);
  }

  try {
    const acceptsAvif = /(?:^|,)\s*image\/avif(?:\s*;|,|$)/i.test(request.headers.get('accept') || '');
    const pipeline = sharp(sourceBuffer, { animated: false, limitInputPixels: 24_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true });
    const optimized = acceptsAvif
      ? await pipeline.avif({ quality, effort: 4 }).toBuffer()
      : await pipeline.webp({ quality, effort: 4 }).toBuffer();

    return new Response(new Uint8Array(optimized), {
      status: 200,
      headers: {
        'content-type': acceptsAvif ? 'image/avif' : 'image/webp',
        'content-length': String(optimized.byteLength),
        'cache-control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=604800',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
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
