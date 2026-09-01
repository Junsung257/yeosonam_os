import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('durable-document check fails closed in CI without an explicit base SHA', () => {
  const root = resolve(import.meta.dirname, '..', '..', '..');
  const result = spawnSync(process.execPath, ['scripts/check-doc-automation-contract.mjs', '--strict'], {
    cwd: root,
    env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true', DOC_AUTOMATION_BASE_SHA: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /DOC_AUTOMATION_BASE_SHA/u);
});
