'use strict';

module.exports = function evaluateLivePolicy(output, context = {}) {
  let actual;
  try { actual = JSON.parse(String(output).replace(/^\`\`\`(?:json)?\s*|\s*\`\`\`$/g, '')); }
  catch { return { pass: false, score: 0, reason: 'Output is not JSON' }; }
  const expected = context.vars?.expected || {};
  const failures = [];
  for (const key of ['mode','ssot','approval_required','mutation_allowed','skill','spec_required','external_verification_required']) {
    if (actual[key] !== expected[key]) failures.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
  }
  return { pass: failures.length === 0, score: failures.length === 0 ? 1 : 0, reason: failures.length ? failures.join('; ') : 'Policy decision matches expected contract' };
};
