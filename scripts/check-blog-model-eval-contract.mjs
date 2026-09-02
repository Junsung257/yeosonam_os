import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const policy = JSON.parse(read('config/blog-model-evaluation-policy.json'));
const external = JSON.parse(read('config/external-tool-adoption-policy.json'));
const evaluatorPackage = JSON.parse(read('tools/harness-evals/package.json'));
const evaluatorLock = JSON.parse(read('tools/harness-evals/package-lock.json'));
const providerSource = read('scripts/lib/blog-model-eval/provider.mjs');
const runner = read('scripts/run-blog-model-eval.mjs');
const promoter = read('scripts/promote-blog-model-eval-summary.mjs');
const yaml = read('promptfoo/blog-editorial-live.yaml');
const fixturePath = resolve(root, policy.fixture.path);
const assertionPath = resolve(root, policy.fixture.assertionPath);
const fixtureHash = createHash('sha256').update(readFileSync(fixturePath)).digest('hex');
const assertionHash = createHash('sha256').update(readFileSync(assertionPath)).digest('hex');
const fixtures = require(fixturePath);
const offlineAssertion = require(assertionPath);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(policy.promptfoo.version === '0.122.2', 'Promptfoo policy must remain pinned to 0.122.2');
requireValue(evaluatorPackage.devDependencies.promptfoo === '0.122.2', 'Promptfoo package must remain pinned to 0.122.2');
requireValue(evaluatorLock.packages[''].devDependencies.promptfoo === '0.122.2', 'Promptfoo lock root must remain pinned');
requireValue(evaluatorLock.packages['node_modules/promptfoo'].version === '0.122.2', 'Promptfoo resolved package must remain pinned');
requireValue(fixtureHash === policy.fixture.sha256 && fixtures.length === 33, 'Frozen V5 fixture hash or count drifted');
requireValue(assertionHash === policy.fixture.assertionSha256, 'Frozen V5 assertion hash drifted');
const offlinePasses = fixtures.filter((fixture) => offlineAssertion(fixture.vars.candidate_answer, { vars: fixture.vars }).pass).length;
requireValue(offlinePasses === 33, `Frozen V5 offline assertion must remain 33/33, observed ${offlinePasses}/33`);
requireValue(policy.execution.smokeCases === 3 && policy.execution.fullCases === 33 && policy.execution.fullRuns === 2, 'Evaluation stages differ from policy');
requireValue(policy.execution.maxConcurrency === 1 && policy.execution.timeoutMs > 0 && policy.execution.maxRetries === 2, 'Concurrency, timeout, or retry boundary drifted');
requireValue(policy.execution.retryStatusCodes.length === 1 && policy.execution.retryStatusCodes[0] === 429, 'Only bounded 429 retries are allowed');
requireValue(yaml.includes('maxConcurrency: 1') && yaml.includes('load-blog-editorial-live-tests.cjs'), 'Promptfoo config must be serial and reuse the V5 fixtures');
requireValue(providerSource.includes('response.status === 429') && providerSource.includes('attempt <= execution.maxRetries'), 'Provider must implement bounded 429 backoff');
requireValue(runner.includes('--confirm-cost') && runner.includes('buildBlogModelEvalChildEnv'), 'Live runner must require cost confirmation and a minimal child environment');
requireValue(promoter.includes('BLOG_MODEL_EVAL_RUN_DIR_OUTSIDE_PRIVATE_ROOT') && promoter.includes('evals/blog-model/latest-summary.json'), 'Summary promotion must be limited to the private run root and aggregate-only tracked output');
requireValue(!/supabase|system_ai_policies|ai-provider-switch/iu.test(`${providerSource}\n${runner}`), 'Evaluation code must not access DB or production provider switching');
requireValue(policy.providers.some((provider) => provider.role === 'champion' && provider.id === 'deepseek-champion'), 'DeepSeek champion is missing');
requireValue(policy.providers.filter((provider) => provider.role === 'challenger').length === 2, 'Exactly two challengers are required');
for (const provider of policy.providers) {
  const model = provider.model.toLowerCase();
  requireValue(!policy.forbiddenModelPatterns.some((pattern) => model.includes(pattern.toLowerCase())), `Dynamic/free model forbidden: ${provider.id}`);
}
requireValue(policy.decision.productionProviderMutationAllowed === false && policy.decision.databaseEnumMutationAllowed === false, 'Evaluation must not mutate production policy or DB types');
requireValue(external.precedence[0] === 'repository SSOT', 'Repository SSOT must outrank external tools');
const zapier = external.tools.find((tool) => tool.id === 'zapier-mcp');
requireValue(zapier?.economics?.freePlanTasksPerMonth === 100 && zapier?.economics?.tasksPerSuccessfulMcpCall === 2, 'Zapier economics must be explicit');
requireValue(['booking', 'payment', 'deposit', 'product publication', 'PII', 'external publication'].every((scope) => zapier.forbidden.includes(scope)), 'Zapier forbidden scopes drifted');
requireValue(external.tools.find((tool) => tool.id === 'headcount-bulk-skills')?.status === 'bulk_install_forbidden', 'Headcount bulk installation must remain forbidden');
console.log(`Blog model evaluation contract passed; frozen offline fixtures ${offlinePasses}/33.`);
