import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPublicHostname,
  buildSignal,
  crawlerRequest,
  intakePayload,
  isPrivateNetworkAddress,
  validateIntakeEndpoint,
  validateReviewedRequestUrl,
  validateReviewedSource,
  validateSignal,
  validateSignalReport,
} from './signal-utils.mjs';

test('intake credentials can only be sent to the canonical Yeosonam route', () => {
  assert.equal(
    validateIntakeEndpoint('https://www.yeosonam.com/api/internal/research/signals').href,
    'https://www.yeosonam.com/api/internal/research/signals',
  );
  assert.throws(() => validateIntakeEndpoint('https://evil.example/api/internal/research/signals'));
  assert.throws(() => validateIntakeEndpoint('https://www.yeosonam.com/api/internal/research/signals?next=evil'));
});

test('reviewed sources reject private hosts, host drift, and credential query keys', () => {
  const base = {
    id: 'source-one',
    approvedHostname: 'example.com',
    evidenceClass: 'official_source_candidate',
  };
  assert.throws(() => validateReviewedSource({ ...base, url: 'https://127.0.0.1/' }));
  assert.throws(() => validateReviewedSource({ ...base, url: 'https://evil.example/' }));
  assert.throws(() => validateReviewedSource({ ...base, url: 'https://example.com/?x-amz-signature=secret' }));
});

test('every outbound destination stays on the reviewed public hostname', async () => {
  const source = validateReviewedSource({
    id: 'source-one',
    url: 'https://example.com/',
    approvedHostname: 'example.com',
    evidenceClass: 'official_source_candidate',
  });

  assert.equal(validateReviewedRequestUrl(source, 'https://example.com/article').hostname, 'example.com');
  assert.throws(() => validateReviewedRequestUrl(source, 'https://cdn.example.net/script.js'));
  assert.equal(isPrivateNetworkAddress('100.64.0.1'), true);
  assert.equal(isPrivateNetworkAddress('::ffff:127.0.0.1'), true);
  await assert.rejects(() => assertPublicHostname('example.com', async () => [{ address: '127.0.0.1' }]));
  await assert.doesNotReject(() => assertPublicHostname('example.com', async () => [{ address: '93.184.216.34' }]));
  assert.notEqual(crawlerRequest(source, 'cheerio').uniqueKey, crawlerRequest(source, 'playwright').uniqueKey);
});

test('signals are nonempty, review-only, and redact contact details before disk', () => {
  const source = validateReviewedSource({
    id: 'source-one',
    url: 'https://example.com/?utm_source=pilot',
    approvedHostname: 'example.com',
    evidenceClass: 'official_source_candidate',
  });
  const signal = buildSignal({
    source,
    title: 'Official page test@example.com 010-9999-0000',
    text: `${'Useful official source text. '.repeat(12)} test@example.com 010-1234-5678`,
    collectedAt: '2026-08-31T00:00:00.000Z',
    collectorVersion: '3.18.1',
    statusCode: 200,
    engine: 'cheerio',
  });

  assert.deepEqual(validateSignal(signal), []);
  assert.equal(signal.officialSource, false);
  assert.match(signal.excerpt, /\[email-redacted\]/u);
  assert.match(signal.excerpt, /\[phone-redacted\]/u);
  assert.match(signal.title, /\[email-redacted\]/u);
  assert.match(signal.title, /\[phone-redacted\]/u);
  assert.equal(intakePayload(signal).collectorMeta, undefined);
  assert.equal(signal.sourceUrl, 'https://example.com/');
});

test('reports fail closed on partial batches, crawler failures, and abnormal drops', () => {
  const source = validateReviewedSource({
    id: 'source-one',
    url: 'https://example.com/',
    approvedHostname: 'example.com',
    evidenceClass: 'official_source_candidate',
  });
  const signal = buildSignal({
    source,
    title: 'Official page',
    text: 'Useful official source text. '.repeat(12),
    collectedAt: '2026-08-31T00:00:00.000Z',
    collectorVersion: '3.18.1',
    statusCode: 200,
    engine: 'cheerio',
  });
  const report = {
    schemaVersion: 1,
    generatedAt: '2026-08-31T00:00:00.000Z',
    collector: 'crawlee@3.18.1',
    sourceCount: 1,
    signals: [signal],
    failures: [],
  };

  assert.deepEqual(validateSignalReport(report), []);
  assert.match(validateSignalReport({ ...report, sourceCount: 2 })[0], /partial_batch/u);
  assert.match(validateSignalReport({ ...report, failures: ['source-one:timeout'] })[0], /report_failure/u);
  assert.match(
    validateSignalReport(report, { previousReport: { signals: [signal, signal, signal, signal] } }).at(-1),
    /signal_count_drop/u,
  );
});
