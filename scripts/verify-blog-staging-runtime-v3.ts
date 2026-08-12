import { createClient } from '@supabase/supabase-js';
import { assertBlogStagingRuntimeTarget } from './lib/blog-staging-runtime-target-v3';

const target = assertBlogStagingRuntimeTarget(process.env);
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

const service = createClient(target.url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = createClient(target.url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main(): Promise<void> {
  const [{ data: posts, error: postError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    service.from('public_blog_content_creatives')
      .select('id,slug,public_eligibility_lane,public_eligibility_reason')
      .like('tracking_id', 'staging-blog-v3-%'),
    service.from('blog_public_snapshots')
      .select('creative_id,slug,is_current')
      .eq('is_current', true),
  ]);
  if (postError) throw new Error(`service public view failed: ${postError.message}`);
  if (snapshotError) throw new Error(`service snapshot failed: ${snapshotError.message}`);

  const { data: refreshResult, error: refreshError } = await service.rpc('refresh_blog_public_snapshots_v3');
  if (refreshError) throw new Error(`service snapshot RPC failed: ${refreshError.message}`);

  const { error: anonymousError } = await anonymous.from('public_blog_content_creatives')
    .select('id')
    .limit(1);
  const { error: anonymousRefreshError } = await anonymous.rpc('refresh_blog_public_snapshots_v3');
  const passed = posts?.length === 1
    && posts[0]?.slug === 'staging-osaka-hotel-areas'
    && posts[0]?.public_eligibility_reason === 'eligible_information_v2'
    && snapshots?.length === 1
    && Array.isArray(refreshResult)
    && anonymousError?.code === '42501'
    && anonymousRefreshError?.code === '42501';

  const report = {
    targetProjectRef: target.projectRef,
    mutatesStagingSnapshots: true,
    passed,
    publicEligibleFixtures: posts?.length ?? 0,
    currentSnapshots: snapshots?.length ?? 0,
    snapshotRefreshResult: refreshResult,
    anonymousViewAccessDenied: anonymousError?.code === '42501',
    anonymousSnapshotRefreshDenied: anonymousRefreshError?.code === '42501',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`blog staging runtime verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
