#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const strict = process.argv.includes('--strict');
const failures = [];

function readText(file) {
  return readFileSync(file, 'utf8');
}

function requireFile(file) {
  if (!existsSync(file)) {
    failures.push(`Missing required file: ${file}`);
    return '';
  }
  return readText(file);
}

function requireIncludes(file, expected) {
  const text = requireFile(file);
  if (!text) return;
  for (const value of expected) {
    if (!text.includes(value)) {
      failures.push(`${file} must mention "${value}"`);
    }
  }
}

requireIncludes('AGENTS.md', [
  'docs/agent-workflow-current-ssot.md',
  'docs/ai-agent-doc-automation.md',
]);

requireIncludes('.claude/CLAUDE.md', [
  'docs/agent-workflow-current-ssot.md',
  'Superpowers',
]);

requireIncludes('docs/ai-agent-doc-automation.md', [
  'docs/agent-workflow-current-ssot.md',
  'docs/specs/YYYYMMDD-short-slug/',
]);

requireIncludes('docs/agent-workflow-current-ssot.md', [
  'Explore',
  'Spec/Plan',
  'Evidence Review',
  'Tier 0',
  'Tier 1',
  'Tier 2',
  'Tier 3',
  'Hard Stops',
]);

for (const file of ['spec.md', 'plan.md', 'tasks.md', 'verification.md']) {
  requireIncludes(`docs/specs/_template/${file}`, ['<short name>']);
}

const specsDir = 'docs/specs';
if (existsSync(specsDir)) {
  for (const entry of readdirSync(specsDir)) {
    if (entry === '_template') continue;
    if (!/^\d{8}-[a-z0-9][a-z0-9-]*$/i.test(entry)) continue;

    const fullPath = join(specsDir, entry);
    if (!statSync(fullPath).isDirectory()) continue;

    for (const file of ['spec.md', 'plan.md', 'tasks.md', 'verification.md']) {
      const target = join(fullPath, file);
      if (!existsSync(target)) {
        failures.push(`${entry} is missing ${file}`);
      }
    }
  }
}

if (failures.length > 0) {
  const message = [
    'Agent workflow contract check found issues:',
    ...failures.map((failure) => `- ${failure}`),
  ].join('\n');

  if (strict) {
    console.error(message);
    process.exit(1);
  }

  console.warn(message);
  process.exit(0);
}

console.log('Agent workflow contract check passed.');
