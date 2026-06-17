import { describe, expect, it } from 'vitest'

import { getJarvisPolicyKnowledgeDocs } from './policy-knowledge'

describe('Jarvis policy knowledge pack', () => {
  it('covers critical customer inquiry intents', () => {
    const corpus = getJarvisPolicyKnowledgeDocs()
      .map((doc) => `${doc.sourceTitle}\n${doc.docSummary}\n${doc.body}`)
      .join('\n')

    for (const keyword of [
      '환불',
      '결제취소',
      '입금',
      '예약 상태',
      '날짜',
      '영문명',
      '클레임',
      '카카오톡',
      '알림톡',
      '개인정보 삭제',
      '가격 변경',
      '상담원',
      '승인',
    ]) {
      expect(corpus).toContain(keyword)
    }
  })

  it('uses stable UUID source ids for RAG upserts', () => {
    const docs = getJarvisPolicyKnowledgeDocs()
    const ids = new Set(docs.map((doc) => doc.sourceId))

    expect(docs.length).toBeGreaterThanOrEqual(8)
    expect(ids.size).toBe(docs.length)
    for (const doc of docs) {
      expect(doc.tenantId).toBeNull()
      expect(doc.sourceType).toBe('policy')
      expect(doc.sourceId).toMatch(/^[0-9a-f-]{36}$/)
    }
  })
})
