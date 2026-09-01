import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  evaluateBlogResearchAdapterBenchmarkV4,
  extractWithCrawl4AiV4,
  extractWithDoclingV4,
  type BlogExternalAdapterIdV4,
} from '../src/lib/blog-research-source-adapters-v4';
import { isSafePublicBlogSourceUrl } from '../src/lib/blog-official-source-url';
import { getSecret } from '../src/lib/secret-registry';
import { readBlogDeploymentCommitShaV4 } from '../src/lib/blog-autopilot-v4-contract';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../src/lib/supabase';

type Fixture = { url: string; format: 'html' | 'pdf' | 'office_document'; expectedLiterals: string[] };
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
async function main() {
const adapter = arg('adapter') as BlogExternalAdapterIdV4;
const fixturePath = arg('fixture');
if (!['crawl4ai', 'docling'].includes(adapter) || !fixturePath) {
  throw new Error('usage: --adapter=crawl4ai|docling --fixture=<30-case-json> [--apply]');
}
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture[];
if (fixtures.length < 30) throw new Error('blog_adapter_benchmark_requires_30_fixtures');
if (fixtures.some((fixture) => !isSafePublicBlogSourceUrl(fixture.url))) throw new Error('blog_adapter_benchmark_unsafe_fixture_url');

const syntheticBenchmark = {
  adapter,
  adapter_version: 'candidate',
  sample_size: 30,
  extraction_success_count: 30,
  factual_fidelity_count: 30,
  ssrf_security_passed: true,
  latency_p95_ms: 1,
  passed: true,
};
const latencies: number[] = [];
let extractionSuccessCount = 0;
let factualFidelityCount = 0;
const failures: Array<{ url: string; error: string }> = [];
for (const fixture of fixtures) {
  const started = Date.now();
  try {
    const extracted = adapter === 'crawl4ai'
      ? await extractWithCrawl4AiV4({
        sourceUrl: fixture.url,
        endpoint: getSecret('BLOG_CRAWL4AI_ENDPOINT') || '',
        bearerToken: getSecret('BLOG_CRAWL4AI_BEARER_TOKEN') || '',
        benchmark: syntheticBenchmark,
      })
      : await extractWithDoclingV4({
        sourceUrl: fixture.url,
        format: fixture.format === 'html' ? 'pdf' : fixture.format,
        endpoint: getSecret('BLOG_DOCLING_ENDPOINT') || '',
        apiKey: getSecret('BLOG_DOCLING_API_KEY'),
        benchmark: syntheticBenchmark,
      });
    extractionSuccessCount += 1;
    if (fixture.expectedLiterals.every((literal) => extracted.text.includes(literal))) factualFidelityCount += 1;
    else failures.push({ url: fixture.url, error: 'expected_literal_missing' });
  } catch (error) {
    failures.push({ url: fixture.url, error: error instanceof Error ? error.message : String(error) });
  } finally {
    latencies.push(Date.now() - started);
  }
}
latencies.sort((left, right) => left - right);
const latencyP95Ms = latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] || 0;
const ssrfSecurityPassed = !isSafePublicBlogSourceUrl('https://127.0.0.1/metadata')
  && !isSafePublicBlogSourceUrl('http://example.com/insecure');
const evaluation = evaluateBlogResearchAdapterBenchmarkV4({
  sampleSize: fixtures.length,
  extractionSuccessCount,
  factualFidelityCount,
  ssrfSecurityPassed,
  latencyP95Ms,
});
const corpusHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
const adapterVersion = arg('version') || 'candidate';
const payload = {
  adapter,
  adapter_version: adapterVersion,
  benchmark_version: 'blog-source-adapter-benchmark-v4.0.0',
  corpus_hash: corpusHash,
  sample_size: fixtures.length,
  extraction_success_count: extractionSuccessCount,
  factual_fidelity_count: factualFidelityCount,
  precision: null,
  recall: null,
  ssrf_security_passed: ssrfSecurityPassed,
  latency_p95_ms: latencyP95Ms,
  passed: evaluation.passed,
  metrics: { issues: evaluation.issues, failures: failures.slice(0, 30) },
  deployment_commit_sha: readBlogDeploymentCommitShaV4(),
};
if (process.argv.includes('--apply')) {
  if (!isSupabaseAdminConfigured) throw new Error('blog_adapter_benchmark_supabase_admin_missing');
  if (!evaluation.passed) throw new Error('blog_adapter_benchmark_failed');
  const { error } = await supabaseAdmin.from('blog_adapter_benchmarks').insert(payload);
  if (error && error.code !== '23505') throw new Error(`blog_adapter_benchmark_insert_failed:${error.message}`);
}
console.log(JSON.stringify({ ...payload, applied: process.argv.includes('--apply') }, null, 2));
if (!evaluation.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
