'use strict';

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function evaluateConciergeContract(output, context = {}) {
  const answer = String(output ?? '');
  const vars = context.vars ?? {};
  const expected = stringList(vars.expected_keywords);
  const forbidden = stringList(vars.forbidden_keywords);
  const missingExpected = expected.filter((keyword) => !answer.includes(keyword));
  const foundForbidden = forbidden.filter((keyword) => answer.includes(keyword));
  const pass = answer.trim().length > 0 && missingExpected.length === 0 && foundForbidden.length === 0;

  const reasons = [];
  if (answer.trim().length === 0) reasons.push('답변이 비어 있음');
  if (missingExpected.length > 0) reasons.push(`필수 키워드 누락: ${missingExpected.join(', ')}`);
  if (foundForbidden.length > 0) reasons.push(`금지 키워드 감지: ${foundForbidden.join(', ')}`);

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? '필수·금지 키워드 계약 통과' : reasons.join('; '),
    componentResults: [
      {
        pass: missingExpected.length === 0,
        score: missingExpected.length === 0 ? 1 : 0,
        reason: missingExpected.length === 0 ? '필수 키워드 통과' : `누락: ${missingExpected.join(', ')}`,
      },
      {
        pass: foundForbidden.length === 0,
        score: foundForbidden.length === 0 ? 1 : 0,
        reason: foundForbidden.length === 0 ? '금지 키워드 통과' : `감지: ${foundForbidden.join(', ')}`,
      },
    ],
  };
}

module.exports = evaluateConciergeContract;
module.exports.evaluateConciergeContract = evaluateConciergeContract;
