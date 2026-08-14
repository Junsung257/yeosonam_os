/**
 * @case ERR-BLOG-db-unavailable-not-silent-empty (2026-08-13)
 * @summary Public blog outages use bounded reads and last-known-good snapshots;
 * they must not be represented as an empty corpus or a false 404.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-db-unavailable-not-silent-empty: server credentials keep verified service role precedence', () => {
  const registry = read('src', 'lib', 'secret-registry.ts');
  const supabase = read('src', 'lib', 'supabase.ts');
  const secretIndex = supabase.indexOf("getSecret('SUPABASE_SECRET_KEY')");
  const legacyIndex = supabase.indexOf("getSecret('SUPABASE_SERVICE_ROLE_KEY')");

  assert.match(registry, /'SUPABASE_SECRET_KEY'/);
  assert.ok(secretIndex > 0);
  assert.ok(legacyIndex > 0);
  assert.ok(legacyIndex < secretIndex);
});

test('ERR-BLOG-db-unavailable-not-silent-empty: health DB probe is bounded', () => {
  const health = read('src', 'app', 'api', 'v1', 'health', 'route.ts');

  assert.match(health, /checkDatabase/);
  assert.match(health, /abortSignal\(controller\.signal\)/);
  assert.match(health, /timeoutMs = 2500/);
});

test('ERR-BLOG-db-unavailable-not-silent-empty: list uses live, durable, then bundled catalog', () => {
  const list = read('src', 'app', 'blog', 'BlogData.tsx');
  const catalog = read('src', 'lib', 'blog-public-catalog.ts');
  const timeout = read('src', 'lib', 'blog-public-query-timeout.ts');

  assert.match(list, /loadPublicBlogCatalogPage/);
  assert.match(list, /unavailable: boolean/);
  assert.match(list, /블로그 데이터를 잠시 불러오지 못했습니다/);
  assert.match(list, /totalLabel = unavailable \? '확인 중' : total\.toLocaleString\(\)/);
  assert.match(catalog, /loadDurableCatalogPage/);
  assert.match(catalog, /loadBundledCatalogPage/);
  assert.match(catalog, /servedFrom: 'live_view'/);
  assert.match(catalog, /servedFrom: 'durable_snapshot'/);
  assert.match(catalog, /servedFrom: 'bundled_snapshot'/);
  assert.match(catalog, /getCachedPublicBlogCatalogPage/);
  assert.match(timeout, /AbortController/);
  assert.match(timeout, /Promise\.race/);
});

test('ERR-BLOG-db-unavailable-not-silent-empty: detail uses a typed outage envelope and bundled snapshot', () => {
  const detail = read('src', 'app', 'blog', '[slug]', 'page.tsx');
  const snapshot = read('src', 'lib', 'blog-public-snapshot-v3.ts');

  assert.match(detail, /loadBlogPublicDetailSnapshotV3/);
  assert.match(detail, /loadBlogPostCacheEnvelope/);
  assert.match(detail, /blog-detail-v6-outage-envelope/);
  assert.match(detail, /state: 'unavailable'/);
  assert.match(detail, /if \(cached\.state === 'unavailable'\) throw createBlogDatabaseUnavailableError\(\)/);
  assert.match(detail, /BlogDatabaseUnavailableView/);
  assert.match(detail, /return <BlogDatabaseUnavailableView slug=\{slug\} \/>/);
  assert.match(snapshot, /bundledDetailSnapshot/);
  assert.match(snapshot, /isBlogPublicDetailSnapshotPolicySafeV3/);
});

test('ERR-BLOG-db-unavailable-not-silent-empty: destination and angle routes use the shared catalog', () => {
  const destination = read('src', 'app', 'blog', 'destination', '[dest]', 'page.tsx');
  const angle = read('src', 'app', 'blog', 'angle', '[angle]', 'page.tsx');

  assert.match(destination, /loadPublicBlogCatalogPage/);
  assert.match(destination, /getDestinationPageDataUncached/);
  assert.match(destination, /unavailable: true/);
  assert.match(angle, /loadPublicBlogCatalogPage/);
  assert.match(angle, /getAnglePageDataUncached/);
  assert.match(angle, /unavailable: true/);
});

test('ERR-BLOG-db-unavailable-not-silent-empty: public cache invalidation covers all blog surfaces', () => {
  const cache = read('src', 'lib', 'blog-cache.ts');
  const revalidate = read('src', 'lib', 'revalidate-blog-cache.ts');

  assert.match(cache, /BLOG_LIST_CACHE_TAG = ['"]blog-list['"]/);
  assert.match(cache, /BLOG_DETAIL_CACHE_TAG = ['"]blog-detail['"]/);
  assert.match(cache, /BLOG_DESTINATION_CACHE_TAG = ['"]blog-destination['"]/);
  assert.match(cache, /BLOG_ANGLE_CACHE_TAG = ['"]blog-angle['"]/);
  assert.match(revalidate, /safeRevalidateTag\(BLOG_LIST_CACHE_TAG\)/);
  assert.match(revalidate, /safeRevalidateTag\(BLOG_DETAIL_CACHE_TAG\)/);
  assert.match(revalidate, /safeRevalidatePath\('\/sitemap\.xml'\)/);
});
