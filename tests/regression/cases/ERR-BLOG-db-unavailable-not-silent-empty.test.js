/**
 * @case ERR-BLOG-db-unavailable-not-silent-empty (2026-06-18)
 * @summary Blog DB outages must not be reported as zero published posts or 404s.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('Supabase server client keeps verified service role ahead of unvalidated secret key aliases', () => {
  const registry = read('src', 'lib', 'secret-registry.ts');
  const supabase = read('src', 'lib', 'supabase.ts');

  assert.match(registry, /'SUPABASE_SECRET_KEY'/);
  assert.match(registry, /'SUPABASE_SECRET_DEFAULT_KEY'/);
  assert.match(registry, /'SUPABASE_SERVICE_KEY'/);

  const secretIndex = supabase.indexOf("getSecret('SUPABASE_SECRET_KEY')");
  const legacyIndex = supabase.indexOf("getSecret('SUPABASE_SERVICE_ROLE_KEY')");
  assert.ok(secretIndex > 0, 'new secret key should be read');
  assert.ok(legacyIndex > 0, 'legacy service role should remain supported');
  assert.ok(legacyIndex < secretIndex, 'verified service role should take precedence');
});

test('/api/v1/health performs a real DB probe with a short timeout', () => {
  const source = read('src', 'app', 'api', 'v1', 'health', 'route.ts');

  assert.match(source, /checkDatabase/);
  assert.match(source, /abortSignal\(controller\.signal\)/);
  assert.match(source, /timeoutMs = 2500/);
  assert.match(source, /db,\s*timestamp/s);
  assert.doesNotMatch(source, /db:\s*dbOk \? ['"]connected['"] : ['"]not_configured['"]/);
});

test('/blog list renders DB unavailable state instead of silent empty posts', () => {
  const source = read('src', 'app', 'blog', 'BlogData.tsx');

  assert.match(source, /unavailable: boolean/);
  assert.match(source, /unstable_cache/);
  assert.match(source, /getCachedBlogData/);
  assert.match(source, /BLOG_LIST_CACHE_TAG/);
  assert.match(source, /throw createBlogDatabaseUnavailableError\(\)/);
  assert.match(source, /__blogQueryUnavailable/);
  assert.match(source, /isBlogQueryUnavailable/);
  assert.match(source, /isBlogQueryUnavailable\(destRes\)/);
  assert.match(source, /isBlogQueryUnavailable\(angleRes\)/);
  assert.match(source, /connection timeout/i);
  assert.match(source, /블로그 데이터를 잠시 불러오지 못했습니다/);
  assert.match(source, /DB 응답 지연/);
  assert.match(source, /totalLabel = unavailable \? '확인 중' : total\.toLocaleString\(\)/);
  assert.match(source, /numberOfItems: unavailable \? undefined : total/);
  assert.match(source, /!isSupabaseConfigured \|\| !isSupabaseAdminConfigured/);
});

test('/blog detail does not convert DB timeouts into notFound', () => {
  const source = read('src', 'app', 'blog', '[slug]', 'page.tsx');
  const cache = read('src', 'lib', 'blog-cache.ts');

  assert.match(cache, /BLOG_DATABASE_UNAVAILABLE/);
  assert.match(source, /createBlogDatabaseUnavailableError/);
  assert.match(source, /unstable_cache/);
  assert.match(source, /getPostFastUncached/);
  assert.match(source, /getCachedPostFast/);
  assert.match(source, /BLOG_DETAIL_CACHE_TAG/);
  assert.match(source, /duplicateTitleSuffix/);
  assert.match(source, /headlineExperiment/);
  assert.match(source, /isBlogDetailQueryUnavailable/);
  assert.match(source, /BlogDatabaseUnavailableView/);
  assert.match(source, /블로그 데이터를 잠시 불러오지 못했습니다/);
  assert.match(source, /DB 응답이 지연/);
  assert.match(source, /const postResult = await runBlogDetailQuery/);
  assert.match(source, /!isSupabaseConfigured \|\| !isSupabaseAdminConfigured/);
});

test('/api/blog returns 503 for DB timeout instead of hanging silently', () => {
  const source = read('src', 'app', 'api', 'blog', 'route.ts');

  assert.match(source, /runApiBlogQuery/);
  assert.match(source, /abortSignal\(controller\.signal\)/);
  assert.match(source, /isAbortLikeError/);
  assert.match(source, /Blog database request timed out/);
  assert.match(source, /stale-if-error=86400/);
  assert.match(source, /status: 503/);
});

test('public blog publish paths invalidate list and detail data caches', () => {
  const cache = read('src', 'lib', 'blog-cache.ts');
  const revalidate = read('src', 'lib', 'revalidate-blog-cache.ts');

  assert.match(cache, /BLOG_LIST_CACHE_TAG = ['"]blog-list['"]/);
  assert.match(cache, /BLOG_DETAIL_CACHE_TAG = ['"]blog-detail['"]/);
  assert.match(cache, /BLOG_DESTINATION_CACHE_TAG = ['"]blog-destination['"]/);
  assert.match(cache, /BLOG_ANGLE_CACHE_TAG = ['"]blog-angle['"]/);
  assert.match(revalidate, /safeRevalidateTag\(BLOG_LIST_CACHE_TAG\)/);
  assert.match(revalidate, /safeRevalidateTag\(BLOG_DETAIL_CACHE_TAG\)/);
  assert.match(revalidate, /safeRevalidateTag\(BLOG_DESTINATION_CACHE_TAG\)/);
  assert.match(revalidate, /safeRevalidateTag\(BLOG_ANGLE_CACHE_TAG\)/);
  assert.match(revalidate, /safeRevalidatePath\('\/blog'\)/);
  assert.match(revalidate, /safeRevalidatePath\(`\/blog\/\$\{slug\}`\)/);

  for (const file of [
    ['src', 'app', 'api', 'blog', 'route.ts'],
    ['src', 'app', 'api', 'blog', 'from-card-news', 'route.ts'],
    ['src', 'app', 'api', 'blog', 'mrt-hotel-ranking', 'route.ts'],
    ['src', 'app', 'api', 'content-queue', 'route.ts'],
    ['src', 'app', 'api', 'content-hub', 'publish', 'route.ts'],
    ['src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts'],
    ['src', 'app', 'api', 'cron', 'blog-regenerate-zero-click', 'route.ts'],
  ]) {
    assert.match(read(...file), /revalidatePublicBlogCache/);
  }
});

test('blog destination and angle tabs do not cache unavailable empty states', () => {
  const destination = read('src', 'app', 'blog', 'destination', '[dest]', 'page.tsx');
  const angle = read('src', 'app', 'blog', 'angle', '[angle]', 'page.tsx');
  const matcher = read('src', 'lib', 'angle-matcher.ts');

  assert.match(destination, /getCachedDestinationPageData/);
  assert.match(destination, /BLOG_DESTINATION_CACHE_TAG/);
  assert.match(destination, /throw createBlogDatabaseUnavailableError\(\)/);
  assert.match(destination, /\.eq\('destination', destination\)/);
  assert.doesNotMatch(destination, /\.limit\(1000\)/);
  assert.match(destination, /runBlogDestinationQuery\('posts'/);
  assert.match(destination, /블로그 데이터를 잠시 불러오지 못했습니다/);

  assert.match(angle, /getCachedAnglePageData/);
  assert.match(angle, /BLOG_ANGLE_CACHE_TAG/);
  assert.match(angle, /throw createBlogDatabaseUnavailableError\(\)/);
  assert.match(angle, /runBlogAngleQuery/);
  assert.match(angle, /블로그 데이터를 잠시 불러오지 못했습니다/);

  assert.match(matcher, /runAnglePackageQuery/);
  assert.match(matcher, /abortSignal\(controller\.signal\)/);
  assert.match(matcher, /!isSupabaseConfigured \|\| !isSupabaseAdminConfigured/);
});
