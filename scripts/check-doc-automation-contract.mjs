#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const strict = process.argv.includes('--strict');

function gitLines(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function changedFiles() {
  const files = new Set([
    ...gitLines('diff --name-only'),
    ...gitLines('diff --cached --name-only'),
    ...gitLines('ls-files --others --exclude-standard'),
  ]);

  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    if (/^[A-Za-z0-9._/-]+$/.test(baseRef)) {
      gitLines(`fetch --no-tags origin ${baseRef}:refs/remotes/origin/${baseRef}`);
    }
    for (const file of gitLines(`diff --name-only origin/${baseRef}...HEAD`)) {
      files.add(file);
    }
    for (const file of gitLines(`diff --name-only ${baseRef}...HEAD`)) {
      files.add(file);
    }
  }

  return files;
}

const changed = new Set([
  ...changedFiles(),
]);

const requiredAnchors = [
  {
    file: 'AGENTS.md',
    includes: [
      'docs/ai-agent-doc-automation.md',
      'docs/product-registration-current-ssot.md',
      'docs/blog-autopublish-contract.md',
      'docs/affiliate-current-ssot.md',
      'docs/settlement-current-ssot.md',
      'docs/marketing-current-ssot.md',
      'docs/ai-ops-current-ssot.md',
    ],
  },
  {
    file: '.claude/CLAUDE.md',
    includes: [
      'Documentation Automation',
      'Product Registration SSOT',
      'docs/blog-autopublish-contract.md',
      'docs/affiliate-current-ssot.md',
      'docs/settlement-current-ssot.md',
      'docs/marketing-current-ssot.md',
      'docs/ai-ops-current-ssot.md',
    ],
  },
  {
    file: 'docs/ai-agent-doc-automation.md',
    includes: ['Automatic Doc Decision Matrix', 'Agent Closeout Contract'],
  },
  {
    file: 'docs/blog-autopublish-contract.md',
    includes: ['Required Pre-Publish Pipeline', 'Blocking Rules', 'Publishing and indexing must be treated as separate responsibilities'],
  },
  {
    file: 'docs/affiliate-current-ssot.md',
    includes: ['Required Invariants', 'Publish And Payout Boundary', 'Durable Artifact Rule'],
  },
  {
    file: 'docs/settlement-current-ssot.md',
    includes: ['Required Invariants', 'State Boundary', 'Durable Artifact Rule'],
  },
  {
    file: 'docs/marketing-current-ssot.md',
    includes: ['Required Invariants', 'External Write Boundary', 'Durable Artifact Rule'],
  },
  {
    file: 'docs/ai-ops-current-ssot.md',
    includes: ['Required Invariants', 'Provider And Prompt Boundary', 'Durable Artifact Rule'],
  },
  {
    file: 'docs/audits/README.md',
    includes: ['Audit Archive Index', 'not the current operating playbook', '--glob "!docs/audits/**"'],
  },
  {
    file: 'docs/product-registration-current-ssot.md',
    includes: ['Document Hierarchy', 'Price Success Definition'],
  },
  {
    file: 'db/error-registry.md',
    includes: ['ACTIVE CHECKLIST'],
  },
];

const failures = [];

for (const anchor of requiredAnchors) {
  if (!existsSync(anchor.file)) {
    failures.push(`Missing required doc anchor: ${anchor.file}`);
    continue;
  }

  const text = readFileSync(anchor.file, 'utf8');
  for (const expected of anchor.includes) {
    if (!text.includes(expected)) {
      failures.push(`${anchor.file} must mention "${expected}"`);
    }
  }
}

const productRegistrationChange = [...changed].some((file) =>
  [
    'src/app/api/upload/',
    'src/lib/product-registration/',
    'src/lib/parser/deterministic/price-ir/',
    'scripts/audit-product-mobile-landing-readiness.mjs',
    'src/app/packages/[id]/',
  ].some((prefix) => file.startsWith(prefix) || file === prefix)
);

function changedAny(prefixes) {
  return [...changed].some((file) =>
    prefixes.some((prefix) => file.startsWith(prefix) || file === prefix)
  );
}

const blogAutomationChange = [...changed].some((file) =>
  [
    'src/app/api/cron/blog-publisher/',
    'src/app/api/cron/blog-scheduler/',
    'src/app/api/cron/blog-daily-summary/',
    'src/app/api/cron/blog-regenerate-zero-click/',
    'src/app/api/blog/',
    'src/app/blog/',
    'src/lib/blog-',
    'src/lib/serp-analyzer.ts',
    'src/lib/indexing.ts',
    'scripts/audit-blog-',
    'scripts/backfill-blog-quality.ts',
  ].some((prefix) => file.startsWith(prefix) || file === prefix)
);

const affiliateChange = changedAny([
  'src/lib/affiliate',
  'src/lib/affiliate-',
  'src/lib/db/affiliate.ts',
  'src/app/affiliate/',
  'src/app/influencer/',
  'src/app/api/affiliate/',
  'src/app/api/affiliates/',
  'src/app/api/influencer/',
  'src/app/api/admin/affiliates/',
  'src/app/api/admin/affiliate-',
  'src/app/api/cron/affiliate-',
  'src/components/affiliate/',
]);

const settlementChange = changedAny([
  'src/lib/ledger-',
  'src/lib/payment-',
  'src/lib/settlement-',
  'src/lib/affiliate/settlement-',
  'src/app/api/payments/',
  'src/app/api/settlements/',
  'src/app/api/tenant/settlements',
  'src/app/api/admin/ledger/',
  'src/app/api/cron/ledger-reconcile/',
  'src/app/api/cron/settlement-auto/',
  'src/app/api/cron/payment-',
  'src/app/admin/payments/',
  'src/app/admin/ledger/',
  'src/app/admin/settlements/',
  'src/app/admin/land-settlements/',
  'src/app/tenant/',
]);

const marketingChange = changedAny([
  'src/lib/marketing',
  'src/lib/marketing-pipeline/',
  'src/lib/social-publishing/',
  'src/app/admin/marketing/',
  'src/app/admin/ad-os/',
  'src/app/api/marketing/',
  'src/app/api/admin/marketing/',
  'src/app/api/admin/ad-os/',
  'src/app/api/cron/daily-marketing/',
  'src/app/api/cron/marketing-',
  'scripts/verify-marketing-',
]);

const aiOpsChange = changedAny([
  'src/lib/ai-provider-policy.ts',
  'src/lib/jarvis/',
  'src/app/api/jarvis/',
  'src/app/api/admin/jarvis/',
  'scripts/ai-provider-switch.mjs',
  'scripts/audit-jarvis-',
  'scripts/eval-jarvis-',
  'scripts/verify-jarvis-',
  'db/smoke_jarvis',
]);

const durableArtifactChange = [...changed].some((file) => {
  if (file.includes('.test.')) return true;
  return [
    'docs/product-registration-current-ssot.md',
    'docs/ai-agent-doc-automation.md',
    'db/error-registry.md',
    'docs/audits/',
    'src/lib/product-registration/golden-corpus/',
    'src/lib/product-registration-golden-fixtures.ts',
  ].some((prefix) => file.startsWith(prefix) || file === prefix);
});

const blogDurableArtifactChange = [...changed].some((file) => {
  if (file.includes('.test.')) return true;
  return [
    'docs/blog-autopublish-contract.md',
    'docs/blog-system-runbook.md',
    'docs/blog-ops-runbook.md',
    'docs/blog-search-quality-daily-process.md',
    'docs/errors/blog.md',
    'db/error-registry.md',
    'docs/audits/',
    'tests/regression/cases/ERR-BLOG',
    'tests/regression/fixtures/ERR-BLOG',
  ].some((prefix) => file.startsWith(prefix) || file === prefix);
});

const affiliateDurableArtifactChange = changedAny([
  'docs/affiliate-current-ssot.md',
  'docs/affiliate-attribution.md',
  'docs/errors/affiliate.md',
  'db/error-registry.md',
  'docs/audits/',
  'tests/regression/cases/ERR-AFF',
  'tests/regression/fixtures/ERR-AFF',
]) || [...changed].some((file) => file.includes('.test.'));

const settlementDurableArtifactChange = changedAny([
  'docs/settlement-current-ssot.md',
  'docs/errors/settlement.md',
  'db/error-registry.md',
  'docs/audits/',
  'tests/regression/cases/ERR-LEDGER',
  'tests/regression/fixtures/ERR-LEDGER',
  'tests/regression/cases/ERR-SETTLEMENT',
  'tests/regression/fixtures/ERR-SETTLEMENT',
]) || [...changed].some((file) => file.includes('.test.'));

const marketingDurableArtifactChange = changedAny([
  'docs/marketing-current-ssot.md',
  'docs/errors/marketing.md',
  'db/error-registry.md',
  'docs/audits/',
  'tests/regression/cases/ERR-MARKETING',
  'tests/regression/fixtures/ERR-MARKETING',
  'tests/regression/cases/ERR-AD-OS',
  'tests/regression/fixtures/ERR-AD-OS',
]) || [...changed].some((file) => file.includes('.test.'));

const aiOpsDurableArtifactChange = changedAny([
  'docs/ai-ops-current-ssot.md',
  'docs/ai-policy-operations.md',
  'docs/jarvis-orchestration.md',
  'docs/jarvis-rag-audit-runbook.md',
  'docs/jarvis-readiness-gate.md',
  'docs/errors/ai-ops.md',
  'db/error-registry.md',
  'docs/audits/',
  'tests/regression/cases/ERR-AI',
  'tests/regression/fixtures/ERR-AI',
  'tests/regression/cases/ERR-JARVIS',
  'tests/regression/fixtures/ERR-JARVIS',
]) || [...changed].some((file) => file.includes('.test.'));

if (productRegistrationChange && !durableArtifactChange) {
  failures.push(
    'Product-registration behavior changed without a durable artifact. Add a fixture/test, SSOT update, error-registry entry, or audit note.'
  );
}

if (blogAutomationChange && !blogDurableArtifactChange) {
  failures.push(
    'Blog automation/rendering/publish behavior changed without a durable artifact. Add a regression test, blog SSOT/runbook update, blog error-registry entry, or audit note.'
  );
}

if (affiliateChange && !affiliateDurableArtifactChange) {
  failures.push(
    'Affiliate attribution/referral/commission behavior changed without a durable artifact. Add a test, affiliate SSOT update, affiliate error-registry entry, or audit note.'
  );
}

if (settlementChange && !settlementDurableArtifactChange) {
  failures.push(
    'Settlement/payment/ledger behavior changed without a durable artifact. Add a test, settlement SSOT update, settlement error-registry entry, or audit note.'
  );
}

if (marketingChange && !marketingDurableArtifactChange) {
  failures.push(
    'Marketing automation/external-publish behavior changed without a durable artifact. Add a test, marketing SSOT update, marketing error-registry entry, or audit note.'
  );
}

if (aiOpsChange && !aiOpsDurableArtifactChange) {
  failures.push(
    'AI/Jarvis/RAG/provider behavior changed without a durable artifact. Add an eval/test, AI Ops SSOT update, AI error-registry entry, or audit note.'
  );
}

if (failures.length > 0) {
  const message = [
    'Documentation automation contract check found issues:',
    ...failures.map((failure) => `- ${failure}`),
  ].join('\n');

  if (strict) {
    console.error(message);
    process.exit(1);
  }

  console.warn(message);
  process.exit(0);
}

console.log('Documentation automation contract check passed.');
