import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { evaluateBlogEditorialPromptfooV4 } from './assertions/blog-editorial-contract-v4';

const require = createRequire(import.meta.url);
const tests = require('./load-blog-editorial-tests.cjs') as Array<{
  description: string;
  vars: Record<string, unknown> & { candidate_answer: string; corpus_group: string };
}>;

describe('blog editorial Promptfoo V4 golden corpus', () => {
  it('freezes exactly 72 safe, 12 product, and 16 failure-edge cases', () => {
    expect(tests).toHaveLength(100);
    expect(tests.filter((test) => test.vars.corpus_group === 'safe_intent')).toHaveLength(72);
    expect(tests.filter((test) => test.vars.corpus_group === 'product_decision')).toHaveLength(12);
    expect(tests.filter((test) => test.vars.corpus_group === 'failure_edge')).toHaveLength(16);
  });

  it('classifies every frozen expected pass/failure with the production deterministic validator', () => {
    const failures = tests.flatMap((test) => {
      const result = evaluateBlogEditorialPromptfooV4(test.vars.candidate_answer, { vars: test.vars });
      return result.pass ? [] : [`${test.description}: ${result.reason}`];
    });
    expect(failures).toEqual([]);
  });
});
