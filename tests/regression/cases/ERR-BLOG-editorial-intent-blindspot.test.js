/**
 * @case ERR-BLOG-editorial-intent-blindspot (2026-06-09)
 * @summary Render/SEO/image audits alone are not enough; published posts must
 * pass intent-specific editorial contracts such as weather tables,
 * preparation checklists, itinerary structure, and product/price proof.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-BLOG-editorial-intent-blindspot: package exposes editorial audits', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.scripts['audit:blog-editorial'], 'npx tsx scripts/audit-blog-editorial-quality.ts');
  assert.equal(pkg.scripts['audit:blog-editorial:db'], 'npx tsx scripts/audit-blog-editorial-quality.ts --source=db --strict');
});

test('ERR-BLOG-editorial-intent-blindspot: intent contract is a publish quality gate', () => {
  const qualityGateSource = read('src/lib/blog-quality-gate.ts');
  const publishQualitySource = read('src/lib/blog-publish-quality.ts');

  assert.match(qualityGateSource, /import \{ inspectBlogIntentQuality \} from ['"]\.\/blog-content-intent['"]/);
  assert.match(qualityGateSource, /gate:\s*'intent_quality'/);
  assert.match(qualityGateSource, /function checkIntentQuality/);
  assert.match(qualityGateSource, /gates\.push\(checkIntentQuality\(input\)\)/);
  assert.match(publishQualitySource, /runQualityGates\(\{/);
  assert.match(publishQualitySource, /passed:\s*blogQualityScore\.isPerfect/);
});

test('ERR-BLOG-editorial-intent-blindspot: intent inspector blocks the original blind spots', () => {
  const intentSource = read('src/lib/blog-content-intent.ts');

  assert.match(intentSource, /forbidden_sales_tone/);
  assert.match(intentSource, /missing_required_block/);
  assert.match(intentSource, /weak_list_or_table_shape/);
  assert.match(intentSource, /paragraph_wall/);
  assert.match(intentSource, /weak_reading_design/);
  assert.match(intentSource, /buildBlogIntentPromptContract/);

  assert.match(intentSource, /Weather posts must include monthly weather, clothing, and season\/rain risk blocks\./);
  assert.match(intentSource, /Preparation posts need at least five checklist items\./);
  assert.match(intentSource, /Itinerary posts need day-by-day or time-by-time structure\./);
  assert.match(intentSource, /Required blocks: monthly\/season table, clothing checklist/);
});

test('ERR-BLOG-editorial-intent-blindspot: fleet audit reports intent issues and can fail strictly', () => {
  const auditSource = read('scripts/audit-blog-editorial-quality.ts');

  assert.match(auditSource, /inspectBlogIntentQuality/);
  assert.match(auditSource, /repairPreview/);
  assert.match(auditSource, /issueCounts/);
  assert.match(auditSource, /intentCounts/);
  assert.match(auditSource, /if \(strict && summary\.failed > 0\) process\.exitCode = 1/);
});
