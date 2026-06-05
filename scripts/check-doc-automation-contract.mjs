#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const strict = process.argv.includes('--strict');

function gitLines(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' })
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
  ]);

  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
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
    includes: ['docs/ai-agent-doc-automation.md', 'docs/product-registration-current-ssot.md'],
  },
  {
    file: '.claude/CLAUDE.md',
    includes: ['Documentation Automation', 'Product Registration SSOT'],
  },
  {
    file: 'docs/ai-agent-doc-automation.md',
    includes: ['Automatic Doc Decision Matrix', 'Agent Closeout Contract'],
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

if (productRegistrationChange && !durableArtifactChange) {
  failures.push(
    'Product-registration behavior changed without a durable artifact. Add a fixture/test, SSOT update, error-registry entry, or audit note.'
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
