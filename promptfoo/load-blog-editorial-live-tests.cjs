'use strict';

const path = require('node:path');
const policy = require('../config/blog-model-evaluation-policy.json');
const fixtures = require(path.resolve(__dirname, '..', policy.fixture.path));
const phase = process.env.BLOG_MODEL_EVAL_PHASE;
const runId = process.env.BLOG_MODEL_EVAL_RUN_ID || '0';
if (phase !== 'smoke' && phase !== 'full') throw new Error('BLOG_MODEL_EVAL_PHASE must be smoke or full.');
if (fixtures.length !== 33) throw new Error(`BLOG_MODEL_EVAL_FIXTURE_COUNT_INVALID:${fixtures.length}`);

const selected = phase === 'smoke' ? fixtures.slice(0, 3) : fixtures;

module.exports = selected.map((fixture) => {
  const description = String(fixture.description || '');
  const expectedFailedDimensions = description.includes('unanswered negative')
    ? ['usefulness']
    : description.includes('dishonest source negative')
      ? ['source_honesty']
      : [];
  return {
    ...fixture,
    vars: { ...fixture.vars, expected_failed_dimensions: expectedFailedDimensions.join(',') },
    metadata: {
      fixture_description: description,
      phase,
      run_id: runId,
    },
  };
});
