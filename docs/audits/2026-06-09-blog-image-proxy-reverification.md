# Blog Image Proxy Reverification - 2026-06-09

## Why This Audit Exists

The previous production audits reported 100 for render/image/SEO, but the live browser still showed broken blog images. The missing check was client-side image loading: `images.pexels.com` can be reachable from server-side probes while blocked in a reader browser.

## Finding

- Page inspected: `https://www.yeosonam.com/blog/zhangjiajie-weather`
- Browser evidence before this fix:
  - `imageCount=3`
  - each Pexels image had `naturalWidth=0`, `naturalHeight=0`
  - visible height collapsed to about 31px
  - markdown artifacts, strikethrough, and table overflow were not present on this page
- Direct browser navigation to the Pexels asset returned `ERR_BLOCKED_BY_CLIENT`.
- Server `curl -I` for the same Pexels URL returned `200 OK`.

## Fix Implemented

- Added allowlisted image proxy route: `src/app/api/blog/image/route.ts`
- Added shared image display helper: `src/lib/blog-image-proxy.ts`
- Rewrote rendered article HTML Pexels `img src` values through `/api/blog/image?src=...`
- Routed listing cards, detail hero image, related post cards, previous/next cards, metadata images, and JSON-LD image fields through the same helper.
- Allowed safe same-origin image paths in `src/lib/image-url.ts` so the existing safe image component can use the proxy path.

## Local Verification

- `npx vitest run src/lib/blog-image-proxy.test.ts src/lib/blog-renderer.test.ts src/lib/blog-publish-quality.test.ts`
  - 3 files passed
  - 22 tests passed
- `npm run type-check`
  - passed
- `npm run lint`
  - passed
- Browser check:
  - URL: `http://localhost:3011/api/blog/image?src=<encoded Pexels URL>`
  - Result: `naturalWidth=1880`, `naturalHeight=1253`

## Required Production Verification After Deploy

- `npm run audit:blog-visual -- --base=https://www.yeosonam.com --full --strict --json`
- `npm run audit:blog-images -- --base=https://www.yeosonam.com --json`
- `npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json`
- `npm run audit:blog-seo -- --base=https://www.yeosonam.com --json`

Passing criteria:

- `visible_broken_or_tiny_images=0`
- `broken image=0`
- `raw markdown artifact=0`
- `seo score=100`
