import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runDir = argument('--run-dir');
const output = argument('--output');
const confirmation = argument('--confirm');
if (!runDir || !output || confirmation !== 'COMMIT_AGGREGATE_ONLY') {
  console.error('Usage: node scripts/promote-blog-model-eval-summary.mjs --run-dir <private-run-dir> --output evals/blog-model/latest-summary.json --confirm COMMIT_AGGREGATE_ONLY');
  process.exit(2);
}
const privateRoot = resolve(root, 'artifacts/private/blog-model-eval');
const resolvedRunDir = resolve(runDir);
const relativeRunDir = relative(privateRoot, resolvedRunDir);
if (relativeRunDir.startsWith('..') || isAbsolute(relativeRunDir)) throw new Error('BLOG_MODEL_EVAL_RUN_DIR_OUTSIDE_PRIVATE_ROOT');
const allowedOutput = resolve(root, 'evals/blog-model/latest-summary.json');
if (resolve(output) !== allowedOutput) throw new Error('BLOG_MODEL_EVAL_SUMMARY_OUTPUT_PATH_FORBIDDEN');
const sourcePath = resolve(resolvedRunDir, 'commit-safe-summary.json');
if (!existsSync(sourcePath)) throw new Error('BLOG_MODEL_EVAL_COMMIT_SAFE_SUMMARY_MISSING');
const summary = JSON.parse(readFileSync(sourcePath, 'utf8'));
const serialized = JSON.stringify(summary);
if (/candidate_answer|(?:raw|model)_output|api[_-]?key|authorization/iu.test(serialized)) {
  throw new Error('BLOG_MODEL_EVAL_SUMMARY_CONTAINS_RAW_OR_SECRET_FIELDS');
}
if (summary?.decision?.productionProviderMutationAllowed !== false || summary?.decision?.databaseEnumMutationAllowed !== false) {
  throw new Error('BLOG_MODEL_EVAL_SUMMARY_MUTATION_BOUNDARY_INVALID');
}
writeFileSync(allowedOutput, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote aggregate-only model evaluation summary: ${allowedOutput}`);
