import { createClient } from '@supabase/supabase-js';
import { BLOG_PUBLIC_ELIGIBILITY_FIXTURES } from '../src/lib/blog-public-eligibility-fixtures';
import { evaluateBlogPublicEligibility } from '../src/lib/blog-public-eligibility';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const client = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CREATIVE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CREATIVE_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

async function main(): Promise<void> {
  const results = [];

  for (const fixture of BLOG_PUBLIC_ELIGIBILITY_FIXTURES) {
    const row = fixture.row;
    const ts = evaluateBlogPublicEligibility(row);
    const representativeId = row.representative?.canonicalCreativeId === row.id
      ? CREATIVE_ID
      : row.representative?.canonicalCreativeId
        ? OTHER_CREATIVE_ID
        : null;
    const { data, error } = await client.rpc('evaluate_blog_public_eligibility_v3', {
      p_id: CREATIVE_ID,
      p_slug: row.slug ?? null,
      p_status: row.status ?? null,
      p_channel: row.channel ?? null,
      p_product_id: row.productId ? PRODUCT_ID : null,
      p_review_status: row.reviewStatus ?? null,
      p_title: row.title ?? null,
      p_category: row.category ?? null,
      p_content_type: row.contentType ?? null,
      p_topic: row.topic ?? null,
      p_published_at: row.publishedAt ?? null,
      p_generation_meta: row.generationMeta ?? {},
      p_quality_gate: row.qualityGate ?? {},
      p_representative_status: row.representative?.status ?? null,
      p_canonical_creative_id: representativeId,
      p_canonical_slug: row.representative?.canonicalSlug ?? null,
    });
    if (error) throw new Error(`${fixture.id}: ${error.message}`);
    const sql = data?.[0];
    const passed = Boolean(sql)
      && sql.eligible === ts.eligible
      && sql.lane === ts.lane
      && sql.reason === ts.reason
      && sql.eligible === fixture.expectedEligible
      && sql.reason === fixture.expectedReason;
    results.push({ id: fixture.id, passed, ts, sql });
  }

  const failed = results.filter((result) => !result.passed);
  process.stdout.write(`${JSON.stringify({
    readOnly: true,
    fixtureCount: results.length,
    passed: failed.length === 0,
    failed,
  }, null, 2)}\n`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`blog eligibility parity verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
