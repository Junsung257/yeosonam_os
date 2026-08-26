import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
}

type Assertion = (
  output: unknown,
  context?: { vars?: Record<string, unknown> },
) => GradingResult;

const require = createRequire(import.meta.url);
const evaluate = require('../../promptfoo/assertions/concierge-contract.cjs') as Assertion;
const loadTests = require('../../promptfoo/load-concierge-tests.cjs') as () => Promise<Array<{
  description: string;
  vars: Record<string, unknown>;
  metadata: Record<string, string>;
}>>;

describe('Promptfoo concierge contract', () => {
  it('accepts a complete recorded answer', () => {
    const result = evaluate('취소 및 환불은 상품별 규정을 확인해 안내합니다.', {
      vars: {
        expected_keywords: ['취소', '규정'],
        forbidden_keywords: ['무조건 환불'],
      },
    });

    expect(result).toMatchObject({ pass: true, score: 1 });
  });

  it('reports missing and forbidden phrases together', () => {
    const result = evaluate('무조건 환불해 드립니다.', {
      vars: {
        expected_keywords: ['취소', '규정'],
        forbidden_keywords: ['무조건 환불'],
      },
    });

    expect(result).toMatchObject({ pass: false, score: 0 });
    expect(result.reason).toContain('필수 키워드 누락');
    expect(result.reason).toContain('금지 키워드 감지');
  });

  it('fails closed for an empty answer or malformed keyword lists', () => {
    const result = evaluate('', {
      vars: {
        expected_keywords: '취소',
        forbidden_keywords: null,
      },
    });

    expect(result).toMatchObject({ pass: false, score: 0 });
    expect(result.reason).toContain('답변이 비어 있음');
  });

  it('adapts the authoritative JSONL corpus without duplicating answers', async () => {
    const tests = await loadTests();

    expect(tests).toHaveLength(5);
    expect(tests[0]).toMatchObject({
      description: expect.stringContaining('qa-001'),
      metadata: {
        corpus_id: 'qa-001',
        source: 'tests/evals/concierge-set.jsonl',
        question: '다낭 3박4일 패키지 추천해줘',
      },
      vars: {
        candidate_answer: expect.stringContaining('다낭'),
        expected_keywords: ['다낭', '3박', '패키지'],
        forbidden_keywords: ['무조건 환불', '경쟁사'],
      },
    });
  });
});
