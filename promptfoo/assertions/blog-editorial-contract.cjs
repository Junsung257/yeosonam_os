'use strict';

module.exports = (output, context) => {
  const vars = context.vars || {};
  const text = String(output || '');
  const failures = [];
  const internalLabel = /\[(?:절약형|일반형|여유형|간식|아침|점심|저녁|[A-Z_]{3,})[^\n]{0,80}\]/i.test(text);
  const genericCommands = (text.match(/(?:확인|비교|결정|선택)하세요/g) || []).length;
  const dishonestOfficial = /\[공식\s*근거\]\(https?:\/\/(?:www\.)?(?:numbeo\.com|reddit\.com)/i.test(text);
  const directAnswer = /직접\s*답변\s*:/i.test(text);
  const foodBudget = vars.intent === 'food_budget';
  const foodScenarios = (text.match(/\|\s*(?:절약형|일반형|여유형)\s*\|/g) || []).length;
  const calculation = /\d[\d,.]*\s*\+\s*\d[\d,.]*\s*=\s*\d[\d,.]*\s*(?:USD|KRW|JPY|VND|SGD|EUR|THB)/i.test(text);

  if (internalLabel) failures.push('internal_label_leak');
  if (dishonestOfficial) failures.push('source_label_misleading');
  if (!directAnswer) failures.push('reader_task_unanswered');
  if (foodBudget && (foodScenarios < 3 || !calculation)) failures.push('food_budget_scenarios_missing');
  if (genericCommands >= 5 && !directAnswer) failures.push('commodity_source_stitching');

  const actualPass = failures.length === 0;
  const expectedPass = vars.expected_pass === true || vars.expected_pass === 'true';
  return {
    pass: actualPass === expectedPass,
    score: actualPass === expectedPass ? 1 : 0,
    reason: `expected_pass=${expectedPass}; actual_pass=${actualPass}; failures=${failures.join(',') || 'none'}`,
  };
};
