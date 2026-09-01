import { createHash } from 'node:crypto';
import {
  BLOG_KOREAN_SEMANTIC_VERSION_V4,
  buildKoreanSemanticGoldenFixturesV4,
  evaluateKoreanSemanticFixturesV4,
} from '../src/lib/blog-korean-semantic-v4';
import { readBlogDeploymentCommitShaV4 } from '../src/lib/blog-autopilot-v4-contract';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../src/lib/supabase';

async function main() {
const fixtures = buildKoreanSemanticGoldenFixturesV4();
const result = evaluateKoreanSemanticFixturesV4(fixtures);
const corpusHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
const payload = {
  adapter: 'korean_semantic',
  adapter_version: BLOG_KOREAN_SEMANTIC_VERSION_V4,
  benchmark_version: 'blog-korean-semantic-golden-v4.0.0',
  corpus_hash: corpusHash,
  sample_size: result.sampleSize,
  extraction_success_count: null,
  factual_fidelity_count: null,
  precision: result.precision,
  recall: result.recall,
  ssrf_security_passed: null,
  latency_p95_ms: null,
  passed: result.passed,
  metrics: {
    threshold: 0.88,
    false_positives: result.rows.filter((row) => row.predicted && !row.duplicate).map((row) => row.id),
    false_negatives: result.rows.filter((row) => !row.predicted && row.duplicate).map((row) => row.id),
  },
  deployment_commit_sha: readBlogDeploymentCommitShaV4(),
};

if (process.argv.includes('--apply')) {
  if (!isSupabaseAdminConfigured) throw new Error('blog_semantic_benchmark_supabase_admin_missing');
  if (!result.passed) throw new Error('blog_semantic_benchmark_failed');
  const { error } = await supabaseAdmin.from('blog_adapter_benchmarks').insert(payload);
  if (error && error.code !== '23505') throw new Error(`blog_semantic_benchmark_insert_failed:${error.message}`);
}

console.log(JSON.stringify({ ...payload, applied: process.argv.includes('--apply') }, null, 2));
if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
