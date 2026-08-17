import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { isSupabaseConfigured } from '@/lib/supabase';
import { resolveRegistrationTermsPolicy } from '@/lib/standard-terms';
import { assertApprovedBenchmarkCancellationPolicy } from '@/lib/product-registration-v6/benchmark-policy';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  if (!isSupabaseConfigured) throw new Error('BENCHMARK_POLICY_SUPABASE_CONFIGURATION_REQUIRED');
  const outputPath = resolve(arg(
    '--out',
    'C:/Users/admin/Downloads/코덱스테스트/product-registration-approved-cancellation-policy.json',
  )!);
  const snapshot = await resolveRegistrationTermsPolicy({}, 'mobile');
  const latestStart = snapshot.template_refs
    .map(template => Date.parse(template.starts_at))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  const approvedPolicy = {
    ...snapshot,
    approval: {
      source: 'operational_current_template' as const,
      approvedAt: latestStart ? new Date(latestStart).toISOString() : new Date().toISOString(),
      approvedBy: 'operational-terms-registry',
    },
  };
  assertApprovedBenchmarkCancellationPolicy(approvedPolicy);
  const artifact = {
    schemaVersion: 'product-registration-approved-cancellation-policy-1',
    privateArtifact: true,
    generatedAt: new Date().toISOString(),
    policy: approvedPolicy,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    policyHash: approvedPolicy.policy_hash,
    templateCount: approvedPolicy.template_refs.length,
    noticeCount: approvedPolicy.notices.length,
    hasCancellationPolicy: approvedPolicy.has_cancellation_policy,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
