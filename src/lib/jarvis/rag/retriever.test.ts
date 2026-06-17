import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/secret-registry', () => ({ getSecret: () => null }))

import { serializePgVector } from './retriever'

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
