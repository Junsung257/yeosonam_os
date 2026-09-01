import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildBlogModelEvalChildEnv,
  getBlogModelEvalProvider,
  loadBlogModelEvalPolicy,
} from './lib/blog-model-eval/provider.mjs';
import {
  buildCommitSafeSummary,
  sha256File,
  summarizePromptfooOutput,
} from './lib/blog-model-eval/summary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const policy = loadBlogModelEvalPolicy(root);
const policyPath = resolve(root, 'config/blog-model-evaluation-policy.json');
const fixturePath = resolve(root, policy.fixture.path);
const promptPath = resolve(root, 'promptfoo/blog-editorial-live.yaml');
const evaluatorPackagePath = resolve(root, policy.promptfoo.packagePath);
const evaluatorLockPath = resolve(root, policy.promptfoo.lockPath);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function validateStaticInputs() {
  const evaluatorPackage = JSON.parse(readFileSync(evaluatorPackagePath, 'utf8'));
  const evaluatorLock = JSON.parse(readFileSync(evaluatorLockPath, 'utf8'));
  if (evaluatorPackage.devDependencies?.promptfoo !== policy.promptfoo.version) throw new Error('PROMPTFOO_PACKAGE_VERSION_DRIFT');
  if (evaluatorLock.packages?.['']?.devDependencies?.promptfoo !== policy.promptfoo.version) throw new Error('PROMPTFOO_LOCK_ROOT_VERSION_DRIFT');
  if (evaluatorLock.packages?.['node_modules/promptfoo']?.version !== policy.promptfoo.version) throw new Error('PROMPTFOO_LOCK_RESOLVED_VERSION_DRIFT');
  const fixtureHash = sha256File(fixturePath);
  if (fixtureHash !== policy.fixture.sha256) throw new Error(`BLOG_MODEL_EVAL_FIXTURE_HASH_DRIFT:${fixtureHash}`);
  delete require.cache[require.resolve(fixturePath)];
  const fixtures = require(fixturePath);
  if (!Array.isArray(fixtures) || fixtures.length !== policy.fixture.count) throw new Error('BLOG_MODEL_EVAL_FIXTURE_COUNT_INVALID');
  return fixtures;
}

function resolvePromptfooCli() {
  const packagePath = resolve(root, 'tools/harness-evals/node_modules/promptfoo/package.json');
  if (!existsSync(packagePath)) return null;
  const installed = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (installed.version !== policy.promptfoo.version) throw new Error(`PROMPTFOO_INSTALLED_VERSION_DRIFT:${installed.version}`);
  const bin = typeof installed.bin === 'string' ? installed.bin : installed.bin?.promptfoo;
  if (!bin) throw new Error('PROMPTFOO_BIN_NOT_FOUND');
  return resolve(dirname(packagePath), bin);
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

function readRawAggregate(outputPath, expectedCases) {
  if (!existsSync(outputPath)) return { status: 'raw_output_missing', expectedCases, observedCases: 0 };
  try {
    return summarizePromptfooOutput(JSON.parse(readFileSync(outputPath, 'utf8')), expectedCases);
  } catch {
    return { status: 'raw_output_invalid_json', expectedCases, observedCases: 0 };
  }
}

function runPromptfoo({ cli, providerId, phase, runId, runRoot }) {
  const expectedCases = phase === 'smoke' ? policy.execution.smokeCases : policy.execution.fullCases;
  const providerDir = resolve(runRoot, providerId);
  mkdirSync(providerDir, { recursive: true });
  const outputPath = resolve(providerDir, `${phase}-run-${runId}.json`);
  const childHome = resolve(providerDir, '.promptfoo-home');
  mkdirSync(childHome, { recursive: true });
  const env = buildBlogModelEvalChildEnv(process.env, policy, providerId, {
    BLOG_MODEL_EVAL_PHASE: phase,
    BLOG_MODEL_EVAL_RUN_ID: String(runId),
    PROMPTFOO_HOME_DIR: childHome,
  });
  const result = spawnSync(process.execPath, [
    cli,
    'eval',
    '-c', resolve(root, 'promptfoo/blog-editorial-live.yaml'),
    '--no-share', '--no-cache', '--no-write', '--no-progress-bar', '--no-table',
    '--output', outputPath,
  ], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
  });
  const aggregate = readRawAggregate(outputPath, expectedCases);
  const manifest = {
    schemaVersion: 1,
    providerId,
    phase,
    runId,
    processStatus: result.status,
    aggregate,
    rawSha256: existsSync(outputPath) ? sha256File(outputPath) : null,
  };
  writeFileSync(resolve(providerDir, `${phase}-run-${runId}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

let fixtures;
try {
  fixtures = validateStaticInputs();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const requestedProvider = argument('--provider');
const selectedProviders = requestedProvider
  ? [getBlogModelEvalProvider(policy, requestedProvider)]
  : policy.providers;
const cli = resolvePromptfooCli();
if (process.argv.includes('--preflight')) {
  console.log(JSON.stringify({
    status: 'preflight',
    promptfooVersion: policy.promptfoo.version,
    promptfooInstalled: Boolean(cli),
    fixtureCount: fixtures.length,
    fixtureSha256: sha256File(fixturePath),
    providers: selectedProviders.map((provider) => ({
      id: provider.id,
      model: provider.model,
      credentialPresent: Boolean(process.env[provider.apiKeyEnv]),
    })),
    liveCallsMade: 0,
    productionMutationAllowed: false,
  }, null, 2));
  process.exit(0);
}

if (argument('--confirm-cost') !== policy.execution.costConfirmation) {
  console.error(`Live evaluation is cost-bearing. Pass --confirm-cost ${policy.execution.costConfirmation}.`);
  process.exit(2);
}
if (!cli) {
  console.error('Promptfoo is not installed. Run npm run setup:harness-evals, then repeat the explicit live command.');
  process.exit(2);
}
for (const provider of selectedProviders) {
  if (!process.env[provider.apiKeyEnv]) {
    console.error(`Missing credential for ${provider.id}: ${provider.apiKeyEnv}`);
    process.exit(2);
  }
}

const runRoot = resolve(root, policy.execution.rawOutputRoot, safeTimestamp());
mkdirSync(runRoot, { recursive: true });
const manifests = [];
for (const provider of selectedProviders) {
  const smoke = runPromptfoo({ cli, providerId: provider.id, phase: 'smoke', runId: 0, runRoot });
  manifests.push(smoke);
  const providerSmokePassed = smoke.aggregate.status === 'complete' && smoke.aggregate.passed === policy.execution.smokeCases;
  if (providerSmokePassed) {
    for (let runId = 1; runId <= policy.execution.fullRuns; runId += 1) {
      manifests.push(runPromptfoo({ cli, providerId: provider.id, phase: 'full', runId, runRoot }));
    }
  }
}

const summary = buildCommitSafeSummary({
  policyHash: sha256File(policyPath),
  fixtureHash: sha256File(fixturePath),
  promptHash: sha256File(promptPath),
  manifests,
});
writeFileSync(resolve(runRoot, 'commit-safe-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ runRoot, summary }, null, 2));
const operationalFailure = manifests.some((manifest) => manifest.aggregate.status !== 'complete');
process.exit(operationalFailure ? 1 : 0);
