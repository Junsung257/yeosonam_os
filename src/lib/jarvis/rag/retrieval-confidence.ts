import type { RetrievalHit } from './retriever'

export type RetrievalConfidenceLevel = 'none' | 'low' | 'medium' | 'high'

export interface RetrievalConfidenceDecision {
  confidence: number
  level: RetrievalConfidenceLevel
  requiresEscalation: boolean
  shouldWithholdDirectAnswer: boolean
  reasons: string[]
  guidance: string
}

const POLICY_TOPIC_RE =
  /환불|취소|결제|입금|예약\s*상태|예약\s*변경|날짜\s*변경|인원\s*변경|객실\s*변경|영문명|여권|개인정보|삭제|클레임|불만|사고|보상|가격\s*변경|할인|알림톡|카카오톡/i

const HIGH_RISK_ACTION_RE =
  /환불\s*(해|해주세요|처리|진행)|취소\s*(해|해주세요|처리|진행)|결제취소|입금\s*확인|예약.*(바꿔|변경|수정)|날짜.*(바꿔|변경|수정)|인원.*(바꿔|변경|수정)|영문명.*(바꿔|변경|수정)|여권.*(바꿔|변경|수정)|개인정보.*(삭제|정정)|가격.*(바꿔|변경|수정)|할인.*(적용|해)|보상|클레임|사고/i

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(1, score))
}

function rounded(score: number): number {
  return Math.round(score * 100) / 100
}

export function assessRetrievalConfidence(query: string, hits: RetrievalHit[]): RetrievalConfidenceDecision {
  const reasons: string[] = []
  const hasPolicyTopic = POLICY_TOPIC_RE.test(query)
  const hasHighRiskAction = HIGH_RISK_ACTION_RE.test(query)

  if (hits.length === 0) {
    return {
      confidence: 0,
      level: 'none',
      requiresEscalation: true,
      shouldWithholdDirectAnswer: true,
      reasons: ['no_retrieval_hits'],
      guidance: '검색 근거가 없습니다. 답을 확정하지 말고 상담원 확인 또는 추가 정보를 요청하세요.',
    }
  }

  const top = hits[0]
  const topVector = clampScore(top.vectorScore)
  const hasPolicyEvidence = hits.slice(0, 3).some((hit) => hit.sourceType === 'policy')
  const hasDiverseEvidence = new Set(hits.slice(0, 3).map((hit) => hit.sourceType)).size >= 2

  let score = topVector
  if (hasDiverseEvidence) score += 0.05
  if (hasPolicyTopic && hasPolicyEvidence) score += 0.08
  if (hasPolicyTopic && !hasPolicyEvidence) score -= 0.25
  if (!top.sourceTitle) score -= 0.05

  score = clampScore(score)

  if (hasPolicyTopic && !hasPolicyEvidence) reasons.push('policy_topic_without_policy_evidence')
  if (hasHighRiskAction) reasons.push('high_risk_customer_action')
  if (topVector < 0.62) reasons.push('weak_top_vector_match')
  if (!hasDiverseEvidence) reasons.push('single_source_type')

  const level: RetrievalConfidenceLevel =
    score >= 0.78 ? 'high' :
    score >= 0.62 ? 'medium' :
    score > 0 ? 'low' :
    'none'

  const requiresEscalation =
    hasHighRiskAction ||
    level === 'none' ||
    level === 'low' ||
    (hasPolicyTopic && !hasPolicyEvidence)

  const shouldWithholdDirectAnswer =
    level === 'none' ||
    level === 'low' ||
    (hasHighRiskAction && !hasPolicyEvidence)

  const guidance = shouldWithholdDirectAnswer
    ? '근거가 부족하거나 직접 처리 요청입니다. 확정 답변을 피하고 필요한 정보를 받은 뒤 상담원 확인으로 전환하세요.'
    : hasHighRiskAction
      ? '정책 근거를 참고해 일반 절차만 안내하고, 실행·확정·금액 약속은 상담원 승인으로 전환하세요.'
      : hasPolicyTopic
        ? '정책 근거를 인용하되 상품별 조건은 상담원이 확정한다고 안내하세요.'
        : '검색 근거를 바탕으로 답변하되, 없는 가격·일정·혜택은 만들지 마세요.'

  return {
    confidence: rounded(score),
    level,
    requiresEscalation,
    shouldWithholdDirectAnswer,
    reasons,
    guidance,
  }
}
