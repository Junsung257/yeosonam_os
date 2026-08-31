import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSignal,
  validateIntakeEndpoint,
  validateReviewedSource,
  validateSignal,
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

test('signals are nonempty, review-only, and redact contact details before disk', () => {
  const source = validateReviewedSource({
    id: 'source-one',
    url: 'https://example.com/?utm_source=pilot',
    approvedHostname: 'example.com',
    evidenceClass: 'official_source_candidate',
  });
  const signal = buildSignal({
    source,
    title: 'Official page',
    text: `${'Useful official source text. '.repeat(12)} test@example.com 010-1234-5678`,
    collectedAt: '2026-08-31T00:00:00.000Z',
    collectorVersion: '3.18.1',
  });

  assert.deepEqual(validateSignal(signal), []);
  assert.equal(signal.officialSource, false);
  assert.match(signal.excerpt, /\[email-redacted\]/u);
  assert.match(signal.excerpt, /\[phone-redacted\]/u);
  assert.equal(signal.sourceUrl, 'https://example.com/');
});
