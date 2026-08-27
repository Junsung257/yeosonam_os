import {
  assertBlogStagingRuntimeTarget,
  verifyBlogStagingBranchMetadata,
} from './lib/blog-staging-runtime-target-v3';

const environment = {
  ...process.env,
  BLOG_STAGING_RUNTIME_VERIFY_CONFIRM: 'STAGING_SNAPSHOT_REFRESH_ALLOWED',
  SUPABASE_URL: process.env.BLOG_STAGING_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.BLOG_STAGING_SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY: process.env.BLOG_STAGING_SUPABASE_ANON_KEY,
  SUPABASE_ACCESS_TOKEN: process.env.BLOG_STAGING_SUPABASE_ACCESS_TOKEN,
};

async function main(): Promise<void> {
  const target = assertBlogStagingRuntimeTarget(environment);
  const branchMetadata = await verifyBlogStagingBranchMetadata(target, environment);

  process.stdout.write(`${JSON.stringify({
    branchMetadata,
    projectRef: target.projectRef,
    productionProjectRef: target.productionProjectRef,
    url: target.url,
    dataApiCalls: 0,
    snapshotMutations: 0,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `blog V4 Preview target verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
