type GraphEntityType = 'destination' | 'policy_intent' | 'channel' | 'product' | 'source_type'

export interface GraphLiteChunk {
  id: string
  tenant_id: string | null
  source_type: string | null
  source_id: string | null
  source_title: string | null
  chunk_text: string | null
  contextual_text: string | null
}

export interface GraphLiteEntityCandidate {
  entityType: GraphEntityType
  canonicalName: string
  normalizedName: string
  aliases: string[]
  confidence: number
  evidenceText: string
  metadata: Record<string, unknown>
}

const DESTINATIONS = [
  ['다낭', ['danang', 'da nang']],
  ['나트랑', ['냐짱', 'nha trang']],
  ['달랏', ['dalat', 'da lat']],
  ['보홀', ['bohol']],
  ['세부', ['cebu']],
  ['대만', ['taiwan']],
  ['타이베이', ['taipei']],
  ['석가장', ['shijiazhuang']],
  ['서안', ['시안', 'xian', "xi'an"]],
  ['구채구', ['jiuzhaigou']],
  ['비엔티엔', ['vientiane']],
  ['루앙프라방', ['luang prabang']],
  ['방비엥', ['vang vieng']],
] as const

const POLICY_INTENTS = [
  ['refund_cancel', '환불/결제취소', /환불|결제취소|취소|위약금|부분환불/i],
  ['deposit_payment', '입금/결제상태', /입금|결제\s*상태|미입금|이중결제|가상계좌/i],
  ['booking_change', '예약변경', /예약\s*변경|날짜\s*변경|인원\s*변경|객실\s*변경|발권|변경/i],
  ['passport_name', '여권/영문명', /여권|영문명|생년월일|국적/i],
  ['complaint_incident', '불만/사고/보상', /불만|클레임|사고|보상|분실|의료|결항/i],
  ['privacy', '개인정보', /개인정보|삭제|열람|정정|처리정지|민감정보/i],
  ['price_discount', '가격변경/할인', /가격\s*변경|특가|할인|쿠폰|차액/i],
] as const

const CHANNELS = [
  ['kakao', '카카오톡', /카카오톡|카톡/i],
  ['alimtalk', '알림톡', /알림톡/i],
] as const

export function normalizeGraphEntityName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function evidence(text: string, index: number): string {
  const start = Math.max(0, index - 40)
  return text.slice(start, index + 80).replace(/\s+/g, ' ').trim()
}

function addCandidate(
  candidates: Map<string, GraphLiteEntityCandidate>,
  candidate: Omit<GraphLiteEntityCandidate, 'normalizedName'>,
) {
  const normalizedName = normalizeGraphEntityName(candidate.canonicalName)
  const key = `${candidate.entityType}:${normalizedName}`
  const existing = candidates.get(key)
  if (!existing || existing.confidence < candidate.confidence) {
    candidates.set(key, { ...candidate, normalizedName })
  }
}

export function extractGraphLiteEntities(chunk: GraphLiteChunk): GraphLiteEntityCandidate[] {
  const candidates = new Map<string, GraphLiteEntityCandidate>()
  const text = `${chunk.source_title ?? ''}\n${chunk.contextual_text ?? ''}\n${chunk.chunk_text ?? ''}`

  if (chunk.source_type) {
    addCandidate(candidates, {
      entityType: 'source_type',
      canonicalName: chunk.source_type,
      aliases: [],
      confidence: 0.95,
      evidenceText: chunk.source_type,
      metadata: { source_type: chunk.source_type },
    })
  }

  if (chunk.source_type === 'package' && chunk.source_id && chunk.source_title) {
    addCandidate(candidates, {
      entityType: 'product',
      canonicalName: chunk.source_title,
      aliases: [],
      confidence: 0.9,
      evidenceText: chunk.source_title,
      metadata: { source_id: chunk.source_id },
    })
  }

  for (const [canonicalName, aliases] of DESTINATIONS) {
    const terms = [canonicalName, ...aliases]
    const index = terms
      .map((term) => text.toLowerCase().indexOf(term.toLowerCase()))
      .find((position) => position >= 0)
    if (index !== undefined && index >= 0) {
      addCandidate(candidates, {
        entityType: 'destination',
        canonicalName,
        aliases: [...aliases],
        confidence: 0.86,
        evidenceText: evidence(text, index),
        metadata: {},
      })
    }
  }

  for (const [intentKey, label, pattern] of POLICY_INTENTS) {
    const match = text.match(pattern)
    if (match?.index !== undefined) {
      addCandidate(candidates, {
        entityType: 'policy_intent',
        canonicalName: label,
        aliases: [intentKey],
        confidence: chunk.source_type === 'policy' ? 0.95 : 0.76,
        evidenceText: evidence(text, match.index),
        metadata: { intent: intentKey },
      })
    }
  }

  for (const [channelKey, label, pattern] of CHANNELS) {
    const match = text.match(pattern)
    if (match?.index !== undefined) {
      addCandidate(candidates, {
        entityType: 'channel',
        canonicalName: label,
        aliases: [channelKey],
        confidence: 0.9,
        evidenceText: evidence(text, match.index),
        metadata: { channel: channelKey },
      })
    }
  }

  return [...candidates.values()].sort((a, b) => b.confidence - a.confidence)
}
