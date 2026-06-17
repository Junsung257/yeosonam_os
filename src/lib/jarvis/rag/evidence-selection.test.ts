import { describe, expect, it } from 'vitest'

import { selectEvidenceHits } from './evidence-selection'
import type { RetrievalHit } from './retriever'

function hit(overrides: Partial<RetrievalHit>): RetrievalHit {
  return {
    id: crypto.randomUUID(),
    tenantId: null,
    sourceType: 'blog',
    sourceId: null,
    sourceUrl: null,
    sourceTitle: '다낭 여행 가이드',
    chunkText: '다낭 가족여행 추천',
    contextualText: '다낭 가족여행 추천',
    metadata: {},
    score: 0.01,
    vectorScore: 0.7,
    bm25Score: 0,
    ...overrides,
  }
}

describe('selectEvidenceHits', () => {
  it('boosts policy evidence for policy-heavy customer questions', () => {
    const selected = selectEvidenceHits('환불 규정 알려줘', [
      hit({ sourceType: 'blog', sourceTitle: '여행 후기', vectorScore: 0.72 }),
      hit({ sourceType: 'policy', sourceTitle: '고객 환불 및 결제취소 응대 정책', chunkText: '환불 결제취소 상담원 승인', contextualText: '환불 결제취소 상담원 승인', vectorScore: 0.66 }),
    ], 1)

    expect(selected[0].sourceType).toBe('policy')
  })

  it('prefers diverse evidence over repeated chunks from the same title', () => {
    const selected = selectEvidenceHits('나트랑 가격 비교 추천', [
      hit({ sourceType: 'blog', sourceTitle: '나트랑 A 블로그', vectorScore: 0.78 }),
      hit({ sourceType: 'blog', sourceTitle: '나트랑 A 블로그', vectorScore: 0.77 }),
      hit({ sourceType: 'package', sourceTitle: '나트랑 패키지', chunkText: '나트랑 가격 비교 추천 패키지', contextualText: '나트랑 가격 비교 추천 패키지', vectorScore: 0.7 }),
    ], 2)

    expect(selected.map((item) => item.sourceType)).toContain('package')
  })
})
