import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesSurfacePattern, validateAgentChanges, validateSurfaceMap } from './agent-surfaces.mjs';

function map(agents) {
  return { schemaVersion: 1, taskId: 'test-task', agents };
}

test('surface matcher supports repository globs', () => {
  assert.equal(matchesSurfacePattern('src/lib/a.ts', 'src/lib/**'), true);
  assert.equal(matchesSurfacePattern('src/app/a.ts', 'src/lib/**'), false);
  assert.equal(matchesSurfacePattern('package.json', 'package.json'), true);
});

test('surface map rejects overlapping owners and reviewer writes', () => {
  const failures = validateSurfaceMap(map([
    { id: 'writer', role: 'implementation', write: ['src/**'], readOnly: [], forbidden: [] },
    { id: 'reviewer', role: 'security-review', write: ['src/lib/**'], readOnly: [], forbidden: [] },
  ]));
  assert.ok(failures.some((failure) => failure.includes('review-only')));
  assert.ok(failures.some((failure) => failure.includes('overlap')));
});

test('changed paths must remain inside write surfaces', () => {
  const surfaceMap = map([
    { id: 'worker', role: 'implementation', write: ['src/lib/**'], readOnly: ['docs/**'], forbidden: ['supabase/**'] },
  ]);
  const failures = validateAgentChanges(surfaceMap, 'worker', [
    'src/lib/ok.ts',
    'docs/no.md',
    'supabase/migrations/no.sql',
    'package.json',
  ]);
  assert.equal(failures.length, 3);
  assert.ok(failures.some((failure) => failure.includes('read-only')));
  assert.ok(failures.some((failure) => failure.includes('forbidden')));
  assert.ok(failures.some((failure) => failure.includes('outside write surface')));
});
