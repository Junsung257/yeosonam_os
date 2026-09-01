import { inspectBlogEditorialDeterministicallyV1 } from '../../src/lib/blog-editorial-harness-v5';

export const BLOG_PROMPTFOO_RUBRIC_VERSION_V4 = 'blog-promptfoo-rubric-v4.0.0' as const;

type AssertionContext = {
  vars?: Record<string, unknown>;
};

export function evaluateBlogEditorialPromptfooV4(output: string, context: AssertionContext) {
  const vars = context.vars || {};
  const text = String(output || '').trim();
  const title = String(vars.title || '여행 정보');
  const intent = String(vars.intent || 'unknown');
  const failures = [...inspectBlogEditorialDeterministicallyV1({
    title,
    markdown: text,
    intentType: intent,
  }).failureReasons];

  const directAnswer = /직접\s*답변\s*:/i.test(text);
  if (!directAnswer) failures.push('reader_task_unanswered');
  if (text.length < 80) failures.push('meaningful_content_missing');
  if (/(?:SYSTEM PROMPT|BEGIN PROMPT|claim[_ -]?fingerprint)/i.test(text)) failures.push('prompt_residue');
  if (/(?:010[- ]?\d{3,4}[- ]?\d{4}|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{6}[- ]?[1-4]\d{6}\b)/.test(text)) {
    failures.push('pii_detected');
  }
  if (/\]\((?:not-a-url|http:\/\/localhost|https?:\/\/127\.)/i.test(text)) failures.push('unsafe_or_broken_source');
  if (/\[(?:공식\s*근거|공식\s*자료)\]\(https?:\/\/(?:www\.)?(?:numbeo\.com|reddit\.com)/i.test(text)) {
    failures.push('source_label_misleading');
  }
  const paragraphKeys = text.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s+/g, ' ').trim()).filter((paragraph) => paragraph.length >= 20);
  if (new Set(paragraphKeys).size !== paragraphKeys.length) failures.push('duplicate_paragraph');
  if (/(?:무조건\s*최고|100%\s*성공|세계\s*최고|업계\s*1위|유일한\s*정답|정확한\s*총액)/i.test(text)) {
    failures.push('unsupported_promotion_or_certainty');
  }
  if (/(?:제휴\s*수수료).{0,30}(?:표시\s*없이|구매를\s*강요)/i.test(text)) failures.push('affiliate_disclosure_missing');
  const hasNumericClaim = /\d[\d,.]*(?:\s*(?:원|USD|KRW|JPY|VND|%))/.test(text);
  const hasCitation = /\[[^\]]+\]\(https:\/\/[^)]+\)/.test(text);
  if (hasNumericClaim && !hasCitation) failures.push('unsupported_numeric_claim');

  const uniqueFailures = [...new Set(failures)];
  const actualPass = uniqueFailures.length === 0;
  const expectedPass = vars.expected_pass === true || vars.expected_pass === 'true';
  const semanticScore = actualPass ? 100 : 0;
  const baselineScore = Number(vars.baseline_score);
  const semanticThresholdPassed = !expectedPass || semanticScore >= 95;
  const regressionPassed = Number.isFinite(baselineScore) && baselineScore - semanticScore <= 2;
  const versionsMatch = vars.rubric_version === BLOG_PROMPTFOO_RUBRIC_VERSION_V4
    && typeof vars.model_version === 'string'
    && typeof vars.prompt_version === 'string';
  return {
    pass: actualPass === expectedPass && versionsMatch && semanticThresholdPassed && regressionPassed,
    score: actualPass === expectedPass && versionsMatch && semanticThresholdPassed && regressionPassed ? 1 : 0,
    reason: [
      `expected_pass=${expectedPass}`,
      `actual_pass=${actualPass}`,
      `versions=${String(vars.model_version)}/${String(vars.prompt_version)}/${String(vars.rubric_version)}`,
      `semantic=${semanticScore}/95`,
      `regression=${baselineScore - semanticScore}/2`,
      `failures=${uniqueFailures.join(',') || 'none'}`,
    ].join('; '),
  };
}
