/**
 * @case ERR-BLOG-indexing-worker-external-cron (2026-07-01)
 * @summary Indexing outbox processing must have an external cron path that is
 * independent of publisher success.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-indexing-worker-external-cron: GitHub fallback schedules independent indexing worker runs', () => {
  const workflow = read('.github', 'workflows', 'blog-external-cron.yml');

  assert.match(workflow, /cron: '27 3,6,9,12 \* \* \*'/);
  assert.match(workflow, /- blog-indexing-worker/);
  assert.match(workflow, /"27 3,6,9,12 \* \* \*"\)\s+endpoint="blog-indexing-worker"/);
});

test('ERR-BLOG-indexing-worker-external-cron: workflow fails on indexing worker reported failures', () => {
  const workflow = read('.github', 'workflows', 'blog-external-cron.yml');

  assert.match(workflow, /endpoint === 'blog-indexing-worker'/);
  assert.match(workflow, /const failed = Number\(data\?\.failed \?\? 0\)/);
  assert.match(workflow, /Array\.isArray\(data\?\.errors\)/);
  assert.match(workflow, /failed > 0 \|\| errors\.length > 0/);
});

test('ERR-BLOG-indexing-worker-external-cron: docs require indexing to be decoupled from publisher health', () => {
  const contract = read('docs', 'blog-autopublish-contract.md');
  const runbook = read('docs', 'blog-ops-runbook.md');

  assert.match(contract, /Indexing must not depend on a successful publish run/);
  assert.match(runbook, /drain pending indexing jobs even when publisher quality gates fail/);
  assert.match(runbook, /`processed=0` is allowed/);
});
