/**
 * @case ERR-BLOG-external-image-client-block (2026-06-09)
 * @summary Browser-visible blog images from proxyable third-party hosts must be
 * rendered through /api/blog/image, not exposed directly as images.pexels.com.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(...segments) {
  return fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
}

test('ERR-BLOG-external-image-client-block: proxy helper uses an exact HTTPS allowlist and encodes src', () => {
  const source = read('src', 'lib', 'blog-image-proxy.ts');

  assert.match(source, /images\.pexels\.com/);
  assert.match(source, /upload\.wikimedia\.org/);
  assert.match(source, /BLOG_IMAGE_PROXY_PATH\s*=\s*['"]\/api\/blog\/image['"]/);
  assert.match(source, /encodeURIComponent\(value\.trim\(\)\)/);
  assert.match(source, /url\.protocol\s*!==\s*['"]https:['"]/);
  assert.match(source, /url\.username\s*\|\|\s*url\.password/);
  assert.match(source, /url\.port\s*&&\s*url\.port\s*!==\s*['"]443['"]/);
});

test('ERR-BLOG-external-image-client-block: image route validates every redirect and bounds the response body', () => {
  const source = read('src', 'app', 'api', 'blog', 'image', 'route.ts');

  assert.match(source, /isProxyableBlogImageUrl/);
  assert.match(source, /request\.nextUrl\.searchParams\.get\(['"]src['"]\)/);
  assert.match(source, /fetchAllowedUpstream\(src\)/);
  assert.match(source, /fetch\(current/);
  assert.match(source, /redirect:\s*['"]manual['"]/);
  assert.match(source, /MAX_REDIRECTS\s*=\s*3/);
  assert.match(source, /received\s*>\s*MAX_SOURCE_BYTES/);
  assert.match(source, /includes\(['"]svg['"]\)/);
});

test('ERR-BLOG-external-image-client-block: public blog render surfaces use responsive safe image components', () => {
  const renderer = read('src', 'lib', 'blog-renderer.ts');
  const detailPage = read('src', 'app', 'blog', '[slug]', 'page.tsx');
  const listPage = read('src', 'app', 'blog', 'BlogData.tsx');
  const safeImage = read('src', 'components', 'customer', 'SafeRemoteImage.tsx');

  assert.match(renderer, /proxyBlogImageUrlsInHtml/);
  assert.match(detailPage, /toBlogImageDisplaySrc/);
  assert.match(listPage, /SafeCoverImg/);
  assert.match(safeImage, /buildBlogImageSrcSet/);
  assert.match(safeImage, /SafeCoverNextImg/);
});
