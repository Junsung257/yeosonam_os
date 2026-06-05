import { describe, expect, it } from 'vitest';
import { evaluateRagGoldenCase, evaluateRagGoldenSet } from './rag-evaluator';
import type { RagGoldenCase } from './rag-golden-cases';

describe('Jarvis RAG golden-set evaluator', () => {
  it('passes the bundled RAG grounding and citation cases', () => {
    const summary = evaluateRagGoldenSet();

    expect(summary.total).toBeGreaterThanOrEqual(4);
    expect(summary.failed).toBe(0);
    expect(summary.average.contextRecall).toBe(1);
    expect(summary.average.answerRelevancy).toBe(1);
    expect(summary.average.faithfulness).toBe(1);
    expect(summary.average.citationCoverage).toBe(1);
  });

  it('fails unsupported answer claims and missing citations', () => {
    const hallucinated: RagGoldenCase = {
      id: 'rag-hallucination-detection',
      query: '취소하면 환불 가능해?',
      description: 'unsupported claim detector',
      contexts: [
        {
          title: '환불 정책',
          url: '/terms/refund',
          text: '환불은 항공권 발권 여부와 출발일 기준 취소 시점에 따라 담당자 확인이 필요하다.',
        },
      ],
      answer: '100% 환불 가능합니다. 바로 처리해드릴게요.',
      expectedFacts: [
        { id: 'ticketing', terms: ['항공권', '발권'] },
        { id: 'staff-check', terms: ['담당자', '확인'] },
      ],
      answerClaims: [
        { id: 'claim-full-refund', terms: ['100%', '환불', '가능'] },
      ],
      requiredCitations: ['환불 정책'],
    };

    const result = evaluateRagGoldenCase(hallucinated);

    expect(result.passed).toBe(false);
    expect(result.unsupportedClaims).toContain('claim-full-refund');
    expect(result.missingCitations).toContain('환불 정책');
  });
});
