import { describe, expect, it } from 'vitest'

import { extractGraphLiteEntities, normalizeGraphEntityName } from './graph-lite'

describe('GraphRAG-lite entity extraction', () => {
  it('extracts destination and product entities from package chunks', () => {
    const entities = extractGraphLiteEntities({
      id: crypto.randomUUID(),
      tenant_id: null,
      source_type: 'package',
      source_id: crypto.randomUUID(),
      source_title: '나트랑/달랏 3박5일 - 가족 추천 패키지',
      chunk_text: '나트랑 가격 비교와 달랏 일정이 포함된 상품입니다.',
      contextual_text: '고객이 나트랑 가족여행 상품을 비교할 때 쓰는 근거입니다.',
    })

    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'destination', canonicalName: '나트랑' }),
      expect.objectContaining({ entityType: 'destination', canonicalName: '달랏' }),
      expect.objectContaining({ entityType: 'product' }),
      expect.objectContaining({ entityType: 'source_type', canonicalName: 'package' }),
    ]))
  })

  it('extracts policy intents and external channels from policy chunks', () => {
    const entities = extractGraphLiteEntities({
      id: crypto.randomUUID(),
      tenant_id: null,
      source_type: 'policy',
      source_id: crypto.randomUUID(),
      source_title: '카카오톡 및 알림톡 외부 채널 응대 정책',
      chunk_text: '환불, 결제취소, 개인정보 정정 요청이면 상담원 연결 안내를 우선한다.',
      contextual_text: '카카오톡과 알림톡 고객문의 처리 정책입니다.',
    })

    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'policy_intent', canonicalName: '환불/결제취소' }),
      expect.objectContaining({ entityType: 'policy_intent', canonicalName: '개인정보' }),
      expect.objectContaining({ entityType: 'channel', canonicalName: '카카오톡' }),
      expect.objectContaining({ entityType: 'channel', canonicalName: '알림톡' }),
    ]))
  })

  it('normalizes entity names for stable upserts', () => {
    expect(normalizeGraphEntityName('  Nha-Trang!! ')).toBe('nha trang')
  })
})
