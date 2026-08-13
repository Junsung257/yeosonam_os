/**
 * @case ERR-BLOG-edge-middleware-timeout (2026-06-18)
 * @summary Public blog eligibility preflight must be bounded and fail over to
 * the page snapshot without letting public fast paths bypass review blocks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts));

test('ERR-BLOG-edge-middleware-timeout: review-safe preflight runs before the public fast path', () => {
  const source = read('src', 'middleware.ts');
  const publicIndex = source.indexOf('if (isPublicPath(request))');
  const dynamicIndex = source.indexOf('const dynamicNotFound = await getPublicDynamicNotFoundResponse(pathname);');

  assert.ok(publicIndex > 0, 'public path check should exist');
  assert.ok(dynamicIndex > 0, 'dynamic not-found check should exist');
  assert.ok(dynamicIndex < publicIndex, 'review-blocked blog routes must not bypass the hard-status preflight');
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 750\)/);
  assert.match(source, /Database outages must not turn a known public bundle into a false 404/);
});

test('ERR-BLOG-edge-middleware-timeout: blog routes are pinned to node runtime', () => {
  const listPage = read('src', 'app', 'blog', 'page.tsx');
  const detailPage = read('src', 'app', 'blog', '[slug]', 'page.tsx');

  assert.match(listPage, /export const runtime = ['"]nodejs['"]/);
  assert.match(detailPage, /export const runtime = ['"]nodejs['"]/);
  assert.match(detailPage, /withBlogRenderTimeout/);
  assert.match(detailPage, /async function getPostFast/);
  assert.match(detailPage, /post = await getPostFast\(slug\);/);
  assert.match(detailPage, /postFastPackage/);
});

test('ERR-BLOG-edge-middleware-timeout: blog list reads use the bounded snapshot catalog', () => {
  const list = read('src', 'app', 'blog', 'BlogData.tsx');
  const catalog = read('src', 'lib', 'blog-public-catalog.ts');
  const timeout = read('src', 'lib', 'blog-public-query-timeout.ts');

  assert.match(list, /loadPublicBlogCatalogPage/);
  assert.match(catalog, /runBlogPublicQueryWithTimeout/);
  assert.match(catalog, /loadPublicBlogCatalogPageUncached/);
  assert.match(timeout, /AbortController/);
  assert.match(timeout, /controller\.abort\(\)/);
  assert.match(timeout, /Promise\.race/);
});

test('ERR-BLOG-edge-middleware-timeout: ops monitors allow CRON_SECRET server calls', () => {
  const source = read('src', 'middleware.ts');

  assert.match(source, /safeEqualString/);
  assert.match(source, /function cronSecretAllowsRequest/);
  assert.match(source, /pathname\.startsWith\('\/api\/ops\/'\)/);
  assert.match(source, /request\.headers\.get\('authorization'\)/);
  assert.match(source, /Bearer \$\{cronSecret\}/);
});

test('ERR-BLOG-edge-middleware-timeout: blog routes do not stream skeleton-only loading HTML', () => {
  assert.equal(exists('src', 'app', 'blog', 'loading.tsx'), false);
  assert.equal(exists('src', 'app', 'blog', '[slug]', 'loading.tsx'), false);
});
