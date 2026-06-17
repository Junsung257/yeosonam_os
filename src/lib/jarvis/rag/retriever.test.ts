import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/secret-registry', () => ({ getSecret: () => null }))

import { parseRerankScores, serializePgVector } from './retriever'

describe('serializePgVector', () => {
  it('returns null when embeddings are unavailable', () => {
    expect(serializePgVector(null)).toBeNull()
  })

  it('serializes a 1536-dimension embedding for pgvector RPC input', () => {
    const embedding = Array.from({ length: 1536 }, (_, index) => (index === 1 ? 0.5 : 0))

    expect(serializePgVector(embedding)).toBe(`[0,0.5,${'0,'.repeat(1533)}0]`)
  })

  it('rejects malformed embeddings before calling Supabase', () => {
    expect(() => serializePgVector([0, 1])).toThrow('expected 1536')

    const embedding = new Array(1536).fill(0)
    embedding[9] = Number.POSITIVE_INFINITY

    expect(() => serializePgVector(embedding)).toThrow('non-finite')
  })
})

describe('parseRerankScores', () => {
  it('extracts rerank JSON from fenced or wrapped model output', () => {
    expect(parseRerankScores('```json\n[{"i":1,"s":0.9},{"i":0,"s":1.2}]\n```')).toEqual([
      { i: 1, s: 0.9 },
      { i: 0, s: 1 },
    ])
    expect(parseRerankScores('결과: [{"i":2,"s":0.4}] 입니다')).toEqual([{ i: 2, s: 0.4 }])
  })

  it('returns an empty list for malformed model output', () => {
    expect(parseRerankScores('[{"i":0,"s":')).toEqual([])
    expect(parseRerankScores('not-json')).toEqual([])
  })
})
