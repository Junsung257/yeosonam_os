import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

function requestFor(source: string): NextRequest {
  return new NextRequest(`https://www.yeosonam.com/api/blog/image?src=${encodeURIComponent(source)}&w=480`);
}

describe('blog image proxy upstream boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a redirect target before requesting outside the allowlist', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/internal.png' },
    }));

    const response = await GET(requestFor('https://images.pexels.com/photos/1/photo.jpg'));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Blog image source redirected outside the allowlist',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('follows a bounded Wikimedia redirect only after validating the media host', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/example.jpg' },
      }))
      .mockResolvedValueOnce(new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) },
      }));

    const response = await GET(requestFor('https://commons.wikimedia.org/wiki/Special:FilePath/example.jpg'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://upload.wikimedia.org/wikipedia/commons/a/a1/example.jpg');
  });

  it('rejects oversized and active SVG responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': String(10 * 1024 * 1024 + 1) },
    }));
    const oversized = await GET(requestFor('https://images.pexels.com/photos/2/photo.jpg'));
    expect(oversized.status).toBe(413);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('<svg><script>alert(1)</script></svg>', {
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
    }));
    const svg = await GET(requestFor('https://images.pexels.com/photos/3/photo.svg'));
    expect(svg.status).toBe(415);
  });

  it('stops reading a chunked source once the byte ceiling is crossed', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        controller.enqueue(new Uint8Array(5 * 1024 * 1024));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }));

    const response = await GET(requestFor('https://images.pexels.com/photos/4/photo.jpg'));

    expect(response.status).toBe(413);
  });
});
