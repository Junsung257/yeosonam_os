import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExternalSkillSources } from '../../check-external-skill-sources.mjs';

const base = {
  schemaVersion: 1,
  sources: [{
    sourceId: 'catalog',
    sourceUrl: 'https://github.com/example/catalog',
    immutableRevision: 'a'.repeat(40),
    sourcePath: 'skills/example/SKILL.md',
    contentSha256: null,
    license: 'MIT',
    reviewedCapabilities: { commands: [], hooks: [], secretNames: [], networkHosts: [] },
    evalSuite: [],
    status: 'reference_only',
    allowBulkInstall: false,
  }],
};

test('reference-only catalog can be recorded without approving content', () => {
  assert.deepEqual(validateExternalSkillSources(base), []);
});

test('approved skills require an immutable content hash and eval', () => {
  const registry = structuredClone(base);
  registry.sources[0].status = 'approved';
  const failures = validateExternalSkillSources(registry);
  assert.ok(failures.some((failure) => failure.includes('content hash and eval suite')));
});

test('bulk installation and token-shaped data are rejected', () => {
  const registry = structuredClone(base);
  registry.sources[0].allowBulkInstall = true;
  registry.sources[0].notes = `sk-${'x'.repeat(24)}`;
  const failures = validateExternalSkillSources(registry);
  assert.ok(failures.some((failure) => failure.includes('allowBulkInstall')));
  assert.ok(failures.some((failure) => failure.includes('token-shaped')));
});
