import fs from 'node:fs';

const path = '.github/workflows/blog-v4-staging-longrun.yml';
const content = fs.readFileSync(path, 'utf8');
const required = [
  'workflow_dispatch:',
  'push:',
  'codex/blog-v4-integration-preview',
  '[run-blog-v4-longrun]',
  'preflight:',
  'schema-discovery:',
  'migration-replay:',
  'capture-schema:',
  'sanitize-baseline:',
  'baseline-rehearsal:',
  'rebuild-staging:',
  'apply-staging:',
  'security-verify:',
  'seed-staging:',
  'preview-deploy:',
  'draft-canary:',
  'artifact-export:',
  'verify:blog-v4-required-objects',
  'verify:blog-v4-staging-security',
  'resolve:blog-v4-schema-read-credentials',
  'environment: blog-staging-schema-read',
  'BLOG_SCHEMA_READ_APPROVED',
  'productionDataCopied": false',
  'productionWrites": 0',
  'publications": 0',
  'indexingSideEffects": 0',
  'checkpoint:blog-v4-longrun',
];
const missing = required.filter((token) => !content.includes(token));
const forbidden = [
  '--with-data',
  'vercel promote',
  'BLOG_AUTOPUBLISH_MODE=live',
  'BLOG_GENERATION_CRON_ENABLED=true',
  'indexnow',
  'gsc submission',
];
const presentForbidden = forbidden.filter((token) => content.toLowerCase().includes(token.toLowerCase()));
const hasPushTrigger = /^\s+push:\s*$/m.test(content);
const hasSentinelPushGuard = content.includes('[run-blog-v4-longrun]') && content.includes('GITHUB_EVENT_NAME') && content.includes('GITHUB_REF');
const timeoutValues = [...content.matchAll(/timeout-minutes:\s*(\d+)/g)].map((match) => Number(match[1]));
const invalidTimeout = timeoutValues.some((value) => value > 360 || value < 1);
if (missing.length || presentForbidden.length || !hasSentinelPushGuard || invalidTimeout) {
  console.error(JSON.stringify({ missing, presentForbidden, hasPushTrigger, hasSentinelPushGuard, timeoutValues, invalidTimeout }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  workflow: path,
  workflowDispatchAndSentinelPushOnly: true,
  protectedSchemaEnvironment: true,
  productionDataClone: false,
  forbiddenActions: 'absent',
  timeoutsWithinSixHours: true,
}, null, 2));
