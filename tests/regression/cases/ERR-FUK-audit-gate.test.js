/**
 * @case ERR-FUK-audit-gate
 * @summary publish approval and customer search must honor post-register audit status.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-audit-gate: publish gate blocks blocked audits and requires force for warnings', () => {
  const gate = read('src/lib/product-publish-gate.ts');
  const approve = read('src/app/api/packages/[id]/approve/route.ts');

  assert.match(gate, /evaluateProductPublishGate/);
  assert.match(gate, /auditStatus === 'blocked'/);
  assert.match(gate, /auditStatus === 'warnings'/);
  assert.match(gate, /decision: 'force_required'/);
  assert.match(approve, /publishGate\.decision === 'block'/);
  assert.match(approve, /publishGate\.decision === 'force_required' && !force/);
  assert.match(approve, /\{ status: 409 \}/);
});

test('ERR-FUK-audit-gate: blocked packages are filtered out of customer search and QA chat', () => {
  const search = read('src/app/api/packages/search/route.ts');
  const qa = read('src/lib/qa-chat-packages.ts');

  assert.match(search, /audit_status\.is\.null,audit_status\.neq\.blocked/);
  assert.match(qa, /audit_status\.is\.null,audit_status\.neq\.blocked/);
});
