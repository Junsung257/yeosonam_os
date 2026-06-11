/**
 * @case ERR-BLOG-legacy-backfill-preview-vs-write (2026-06-09)
 * @summary Editorial repair preview is not enough; write mode must still run
 * publish quality gates and skip unsafe updates with failed gate evidence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'backfill-blog-quality.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('ERR-BLOG-legacy-backfill-preview-vs-write: dry-run is default and write mode is explicit', () => {
  assert.match(source, /const dryRun = !args\.has\(['"]--write['"]\)/);
  assert.match(source, /if \(!changed \|\| dryRun\) continue/);
  assert.equal(pkg.scripts['backfill:blog-quality'], 'npx tsx scripts/backfill-blog-quality.ts');
  assert.equal(pkg.scripts['backfill:blog-quality:write'], 'npx tsx scripts/backfill-blog-quality.ts --write');
});

test('ERR-BLOG-legacy-backfill-preview-vs-write: every candidate is evaluated before update', () => {
  assert.match(source, /evaluateBlogPublishQuality/);
  assert.match(source, /qualityGatePassed: qaReport\.passed/);
  assert.match(source, /failedGates: qaReport\.qualityGate\.gates/);
  assert.match(source, /qualityGateFailed: auditRows\.filter\(\(row\) => !row\.qualityGatePassed\)\.length/);
});

test('ERR-BLOG-legacy-backfill-preview-vs-write: failed quality gates block DB writes', () => {
  const failedGateCheck = source.indexOf('if (!qaReport.passed)');
  const updatePayload = source.indexOf('quality_gate: qaReport.qualityGate');
  const updateCall = source.lastIndexOf(".from('content_creatives')", updatePayload);

  assert.ok(failedGateCheck > 0, 'write loop must check qaReport.passed');
  assert.ok(updateCall > failedGateCheck, 'content_creatives update must happen after failed-gate check');
  assert.ok(updatePayload > updateCall, 'update must persist quality gate evidence');
});
