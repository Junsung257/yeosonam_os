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

test('ERR-BLOG-external-image-client-block: proxy helper allowlists Pexels and encodes src', () => {
  const source = read('src', 'lib', 'blog-image-proxy.ts');

  assert.match(source, /images\.pexels\.com/);
  assert.match(source, /BLOG_IMAGE_PROXY_PATH\s*=\s*['"]\/api\/blog\/image['"]/);
  assert.match(source, /encodeURIComponent\(value\.trim\(\)\)/);
  assert.match(source, /url\.protocol\s*===\s*['"]https:['"]/);
});

test('ERR-BLOG-external-image-client-block: image route validates proxyable sources before fetching', () => {
  const source = read('src', 'app', 'api', 'blog', 'image', 'route.ts');

  assert.match(source, /isProxyableBlogImageUrl/);
  assert.match(source, /request\.nextUrl\.searchParams\.get\(['"]src['"]\)/);
  assert.match(source, /fetch\(src/);
});

test('ERR-BLOG-external-image-client-block: public blog render surfaces use display/proxy helpers', () => {
  const renderer = read('src', 'lib', 'blog-renderer.ts');
  const detailPage = read('src', 'app', 'blog', '[slug]', 'page.tsx');
  const listPage = read('src', 'app', 'blog', 'BlogData.tsx');

  assert.match(renderer, /proxyBlogImageUrlsInHtml/);
  assert.match(detailPage, /toBlogImageDisplaySrc/);
  assert.match(listPage, /toBlogImageDisplaySrc/);
});
