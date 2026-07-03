const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../../..');
const publisherSource = fs.readFileSync(
  path.join(root, 'src/app/api/cron/blog-publisher/route.ts'),
  'utf8',
);

function indexOfOrFail(source, needle, label) {
  const index = source.indexOf(needle);
  assert.notStrictEqual(index, -1, `${label} not found`);
  return index;
}

test('ERR-BLOG-publisher-quality-self-repair: length and links failures are repairable before blocking publish', () => {
  assert.match(publisherSource, /function appendPublishReadinessSupport/);
  assert.match(publisherSource, /function ensurePublisherInternalLinks/);
  assert.match(publisherSource, /failed\.has\('length'\)/);
  assert.match(publisherSource, /failed\.has\('links'\)/);
  assert.match(publisherSource, /buildStandardBlogCtaMarkdown/);

  const repairStart = indexOfOrFail(publisherSource, 'async function repairFailedQualityGates', 'repairFailedQualityGates');
  const repairSource = publisherSource.slice(repairStart);
  const lengthRepair = indexOfOrFail(repairSource, 'appendPublishReadinessSupport(', 'length repair');
  const linkRepair = indexOfOrFail(repairSource, 'ensurePublisherInternalLinks(', 'internal link repair');
  const rerunGate = indexOfOrFail(repairSource, 'qa = await runGeneratedQualityGates', 'gate rerun');

  assert.ok(lengthRepair < rerunGate, 'length repair must run before the gate is rechecked');
  assert.ok(linkRepair < rerunGate, 'link repair must run before the gate is rechecked');
});

test('ERR-BLOG-publisher-quality-self-repair: failure breakdown names length and links instead of other', () => {
  const classifyStart = indexOfOrFail(publisherSource, 'function classifyPublisherFailure', 'classifyPublisherFailure');
  const classifySource = publisherSource.slice(classifyStart, indexOfOrFail(publisherSource, 'function buildPublisherFailureBreakdown', 'buildPublisherFailureBreakdown'));

  assert.match(classifySource, /thin content/);
  assert.match(classifySource, /return 'length'/);
  assert.match(classifySource, /internal link/);
  assert.match(classifySource, /return 'links'/);
});
