import { describe, expect, it } from 'vitest'

import { assessRetrievalConfidence } from './retrieval-confidence'
import type { RetrievalHit } from './retriever'

function hit(overrides: Partial<RetrievalHit>): RetrievalHit {
  return {
    id: crypto.randomUUID(),
    tenantId: null,
    sourceType: 'blog',
    sourceId: null,
    sourceUrl: null,
    sourceTitle: '다낭 여행 가이드',
    chunkText: '다낭 여행 정보',
    contextualText: '다낭 여행 정보',
    metadata: {},
    score: 0.01,
    vectorScore: 0.75,
    bm25Score: 0,
    ...overrides,
  }
}

describe('assessRetrievalConfidence', () => {
  it('withholds answers when no retrieval evidence exists', () => {
    const decision = assessRetrievalConfidence('환불 규정 알려줘', [])

    expect(decision.level).toBe('none')
    expect(decision.requiresEscalation).toBe(true)
    expect(decision.shouldWithholdDirectAnswer).toBe(true)
  })

  it('escalates policy questions when policy evidence is missing', () => {
    const decision = assessRetrievalConfidence('환불 규정 알려줘', [
      hit({ sourceType: 'blog', sourceTitle: '여행 후기', vectorScore: 0.68 }),
    ])

    expect(decision.requiresEscalation).toBe(true)
    expect(decision.shouldWithholdDirectAnswer).toBe(true)
    expect(decision.reasons).toContain('policy_topic_without_policy_evidence')
  })

  it('allows grounded policy guidance while keeping risky execution escalated', () => {
    const decision = assessRetrievalConfidence('환불 처리해주세요', [
      hit({ sourceType: 'policy', sourceTitle: '고객 환불 및 결제취소 응대 정책', vectorScore: 0.67 }),
      hit({ sourceType: 'package', sourceTitle: '나트랑 패키지', vectorScore: 0.64 }),
    ])

    expect(decision.level).toBe('high')
    expect(decision.requiresEscalation).toBe(true)
    expect(decision.shouldWithholdDirectAnswer).toBe(false)
    expect(decision.guidance).toContain('상담원 승인')
  })
})
