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

test('Supabase server client supports new secret API key names before legacy service role', () => {
  const registry = read('src', 'lib', 'secret-registry.ts');
  const supabase = read('src', 'lib', 'supabase.ts');

  assert.match(registry, /'SUPABASE_SECRET_KEY'/);
  assert.match(registry, /'SUPABASE_SECRET_DEFAULT_KEY'/);
  assert.match(registry, /'SUPABASE_SERVICE_KEY'/);

  const secretIndex = supabase.indexOf("getSecret('SUPABASE_SECRET_KEY')");
  const legacyIndex = supabase.indexOf("getSecret('SUPABASE_SERVICE_ROLE_KEY')");
  assert.ok(secretIndex > 0, 'new secret key should be read');
  assert.ok(legacyIndex > 0, 'legacy service role should remain supported');
  assert.ok(secretIndex < legacyIndex, 'new secret key should take precedence');
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
  assert.match(source, /__blogQueryUnavailable/);
  assert.match(source, /isBlogQueryUnavailable/);
  assert.match(source, /connection timeout/i);
  assert.match(source, /블로그 데이터를 잠시 불러오지 못했습니다/);
  assert.match(source, /DB 응답 지연/);
  assert.match(source, /!isSupabaseConfigured \|\| !isSupabaseAdminConfigured/);
});

test('/blog detail does not convert DB timeouts into notFound', () => {
  const source = read('src', 'app', 'blog', '[slug]', 'page.tsx');

  assert.match(source, /BLOG_DATABASE_UNAVAILABLE/);
  assert.match(source, /isBlogDetailQueryUnavailable/);
  assert.match(source, /const postResult = await runBlogDetailQuery/);
  assert.match(source, /!isSupabaseConfigured \|\| !isSupabaseAdminConfigured/);
});

test('/api/blog returns 503 for DB timeout instead of hanging silently', () => {
  const source = read('src', 'app', 'api', 'blog', 'route.ts');

  assert.match(source, /runApiBlogQuery/);
  assert.match(source, /abortSignal\(controller\.signal\)/);
  assert.match(source, /isAbortLikeError/);
  assert.match(source, /Blog database request timed out/);
  assert.match(source, /status: 503/);
});
