import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const assertion = require('../../../promptfoo/assertions/blog-model-eval-live.cjs');

const passingDimensions = {
  usefulness: true,
  naturalness: true,
  completeness: true,
  originality: true,
  source_honesty: true,
};

test('live assertion accepts a consistent passing judge result', () => {
  const result = assertion(JSON.stringify({ passed: true, dimensions: passingDimensions, reasons: [] }), {
    vars: { expected_pass: true, expected_failed_dimensions: '' },
  });
  assert.equal(result.pass, true);
});

test('live assertion requires the expected negative dimension', () => {
  const result = assertion(JSON.stringify({
    passed: false,
    dimensions: { ...passingDimensions, source_honesty: false },
    reasons: ['misleading source label'],
  }), {
    vars: { expected_pass: false, expected_failed_dimensions: 'source_honesty' },
  });
  assert.equal(result.pass, true);
});

test('live assertion rejects a passed value that contradicts dimensions', () => {
  const result = assertion(JSON.stringify({
    passed: true,
    dimensions: { ...passingDimensions, usefulness: false },
    reasons: [],
  }), { vars: { expected_pass: true } });
  assert.equal(result.pass, false);
  assert.equal(result.reason, 'judge_pass_dimension_mismatch');
});
