'use strict';

function parseJson(output) {
  const text = String(output || '').trim();
  const unfenced = text.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  return JSON.parse(unfenced);
}

module.exports = (output, context) => {
  const dimensions = ['usefulness', 'naturalness', 'completeness', 'originality', 'source_honesty'];
  let result;
  try {
    result = parseJson(output);
  } catch {
    return { pass: false, score: 0, reason: 'judge_output_not_json' };
  }
  if (!result || typeof result.passed !== 'boolean' || !result.dimensions || !Array.isArray(result.reasons)) {
    return { pass: false, score: 0, reason: 'judge_schema_invalid' };
  }
  if (dimensions.some((name) => typeof result.dimensions[name] !== 'boolean')) {
    return { pass: false, score: 0, reason: 'judge_dimensions_invalid' };
  }
  const dimensionsPass = dimensions.every((name) => result.dimensions[name]);
  if (result.passed !== dimensionsPass) {
    return { pass: false, score: 0, reason: 'judge_pass_dimension_mismatch' };
  }
  const expectedPass = context.vars?.expected_pass === true || context.vars?.expected_pass === 'true';
  const expectedFailures = String(context.vars?.expected_failed_dimensions || '').split(',').filter(Boolean);
  const missedFailure = expectedFailures.find((name) => result.dimensions[name] !== false);
  const pass = result.passed === expectedPass && !missedFailure;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? `expected_pass=${expectedPass}; actual_pass=${result.passed}`
      : `expected_pass=${expectedPass}; actual_pass=${result.passed}; missed_failure=${missedFailure || 'none'}`,
  };
};
