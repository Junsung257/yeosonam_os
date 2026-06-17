/**
 * @case ERR-BLOG-edge-middleware-timeout (2026-06-18)
 * @summary Public blog routes must not be held in Edge middleware DB existence
 * checks, and blog rendering must not wait forever on auxiliary queries.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const exists = (...parts) => fs.existsSync(path.join(ROOT, ...parts));

test('ERR-BLOG-edge-middleware-timeout: public paths bypass dynamic DB not-found checks', () => {
  const source = read('src', 'middleware.ts');
  const publicIndex = source.indexOf('if (isPublicPath(request))');
  const dynamicIndex = source.indexOf('const dynamicNotFound = await getPublicDynamicNotFoundResponse(pathname);');

  assert.ok(publicIndex > 0, 'public path check should exist');
  assert.ok(dynamicIndex > 0, 'dynamic not-found check should exist');
  assert.ok(publicIndex < dynamicIndex, 'public routes should bypass Edge DB checks');
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 1500\)/);
});

test('ERR-BLOG-edge-middleware-timeout: blog routes are pinned to node runtime', () => {
  const listPage = read('src', 'app', 'blog', 'page.tsx');
  const detailPage = read('src', 'app', 'blog', '[slug]', 'page.tsx');

  assert.match(listPage, /export const runtime = ['"]nodejs['"]/);
  assert.match(detailPage, /export const runtime = ['"]nodejs['"]/);
  assert.match(detailPage, /withBlogRenderTimeout/);
  assert.match(detailPage, /async function getPostFast/);
  assert.match(detailPage, /const post = await getPostFast\(slug\);/);
  assert.match(detailPage, /postFastPackage/);
});

test('ERR-BLOG-edge-middleware-timeout: blog list queries are abortable', () => {
  const source = read('src', 'app', 'blog', 'BlogData.tsx');

  assert.match(source, /function runBlogQuery|async function runBlogQuery/);
  assert.match(source, /abortSignal\(controller\.signal\)/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
  assert.match(source, /runBlogQuery\('posts'/);
});

test('ERR-BLOG-edge-middleware-timeout: blog routes do not stream skeleton-only loading HTML', () => {
  assert.equal(exists('src', 'app', 'blog', 'loading.tsx'), false);
  assert.equal(exists('src', 'app', 'blog', '[slug]', 'loading.tsx'), false);
});
