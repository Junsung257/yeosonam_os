import { readFileSync } from 'node:fs';

const stagingPath = '.github/workflows/blog-v4-staging-autopilot.yml';
const releasePath = '.github/workflows/blog-v4-pr-release-train.yml';

function read(path) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function assertContains(source, value, label) {
  if (!source.includes(value)) throw new Error(`blog_v4_workflow_contract_missing:${label}`);
}

function assertNotContains(source, value, label) {
  if (source.toLowerCase().includes(value.toLowerCase())) {
    throw new Error(`blog_v4_workflow_contract_forbidden:${label}`);
  }
}

const staging = read(stagingPath);
const release = read(releasePath);

assertContains(staging, '  push:\n    branches:\n      - codex/blog-v4-integration-preview', 'staging_push_branch');
assertContains(staging, '  workflow_dispatch:', 'staging_manual_dispatch');
assertContains(staging, '[run-blog-v4-canary]', 'staging_sentinel');
assertContains(staging, 'environment: blog-staging-bootstrap', 'staging_environment');
assertContains(staging, 'bootstrap-blocker.json', 'staging_blocker_artifact');
assertContains(staging, 'productionWrites: 0', 'staging_production_write_guard');
assertContains(staging, 'github.ref == \'refs/heads/main\'', 'staging_manual_main_guard');
assertContains(staging, 'github.ref == \'refs/heads/codex/blog-v4-integration-preview\'', 'staging_manual_integration_guard');
assertContains(staging, 'supabase/staging-baselines/blog-v4-legacy-schema.sql', 'staging_schema_baseline');
assertContains(staging, '--allow-extra=20260819000000', 'staging_schema_baseline_dry_run_allowlist');
assertContains(staging, '--allow-empty', 'staging_replay_empty_dry_run');
assertNotContains(release, 'staging-baselines/blog-v4-legacy-schema.sql', 'release_staging_baseline');

for (const [token, label] of [
  ['--prod', 'vercel_production_flag'],
  ['--with-data', 'supabase_data_clone_flag'],
  ['vercel promote', 'vercel_promote'],
  ['production env', 'production_env'],
  ['production migration', 'production_migration'],
  ['indexnow', 'indexnow_submission'],
  ['gsc submission', 'gsc_submission'],
]) {
  assertNotContains(staging, token, label);
}

assertContains(release, 'types: [closed]', 'release_closed_trigger');
assertContains(release, 'github.event.pull_request.number == 1141', 'release_pr_1141_guard');
assertContains(release, 'github.event.pull_request.merged == true', 'release_merged_guard');
assertContains(release, 'gh pr update-branch "$TARGET_PR" --rebase', 'release_rebase');
assertContains(release, 'gh pr ready "$TARGET_PR"', 'release_draft_release');
assertContains(release, 'autoMerge: false', 'release_no_auto_merge_evidence');

process.stdout.write(JSON.stringify({
  stagingWorkflow: stagingPath,
  releaseWorkflow: releasePath,
  pushSentinel: true,
  manualDispatchTrustedRefs: ['main', 'codex/blog-v4-integration-preview'],
  productionActionTokens: 'absent',
  blockerArtifact: true,
  releaseTrain: true,
}) + '\n');
